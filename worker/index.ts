import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
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
  IMAGE_RESULTS: R2Bucket;
  IMAGE_WORKFLOW: Workflow<ImageWorkflowParams>;
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

interface ImageWorkflowParams {
  accessToken: string;
  aspectRatio: ImageAspectRatio;
  clientId: string;
  jobId: string;
  modelId: string;
  prompt: string;
}

interface ImageWorkflowOutput {
  accessToken: string;
  clientId: string;
  elapsedMs: number;
  height: number;
  jobId: string;
  mimeType: string;
  modelId: string;
  modelName: string;
  objectKey: string;
  prompt: string;
  seed: number;
  width: number;
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

const getClientId = (request: Request): string => {
  const value = request.headers.get("x-neurondeck-client") ?? "";
  return /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : "anonymous";
};

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

const base64ToBytes = (encoded: string): Uint8Array => {
  const decoded = atob(encoded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
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

const normalizeImageBytes = async (result: unknown): Promise<{ bytes: Uint8Array; mimeType: string }> => {
  if (result instanceof Response) {
    if (!result.body) throw new Error("The image model returned an empty response.");
    const bytes = await readStreamBytes(result.body);
    const encoded = bytesToBase64(bytes);
    const mime = result.headers.get("content-type")?.split(";")[0] || detectImageMime(encoded);
    return { bytes, mimeType: mime };
  }
  if (result instanceof ReadableStream) {
    const bytes = await readStreamBytes(result);
    return { bytes, mimeType: detectImageMime(bytesToBase64(bytes)) };
  }

  const raw = typeof result === "string"
    ? result
    : result && typeof result === "object" && "image" in result
      ? (result as { image?: unknown }).image
      : undefined;
  if (typeof raw !== "string" || !raw.length) {
    throw new Error("The image model did not return image data.");
  }
  if (raw.startsWith("data:image/")) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(raw);
    if (!match) throw new Error("The image model returned invalid image data.");
    return { bytes: base64ToBytes(match[2].replace(/\s+/g, "")), mimeType: match[1] };
  }

  const binaryLike = raw.charCodeAt(0) > 127 || raw.includes("\0");
  const bytes = binaryLike
    ? Uint8Array.from(raw, (character) => character.charCodeAt(0) & 0xff)
    : base64ToBytes(raw.replace(/\s+/g, ""));
  return { bytes, mimeType: detectImageMime(bytesToBase64(bytes)) };
};

const normalizeImageOutput = async (result: unknown): Promise<string> => {
  const { bytes, mimeType } = await normalizeImageBytes(result);
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
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
  const startedAt = performance.now();
  const result = await ai.run(model.id, buildImageInput(model.id, prompt, width, height, seed));
  const dataUrl = await normalizeImageOutput(result);
  return {
    id: crypto.randomUUID(),
    dataUrl,
    modelId: model.id,
    modelName: model.name,
    prompt,
    width,
    height,
    seed,
    elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)),
  };
};

const imageExtension = (mimeType: string): string => {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
};

const isImageWorkflowOutput = (value: unknown): value is ImageWorkflowOutput => {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<ImageWorkflowOutput>;
  return typeof output.jobId === "string" &&
    typeof output.clientId === "string" &&
    typeof output.accessToken === "string" &&
    typeof output.objectKey === "string" &&
    typeof output.mimeType === "string" &&
    typeof output.modelId === "string" &&
    typeof output.modelName === "string" &&
    typeof output.prompt === "string" &&
    typeof output.width === "number" &&
    typeof output.height === "number" &&
    typeof output.seed === "number" &&
    typeof output.elapsedMs === "number";
};

const workflowOutputToImage = (output: ImageWorkflowOutput): GeneratedImage => ({
  id: output.jobId,
  dataUrl: `/api/image-jobs/${output.jobId}/image.${imageExtension(output.mimeType)}?token=${encodeURIComponent(output.accessToken)}`,
  modelId: output.modelId,
  modelName: output.modelName,
  prompt: output.prompt,
  width: output.width,
  height: output.height,
  seed: output.seed,
  elapsedMs: output.elapsedMs,
});

