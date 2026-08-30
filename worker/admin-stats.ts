import { getOAuthSession, type CloudflareOAuthEnv } from "./cloudflare-oauth";
import { hasAdminAccount, hasConfiguredAdmin } from "./admin-access";
import catalog from "../src/data/models.generated.json";

export { hasAdminAccount } from "./admin-access";

export type AnalyticsEvent = "visit" | "chat" | "image" | "tts" | "error";
export type AiFeature = "chat" | "image" | "tts" | "browser";

export interface ModelTelemetry {
  feature: AiFeature;
  modelId: string;
  success: boolean;
  cancelled?: boolean;
  durationMs?: number;
  firstTokenMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  toolCalls?: number;
  toolSuccesses?: number;
}

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

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

interface ModelStatsRow {
  feature: AiFeature;
  modelId: string;
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  durationMs: number;
  firstTokenMs: number;
  firstTokenSamples: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  toolCalls: number;
  toolSuccesses: number;
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
      database.prepare(`CREATE TABLE IF NOT EXISTS model_stats (
        day TEXT NOT NULL,
        feature TEXT NOT NULL,
        model_id TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        cancelled INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        first_token_ms INTEGER NOT NULL DEFAULT 0,
        first_token_samples INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        tool_successes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, feature, model_id)
      ) WITHOUT ROWID`),
    ]).then(() => undefined).catch((error) => {
      schemaInitializations.delete(database);
      throw error;
    });
    schemaInitializations.set(database, initialization);
  }
  await initialization;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const readNonNegativeInteger = (...values: unknown[]): number => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return 0;
};

export const normalizeTokenUsage = (value: unknown): NormalizedTokenUsage => {
  const usage = asRecord(value);
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const promptDetails = asRecord(usage.prompt_tokens_details) ?? asRecord(usage.input_tokens_details);
  return {
    inputTokens: readNonNegativeInteger(usage.input_tokens, usage.prompt_tokens, usage.promptTokens),
    outputTokens: readNonNegativeInteger(usage.output_tokens, usage.completion_tokens, usage.completionTokens),
    cachedInputTokens: readNonNegativeInteger(
      usage.cached_input_tokens,
      usage.cached_tokens,
      promptDetails?.cached_tokens,
      promptDetails?.cachedTokens,
    ),
  };
};

const clampMetric = (value: number | undefined, maximum = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.round(value)))
    : 0;

export const recordModelTelemetry = async (
  env: AdminStatsEnv,
  telemetry: ModelTelemetry,
): Promise<void> => {
  const database = env.METRICS_DB;
  if (!database || (!/^@cf\/[a-z0-9._/-]{3,180}$/i.test(telemetry.modelId) && !/^browser-run\/(?:markdown|screenshot)$/.test(telemetry.modelId))) return;

  try {
    await ensureSchema(database);
    const day = new Date().toISOString().slice(0, 10);
    const success = telemetry.success ? 1 : 0;
    const cancelled = telemetry.cancelled ? 1 : 0;
    const error = !telemetry.success && !telemetry.cancelled ? 1 : 0;
    const durationMs = clampMetric(telemetry.durationMs, 60 * 60 * 1_000);
    const firstTokenMs = clampMetric(telemetry.firstTokenMs, 60 * 60 * 1_000);
    const firstTokenSamples = firstTokenMs > 0 ? 1 : 0;

    await database.prepare(
      `INSERT INTO model_stats (
        day, feature, model_id, requests, successes, errors, cancelled,
        duration_ms, first_token_ms, first_token_samples,
        input_tokens, output_tokens, cached_input_tokens, tool_calls, tool_successes
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, feature, model_id) DO UPDATE SET
        requests = model_stats.requests + 1,
        successes = model_stats.successes + excluded.successes,
        errors = model_stats.errors + excluded.errors,
        cancelled = model_stats.cancelled + excluded.cancelled,
        duration_ms = model_stats.duration_ms + excluded.duration_ms,
        first_token_ms = model_stats.first_token_ms + excluded.first_token_ms,
        first_token_samples = model_stats.first_token_samples + excluded.first_token_samples,
        input_tokens = model_stats.input_tokens + excluded.input_tokens,
        output_tokens = model_stats.output_tokens + excluded.output_tokens,
        cached_input_tokens = model_stats.cached_input_tokens + excluded.cached_input_tokens,
        tool_calls = model_stats.tool_calls + excluded.tool_calls,
        tool_successes = model_stats.tool_successes + excluded.tool_successes`,
    ).bind(
      day,
      telemetry.feature,
      telemetry.modelId,
      success,
      error,
      cancelled,
      durationMs,
      firstTokenMs,
      firstTokenSamples,
      clampMetric(telemetry.inputTokens),
      clampMetric(telemetry.outputTokens),
      clampMetric(telemetry.cachedInputTokens),
      clampMetric(telemetry.toolCalls),
      clampMetric(telemetry.toolSuccesses),
    ).run();
  } catch (error) {
    console.warn("Model telemetry was not recorded", {
      feature: telemetry.feature,
      model: telemetry.modelId,
      message: error instanceof Error ? error.message : "Unknown model telemetry error",
    });
  }
};

