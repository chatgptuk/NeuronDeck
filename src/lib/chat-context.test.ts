import { describe, expect, it } from "vitest";
import { getMessageContentForRequest } from "./chat-context";

describe("chat image context", () => {
  it("retains the last generated image prompt for referential follow-ups", () => {
    const content = getMessageContentForRequest({
      id: "assistant-1",
      role: "assistant",
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
    });

    expect(content).toContain("图片已经完成。");
    expect(content).toContain("a real image was generated with FLUX");
    expect(content).toContain("A candid street portrait in warm autumn light");
  });

  it("does not alter ordinary messages", () => {
    expect(getMessageContentForRequest({
      id: "user-1",
      role: "user",
      content: "再来一张",
      createdAt: "2026-08-26T00:00:00.000Z",
    })).toBe("再来一张");
  });
});
