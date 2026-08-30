import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableGenerationNotifications,
  notifyGenerationComplete,
  readGenerationNotificationState,
} from "./pwa";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const installStorageMock = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
};

const installServiceWorkerMock = (postMessage = vi.fn()) => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage } }),
      register: vi.fn(),
    },
  });
  return postMessage;
};

describe("PWA completion notifications", () => {
  it("requests permission only from the explicit enable action", async () => {
    installStorageMock();
    installServiceWorkerMock();
    const notification = {
      permission: "default" as NotificationPermission,
      requestPermission: vi.fn(async () => {
        notification.permission = "granted";
        return "granted" as NotificationPermission;
      }),
    };
    vi.stubGlobal("Notification", notification);

    expect(readGenerationNotificationState()).toBe("default");
    await expect(enableGenerationNotifications()).resolves.toBe("enabled");
    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(readGenerationNotificationState()).toBe("enabled");
  });

  it("notifies through the service worker only while the page is hidden", async () => {
    installStorageMock();
    const postMessage = installServiceWorkerMock();
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
    localStorage.setItem("neurondeck-generation-notifications", "enabled");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });

    await notifyGenerationComplete("zh", "image");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "generation-complete",
      title: "NeuronDeck 已生成完成",
      body: "你的图片已经创作完成。",
    }));

    postMessage.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await notifyGenerationComplete("zh", "chat");
    expect(postMessage).not.toHaveBeenCalled();
  });
});
