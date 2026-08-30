interface AccountIdentity {
  id: string;
}

const configuredAdminIds = (value?: string): Set<string> => new Set(
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[a-f0-9]{32}$/.test(item)),
);

export const hasConfiguredAdmin = (configuredIds?: string): boolean =>
  configuredAdminIds(configuredIds).size > 0;

export const hasAdminAccount = (
  accounts: ReadonlyArray<AccountIdentity>,
  configuredIds?: string,
): boolean => {
  const allowed = configuredAdminIds(configuredIds);
  return allowed.size > 0 && accounts.some((account) => allowed.has(account.id.toLowerCase()));
};
