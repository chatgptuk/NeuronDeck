import { Children, isValidElement, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { translations, type Language } from "../i18n";

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

export function MarkdownMessage({ content, language }: { content: string; language: Language }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ pre: ({ children }) => <CodeBlock language={language}>{children}</CodeBlock> }}
    >
      {content}
    </ReactMarkdown>
  );
}
