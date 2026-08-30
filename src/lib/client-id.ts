const CLIENT_ID_KEY = "neurondeck-client-id";

export const getClientId = (): string => {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const value = crypto.randomUUID().replaceAll("-", "");
  localStorage.setItem(CLIENT_ID_KEY, value);
  return value;
};
