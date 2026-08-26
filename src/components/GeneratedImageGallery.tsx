import { Download, Maximize2, Sparkles } from "lucide-react";
import { translations, type Language } from "../i18n";
import { formatElapsedDuration } from "../lib/time";
import type { GeneratedImage, ImageGenerationState } from "../types";

const extensionForDataUrl = (dataUrl: string): string => {
  if (dataUrl.startsWith("data:image/png")) return "png";
  if (dataUrl.startsWith("data:image/webp")) return "webp";
  return "jpg";
};

interface GeneratedImageGalleryProps {
  images?: GeneratedImage[];
  state?: ImageGenerationState;
  language: Language;
}

export function GeneratedImageGallery({ images = [], state, language }: GeneratedImageGalleryProps) {
  const t = translations[language];

  return (
    <>
      {state?.status === "generating" ? (
        <div className="image-generation-status" role="status">
          <span className="image-generation-glow"><Sparkles size={18} /></span>
          <span>
            <strong>{t.imageGenerating}</strong>
            <small>{t.imageGeneratingWith(state.modelName)}</small>
          </span>
          <i><span /><span /><span /></i>
        </div>
      ) : null}
      {state?.status === "error" ? (
        <div className="image-generation-status error" role="status">
          <span className="image-generation-glow"><Sparkles size={18} /></span>
          <span><strong>{t.imageGenerationFailed}</strong><small>{state.message}</small></span>
        </div>
      ) : null}
      {images.length ? (
        <div className="generated-image-grid">
          {images.map((image, index) => (
            <figure className="generated-image" key={image.id}>
              <img src={image.dataUrl} alt={image.prompt} />
              <figcaption>
                <span>
                  <strong>
                    {image.modelName}
                    {image.elapsedMs != null ? (
                      <em>{t.imageGenerationDuration(formatElapsedDuration(image.elapsedMs, language))}</em>
                    ) : null}
                  </strong>
                  <small>{image.prompt}</small>
                </span>
                <span className="generated-image-actions">
                  <a
                    href={image.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t.openImage}
                    title={t.openImage}
                  ><Maximize2 size={15} /></a>
                  <a
                    href={image.dataUrl}
                    download={`neurondeck-${index + 1}.${extensionForDataUrl(image.dataUrl)}`}
                    aria-label={t.downloadImage}
                    title={t.downloadImage}
                  ><Download size={15} /></a>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </>
  );
}
