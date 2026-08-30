import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebResearchPanel } from "./WebResearchPanel";

describe("WebResearchPanel", () => {
  it("shows activity while a web search is genuinely running", () => {
    const markup = renderToStaticMarkup(
      <WebResearchPanel
        language="zh"
        state={{ status: "searching", query: "Cloudflare Workers AI" }}
      />,
    );

    expect(markup).toContain("正在搜索网页");
    expect(markup).toContain("<i><b></b><b></b><b></b></i>");
  });

  it("never keeps the activity dots moving after the containing message settles", () => {
    const markup = renderToStaticMarkup(
      <WebResearchPanel
        language="zh"
        state={{ status: "searching", query: "Cloudflare Workers AI" }}
        sources={[{
          title: "Workers AI",
          url: "https://developers.cloudflare.com/workers-ai/",
          domain: "developers.cloudflare.com",
          index: 1,
        }]}
        settled
      />,
    );

    expect(markup).toContain("已查阅 1 个来源");
    expect(markup).not.toContain("正在搜索网页");
    expect(markup).not.toContain("<i><b></b><b></b><b></b></i>");
  });

  it("hides a stale active state when a settled message has no sources", () => {
    const markup = renderToStaticMarkup(
      <WebResearchPanel language="en" state={{ status: "reading", url: "https://example.com" }} settled />,
    );

    expect(markup).toBe("");
  });
});
