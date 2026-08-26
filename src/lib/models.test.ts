import { describe, expect, it } from "vitest";
import { FALLBACK_MODELS, formatContextWindow, searchModels } from "./models";

describe("Cloudflare-hosted chat catalog", () => {
  it("contains the complete synced chat catalog without the safety classifier", () => {
    expect(FALLBACK_MODELS).toHaveLength(28);
    expect(FALLBACK_MODELS.every((model) => model.id.startsWith("@cf/"))).toBe(true);
    expect(FALLBACK_MODELS.some((model) => model.id.includes("llama-guard"))).toBe(false);
  });

  it("finds models by provider and capability", () => {
    expect(searchModels(FALLBACK_MODELS, "openai", "reasoning").map((model) => model.name)).toEqual([
      "GPT-OSS 120B",
      "GPT-OSS 20B",
    ]);
    expect(searchModels(FALLBACK_MODELS, "", "vision").length).toBeGreaterThanOrEqual(5);
  });

  it("formats large context windows clearly", () => {
    expect(formatContextWindow(128000)).toBe("128K context");
    expect(formatContextWindow(1048576)).toBe("1.0M context");
  });
});