export class ImageGenerationWorkflow extends WorkflowEntrypoint<Env, ImageWorkflowParams> {
  async run(event: WorkflowEvent<ImageWorkflowParams>, step: WorkflowStep): Promise<ImageWorkflowOutput> {
    return step.do(
      "generate and store image",
      {
        retries: { limit: 1, delay: "10 seconds", backoff: "linear" },
        timeout: "15 minutes",
      },
      async () => {
        const { accessToken, aspectRatio, clientId, jobId, modelId, prompt } = event.payload;
        if (!isImageModelId(modelId)) throw new Error("Unsupported image model.");
        const model = getImageModel(modelId);
        const { width, height } = imageDimensions[aspectRatio];
        const seed = Math.floor(Math.random() * 2_147_483_647);
        const startedAt = performance.now();
        const result = await (this.env.AI as WorkersAiBinding).run(
          model.id,
          buildImageInput(model.id, prompt, width, height, seed),
        );
        const { bytes, mimeType } = await normalizeImageBytes(result);
        const objectKey = `image-jobs/${jobId}`;
        await this.env.IMAGE_RESULTS.put(objectKey, bytes, {
          httpMetadata: { contentType: mimeType },
          customMetadata: { accessToken, clientId },
        });
        return {
          accessToken,
          clientId,
          elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)),
          height,
          jobId,
          mimeType,
          modelId: model.id,
          modelName: model.name,
          objectKey,
          prompt,
          seed,
          width,
        };
      },
    );
  }
}

const waitForWorkflowOutput = async (
  instance: WorkflowInstance,
  timeoutMs = 16 * 60 * 1_000,
): Promise<ImageWorkflowOutput> => {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const status = await instance.status();
    if (status.status === "complete") {
      if (!isImageWorkflowOutput(status.output)) throw new Error("The image workflow returned an invalid result.");
      return status.output;
    }
    if (status.status === "errored" || status.status === "terminated") {
      throw new Error(status.error?.message || "The image workflow failed.");
    }
    const delay = Math.min(5_000, 1_000 + attempt * 250);
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("The image workflow is still running after the extended timeout.");
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

const imageJobRoute = /^\/api\/image-jobs\/([0-9a-f-]{36})(?:\/image\.(?:png|webp|jpg))?$/;

const handleImageJobStatus = async (request: Request, env: Env, jobId: string): Promise<Response> => {
  if (!isSameOrigin(request)) return apiError("Cross-origin job access is not allowed.", 403, "origin_rejected");
  const clientId = getClientId(request);
  if (clientId === "anonymous") return apiError("A valid client id is required.", 401, "client_required");

  try {
    const instance = await env.IMAGE_WORKFLOW.get(jobId);
    const status = await instance.status();
    if (status.status === "complete") {
      if (!isImageWorkflowOutput(status.output)) {
        return apiError("The image job returned an invalid result.", 502, "image_job_invalid");
      }
      if (status.output.clientId !== clientId) {
        return apiError("This image job belongs to another client.", 403, "job_forbidden");
      }
      return json({ status: "complete", image: workflowOutputToImage(status.output) });
    }
    if (status.status === "errored" || status.status === "terminated") {
      return json({
        status: "error",
        error: { message: status.error?.message || "The image job failed." },
      });
    }
    if (status.status === "unknown") return apiError("Image job not found.", 404, "job_not_found");
    return json({ status: status.status });
  } catch (error) {
    console.error("Image job status failed", {
      jobId,
      message: error instanceof Error ? error.message : "Unknown image job error",
    });
    return apiError("The image job status is unavailable.", 502, "image_job_unavailable");
  }
};

const handleImageJobResult = async (request: Request, env: Env, jobId: string): Promise<Response> => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{32}$/.test(token)) return apiError("A valid image token is required.", 401, "image_token_required");
  const object = await env.IMAGE_RESULTS.get(`image-jobs/${jobId}`);
  if (!object) return apiError("Generated image not found.", 404, "image_not_found");
  if (object.customMetadata?.accessToken !== token) {
    return apiError("The image token is invalid.", 403, "image_forbidden");
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("content-disposition", `inline; filename="neurondeck-${jobId}.${imageExtension(headers.get("content-type") || "image/jpeg")}"`);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
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

const getMessageText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) =>
    part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : [],
  ).join(" ");
};

