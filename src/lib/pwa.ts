import type { Language } from "../i18n";

const NOTIFICATION_STORAGE_KEY = "neurondeck-generation-notifications";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type GenerationNotificationState =
  | "unsupported"
  | "default"
  | "enabled"
  | "denied";

export const isInstalledPwa = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches === true ||
  ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const readGenerationNotificationState = (): GenerationNotificationState => {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && localStorage.getItem(NOTIFICATION_STORAGE_KEY) === "enabled") {
    return "enabled";
  }
  return "default";
};

export const enableGenerationNotifications = async (): Promise<GenerationNotificationState> => {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, "enabled");
    return "enabled";
  }
  localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
  return permission === "denied" ? "denied" : "default";
};

export const registerNeuronDeckServiceWorker = async (): Promise<ServiceWorkerRegistration | undefined> => {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return undefined;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("NeuronDeck service worker registration failed", error);
    return undefined;
  }
};

export const notifyGenerationComplete = async (
  language: Language,
  kind: "chat" | "image" = "chat",
): Promise<void> => {
  if (document.visibilityState === "visible" || readGenerationNotificationState() !== "enabled") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const title = language === "zh" ? "NeuronDeck 已生成完成" : "NeuronDeck generation complete";
    const body = kind === "image"
      ? language === "zh" ? "你的图片已经创作完成。" : "Your image is ready."
      : language === "zh" ? "模型回复已经完成。" : "The model response is ready.";
    registration.active?.postMessage({ type: "generation-complete", title, body, url: "/" });
  } catch (error) {
    console.warn("Generation completion notification failed", error);
  }
};
