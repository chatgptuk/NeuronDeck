import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  formatContextWindow,
  searchModels,
  sortModelsByPrice,
  supportsMultimodalAttachments,
} from "./models";

describe("Cloudflare-hosted chat catalog", () => {
  it("uses GLM 5.3 Flash as the default model", () => {
    expect(DEFAULT_MODEL_ID).toBe("@cf/zai-org/glm-5.3-flash");
    expect(FALLBACK_MODELS.some((model) => model.id === DEFAULT_MODEL_ID)).toBe(true);
  });

  it("contains the complete synced chat catalog without the safety classifier", () => {
    expect(FALLBACK_MODELS).toHaveLength(30);
    expect(FALLBACK_MODELS.every((model) => model.id.startsWith("@cf/"))).toBe(true);
    expect(FALLBACK_MODELS.some((model) => model.id.includes("llama-guard"))).toBe(false);
    expect(FALLBACK_MODELS.find((model) => model.id === "@cf/zai-org/glm-5.3-flash")).toMatchObject({
      contextWindow: 1_310_720,
      capabilities: ["reasoning", "tools", "vision"],
      paid: true,
    });
  });

  it("exposes GLM 5.3 as a distinct text and tool model without enabling image uploads", () => {
    const model = searchModels(FALLBACK_MODELS, "glm-5.3", "tools")
      .find((model) => model.id === "@cf/zai-org/glm-5.3");
    expect(model).toMatchObject({ name: "GLM 5.3", provider: "Z.ai", paid: true });
    expect(model && supportsMultimodalAttachments(model)).toBe(false);
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

  it("puts GLM 5.3 Flash first and keeps R1 Distill behind current DeepSeek models", () => {
    expect(sortModelsByPrice(FALLBACK_MODELS).slice(0, 6).map((model) => model.id)).toEqual([
      "@cf/zai-org/glm-5.3-flash",
      "@cf/moonshotai/kimi-k2.7-code",
      "@cf/moonshotai/kimi-k2.6",
      "@cf/deepseek-ai/deepseek-v4-pro-0813",
      "@cf/deepseek-ai/deepseek-v4-flash-0731",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    ]);
  });

  it("keeps GLM 5.3 Flash first even when the full catalog is price-sorted", () => {
    const ids = sortModelsByPrice(FALLBACK_MODELS).map((model) => model.id);
    expect(ids[0]).toBe("@cf/zai-org/glm-5.3-flash");
  });
});
