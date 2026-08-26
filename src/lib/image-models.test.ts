import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_MODEL_ID, IMAGE_MODELS, isImageModelId } from "./image-models";

describe("curated Cloudflare image model catalog", () => {
  it("keeps the four selected current image models", () => {
    expect(IMAGE_MODELS.map((model) => model.id)).toEqual([
      "@cf/black-forest-labs/flux-2-klein-9b",
      "@cf/black-forest-labs/flux-2-dev",
      "@cf/leonardo/lucid-origin",
      "@cf/leonardo/phoenix-1.0",
    ]);
  });

  it("defaults to FLUX.2 Klein 9B and rejects removed models", () => {
    expect(DEFAULT_IMAGE_MODEL_ID).toBe("@cf/black-forest-labs/flux-2-klein-9b");
    expect(isImageModelId("@cf/black-forest-labs/flux-2-klein-4b")).toBe(false);
    expect(isImageModelId("@cf/black-forest-labs/flux-1-schnell")).toBe(false);
  });
});
