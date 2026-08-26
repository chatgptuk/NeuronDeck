import { describe, expect, it } from "vitest";
import { clampOutputTokens, getOutputTokenPolicy } from "./output-tokens";

describe("context-aware output token policy", () => {
  it.each([
    [3_500, 1_024, 2_048],
    [8_192, 2_048, 4_096],
    [32_768, 4_096, 8_192],
    [131_072, 8_192, 16_384],
    [262_144, 16_384, 32_768],
    [1_048_576, 32_768, 65_536],
  ])("maps %i context tokens to a suitable output range", (context, recommended, maximum) => {
    expect(getOutputTokenPolicy(context)).toEqual({ recommended, maximum });
  });

  it("falls back safely and clamps user input to the model policy", () => {
    const policy = getOutputTokenPolicy(131_072);
    expect(clampOutputTokens(undefined, policy)).toBe(8_192);
    expect(clampOutputTokens(20, policy)).toBe(64);
    expect(clampOutputTokens(99_999, policy)).toBe(16_384);
  });
});
