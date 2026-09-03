import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { masonryRowSpan } from "./src/components/GeneratedImageGallery";

describe("generated image layout", () => {
  it("does not stretch a landscape image card to match a taller grid neighbor", () => {
    const styles = readFileSync("src/styles.css", "utf8");

    expect(styles).toMatch(/\.generated-image-grid \{[^}]*align-items: start;/);
    expect(styles).toMatch(/\.generated-image-grid\.multi \{[^}]*grid-auto-flow: dense;/);
    expect(styles).toMatch(/\.generated-image-grid\.multi \{[^}]*grid-auto-rows: 1px;/);
    expect(styles).toMatch(/\.generated-image \{[^}]*align-self: start;/);
    expect(styles).toMatch(/\.generated-image > img \{[^}]*height: auto;/);
  });

  it("reserves each masonry card's own height plus the visual gutter", () => {
    expect(masonryRowSpan(250)).toBe(262);
    expect(masonryRowSpan(720)).toBe(732);
    expect(masonryRowSpan(250, 2)).toBe(131);
  });
});
