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
  type Category,
  type CategoryGroup,
  type CodeSymbols,
  type FileRecord,
  type GitSummary,
  type Report,
} from "../../shared/schema";
import { CATEGORY_GROUPS } from "../lib/colors";
import { formatDate, plural } from "../lib/format";
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

/**
 * Why a commit chart has nothing to draw, as a sentence for its empty state. Only asked when
 * the report has history: without git, or with a single commit, the History and People
 * sections and the activity tray say so before any chart is drawn.
 *
 * The range is measured back from the newest commit, so it always holds at least one commit;
 * an empty chart means every commit in it misses the files in view. Saying that, with the
 * count, keeps "no commits in the last 30 days" from reading as a quiet month for the project.
 *
 * `where` names the scope ("the files in apps/game", "the files in view") and `widen` the way
 * out of it ("close the drawer", "widen the filters").
 */
export function noCommitsReason(git: GitSummary, from: number | null, rangePhrase: string, where: string, widen: string): string {
  let inRange = 0;
  for (const t of git.commits.time) if (from === null || t >= from) inRange++;
  if (inRange === 0) return `No commits ${rangePhrase || "in this history"}: the newest is from ${formatDate(git.last)}.`;
  if (from !== null) return `None of the ${plural(inRange, "commit")} ${rangePhrase} touch ${where}. Choose a longer range or ${widen}.`;
  return `None of the ${plural(inRange, "analyzed commit")} touch ${where}: they are untracked or not yet committed${
    git.truncated ? ", or last changed before the analyzed history begins" : ""
  }.`;
}

// ─── Filter menus ────────────────────────────────────────────────────────────────────────────

export interface Facets {
  /** Files and code lines per language id. */
  languages: Map<string, { files: number; code: number }>;
  /** Files per category. */
  categories: Map<Category, number>;
}

/**
 * Counts for the Charts filter menus, faceted the usual way: each menu counts the files that
 * the open drawer and every other filter leave in view, ignoring its own choice, so a count is
 * what checking that option would show. Report-wide totals offered EJS (21 files) inside a
 * six-file drawer with no EJS in it, and counted vendored files the view was hiding.
 */
export function facets(report: Report, model: Model, filters: Filters, dir: number | null): Facets {
  const languages = new Map<string, { files: number; code: number }>();
  const categories = new Map<Category, number>();
  const visit = (f: FileRecord) => {
    if (filters.hideGenerated && f.generated) return;
    if (filters.hideVendored && f.vendored) return;
    if (!filters.categories || filters.categories.has(f.category)) {
      const e = languages.get(f.language) ?? { files: 0, code: 0 };
      e.files += 1;
      e.code += f.code;
      languages.set(f.language, e);
    }
    if (!filters.languages || filters.languages.has(f.language)) categories.set(f.category, (categories.get(f.category) ?? 0) + 1);
  };
  if (dir !== null && dir > 0) for (const id of filesUnder(model, dir)) visit(report.files[id]!);
  else for (const f of report.files) visit(f);
  return { languages, categories };
}

// ─── Languages and categories ────────────────────────────────────────────────────────────────

export interface LanguageShare {
  id: string;
  name: string;
  slot: number;
  code: number;
  files: number;
}

export const hasSlot = (slot: number) => slot >= 0 && slot < 7;

/**
 * Largest first. On a tie the slotted language goes first: the analyzer breaks ties by id, and
 * breaking them here by file count named express's HTML (44 lines, 8 files) and folded CSS (44
 * lines, 4 files), the language holding slot 6, so the tray's gray "6 others" hid a language
 * the plate draws in color.
 */
const bySize = (a: LanguageShare, b: LanguageShare) =>
  b.code - a.code || Number(hasSlot(b.slot)) - Number(hasSlot(a.slot)) || b.files - a.files;

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
  return [...by.values()].sort(bySize);
}

/** How many languages a composition names before folding the rest. Fills the tray's 2 × 4 key. */
export const NAMED_LANGUAGES = 7;

/**
 * linguist's fallbacks for "nothing matched". The analyzer never gives them a slot
 * (src/core/pipeline.ts summarizeLanguages), so the plate files them under Other.
 */
const FALLBACK_LANGUAGES = new Set(["text", "binary"]);

export interface CompositionPart {
  /** Language id, or "rest" for the folded remainder. */
  key: string;
  /** Palette slot; -1 for a language the plate draws in the Other gray, and for the remainder. */
  slot: number;
  label: string;
  code: number;
  languages: LanguageShare[];
  /** The folded remainder: every language smaller than the named ones. */
  rest: boolean;
}

export interface Composition {
  total: number;
  /** Named languages with a slot (slot order), named languages without one (by size), the rest. */
  parts: CompositionPart[];
  languageCount: number;
}

