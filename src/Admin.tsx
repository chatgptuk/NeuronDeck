import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Cloud,
  Image,
  MessageSquareText,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NeuronGlyph } from "./components/ProductIcons";
import type { Language } from "./i18n";
import { IMAGE_MODELS } from "./lib/image-models";
import { FALLBACK_MODELS } from "./lib/models";
import { TTS_MODEL_IDS } from "./lib/speech";

interface DailyStats {
  day: string;
  uniqueVisitors: number;
  visits: number;
  chats: number;
  images: number;
  tts: number;
  errors: number;
}

type AiFeature = "chat" | "image" | "tts" | "browser";

interface ModelHealthRow {
  feature: AiFeature;
  modelId: string;
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  toolCalls: number;
  toolSuccesses: number;
  successRate: number;
  averageDurationMs: number;
  averageFirstTokenMs: number;
  toolSuccessRate: number;
  estimatedCostUsd: number;
}

interface AdminStatsSnapshot {
  generatedAt: string;
  timezone: "UTC";
  visitors: { total: number; today: number; sevenDays: number; thirtyDays: number };
  totals: { visits: number; chats: number; images: number; tts: number; errors: number };
  modelHealth: {
    periodDays: number;
    estimatedChatCostUsd: number;
    rows: ModelHealthRow[];
  };
  daily: DailyStats[];
}

interface AdminLoadError {
  status: number;
  code?: string;
  message: string;
}

const copy = {
  zh: {
    back: "返回工作台",
    eyebrow: "站点后台",
    title: "模型健康与成本中心",
    description: "查看最近 30 天各模型的成功率、首字延迟、完整耗时、Token 与估算成本，同时保留匿名访问概览。",
    refresh: "刷新数据",
    language: "EN",
    aiRequests: "AI 模型请求",
    successRate: "整体成功率",
    firstToken: "平均首字耗时",
    estimatedCost: "估算聊天成本",
    modelHealth: "模型健康明细",
    modelHealthEyebrow: "Health · 30 days",
    model: "模型",
    feature: "类型",
    status: "状态",
    requests: "请求",
    success: "成功率",
    duration: "平均总耗时",
    tokens: "输入 / 输出 Token",
    tools: "工具调用",
    cost: "估算成本",
    healthy: "健康",
    observe: "观察中",
    degraded: "波动",
    incident: "异常",
    chat: "聊天",
    image: "生图",
    tts: "语音",
    browser: "网页",
    noModelData: "新计量会从本次升级后开始累计，完成几次生成后即可看到模型健康数据。",
    costHint: "成本仅按模型目录中的公开输入、缓存输入与输出 Token 单价估算；图片、语音及 Cloudflare 最终账单以控制台为准。",
    trafficTitle: "匿名访问与功能用量",
    trafficDescription: "只统计随机浏览器标识的哈希与聚合计数，不保存对话内容。",
    totalUsers: "累计独立浏览器",
    todayUsers: "今日活跃",
    weekUsers: "近 7 天活跃",
    monthUsers: "近 30 天活跃",
    anonymousHint: "按随机浏览器标识去重，不代表实名用户数",
    trend: "近 14 天活跃趋势",
    uniqueUsers: "独立浏览器",
    visits: "页面访问",
    chats: "聊天请求",
    images: "成功生图",
    speech: "成功语音",
    errors: "生成错误",
    detail: "最近 30 天明细",
    date: "日期（UTC）",
    loading: "正在读取后台数据…",
    loginTitle: "需要管理员 Cloudflare 账户",
    loginBody: "连接站点所属的 Cloudflare 账户后即可进入后台。普通用户账户无法读取统计数据。",
    login: "连接 Cloudflare 并进入",
    forbiddenTitle: "当前账户没有后台权限",
    forbiddenBody: "请在主界面切换或重新连接站点管理员的 Cloudflare 账户。",
    unavailableTitle: "后台尚未配置完成",
    unavailableBody: "需要为部署设置 ADMIN_ACCOUNT_ID Secret，并绑定 METRICS_DB D1 数据库。",
    errorTitle: "暂时无法读取统计",
    retry: "重试",
    privacy: "只保存随机浏览器 ID 的 SHA-256 哈希及聚合模型指标；不记录消息内容、IP、文件名或 Cloudflare Token。",
    updated: (value: string) => `更新于 ${value}`,
    empty: "数据会在用户访问和使用 AI 功能后出现在这里。",
  },
  en: {
    back: "Back to workspace",
    eyebrow: "Site admin",
    title: "Model health & cost center",
    description: "Success rate, time to first token, full latency, tokens, and estimated cost by model for the last 30 days, plus anonymous traffic.",
    refresh: "Refresh data",
    language: "中文",
    aiRequests: "AI model requests",
    successRate: "Overall success rate",
    firstToken: "Average first token",
    estimatedCost: "Estimated chat cost",
    modelHealth: "Model health detail",
    modelHealthEyebrow: "Health · 30 days",
    model: "Model",
    feature: "Type",
    status: "Status",
    requests: "Requests",
    success: "Success",
    duration: "Avg duration",
    tokens: "Input / output tokens",
    tools: "Tool calls",
    cost: "Est. cost",
    healthy: "Healthy",
    observe: "Observing",
    degraded: "Degraded",
    incident: "Incident",
    chat: "Chat",
    image: "Image",
    tts: "Speech",
    browser: "Web",
    noModelData: "The new metrics begin accumulating with this release. Complete a few generations to populate model health.",
    costHint: "Costs use published input, cached-input, and output token prices in the model catalog. Image, speech, and the final Cloudflare bill remain authoritative in the dashboard.",
    trafficTitle: "Anonymous traffic & feature usage",
    trafficDescription: "Only hashed random browser IDs and aggregate counters are stored; conversation content is not collected.",
    totalUsers: "Unique browsers",
    todayUsers: "Active today",
    weekUsers: "Active in 7 days",
    monthUsers: "Active in 30 days",
    anonymousHint: "Deduplicated by a random browser identifier; not registered people",
    trend: "14-day activity",
    uniqueUsers: "Unique browsers",
    visits: "Page visits",
    chats: "Chat requests",
    images: "Images created",
    speech: "Speech created",
    errors: "Generation errors",
    detail: "Last 30 days",
    date: "Date (UTC)",
    loading: "Loading dashboard data…",
    loginTitle: "Administrator Cloudflare account required",
    loginBody: "Connect the Cloudflare account that owns this site. Regular user accounts cannot read these statistics.",
    login: "Connect Cloudflare",
    forbiddenTitle: "This account has no dashboard access",
    forbiddenBody: "Switch or reconnect to the site administrator Cloudflare account from the main workspace.",
    unavailableTitle: "The dashboard is not configured",
    unavailableBody: "Set the ADMIN_ACCOUNT_ID Secret and bind the METRICS_DB D1 database for this deployment.",
    errorTitle: "Statistics are temporarily unavailable",
    retry: "Try again",
    privacy: "Only SHA-256 hashes of random browser IDs and aggregate model metrics are stored. Message content, IPs, filenames, and Cloudflare tokens are never recorded.",
    updated: (value: string) => `Updated ${value}`,
    empty: "Data will appear after people visit and use AI features.",
  },
} as const;

