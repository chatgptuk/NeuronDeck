import { describe, expect, it } from "vitest";
import { parseSseData } from "./stream";

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
});
