import { describe, expect, it } from "vitest";
import { classifyFile, formatFileSize, getFileExtension } from "./attachments";

describe("attachment helpers", () => {
  it("classifies vision images and directly readable text", () => {
    expect(classifyFile({ name: "photo.png", type: "image/png" })).toBe("image");
    expect(classifyFile({ name: "notes.md", type: "text/markdown" })).toBe("text");
    expect(classifyFile({ name: "data.csv", type: "text/csv" })).toBe("text");
  });

  it("routes rich documents through Markdown conversion", () => {
    expect(classifyFile({ name: "report.pdf", type: "application/pdf" })).toBe("convert");
    expect(classifyFile({ name: "brief.docx", type: "application/octet-stream" })).toBe("convert");
    expect(classifyFile({ name: "archive.zip", type: "application/zip" })).toBe("unsupported");
  });

  it("formats file metadata", () => {
    expect(getFileExtension("report.FINAL.PDF")).toBe("pdf");
    expect(formatFileSize(1536)).toBe("2 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
