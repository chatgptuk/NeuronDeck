import type { SpeechLanguage } from "./speech";

const SPEECH_LOCALES: Record<SpeechLanguage, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  zh: "zh-CN",
  jp: "ja-JP",
  kr: "ko-KR",
};

const normalizeLocale = (value: string): string => value.replaceAll("_", "-").toLowerCase();

export const getSystemSpeechLocale = (language: SpeechLanguage): string => SPEECH_LOCALES[language];

export const selectSystemSpeechVoice = (
  voices: readonly SpeechSynthesisVoice[],
  language: SpeechLanguage,
): SpeechSynthesisVoice | null => {
  const targetLocale = normalizeLocale(SPEECH_LOCALES[language]);
  const targetLanguage = targetLocale.split("-")[0];
  const candidates = voices
    .map((voice, index) => {
      const locale = normalizeLocale(voice.lang);
      const sameLanguage = locale === targetLanguage || locale.startsWith(`${targetLanguage}-`);
      if (!sameLanguage) return null;
      const score = (locale === targetLocale ? 100 : 70) +
        (voice.localService ? 20 : 0) +
        (voice.default ? 8 : 0) -
        index / 1_000;
      return { voice, score };
    })
    .filter((candidate): candidate is { voice: SpeechSynthesisVoice; score: number } => candidate !== null)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.voice ?? null;
};

export const waitForSystemSpeechVoices = async (
  synthesis: SpeechSynthesis,
  timeoutMilliseconds = 1_200,
): Promise<SpeechSynthesisVoice[]> => {
  const initial = synthesis.getVoices();
  if (initial.length) return initial;

  return new Promise((resolve) => {
    let finished = false;
    const startedAt = Date.now();
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (finished) return;
      finished = true;
      window.clearInterval(pollTimer);
      synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(voices);
    };
    const readVoices = () => {
      const voices = synthesis.getVoices();
      if (voices.length || Date.now() - startedAt >= timeoutMilliseconds) finish(voices);
    };
    const handleVoicesChanged = () => readVoices();
    const pollTimer = window.setInterval(readVoices, 100);
    synthesis.addEventListener("voiceschanged", handleVoicesChanged);
    readVoices();
  });
};

export const splitSystemSpeechText = (text: string, maximumChunkLength = 220): string[] => {
  const segments = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/gu) ?? [text];
  const chunks: string[] = [];
  let current = "";

  const append = (segment: string) => {
    const value = segment.trim();
    if (!value) return;
    if (value.length > maximumChunkLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < value.length; index += maximumChunkLength) {
        chunks.push(value.slice(index, index + maximumChunkLength));
      }
      return;
    }
    if (current && current.length + value.length > maximumChunkLength) {
      chunks.push(current);
      current = value;
      return;
    }
    current += value;
  };

  segments.forEach(append);
  if (current) chunks.push(current);
  return chunks;
};
