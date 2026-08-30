import type { ChatMessage } from "../types";

export const hasRenderableMessageOutput = (
  message: Pick<ChatMessage, "content" | "generatedImages" | "webSources" | "browserScreenshots" | "generatedFiles">,
): boolean => Boolean(
  message.content ||
  message.generatedImages?.length ||
  message.webSources?.length ||
  message.browserScreenshots?.length ||
  message.generatedFiles?.length,
);
