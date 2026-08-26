import { StreamInterruptedError } from "./stream";

export const isRecoverableStreamError = (error: unknown): boolean =>
  error instanceof StreamInterruptedError || error instanceof TypeError;

export const waitForPageVisible = (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (document.visibilityState !== "hidden") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") return;
      cleanup();
      resolve();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
};
