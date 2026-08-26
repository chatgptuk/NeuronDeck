import type { GeneratedImage } from "../types";
import type { Language } from "../i18n";
import { waitForPageVisible } from "./stream-recovery";

interface ImageJobResponse {
  status?: "queued" | "running" | "paused" | "waiting" | "waitingForPause" | "complete" | "error";
  image?: GeneratedImage;
  error?: { message?: string };
}

interface WaitForImageJobOptions {
  jobId: string;
  clientId: string;
  signal: AbortSignal;
  language: Language;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

const abortableDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });

export const waitForImageJob = async ({
  jobId,
  clientId,
  signal,
  language,
  fetcher = fetch,
  pollIntervalMs = 2_500,
  maxWaitMs = 20 * 60 * 1_000,
}: WaitForImageJobOptions): Promise<GeneratedImage> => {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (document.visibilityState === "hidden") await waitForPageVisible(signal);
    try {
      const response = await fetcher(`/api/image-jobs/${encodeURIComponent(jobId)}`, {
        headers: {
          "x-neurondeck-client": clientId,
          "accept-language": language === "zh" ? "zh-CN" : "en",
        },
        signal,
      });
      const data = await response.json().catch(() => null) as ImageJobResponse | null;
      if (!response.ok) {
        throw new Error(data?.error?.message || (language === "zh" ? "无法查询生图任务。" : "Could not check the image job."));
      }
      if (data?.status === "complete" && data.image) return data.image;
      if (data?.status === "error") {
        throw new Error(data.error?.message || (language === "zh" ? "图片生成失败。" : "Image generation failed."));
      }
    } catch (error) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!(error instanceof TypeError)) throw error;
      await waitForPageVisible(signal);
    }
    await abortableDelay(pollIntervalMs, signal);
  }
  throw new Error(language === "zh" ? "生图时间过长，请稍后返回查看。" : "Image generation is taking too long. Check back later.");
};
