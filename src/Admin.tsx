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

interface DailyStats {
  day: string;
  uniqueVisitors: number;
  visits: number;
  chats: number;
  images: number;
  tts: number;
  errors: number;
}

interface AdminStatsSnapshot {
  generatedAt: string;
  timezone: "UTC";
  visitors: {
    total: number;
    today: number;
    sevenDays: number;
    thirtyDays: number;
  };
  totals: {
    visits: number;
    chats: number;
    images: number;
    tts: number;
    errors: number;
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
    title: "使用概览",
    description: "查看匿名访问趋势与 AI 功能使用情况。数据从后台启用后开始累计。",
    refresh: "刷新数据",
    language: "EN",
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
    privacy: "只保存随机浏览器 ID 的 SHA-256 哈希及聚合计数；不记录消息内容、IP、文件名或 Cloudflare Token。",
    updated: (value: string) => `更新于 ${value}`,
    empty: "数据会在用户访问和使用 AI 功能后出现在这里。",
  },
  en: {
    back: "Back to workspace",
    eyebrow: "Site admin",
    title: "Usage overview",
    description: "Anonymous traffic and AI feature usage, collected from the moment this dashboard was enabled.",
    refresh: "Refresh data",
    language: "中文",
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
    privacy: "Only SHA-256 hashes of random browser IDs and aggregate counters are stored. Message content, IPs, filenames, and Cloudflare tokens are never recorded.",
    updated: (value: string) => `Updated ${value}`,
    empty: "Data will appear after people visit and use AI features.",
  },
} as const;

const formatNumber = (value: number, language: Language): string =>
  value.toLocaleString(language === "zh" ? "zh-CN" : "en-US");

const readAdminError = async (response: Response): Promise<AdminLoadError> => {
  const payload = await response.json().catch(() => null) as {
    error?: { code?: string; message?: string };
  } | null;
  return {
    status: response.status,
    code: payload?.error?.code,
    message: payload?.error?.message || `Request failed (${response.status}).`,
  };
};

