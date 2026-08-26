import type { ChatMessage } from "../types";

export const recoverInterruptedMessage = (
  message: ChatMessage,
  interruptedNotice: string,
): ChatMessage => {
  if (message.status !== "streaming") return message;

  const hasDurableImageJob =
    message.imageGeneration?.status === "generating" && Boolean(message.imageGeneration.jobId);
  if (hasDurableImageJob) return message;

  return {
    ...message,
    content: message.content ? `${message.content}\n\n${interruptedNotice}` : interruptedNotice,
    status: "error",
    imageGeneration: message.imageGeneration?.status === "generating"
      ? { ...message.imageGeneration, status: "error", message: interruptedNotice }
      : message.imageGeneration,
  };
};
