import type { ChatMessage } from "../types";

export const hasRenderableMessageOutput = (
  message: Pick<ChatMessage, "content" | "generatedImages" | "webSources">,
): boolean => Boolean(message.content || message.generatedImages?.length || message.webSources?.length);
