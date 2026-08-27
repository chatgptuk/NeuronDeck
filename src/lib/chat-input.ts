import type { Attachment } from "../types";
import {
  extractLegacyImageContext,
  type RetainedImageContext,
} from "./chat-context";

export interface ParsedApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments: Attachment[];
  retainedImageContext?: RetainedImageContext;
}

export type AiMessage = {
  role: ParsedApiMessage["role"];
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export type ParseMessagesResult =
  | { ok: true; messages: ParsedApiMessage[]; imageCount: number }
  | { ok: false; code: string };

const MAX_MESSAGES = 48;
const MAX_TOTAL_CHARACTERS = 120_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const MAX_TOTAL_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_CHARACTERS = 40_000;
const imageDataUrlPattern = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-zA-Z0-9+/]+={0,2})$/;

const base64ByteLength = (value: string): number => {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
};

const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\r\n]/g, " ").trim();
  return name && name.length <= 180 ? name : null;
};

const parseRetainedImageContext = (value: unknown): RetainedImageContext | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Record<string, unknown>;
  const modelName = typeof context.modelName === "string" ? context.modelName.trim() : "";
  const prompt = typeof context.prompt === "string" ? context.prompt.replace(/\s+/g, " ").trim() : "";
  const width = context.width;
  const height = context.height;
  if (!modelName || modelName.length > 120 || !prompt || prompt.length > 1_200) return undefined;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  if ((width as number) < 1 || (width as number) > 4_096 || (height as number) < 1 || (height as number) > 4_096) {
    return undefined;
  }
  return { modelName, prompt, width: width as number, height: height as number };
};

export const parseApiMessages = (
  value: unknown,
  options: { supportsVision: boolean; maxImages: number },
): ParseMessagesResult => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return { ok: false, code: "invalid_messages" };
  }

  let totalCharacters = 0;
  let totalAttachments = 0;
  let totalImageBytes = 0;
  let imageCount = 0;
  const parsed: ParsedApiMessage[] = [];

  for (const rawMessage of value) {
    if (!rawMessage || typeof rawMessage !== "object") return { ok: false, code: "invalid_messages" };
    const { role, content, attachments, retainedImageContext: rawRetainedImageContext } = rawMessage as Record<string, unknown>;
    if (!(role === "system" || role === "user" || role === "assistant")) {
      return { ok: false, code: "invalid_messages" };
    }
    if (typeof content !== "string" || !content.trim() || content.length > 32_000) {
      return { ok: false, code: "invalid_messages" };
    }
    const legacy = role === "assistant" ? extractLegacyImageContext(content) : { content };
    const retainedImageContext = role === "assistant"
      ? parseRetainedImageContext(rawRetainedImageContext) ?? legacy.retainedImageContext
      : undefined;
    const visibleContent = legacy.content || (retainedImageContext ? "A previous image was generated." : "");
    if (!visibleContent) return { ok: false, code: "invalid_messages" };

    const rawAttachments = attachments == null ? [] : attachments;
    if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, code: "too_many_attachments" };
    }
    if (rawAttachments.length && role !== "user") return { ok: false, code: "invalid_attachment" };

    const parsedAttachments: Attachment[] = [];
    for (const rawAttachment of rawAttachments) {
      if (!rawAttachment || typeof rawAttachment !== "object") return { ok: false, code: "invalid_attachment" };
      const attachment = rawAttachment as Record<string, unknown>;
      const name = cleanName(attachment.name);
      const mimeType = typeof attachment.mimeType === "string" ? attachment.mimeType.toLowerCase() : "";
      if (!name || !mimeType) return { ok: false, code: "invalid_attachment" };

      if (attachment.kind === "image") {
        if (!options.supportsVision) return { ok: false, code: "image_not_supported" };
        if (typeof attachment.dataUrl !== "string") return { ok: false, code: "invalid_attachment" };
        const match = imageDataUrlPattern.exec(attachment.dataUrl);
        if (!match || match[1] !== mimeType) return { ok: false, code: "invalid_attachment" };
        const bytes = base64ByteLength(match[2]);
        if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) return { ok: false, code: "attachment_too_large" };
        totalImageBytes += bytes;
        imageCount += 1;
        parsedAttachments.push({
          id: typeof attachment.id === "string" ? attachment.id : name,
          kind: "image",
          name,
          mimeType,
          size: bytes,
          dataUrl: attachment.dataUrl,
        });
      } else if (attachment.kind === "file") {
        if (typeof attachment.text !== "string" || !attachment.text.trim()) {
          return { ok: false, code: "invalid_attachment" };
        }
        if (attachment.text.length > MAX_DOCUMENT_CHARACTERS) {
          return { ok: false, code: "attachment_too_large" };
        }
        totalCharacters += attachment.text.length;
        parsedAttachments.push({
          id: typeof attachment.id === "string" ? attachment.id : name,
          kind: "file",
          name,
          mimeType,
          size: typeof attachment.size === "number" ? attachment.size : attachment.text.length,
          text: attachment.text,
          tokens: typeof attachment.tokens === "number" ? attachment.tokens : undefined,
          truncated: attachment.truncated === true,
        });
      } else {
        return { ok: false, code: "invalid_attachment" };
      }
    }

    totalCharacters += visibleContent.length + (retainedImageContext?.prompt.length ?? 0);
    totalAttachments += parsedAttachments.length;
    if (totalCharacters > MAX_TOTAL_CHARACTERS) return { ok: false, code: "invalid_messages" };
    if (totalAttachments > MAX_TOTAL_ATTACHMENTS) return { ok: false, code: "too_many_attachments" };
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) return { ok: false, code: "attachment_too_large" };
    if (imageCount > options.maxImages) return { ok: false, code: "too_many_images" };

    parsed.push({
      role,
      content: visibleContent,
      attachments: parsedAttachments,
      ...(retainedImageContext ? { retainedImageContext } : {}),
    });
  }

  return { ok: true, messages: parsed, imageCount };
};

const documentContext = (attachment: Attachment): string =>
  `\n\n--- Attached document: ${attachment.name} ---\n${attachment.text ?? ""}\n--- End document: ${attachment.name} ---`;

export const buildAiMessages = (
  messages: ParsedApiMessage[],
  legacyTopLevelImage: boolean,
): { messages: AiMessage[]; image?: string; retainedImageContext?: RetainedImageContext } => {
  let topLevelImage: string | undefined;
  let retainedImageContext: RetainedImageContext | undefined;
  const aiMessages = messages.map((message): AiMessage => {
    if (message.retainedImageContext) retainedImageContext = message.retainedImageContext;
    const files = message.attachments.filter((attachment) => attachment.kind === "file");
    const images = message.attachments.filter((attachment) => attachment.kind === "image");
    const text = `${message.content}${files.map(documentContext).join("")}`;

    if (!images.length) return { role: message.role, content: text };
    if (legacyTopLevelImage) {
      topLevelImage = images[0].dataUrl;
      return { role: message.role, content: `${text}\n\n[Attached image: ${images[0].name}]` };
    }

    return {
      role: message.role,
      content: [
        { type: "text", text },
        ...images.map((attachment) => ({
          type: "image_url" as const,
          image_url: { url: attachment.dataUrl ?? "" },
        })),
      ],
    };
  });

  return {
    messages: aiMessages,
    ...(topLevelImage ? { image: topLevelImage } : {}),
    ...(retainedImageContext ? { retainedImageContext } : {}),
  };
};
