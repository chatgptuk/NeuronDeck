import { Camera, ExternalLink, Globe2, Search } from "lucide-react";
import type { Language } from "../i18n";
import type { WebResearchState, WebSource } from "../types";

interface WebResearchPanelProps {
  language: Language;
  state?: WebResearchState;
  sources?: WebSource[];
}

export function WebResearchPanel({ language, state, sources = [] }: WebResearchPanelProps) {
  if ((!state || state.status === "complete") && !sources.length) return null;
  const active = state?.status === "searching" || state?.status === "reading" || state?.status === "capturing";
  const label = state?.status === "searching"
    ? language === "zh" ? "正在搜索网页" : "Searching the web"
    : state?.status === "reading"
      ? language === "zh" ? "正在读取网页" : "Reading webpage"
      : state?.status === "capturing"
        ? language === "zh" ? "正在截取网页" : "Capturing webpage"
      : state?.status === "error"
        ? language === "zh" ? "网页工具暂时不可用" : "Web tool unavailable"
        : language === "zh" ? "已查阅来源" : "Sources consulted";
  const detail = state?.query || (state?.url ? (() => {
    try { return new URL(state.url).hostname.replace(/^www\./, ""); } catch { return state.url; }
  })() : state?.message);

  return (
    <section className={state?.status === "error" ? "web-research error" : "web-research"} aria-live="polite">
      {state && state.status !== "complete" ? (
        <div className="web-research-status">
          <span>{state.status === "searching" ? <Search size={15} /> : state.status === "capturing" ? <Camera size={15} /> : <Globe2 size={15} />}</span>
          <span><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span>
          {active ? <i><b /><b /><b /></i> : null}
        </div>
      ) : null}
      {sources.length ? (
        <div className="web-source-list">
          <span className="web-source-heading"><Globe2 size={13} />{language === "zh" ? "来源" : "Sources"}</span>
          <div>
            {sources.map((source) => (
              <a href={source.url} key={source.url} target="_blank" rel="noopener noreferrer">
                <span><small>{source.domain}</small><strong>{source.title}</strong></span>
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
