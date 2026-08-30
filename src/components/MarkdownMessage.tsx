import { Children, isValidElement, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { translations, type Language } from "../i18n";
import type { WebSource } from "../types";

const textFromNode = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
};

const CodeBlock = ({ children, language }: { children?: ReactNode; language: Language }) => {
  const [copied, setCopied] = useState(false);
  const t = translations[language];
  const code = Children.toArray(children).map(textFromNode).join("").replace(/\n$/, "");

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="code-block">
      <button className="code-copy" onClick={copy} type="button">
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? t.copied : t.copy}
      </button>
      <pre>{children}</pre>
    </div>
  );
};

export const linkifyCitationMarkers = (content: string, sources: WebSource[] = []): string => {
  if (!sources.length) return content;
  const byIndex = new Map(sources.map((source, offset) => [source.index ?? offset + 1, source.url]));
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment, offset) => {
      if (offset % 2 === 1) return segment;
      return segment.replace(/(?<!\[)\[(\d{1,2})\](?!\()/g, (marker, rawIndex: string) => {
        const url = byIndex.get(Number(rawIndex));
        return url ? `[${marker}](${url})` : marker;
      });
    })
    .join("");
};

export function MarkdownMessage({
  content,
  language,
  sources = [],
}: {
  content: string;
  language: Language;
  sources?: WebSource[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre: ({ children }) => <CodeBlock language={language}>{children}</CodeBlock>,
        a: ({ children, href }) => {
          const citation = /^\[\d{1,2}\]$/.test(textFromNode(children));
          return (
            <a
              className={citation ? "citation-link" : undefined}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >{children}</a>
          );
        },
      }}
    >
      {linkifyCitationMarkers(content, sources)}
    </ReactMarkdown>
  );
}
