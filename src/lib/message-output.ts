import type { ChatMessage } from "../types";

export const hasRenderableMessageOutput = (
  message: Pick<ChatMessage, "content" | "generatedImages">,
): boolean => Boolean(message.content || message.generatedImages?.length);
