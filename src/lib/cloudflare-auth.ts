export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareAuthStatus {
  configured: boolean;
  authenticated: boolean;
  accounts: CloudflareAccount[];
  activeAccountId?: string;
  activeAccountName?: string;
  error?: string;
}

interface ApiErrorPayload {
  error?: { message?: string };
}

const readError = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
  return payload?.error?.message || `Request failed with status ${response.status}.`;
};

export const getCloudflareAuthStatus = async (): Promise<CloudflareAuthStatus> => {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  const status = await response.json() as Partial<CloudflareAuthStatus>;
  return {
    configured: status.configured === true,
    authenticated: status.authenticated === true,
    accounts: Array.isArray(status.accounts) ? status.accounts : [],
    activeAccountId: status.activeAccountId,
    activeAccountName: status.activeAccountName,
    error: status.error,
  };
};

export const selectCloudflareAccount = async (accountId: string): Promise<void> => {
  const response = await fetch("/api/auth/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new Error(await readError(response));
};

export const disconnectCloudflare = async (): Promise<void> => {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
};
