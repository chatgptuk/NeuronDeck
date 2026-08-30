import {
  orderPublicAiAccounts,
  type PublicAiAccountCredential,
} from "./public-ai-pool";

export const BROWSER_RUN_MODEL_ID = "browser-run/markdown";
export const BROWSER_SCREENSHOT_MODEL_ID = "browser-run/screenshot";
export const MAX_WEB_CONTENT_CHARACTERS = 16_000;

const BROWSER_REQUEST_TIMEOUT_MS = 45_000;
const QUICK_ACTION_TIMEOUT_MS = 25_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export interface WebSource {
  title: string;
  url: string;
  domain: string;
}

export interface BrowserRunResult {
  markdown: string;
  elapsedMs: number;
  browserMs: number;
  accountId: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSource[];
  elapsedMs: number;
  browserMs: number;
}

export interface BrowserScreenshotResult {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  elapsedMs: number;
  browserMs: number;
  accountId: string;
}

export interface BrowserScreenshotOptions {
  fullPage: boolean;
  viewport: "desktop" | "mobile";
}

export class BrowserRunError extends Error {
  readonly code: "invalid_url" | "permission" | "rate_limited" | "timeout" | "unavailable";
  readonly retryable: boolean;

  constructor(
    message: string,
    code: BrowserRunError["code"],
    retryable = false,
  ) {
    super(message);
    this.name = "BrowserRunError";
    this.code = code;
    this.retryable = retryable;
  }
}

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
};

const isPrivateIpv6 = (hostname: string): boolean => {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value)) return true;
  const mappedIpv4 = value.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
};

