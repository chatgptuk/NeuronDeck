import { Camera, Clock3, Download, ExternalLink, Globe2, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import type { Language } from "../i18n";
import { translations } from "../i18n";
import { downloadResearchReportPdf } from "../lib/research-report";
import type { WebResearchState, WebSource } from "../types";

interface WebResearchPanelProps {
  language: Language;
  state?: WebResearchState;
  sources?: WebSource[];
  reportTitle?: string;
  reportContent?: string;
  settled?: boolean;
}

const formatAccessedAt = (value: string | undefined, language: Language): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export function WebResearchPanel({
  language,
  state,
  sources = [],
  reportTitle = "NeuronDeck Research",
  reportContent = "",
  settled = false,
}: WebResearchPanelProps) {
  const t = translations[language];
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const stateIsActive = state?.status === "searching" || state?.status === "reading" || state?.status === "capturing";
  const visibleState: WebResearchState | undefined = settled && state && stateIsActive
    ? { ...state, status: "complete" }
    : state;
  if ((!visibleState || visibleState.status === "complete") && !sources.length) return null;
  const active = visibleState?.status === "searching" || visibleState?.status === "reading" || visibleState?.status === "capturing";
  const label = visibleState?.status === "searching"
    ? language === "zh" ? "正在搜索网页" : "Searching the web"
    : visibleState?.status === "reading"
      ? language === "zh" ? "正在读取网页" : "Reading webpage"
      : visibleState?.status === "capturing"
        ? language === "zh" ? "正在截取网页" : "Capturing webpage"
      : visibleState?.status === "error"
        ? language === "zh" ? "网页工具暂时不可用" : "Web tool unavailable"
        : language === "zh" ? "已查阅来源" : "Sources consulted";
  const detail = visibleState?.query || (visibleState?.url ? (() => {
    try { return new URL(visibleState.url).hostname.replace(/^www\./, ""); } catch { return visibleState.url; }
  })() : visibleState?.message);

  const exportPdf = async () => {
    if (!reportContent.trim() || !sources.length || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadResearchReportPdf({ title: reportTitle, content: reportContent, sources, language });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t.researchPdfFailed);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={visibleState?.status === "error" ? "web-research error" : "web-research"} aria-live="polite">
      {visibleState && visibleState.status !== "complete" ? (
        <div className="web-research-status">
          <span>{visibleState.status === "searching" ? <Search size={15} /> : visibleState.status === "capturing" ? <Camera size={15} /> : <Globe2 size={15} />}</span>
          <span><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span>
          {active ? <i><b /><b /><b /></i> : null}
        </div>
      ) : null}
      {sources.length ? (
        <div className="web-source-list">
          <div className="web-source-heading">
            <span><Globe2 size={13} />{t.researchSources(sources.length)}</span>
            {reportContent.trim() ? (
              <button type="button" onClick={() => void exportPdf()} disabled={exporting}>
                {exporting ? <LoaderCircle className="spinning" size={13} /> : <Download size={13} />}
                {exporting ? t.researchPdfExporting : t.researchPdfExport}
              </button>
            ) : null}
          </div>
          <div className="web-source-cards">
            {sources.map((source, offset) => (
              <a href={source.url} key={source.url} target="_blank" rel="noopener noreferrer">
                <b>[{source.index ?? offset + 1}]</b>
                <span>
                  <small>{source.domain}</small>
                  <strong>{source.title}</strong>
                  {formatAccessedAt(source.accessedAt, language) ? (
                    <em><Clock3 size={11} />{t.researchSourceAccessed(formatAccessedAt(source.accessedAt, language)!)}</em>
                  ) : null}
                </span>
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
          {exportError ? <p className="web-source-error" role="alert">{exportError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
