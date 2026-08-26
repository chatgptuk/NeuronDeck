import catalog from "../src/data/models.generated.json";
import { buildAiMessages, parseApiMessages } from "../src/lib/chat-input";
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  IMAGE_MODELS,
  isImageModelId,
} from "../src/lib/image-models";
import { clampOutputTokens, getOutputTokenPolicyForModel } from "../src/lib/output-tokens";
import type { GeneratedImage, ImageGenerationState } from "../src/types";

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
  imageModel?: unknown;
}

const modelIds = new Set(catalog.models.map((model) => model.id));
const visionModelIds = new Set(
  catalog.models.filter((model) => (model.capabilities as string[]).includes("vision")).map((model) => model.id),
);
const toolModelIds = new Set(
  catalog.models.filter((model) => (model.capabilities as string[]).includes("tools")).map((model) => model.id),
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

type ImageAspectRatio = "square" | "landscape" | "portrait";

interface GenerateImageArguments {
  prompt?: unknown;
  aspect_ratio?: unknown;
}

const imageDimensions: Record<ImageAspectRatio, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1344, height: 768 },
  portrait: { width: 768, height: 1344 },
};

const sseHeaders = (): Headers => new Headers({
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  "x-content-type-options": "nosniff",
});

const encodeSse = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);

const detectImageMime = (encoded: string): string => {
  if (encoded.startsWith("iVBOR")) return "image/png";
  if (encoded.startsWith("UklGR")) return "image/webp";
  if (encoded.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const coerceBytes = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  return new TextEncoder().encode(String(value));
};

const readStreamBytes = async (stream: ReadableStream): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = coerceBytes(value);
    chunks.push(chunk);
    length += chunk.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

const normalizeImageOutput = async (result: unknown): Promise<string> => {
  if (result instanceof Response) {
    if (!result.body) throw new Error("The image model returned an empty response.");
    const bytes = await readStreamBytes(result.body);
    const encoded = bytesToBase64(bytes);
    const mime = result.headers.get("content-type")?.split(";")[0] || detectImageMime(encoded);
    return `data:${mime};base64,${encoded}`;
  }
  if (result instanceof ReadableStream) {
    const encoded = bytesToBase64(await readStreamBytes(result));
    return `data:${detectImageMime(encoded)};base64,${encoded}`;
  }

  const raw = typeof result === "string"
    ? result
    : result && typeof result === "object" && "image" in result
      ? (result as { image?: unknown }).image
      : undefined;
  if (typeof raw !== "string" || !raw.length) {
    throw new Error("The image model did not return image data.");
  }
  if (raw.startsWith("data:image/")) return raw;

  const binaryLike = raw.charCodeAt(0) > 127 || raw.includes("\0");
  const encoded = binaryLike
    ? bytesToBase64(Uint8Array.from(raw, (character) => character.charCodeAt(0) & 0xff))
    : raw.replace(/\s+/g, "");
  return `data:${detectImageMime(encoded)};base64,${encoded}`;
};

const buildImageInput = (
  modelId: string,
  prompt: string,
  width: number,
  height: number,
  seed: number,
): Record<string, unknown> => {
  if (modelId.startsWith("@cf/black-forest-labs/flux-2-")) {
    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("width", String(width));
    formData.set("height", String(height));
    formData.set("seed", String(seed));
    if (modelId.endsWith("flux-2-dev")) {
      formData.set("steps", "24");
      formData.set("guidance", "4");
    }
    const multipartResponse = new Response(formData);
    if (!multipartResponse.body) throw new Error("Could not create the image request.");
    return {
      multipart: {
        body: multipartResponse.body,
        contentType: multipartResponse.headers.get("content-type") || "multipart/form-data",
      },
    };
  }

  if (modelId === "@cf/leonardo/lucid-origin") {
    return { prompt, width, height, seed, guidance: 4.5, num_steps: 28 };
  }
  return { prompt, width, height, seed, guidance: 2, num_steps: 28 };
};

const generateImage = async (
  ai: WorkersAiBinding,
  modelId: string,
  prompt: string,
  aspectRatio: ImageAspectRatio,
): Promise<GeneratedImage> => {
  const model = getImageModel(modelId);
  const { width, height } = imageDimensions[aspectRatio];
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const result = await ai.run(model.id, buildImageInput(model.id, prompt, width, height, seed));
  return {
    id: crypto.randomUUID(),
    dataUrl: await normalizeImageOutput(result),
    modelId: model.id,
    modelName: model.name,
    prompt,
    width,
    height,
    seed,
  };
};

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

interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: GenerateImageArguments;
  legacy: boolean;
}

