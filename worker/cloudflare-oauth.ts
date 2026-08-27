import { readPublicAiPoolConfig } from "./public-ai-pool";

const AUTHORIZE_ENDPOINT = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_ENDPOINT = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_ENDPOINT = "https://dash.cloudflare.com/oauth2/revoke";
const API_ENDPOINT = "https://api.cloudflare.com/client/v4";
const SESSION_COOKIE = "neurondeck_cf_session";
const STATE_COOKIE = "neurondeck_cf_oauth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;

export interface CloudflareOAuthEnv {
  AUTH_SESSIONS?: KVNamespace;
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_SCOPES?: string;
  OAUTH_SESSION_SECRET?: string;
  PUBLIC_AI_ACCOUNTS?: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

interface StoredOAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  accounts: CloudflareAccount[];
  activeAccountId: string;
  createdAt: number;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface CloudflareApiResponse<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
}

export interface OAuthSessionContext {
  sessionId: string;
  accessToken: string;
  accountId: string;
  accounts: CloudflareAccount[];
}

export type OAuthSessionLookup =
  | { kind: "anonymous" }
  | { kind: "authenticated"; context: OAuthSessionContext }
  | { kind: "invalid"; message: string };

const json = (value: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(value, { ...init, headers });
};

const errorResponse = (message: string, status: number, code: string): Response =>
  json({ error: { message, code } }, { status });

