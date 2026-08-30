import { describe, expect, it } from "vitest";
import { hasRenderableMessageOutput } from "./message-output";

describe("message output visibility", () => {
  it("does not leak a zero while image generation has no completed image yet", () => {
    expect(hasRenderableMessageOutput({ content: "", generatedImages: [] })).toBe(false);
  });

  it("recognizes text and completed images as renderable output", () => {
    expect(hasRenderableMessageOutput({ content: "完成", generatedImages: [] })).toBe(true);
    expect(hasRenderableMessageOutput({
      content: "",
      generatedImages: [{
        id: "image-1",
        dataUrl: "data:image/png;base64,abc",
        modelId: "flux",
        modelName: "FLUX",
        prompt: "A lighthouse",
        width: 1024,
        height: 1024,
      }],
    })).toBe(true);
    expect(hasRenderableMessageOutput({
      content: "",
      generatedImages: [],
      webSources: [{ title: "Docs", url: "https://example.com/", domain: "example.com" }],
    })).toBe(true);
    expect(hasRenderableMessageOutput({
      content: "",
      browserScreenshots: [{
        id: "shot-1",
        dataUrl: "data:image/png;base64,abc",
        url: "https://example.com/",
        title: "example.com",
        width: 1280,
        height: 800,
        fullPage: false,
        viewport: "desktop",
      }],
    })).toBe(true);
  });
});
