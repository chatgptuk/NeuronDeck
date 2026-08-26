import { NeuronGlyph } from "./ProductIcons";

const providerLogos: Record<string, string> = {
  DeepSeek: "/model-logos/deepseek.svg",
  Google: "/model-logos/google.svg",
  IBM: "/model-logos/ibm.svg",
  Meta: "/model-logos/meta.svg",
  "Mistral AI": "/model-logos/mistral.svg",
  "Moonshot AI": "/model-logos/moonshot.svg",
  NVIDIA: "/model-logos/nvidia.svg",
  OpenAI: "/model-logos/openai.svg",
  Qwen: "/model-logos/qwen.svg",
  "Z.ai": "/model-logos/zai.svg",
};

interface ProviderLogoProps {
  provider: string;
  fallbackClassName?: string;
}

export function ProviderLogo({ provider, fallbackClassName }: ProviderLogoProps) {
  const logo = providerLogos[provider];

  return logo ? (
    <img alt="" aria-hidden="true" src={logo} />
  ) : (
    <NeuronGlyph className={fallbackClassName} />
  );
}
