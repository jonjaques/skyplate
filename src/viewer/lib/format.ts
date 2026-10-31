/**
 * Number, date and text formatting shared by every view, so the same quantity reads the same
 * way in the galaxy labels, the trays, the charts and the record.
 */

const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const percentFine = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", timeZone: "UTC" });
const isoDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });

/** 1,284 — exact counts in labels, records and tables. */
export const formatInt = (n: number): string => integer.format(Math.round(n));

/** 12.9K — axis ticks, tight labels, anything ≥ 10,000 that only needs magnitude. */
export const formatCompact = (n: number): string => (Math.abs(n) < 10_000 ? integer.format(Math.round(n)) : compact.format(n));

export const formatPercent = (ratio: number, fine = false): string =>
  (fine || (ratio > 0 && ratio < 0.01) ? percentFine : percent).format(ratio);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Unix seconds → "Mar 4, 2024". */
export const formatDate = (unix: number): string => day.format(unix * 1000);
/** Unix seconds → "Mar 2024". */
export const formatMonth = (unix: number): string => month.format(unix * 1000);
/** Unix seconds → "2024-03-04", the specimen-label date form. */
export const formatIsoDate = (unix: number): string => isoDay.format(unix * 1000);

/** "3 days ago", "8 months ago", relative to `now` (unix seconds). */
export function formatAgo(unix: number, now: number): string {
  const s = Math.max(0, now - unix);
  const steps: [number, string][] = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of steps) {
    if (s >= size) {
      const v = Math.floor(s / size);
      return `${v} ${name}${v === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** "1 file", "3 files". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${formatInt(n)} ${n === 1 ? one : many}`;

/** Last path segment. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

/** Middle-truncate a path to keep both its root and its file name visible. */
export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const name = baseName(path);
  if (name.length >= max - 2) return `…${name.slice(-(max - 1))}`;
  const head = path.slice(0, max - name.length - 2);
  return `${head}…/${name}`;
}
