export const DEFAULT_IMAGE_MODEL_ID = "@cf/black-forest-labs/flux-2-klein-9b";

export interface ImageModelInfo {
  id: string;
  name: string;
  provider: "Black Forest Labs" | "Leonardo";
  summary: {
    zh: string;
    en: string;
  };
  price: {
    zh: string;
    en: string;
  };
  profile: "balanced" | "quality" | "design" | "prompt";
}

export const IMAGE_MODELS: readonly ImageModelInfo[] = [
  {
    id: DEFAULT_IMAGE_MODEL_ID,
    name: "FLUX.2 Klein 9B",
    provider: "Black Forest Labs",
    summary: {
      zh: "速度与画质最均衡，适合日常创作",
      en: "The best balance of speed and quality for everyday creation",
    },
    price: {
      zh: "$0.015 / 首个百万像素",
      en: "$0.015 / first megapixel",
    },
    profile: "balanced",
  },
  {
    id: "@cf/black-forest-labs/flux-2-dev",
    name: "FLUX.2 Dev",
    provider: "Black Forest Labs",
    summary: {
      zh: "细节与真实感优先，生成速度较慢",
      en: "Prioritizes detail and realism with a slower render",
    },
    price: {
      zh: "按图块与步数计费",
      en: "Priced by tile and step",
    },
    profile: "quality",
  },
  {
    id: "@cf/leonardo/lucid-origin",
    name: "Lucid Origin",
    provider: "Leonardo",
    summary: {
      zh: "擅长视觉设计、产品图与画面文字",
      en: "Excellent for visual design, product shots, and text",
    },
    price: {
      zh: "$0.007 / 512px 图块",
      en: "$0.007 / 512px tile",
    },
    profile: "design",
  },
  {
    id: "@cf/leonardo/phoenix-1.0",
    name: "Phoenix 1.0",
    provider: "Leonardo",
    summary: {
      zh: "提示词遵循出色，也善于生成连贯文字",
      en: "Strong prompt adherence with coherent rendered text",
    },
    price: {
      zh: "$0.0058 / 512px 图块",
      en: "$0.0058 / 512px tile",
    },
    profile: "prompt",
  },
] as const;

const imageModelIds = new Set(IMAGE_MODELS.map((model) => model.id));

export const isImageModelId = (value: unknown): value is string =>
  typeof value === "string" && imageModelIds.has(value);

export const getImageModel = (modelId: string): ImageModelInfo =>
  IMAGE_MODELS.find((model) => model.id === modelId) ?? IMAGE_MODELS[0];
