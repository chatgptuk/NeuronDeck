export const MAX_SPEECH_CHARACTERS = 3_000;

export const TTS_MODEL_IDS = {
  auraEnglish: "@cf/deepgram/aura-2-en",
  auraSpanish: "@cf/deepgram/aura-2-es",
} as const;

export type TtsModelId = typeof TTS_MODEL_IDS[keyof typeof TTS_MODEL_IDS];
export type SpeechMode = "quality" | "device";
export type SpeechLanguage = "en" | "es" | "fr" | "zh" | "jp" | "kr";

export interface CloudflareSpeechRequestSelection {
  source: "cloudflare";
  model: TtsModelId;
  language: SpeechLanguage;
}

export interface SystemSpeechRequestSelection {
  source: "system";
  language: SpeechLanguage;
}

export type SpeechRequestSelection = CloudflareSpeechRequestSelection | SystemSpeechRequestSelection;

const countMatches = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0;

export const detectSpeechLanguage = (text: string, fallback: "zh" | "en"): SpeechLanguage => {
  if (/[\u3040-\u30ff]/u.test(text)) return "jp";
  if (/[\uac00-\ud7af]/u.test(text)) return "kr";
  if (/[\u3400-\u9fff]/u.test(text)) return "zh";

  const normalized = ` ${text.toLocaleLowerCase()} `;
  const spanishScore = countMatches(
    normalized,
    /(?:[¿¡ñáéíóúü]|\b(?:el|la|los|las|una?|de|del|que|para|por|con|como|pero|gracias|hola|esto|esta|son|más)\b)/giu,
  );
  const frenchScore = countMatches(
    normalized,
    /(?:[àâçéèêëîïôùûüÿœ]|\b(?:le|la|les|une?|des|du|de|que|pour|avec|comme|mais|merci|bonjour|est|sont|plus)\b)/giu,
  );
  if (spanishScore >= 2 && spanishScore > frenchScore) return "es";
  if (frenchScore >= 2 && frenchScore > spanishScore) return "fr";
  if (/[a-z]/iu.test(text)) return "en";
  return fallback;
};

export const prepareSpeechText = (markdown: string): string => markdown
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/https?:\/\/\S+/gi, " ")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
  .replace(/[*_~>|]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, MAX_SPEECH_CHARACTERS);

export const resolveSpeechRequest = (
  mode: SpeechMode,
  text: string,
  fallback: "zh" | "en",
): SpeechRequestSelection => {
  const language = detectSpeechLanguage(text, fallback);
  if (mode === "quality" && language === "en") {
    return { source: "cloudflare", model: TTS_MODEL_IDS.auraEnglish, language };
  }
  if (mode === "quality" && language === "es") {
    return { source: "cloudflare", model: TTS_MODEL_IDS.auraSpanish, language };
  }
  return { source: "system", language };
};

export const isTtsModelId = (value: unknown): value is TtsModelId =>
  typeof value === "string" && Object.values(TTS_MODEL_IDS).includes(value as TtsModelId);

export const isSpeechLanguage = (value: unknown): value is SpeechLanguage =>
  value === "en" || value === "es" || value === "fr" || value === "zh" || value === "jp" || value === "kr";
