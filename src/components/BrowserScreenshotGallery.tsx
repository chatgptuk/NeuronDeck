import { Camera, Download, Maximize2 } from "lucide-react";
import { translations, type Language } from "../i18n";
import { formatElapsedDuration } from "../lib/time";
import type { BrowserScreenshot } from "../types";

interface BrowserScreenshotGalleryProps {
  screenshots?: BrowserScreenshot[];
  language: Language;
}

export function BrowserScreenshotGallery({ screenshots = [], language }: BrowserScreenshotGalleryProps) {
  const t = translations[language];
  if (!screenshots.length) return null;

  return (
    <div className="generated-image-grid browser-screenshot-grid">
      {screenshots.map((screenshot, index) => (
        <figure className="generated-image browser-screenshot" key={screenshot.id}>
          <img src={screenshot.dataUrl} alt={`${t.browserScreenshot}: ${screenshot.title}`} />
          <figcaption>
            <span>
              <strong>
                <Camera size={13} />
                Browser Run
                {screenshot.elapsedMs != null ? (
                  <em>{t.screenshotDuration(formatElapsedDuration(screenshot.elapsedMs, language))}</em>
                ) : null}
              </strong>
              <small>
                {screenshot.fullPage ? t.screenshotFullPage : screenshot.viewport === "mobile" ? t.screenshotMobile : t.screenshotDesktop}
                {` · ${screenshot.width}×${screenshot.height} · ${screenshot.url}`}
              </small>
            </span>
            <span className="generated-image-actions">
              <a
                href={screenshot.dataUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={t.openScreenshot}
                title={t.openScreenshot}
              ><Maximize2 size={15} /></a>
              <a
                href={screenshot.dataUrl}
                download={`neurondeck-web-${index + 1}.png`}
                aria-label={t.downloadScreenshot}
                title={t.downloadScreenshot}
              ><Download size={15} /></a>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