const modelNames = new Map<string, string>([
  ...FALLBACK_MODELS.map((model) => [model.id, model.name] as [string, string]),
  ...IMAGE_MODELS.map((model) => [model.id, model.name] as [string, string]),
  [TTS_MODEL_IDS.auraEnglish, "Aura-2 English"],
  [TTS_MODEL_IDS.auraSpanish, "Aura-2 Spanish"],
  ["browser-run/markdown", "Cloudflare Browser Run"],
  ["browser-run/screenshot", "Browser Run Screenshot"],
]);

const formatNumber = (value: number, language: Language): string =>
  Number(value || 0).toLocaleString(language === "zh" ? "zh-CN" : "en-US");

const formatDuration = (value: number, language: Language): string => {
  if (!value) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 1 })} s`;
};

const formatCost = (value: number): string => {
  if (!value) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const readAdminError = async (response: Response): Promise<AdminLoadError> => {
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message || `Request failed (${response.status}).` };
};

export function Admin() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("neurondeck-language") === "en" ? "en" : "zh");
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("neurondeck-theme-v2") as "dark" | "light" | null) ?? "light",
  );
  const [snapshot, setSnapshot] = useState<AdminStatsSnapshot | null>(null);
  const [error, setError] = useState<AdminLoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const t = copy[language];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      if (!response.ok) throw await readAdminError(response);
      setSnapshot(await response.json() as AdminStatsSnapshot);
    } catch (loadError) {
      setError(loadError && typeof loadError === "object" && "status" in loadError
        ? loadError as AdminLoadError
        : { status: 0, message: loadError instanceof Error ? loadError.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = language === "zh" ? "模型健康与成本中心 · NeuronDeck" : "Model health & cost center · NeuronDeck";
    localStorage.setItem("neurondeck-theme-v2", theme);
    localStorage.setItem("neurondeck-language", language);
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex,nofollow";
  }, [language, theme]);

  const chartDays = useMemo(() => snapshot?.daily.slice(-14) ?? [], [snapshot]);
  const chartMaximum = Math.max(1, ...chartDays.map((item) => item.uniqueVisitors));
  const rows = snapshot?.modelHealth?.rows ?? [];
  const totalRequests = rows.reduce((total, row) => total + Number(row.requests || 0), 0);
  const totalSuccesses = rows.reduce((total, row) => total + Number(row.successes || 0), 0);
  const chatRows = rows.filter((row) => row.feature === "chat" && row.averageFirstTokenMs > 0);
  const weightedFirstToken = chatRows.reduce((total, row) => total + row.averageFirstTokenMs * row.requests, 0);
  const firstTokenSamples = chatRows.reduce((total, row) => total + row.requests, 0);
  const overallSuccessRate = totalRequests ? totalSuccesses / totalRequests : 0;
  const updatedAt = snapshot
    ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date(snapshot.generatedAt))
    : "";

  const errorContent = error ? (() => {
    if (error.status === 401) return { title: t.loginTitle, body: t.loginBody, action: t.login, login: true };
    if (error.status === 403) return { title: t.forbiddenTitle, body: t.forbiddenBody, action: t.back, login: false };
    if (error.status === 503) return { title: t.unavailableTitle, body: t.unavailableBody, action: t.back, login: false };
    return { title: t.errorTitle, body: error.message, action: t.retry, login: false };
  })() : null;
  const errorStatus = error?.status ?? 0;

  const healthLabel = (row: ModelHealthRow) => {
    if (row.requests < 3) return { label: t.observe, className: "observing" };
    if (row.successRate >= 0.98) return { label: t.healthy, className: "healthy" };
    if (row.successRate >= 0.9) return { label: t.degraded, className: "degraded" };
    return { label: t.incident, className: "incident" };
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-brand" href="/" aria-label={t.back}><span><NeuronGlyph /></span><strong>NeuronDeck</strong><em>{t.eyebrow}</em></a>
        <div className="admin-top-actions">
          <button type="button" onClick={() => setLanguage((current) => current === "zh" ? "en" : "zh")}>{t.language}</button>
          <button type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label="Theme">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spinning" : ""} size={16} /><span>{t.refresh}</span></button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-heading"><div><span className="eyebrow">Operations</span><h1>{t.title}</h1><p>{t.description}</p></div><a href="/"><ArrowLeft size={16} />{t.back}</a></div>

        {loading && !snapshot ? (
          <div className="admin-state"><Activity className="admin-state-icon spinning" /><p>{t.loading}</p></div>
        ) : errorContent ? (
          <div className="admin-state admin-error-state">
            <span className="admin-state-icon"><Cloud /></span><h2>{errorContent.title}</h2><p>{errorContent.body}</p>
            {errorContent.login ? (
              <button type="button" onClick={() => window.location.assign("/api/auth/cloudflare/start?returnTo=/admin")}>{errorContent.action}</button>
            ) : errorStatus === 0 || errorStatus >= 500 && errorStatus !== 503 ? (
              <button type="button" onClick={() => void load()}>{errorContent.action}</button>
            ) : <a href="/">{errorContent.action}</a>}
          </div>
        ) : snapshot ? (
          <>
            <section className="admin-stat-grid admin-health-summary" aria-label={t.modelHealth}>
              {[
                { label: t.aiRequests, value: formatNumber(totalRequests, language), icon: MessageSquareText },
                { label: t.successRate, value: totalRequests ? `${(overallSuccessRate * 100).toFixed(1)}%` : "—", icon: ShieldCheck },
                { label: t.firstToken, value: formatDuration(firstTokenSamples ? weightedFirstToken / firstTokenSamples : 0, language), icon: Activity },
                { label: t.estimatedCost, value: formatCost(snapshot.modelHealth?.estimatedChatCostUsd ?? 0), icon: Cloud },
              ].map((item) => {
                const Icon = item.icon;
                return <article className="admin-stat-card" key={item.label}><span><Icon /></span><div><small>{item.label}</small><strong>{item.value}</strong></div></article>;
              })}
            </section>

            <section className="admin-panel admin-table-panel admin-model-health">
              <div className="admin-panel-heading"><div><span className="eyebrow">{t.modelHealthEyebrow}</span><h2>{t.modelHealth}</h2></div><small>{t.updated(updatedAt)}</small></div>
              <div className="admin-table-scroll">
                <table>
                  <thead><tr><th>{t.model}</th><th>{t.feature}</th><th>{t.status}</th><th>{t.requests}</th><th>{t.success}</th><th>TTFT</th><th>{t.duration}</th><th>{t.tokens}</th><th>{t.tools}</th><th>{t.cost}</th></tr></thead>
                  <tbody>
                    {rows.length ? rows.map((row) => {
                      const health = healthLabel(row);
                      const feature = row.feature === "chat" ? t.chat : row.feature === "image" ? t.image : row.feature === "browser" ? t.browser : t.tts;
                      return (
                        <tr key={`${row.feature}:${row.modelId}`}>
                          <td><strong className="admin-model-name">{modelNames.get(row.modelId) ?? row.modelId.split("/").at(-1)}</strong><small className="admin-model-id">{row.modelId}</small></td>
                          <td><span className={`admin-feature-badge ${row.feature}`}>{feature}</span></td>
                          <td><span className={`admin-health-badge ${health.className}`}><i />{health.label}</span></td>
                          <td>{formatNumber(row.requests, language)}</td>
                          <td>{row.requests ? `${(row.successRate * 100).toFixed(1)}%` : "—"}</td>
                          <td>{row.feature === "chat" ? formatDuration(row.averageFirstTokenMs, language) : "—"}</td>
                          <td>{formatDuration(row.averageDurationMs, language)}</td>
                          <td>{row.feature === "chat" ? `${formatNumber(row.inputTokens, language)} / ${formatNumber(row.outputTokens, language)}` : "—"}</td>
                          <td>{row.toolCalls ? `${row.toolSuccesses}/${row.toolCalls}` : "—"}</td>
                          <td>{row.feature === "chat" ? formatCost(row.estimatedCostUsd) : "—"}</td>
                        </tr>
                      );
                    }) : <tr><td className="admin-model-empty" colSpan={10}>{t.noModelData}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="admin-cost-hint">{t.costHint}</p>
            </section>

            <div className="admin-section-intro"><span className="eyebrow">Traffic</span><h2>{t.trafficTitle}</h2><p>{t.trafficDescription}</p></div>
            <section className="admin-stat-grid admin-visitor-grid" aria-label={t.uniqueUsers}>
              {[
                { label: t.totalUsers, value: snapshot.visitors.total, icon: Users },
                { label: t.todayUsers, value: snapshot.visitors.today, icon: Activity },
                { label: t.weekUsers, value: snapshot.visitors.sevenDays, icon: CalendarDays },
                { label: t.monthUsers, value: snapshot.visitors.thirtyDays, icon: ShieldCheck },
              ].map((item) => {
                const Icon = item.icon;
                return <article className="admin-stat-card" key={item.label}><span><Icon /></span><div><small>{item.label}</small><strong>{formatNumber(item.value, language)}</strong></div></article>;
              })}
            </section>
            <p className="admin-stat-note">{t.anonymousHint}</p>

            <div className="admin-dashboard-grid">
              <section className="admin-panel admin-trend-panel">
                <div className="admin-panel-heading"><div><span className="eyebrow">Activity</span><h2>{t.trend}</h2></div></div>
                {chartDays.length ? (
                  <div className="admin-chart" aria-label={t.trend}>{chartDays.map((item) => <div className="admin-chart-column" key={item.day} title={`${item.day}: ${item.uniqueVisitors}`}><strong>{item.uniqueVisitors || ""}</strong><span style={{ height: `${Math.max(5, item.uniqueVisitors / chartMaximum * 100)}%` }} /><small>{item.day.slice(5).replace("-", "/")}</small></div>)}</div>
                ) : <p className="admin-empty">{t.empty}</p>}
              </section>
              <section className="admin-panel admin-usage-panel">
                <div className="admin-panel-heading"><div><span className="eyebrow">Usage</span><h2>{t.chats}</h2></div></div>
                <div className="admin-usage-list">
                  {[
                    { label: t.visits, value: snapshot.totals.visits, icon: Activity },
                    { label: t.chats, value: snapshot.totals.chats, icon: MessageSquareText },
                    { label: t.images, value: snapshot.totals.images, icon: Image },
                    { label: t.speech, value: snapshot.totals.tts, icon: Volume2 },
                    { label: t.errors, value: snapshot.totals.errors, icon: AlertTriangle },
                  ].map((item) => { const Icon = item.icon; return <div key={item.label}><span><Icon />{item.label}</span><strong>{formatNumber(item.value, language)}</strong></div>; })}
                </div>
              </section>
            </div>

            <section className="admin-panel admin-table-panel">
              <div className="admin-panel-heading"><div><span className="eyebrow">Daily</span><h2>{t.detail}</h2></div></div>
              <div className="admin-table-scroll"><table><thead><tr><th>{t.date}</th><th>{t.uniqueUsers}</th><th>{t.visits}</th><th>{t.chats}</th><th>{t.images}</th><th>{t.speech}</th><th>{t.errors}</th></tr></thead><tbody>{[...snapshot.daily].reverse().map((item) => <tr key={item.day}><td>{item.day}</td><td>{item.uniqueVisitors}</td><td>{item.visits}</td><td>{item.chats}</td><td>{item.images}</td><td>{item.tts}</td><td className={item.errors ? "has-errors" : ""}>{item.errors}</td></tr>)}</tbody></table></div>
            </section>
            <footer className="admin-privacy"><ShieldCheck size={16} /><p>{t.privacy}</p></footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
