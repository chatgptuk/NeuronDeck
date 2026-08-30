import { describe, expect, it } from "vitest";
import { FALLBACK_MODELS, formatContextWindow } from "./lib/models";
import {
  getCapabilityLabel,
  getModelDescription,
  getLocalizedError,
  isBuiltInDefaultSystemPrompt,
  translations,
} from "./i18n";

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

  it("offers code, image, and casual-chat starters in that order", () => {
    expect(translations.zh.starterPrompts.map((item) => item.label)).toEqual([
      "写一段代码",
      "生成一张图片",
      "随便聊聊",
    ]);
    expect(translations.zh.welcomeDescription).toContain("Cloudflare 自托管模型");
  });

  it("keeps English available", () => {
    expect(formatContextWindow(1048576, "en")).toBe("1.0M context");
    expect(getCapabilityLabel("vision", "en")).toBe("vision");
  });

  it("treats lawful consenting-adult topics as ordinary while retaining clear harm boundaries", () => {
    expect(translations.zh.defaultSystemPrompt).toContain("合法、自愿成人话题");
    expect(translations.zh.defaultSystemPrompt).toContain("未成年人");
    expect(translations.en.defaultSystemPrompt).toContain("clearly identified adults");
    expect(translations.en.defaultSystemPrompt).toContain("non-consent");
  });

  it("migrates prior built-in prompts without overwriting custom prompts", () => {
    expect(isBuiltInDefaultSystemPrompt("你是一位准确、周到的助手。请坦诚说明不确定之处，并使用清晰的格式。")).toBe(true);
    expect(isBuiltInDefaultSystemPrompt(translations.en.defaultSystemPrompt)).toBe(true);
    expect(isBuiltInDefaultSystemPrompt("Always answer like a pirate.")).toBe(false);
  });
});