const imageToolDefinition = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Create a brand-new image from a text description. Decide by semantic intent, not exact words. " +
      "Use this whenever the user asks to create, draw, illustrate, design, render, visualize, or make a visual artifact such as a poster, icon, scene, product shot, or artwork. " +
      "Equivalent requests in any language should trigger it. Do not use it merely to analyze or discuss an existing image. " +
      "Write a detailed, self-contained generation prompt that preserves the user's requested subject, style, composition, mood, and visible text.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 2_000,
          description: "A detailed standalone prompt for the image generator.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["square", "landscape", "portrait"],
          description: "Choose the composition that best matches the request. Defaults to square.",
        },
      },
      required: ["prompt"],
    },
  },
};

const parseToolArguments = (value: unknown): GenerateImageArguments => {
  if (value && typeof value === "object") return value as GenerateImageArguments;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as GenerateImageArguments : {};
  } catch {
    return {};
  }
};

const extractToolCalls = (result: unknown): NormalizedToolCall[] => {
  if (!result || typeof result !== "object") return [];
  const data = result as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const firstMessage = choices[0]?.message && typeof choices[0].message === "object"
    ? choices[0].message as Record<string, unknown>
    : undefined;
  const modernCalls = Array.isArray(firstMessage?.tool_calls) ? firstMessage.tool_calls : [];
  const topLevelCalls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
  const responseCalls = Array.isArray(data.output)
    ? data.output.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "function_call")
    : [];
  const source = modernCalls.length ? modernCalls : responseCalls.length ? responseCalls : topLevelCalls;
  const legacy = source === topLevelCalls && !modernCalls.length && !responseCalls.length;

  return source.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const call = value as Record<string, unknown>;
    const fn = call.function && typeof call.function === "object"
      ? call.function as Record<string, unknown>
      : undefined;
    const name = typeof fn?.name === "string"
      ? fn.name
      : typeof call.name === "string"
        ? call.name
        : "";
    if (!name) return [];
    return [{
      id: typeof call.id === "string"
        ? call.id
        : typeof call.call_id === "string"
          ? call.call_id
          : `call_${index}_${crypto.randomUUID()}`,
      name,
      arguments: parseToolArguments(fn?.arguments ?? call.arguments),
      legacy,
    }];
  });
};

const extractCompletion = (result: unknown): { content: string; reasoning: string; usage?: unknown } => {
  if (typeof result === "string") return { content: result, reasoning: "" };
  if (!result || typeof result !== "object") return { content: "", reasoning: "" };
  const data = result as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const message = choices[0]?.message && typeof choices[0].message === "object"
    ? choices[0].message as Record<string, unknown>
    : undefined;
  const outputText = Array.isArray(data.output)
    ? data.output.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) return [];
        return content.flatMap((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? [(part as { text: string }).text]
            : [],
        );
      }).join("")
    : "";
  return {
    content:
      typeof data.response === "string" ? data.response
      : typeof data.output_text === "string" ? data.output_text
      : typeof message?.content === "string" ? message.content
      : outputText,
    reasoning:
      typeof data.reasoning === "string" ? data.reasoning
      : typeof message?.reasoning_content === "string" ? message.reasoning_content
      : "",
    usage: data.usage,
  };
};

