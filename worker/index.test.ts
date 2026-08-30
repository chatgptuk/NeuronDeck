import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { ChatSession } from "./index";
import { hasAdminAccount } from "./admin-stats";

const pixel = "data:image/png;base64,iVBORw0KGgo=";
const chatModel = "@cf/zai-org/glm-4.7-flash";
const imageModel = "@cf/black-forest-labs/flux-2-klein-9b";
const publicPoolAccounts = [
  { accountId: "1".repeat(32), apiToken: "a".repeat(40) },
  { accountId: "2".repeat(32), apiToken: "b".repeat(40) },
];
const oauthSecret = btoa("0123456789abcdef0123456789abcdef");

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const createOAuthSessionEnv = async (accountId: string, accessToken: string, sessionId: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    accessToken,
    expiresAt: Date.now() + 3_600_000,
    scope: "ai.read account-settings.read offline_access",
    accounts: [{ id: accountId, name: `Account ${accountId.slice(0, 4)}` }],
    activeAccountId: accountId,
    createdAt: Date.now(),
  }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  const stored = `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
  return {
    AUTH_SESSIONS: {
      get: vi.fn(async (keyName: string) => keyName === `session:${sessionId}` ? stored : null),
    },
    CLOUDFLARE_OAUTH_CLIENT_ID: "oauth-client-id",
    OAUTH_SESSION_SECRET: oauthSecret,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const createEnv = () => {
  const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: "ok" }));
  return {
    run,
    env: {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    },
  };
};

const requestFor = (model: string) =>
  new Request("https://ai.chatgpt.org.uk/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "integration-test-client",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Describe it",
          attachments: [
            { kind: "image", name: "pixel.png", mimeType: "image/png", dataUrl: pixel },
          ],
        },
      ],
    }),
  });

const textRequestFor = (model: string, maxTokens?: number, sessionId?: string) =>
  new Request("https://ai.chatgpt.org.uk/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "integration-test-client",
      ...(sessionId ? { cookie: `neurondeck_cf_session=${sessionId}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Write a useful answer" }],
      ...(maxTokens == null ? {} : { maxTokens }),
    }),
  });

describe("Cloudflare OAuth routes", () => {
  it("reports anonymous mode when OAuth is not configured", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/auth/session"),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      authenticated: false,
      publicPoolConfigured: false,
    });
  });

  it("starts a PKCE authorization without exposing a client secret", async () => {
    const { env } = createEnv();
    const put = vi.fn(async (_key: string, _value: string) => undefined);
    const oauthEnv = {
      ...env,
      AUTH_SESSIONS: { put, get: vi.fn(), delete: vi.fn() },
      CLOUDFLARE_OAUTH_CLIENT_ID: "oauth-client-id",
      CLOUDFLARE_OAUTH_SCOPES: "ai.read account-settings.read offline_access",
      OAUTH_SESSION_SECRET: btoa("0123456789abcdef0123456789abcdef"),
    };
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/auth/cloudflare/start?returnTo=/admin"),
      oauthEnv as never,
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://dash.cloudflare.com");
    expect(location.pathname).toBe("/oauth2/auth");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("client_id")).toBe("oauth-client-id");
    expect(location.searchParams.get("scope")).toBe("ai.read account-settings.read offline_access");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(put).toHaveBeenCalledOnce();
    expect(JSON.parse(String(put.mock.calls[0][1]))).toMatchObject({ returnTo: "/admin" });
  });
});

describe("private admin metrics", () => {
  it("matches only explicitly configured Cloudflare account ids", () => {
    const owner = "a".repeat(32);
    expect(hasAdminAccount([{ id: owner }], owner)).toBe(true);
    expect(hasAdminAccount([{ id: "b".repeat(32) }], owner)).toBe(false);
    expect(hasAdminAccount([{ id: owner }], undefined)).toBe(false);
  });

  it("keeps the dashboard unavailable until an administrator id is configured", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/admin/stats"),
      env as never,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "admin_unavailable" } });
  });

  it("requires Cloudflare sign-in before forwarding private statistics", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/admin/stats"),
      {
        ...env,
        ADMIN_ACCOUNT_ID: "a".repeat(32),
        METRICS_DB: {},
      } as never,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "admin_login_required" } });
  });

  it("records an anonymous browser visit without exposing it in the response", async () => {
    const prepared: Array<{ query: string; bindings: unknown[] }> = [];
    const prepare = vi.fn((query: string) => {
      const statement = {
        query,
        bindings: [] as unknown[],
        bind: (...bindings: unknown[]) => {
          statement.bindings = bindings;
          return statement;
        },
      };
      prepared.push(statement);
      return statement;
    });
    const batch = vi.fn(async () => []);
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/metrics/visit", {
        method: "POST",
        headers: {
          origin: "https://ai.chatgpt.org.uk",
          "x-neurondeck-client": "browser-client-1234",
        },
      }),
      {
        ...env,
        METRICS_DB: { prepare, batch },
      } as never,
      { waitUntil } as never,
    );
    await waitUntil.mock.calls[0][0];

    expect(response.status).toBe(204);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledTimes(2);
    expect(prepared).toHaveLength(7);
    expect(prepared[4].bindings[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared[4].bindings[0]).not.toBe("browser-client-1234");
  });
});

