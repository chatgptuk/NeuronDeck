import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAnonymousVisit } from "./metrics";

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

describe("anonymous visit metrics", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("sessionStorage", createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records at most once per browser session and day", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    recordAnonymousVisit();
    recordAnonymousVisit();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/metrics/visit");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-neurondeck-client")).toMatch(/^[a-f0-9]{32}$/);
  });
});
