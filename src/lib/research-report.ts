import type { Language } from "../i18n";
import type { WebSource } from "../types";
import { getClientId } from "./client-id";

interface ResearchReportRequest {
  title: string;
  content: string;
  sources: WebSource[];
  language: Language;
}

const readDownloadName = (header: string | null, fallback: string): string => {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the ASCII filename.
    }
  }
  const ascii = header?.match(/filename="([^"]+)"/i)?.[1];
  return ascii || fallback;
};

const safeFallbackName = (title: string): string => {
  const base = title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "neurondeck-research";
  return `${base}.pdf`;
};

export const downloadResearchReportPdf = async ({
  title,
  content,
  sources,
  language,
}: ResearchReportRequest): Promise<void> => {
  const response = await fetch("/api/research-report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-neurondeck-client": getClientId(),
    },
    body: JSON.stringify({ title, content, sources, language }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || `Research report export failed (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("The research report PDF is empty.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = readDownloadName(response.headers.get("content-disposition"), safeFallbackName(title));
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
