import catalog from "../src/data/models.generated.json";
import { buildAiMessages, parseApiMessages } from "../src/lib/chat-input";
import { clampOutputTokens, getOutputTokenPolicyForModel } from "../src/lib/output-tokens";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  AI: unknown;
  ASSETS: Fetcher;
  CHAT_RATE_LIMITER: RateLimiter;
}

interface ChatBody {
  model?: unknown;
  messages?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
}

const modelIds = new Set(catalog.models.map((model) => model.id));
const visionModelIds = new Set(
  catalog.models.filter((model) => (model.capabilities as string[]).includes("vision")).map((model) => model.id),
);
const LEGACY_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_CONVERT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CONVERTED_CHARACTERS = 40_000;
const convertibleExtensions = new Set([
  "pdf", "html", "htm", "xml", "xlsx", "xlsm", "xlsb", "xls", "et", "docx", "ods", "odt", "numbers",
]);

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

const getRateKey = (request: Request, prefix: string): string => {
  const clientId = request.headers.get("x-neurondeck-client") ?? "anonymous";
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  return `${prefix}:${ip}:${/^[a-zA-Z0-9_-]{8,64}$/.test(clientId) ? clientId : "invalid"}`;
};

const convertedFileErrorMessage: Record<string, string> = {
  image_not_supported: "The selected model does not support image input.",
  too_many_attachments: "There are too many attachments in this conversation.",
  too_many_images: "There are more images than this model can process.",
  attachment_too_large: "An attachment is too large.",
  invalid_attachment: "An attachment is invalid.",
  invalid_messages: "The conversation is empty, too large, or contains invalid messages.",
};

interface MarkdownConversionResult {
  format: "markdown" | "text" | "error";
  data?: string;
  error?: string;
  tokens?: number;
  mimeType?: string;
  name?: string;
}

interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown(input: { name: string; blob: Blob }): Promise<MarkdownConversionResult | MarkdownConversionResult[]>;
}

const decodeImageDataUrl = (dataUrl: string): number[] => {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const decoded = atob(encoded);
  return Array.from(decoded, (character) => character.charCodeAt(0));
};

const legacyVisionPrompt = (messages: ReturnType<typeof buildAiMessages>["messages"]): string =>
  messages
    .map((message) => {
      const content = typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => ("text" in part ? part.text : ""))
            .join("\n");
      return `${message.role.toUpperCase()}: ${content}`;
    })
    .join("\n\n");

const handleAttachmentConversion = async (request: Request, env: Env): Promise<Response> => {
  if (!isSameOrigin(request)) {
    return apiError("Cross-origin file conversion is not allowed.", 403, "origin_rejected");
  }

  const rateLimit = await env.CHAT_RATE_LIMITER.limit({ key: getRateKey(request, "convert") });
  if (!rateLimit.success) {
    return apiError("Too many file conversions. Please wait a minute and try again.", 429, "rate_limited");
  }

  let upload: File;
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    if (!(entry instanceof File)) return apiError("A file is required.", 400, "invalid_attachment");
    upload = entry;
  } catch {
    return apiError("The upload must be multipart form data.", 400, "invalid_attachment");
  }

  const safeName = upload.name.replace(/[\r\n]/g, " ").trim().slice(0, 180);
  const extension = safeName.split(".").at(-1)?.toLowerCase() ?? "";
  if (!safeName || !convertibleExtensions.has(extension)) {
    return apiError("This file format is not supported.", 400, "unsupported_file");
  }
  if (upload.size <= 0 || upload.size > MAX_CONVERT_FILE_BYTES) {
    return apiError("The file is too large.", 413, "file_too_large");
  }

  try {
    const result = await (env.AI as WorkersAiBinding).toMarkdown({ name: safeName, blob: upload });
    const converted = Array.isArray(result) ? result[0] : result;
    if (!converted || converted.format === "error" || typeof converted.data !== "string") {
      console.error("Workers AI document conversion failed", { error: converted?.error ?? "No conversion result" });
      return apiError("The file could not be converted.", 422, "conversion_failed");
    }
    const truncated = converted.data.length > MAX_CONVERTED_CHARACTERS;
    return json({
      name: safeName,
      mimeType: converted.mimeType || upload.type || "application/octet-stream",
      size: upload.size,
      text: converted.data.slice(0, MAX_CONVERTED_CHARACTERS),
      tokens: converted.tokens,
      truncated,
    });
  } catch (error) {
    console.error("Workers AI document conversion failed", {
      message: error instanceof Error ? error.message : "Unknown conversion error",
    });
    return apiError("The file could not be converted.", 502, "conversion_failed");
  }
};

const handleChat = async (request: Request, env: Env): Promise<Response> => {
  if (!isSameOrigin(request)) {
    return apiError("Cross-origin AI requests are not allowed.", 403, "origin_rejected");
  }

  const rateLimit = await env.CHAT_RATE_LIMITER.limit({ key: getRateKey(request, "chat") });
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

  const legacyVision = body.model === LEGACY_VISION_MODEL;
  const parsedMessages = parseApiMessages(body.messages, {
    supportsVision: visionModelIds.has(body.model),
    maxImages: legacyVision ? 1 : 4,
  });
  if (!parsedMessages.ok) {
    return apiError(
      convertedFileErrorMessage[parsedMessages.code] ?? "The conversation contains invalid attachments.",
      400,
      parsedMessages.code,
    );
  }
  const builtInput = buildAiMessages(parsedMessages.messages, legacyVision);
  const modelInput = legacyVision && builtInput.image
    ? { prompt: legacyVisionPrompt(builtInput.messages), image: decodeImageDataUrl(builtInput.image) }
    : builtInput;

  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.6;
  const maxTokens = clampOutputTokens(body.maxTokens, getOutputTokenPolicyForModel(body.model));

  try {
    const ai = env.AI as WorkersAiBinding;
    const result = await ai.run(body.model, {
      ...modelInput,
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

    if (request.method === "POST" && url.pathname === "/api/attachments/convert") {
      return handleAttachmentConversion(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return apiError("API route not found.", 404, "not_found");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
