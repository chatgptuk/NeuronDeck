import { describe, expect, it } from "vitest";
import { getSystemSpeechLocale, selectSystemSpeechVoice, splitSystemSpeechText } from "./system-speech";

const voice = (name: string, lang: string, localService: boolean, isDefault = false): SpeechSynthesisVoice => ({
  name,
  lang,
  localService,
  default: isDefault,
  voiceURI: name,
});

describe("system speech voices", () => {
  it("maps internal language names to browser language tags", () => {
    expect(getSystemSpeechLocale("zh")).toBe("zh-CN");
    expect(getSystemSpeechLocale("jp")).toBe("ja-JP");
    expect(getSystemSpeechLocale("kr")).toBe("ko-KR");
  });

  it("prefers a local exact-locale Chinese voice", () => {
    const browserChinese = voice("Browser Mandarin", "zh-CN", false, true);
    const deviceChinese = voice("Device Mandarin", "zh_CN", true);
    const cantonese = voice("Device Cantonese", "zh-HK", true);
    expect(selectSystemSpeechVoice([browserChinese, cantonese, deviceChinese], "zh")).toBe(deviceChinese);
  });

  it("uses another Chinese variant before an unrelated voice", () => {
    const english = voice("English", "en-US", true, true);
    const traditionalChinese = voice("Traditional Chinese", "zh-TW", true);
    expect(selectSystemSpeechVoice([english, traditionalChinese], "zh")).toBe(traditionalChinese);
    expect(selectSystemSpeechVoice([english], "zh")).toBeNull();
  });
});

describe("system speech chunking", () => {
  it("keeps sentence boundaries while limiting long browser utterances", () => {
    const chunks = splitSystemSpeechText("第一句话。第二句话很短！第三句话也很短。", 12);
    expect(chunks).toEqual(["第一句话。第二句话很短！", "第三句话也很短。"]);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
  });

  it("splits a single oversized segment", () => {
    expect(splitSystemSpeechText("一".repeat(25), 10).map((chunk) => chunk.length)).toEqual([10, 10, 5]);
  });
});
