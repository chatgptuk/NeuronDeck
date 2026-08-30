import type { GeneratedImage, ImageGenerationState, StreamEvent } from "../types";

export class StreamInterruptedError extends Error {
  constructor() {
    super("The response stream ended before its completion marker.");
    this.name = "StreamInterruptedError";
  }
}

const getNestedContent = (value: unknown): StreamEvent => {
  if (typeof value === "string") return { content: value };
  if (!value || typeof value !== "object") return {};

  const data = value as Record<string, unknown>;
  if (data.generated_image && typeof data.generated_image === "object") {
    return { generatedImage: data.generated_image as GeneratedImage };
  }
  if (data.image_generation && typeof data.image_generation === "object") {
    return { imageGeneration: data.image_generation as ImageGenerationState };
  }
  if (typeof data.response === "string") return { content: data.response };
  if (typeof data.content === "string") return { content: data.content };
  if (typeof data.reasoning === "string") return { reasoning: data.reasoning };
  if (typeof data.error === "string") return { error: data.error };
  if (data.done === true) return { done: true };

  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") return { content: delta.content };
  if (typeof delta?.reasoning_content === "string") return { reasoning: delta.reasoning_content };

  if (typeof data.delta === "string") return { content: data.delta };
  const responseDelta = data.delta as Record<string, unknown> | undefined;
  if (typeof responseDelta?.text === "string") return { content: responseDelta.text };

  if (data.usage && typeof data.usage === "object") {
    return { usage: data.usage as Record<string, number> };
  }
  return {};
};

export const parseSseData = (data: string): StreamEvent => {
  if (!data || data === "[DONE]") return { done: true };
  try {
    return getNestedContent(JSON.parse(data));
  } catch {
    return { content: data };
  }
};

export const consumeChatStream = async (
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> => {
  if (!response.body) throw new Error("The model returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const emit = (data: string, cursor?: number) => {
    const event = parseSseData(data);
    if (cursor != null) event.cursor = cursor;
    if (event.done) completed = true;
    onEvent(event);
  };

  const emitBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    const idLine = lines.find((line) => line.startsWith("id:"));
    const parsedCursor = idLine ? Number(idLine.slice(3).trim()) : undefined;
    if (data) emit(data, Number.isSafeInteger(parsedCursor) && (parsedCursor as number) >= 0 ? parsedCursor : undefined);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        emitBlock(block);
      }
      if (done) break;
    }

    const tail = buffer.trim();
    if (tail) {
      if (tail.includes("data:")) emitBlock(tail);
      else emit(tail);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
  }

  if (!completed) throw new StreamInterruptedError();
};
