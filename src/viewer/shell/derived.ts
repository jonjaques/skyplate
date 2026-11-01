/**
 * Indexes the record and the call hierarchy need that the shared model does not carry.
 *
 * Each is built lazily the first time a panel asks and cached against the table it came from
 * (WeakMap keyed by the report or symbol object), so a report swap drops them with the old data
 * and nothing is computed for a reader who never opens that panel. They are CSR arrays for the
 * same reason model/indices.ts gives: a 20k-commit history or a 60k-row call table scanned once
 * per click is what makes a big report feel slow.
 */

import { REF_KINDS, type CodeSymbols, type Report } from "../../shared/schema";
import type { Adjacency, Model } from "../model/indices";
import { filesUnder } from "../model/indices";

function csr(n: number, keys: ArrayLike<number>, values: ArrayLike<number>): Adjacency {
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < keys.length; i++) offsets[keys[i]! + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const targets = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) targets[fill[keys[i]!]!++] = values[i]!;
  return { offsets, targets };
}

// ─── Git ─────────────────────────────────────────────────────────────────────────────────────

const commitsByFileCache = new WeakMap<Report, Adjacency>();

/** Commit indexes (newest first) that touched each file. */
export function commitsByFile(report: Report): Adjacency | null {
  const git = report.git;
  if (!git) return null;
  let cached = commitsByFileCache.get(report);
  if (!cached) {
    const keys: number[] = [];
    const values: number[] = [];
    git.commits.files.forEach((files, commit) => {
      for (const f of files) {
        keys.push(f);
        values.push(commit);
      }
    });
    cached = csr(report.files.length, keys, values);
    commitsByFileCache.set(report, cached);
  }
  return cached;
}

const commitsByAuthorCache = new WeakMap<Report, Adjacency>();

/** Commit indexes (newest first) by author. */
export function commitsByAuthor(report: Report): Adjacency | null {
  const git = report.git;
  if (!git) return null;
  let cached = commitsByAuthorCache.get(report);
  if (!cached) {
    const ids = Array.from({ length: git.commits.author.length }, (_, i) => i);
    cached = csr(git.authors.length, git.commits.author, ids);
    commitsByAuthorCache.set(report, cached);
  }
  return cached;
}