const modelPrices = new Map(catalog.models.map((model) => [model.id, model.prices]));
const estimateChatCost = (row: ModelStatsRow): number => {
  if (row.feature !== "chat") return 0;
  const prices = modelPrices.get(row.modelId);
  if (!prices) return 0;
  const cachedTokens = Math.min(row.inputTokens, row.cachedInputTokens);
  const regularInputTokens = Math.max(0, row.inputTokens - cachedTokens);
  return (
    regularInputTokens * (prices.input ?? 0) +
    cachedTokens * (prices.cachedInput ?? prices.input ?? 0) +
    row.outputTokens * (prices.output ?? 0)
  ) / 1_000_000;
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
    const [totalVisitors, activeToday, active7Days, active30Days, totalsResult, dailyResult, modelStatsResult] = await database.batch([
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
      database.prepare(
        `SELECT
          feature AS feature,
          model_id AS modelId,
          COALESCE(SUM(requests), 0) AS requests,
          COALESCE(SUM(successes), 0) AS successes,
          COALESCE(SUM(errors), 0) AS errors,
          COALESCE(SUM(cancelled), 0) AS cancelled,
          COALESCE(SUM(duration_ms), 0) AS durationMs,
          COALESCE(SUM(first_token_ms), 0) AS firstTokenMs,
          COALESCE(SUM(first_token_samples), 0) AS firstTokenSamples,
          COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
          COALESCE(SUM(tool_calls), 0) AS toolCalls,
          COALESCE(SUM(tool_successes), 0) AS toolSuccesses
        FROM model_stats
        WHERE day >= ?
        GROUP BY feature, model_id
        ORDER BY requests DESC, model_id ASC`,
      ).bind(start30),
    ]);

    const totals = totalsResult.results[0] as unknown as TotalsRow | undefined;
    const daily = dailyResult.results as unknown as DailyStatsRow[];
    const modelHealth = (modelStatsResult.results as unknown as ModelStatsRow[]).map((row) => ({
      ...row,
      successRate: row.requests ? row.successes / row.requests : 0,
      averageDurationMs: row.requests ? Math.round(row.durationMs / row.requests) : 0,
      averageFirstTokenMs: row.firstTokenSamples ? Math.round(row.firstTokenMs / row.firstTokenSamples) : 0,
      toolSuccessRate: row.toolCalls ? row.toolSuccesses / row.toolCalls : 0,
      estimatedCostUsd: estimateChatCost(row),
    }));
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
      modelHealth: {
        periodDays: 30,
        estimatedChatCostUsd: modelHealth.reduce((total, row) => total + row.estimatedCostUsd, 0),
        rows: modelHealth,
      },
      daily,
    });
  } catch (error) {
    console.error("Admin statistics could not be loaded", error);
    return errorResponse("Dashboard statistics are temporarily unavailable.", 502, "admin_stats_failed");
  }
};
