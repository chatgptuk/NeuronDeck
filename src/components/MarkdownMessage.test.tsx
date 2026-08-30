import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";
import { linkifyCitationMarkers } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders structured reasoning markdown", () => {
    const markup = renderToStaticMarkup(
      <MarkdownMessage
        content={"## 分析\n\n- **第一步**\n- `第二步`\n\n```ts\nconst ready = true;\n```"}
        language="zh"
      />,
    );

    expect(markup).toContain("<h2>分析</h2>");
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<strong>第一步</strong>");
    expect(markup).toContain("<code>第二步</code>");
    expect(markup).toContain("hljs language-ts");
  });

  it("turns numbered research citations into source links without touching code", () => {
    const sources = [
      { title: "Primary source", url: "https://example.com/report", domain: "example.com", index: 1 },
    ];
    const content = "Verified fact.[1]\n\n`const source = [1]`\n\n```txt\n[1]\n```";
    const linked = linkifyCitationMarkers(content, sources);
    expect(linked).toContain("Verified fact.[[1]](https://example.com/report)");
    expect(linked).toContain("`const source = [1]`");
    expect(linked).toContain("```txt\n[1]\n```");

    const markup = renderToStaticMarkup(<MarkdownMessage content={content} language="en" sources={sources} />);
    expect(markup).toContain('class="citation-link"');
    expect(markup).toContain('href="https://example.com/report"');
  });
});
