import { describe, expect, it } from "vitest";
import {
  extractLegacyImageContext,
  getMessageContentForRequest,
  getRetainedImageContextForRequest,
  stripInternalImageContext,
} from "./chat-context";

describe("chat image context", () => {
  it("retains the last generated image as structured context without changing visible content", () => {
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "图片已经完成。",
      createdAt: "2026-08-26T00:00:00.000Z",
      generatedImages: [
        {
          id: "image-1",
          dataUrl: "data:image/png;base64,abc",
          modelId: "flux",
          modelName: "FLUX",
          prompt: "A candid street portrait in warm autumn light",
          width: 768,
          height: 1344,
        },
      ],
    };

    expect(getMessageContentForRequest(message)).toBe("图片已经完成。");
    expect(getRetainedImageContextForRequest(message)).toEqual({
      modelName: "FLUX",
      prompt: "A candid street portrait in warm autumn light",
      width: 768,
      height: 1344,
    });
  });

  it("does not alter ordinary messages", () => {
    expect(getMessageContentForRequest({
      id: "user-1",
      role: "user",
      content: "再来一张",
      createdAt: "2026-08-26T00:00:00.000Z",
    })).toBe("再来一张");
  });

  it("extracts and removes the legacy internal marker from stored messages", () => {
    const legacy = "图片已经完成。\n\n[Retained image-tool context for later follow-up requests: a real image was generated with FLUX.2 Dev; size 1024x1024; generation prompt: A majestic tabby cat]";
    expect(extractLegacyImageContext(legacy)).toEqual({
      content: "图片已经完成。",
      retainedImageContext: {
        modelName: "FLUX.2 Dev",
        prompt: "A majestic tabby cat",
        width: 1024,
        height: 1024,
      },
    });
    expect(stripInternalImageContext(legacy)).toBe("图片已经完成。");
    expect(stripInternalImageContext(
      "完成。\n\nInternal application context from a successful earlier image-tool call follows as JSON data.",
    )).toBe("完成。");
  });
});
