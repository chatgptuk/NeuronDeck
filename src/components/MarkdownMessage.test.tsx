import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

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
});
