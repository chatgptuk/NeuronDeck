import { describe, expect, it } from "vitest";
import { buildAiMessages, parseApiMessages } from "./chat-input";

const pixel = "data:image/png;base64,iVBORw0KGgo=";

describe("multimodal chat input", () => {
  it("rejects images for text-only models", () => {
    const result = parseApiMessages(
      [{ role: "user", content: "Describe it", attachments: [{ kind: "image", name: "pixel.png", mimeType: "image/png", dataUrl: pixel }] }],
      { supportsVision: false, maxImages: 0 },
    );
    expect(result).toEqual({ ok: false, code: "image_not_supported" });
  });

  it("builds structured image_url content for current vision models", () => {
    const result = parseApiMessages(
      [{ role: "user", content: "Describe it", attachments: [{ kind: "image", name: "pixel.png", mimeType: "image/png", dataUrl: pixel }] }],
      { supportsVision: true, maxImages: 4 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildAiMessages(result.messages, false)).toEqual({
      messages: [{ role: "user", content: [
        { type: "text", text: "Describe it" },
        { type: "image_url", image_url: { url: pixel } },
      ] }],
    });
  });

  it("uses the legacy top-level image field for Llama 3.2 Vision", () => {
    const result = parseApiMessages(
      [{ role: "user", content: "Describe it", attachments: [{ kind: "image", name: "pixel.png", mimeType: "image/png", dataUrl: pixel }] }],
      { supportsVision: true, maxImages: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input = buildAiMessages(result.messages, true);
    expect(input.image).toBe(pixel);
    expect(input.messages[0].content).toContain("Attached image");
  });

  it("adds converted document text to model context", () => {
    const result = parseApiMessages(
      [{ role: "user", content: "Summarize", attachments: [{ kind: "file", name: "brief.pdf", mimeType: "application/pdf", text: "Quarterly results" }] }],
      { supportsVision: false, maxImages: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildAiMessages(result.messages, false).messages[0].content).toContain("Quarterly results");
  });
});
