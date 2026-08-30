import { Clock3, Download, FileText } from "lucide-react";
import { translations, type Language } from "../i18n";
import { formatElapsedDuration } from "../lib/time";
import type { GeneratedFile } from "../types";

interface GeneratedFileGalleryProps {
  files?: GeneratedFile[];
  language: Language;
}

const formatFileSize = (bytes: number, language: Language): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 })} MB`;
};

export function GeneratedFileGallery({ files = [], language }: GeneratedFileGalleryProps) {
  const t = translations[language];
  if (!files.length) return null;

  return (
    <div className="generated-file-list">
      {files.map((file) => (
        <article className="generated-file" key={file.id}>
          <span className="generated-file-icon"><FileText size={20} /></span>
          <span className="generated-file-copy">
            <strong>{file.fileName}</strong>
            <small>
              {file.format.toUpperCase()} · {formatFileSize(file.size, language)}
              {file.elapsedMs != null ? ` · ${t.fileGenerationDuration(formatElapsedDuration(file.elapsedMs, language))}` : ""}
            </small>
            {file.expiresAt ? (
              <em><Clock3 size={12} />{t.fileExpiresIn24Hours}</em>
            ) : null}
          </span>
          <a
            className="generated-file-download"
            href={file.downloadUrl}
            download={file.fileName}
            aria-label={t.downloadFile(file.fileName)}
            title={t.downloadFile(file.fileName)}
          ><Download size={17} /></a>
        </article>
      ))}
    </div>
  );
}