describe("resumable chat session routing", () => {
  it("routes a stable generation id to the same Durable Object", async () => {
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const durableFetch = vi.fn(async () => new Response(
      'id: 1\ndata: {"response":"live"}\n\nid: 2\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    const get = vi.fn(() => ({ fetch: durableFetch }));
    const idFromName = vi.fn((name: string) => `object:${name}`);
    const { env } = createEnv();
    const request = new Request(`https://ai.chatgpt.org.uk/api/chat/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://ai.chatgpt.org.uk",
        "x-neurondeck-client": "integration-test-client",
      },
      body: JSON.stringify({ model: chatModel, messages: [{ role: "user", content: "Hello" }] }),
    });

    const response = await worker.fetch(request, {
      ...env,
      CHAT_SESSIONS: { idFromName, get },
    } as never);

    expect(response.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith(sessionId);
    expect(get).toHaveBeenCalledWith(`object:${sessionId}`);
    expect(durableFetch).toHaveBeenCalledWith(request);
    expect(await response.text()).toContain("live");
  });

  it("persists real SSE events and replays them from a cursor", async () => {
    const records = new Map<string, unknown>();
    let background: Promise<unknown> | undefined;
    const storage = {
      get: vi.fn(async (key: string | string[]) => {
        if (!Array.isArray(key)) return records.get(key);
        const selected = new Map<string, unknown>();
        for (const item of key) {
          if (records.has(item)) selected.set(item, records.get(item));
        }
        return selected;
      }),
      put: vi.fn(async (key: string, value: unknown) => { records.set(key, value); }),
      setAlarm: vi.fn(async () => undefined),
      deleteAll: vi.fn(async () => { records.clear(); }),
    };
    const state = {
      storage,
      waitUntil: vi.fn((promise: Promise<unknown>) => { background = promise; }),
    };
    const run = vi.fn(async () => new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"response":"first"}\n\ndata: {"response":" second"}\n\ndata: [DONE]\n\n',
        ));
        controller.close();
      },
    }));
    const session = new ChatSession(state as never, {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const headers = {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "integration-test-client",
    };
    const initial = await session.fetch(new Request(`https://ai.chatgpt.org.uk/api/chat/sessions/${sessionId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "@cf/meta/llama-3.2-3b-instruct",
        messages: [{ role: "user", content: "Hello" }],
      }),
    }));
    const initialBody = await initial.text();
    await background;

    expect(initial.headers.get("x-neurondeck-resumable")).toBe("true");
    expect(initialBody).toContain('id: 1\ndata: {"response":"first"}');
    expect(initialBody).toContain("id: 3\ndata: [DONE]");
    expect(storage.setAlarm).toHaveBeenCalledOnce();

    const replay = await session.fetch(new Request(
      `https://ai.chatgpt.org.uk/api/chat/sessions/${sessionId}/events?cursor=1`,
      { headers: { origin: "https://ai.chatgpt.org.uk", "x-neurondeck-client": "integration-test-client" } },
    ));
    const replayBody = await replay.text();
    expect(replayBody).not.toContain('"first"');
    expect(replayBody).toContain('id: 2\ndata: {"response":" second"}');
    expect(replayBody).toContain("id: 3\ndata: [DONE]");
  });
});

