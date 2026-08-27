import { describe, expect, it } from "vitest";
import {
  detectSpeechLanguage,
  MAX_SPEECH_CHARACTERS,
  prepareSpeechText,
  resolveSpeechRequest,
  TTS_MODEL_IDS,
} from "./speech";

describe("speech model selection", () => {
  it("routes Chinese and mixed Chinese-English text to the device voice", () => {
    const text = "今天介绍 Cloudflare Workers AI 的语音功能。";
    expect(detectSpeechLanguage(text, "en")).toBe("zh");
    expect(resolveSpeechRequest("quality", text, "zh")).toEqual({
      source: "system",
      language: "zh",
    });
  });

  it("uses the matching Aura-2 endpoint for English and Spanish quality mode", () => {
    expect(resolveSpeechRequest("quality", "Thanks for calling. Your order shipped yesterday.", "en")).toEqual({
      source: "cloudflare",
      model: TTS_MODEL_IDS.auraEnglish,
      language: "en",
    });
    expect(resolveSpeechRequest("quality", "Thanks for calling. Your order shipped yesterday.", "zh")).toEqual({
      source: "cloudflare",
      model: TTS_MODEL_IDS.auraEnglish,
      language: "en",
    });
    expect(resolveSpeechRequest("quality", "Hola, gracias por llamar. El pedido ya está en camino.", "en")).toEqual({
      source: "cloudflare",
      model: TTS_MODEL_IDS.auraSpanish,
      language: "es",
    });
  });

  it("keeps device mode on local system voices for every supported language", () => {
    expect(resolveSpeechRequest("device", "Bonjour, merci pour votre message.", "en")).toEqual({
      source: "system",
      language: "fr",
    });
    expect(resolveSpeechRequest("device", "こんにちは、今日はいい天気です。", "en").language).toBe("jp");
    expect(resolveSpeechRequest("device", "안녕하세요. 반갑습니다.", "en").language).toBe("kr");
  });
});

describe("speech text preparation", () => {
  it("removes Markdown syntax, links, URLs, and fenced code", () => {
    const result = prepareSpeechText("## Hello\n\nRead **this** [guide](https://example.com).\n```ts\nconst secret = 1;\n```");
    expect(result).toBe("Hello Read this guide.");
  });

  it("caps generated speech to the server-side character limit", () => {
    expect(prepareSpeechText("a".repeat(MAX_SPEECH_CHARACTERS + 20))).toHaveLength(MAX_SPEECH_CHARACTERS);
  });
});
