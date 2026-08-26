import catalog from "../data/models.generated.json";
import type { Language } from "../i18n";
import type { ModelInfo } from "../types";

export const FALLBACK_MODELS = catalog.models as ModelInfo[];
export const CATALOG_SYNCED_AT = catalog.syncedAt;
export const DEFAULT_MODEL_ID = "@cf/zai-org/glm-4.7-flash";

export const getModel = (models: ModelInfo[], id: string): ModelInfo =>
  models.find((model) => model.id === id) ?? models[0] ?? FALLBACK_MODELS[0];

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
