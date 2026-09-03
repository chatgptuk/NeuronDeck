import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generated image layout", () => {
  it("does not stretch a landscape image card to match a taller grid neighbor", () => {
    const styles = readFileSync("src/styles.css", "utf8");

    expect(styles).toMatch(/\.generated-image-grid \{[^}]*align-items: start;/);
    expect(styles).toMatch(/\.generated-image \{[^}]*align-self: start;/);
    expect(styles).toMatch(/\.generated-image > img \{[^}]*height: auto;/);
  });
});
