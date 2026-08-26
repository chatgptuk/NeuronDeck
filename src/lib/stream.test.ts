import { describe, expect, it } from "vitest";
import { parseSseData } from "./stream";

describe("Workers AI stream parser", () => {
  it("parses Workers AI response chunks", () => {
    expect(parseSseData('{"response":"hello"}')).toEqual({ content: "hello" });
  });

  it("parses OpenAI-compatible deltas", () => {
    expect(parseSseData('{"choices":[{"delta":{"content":"edge"}}]}')).toEqual({ content: "edge" });
  });

  it("recognizes completion events", () => {
    expect(parseSseData("[DONE]")).toEqual({ done: true });
  });
});
