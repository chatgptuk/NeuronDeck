import { describe, expect, it } from "vitest";
import { formatElapsedDuration, formatMessageTimestamp } from "./time";

describe("message time formatting", () => {
  const current = new Date(2026, 7, 26, 14, 30);

  it("uses quiet relative day labels for recent messages", () => {
    expect(formatMessageTimestamp(new Date(2026, 7, 26, 0, 14).toISOString(), "zh", current)).toBe("今天 00:14");
    expect(formatMessageTimestamp(new Date(2026, 7, 25, 22, 5).toISOString(), "en", current)).toBe("Yesterday 22:05");
  });

  it("formats generation durations compactly", () => {
    expect(formatElapsedDuration(6_840, "zh")).toBe("6.8 秒");
    expect(formatElapsedDuration(72_000, "en")).toBe("1m 12s");
  });
});