/**
 * Name the largest languages in the scope and fold only the true tail.
 *
 * Which languages are named is decided by share, not by palette slot. Folding by slot let
 * the gray "14 others" swallow Markdown and JSON (a quarter of inertialref's lines, because
 * the analyzer hands slots to programming languages first) while 154 lines of Shell kept a
 * named entry. A named language keeps its own color from the report, so a filter never
 * repaints it: its slot hue when it has one, else the gray the plate draws it in.
 *
 * One exception to size: a fallback (Text, Binary) gives its named place to a slotted language
 * that would otherwise fold. Slots go to the seven largest languages that are not fallbacks,
 * so without it, whenever Text outgrew the seventh (fd, flask, fzf), the tray named Text in gray
 * and folded that seventh language, colored on the plate and in the galaxy key, into "N others".
 * With it the unfiltered tray names exactly the galaxy key's seven, and Text sits in the
 * remainder, as it sits in the key's Other.
 *
 * Order: slotted parts in slot order (the order the palette was validated in, which also
 * keeps a drawer from shuffling the bar), then the unslotted ones by size, then the rest.
 */
export function composition(shares: LanguageShare[], named = NAMED_LANGUAGES): Composition {
  const withCode = shares.filter((s) => s.code > 0).sort(bySize);
  // Folding a single language into "1 other" would hide its name to save no room.
  const cut = withCode.length <= named + 1 ? withCode.length : named;
  const head = withCode.slice(0, cut);
  const tail = withCode.slice(cut);
  for (let t = 0; t < tail.length; t++) {
    if (!hasSlot(tail[t]!.slot)) continue;
    const h = head.findLastIndex((s) => FALLBACK_LANGUAGES.has(s.id));
    if (h < 0) break;
    [head[h], tail[t]] = [tail[t]!, head[h]!];
  }
  tail.sort(bySize);
  const part = (s: LanguageShare, slot: number): CompositionPart => ({ key: s.id, slot, label: s.name, code: s.code, languages: [s], rest: false });
  const parts = [
    ...head.filter((s) => hasSlot(s.slot)).sort((a, b) => a.slot - b.slot).map((s) => part(s, s.slot)),
    ...head.filter((s) => !hasSlot(s.slot)).map((s) => part(s, -1)),
  ];
  if (tail.length) {
    parts.push({ key: "rest", slot: -1, label: `${tail.length} others`, code: sum(tail.map((s) => s.code)), languages: tail, rest: true });
  }
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

export interface MonthBucket {
  /** Start of the first month in the bucket (unix seconds, UTC). */
  start: number;
  /** Index range [from, to) into the monthly series. */
  from: number;
  to: number;
}

/** Calendar-aligned spans in months: a column always means a month, quarter, half or year. */
export const MONTH_STEPS = [1, 3, 6, 12, 24, 60] as const;

/**
 * Group monthly samples (month starts, ascending) into the smallest calendar span that keeps
 * the series at or under `maxColumns` columns. Quarters start in January, April, July and
 * October; halves in January and July; years in January.
 */
export function monthBuckets(times: number[], maxColumns: number): { step: number; buckets: MonthBucket[] } {
  const index = (t: number) => {
    const d = new Date(t * 1000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const group = (step: number) => {
    const buckets: MonthBucket[] = [];
    let key = Number.NaN;
    times.forEach((t, i) => {
      const k = Math.floor(index(t) / step);
      if (k !== key) {
        key = k;
        const first = k * step;
        buckets.push({ start: Date.UTC(Math.floor(first / 12), first % 12, 1) / 1000, from: i, to: i + 1 });
      } else buckets[buckets.length - 1]!.to = i + 1;
    });
    return buckets;
  };
  for (const step of MONTH_STEPS) {
    const buckets = group(step);
    if (buckets.length <= maxColumns || step === MONTH_STEPS[MONTH_STEPS.length - 1]) return { step, buckets };
  }
  return { step: 1, buckets: group(1) };
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

/**
 * Gini rescaled by n / (n − 1), so "one person made every commit" reads 1 at any group size.
 *
 * The population Gini above (and the analyzer's) tops out at (n − 1) / n: 0.5 for two
 * authors. inertialref's 220 and 3 commits came out as 0.49 under a "1 is one author"
 * caption, which reads as moderate when it is as concentrated as two people can be.
 */
export function giniAdjusted(g: number, n: number): number {
  if (n < 2) return 0;
  return Math.min(1, Math.max(0, (g * n) / (n - 1)));
}

/** Below this many authors a Lorenz curve is a three-vertex polyline; say the share instead. */
export const LORENZ_MIN_AUTHORS = 10;

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
