import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const structuredData = (html: string): unknown[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));

describe("search engine discovery", () => {
  it("gives the application homepage canonical metadata and valid WebApplication data", () => {
    const html = read("index.html");
    const data = structuredData(html);

    expect(html).toContain('<link rel="canonical" href="https://ai.chatgpt.org.uk/"');
    expect(html).toContain('<meta name="robots" content="index,follow');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      "@type": "WebApplication",
      name: "NeuronDeck",
      applicationCategory: "UtilitiesApplication",
      offers: { price: "0", priceCurrency: "USD" },
    });
  });

  it.each([
    ["zh-CN", "public/zh/cloudflare-workers-ai-chat.html", "https://ai.chatgpt.org.uk/zh/cloudflare-workers-ai-chat"],
    ["en", "public/en/cloudflare-workers-ai-chat.html", "https://ai.chatgpt.org.uk/en/cloudflare-workers-ai-chat"],
  ])("serves a substantive %s landing page with reciprocal language links", (_language, path, canonical) => {
    const html = read(path);

    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
    expect(html).toContain('hreflang="zh-CN"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="x-default"');
    const heading = html.match(/<h1>([^<]+)<\/h1>/)?.[1] ?? "";
    expect(heading.length).toBeGreaterThan(10);
    expect(html).toContain('href="/"');
    expect(html.match(/<article class="feature">/g)).toHaveLength(6);
    expect(html.match(/<details>/g)).toHaveLength(4);
    expect(structuredData(html)).toHaveLength(1);
  });

  it("advertises only canonical public pages to crawlers", () => {
    const robots = read("public/robots.txt");
    const sitemap = read("public/sitemap.xml");

    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://ai.chatgpt.org.uk/sitemap.xml");
    expect(sitemap).toContain("https://ai.chatgpt.org.uk/");
    expect(sitemap).toContain("https://ai.chatgpt.org.uk/zh/cloudflare-workers-ai-chat");
    expect(sitemap).toContain("https://ai.chatgpt.org.uk/en/cloudflare-workers-ai-chat");
    expect(sitemap).not.toContain("/admin");
    expect(sitemap).not.toContain("/api/");
  });
});
