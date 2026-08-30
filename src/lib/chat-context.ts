import type { ChatMessage } from "../types";

const MAX_RETAINED_IMAGE_PROMPT_LENGTH = 1_200;
export const LEGACY_IMAGE_CONTEXT_MARKER = "[Retained image-tool context for later follow-up requests:";
export const INTERNAL_IMAGE_CONTEXT_MARKER = "Internal application context from a successful earlier image-tool call";

export interface RetainedImageContext {
  imageId?: string;
  modelName: string;
  prompt: string;
  width: number;
  height: number;
}

export const getMessageContentForRequest = (message: ChatMessage): string => message.content;

export const getRetainedImageContextForRequest = (
  message: ChatMessage,
): RetainedImageContext | undefined => {
  if (message.role !== "assistant" || !message.generatedImages?.length) return undefined;

  const image = message.generatedImages.at(-1);
  if (!image) return undefined;
  return {
    imageId: image.id,
    modelName: image.modelName.slice(0, 120),
    prompt: image.prompt.replace(/\s+/g, " ").trim().slice(0, MAX_RETAINED_IMAGE_PROMPT_LENGTH),
    width: image.width,
    height: image.height,
  };
};

export interface ImageReferenceRequest {
  id: string;
  dataUrl: string;
  prompt: string;
}

export const getImageReferencesForRequest = (
  messages: ChatMessage[],
  limit = 4,
): ImageReferenceRequest[] => {
  const references: ImageReferenceRequest[] = [];
  const seen = new Set<string>();
  for (const message of [...messages].reverse()) {
    for (const image of [...(message.generatedImages ?? [])].reverse()) {
      if (seen.has(image.id) || !image.dataUrl) continue;
      seen.add(image.id);
      references.unshift({
        id: image.id,
        dataUrl: image.dataUrl,
        prompt: image.prompt.replace(/\s+/g, " ").trim().slice(0, MAX_RETAINED_IMAGE_PROMPT_LENGTH),
      });
      if (references.length >= limit) return references;
    }
  }
  return references;
};

export const stripInternalImageContext = (content: string): string => {
  const markerIndexes = [
    content.indexOf(LEGACY_IMAGE_CONTEXT_MARKER),
    content.indexOf(INTERNAL_IMAGE_CONTEXT_MARKER),
  ].filter((index) => index >= 0);
  const markerIndex = markerIndexes.length ? Math.min(...markerIndexes) : -1;
  return markerIndex < 0 ? content : content.slice(0, markerIndex).trimEnd();
};

export const extractLegacyImageContext = (
  content: string,
): { content: string; retainedImageContext?: RetainedImageContext } => {
  const match = content.match(
    /\s*\[Retained image-tool context for later follow-up requests:\s*a real image was generated with (.+?);\s*size (\d+)x(\d+);\s*generation prompt:\s*([\s\S]*?)\]\s*$/,
  );
  if (!match) return { content };

  const width = Number(match[2]);
  const height = Number(match[3]);
  return {
    content: content.slice(0, match.index).trimEnd(),
    retainedImageContext: {
      modelName: match[1].trim().slice(0, 120),
      prompt: match[4].replace(/\s+/g, " ").trim().slice(0, MAX_RETAINED_IMAGE_PROMPT_LENGTH),
      width,
      height,
    },
  };
};
