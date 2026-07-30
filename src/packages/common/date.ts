/** Date & time utilities. All internal times are UTC ISO strings. */
import type { ISODateString } from "./ids";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function nowISO(): ISODateString {
  return new Date().toISOString() as ISODateString;
}

export function toISO(d: Date | number | string): ISODateString {
  return new Date(d).toISOString() as ISODateString;
}

export function parseISO(s: string): Date {
  return new Date(s);
}

export function addDuration(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export function addDays(d: Date, days: number): Date {
  return addDuration(d, days * MS_PER_DAY);
}

export function addHours(d: Date, hours: number): Date {
  return addDuration(d, hours * MS_PER_HOUR);
}

export function addMinutes(d: Date, minutes: number): Date {
  return addDuration(d, minutes * MS_PER_MINUTE);
}

export function diffMs(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function isExpired(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

/** Day key `YYYY-MM-DD` for grouping/keys. */
export function dayKey(d: Date | string = new Date()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

/** Hour-of-day in UTC (0-23). */
export function hourOfDay(d: Date | string = new Date()): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.getUTCHours();
}

/** ISO weekday 1=Mon..7=Sun (matches Prisma/DB convention). */
export function isoWeekday(d: Date | string = new Date()): number {
  const date = typeof d === "string" ? new Date(d) : d;
  const js = date.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/** Human relative time, e.g. "3m ago", "2h ago", "5d ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diff / MS_PER_MINUTE);
  if (Math.abs(mins) < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export const Duration = {
  SECOND: MS_PER_SECOND,
  MINUTE: MS_PER_MINUTE,
  HOUR: MS_PER_HOUR,
  DAY: MS_PER_DAY,
  WEEK: 7 * MS_PER_DAY,
} as const;
