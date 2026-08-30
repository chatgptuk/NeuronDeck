import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static security headers", () => {
  it("allows generated audio blob URLs without weakening other CSP defaults", () => {
    const headers = readFileSync("public/_headers", "utf8");
    const contentSecurityPolicy = headers
      .split("\n")
      .find((line: string) => line.trimStart().startsWith("Content-Security-Policy:"));

    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("media-src 'self' blob:");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
  });

  it("revalidates HTML while keeping content-hashed assets immutable", () => {
    const headers = readFileSync("public/_headers", "utf8");

    expect(headers).toMatch(/\/\n\s+Cache-Control: no-cache, no-store, must-revalidate/);
    expect(headers).toMatch(/\/\*\.html\n\s+Cache-Control: no-cache, no-store, must-revalidate/);
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});