const randomBase64Url = (byteLength = 32): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64ToBytes = (encoded: string): Uint8Array => {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getEncryptionKey = async (secret: string): Promise<CryptoKey> => {
  const bytes = base64ToBytes(secret);
  if (bytes.byteLength !== 32) throw new Error("OAuth session secret must contain exactly 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const encryptSession = async (session: StoredOAuthSession, secret: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(session)),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
};

const decryptSession = async (encrypted: string, secret: string): Promise<StoredOAuthSession> => {
  const [ivValue, payloadValue] = encrypted.split(".");
  if (!ivValue || !payloadValue) throw new Error("Invalid encrypted OAuth session.");
  const key = await getEncryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    key,
    base64ToBytes(payloadValue),
  );
  const session = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<StoredOAuthSession>;
  if (
    typeof session.accessToken !== "string" ||
    typeof session.expiresAt !== "number" ||
    typeof session.activeAccountId !== "string" ||
    !Array.isArray(session.accounts)
  ) {
    throw new Error("Invalid OAuth session payload.");
  }
  return session as StoredOAuthSession;
};

const getCookie = (request: Request, name: string): string | undefined => {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
};

const sessionCookie = (sessionId: string, maxAge = SESSION_TTL_SECONDS): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const stateCookie = (state: string, maxAge = STATE_TTL_SECONDS): string =>
  `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/auth/cloudflare/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const isConfigured = (env: CloudflareOAuthEnv): boolean => Boolean(
  env.AUTH_SESSIONS && env.CLOUDFLARE_OAUTH_CLIENT_ID && env.OAUTH_SESSION_SECRET,
);

const redirectUri = (request: Request): string =>
  `${new URL(request.url).origin}/api/auth/cloudflare/callback`;

const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

const saveSession = async (
  env: CloudflareOAuthEnv,
  sessionId: string,
  session: StoredOAuthSession,
): Promise<void> => {
  if (!env.AUTH_SESSIONS || !env.OAUTH_SESSION_SECRET) throw new Error("OAuth session storage is unavailable.");
  await env.AUTH_SESSIONS.put(
    `session:${sessionId}`,
    await encryptSession(session, env.OAUTH_SESSION_SECRET),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
};

const loadSession = async (
  env: CloudflareOAuthEnv,
  sessionId: string,
): Promise<StoredOAuthSession | null> => {
  if (!env.AUTH_SESSIONS || !env.OAUTH_SESSION_SECRET) return null;
  const encrypted = await env.AUTH_SESSIONS.get(`session:${sessionId}`);
  if (!encrypted) return null;
  return decryptSession(encrypted, env.OAUTH_SESSION_SECRET);
};

const tokenRequest = async (
  env: CloudflareOAuthEnv,
  fields: Record<string, string>,
): Promise<OAuthTokenResponse> => {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) throw new Error("Cloudflare OAuth is not configured.");
  const body = new URLSearchParams({ client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID, ...fields });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const result = await response.json().catch(() => ({})) as OAuthTokenResponse;
  if (!response.ok || typeof result.access_token !== "string") {
    const message = typeof result.error_description === "string"
      ? result.error_description
      : typeof result.error === "string" ? result.error : "Cloudflare rejected the OAuth token request.";
    throw new Error(message);
  }
  return result;
};

const getAccounts = async (accessToken: string): Promise<CloudflareAccount[]> => {
  const response = await fetch(`${API_ENDPOINT}/accounts?per_page=50`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as CloudflareApiResponse<Array<Partial<CloudflareAccount>>>;
  if (!response.ok || payload.success === false || !Array.isArray(payload.result)) {
    throw new Error(payload.errors?.[0]?.message || "Could not read the authorized Cloudflare accounts.");
  }
  return payload.result.flatMap((account) =>
    typeof account.id === "string" && typeof account.name === "string"
      ? [{ id: account.id, name: account.name }]
      : [],
  );
};

const refreshSession = async (
  env: CloudflareOAuthEnv,
  sessionId: string,
  session: StoredOAuthSession,
): Promise<StoredOAuthSession> => {
  if (!session.refreshToken) throw new Error("Cloudflare authorization has expired. Sign in again.");
  const result = await tokenRequest(env, {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  const refreshed: StoredOAuthSession = {
    ...session,
    accessToken: result.access_token as string,
    refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : session.refreshToken,
    expiresAt: Date.now() + (typeof result.expires_in === "number" ? result.expires_in : 3_600) * 1_000,
    scope: typeof result.scope === "string" ? result.scope : session.scope,
  };
  await saveSession(env, sessionId, refreshed);
  return refreshed;
};

const getValidSessionById = async (
  env: CloudflareOAuthEnv,
  sessionId: string,
): Promise<StoredOAuthSession | null> => {
  const session = await loadSession(env, sessionId);
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  return refreshSession(env, sessionId, session);
};

export const getOAuthSessionById = async (
  env: CloudflareOAuthEnv,
  sessionId: string,
): Promise<OAuthSessionContext | null> => {
  const session = await getValidSessionById(env, sessionId);
  if (!session) return null;
  return {
    sessionId,
    accessToken: session.accessToken,
    accountId: session.activeAccountId,
    accounts: session.accounts,
  };
};

export const getOAuthSession = async (
  request: Request,
  env: CloudflareOAuthEnv,
): Promise<OAuthSessionLookup> => {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return { kind: "anonymous" };
  if (!isConfigured(env)) return { kind: "invalid", message: "Cloudflare sign-in is unavailable." };
  try {
    const context = await getOAuthSessionById(env, sessionId);
    return context
      ? { kind: "authenticated", context }
      : { kind: "invalid", message: "Cloudflare authorization has expired. Sign in again." };
  } catch (error) {
    return {
      kind: "invalid",
      message: error instanceof Error ? error.message : "Cloudflare authorization is unavailable.",
    };
  }
};

const startAuthorization = async (request: Request, env: CloudflareOAuthEnv): Promise<Response> => {
  if (!isConfigured(env)) return errorResponse("Cloudflare OAuth is not configured.", 503, "oauth_unavailable");
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = bytesToBase64Url(new Uint8Array(digest));
  await env.AUTH_SESSIONS!.put(
    `oauth-state:${state}`,
    JSON.stringify({ verifier }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  const scopes = (env.CLOUDFLARE_OAUTH_SCOPES || "account.read workers-ai.read").trim();
  const authorizationUrl = new URL(AUTHORIZE_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri(request),
    scope: scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const headers = new Headers({ location: authorizationUrl.toString(), "cache-control": "no-store" });
  headers.append("set-cookie", stateCookie(state));
  return new Response(null, { status: 302, headers });
};

const finishAuthorization = async (request: Request, env: CloudflareOAuthEnv): Promise<Response> => {
  if (!isConfigured(env)) return errorResponse("Cloudflare OAuth is not configured.", 503, "oauth_unavailable");
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = getCookie(request, STATE_COOKIE) ?? "";
  const error = url.searchParams.get("error");
  const appRedirect = new URL("/", url.origin);
  if (error) {
    appRedirect.searchParams.set("cloudflare", "denied");
    return Response.redirect(appRedirect.toString(), 302);
  }
  if (!code || !state || state !== expectedState) {
    return errorResponse("Invalid Cloudflare OAuth callback state.", 400, "oauth_state_invalid");
  }
  const stateKey = `oauth-state:${state}`;
  const transaction = await env.AUTH_SESSIONS!.get(stateKey, "json") as { verifier?: unknown } | null;
  await env.AUTH_SESSIONS!.delete(stateKey);
  if (!transaction || typeof transaction.verifier !== "string") {
    return errorResponse("Cloudflare OAuth request expired. Try again.", 400, "oauth_state_expired");
  }

  try {
    const result = await tokenRequest(env, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request),
      code_verifier: transaction.verifier,
    });
    const accessToken = result.access_token as string;
    const accounts = await getAccounts(accessToken);
    if (!accounts.length) throw new Error("No Cloudflare account with the requested access was authorized.");
    const sessionId = randomBase64Url();
    await saveSession(env, sessionId, {
      accessToken,
      refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : undefined,
      expiresAt: Date.now() + (typeof result.expires_in === "number" ? result.expires_in : 3_600) * 1_000,
      scope: typeof result.scope === "string" ? result.scope : "",
      accounts,
      activeAccountId: accounts[0].id,
      createdAt: Date.now(),
    });
    appRedirect.searchParams.set("cloudflare", "connected");
    const headers = new Headers({ location: appRedirect.toString(), "cache-control": "no-store" });
    headers.append("set-cookie", sessionCookie(sessionId));
    headers.append("set-cookie", stateCookie("", 0));
    return new Response(null, { status: 302, headers });
  } catch (callbackError) {
    console.error("Cloudflare OAuth callback failed", {
      message: callbackError instanceof Error ? callbackError.message : "Unknown OAuth callback error",
    });
    appRedirect.searchParams.set("cloudflare", "error");
    return Response.redirect(appRedirect.toString(), 302);
  }
};

const sessionStatus = async (request: Request, env: CloudflareOAuthEnv): Promise<Response> => {
  const lookup = await getOAuthSession(request, env);
  const publicPoolConfigured = readPublicAiPoolConfig(env.PUBLIC_AI_ACCOUNTS).state === "ready";
  if (lookup.kind === "anonymous") {
    return json({ configured: isConfigured(env), authenticated: false, publicPoolConfigured });
  }
  if (lookup.kind === "invalid") {
    const response = json({
      configured: isConfigured(env),
      authenticated: false,
      publicPoolConfigured,
      error: lookup.message,
    });
    response.headers.append("set-cookie", sessionCookie("", 0));
    return response;
  }
  const activeAccount = lookup.context.accounts.find((account) => account.id === lookup.context.accountId);
  return json({
    configured: true,
    authenticated: true,
    publicPoolConfigured,
    accounts: lookup.context.accounts,
    activeAccountId: lookup.context.accountId,
    activeAccountName: activeAccount?.name || lookup.context.accountId,
  });
};

const selectAccount = async (request: Request, env: CloudflareOAuthEnv): Promise<Response> => {
  if (!isSameOrigin(request)) return errorResponse("Cross-origin account changes are not allowed.", 403, "origin_rejected");
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return errorResponse("Sign in with Cloudflare first.", 401, "oauth_required");
  const session = await getValidSessionById(env, sessionId);
  if (!session) return errorResponse("Cloudflare authorization has expired.", 401, "oauth_expired");
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  if (typeof body?.accountId !== "string" || !session.accounts.some((account) => account.id === body.accountId)) {
    return errorResponse("Select an authorized Cloudflare account.", 400, "invalid_account");
  }
  session.activeAccountId = body.accountId;
  await saveSession(env, sessionId, session);
  return json({ ok: true, activeAccountId: session.activeAccountId });
};

const logout = async (request: Request, env: CloudflareOAuthEnv): Promise<Response> => {
  if (!isSameOrigin(request)) return errorResponse("Cross-origin logout is not allowed.", 403, "origin_rejected");
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (sessionId && env.AUTH_SESSIONS) {
    const session = await loadSession(env, sessionId).catch(() => null);
    if (session) {
      const token = session.refreshToken || session.accessToken;
      const body = new URLSearchParams({ token, client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID || "" });
      await fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }).catch(() => undefined);
    }
    await env.AUTH_SESSIONS.delete(`session:${sessionId}`);
  }
  const response = json({ ok: true });
  response.headers.append("set-cookie", sessionCookie("", 0));
  return response;
};

export const handleOAuthRoute = async (
  request: Request,
  env: CloudflareOAuthEnv,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/cloudflare/start") {
    return startAuthorization(request, env);
  }
  if (request.method === "GET" && path === "/api/auth/cloudflare/callback") {
    return finishAuthorization(request, env);
  }
  if (request.method === "GET" && path === "/api/auth/session") {
    return sessionStatus(request, env);
  }
  if (request.method === "POST" && path === "/api/auth/account") {
    return selectAccount(request, env);
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    return logout(request, env);
  }
  return null;
};