const hasImageGenerationIntent = (
  messages: ReturnType<typeof buildAiMessages>["messages"],
): boolean => {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return false;
  const prompt = getMessageText(messages[lastUserIndex].content).replace(/\s+/g, " ").trim();
  if (!prompt) return false;

  const rejectsCreation =
    /(?:不要|不用|无需|别|停止|取消).{0,12}(?:生成|画|绘制|创作|制作|设计|渲染|生图|出图)/u.test(prompt) ||
    /\b(?:do not|don't|dont|no need to|stop|cancel)\b.{0,40}\b(?:generate|create|draw|paint|render|make)\b/i.test(prompt);
  if (rejectsCreation) return false;

  const chineseVisual = /(?:图(?:片|像|画|标|解|表)?|照片|相片|插画|海报|封面|头像|壁纸|画面|漫画|表情包|贴纸|标志|视觉稿|效果图|渲染图|流程图|场景图|产品图|人物像|肖像|Logo)/iu;
  const chineseCreate = /(?:生成|画|绘制|创作|制作|设计|渲染|生图|出图)/u;
  const chineseDiscussion = /(?:怎么|如何|教程|原理|API|接口|价格|费用|哪些|什么模型|模型有哪些|是什么意思|什么意思)/iu;
  const explicitChinese =
    !chineseDiscussion.test(prompt) && chineseCreate.test(prompt) && chineseVisual.test(prompt);
  const directChinese = !chineseDiscussion.test(prompt) && (
    /(?:生成|创作)(?:给我|一下)?(?:一|两|几)?(?:张|幅).{0,80}/u.test(prompt) ||
    /(?:绘制|画)(?:给我|一下|一个|一张|一幅|个|只|几张|张|幅).{1,80}/u.test(prompt) ||
    /(?:给我|帮我|请|麻烦|替我).{0,10}(?:画|绘制).{1,80}/u.test(prompt) ||
    /(?:再来|来|换|另来)(?:一|两|几)?张/u.test(prompt)
  );

  const englishVisual = /\b(?:image|picture|photo|photograph|illustration|poster|cover|avatar|wallpaper|artwork|graphic|logo|icon|portrait|sticker|comic|diagram|3d render)\b/i;
  const englishCreate = /\b(?:generate|create|draw|paint|illustrate|render|design|make)\b/i;
  const englishHowTo = /\b(?:how (?:do|can|to)|tutorial|api|pricing|price|which model|what model)\b.{0,80}\b(?:generate|create|draw|paint|render)\b/i;
  const explicitEnglish = !englishHowTo.test(prompt) && englishCreate.test(prompt) && englishVisual.test(prompt);
  const directEnglish =
    /\b(?:draw|paint|illustrate|sketch)\s+(?:me\s+)?(?:a|an|the|this)?\b/i.test(prompt) &&
    !/\bdraw\s+(?:a\s+)?(?:conclusion|comparison|parallel|attention)\b/i.test(prompt);

  if (explicitChinese || directChinese || explicitEnglish || directEnglish) return true;

  const priorText = messages.slice(0, lastUserIndex).map((message) => getMessageText(message.content)).join(" ");
  const hasPriorVisual =
    (chineseCreate.test(priorText) && chineseVisual.test(priorText)) ||
    /(?:图片|图像|照片|插画|海报).{0,20}(?:生成好了|生成成功|已经生成|完成)/u.test(priorText) ||
    (englishCreate.test(priorText) && englishVisual.test(priorText)) ||
    /\b(?:image|picture|photo|illustration).{0,30}(?:generated|created|ready|complete)\b/i.test(priorText);
  const asksForVariation =
    /(?:再来|再做|再画|再生成|重新|重做|重绘|换一|换个|另一个|变体|改成|换成|背景换|风格换)/u.test(prompt) ||
    /\b(?:another one|one more|try again|regenerate|remake|redraw|variation|new version|change (?:it|the)|make it)\b/i.test(prompt);
  return hasPriorVisual && asksForVariation;
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
  let imageInvocationSucceeded = false;
  let imageInvocationFailed = false;

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
            "A referential follow-up asking for another result, a variation, a remake, or a changed version of a previously generated visual is also creation intent; infer a self-contained prompt from the conversation and retained image-tool context. " +
            "Never state or imply that an image was created unless generate_image was called successfully in the current turn. " +
            "Never claim you cannot generate images when creation intent is present. Do not call the tool for ordinary questions or image analysis.",
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
          imageInvocationFailed = true;
          const message = prefersChinese ? "聊天模型没有提供有效的绘图描述。" : "The chat model did not provide a valid image prompt.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, message });
          return `Image generation failed: ${message}`;
        }

        const imageRateLimit = await env.CHAT_RATE_LIMITER.limit({ key: getRateKey(request, "image") });
        if (!imageRateLimit.success) {
          imageInvocationFailed = true;
          const message = prefersChinese ? "生图请求过于频繁，请稍后再试。" : "Too many image requests. Please try again shortly.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, prompt, message });
          return `Image generation failed: ${message}`;
        }

        let jobId: string | undefined;
        sendImageState({ status: "generating", modelId: imageModel.id, modelName: imageModel.name, prompt });
        try {
          let image: GeneratedImage;
          if (imageModel.id === "@cf/black-forest-labs/flux-2-dev") {
            jobId = crypto.randomUUID();
            const accessToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
            const instance = await env.IMAGE_WORKFLOW.create({
              id: jobId,
              params: {
                accessToken,
                aspectRatio,
                clientId: getClientId(request),
                jobId,
                modelId: imageModel.id,
                prompt,
              },
              retention: { successRetention: "1 day", errorRetention: "1 day" },
            });
            sendImageState({
              status: "generating",
              modelId: imageModel.id,
              modelName: imageModel.name,
              prompt,
              jobId,
            });
            image = workflowOutputToImage(await waitForWorkflowOutput(instance));
          } else {
            image = await generateImage(ai, imageModel.id, prompt, aspectRatio);
          }
          imageInvocationSucceeded = true;
          send({ generated_image: image });
          return `Image generated successfully with ${image.modelName} at ${image.width}x${image.height} (seed ${image.seed}). ` +
            "The image is already visible to the user. Briefly confirm completion without embedding image data.";
        } catch (error) {
          imageInvocationFailed = true;
          console.error("Workers AI image generation failed", {
            model: imageModel.id,
            message: error instanceof Error ? error.message : "Unknown image generation error",
          });
          const message = prefersChinese
            ? "所选生图模型暂时无法完成请求，请稍后重试或更换模型。"
            : "The selected image model could not complete the request. Try again or choose another model.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, prompt, message, jobId });
          return `Image generation failed: ${message}`;
        }
      };

      try {
        const decision = await ai.run(modelId, {
          messages: toolMessages,
          tools: [imageToolDefinition],
          tool_choice: "required",
          parallel_tool_calls: false,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        });
        const toolCalls = extractToolCalls(decision);

        if (!toolCalls.length) {
          const message = prefersChinese
            ? "聊天模型没有成功启动生图工具，请重试或补充画面要求。"
            : "The chat model did not start the image tool. Try again or add more visual detail.";
          sendImageState({ status: "error", modelId: imageModel.id, modelName: imageModel.name, message });
          send({ response: message });
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

        if (imageInvocationFailed && !imageInvocationSucceeded) {
          const message = prefersChinese
            ? "图片没有生成成功，请稍后重试或更换生图模型。"
            : "The image was not generated. Try again or choose a different image model.";
          send({ response: message });
          send({ done: true });
          if (!cancelled) controller.close();
          return;
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

  if (supportsTools && hasImageGenerationIntent(builtInput.messages)) {
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

    const imageJobMatch = imageJobRoute.exec(url.pathname);
    if (request.method === "GET" && imageJobMatch) {
      return url.pathname.includes("/image.")
        ? handleImageJobResult(request, env, imageJobMatch[1])
        : handleImageJobStatus(request, env, imageJobMatch[1]);
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
