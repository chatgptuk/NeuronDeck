import { useLayoutEffect, useRef } from "react";
import { Download, Maximize2 } from "lucide-react";
import { translations, type Language } from "../i18n";
import { formatElapsedDuration } from "../lib/time";
import type { GeneratedImage, ImageGenerationState } from "../types";
import { CreationGlyph } from "./ProductIcons";

const extensionForDataUrl = (dataUrl: string): string => {
  if (dataUrl.startsWith("data:image/png") || dataUrl.includes("/image.png")) return "png";
  if (dataUrl.startsWith("data:image/webp") || dataUrl.includes("/image.webp")) return "webp";
  return "jpg";
};

const MASONRY_ITEM_GAP = 12;

export const masonryRowSpan = (height: number, rowHeight = 1): number => {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) return 1;
  return Math.max(1, Math.ceil((height + MASONRY_ITEM_GAP) / rowHeight));
};

interface GeneratedImageGalleryProps {
  images?: GeneratedImage[];
  state?: ImageGenerationState;
  language: Language;
}

export function GeneratedImageGallery({ images = [], state, language }: GeneratedImageGalleryProps) {
  const t = translations[language];
  const galleryRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery || images.length < 2 || typeof ResizeObserver === "undefined") return;

    let animationFrame = 0;
    const layout = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const rowHeight = Number.parseFloat(getComputedStyle(gallery).gridAutoRows) || 1;
        gallery.querySelectorAll<HTMLElement>(":scope > .generated-image").forEach((card) => {
          const height = card.getBoundingClientRect().height;
          const nextValue = `span ${masonryRowSpan(height, rowHeight)}`;
          if (card.style.gridRowEnd !== nextValue) card.style.gridRowEnd = nextValue;
        });
      });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(gallery);
    gallery.querySelectorAll("img").forEach((image) => observer.observe(image));
    layout();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [images]);

  return (
    <>
      {state?.status === "generating" ? (
        <div className="image-generation-status" role="status">
          <span className="image-generation-glow"><CreationGlyph /></span>
          <span>
            <strong>{t.imageGenerating}</strong>
            <small>{t.imageGeneratingWith(state.modelName)}</small>
          </span>
          <i><span /><span /><span /></i>
        </div>
      ) : null}
      {state?.status === "error" ? (
        <div className="image-generation-status error" role="status">
          <span className="image-generation-glow"><CreationGlyph /></span>
          <span><strong>{t.imageGenerationFailed}</strong><small>{state.message}</small></span>
        </div>
      ) : null}
      {images.length ? (
        <div ref={galleryRef} className={`generated-image-grid${images.length > 1 ? " multi" : ""}`}>
          {images.map((image, index) => (
            <figure className="generated-image" key={image.id}>
              <img src={image.dataUrl} alt={image.prompt} width={image.width} height={image.height} />
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
