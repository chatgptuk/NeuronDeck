import type { Language } from "../i18n";

const isSameCalendarDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

export const formatMessageTimestamp = (
  value: string,
  language: Language,
  current = new Date(),
): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (isSameCalendarDay(date, current)) return `${language === "zh" ? "今天" : "Today"} ${time}`;

  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return `${language === "zh" ? "昨天" : "Yesterday"} ${time}`;

  const datePart = new Intl.DateTimeFormat(locale, {
    ...(date.getFullYear() === current.getFullYear() ? {} : { year: "numeric" as const }),
    month: language === "zh" ? "numeric" : "short",
    day: "numeric",
  }).format(date);
  return `${datePart} ${time}`;
};

export const formatElapsedDuration = (milliseconds: number, language: Language): string => {
  const seconds = Math.max(0, milliseconds) / 1_000;
  if (seconds < 60) {
    const value = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
    return language === "zh" ? `${value} 秒` : `${value}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return language === "zh"
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes}m ${remainingSeconds}s`;
};
