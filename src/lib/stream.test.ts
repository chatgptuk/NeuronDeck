import { describe, expect, it } from "vitest";
import { consumeChatStream, parseSseData, StreamInterruptedError } from "./stream";

describe("Workers AI stream parser", () => {
  it("parses Workers AI response chunks", () => {
    expect(parseSseData('{"response":"hello"}')).toEqual({ content: "hello" });
  });

  it("parses OpenAI-compatible deltas", () => {
    expect(parseSseData('{"choices":[{"delta":{"content":"edge"}}]}')).toEqual({ content: "edge" });
  });

  it("recognizes completion events", () => {
    expect(parseSseData("[DONE]")).toEqual({ done: true });
  });

  it("parses image generation status and completed images", () => {
    expect(parseSseData('{"image_generation":{"status":"generating","modelId":"flux","modelName":"FLUX"}}'))
      .toEqual({ imageGeneration: { status: "generating", modelId: "flux", modelName: "FLUX" } });
    expect(parseSseData('{"generated_image":{"id":"1","dataUrl":"data:image/png;base64,abc"}}'))
      .toEqual({ generatedImage: { id: "1", dataUrl: "data:image/png;base64,abc" } });
  });

  it("rejects streams that close without a completion marker", async () => {
    const response = new Response('data: {"response":"partial"}\n\n');
    await expect(consumeChatStream(response, () => undefined)).rejects.toBeInstanceOf(StreamInterruptedError);
  });

  it("accepts a complete SSE stream", async () => {
    const events: unknown[] = [];
    const response = new Response('data: {"response":"complete"}\n\ndata: [DONE]\n\n');
    await expect(consumeChatStream(response, (event) => events.push(event))).resolves.toBeUndefined();
    expect(events).toContainEqual({ done: true });
  });

  it("exposes resumable event cursors from SSE ids", async () => {
    const events: unknown[] = [];
    const response = new Response('id: 7\ndata: {"response":"resumed"}\n\nid: 8\ndata: [DONE]\n\n');

    await consumeChatStream(response, (event) => events.push(event));

    expect(events).toEqual([
      { content: "resumed", cursor: 7 },
      { done: true, cursor: 8 },
    ]);
  });
});