export const validatePublicWebUrl = (input: string): URL => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BrowserRunError("The requested webpage URL is invalid.", "invalid_url");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
    throw new BrowserRunError("Only public HTTP and HTTPS webpages can be opened.", "invalid_url");
  }
  if (url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new BrowserRunError("Authenticated URLs and unusual ports are not allowed.", "invalid_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const blockedName = hostname === "localhost" || hostname === "metadata.google.internal" ||
    hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    hostname.endsWith(".internal") || hostname.endsWith(".home.arpa");
  if (blockedName || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new BrowserRunError("Private and local network addresses cannot be opened.", "invalid_url");
  }
  url.hash = "";
  return url;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const allowedTargetPattern = (url: URL): string => {
  const hostname = escapeRegex(url.hostname);
  const port = url.port ? `:${escapeRegex(url.port)}` : "(?::(?:80|443))?";
  return `^https?:\\/\\/${hostname}${port}(?:\\/|$)`;
};

const readBrowserErrorMessage = async (response: Response): Promise<string> => {
  const data = await response.json().catch(() => null) as
    | { errors?: Array<{ message?: unknown }>; messages?: Array<{ message?: unknown }> }
    | null;
  const message = [...(data?.errors ?? []), ...(data?.messages ?? [])]
    .map((entry) => typeof entry.message === "string" ? entry.message : "")
    .find(Boolean);
  return message || `Browser Run returned HTTP ${response.status}.`;
};

const browserErrorForResponse = async (response: Response): Promise<BrowserRunError> => {
  const providerMessage = await readBrowserErrorMessage(response);
  if (response.status === 401 || response.status === 403) {
    return new BrowserRunError(
      "Browser Run permission is unavailable. Add the account-level Browser Rendering - Edit permission to this public AI token.",
      "permission",
    );
  }
  if (response.status === 429) {
    return new BrowserRunError("Browser Run is temporarily rate limited. Please try again shortly.", "rate_limited", true);
  }
  return new BrowserRunError(
    `Browser Run could not open the page (${providerMessage.slice(0, 240)}).`,
    "unavailable",
    response.status >= 500,
  );
};

const extractMarkdown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.markdown === "string") return record.markdown;
  if (typeof record.content === "string") return record.content;
  return "";
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const screenshotBytesFromPayload = (value: unknown): { bytes: Uint8Array; mimeType: BrowserScreenshotResult["mimeType"] } => {
  const screenshot = typeof value === "string"
    ? value
    : value && typeof value === "object" && typeof (value as { screenshot?: unknown }).screenshot === "string"
      ? (value as { screenshot: string }).screenshot
      : "";
  const dataUrl = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(screenshot);
  const bytes = base64ToBytes(dataUrl?.[2] ?? screenshot);
  return {
    bytes,
    mimeType: (dataUrl?.[1] as BrowserScreenshotResult["mimeType"] | undefined) ?? "image/png",
  };
};

const pngDimensions = (bytes: Uint8Array): { width: number; height: number } | undefined => {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

export const runBrowserScreenshot = async (
  credential: PublicAiAccountCredential,
  inputUrl: string,
  options: BrowserScreenshotOptions,
  externalSignal?: AbortSignal,
): Promise<BrowserScreenshotResult> => {
  const url = validatePublicWebUrl(inputUrl);
  const requestedViewport = options.viewport === "mobile"
    ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true }
    : { width: 1280, height: 800, deviceScaleFactor: 1 };
  const startedAt = Date.now();
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort();
  if (externalSignal?.aborted) abortController.abort();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => abortController.abort(), BROWSER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${credential.accountId}/browser-rendering/screenshot`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: url.href,
          screenshotOptions: { fullPage: options.fullPage, type: "png" },
          viewport: requestedViewport,
          gotoOptions: { waitUntil: "networkidle2", timeout: QUICK_ACTION_TIMEOUT_MS },
          actionTimeout: QUICK_ACTION_TIMEOUT_MS,
          bestAttempt: true,
          allowRequestPattern: [allowedTargetPattern(url)],
        }),
        signal: abortController.signal,
      },
    );
    if (!response.ok) throw await browserErrorForResponse(response);
    const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    let normalized: { bytes: Uint8Array; mimeType: BrowserScreenshotResult["mimeType"] };
    if (contentType.startsWith("image/")) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      normalized = {
        bytes,
        mimeType: contentType === "image/jpeg" || contentType === "image/webp" ? contentType : "image/png",
      };
    } else {
      const envelope = await response.json() as { success?: unknown; result?: unknown };
      if (envelope.success === false) throw new BrowserRunError("Browser Run could not capture the webpage.", "unavailable", true);
      normalized = screenshotBytesFromPayload(envelope.result);
    }
    if (!normalized.bytes.length || normalized.bytes.length > MAX_SCREENSHOT_BYTES) {
      throw new BrowserRunError("The webpage screenshot was empty or too large.", "unavailable");
    }
    const dimensions = pngDimensions(normalized.bytes) ?? requestedViewport;
    return {
      ...normalized,
      width: dimensions.width,
      height: dimensions.height,
      elapsedMs: Math.max(1, Date.now() - startedAt),
      browserMs: Math.max(0, Number(response.headers.get("x-browser-ms-used")) || 0),
      accountId: credential.accountId,
    };
  } catch (error) {
    if (error instanceof BrowserRunError) throw error;
    if (abortController.signal.aborted) {
      throw new BrowserRunError("Browser Run timed out and the screenshot request was released.", "timeout", true);
    }
    throw new BrowserRunError("Browser Run could not capture the webpage.", "unavailable", true);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
};

export const runBrowserScreenshotWithPool = async (
  accounts: readonly PublicAiAccountCredential[],
  seed: string,
  url: string,
  options: BrowserScreenshotOptions,
  signal?: AbortSignal,
): Promise<BrowserScreenshotResult> => {
  const ordered = orderPublicAiAccounts(accounts, seed);
  let lastError: BrowserRunError | undefined;
  for (const account of ordered) {
    try {
      return await runBrowserScreenshot(account, url, options, signal);
    } catch (error) {
      lastError = error instanceof BrowserRunError
        ? error
        : new BrowserRunError("Browser Run could not capture the webpage.", "unavailable", true);
      if (!lastError.retryable && lastError.code !== "permission") throw lastError;
    }
  }
  throw lastError ?? new BrowserRunError("No public Browser Run account is configured.", "unavailable");
};

export const runBrowserMarkdown = async (
  credential: PublicAiAccountCredential,
  inputUrl: string,
  externalSignal?: AbortSignal,
): Promise<BrowserRunResult> => {
  const url = validatePublicWebUrl(inputUrl);
  const startedAt = Date.now();
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort();
  if (externalSignal?.aborted) abortController.abort();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => abortController.abort(), BROWSER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${credential.accountId}/browser-rendering/markdown?cacheTTL=300`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: url.href,
          gotoOptions: { waitUntil: "domcontentloaded", timeout: QUICK_ACTION_TIMEOUT_MS },
          actionTimeout: QUICK_ACTION_TIMEOUT_MS,
          bestAttempt: true,
          rejectResourceTypes: ["image", "media", "font", "stylesheet"],
          allowRequestPattern: [allowedTargetPattern(url)],
        }),
        signal: abortController.signal,
      },
    );
    if (!response.ok) throw await browserErrorForResponse(response);
    const envelope = await response.json() as { success?: unknown; result?: unknown };
    const markdown = extractMarkdown(envelope.result);
    if (envelope.success === false || !markdown.trim()) {
      throw new BrowserRunError("Browser Run returned an empty webpage.", "unavailable", true);
    }
    return {
      markdown: markdown.trim().slice(0, MAX_WEB_CONTENT_CHARACTERS),
      elapsedMs: Math.max(1, Date.now() - startedAt),
      browserMs: Math.max(0, Number(response.headers.get("x-browser-ms-used")) || 0),
      accountId: credential.accountId,
    };
  } catch (error) {
    if (error instanceof BrowserRunError) throw error;
    if (abortController.signal.aborted) {
      throw new BrowserRunError("Browser Run timed out and the request was released.", "timeout", true);
    }
    throw new BrowserRunError("Browser Run is temporarily unavailable.", "unavailable", true);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
};

