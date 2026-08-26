import { describe, expect, it, vi } from "vitest";
import { StreamInterruptedError } from "./stream";
import { isRecoverableStreamError, waitForPageVisible } from "./stream-recovery";

describe("background stream recovery", () => {
  it("retries network and incomplete-stream failures", () => {
    expect(isRecoverableStreamError(new TypeError("network lost"))).toBe(true);
    expect(isRecoverableStreamError(new StreamInterruptedError())).toBe(true);
    expect(isRecoverableStreamError(new Error("provider rejected request"))).toBe(false);
  });

  it("waits for a hidden document to become visible", async () => {
    let visibility: DocumentVisibilityState = "hidden";
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const controller = new AbortController();
    const waiting = waitForPageVisible(controller.signal);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await expect(waiting).resolves.toBeUndefined();
    visibilitySpy.mockRestore();
  });
});
