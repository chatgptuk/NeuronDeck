import catalog from "../data/models.generated.json";

export interface OutputTokenPolicy {
  recommended: number;
  maximum: number;
}

const contextWindowByModelId = new Map<string, number>(
  catalog.models.map((model) => [model.id, model.contextWindow]),
);

export const getOutputTokenPolicy = (contextWindow: number): OutputTokenPolicy => {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return { recommended: 2_048, maximum: 8_192 };
  }
  if (contextWindow < 8_192) return { recommended: 1_024, maximum: 2_048 };
  if (contextWindow <= 8_192) return { recommended: 2_048, maximum: 4_096 };
  if (contextWindow <= 32_768) return { recommended: 4_096, maximum: 8_192 };
  if (contextWindow <= 131_072) return { recommended: 8_192, maximum: 16_384 };
  if (contextWindow <= 524_288) return { recommended: 16_384, maximum: 32_768 };
  return { recommended: 32_768, maximum: 65_536 };
};

export const getOutputTokenPolicyForModel = (modelId: string): OutputTokenPolicy =>
  getOutputTokenPolicy(contextWindowByModelId.get(modelId) ?? 0);

export const clampOutputTokens = (value: unknown, policy: OutputTokenPolicy): number => {
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : policy.recommended;
  return Math.min(policy.maximum, Math.max(64, normalized));
};