export function Admin() {
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem("neurondeck-language") === "en" ? "en" : "zh"),
  );
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = language === "zh" ? "站点后台 · NeuronDeck" : "Site admin · NeuronDeck";
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
  const updatedAt = snapshot
    ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(snapshot.generatedAt))
    : "";

  const errorContent = error ? (() => {
    if (error.status === 401) return { title: t.loginTitle, body: t.loginBody, action: t.login, login: true };
    if (error.status === 403) return { title: t.forbiddenTitle, body: t.forbiddenBody, action: t.back, login: false };
    if (error.status === 503) return { title: t.unavailableTitle, body: t.unavailableBody, action: t.back, login: false };
    return { title: t.errorTitle, body: error.message, action: t.retry, login: false };
  })() : null;
  const errorStatus = error?.status ?? 0;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-brand" href="/" aria-label={t.back}>
          <span><NeuronGlyph /></span>
          <strong>NeuronDeck</strong>
          <em>{t.eyebrow}</em>
        </a>
        <div className="admin-top-actions">
          <button type="button" onClick={() => setLanguage((current) => current === "zh" ? "en" : "zh")}>
            {t.language}
          </button>
          <button type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label="Theme">
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "spinning" : ""} size={16} />
            <span>{t.refresh}</span>
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-heading">
          <div>
            <span className="eyebrow">{t.eyebrow}</span>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
          </div>
          <a href="/"><ArrowLeft size={16} />{t.back}</a>
        </div>

        {loading && !snapshot ? (
          <div className="admin-state"><Activity className="admin-state-icon spinning" /><p>{t.loading}</p></div>
        ) : errorContent ? (
          <div className="admin-state admin-error-state">
            <span className="admin-state-icon"><Cloud /></span>
            <h2>{errorContent.title}</h2>
            <p>{errorContent.body}</p>
            {errorContent.login ? (
              <button type="button" onClick={() => window.location.assign("/api/auth/cloudflare/start?returnTo=/admin")}>{errorContent.action}</button>
            ) : errorStatus === 0 || errorStatus >= 500 && errorStatus !== 503 ? (
              <button type="button" onClick={() => void load()}>{errorContent.action}</button>
            ) : (
              <a href="/">{errorContent.action}</a>
            )}
          </div>
        ) : snapshot ? (
          <>
            <section className="admin-stat-grid" aria-label={t.uniqueUsers}>
              {[
                { label: t.totalUsers, value: snapshot.visitors.total, icon: Users },
                { label: t.todayUsers, value: snapshot.visitors.today, icon: Activity },
                { label: t.weekUsers, value: snapshot.visitors.sevenDays, icon: CalendarDays },
                { label: t.monthUsers, value: snapshot.visitors.thirtyDays, icon: ShieldCheck },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article className="admin-stat-card" key={item.label}>
                    <span><Icon /></span>
                    <div><small>{item.label}</small><strong>{formatNumber(item.value, language)}</strong></div>
                  </article>
                );
              })}
            </section>
            <p className="admin-stat-note">{t.anonymousHint}</p>

            <div className="admin-dashboard-grid">
              <section className="admin-panel admin-trend-panel">
                <div className="admin-panel-heading">
                  <div><span className="eyebrow">Activity</span><h2>{t.trend}</h2></div>
                  <small>{t.updated(updatedAt)}</small>
                </div>
                {chartDays.length ? (
                  <div className="admin-chart" aria-label={t.trend}>
                    {chartDays.map((item) => (
                      <div className="admin-chart-column" key={item.day} title={`${item.day}: ${item.uniqueVisitors}`}>
                        <strong>{item.uniqueVisitors || ""}</strong>
                        <span style={{ height: `${Math.max(5, item.uniqueVisitors / chartMaximum * 100)}%` }} />
                        <small>{item.day.slice(5).replace("-", "/")}</small>
                      </div>
                    ))}
                  </div>
                ) : <p className="admin-empty">{t.empty}</p>}
              </section>

              <section className="admin-panel admin-usage-panel">
                <div className="admin-panel-heading"><div><span className="eyebrow">AI usage</span><h2>{t.chats}</h2></div></div>
                <div className="admin-usage-list">
                  {[
                    { label: t.visits, value: snapshot.totals.visits, icon: Activity },
                    { label: t.chats, value: snapshot.totals.chats, icon: MessageSquareText },
                    { label: t.images, value: snapshot.totals.images, icon: Image },
                    { label: t.speech, value: snapshot.totals.tts, icon: Volume2 },
                    { label: t.errors, value: snapshot.totals.errors, icon: AlertTriangle },
                  ].map((item) => {
                    const Icon = item.icon;
                    return <div key={item.label}><span><Icon />{item.label}</span><strong>{formatNumber(item.value, language)}</strong></div>;
                  })}
                </div>
              </section>
            </div>

            <section className="admin-panel admin-table-panel">
              <div className="admin-panel-heading"><div><span className="eyebrow">Daily</span><h2>{t.detail}</h2></div></div>
              <div className="admin-table-scroll">
                <table>
                  <thead><tr><th>{t.date}</th><th>{t.uniqueUsers}</th><th>{t.visits}</th><th>{t.chats}</th><th>{t.images}</th><th>{t.speech}</th><th>{t.errors}</th></tr></thead>
                  <tbody>
                    {[...snapshot.daily].reverse().map((item) => (
                      <tr key={item.day}><td>{item.day}</td><td>{item.uniqueVisitors}</td><td>{item.visits}</td><td>{item.chats}</td><td>{item.images}</td><td>{item.tts}</td><td className={item.errors ? "has-errors" : ""}>{item.errors}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="admin-privacy"><ShieldCheck size={16} /><p>{t.privacy}</p></footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
