/**
 * Derived series for the trays and the Charts tab. Pure functions over the report, so every
 * chart computes from the same slice and the numbers agree across them.
 *
 * Scoping, and why it works the way it does:
 * - Files are scoped by the shared filters (language, category, generated, vendored) and by the
 *   open drawer. The galaxy dims by the same rules, so a tray never counts what the plate hides.
 * - Commits are scoped by time range and, when files are narrowed, by "touches at least one
 *   file in scope". The commit table lists each commit's files, so this is exact.
 * - Series the analyzer precomputed over all files (growth, punchcard, coupling) cannot be
 *   narrowed by file after the fact; those charts say so in their subtitle instead of
 *   quietly showing unfiltered numbers under a filter.
 * - Thresholds mirror src/core/findings.ts (own code, 90% ownership, a year of inactivity
 *   measured from the newest commit), so a chart and a finding never disagree.
 */

import {
  CATEGORY_GROUP,
  SymbolFlag,
  type CategoryGroup,
  type CodeSymbols,
  type FileRecord,
  type GitSummary,
  type Report,
} from "../../shared/schema";
import { CATEGORY_GROUPS } from "../lib/colors";
import { filesUnder, type Model } from "../model/indices";
import type { Filters } from "../state/store";

export const DAY = 86_400;
export const WEEK = 7 * DAY;
export const YEAR = 365 * DAY;
/** Monday 1970-01-05 00:00 UTC; the epoch itself was a Thursday. */
const MONDAY = 4 * DAY;
/** Hotspots and churn concentration need this many analyzed commits (core/stats MIN_HISTORY). */
export const MIN_HISTORY = 10;

export const weekStart = (t: number) => Math.floor((t - MONDAY) / WEEK) * WEEK + MONDAY;

export const isOwnCode = (f: FileRecord): boolean =>
  (f.category === "code" || f.category === "test") && !f.generated && !f.vendored;

// ─── Scope ───────────────────────────────────────────────────────────────────────────────────

export interface FileScope {
  /** 1 for files in scope, by file id. */
  mask: Uint8Array;
  ids: number[];
  /** True when the scope is smaller than the whole report. */
  narrowed: boolean;
  /**
   * True when the reader chose a subset (languages, categories, a drawer), as opposed to the
   * default noise filters (generated, vendored). Only a chosen subset narrows commits:
   * otherwise every commit that touched only since-deleted files (a third of some histories)
   * would vanish from the activity counts just because vendored files are hidden by default.
   * It also tells the distributions whether the analyzer's own-code statistics still apply,
   * since those already leave generated and vendored files out.
   */
  selective: boolean;
  /** Directory the scope is limited to, or null for the whole tree. */
  dir: number | null;
}

export function scopeFiles(report: Report, model: Model, filters: Filters, dir: number | null): FileScope {
  const n = report.files.length;
  const mask = new Uint8Array(n);
  const ids: number[] = [];
  const { languages, categories, hideGenerated, hideVendored } = filters;
  const visit = (f: FileRecord) => {
    if (languages && !languages.has(f.language)) return;
    if (categories && !categories.has(f.category)) return;
    if (hideGenerated && f.generated) return;
    if (hideVendored && f.vendored) return;
    mask[f.id] = 1;
    ids.push(f.id);
  };
  const under = dir !== null && dir > 0 ? filesUnder(model, dir) : null;
  if (under) for (const id of under) visit(report.files[id]!);
  else for (const f of report.files) visit(f);
  const inDir = dir !== null && dir > 0;
  return { mask, ids, narrowed: ids.length !== n, selective: !!languages || !!categories || inDir, dir: inDir ? dir : null };
}

