import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserRunError,
  parseDuckDuckGoResults,
  runBrowserMarkdown,
  validatePublicWebUrl,
} from "./browser-run";

afterEach(() => vi.unstubAllGlobals());

describe("Browser Run public-web client", () => {
  it("rejects local, private, credentialed, and unusual-port URLs", () => {
    for (const url of [
      "http://localhost/admin",
      "http://127.0.0.1/",
      "http://10.0.0.4/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "https://user:password@example.com/",
      "https://example.com:8443/",
    ]) {
      expect(() => validatePublicWebUrl(url)).toThrow(BrowserRunError);
    }
    expect(validatePublicWebUrl("https://developers.cloudflare.com/browser-run/").hostname)
      .toBe("developers.cloudflare.com");
  });

  it("uses the selected public account and constrains each stateless quick action", async () => {
    const credential = { accountId: "a".repeat(32), apiToken: "secret-token-value-1234567890" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json({
      success: true,
      result: "# Browser Run\n\nA public documentation page.",
    }, { headers: { "x-browser-ms-used": "321" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runBrowserMarkdown(credential, "https://developers.cloudflare.com/browser-run/");
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(String(requestUrl)).toContain(`/accounts/${credential.accountId}/browser-rendering/markdown`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential.apiToken}`);
    expect(body).toMatchObject({
      url: "https://developers.cloudflare.com/browser-run/",
      actionTimeout: 25_000,
      bestAttempt: true,
      rejectResourceTypes: ["image", "media", "font", "stylesheet"],
    });
    expect((body.allowRequestPattern as string[])[0]).toContain("developers\\.cloudflare\\.com");
    expect(result).toMatchObject({ browserMs: 321, accountId: credential.accountId });
  });

  it("extracts real result links and unwraps DuckDuckGo redirects", () => {
    const results = parseDuckDuckGoResults([
      "[Cloudflare Browser Run](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fdevelopers.cloudflare.com%2Fbrowser-run%2F)",
      "[Pricing](https://developers.cloudflare.com/browser-run/pricing/)",
      "[Duplicate](https://developers.cloudflare.com/browser-run/pricing/)",
      "[Private](http://127.0.0.1/admin)",
    ].join("\n"));

    expect(results).toEqual([
      {
        title: "Cloudflare Browser Run",
        url: "https://developers.cloudflare.com/browser-run/",
        domain: "developers.cloudflare.com",
      },
      {
        title: "Pricing",
        url: "https://developers.cloudflare.com/browser-run/pricing/",
        domain: "developers.cloudflare.com",
      },
    ]);
  });
});