export const runBrowserMarkdownWithPool = async (
  accounts: readonly PublicAiAccountCredential[],
  seed: string,
  url: string,
  signal?: AbortSignal,
): Promise<BrowserRunResult> => {
  const ordered = orderPublicAiAccounts(accounts, seed);
  let lastError: BrowserRunError | undefined;
  for (const account of ordered) {
    try {
      return await runBrowserMarkdown(account, url, signal);
    } catch (error) {
      lastError = error instanceof BrowserRunError
        ? error
        : new BrowserRunError("Browser Run is temporarily unavailable.", "unavailable", true);
      if (!lastError.retryable && lastError.code !== "permission") throw lastError;
    }
  }
  throw lastError ?? new BrowserRunError("No public Browser Run account is configured.", "unavailable");
};

const decodeDuckDuckGoUrl = (input: string): string => {
  try {
    const url = new URL(input.replace(/&amp;/g, "&"));
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) {
      const destination = url.searchParams.get("uddg");
      if (destination) return decodeURIComponent(destination);
    }
    return url.href;
  } catch {
    return "";
  }
};

export const parseDuckDuckGoResults = (markdown: string): WebSource[] => {
  const results: WebSource[] = [];
  const seen = new Set<string>();
  const pattern = /\[([^\]\n]{2,240})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const decoded = decodeDuckDuckGoUrl(match[2]);
    if (!decoded) continue;
    let url: URL;
    try {
      url = validatePublicWebUrl(decoded);
    } catch {
      continue;
    }
    if (url.hostname.endsWith("duckduckgo.com") || seen.has(url.href)) continue;
    const title = match[1].replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(url.href);
    results.push({ title, url: url.href, domain: url.hostname.replace(/^www\./, "") });
    if (results.length >= MAX_SEARCH_RESULTS) break;
  }
  return results;
};

export const searchWebWithBrowserRun = async (
  accounts: readonly PublicAiAccountCredential[],
  seed: string,
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult> => {
  const normalizedQuery = query.trim().slice(0, 300);
  if (!normalizedQuery) throw new BrowserRunError("A non-empty search query is required.", "invalid_url");
  const result = await runBrowserMarkdownWithPool(
    accounts,
    seed,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`,
    signal,
  );
  return {
    query: normalizedQuery,
    results: parseDuckDuckGoResults(result.markdown),
    elapsedMs: result.elapsedMs,
    browserMs: result.browserMs,
  };
};