/** Indices into the commit table (newest first) inside the range and touching the scope. */
export function scopeCommits(git: GitSummary, files: FileScope, from: number | null): Int32Array {
  const c = git.commits;
  const out: number[] = [];
  for (let i = 0; i < c.time.length; i++) {
    if (from !== null && c.time[i]! < from) continue;
    if (files.selective) {
      const touched = c.files[i]!;
      let hit = false;
      for (let k = 0; k < touched.length; k++) {
        if (files.mask[touched[k]!]) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    out.push(i);
  }
  return Int32Array.from(out);
}

/** True when the report has enough history to chart change over time. */
export function hasHistory(report: Report): boolean {
  return !!report.git && report.git.commits.time.length >= 2 && report.git.last > report.git.first;
}

// ─── Languages and categories ────────────────────────────────────────────────────────────────

export interface LanguageShare {
  id: string;
  name: string;
  slot: number;
  code: number;
  files: number;
}

/** Code lines per language over the scope, largest first. */
export function languageShares(report: Report, model: Model, ids: number[]): LanguageShare[] {
  const by = new Map<string, LanguageShare>();
  for (const id of ids) {
    const f = report.files[id]!;
    let entry = by.get(f.language);
    if (!entry) {
      const lang = model.languages.get(f.language);
      entry = { id: f.language, name: lang?.name ?? f.language, slot: lang?.slot ?? -1, code: 0, files: 0 };
      by.set(f.language, entry);
    }
    entry.code += f.code;
    entry.files += 1;
  }
  return [...by.values()].sort((a, b) => b.code - a.code || b.files - a.files);
}

export interface Composition {
  total: number;
  /** One part per palette slot present (slot order), then Other. */
  parts: { slot: number; label: string; code: number; languages: LanguageShare[] }[];
  languageCount: number;
}

/**
 * Fold code lines into the seven palette slots plus Other. Slots come from the report (the
 * analyzer ranks languages once), so a filter never repaints a language.
 */
export function composition(shares: LanguageShare[]): Composition {
  const withCode = shares.filter((s) => s.code > 0);
  const bySlot = new Map<number, LanguageShare[]>();
  for (const s of withCode) {
    const slot = s.slot >= 0 && s.slot < 7 ? s.slot : -1;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), s]);
  }
  const parts: Composition["parts"] = [];
  for (let slot = 0; slot < 7; slot++) {
    const langs = bySlot.get(slot);
    if (langs) parts.push({ slot, label: langs[0]!.name, code: sum(langs.map((l) => l.code)), languages: langs });
  }
  const other = bySlot.get(-1);
  if (other) parts.push({ slot: -1, label: `${other.length} other${other.length === 1 ? "" : "s"}`, code: sum(other.map((l) => l.code)), languages: other });
  return { total: sum(withCode.map((s) => s.code)), parts, languageCount: withCode.length };
}

export function categoryGroups(report: Report, ids: number[]): { group: CategoryGroup; files: number; lines: number }[] {
  const acc = new Map<CategoryGroup, { files: number; lines: number }>(CATEGORY_GROUPS.map((g) => [g, { files: 0, lines: 0 }]));
  for (const id of ids) {
    const f = report.files[id]!;
    const e = acc.get(CATEGORY_GROUP[f.category])!;
    e.files += 1;
    e.lines += f.lines;
  }
  return CATEGORY_GROUPS.map((group) => ({ group, ...acc.get(group)! }));
}

// ─── Distributions ───────────────────────────────────────────────────────────────────────────

export interface Dist {
  bins: number[];
  median: number;
  p90: number;
  count: number;
}

/** Linear-interpolated quantile (type 7), matching the analyzer. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function log2Dist(values: number[]): Dist {
  const sorted = Float64Array.from(values).sort();
  const bins: number[] = [];
  for (const v of sorted) {
    const i = v < 2 ? 0 : Math.floor(Math.log2(v));
    while (bins.length <= i) bins.push(0);
    bins[i]!++;
  }
  return { bins, median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), count: sorted.length };
}

// ─── History ─────────────────────────────────────────────────────────────────────────────────

export interface WeekBucket {
  start: number;
  commits: number;
  added: number;
  deleted: number;
  authors: number;
}

/** Weekly buckets over the scoped commits, every week from `from` (or the first commit) to the last. */
export function weekly(git: GitSummary, commits: Int32Array, from: number | null): WeekBucket[] {
  const lo = weekStart(Math.max(from ?? git.first, git.first));
  const hi = weekStart(git.last);
  const count = Math.max(1, Math.round((hi - lo) / WEEK) + 1);
  const out: WeekBucket[] = Array.from({ length: count }, (_, i) => ({ start: lo + i * WEEK, commits: 0, added: 0, deleted: 0, authors: 0 }));
  const people: Set<number>[] = Array.from({ length: count }, () => new Set());
  const c = git.commits;
  for (const i of commits) {
    const k = Math.round((weekStart(c.time[i]!) - lo) / WEEK);
    const b = out[k];
    if (!b) continue;
    b.commits++;
    b.added += c.added[i]!;
    b.deleted += c.deleted[i]!;
    people[k]!.add(c.author[i]!);
  }
  for (let k = 0; k < count; k++) out[k]!.authors = people[k]!.size;
  return out;
}

export interface Column {
  start: number;
  end: number;
  commits: number;
}

/**
 * Group weeks into columns so each stays at least `minWidth` px wide with a 2px gap. The
 * steps are calendar-ish (1, 2, 4, 13, 26, 52 weeks) so a column always means a familiar span.
 */
