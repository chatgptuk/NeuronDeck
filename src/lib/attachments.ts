import type { Attachment } from "../types";

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_CHARACTERS = 40_000;

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const plainTextExtensions = new Set([
  "txt", "md", "markdown", "csv", "json", "jsonl", "js", "jsx", "ts", "tsx", "css", "scss",
  "yaml", "yml", "toml", "log", "py", "java", "go", "rs", "sql", "sh",
]);
const convertibleExtensions = new Set([
  "pdf", "html", "htm", "xml", "xlsx", "xlsm", "xlsb", "xls", "et", "docx", "ods", "odt", "numbers",
]);

export const ATTACHMENT_ACCEPT = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  ".txt", ".md", ".markdown", ".csv", ".json", ".jsonl", ".js", ".jsx", ".ts", ".tsx",
  ".css", ".scss", ".yaml", ".yml", ".toml", ".log", ".py", ".java", ".go", ".rs", ".sql", ".sh",
  ".pdf", ".html", ".htm", ".xml", ".xlsx", ".xlsm", ".xlsb", ".xls", ".et", ".docx", ".ods", ".odt", ".numbers",
].join(",");

export const getFileExtension = (name: string): string => name.split(".").at(-1)?.toLowerCase() ?? "";

export const classifyFile = (file: Pick<File, "name" | "type">): "image" | "text" | "convert" | "unsupported" => {
  if (imageMimeTypes.has(file.type.toLowerCase())) return "image";
  const extension = getFileExtension(file.name);
  if (plainTextExtensions.has(extension) || file.type.startsWith("text/plain")) return "text";
  if (convertibleExtensions.has(extension)) return "convert";
  return "unsupported";
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the image."));
    reader.readAsDataURL(file);
  });

export const createLocalAttachment = async (file: File): Promise<Attachment | null> => {
  const classification = classifyFile(file);
  if (classification === "convert" || classification === "unsupported") return null;

  if (classification === "image") {
    return {
      id: crypto.randomUUID(),
      kind: "image",
      name: file.name,
      mimeType: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    };
  }

  const rawText = await file.text();
  const truncated = rawText.length > MAX_DOCUMENT_CHARACTERS;
  return {
    id: crypto.randomUUID(),
    kind: "file",
    name: file.name,
    mimeType: file.type || "text/plain",
    size: file.size,
    text: rawText.slice(0, MAX_DOCUMENT_CHARACTERS),
    truncated,
  };
};
