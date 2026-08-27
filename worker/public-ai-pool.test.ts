import { describe, expect, it } from "vitest";
import { orderPublicAiAccounts, readPublicAiPoolConfig } from "./public-ai-pool";

const account = (suffix: string, tokenSuffix: string) => ({
  accountId: `${"0".repeat(31)}${suffix}`,
  apiToken: `public-token-${tokenSuffix.padEnd(24, "x")}`,
});

describe("public AI account pool configuration", () => {
  it("keeps the feature disabled when no secret exists", () => {
    expect(readPublicAiPoolConfig(undefined)).toEqual({ state: "disabled", accounts: [] });
  });

  it("accepts a bounded list of Cloudflare account credentials", () => {
    const first = account("1", "one");
    const second = account("2", "two");
    expect(readPublicAiPoolConfig(JSON.stringify({ accounts: [first, second] }))).toEqual({
      state: "ready",
      accounts: [first, second],
    });
  });

  it("rejects malformed, duplicate, or empty credential pools", () => {
    expect(readPublicAiPoolConfig("not-json").state).toBe("invalid");
    expect(readPublicAiPoolConfig('{"accounts":[]}').state).toBe("invalid");
    const duplicate = account("1", "duplicate");
    expect(readPublicAiPoolConfig(JSON.stringify({ accounts: [duplicate, duplicate] })).state).toBe("invalid");
  });

  it("uses deterministic account ordering without dropping failover entries", () => {
    const accounts = [account("1", "one"), account("2", "two"), account("3", "three")];
    const first = orderPublicAiAccounts(accounts, "stable-browser-client");
    const second = orderPublicAiAccounts(accounts, "stable-browser-client");
    expect(second).toEqual(first);
    expect(new Set(first.map((entry) => entry.accountId))).toEqual(new Set(accounts.map((entry) => entry.accountId)));
  });
});
