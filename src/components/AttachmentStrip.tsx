import { FileText, X } from "lucide-react";
import { translations, type Language } from "../i18n";
import { formatFileSize } from "../lib/attachments";
import type { Attachment } from "../types";

interface AttachmentStripProps {
  attachments: Attachment[];
  language: Language;
  onRemove?: (id: string) => void;
  pending?: boolean;
}

export function AttachmentStrip({ attachments, language, onRemove, pending = false }: AttachmentStripProps) {
  if (!attachments.length) return null;
  const t = translations[language];

  return (
    <div className={pending ? "attachment-strip pending" : "attachment-strip"} aria-label={t.attachmentList}>
      {attachments.map((attachment) => (
        <div className={attachment.kind === "image" ? "attachment-card image" : "attachment-card file"} key={attachment.id}>
          {attachment.kind === "image" && attachment.dataUrl ? (
            <img src={attachment.dataUrl} alt={attachment.name} />
          ) : (
            <div className="attachment-file-icon"><FileText size={18} /></div>
          )}
          <div className="attachment-meta">
            <strong title={attachment.name}>{attachment.name}</strong>
            <span>
              {formatFileSize(attachment.size)}
              {attachment.truncated ? ` · ${t.attachmentTruncated}` : ""}
            </span>
          </div>
          {onRemove && (
            <button
              className="attachment-remove"
              onClick={() => onRemove(attachment.id)}
              type="button"
              aria-label={t.removeAttachment(attachment.name)}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
