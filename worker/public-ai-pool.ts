const MAX_PUBLIC_AI_ACCOUNTS = 16;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;

export interface PublicAiAccountCredential {
  accountId: string;
  apiToken: string;
}

export type PublicAiPoolConfig =
  | { state: "disabled"; accounts: [] }
  | { state: "ready"; accounts: PublicAiAccountCredential[] }
  | { state: "invalid"; accounts: []; message: string };

interface PublicAiPoolDocument {
  accounts?: unknown;
}

const invalid = (message: string): PublicAiPoolConfig => ({ state: "invalid", accounts: [], message });

export const readPublicAiPoolConfig = (secret: string | undefined): PublicAiPoolConfig => {
  if (secret === undefined) return { state: "disabled", accounts: [] };
  if (!secret.trim()) return invalid("The PUBLIC_AI_ACCOUNTS secret is empty.");

  let document: PublicAiPoolDocument;
  try {
    document = JSON.parse(secret) as PublicAiPoolDocument;
  } catch {
    return invalid("The PUBLIC_AI_ACCOUNTS secret must contain valid JSON.");
  }

  if (!document || typeof document !== "object" || !Array.isArray(document.accounts)) {
    return invalid("The PUBLIC_AI_ACCOUNTS secret must contain an accounts array.");
  }
  if (document.accounts.length < 1 || document.accounts.length > MAX_PUBLIC_AI_ACCOUNTS) {
    return invalid(`The public AI pool must contain between 1 and ${MAX_PUBLIC_AI_ACCOUNTS} accounts.`);
  }

  const accounts: PublicAiAccountCredential[] = [];
  const accountIds = new Set<string>();
  for (const entry of document.accounts) {
    if (!entry || typeof entry !== "object") return invalid("Each public AI account must be an object.");
    const accountId = typeof (entry as { accountId?: unknown }).accountId === "string"
      ? (entry as { accountId: string }).accountId.trim()
      : "";
    const apiToken = typeof (entry as { apiToken?: unknown }).apiToken === "string"
      ? (entry as { apiToken: string }).apiToken.trim()
      : "";
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      return invalid("Each public AI account must have a valid 32-character Cloudflare Account ID.");
    }
    if (!API_TOKEN_PATTERN.test(apiToken)) {
      return invalid("Each public AI account must have a valid Cloudflare API Token.");
    }
    const normalizedAccountId = accountId.toLowerCase();
    if (accountIds.has(normalizedAccountId)) {
      return invalid("The public AI pool cannot contain duplicate Cloudflare accounts.");
    }
    accountIds.add(normalizedAccountId);
    accounts.push({ accountId: normalizedAccountId, apiToken });
  }

  return { state: "ready", accounts };
};

const stableHash = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const orderPublicAiAccounts = (
  accounts: readonly PublicAiAccountCredential[],
  seed: string,
): PublicAiAccountCredential[] => {
  if (accounts.length < 2) return [...accounts];
  const startIndex = stableHash(seed) % accounts.length;
  return [...accounts.slice(startIndex), ...accounts.slice(0, startIndex)];
};
