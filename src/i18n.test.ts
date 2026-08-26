import { describe, expect, it } from "vitest";
import { FALLBACK_MODELS, formatContextWindow } from "./lib/models";
import { getCapabilityLabel, getModelDescription, getLocalizedError, translations } from "./i18n";

describe("Chinese localization", () => {
  it("provides a Chinese description for every chat model", () => {
    for (const model of FALLBACK_MODELS) {
      const description = getModelDescription(model, "zh");
      expect(description).not.toBe(model.description);
      expect(description).toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it("localizes model metadata and errors", () => {
    expect(formatContextWindow(128000, "zh")).toBe("128K 上下文");
    expect(getCapabilityLabel("reasoning", "zh")).toBe("推理");
    expect(getLocalizedError("zh", "rate_limited", "fallback")).toBe(translations.zh.errors.rate_limited);
  });

  it("keeps English available", () => {
    expect(formatContextWindow(1048576, "en")).toBe("1.0M context");
    expect(getCapabilityLabel("vision", "en")).toBe("vision");
  });
});