/** Authors ranked by commits to one file: the specimen's collectors. */
export function collectorsOf(report: Report, file: number): { author: number; commits: number }[] {
  const byFile = commitsByFile(report);
  const git = report.git;
  if (!byFile || !git) return [];
  const counts = new Map<number, number>();
  for (let i = byFile.offsets[file]!; i < byFile.offsets[file + 1]!; i++) {
    const a = git.commits.author[byFile.targets[i]!]!;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts].map(([author, commits]) => ({ author, commits })).sort((a, b) => b.commits - a.commits);
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export interface DirSummary {
  languages: { id: string; lines: number }[];
  largest: number[];
  hottest: number[];
  owners: { author: number; files: number }[];
  codeLines: number;
}

/** Language mix, largest and hottest files, and owners beneath one directory. */
export function summarizeDir(model: Model, dir: number): DirSummary {
  const report = model.report;
  const ids = filesUnder(model, dir);
  const langs = new Map<string, number>();
  const owners = new Map<number, number>();
  const bots = report.git?.authors.map((a) => a.bot) ?? [];
  let codeLines = 0;
  for (const id of ids) {
    const f = report.files[id]!;
    const weight = f.code + f.comment;
    if (weight > 0) {
      langs.set(f.language, (langs.get(f.language) ?? 0) + weight);
      codeLines += weight;
    }
    if (f.git && !bots[f.git.owner]) owners.set(f.git.owner, (owners.get(f.git.owner) ?? 0) + 1);
  }
  const all = Array.from(ids);
  const largest = all
    .filter((id) => report.files[id]!.lines > 0)
    .sort((a, b) => report.files[b]!.lines - report.files[a]!.lines)
    .slice(0, 5);
  const hottest = all
    .filter((id) => report.files[id]!.hotspot > 0)
    .sort((a, b) => report.files[b]!.hotspot - report.files[a]!.hotspot)
    .slice(0, 5);
  return {
    languages: [...langs].map(([id, lines]) => ({ id, lines })).sort((a, b) => b.lines - a.lines),
    largest,
    hottest,
    owners: [...owners].map(([author, files]) => ({ author, files })).sort((a, b) => b.files - a.files),
    codeLines,
  };
}

// ─── Call table ──────────────────────────────────────────────────────────────────────────────

export const KIND_INDEX = Object.fromEntries(REF_KINDS.map((k, i) => [k, i])) as Record<
  (typeof REF_KINDS)[number],
  number
>;

/** Specifier rows say "this file imports it", not "this code uses it"; the hierarchy skips them. */
const NOT_A_USE = new Set([KIND_INDEX.import, KIND_INDEX.export]);
const HERITAGE = new Set([KIND_INDEX.extends, KIND_INDEX.implements]);

interface CallIndex {
  /** Call-table row ids by `to` and by `from`. */
  byTo: Adjacency;
  byFrom: Adjacency;
}

const callIndexCache = new WeakMap<CodeSymbols, CallIndex>();

function callIndex(symbols: CodeSymbols): CallIndex {
  let cached = callIndexCache.get(symbols);
  if (!cached) {
    const n = symbols.symbols.name.length;
    const rows = Array.from({ length: symbols.calls.from.length }, (_, i) => i);
    cached = { byTo: csr(n, symbols.calls.to, rows), byFrom: csr(n, symbols.calls.from, rows) };
    callIndexCache.set(symbols, cached);
  }
  return cached;
}

export interface CallEdge {
  /** The other end: the caller for incoming edges, the callee for outgoing. */
  symbol: number;
  /** Reference count across every kind on this edge. */
  count: number;
  /** Ref kinds seen on this edge, most frequent first (indexes into REF_KINDS). */
  kinds: number[];
}

/**
 * Callers (incoming) or callees (outgoing) of a symbol, merged across ref kinds, busiest first.
 * Import/export specifiers are left out (they are wiring, not use) and so are extends/implements,
 * which the record shows as the type hierarchy instead.
 */
export function callEdges(symbols: CodeSymbols, symbol: number, direction: "incoming" | "outgoing"): CallEdge[] {
  const idx = callIndex(symbols);
  const adj = direction === "incoming" ? idx.byTo : idx.byFrom;
  const other = direction === "incoming" ? symbols.calls.from : symbols.calls.to;
  const merged = new Map<number, { count: number; kinds: Map<number, number> }>();
  for (let i = adj.offsets[symbol]!; i < adj.offsets[symbol + 1]!; i++) {
    const row = adj.targets[i]!;
    const kind = symbols.calls.kind[row]!;
    const peer = other[row]!;
    if (NOT_A_USE.has(kind) || HERITAGE.has(kind) || peer === symbol) continue;
    const entry = merged.get(peer) ?? { count: 0, kinds: new Map() };
    const c = symbols.calls.count[row]!;
    entry.count += c;
    entry.kinds.set(kind, (entry.kinds.get(kind) ?? 0) + c);
    merged.set(peer, entry);
  }
  return [...merged]
    .map(([peer, e]) => ({
      symbol: peer,
      count: e.count,
      kinds: [...e.kinds].sort((a, b) => b[1] - a[1]).map(([k]) => k),
    }))
    .sort((a, b) => b.count - a.count || symbols.symbols.name[a.symbol]!.localeCompare(symbols.symbols.name[b.symbol]!));
}

/** Type hierarchy rows: what a symbol extends/implements, and what extends/implements it. */
export function heritage(
  symbols: CodeSymbols,
  symbol: number,
): { bases: { symbol: number; kind: number }[]; derived: { symbol: number; kind: number }[] } {
  const idx = callIndex(symbols);
  const pick = (adj: Adjacency, other: number[]) => {
    const out = new Map<number, number>();
    for (let i = adj.offsets[symbol]!; i < adj.offsets[symbol + 1]!; i++) {
      const row = adj.targets[i]!;
      const kind = symbols.calls.kind[row]!;
      if (HERITAGE.has(kind) && other[row] !== symbol) out.set(other[row]!, kind);
    }
    return [...out].map(([s, kind]) => ({ symbol: s, kind }));
  };
  return { bases: pick(idx.byFrom, symbols.calls.to), derived: pick(idx.byTo, symbols.calls.from) };
}

/**
 * Where `from` refers to `to`: the first reference row, used to open the reader at a call site
 * from a hierarchy row. Scans `to`'s references, which are already grouped per symbol.
 */
export function callSite(
  symbols: CodeSymbols,
  refsOf: Adjacency,
  from: number,
  to: number,
): { file: number; line: number; col: number; len: number } | null {
  const r = symbols.refs;
  for (let i = refsOf.offsets[to]!; i < refsOf.offsets[to + 1]!; i++) {
    const row = refsOf.targets[i]!;
    if (r.from[row] === from && !NOT_A_USE.has(r.kind[row]!)) {
      return { file: r.file[row]!, line: r.line[row]!, col: r.col[row]!, len: r.len[row]! };
    }
  }
  return null;
}