export function columns(weeks: WeekBucket[], width: number, minWidth = 3): { cols: Column[]; weeksPer: number } {
  const maxCols = Math.max(1, Math.floor(width / (minWidth + 2)));
  const step = [1, 2, 4, 13, 26, 52, 104].find((k) => Math.ceil(weeks.length / k) <= maxCols) ?? Math.ceil(weeks.length / maxCols);
  const cols: Column[] = [];
  for (let i = 0; i < weeks.length; i += step) {
    const chunk = weeks.slice(i, i + step);
    cols.push({ start: chunk[0]!.start, end: chunk[chunk.length - 1]!.start + WEEK, commits: sum(chunk.map((w) => w.commits)) });
  }
  return { cols, weeksPer: step };
}

export function weeksLabel(n: number): string {
  if (n === 1) return "week";
  if (n === 4) return "4 weeks";
  if (n === 13) return "quarter";
  if (n === 26) return "half year";
  if (n === 52) return "year";
  return `${n} weeks`;
}

/** Commits per author over the scoped commits. */
export function commitsByAuthor(git: GitSummary, commits: Int32Array): Map<number, number> {
  const out = new Map<number, number>();
  for (const i of commits) {
    const a = git.commits.author[i]!;
    out.set(a, (out.get(a) ?? 0) + 1);
  }
  return out;
}

export function commitTypes(git: GitSummary, commits: Int32Array): { type: string; commits: number }[] {
  const out = new Map<string, number>();
  for (const i of commits) {
    const t = (git.commits.type[i] ?? "").toLowerCase();
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return [...out.entries()].map(([type, commits]) => ({ type, commits })).sort((a, b) => b.commits - a.commits);
}

/** Gini of a set of non-negative values (0 = even, 1 = all in one). */
export function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const total = sum(v);
  if (n === 0 || total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i]!;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Lorenz curve points (share of authors, share of commits), ascending. */
export function lorenz(values: number[]): { x: number; y: number }[] {
  const v = [...values].filter((x) => x > 0).sort((a, b) => a - b);
  const total = sum(v);
  const n = v.length;
  const out = [{ x: 0, y: 0 }];
  if (n === 0 || total === 0) return out;
  let cum = 0;
  // A thousand-author history needs no more than ~200 vertices to draw a smooth curve.
  const stride = Math.max(1, Math.floor(n / 200));
  for (let i = 0; i < n; i++) {
    cum += v[i]!;
    if ((i + 1) % stride === 0 || i === n - 1) out.push({ x: (i + 1) / n, y: cum / total });
  }
  return out;
}

// ─── People ──────────────────────────────────────────────────────────────────────────────────

/**
 * Palette slot per author: the seven non-bot authors who own the most files in the whole
 * report get slots 0-6, everyone else folds into Other. Ranked once over the report, not the
 * filtered view, so narrowing a filter never repaints a person.
 */
export function authorSlots(git: GitSummary): Map<number, number> {
  const ranked = git.authors.filter((a) => !a.bot && a.owned > 0).sort((a, b) => b.owned - a.owned || b.commits - a.commits);
  return new Map(ranked.slice(0, 7).map((a, i) => [a.id, i]));
}

export function inactiveAuthors(git: GitSummary): Set<number> {
  return new Set(git.authors.filter((a) => !a.bot && a.last < git.last - YEAR).map((a) => a.id));
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export interface DirAgg {
  lines: number;
  files: number;
  bytes: number;
  /** Language id with the most code lines among scoped files below; "" when none. */
  dominant: string;
}

/** Totals over the scoped files under one directory (a contiguous run of fileOrder). */
export function aggregateDir(report: Report, model: Model, mask: Uint8Array, dir: number): DirAgg {
  const code = new Map<string, number>();
  let lines = 0;
  let files = 0;
  let bytes = 0;
  for (const id of filesUnder(model, dir)) {
    if (!mask[id]) continue;
    const f = report.files[id]!;
    lines += f.lines;
    bytes += f.bytes;
    files += 1;
    if (f.code > 0) code.set(f.language, (code.get(f.language) ?? 0) + f.code);
  }
  let dominant = "";
  let best = 0;
  for (const [lang, n] of code) {
    if (n > best) {
      best = n;
      dominant = lang;
    }
  }
  return { lines, files, bytes, dominant };
}

// ─── Symbols ─────────────────────────────────────────────────────────────────────────────────

export function symbolInScope(symbols: CodeSymbols, i: number, mask: Uint8Array): boolean {
  return !!mask[symbols.symbols.file[i]!];
}

export const isUnusedExport = (flags: number) => (flags & SymbolFlag.unusedExport) !== 0;

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