const handleToolChat = (
  request: Request,
  env: Env,
  modelId: string,
  messages: ReturnType<typeof buildAiMessages>["messages"],
  temperature: number,
  maxTokens: number,
  imageModelId: string,
): Response => {
  const ai = env.AI as WorkersAiBinding;
  const imageModel = getImageModel(imageModelId);
  const prefersChinese = request.headers.get("accept-language")?.toLowerCase().startsWith("zh") ?? false;
  let cancelled = false;
  let imageInvocationStarted = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (!cancelled) controller.enqueue(encodeSse(payload));
      };
      const sendImageState = (state: ImageGenerationState) => send({ image_generation: state });
      const toolMessages = [
        {
          role: "system",
          content:
            "You have a working generate_image tool connected to a real image model. " +
            "Use it whenever the user's semantic intent is to create a new visual, even when they do not say the exact words 'generate an image'. " +
            "Never claim you cannot generate images when that intent is present. Do not call it for ordinary questions or image analysis.",
        },
        ...messages,
      ];

      const executeImageTool = async (args: GenerateImageArguments): Promise<string> => {
        if (imageInvocationStarted) {
          return "Image generation was skipped because only one image is allowed in each assistant turn.";
        }
        imageInvocationStarted = true;
        const prompt = typeof args.prompt === "string" ? args.prompt.trim().slice(0, 2_000) : "";
        const aspectRatio: ImageAspectRatio =
          args.aspect_ratio === "landscape" || args.aspect_ratio === "portrait" ? args.aspect_ratio : "square";
        if (!prompt) {
          const message = prefersChinese ? "聊天模型没有提供有效的绘图描述。" : "The chat model did not provide a valid image prompt.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, message });
          return `Image generation failed: ${message}`;
        }

        const imageRateLimit = await env.CHAT_RATE_LIMITER.limit({ key: getRateKey(request, "image") });
        if (!imageRateLimit.success) {
          const message = prefersChinese ? "生图请求过于频繁，请稍后再试。" : "Too many image requests. Please try again shortly.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, prompt, message });
          return `Image generation failed: ${message}`;
        }

        sendImageState({ status: "generating", modelId: imageModel.id, modelName: imageModel.name, prompt });
        try {
          const image = await generateImage(ai, imageModel.id, prompt, aspectRatio);
          send({ generated_image: image });
          return `Image generated successfully with ${image.modelName} at ${image.width}x${image.height} (seed ${image.seed}). ` +
            "The image is already visible to the user. Briefly confirm completion without embedding image data.";
        } catch (error) {
          console.error("Workers AI image generation failed", {
            model: imageModel.id,
            message: error instanceof Error ? error.message : "Unknown image generation error",
          });
          const message = prefersChinese
            ? "所选生图模型暂时无法完成请求，请稍后重试或更换模型。"
            : "The selected image model could not complete the request. Try again or choose another model.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, prompt, message });
          return `Image generation failed: ${message}`;
        }
      };

      try {
        const decision = await ai.run(modelId, {
          messages: toolMessages,
          tools: [imageToolDefinition],
          tool_choice: "auto",
          parallel_tool_calls: false,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        });
        const toolCalls = extractToolCalls(decision);

        if (!toolCalls.length) {
          const completion = extractCompletion(decision);
          if (completion.reasoning) send({ reasoning: completion.reasoning });
          send({ response: completion.content || (prefersChinese ? "模型没有返回内容。" : "The model returned no content.") });
          if (completion.usage) send({ usage: completion.usage });
          send({ done: true });
          if (!cancelled) controller.close();
          return;
        }

        const nextMessages: Array<Record<string, unknown>> = [...toolMessages];
        if (toolCalls.some((call) => call.legacy)) {
          for (const call of toolCalls) {
            nextMessages.push({ role: "assistant", content: JSON.stringify({ name: call.name, arguments: call.arguments }) });
            const toolResult = call.name === "generate_image"
              ? await executeImageTool(call.arguments)
              : `Unknown tool: ${call.name}`;
            nextMessages.push({ role: "tool", name: call.name, content: toolResult });
          }
        } else {
          nextMessages.push({
            role: "assistant",
            content: null,
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          });
          for (const call of toolCalls) {
            const toolResult = call.name === "generate_image"
              ? await executeImageTool(call.arguments)
              : `Unknown tool: ${call.name}`;
            nextMessages.push({ role: "tool", tool_call_id: call.id, content: toolResult });
          }
        }

        const finalResult = await ai.run(modelId, {
          messages: nextMessages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        });
        if (finalResult instanceof ReadableStream) {
          const reader = finalResult.getReader();
          while (!cancelled) {
            const { value, done } = await reader.read();
            if (done) break;
            controller.enqueue(coerceBytes(value));
          }
          if (cancelled) await reader.cancel();
        } else {
          const completion = extractCompletion(finalResult);
          if (completion.reasoning) send({ reasoning: completion.reasoning });
          send({ response: completion.content });
          if (completion.usage) send({ usage: completion.usage });
          send({ done: true });
        }
        if (!cancelled) controller.close();
      } catch (error) {
        console.error("Workers AI function calling failed", {
          model: modelId,
          message: error instanceof Error ? error.message : "Unknown function calling error",
        });
        if (!cancelled) {
          send({ error: "The selected model could not complete this request." });
          controller.close();
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, { headers: sseHeaders() });
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
  const supportsTools = toolModelIds.has(body.model);
  const imageModelId = body.imageModel === undefined ? DEFAULT_IMAGE_MODEL_ID : body.imageModel;
  if (supportsTools && !isImageModelId(imageModelId)) {
    return apiError("Select a supported Cloudflare-hosted image model.", 400, "invalid_image_model");
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

  if (supportsTools) {
    return handleToolChat(
      request,
      env,
      body.model,
      builtInput.messages,
      temperature,
      maxTokens,
      imageModelId as string,
    );
  }

  try {
    const ai = env.AI as WorkersAiBinding;
    const result = await ai.run(body.model, {
      ...modelInput,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    const headers = sseHeaders();

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
        imageModelCount: IMAGE_MODELS.length,
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
