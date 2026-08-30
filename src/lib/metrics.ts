import { getClientId } from "./client-id";

const VISIT_KEY = "neurondeck-visit-recorded";

export const recordAnonymousVisit = (): void => {
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (sessionStorage.getItem(VISIT_KEY) === day) return;
    sessionStorage.setItem(VISIT_KEY, day);
  } catch {
    // Private browser modes may make session storage unavailable.
  }

  void fetch("/api/metrics/visit", {
    method: "POST",
    headers: { "x-neurondeck-client": getClientId() },
    keepalive: true,
  }).catch(() => undefined);
};
