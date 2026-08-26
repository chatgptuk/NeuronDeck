import { describe, expect, it } from "vitest";
import {
  FALLBACK_MODELS,
  formatContextWindow,
  searchModels,
  sortModelsByPrice,
  supportsMultimodalAttachments,
} from "./models";

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

  it("only enables attachments for multimodal models", () => {
    const visionModel = FALLBACK_MODELS.find((model) => model.capabilities.includes("vision"));
    const textModel = FALLBACK_MODELS.find((model) => !model.capabilities.includes("vision"));
    expect(visionModel && supportsMultimodalAttachments(visionModel)).toBe(true);
    expect(textModel && supportsMultimodalAttachments(textModel)).toBe(false);
  });

  it("formats large context windows clearly", () => {
    expect(formatContextWindow(128000)).toBe("128K context");
    expect(formatContextWindow(1048576)).toBe("1.0M context");
  });

  it("sorts priced models by output then input cost and leaves unpriced models last", () => {
    const models = [
      FALLBACK_MODELS.find((model) => model.id === "@cf/openai/gpt-oss-120b")!,
      FALLBACK_MODELS.find((model) => model.id === "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b")!,
      FALLBACK_MODELS.find((model) => model.id === "@cf/google/gemma-2b-it-lora")!,
    ];

    expect(sortModelsByPrice(models).map((model) => model.id)).toEqual([
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      "@cf/openai/gpt-oss-120b",
      "@cf/google/gemma-2b-it-lora",
    ]);
  });
});
