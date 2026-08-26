import catalog from "../src/data/models.generated.json";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  AI: unknown;
  ASSETS: Fetcher;
  CHAT_RATE_LIMITER: RateLimiter;
}

interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatBody {
  model?: unknown;
  messages?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
}

const modelIds = new Set(catalog.models.map((model) => model.id));
const MAX_MESSAGES = 48;
const MAX_TOTAL_CHARACTERS = 120_000;
const MAX_OUTPUT_TOKENS = 8192;

const json = (data: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "no-store");
  return Response.json(data, { ...init, headers });
};

const apiError = (message: string, status: number, code: string): Response =>
  json({ error: { message, code } }, { status });

const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};

const parseMessages = (messages: unknown): ApiMessage[] | null => {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return null;
  }

  let totalCharacters = 0;
  const parsed: ApiMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") return null;
    const { role, content } = message as Record<string, unknown>;
    if (!(["system", "user", "assistant"] as unknown[]).includes(role)) return null;
    if (typeof content !== "string" || !content.trim() || content.length > 32_000) return null;
    totalCharacters += content.length;
    if (totalCharacters > MAX_TOTAL_CHARACTERS) return null;
    parsed.push({ role: role as ApiMessage["role"], content });
  }
  return parsed;
};

const handleChat = async (request: Request, env: Env): Promise<Response> => {
  if (!isSameOrigin(request)) {
    return apiError("Cross-origin AI requests are not allowed.", 403, "origin_rejected");
  }

  const clientId = request.headers.get("x-neurondeck-client") ?? "anonymous";
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const rateKey = `${ip}:${/^[a-zA-Z0-9_-]{8,64}$/.test(clientId) ? clientId : "invalid"}`;
  const rateLimit = await env.CHAT_RATE_LIMITER.limit({ key: rateKey });
  if (!rateLimit.success) {
    return apiError("Too many generations. Please wait a minute and try again.", 429, "rate_limited");
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return apiError("The request body must be valid JSON.", 400, "invalid_json");
  }

  if (typeof body.model !== "string" || !modelIds.has(body.model)) {
    return apiError("Select a supported Cloudflare-hosted chat model.", 400, "invalid_model");
  }

  const messages = parseMessages(body.messages);
  if (!messages) {
    return apiError("The conversation is empty, too large, or contains invalid messages.", 400, "invalid_messages");
  }

  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.6;
  const maxTokens =
    typeof body.maxTokens === "number" && Number.isInteger(body.maxTokens)
      ? Math.min(MAX_OUTPUT_TOKENS, Math.max(64, body.maxTokens))
      : 2048;

  try {
    const ai = env.AI as {
      run(model: string, input: Record<string, unknown>): Promise<unknown>;
    };
    const result = await ai.run(body.model, {
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    const headers = new Headers({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });

    if (result instanceof ReadableStream) {
      return new Response(result, { headers });
    }

    const payload =
      result && typeof result === "object" && "response" in result
        ? result
        : { response: typeof result === "string" ? result : JSON.stringify(result) };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workers AI inference failed.";
    console.error("Workers AI inference failed", {
      model: body.model,
      message,
    });
    const userMessage = /paid|billing|credit/i.test(message)
      ? "This model requires Workers Paid or available AI Gateway credits."
      : /limit|quota|capacity/i.test(message)
        ? "Cloudflare AI capacity or quota is temporarily unavailable. Please try again shortly."
        : "The selected model could not complete this request. Try again or choose another model.";
    return apiError(userMessage, 502, "inference_failed");
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      if (!isSameOrigin(request)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          allow: "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-neurondeck-client",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "neurondeck",
        modelCount: catalog.models.length,
        catalogSyncedAt: catalog.syncedAt,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      const response = json({
        models: catalog.models,
        count: catalog.models.length,
        syncedAt: catalog.syncedAt,
      });
      response.headers.set("cache-control", "public, max-age=900, stale-while-revalidate=3600");
      return response;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return apiError("API route not found.", 404, "not_found");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
