import { getOAuthSession, type CloudflareOAuthEnv } from "./cloudflare-oauth";
import { hasAdminAccount, hasConfiguredAdmin } from "./admin-access";

export { hasAdminAccount } from "./admin-access";

export type AnalyticsEvent = "visit" | "chat" | "image" | "tts" | "error";

export interface AdminStatsEnv extends CloudflareOAuthEnv {
  ADMIN_ACCOUNT_ID?: string;
  METRICS_DB?: D1Database;
}

interface DailyStatsRow {
  day: string;
  uniqueVisitors: number;
  visits: number;
  chats: number;
  images: number;
  tts: number;
  errors: number;
}

interface TotalsRow {
  visits: number;
  chats: number;
  images: number;
  tts: number;
  errors: number;
}

interface CountRow {
  value: number;
}

const schemaInitializations = new WeakMap<D1Database, Promise<void>>();
const validClientId = (value: string): boolean => /^[a-zA-Z0-9_-]{8,64}$/.test(value);
const json = (data: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(data, { ...init, headers });
};

const errorResponse = (message: string, status: number, code: string): Response =>
  json({ error: { message, code } }, { status });

const ensureSchema = async (database: D1Database): Promise<void> => {
  let initialization = schemaInitializations.get(database);
  if (!initialization) {
    initialization = database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS visitors (
        visitor_id TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 1
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors(last_seen)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS daily_visitors (
        day TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        PRIMARY KEY (day, visitor_id)
      ) WITHOUT ROWID`),
      database.prepare(`CREATE TABLE IF NOT EXISTS daily_stats (
        day TEXT PRIMARY KEY,
        visits INTEGER NOT NULL DEFAULT 0,
        chats INTEGER NOT NULL DEFAULT 0,
        images INTEGER NOT NULL DEFAULT 0,
        tts INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID`),
    ]).then(() => undefined).catch((error) => {
      schemaInitializations.delete(database);
      throw error;
    });
    schemaInitializations.set(database, initialization);
  }
  await initialization;
};

const hashClientId = async (clientId: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const increments: Record<AnalyticsEvent, TotalsRow> = {
  visit: { visits: 1, chats: 0, images: 0, tts: 0, errors: 0 },
  chat: { visits: 0, chats: 1, images: 0, tts: 0, errors: 0 },
  image: { visits: 0, chats: 0, images: 1, tts: 0, errors: 0 },
  tts: { visits: 0, chats: 0, images: 0, tts: 1, errors: 0 },
  error: { visits: 0, chats: 0, images: 0, tts: 0, errors: 1 },
};

export const recordAnalyticsEvent = async (
  env: AdminStatsEnv,
  clientId: string,
  event: AnalyticsEvent,
): Promise<void> => {
  const database = env.METRICS_DB;
  if (!database || !validClientId(clientId)) return;

  try {
    await ensureSchema(database);
    const visitorId = await hashClientId(clientId);
    const timestamp = Date.now();
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const values = increments[event];

    await database.batch([
      database.prepare(
        `INSERT INTO visitors (visitor_id, first_seen, last_seen, event_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(visitor_id) DO UPDATE SET
           last_seen = excluded.last_seen,
           event_count = visitors.event_count + 1`,
      ).bind(visitorId, timestamp, timestamp),
      database.prepare(
        "INSERT OR IGNORE INTO daily_visitors (day, visitor_id, first_seen) VALUES (?, ?, ?)",
      ).bind(day, visitorId, timestamp),
      database.prepare(
        `INSERT INTO daily_stats (day, visits, chats, images, tts, errors)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           visits = daily_stats.visits + excluded.visits,
           chats = daily_stats.chats + excluded.chats,
           images = daily_stats.images + excluded.images,
           tts = daily_stats.tts + excluded.tts,
           errors = daily_stats.errors + excluded.errors`,
      ).bind(
        day,
        values.visits,
        values.chats,
        values.images,
        values.tts,
        values.errors,
      ),
    ]);
  } catch (error) {
    console.warn("Anonymous analytics event was not recorded", {
      event,
      message: error instanceof Error ? error.message : "Unknown analytics error",
    });
  }
};

const readCount = (result: D1Result<CountRow>): number => Number(result.results[0]?.value ?? 0);

export const handleAdminStatsRoute = async (
  request: Request,
  env: AdminStatsEnv,
): Promise<Response> => {
  const database = env.METRICS_DB;
  if (!database || !hasConfiguredAdmin(env.ADMIN_ACCOUNT_ID)) {
    return errorResponse("The private admin dashboard is not configured.", 503, "admin_unavailable");
  }

  const lookup = await getOAuthSession(request, env);
  if (lookup.kind !== "authenticated") {
    return errorResponse("Connect the administrator Cloudflare account first.", 401, "admin_login_required");
  }
  if (!hasAdminAccount(lookup.context.accounts, env.ADMIN_ACCOUNT_ID)) {
    return errorResponse("This Cloudflare account does not have dashboard access.", 403, "admin_forbidden");
  }

  try {
    await ensureSchema(database);
    const timestamp = Date.now();
    const today = new Date(timestamp).toISOString().slice(0, 10);
    const start30 = new Date(timestamp - 29 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const [totalVisitors, activeToday, active7Days, active30Days, totalsResult, dailyResult] = await database.batch([
      database.prepare("SELECT COUNT(*) AS value FROM visitors"),
      database.prepare("SELECT COUNT(*) AS value FROM daily_visitors WHERE day = ?").bind(today),
      database.prepare("SELECT COUNT(*) AS value FROM visitors WHERE last_seen >= ?").bind(timestamp - 7 * 24 * 60 * 60 * 1_000),
      database.prepare("SELECT COUNT(*) AS value FROM visitors WHERE last_seen >= ?").bind(timestamp - 30 * 24 * 60 * 60 * 1_000),
      database.prepare(
        `SELECT
          COALESCE(SUM(visits), 0) AS visits,
          COALESCE(SUM(chats), 0) AS chats,
          COALESCE(SUM(images), 0) AS images,
          COALESCE(SUM(tts), 0) AS tts,
          COALESCE(SUM(errors), 0) AS errors
         FROM daily_stats`,
      ),
      database.prepare(
        `SELECT
          stats.day AS day,
          COUNT(visitors.visitor_id) AS uniqueVisitors,
          stats.visits AS visits,
          stats.chats AS chats,
          stats.images AS images,
          stats.tts AS tts,
          stats.errors AS errors
         FROM daily_stats AS stats
         LEFT JOIN daily_visitors AS visitors ON visitors.day = stats.day
         WHERE stats.day >= ?
         GROUP BY stats.day, stats.visits, stats.chats, stats.images, stats.tts, stats.errors
         ORDER BY stats.day ASC`,
      ).bind(start30),
    ]);

    const totals = totalsResult.results[0] as unknown as TotalsRow | undefined;
    const daily = dailyResult.results as unknown as DailyStatsRow[];
    return json({
      generatedAt: new Date(timestamp).toISOString(),
      timezone: "UTC",
      visitors: {
        total: readCount(totalVisitors as D1Result<CountRow>),
        today: readCount(activeToday as D1Result<CountRow>),
        sevenDays: readCount(active7Days as D1Result<CountRow>),
        thirtyDays: readCount(active30Days as D1Result<CountRow>),
      },
      totals: totals ?? { visits: 0, chats: 0, images: 0, tts: 0, errors: 0 },
      daily,
    });
  } catch (error) {
    console.error("Admin statistics could not be loaded", error);
    return errorResponse("Dashboard statistics are temporarily unavailable.", 502, "admin_stats_failed");
  }
};