describe("public Cloudflare AI account pool", () => {
  it("uses server-side public credentials for anonymous streaming requests", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        'data: {"response":"public pool"}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const { env, run } = createEnv();
    const publicLimit = vi.fn(async () => ({ success: true }));
    const response = await worker.fetch(textRequestFor(chatModel), {
      ...env,
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }),
      PUBLIC_AI_RATE_LIMITER: { limit: publicLimit },
    } as never);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("public pool");
    expect(run).not.toHaveBeenCalled();
    expect(publicLimit).toHaveBeenCalledWith({ key: "public-ai-pool" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    const authorization = new Headers(init?.headers).get("authorization");
    expect(publicPoolAccounts.some((account) => String(url).includes(`/accounts/${account.accountId}/ai/run/`))).toBe(true);
    expect(publicPoolAccounts.some((account) => authorization === `Bearer ${account.apiToken}`)).toBe(true);
    expect(body).not.toContain(publicPoolAccounts[0].accountId);
    expect(body).not.toContain(publicPoolAccounts[0].apiToken);
  });

  it("keeps an authenticated administrator on the site's public quota", async () => {
    const administratorId = "a".repeat(32);
    const administratorToken = "administrator-oauth-token";
    const sessionId = "administrator-session";
    const oauthEnv = await createOAuthSessionEnv(administratorId, administratorToken, sessionId);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('data: {"response":"admin public pool"}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { env, run } = createEnv();
    const publicLimit = vi.fn(async () => ({ success: true }));
    const completeEnv = {
      ...env,
      ...oauthEnv,
      ADMIN_ACCOUNT_ID: administratorId,
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }),
      PUBLIC_AI_RATE_LIMITER: { limit: publicLimit },
    };

    const sessionResponse = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/auth/session", {
      headers: { cookie: `neurondeck_cf_session=${sessionId}` },
    }), completeEnv as never);
    const session = await sessionResponse.json() as { authenticated: boolean; usesSiteQuota: boolean };
    const response = await worker.fetch(textRequestFor(chatModel, undefined, sessionId), completeEnv as never);
    const body = await response.text();

    expect(session).toMatchObject({ authenticated: true, usesSiteQuota: true });
    expect(response.status).toBe(200);
    expect(body).toContain("admin public pool");
    expect(run).not.toHaveBeenCalled();
    expect(publicLimit).toHaveBeenCalledWith({ key: "public-ai-pool" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    const authorization = new Headers(init?.headers).get("authorization");
    expect(String(url)).toContain(`/accounts/${publicPoolAccounts[0].accountId}/ai/run/`);
    expect(authorization).toBe(`Bearer ${publicPoolAccounts[0].apiToken}`);
    expect(authorization).not.toContain(administratorToken);
  });

  it("continues to use an authenticated non-admin account's quota", async () => {
    const userAccountId = "b".repeat(32);
    const userAccessToken = "ordinary-user-oauth-token";
    const sessionId = "ordinary-user-session";
    const oauthEnv = await createOAuthSessionEnv(userAccountId, userAccessToken, sessionId);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('data: {"response":"personal quota"}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv();
    const publicLimit = vi.fn(async () => ({ success: true }));
    const completeEnv = {
      ...env,
      ...oauthEnv,
      ADMIN_ACCOUNT_ID: "c".repeat(32),
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }),
      PUBLIC_AI_RATE_LIMITER: { limit: publicLimit },
    };

    const sessionResponse = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/auth/session", {
      headers: { cookie: `neurondeck_cf_session=${sessionId}` },
    }), completeEnv as never);
    const session = await sessionResponse.json() as { authenticated: boolean; usesSiteQuota: boolean };
    const response = await worker.fetch(textRequestFor(chatModel, undefined, sessionId), completeEnv as never);
    const body = await response.text();

    expect(session).toMatchObject({ authenticated: true, usesSiteQuota: false });
    expect(response.status).toBe(200);
    expect(body).toContain("personal quota");
    expect(publicLimit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/accounts/${userAccountId}/ai/run/`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${userAccessToken}`);
  });

  it("fails over to the next public account on quota or authorization errors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json({ success: false, errors: [{ message: "quota exceeded" }] }, { status: 429 });
      }
      return new Response('data: {"response":"fallback"}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv();
    const response = await worker.fetch(textRequestFor(chatModel), {
      ...env,
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }),
      PUBLIC_AI_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authorizations = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization"));
    expect(new Set(authorizations).size).toBe(2);
  });

  it("fails closed instead of silently billing the Worker owner when the pool secret is invalid", async () => {
    const { env, run } = createEnv();
    const response = await worker.fetch(textRequestFor(chatModel), {
      ...env,
      PUBLIC_AI_ACCOUNTS: "{invalid-json",
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "public_ai_pool_invalid" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports public quota availability without exposing pool entries", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://ai.chatgpt.org.uk/api/auth/session"),
      { ...env, PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }) } as never,
    );
    const body = await response.text();

    expect(JSON.parse(body)).toEqual({
      configured: false,
      authenticated: false,
      publicPoolConfigured: true,
    });
    for (const account of publicPoolAccounts) {
      expect(body).not.toContain(account.accountId);
      expect(body).not.toContain(account.apiToken);
    }
  });

  it("replays multipart image input safely when a public account fails over", async () => {
    const multipartBodies: Uint8Array[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const callNumber = fetchMock.mock.calls.length;
      if (callNumber === 1) {
        return new Response(
          `data: {"tool_calls":[{"id":"pool-image-call","name":"generate_image","arguments":{"prompt":"A green glass sphere","aspect_ratio":"square"}}]}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (callNumber === 2 || callNumber === 3) {
        expect(ArrayBuffer.isView(init?.body)).toBe(true);
        multipartBodies.push(new Uint8Array(
          (init?.body as ArrayBufferView).buffer,
          (init?.body as ArrayBufferView).byteOffset,
          (init?.body as ArrayBufferView).byteLength,
        ));
      }
      if (callNumber === 2) {
        return Response.json({ success: false, errors: [{ message: "capacity limit" }] }, { status: 429 });
      }
      return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env, run } = createEnv();
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [{ role: "user", content: "生成一张绿色玻璃球图片" }],
      }),
    });
    const response = await worker.fetch(request, {
      ...env,
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: publicPoolAccounts }),
      PUBLIC_AI_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(multipartBodies).toHaveLength(2);
    expect([...multipartBodies[1]]).toEqual([...multipartBodies[0]]);
    expect(body).toContain('"generated_image"');
    expect(body).toContain("data:image/png;base64");
  });
});

describe("worker multimodal requests", () => {
  it("passes structured image content to current vision models", async () => {
    const { env, run } = createEnv();
    const response = await worker.fetch(requestFor("@cf/qwen/qwen3.8-27b"), env as never);

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      "@cf/qwen/qwen3.8-27b",
      expect.objectContaining({
        messages: expect.arrayContaining([
          {
            role: "user",
            content: [
              { type: "text", text: "Describe it" },
              { type: "image_url", image_url: { url: pixel } },
            ],
          },
        ]),
      }),
    );
  });

  it("decodes Llama 3.2 vision images for its legacy input schema", async () => {
    const { env, run } = createEnv();
    const response = await worker.fetch(
      requestFor("@cf/meta/llama-3.2-11b-vision-instruct"),
      env as never,
    );

    expect(response.status).toBe(200);
    const input = run.mock.calls[0][1] as { prompt: string; image: number[] };
    expect(input.image).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(input.prompt).toContain("USER: Describe it");
    expect(input).not.toHaveProperty("messages");
  });
});

describe("worker output token policy", () => {
  it("uses the context-aware default for a 128K model", async () => {
    const { env, run } = createEnv();
    await worker.fetch(textRequestFor("@cf/zai-org/glm-4.7-flash"), env as never);
    expect(run.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ max_tokens: 8_192 }));
  });

  it("allows a larger bounded output for a 1M model", async () => {
    const { env, run } = createEnv();
    await worker.fetch(textRequestFor("@cf/deepseek-ai/deepseek-v4-pro-0813", 999_999), env as never);
    expect(run.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ max_tokens: 65_536 }));
  });
});

describe("speech synthesis API", () => {
  const requestForSpeech = (body: Record<string, unknown>) => new Request("https://ai.chatgpt.org.uk/api/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "speech-test-client",
    },
    body: JSON.stringify(body),
  });

  it("streams Aura-2 English audio with a curated speaker", async () => {
    const run = vi.fn(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([73, 68, 51, 4]));
        controller.close();
      },
    }));
    const response = await worker.fetch(requestForSpeech({
      model: "@cf/deepgram/aura-2-en",
      language: "en",
      text: "Thanks for calling. Your order shipped yesterday.",
    }), {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      TTS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-neurondeck-tts-model")).toBe("@cf/deepgram/aura-2-en");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([73, 68, 51, 4]);
    expect(run).toHaveBeenCalledWith("@cf/deepgram/aura-2-en", {
      text: "Thanks for calling. Your order shipped yesterday.",
      speaker: "luna",
      encoding: "mp3",
    });
  });

  it("labels WAV bytes returned by a speech binding correctly", async () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    ]);
    const response = await worker.fetch(requestForSpeech({
      model: "@cf/deepgram/aura-2-en",
      language: "en",
      text: "Hello.",
    }), {
      AI: { run: vi.fn(async () => wav), toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      TTS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-disposition")).toContain("neurondeck-speech.wav");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...wav]);
  });

  it("retries transient Workers AI 3043 speech failures", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("3043: Internal server error"))
      .mockResolvedValueOnce(Uint8Array.from([73, 68, 51, 4]));
    const response = await worker.fetch(requestForSpeech({
      model: "@cf/deepgram/aura-2-en",
      language: "en",
      text: "Hello.",
    }), {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      TTS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects the broken hosted MeloTTS model before inference", async () => {
    const run = vi.fn();
    const response = await worker.fetch(requestForSpeech({
      model: "@cf/myshell-ai/melotts",
      language: "zh",
      text: "你好",
    }), {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      TTS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_tts_model" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a language that does not match an Aura-2 variant", async () => {
    const run = vi.fn();
    const response = await worker.fetch(requestForSpeech({
      model: "@cf/deepgram/aura-2-en",
      language: "zh",
      text: "你好",
    }), {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      TTS_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_tts_language" } });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("chat streaming", () => {
  it("keeps non-tool model output genuinely streamed until the upstream response ends", async () => {
    let finishStream: (() => void) | undefined;
    const model = "@cf/google/gemma-2b-it-lora";
    const run = vi.fn(async () => new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response":"first"}\n\n'));
        finishStream = () => {
          controller.enqueue(new TextEncoder().encode(
            'data: {"response":"second"}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
          ));
          controller.close();
        };
      },
    }));
    const response = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Stream this response" }],
      }),
    }), {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toContain('"first"');
    expect(first.done).toBe(false);

    finishStream?.();
    while (!(await reader.read()).done) {
      // Drain the real upstream stream to verify it remains incremental through completion.
    }
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("image generation function calling", () => {
  it("uses the real previous image pixels for edit requests and transparently selects FLUX.2 Dev", async () => {
    const devModel = "@cf/black-forest-labs/flux-2-dev";
    const imageCalls: Array<Record<string, unknown>> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        if (model === chatModel) {
          return {
            choices: [{ message: { tool_calls: [{
              id: "edit-image-call",
              type: "function",
              function: {
                name: "generate_image",
                arguments: JSON.stringify({
                  prompt: "Keep the same cat and change the scene to a candid iPhone photo",
                  aspect_ratio: "portrait",
                  operation: "edit",
                  reference_image_ids: ["source-cat"],
                }),
              },
            }] } }],
          };
        }
        imageCalls.push(input);
        return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
      }),
      toMarkdown: vi.fn(),
    };
    const response = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [
          { role: "user", content: "画一只猫" },
          {
            role: "assistant",
            content: "已经画好了。",
            retainedImageContext: {
              imageId: "source-cat",
              modelName: "FLUX.2 Klein 9B",
              prompt: "A tabby cat in warm light",
              width: 1024,
              height: 1024,
            },
          },
          { role: "user", content: "把上一张改成 iPhone 随手拍风格" },
        ],
        imageReferences: [{
          id: "source-cat",
          dataUrl: pixel,
          prompt: "A tabby cat in warm light",
        }],
      }),
    }), {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);
    const body = await response.text();

    expect(ai.run.mock.calls.map((call) => call[0])).toEqual([chatModel, devModel]);
    expect(imageCalls).toHaveLength(1);
    const multipart = imageCalls[0].multipart as { body: ReadableStream; contentType: string };
    expect(multipart.contentType).toContain("multipart/form-data");
    const multipartText = await new Response(multipart.body).text();
    expect(multipartText).toContain("Keep the same cat and change the scene to a candid iPhone photo");
    expect(multipartText).toContain('name="input_image_0"');
    expect(body).toContain('"operation":"edit"');
    expect(body).toContain('"sourceImageIds":["source-cat"]');
    expect(body).toContain('"modelId":"@cf/black-forest-labs/flux-2-dev"');
  });

  it("streams an ordinary tool-model reply from the first and only inference", async () => {
    let finishStream: (() => void) | undefined;
    const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"response":"第一段"}\n\n'));
          finishStream = () => {
            controller.enqueue(new TextEncoder().encode('data: {"response":"第二段"}\n\ndata: [DONE]\n\n'));
            controller.close();
          };
        },
      }));
    const env = {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-neurondeck-client": "test-client-1234" },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: "请生成一个 TypeScript 函数来解释浏览器的事件循环" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toContain("第一段");
    expect(first.done).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][1]).toEqual(expect.objectContaining({
      stream: true,
      tool_choice: "auto",
    }));
    expect(run.mock.calls[0][1]).toHaveProperty("tools");

    finishStream?.();
    await reader.cancel();
  });

  it("assembles a streamed tool call before invoking the selected image model", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_image_1","type":"function","function":{"name":"generate_image","arguments":"{\\"prompt\\":\\"A quiet glass"}}]}}]}\n\n',
            ));
            controller.enqueue(new TextEncoder().encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" greenhouse at dawn\\",\\"aspect_ratio\\":\\"landscape\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
            ));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [{ role: "user", content: "给我设计一张安静的温室插画" }],
        temperature: 0.7,
        maxTokens: 4096,
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(calls.map((call) => call.model)).toEqual([chatModel, imageModel]);
    expect(calls[0].input.tools).toBeTruthy();
    expect(calls[0].input.stream).toBe(true);
    expect(JSON.stringify(calls[0].input.tools)).toContain("semantic intent");
    expect(calls[1].input).toHaveProperty("multipart");
    expect(body).toContain('"status":"generating"');
    expect(body).toContain('"modelId":"@cf/black-forest-labs/flux-2-klein-9b"');
    expect(body).toContain('"dataUrl":"data:image/png;base64,iVBOR');
    expect(body).toMatch(/"elapsedMs":\d+/);
    expect(body).toContain('"done":true');
    expect(body).not.toContain("tool_calls");
  });

  it("runs FLUX.2 Dev as a durable workflow and returns the stored result URL", async () => {
    const devModel = "@cf/black-forest-labs/flux-2-dev";
    const ai = {
      run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
        if (input.tools) {
          return {
            choices: [{
              message: {
                tool_calls: [{
                  id: "dev-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({ prompt: "A silver lake at dawn", aspect_ratio: "landscape" }),
                  },
                }],
              },
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"图片完成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const create = vi.fn(async (options: { id: string; params: Record<string, string> }) => ({
      id: options.id,
      status: vi.fn(async () => ({
        status: "complete",
        output: {
          ...options.params,
          elapsedMs: 95_000,
          height: 768,
          mimeType: "image/png",
          modelName: "FLUX.2 Dev",
          objectKey: `image-jobs/${options.id}`,
          seed: 42,
          width: 1344,
        },
      })),
    }));
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      IMAGE_WORKFLOW: { create, get: vi.fn() },
      IMAGE_RESULTS: { get: vi.fn(), put: vi.fn() },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel: devModel,
        messages: [{ role: "user", content: "生成一张黎明湖面的图片" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(create).toHaveBeenCalledOnce();
    expect(ai.run.mock.calls.map((call) => call[0])).toEqual([chatModel]);
    expect(body).toContain('"jobId"');
    expect(body).toContain('"modelId":"@cf/black-forest-labs/flux-2-dev"');
    expect(body).toMatch(/"dataUrl":"\/api\/image-jobs\/[0-9a-f-]+\/image\.png\?token=[a-f0-9]+"/);
    expect(body).toContain('"elapsedMs":95000');
  });

  it("returns FLUX.2 Dev directly when durable image bindings are not configured", async () => {
    const devModel = "@cf/black-forest-labs/flux-2-dev";
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        if (input.tools) {
          return {
            choices: [{
              message: {
                tool_calls: [{
                  id: "direct-dev-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({ prompt: "A direct silver lake", aspect_ratio: "square" }),
                  },
                }],
              },
            }],
          };
        }
        if (model === devModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"直接返回完成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const response = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel: devModel,
        messages: [{ role: "user", content: "生成一张银色湖面的图片" }],
      }),
    }), {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as never);
    const body = await response.text();

    expect(ai.run.mock.calls.map((call) => call[0])).toEqual([chatModel, devModel]);
    expect(body).toContain('"dataUrl":"data:image/png;base64,iVBOR');
    expect(body).not.toContain('"jobId"');
    expect(body).toContain('"done":true');
  });

  it("falls back to a direct FLUX.2 Dev response when R2 persistence fails", async () => {
    const devModel = "@cf/black-forest-labs/flux-2-dev";
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        if (input.tools) {
          return {
            choices: [{
              message: {
                tool_calls: [{
                  id: "r2-fallback-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({ prompt: "A lake after R2 failure", aspect_ratio: "landscape" }),
                  },
                }],
              },
            }],
          };
        }
        if (model === devModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"回退生图完成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const create = vi.fn(async (options: { id: string }) => ({
      id: options.id,
      status: vi.fn(async () => ({
        status: "errored",
        error: { message: "IMAGE_PERSISTENCE_UNAVAILABLE: R2 subscription is not enabled." },
      })),
    }));
    const response = await worker.fetch(new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel: devModel,
        messages: [{ role: "user", content: "生成一张湖面照片" }],
      }),
    }), {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      IMAGE_WORKFLOW: { create, get: vi.fn() },
      IMAGE_RESULTS: { get: vi.fn(), put: vi.fn() },
    } as never);
    const body = await response.text();

    expect(create).toHaveBeenCalledOnce();
    expect(ai.run.mock.calls.map((call) => call[0])).toEqual([chatModel, devModel]);
    expect(body).toContain('"dataUrl":"data:image/png;base64,iVBOR');
    expect(body).toContain('"done":true');
  });

  it("passes only an opaque pool seed to FLUX.2 Dev workflows", async () => {
    const devModel = "@cf/black-forest-labs/flux-2-dev";
    const publicAccount = publicPoolAccounts[0];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json({
          success: true,
          result: {
            choices: [{
              message: {
                tool_calls: [{
                  id: "public-dev-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({ prompt: "A public pool lake", aspect_ratio: "square" }),
                  },
                }],
              },
            }],
          },
        });
      }
      return new Response('data: {"response":"公共池图片完成。"}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const create = vi.fn(async (options: { id: string; params: Record<string, string | undefined> }) => ({
      id: options.id,
      status: vi.fn(async () => ({
        status: "complete",
        output: {
          ...options.params,
          elapsedMs: 80_000,
          height: 1024,
          mimeType: "image/png",
          modelName: "FLUX.2 Dev",
          objectKey: `image-jobs/${options.id}`,
          seed: 9,
          width: 1024,
        },
      })),
    }));
    const ownerRun = vi.fn();
    const env = {
      AI: { run: ownerRun, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      PUBLIC_AI_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      PUBLIC_AI_ACCOUNTS: JSON.stringify({ accounts: [publicAccount] }),
      IMAGE_WORKFLOW: { create, get: vi.fn() },
      IMAGE_RESULTS: { get: vi.fn(), put: vi.fn() },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel: devModel,
        messages: [{ role: "user", content: "生成一张公共池湖面图片" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();
    const workflowParams = create.mock.calls[0][0].params;

    expect(response.status).toBe(200);
    expect(ownerRun).not.toHaveBeenCalled();
    expect(workflowParams.publicPoolSeed).toBe("test-client-1234");
    expect(workflowParams.oauthSessionId).toBeUndefined();
    expect(JSON.stringify(workflowParams)).not.toContain(publicAccount.accountId);
    expect(JSON.stringify(workflowParams)).not.toContain(publicAccount.apiToken);
    expect(body).not.toContain(publicAccount.accountId);
    expect(body).not.toContain(publicAccount.apiToken);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects image model ids outside the curated Cloudflare-hosted list", async () => {
    const env = {
      AI: { run: vi.fn(), toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        imageModel: "@cf/unknown/image-model",
        messages: [{ role: "user", content: "生成一张图" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_image_model" } });
  });

  it("uses an automatic semantic tool call for a non-keyword image follow-up", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        if (input.tool_choice === "auto") {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "corrective-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({
                      prompt: "A new candid street portrait in warm autumn light",
                      aspect_ratio: "portrait",
                    }),
                  },
                }],
              },
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"这次已真正生成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [
          { role: "user", content: "画一张秋日街拍" },
          { role: "assistant", content: "上一张已经完成。" },
          { role: "user", content: "让它有那种雨后老电影的感觉" },
        ],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls.map((call) => call.model)).toEqual([chatModel, imageModel]);
    expect(calls[0].input.tool_choice).toBe("auto");
    expect(JSON.stringify(calls[0].input.messages)).toContain("referential follow-up");
    expect(body).toContain('"status":"generating"');
    expect(body).toContain('"generated_image"');
    expect(body).toMatch(/"elapsedMs":\d+/);
  });
  it("treats a short second-turn subject request as a real image tool call", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        if (input.tool_choice === "auto") {
          return {
            choices: [{
              message: {
                tool_calls: [{
                  id: "tabby-cat-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({
                      prompt: "A majestic Chinese Li Hua tabby cat",
                      aspect_ratio: "square",
                    }),
                  },
                }],
              },
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"狸花猫图片已经生成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [
          { role: "user", content: "画一只可爱的猫" },
          {
            role: "assistant",
            content: "上一张猫咪图片已经完成。",
            retainedImageContext: {
              modelName: "FLUX.2 Klein 9B",
              prompt: "An adorable fluffy orange cat",
              width: 1024,
              height: 1024,
            },
          },
          { role: "user", content: "我要狸花猫" },
        ],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls.map((call) => call.model)).toEqual([chatModel, imageModel]);
    expect(calls[0].input.tool_choice).toBe("auto");
    expect(JSON.stringify(calls[0].input.messages)).toContain("An adorable fluffy orange cat");
    expect(body).toContain('"generated_image"');
    expect(body).not.toContain("Internal application context");
    expect(body).not.toContain("Retained image-tool context");
  });
  it("treats an image style change phrased with 改为 as a GLM 5.3 tool call", async () => {
    const glm53Model = "@cf/zai-org/glm-5.3-flash";
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        if (input.tool_choice === "auto") {
          return {
            choices: [{
              message: {
                tool_calls: [{
                  id: "iphone-style-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({
                      prompt: "A candid iPhone photograph of the same fluffy cat in natural light",
                      aspect_ratio: "square",
                    }),
                  },
                }],
              },
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"已按 iPhone 拍摄风格重新生成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: glm53Model,
        imageModel,
        messages: [
          { role: "user", content: "画一只可爱的猫" },
          {
            role: "assistant",
            content: "上一张猫咪图片已经完成。",
            retainedImageContext: {
              modelName: "FLUX.2 Klein 9B",
              prompt: "An adorable fluffy cat in warm sunlight",
              width: 1024,
              height: 1024,
            },
          },
          { role: "user", content: "改为iPhone拍摄风格" },
        ],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls.map((call) => call.model)).toEqual([glm53Model, imageModel]);
    expect(calls[0].input.tool_choice).toBe("auto");
    expect(JSON.stringify(calls[0].input.messages)).toContain("An adorable fluffy cat in warm sunlight");
    expect(body).toContain('"status":"generating"');
    expect(body).toContain('"generated_image"');
    expect(body).toContain('"done":true');
  });
  it("lets the AI answer an image-related question without a keyword fallback", async () => {
    const glm53Model = "@cf/zai-org/glm-5.3-flash";
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"这是自然光摄影风格。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: glm53Model,
        imageModel,
        messages: [
          { role: "user", content: "画一只可爱的猫" },
          {
            role: "assistant",
            content: "上一张猫咪图片已经完成。",
            retainedImageContext: {
              modelName: "FLUX.2 Klein 9B",
              prompt: "An adorable fluffy cat in warm sunlight",
              width: 1024,
              height: 1024,
            },
          },
          { role: "user", content: "“改为 iPhone 拍摄风格”是什么意思？" },
        ],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(glm53Model);
    expect(calls[0].input.tool_choice).toBe("auto");
    expect(calls[0].input.tools).toBeTruthy();
    expect(calls[0].input.stream).toBe(true);
    expect(body).not.toContain('"generated_image"');
    expect(body).toContain("这是自然光摄影风格。");
  });
  it("does not use server keywords when the model omits a requested tool call", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"I will make that image."}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [{ role: "user", content: "生成一张玻璃质感的蓝色小鸟图片" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls.map((call) => call.model)).toEqual([chatModel]);
    expect(calls[0].input.tools).toBeTruthy();
    expect(calls[0].input.stream).toBe(true);
    expect(body).not.toContain('"generated_image"');
    expect(body).toContain("I will make that image.");
  });
});

describe("durable image job API", () => {
  it("returns a completed workflow image only to its originating client", async () => {
    const jobId = "11111111-2222-4333-8444-555555555555";
    const output = {
      accessToken: "0123456789abcdef0123456789abcdef",
      clientId: "integration-test-client",
      elapsedMs: 120_000,
      height: 1024,
      jobId,
      mimeType: "image/webp",
      modelId: "@cf/black-forest-labs/flux-2-dev",
      modelName: "FLUX.2 Dev",
      objectKey: `image-jobs/${jobId}`,
      prompt: "A patient cloud",
      seed: 7,
      width: 1024,
    };
    const env = {
      AI: { run: vi.fn(), toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      IMAGE_WORKFLOW: {
        create: vi.fn(),
        get: vi.fn(async () => ({ status: vi.fn(async () => ({ status: "complete", output })) })),
      },
      IMAGE_RESULTS: { get: vi.fn(), put: vi.fn() },
    };
    const request = new Request(`https://ai.chatgpt.org.uk/api/image-jobs/${jobId}`, {
      headers: { "x-neurondeck-client": "integration-test-client" },
    });

    const response = await worker.fetch(request, env as never);
    await expect(response.json()).resolves.toMatchObject({
      status: "complete",
      image: {
        id: jobId,
        dataUrl: `/api/image-jobs/${jobId}/image.webp?token=${output.accessToken}`,
        elapsedMs: 120_000,
      },
    });
  });
});
