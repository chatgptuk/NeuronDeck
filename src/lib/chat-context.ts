import type { ChatMessage } from "../types";

const MAX_RETAINED_IMAGE_PROMPT_LENGTH = 1_200;

export const getMessageContentForRequest = (message: ChatMessage): string => {
  if (message.role !== "assistant" || !message.generatedImages?.length) return message.content;

  const image = message.generatedImages.at(-1);
  if (!image) return message.content;
  const prompt = image.prompt.replace(/\s+/g, " ").trim().slice(0, MAX_RETAINED_IMAGE_PROMPT_LENGTH);
  const imageContext = [
    "[Retained image-tool context for later follow-up requests:",
    `a real image was generated with ${image.modelName};`,
    `size ${image.width}x${image.height};`,
    `generation prompt: ${prompt}]`,
  ].join(" ");

  return message.content ? `${message.content}\n\n${imageContext}` : imageContext;
};
