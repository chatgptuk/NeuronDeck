import catalog from "../data/models.generated.json";
import type { Language } from "../i18n";
import type { ModelInfo } from "../types";

export const FALLBACK_MODELS = catalog.models as ModelInfo[];
export const CATALOG_SYNCED_AT = catalog.syncedAt;
export const DEFAULT_MODEL_ID = "@cf/moonshotai/kimi-k2.7-code";

const MODEL_DISPLAY_PRIORITY = [
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
] as const;

export const getModel = (models: ModelInfo[], id: string): ModelInfo =>
  models.find((model) => model.id === id) ?? models[0] ?? FALLBACK_MODELS[0];

export const supportsMultimodalAttachments = (model: ModelInfo): boolean =>
  model.capabilities.includes("vision");

export const formatContextWindow = (tokens: number, language: Language = "en"): string => {
  if (!tokens) return language === "zh" ? "上下文未知" : "Context n/a";
  let value: string;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    value = `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  } else {
    value = `${Math.round(tokens / 1000)}K`;
  }
  return `${value}${language === "zh" ? " 上下文" : " context"}`;
};

export const formatPrice = (price?: number): string =>
  price == null ? "—" : `$${price < 0.1 ? price.toFixed(3) : price.toFixed(2)}`;

export const sortModelsByPrice = (
  models: ModelInfo[],
  favoriteIds: string[] = [],
): ModelInfo[] => {
  const sorted = [...models].sort((a, b) => {
    const aPriorityIndex = MODEL_DISPLAY_PRIORITY.indexOf(a.id as (typeof MODEL_DISPLAY_PRIORITY)[number]);
    const bPriorityIndex = MODEL_DISPLAY_PRIORITY.indexOf(b.id as (typeof MODEL_DISPLAY_PRIORITY)[number]);
    const aIsPrioritized = aPriorityIndex >= 0;
    const bIsPrioritized = bPriorityIndex >= 0;
    if (aIsPrioritized || bIsPrioritized) {
      if (aIsPrioritized && bIsPrioritized) return aPriorityIndex - bPriorityIndex;
      return aIsPrioritized ? -1 : 1;
    }

    const aHasPrice = a.prices.output != null || a.prices.input != null;
    const bHasPrice = b.prices.output != null || b.prices.input != null;
    if (aHasPrice !== bHasPrice) return Number(bHasPrice) - Number(aHasPrice);

    const outputDifference = (b.prices.output ?? -1) - (a.prices.output ?? -1);
    if (outputDifference) return outputDifference;

    const inputDifference = (b.prices.input ?? -1) - (a.prices.input ?? -1);
    if (inputDifference) return inputDifference;

    const favoriteDifference = Number(favoriteIds.includes(b.id)) - Number(favoriteIds.includes(a.id));
    return favoriteDifference || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
  });

  const glm52Id = "@cf/zai-org/glm-5.2";
  const glm53Id = "@cf/zai-org/glm-5.3-flash";
  const glm52Index = sorted.findIndex((model) => model.id === glm52Id);
  const glm53Index = sorted.findIndex((model) => model.id === glm53Id);
  if (glm52Index >= 0 && glm53Index >= 0 && glm53Index !== glm52Index + 1) {
    const [glm53] = sorted.splice(glm53Index, 1);
    const updatedGlm52Index = sorted.findIndex((model) => model.id === glm52Id);
    sorted.splice(updatedGlm52Index + 1, 0, glm53);
  }

  return sorted;
};

export const searchModels = (
  models: ModelInfo[],
  query: string,
  capability: "all" | "reasoning" | "vision" | "tools" | "paid" | "lora",
): ModelInfo[] => {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    const matchesQuery =
      !normalized ||
      [model.name, model.id, model.provider, model.description]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    const matchesCapability =
      capability === "all" ||
      (capability === "paid" && model.paid) ||
      (capability === "lora" && model.lora) ||
      model.capabilities.includes(capability as "reasoning" | "vision" | "tools");
    return matchesQuery && matchesCapability;
  });
};
