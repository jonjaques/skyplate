/**
 * Indexes the record and the call hierarchy need that the shared model does not carry.
 *
 * Each is built lazily the first time a panel asks and cached against the table it came from
 * (WeakMap keyed by the report or symbol object), so a report swap drops them with the old data
 * and nothing is computed for a reader who never opens that panel. They are CSR arrays for the
 * same reason model/indices.ts gives: a 20k-commit history or a 60k-row call table scanned once
 * per click is what makes a big report feel slow.
 */

import { REF_KINDS, type CodeSymbols, type FileRecord, type Report, type SymbolKind } from "../../shared/schema";
import type { Adjacency, Model } from "../model/indices";
import { CALL_KINDS } from "../model/symbols";
import type { Filters } from "../state/store";
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

// ─── File edges ──────────────────────────────────────────────────────────────────────────────

export interface EdgeSplit {
  /** Code dependencies (import, include, require, reference), the edges fanIn/fanOut count. */
  imports: Adjacency;
  importedBy: Adjacency;
  /** Document links (a Markdown file linking another file in the repo). */
  linksTo: Adjacency;
  linkedFrom: Adjacency;
}

const edgeSplitCache = new WeakMap<Report, EdgeSplit>();

/**
 * The report's file edges, split the way the analyzer splits them. Its fan-in, fan-out and
 * PageRank use code edges only (docs linking each other would top PageRank and form "cycles"
 * that say nothing about the code), but report.edges carries the links too. The record read its
 * figures from one and its lists from the other, so README.md said "Imports 0" above a list of
 * 27 imports. Splitting here lets every count and list name one edge set.
 */
export function edgeSplit(report: Report): EdgeSplit {
  let cached = edgeSplitCache.get(report);
  if (!cached) {
    const n = report.files.length;
    const { from, to, kind } = report.edges;
    const code: [number[], number[]] = [[], []];
    const link: [number[], number[]] = [[], []];
    for (let i = 0; i < from.length; i++) {
      const bucket = kind[i] === "link" ? link : code;
      bucket[0].push(from[i]!);
      bucket[1].push(to[i]!);
    }
    cached = {
      imports: csr(n, code[0], code[1]),
      importedBy: csr(n, code[1], code[0]),
      linksTo: csr(n, link[0], link[1]),
      linkedFrom: csr(n, link[1], link[0]),
    };
    edgeSplitCache.set(report, cached);
  }
  return cached;
}

/** Number of neighbors a file has in one adjacency. */
export function degree(adj: Adjacency, node: number): number {
  return adj.offsets[node + 1]! - adj.offsets[node]!;
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export interface DirSummary {
  languages: { id: string; lines: number }[];
  largest: number[];
  hottest: number[];
  owners: { author: number; files: number }[];
  codeLines: number;
  /** Files with code lines that the filters hide, so the language mix leaves them out. */
  filteredOut: number;
}

/** The shared filters' test, as the charts and trays apply it (charts/data.ts scopeFiles). */
export function passes(f: FileRecord, filters: Filters): boolean {
  if (filters.languages && !filters.languages.has(f.language)) return false;
  if (filters.categories && !filters.categories.has(f.category)) return false;
  if (filters.hideGenerated && f.generated) return false;
  if (filters.hideVendored && f.vendored) return false;
  return true;
}

/** Filters that hide nothing at all, vendored files included: what "Show all files" sets. */
export const NO_FILTERS: Filters = { languages: null, categories: null, hideGenerated: false, hideVendored: false };

/** Does any filter hide anything? Unlike the plate's chip, the default "hide vendored" counts. */
export function filtering(filters: Filters): boolean {
  return filters.languages !== null || filters.categories !== null || filters.hideGenerated || filters.hideVendored;
}

/**
 * The filters in a few words, for a note beside a count ("TypeScript only, vendored"). Language
 * names come from `languageName`; two or fewer are named, more are counted.
 */
export function describeFilters(filters: Filters, languageName: (id: string) => string): string {
  const parts: string[] = [];
  if (filters.languages) {
    const names = [...filters.languages].map(languageName);
    parts.push(names.length <= 2 ? `${names.join(" and ")} only` : `${names.length} languages only`);
  }
  if (filters.categories) parts.push(filters.categories.size === 1 ? `${[...filters.categories][0]} only` : `${filters.categories.size} categories only`);
  if (filters.hideGenerated) parts.push("generated");
  if (filters.hideVendored) parts.push("vendored");
  return parts.join(", ");
}

/** Language mix, largest and hottest files, and owners beneath one directory. */
export function summarizeDir(model: Model, dir: number, filters?: Filters): DirSummary {
  const report = model.report;
  const ids = filesUnder(model, dir);
  const langs = new Map<string, number>();
  const owners = new Map<number, number>();
  const bots = report.git?.authors.map((a) => a.bot) ?? [];
  let codeLines = 0;
  let filteredOut = 0;
  for (const id of ids) {
    const f = report.files[id]!;
    // Code lines only, and only files the filters let through: the measure the Language
    // composition tray uses. The record sits beside that tray for the same drawer; weighting
    // comments gave it different shares, and counting the vendored files the tray hides by
    // default gave it a different number of languages ("15 languages" over "Language mix 16").
    const weight = f.code;
    if (weight > 0 && filters && !passes(f, filters)) filteredOut++;
    else if (weight > 0) {
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
    filteredOut,
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

/**
 * Kinds read as functions: their record keeps the words "Call hierarchy", "Incoming" and
 * "Outgoing". Every other kind's dependents are "Used by": an interface's 435 incoming rows are
 * type annotations, and "Callers 435" claimed they ran it.
 */
export const FUNCTION_LIKE: ReadonlySet<SymbolKind> = new Set<SymbolKind>(["function", "method", "constructor", "component", "hook"]);

/**
 * Split edges by whether the peer invokes the symbol at least once (a call, `new`, JSX) or only
 * names it (passes it as a callback, reads it, uses it as a type). The two halves of "Callers".
 */
export function partitionByCall(edges: CallEdge[]): { calls: CallEdge[]; other: CallEdge[] } {
  const calls: CallEdge[] = [];
  const other: CallEdge[] = [];
  for (const e of edges) (e.kinds.some((k) => CALL_KINDS.has(k)) ? calls : other).push(e);
  return { calls, other };
}

/**
 * Split outgoing edges into what a symbol uses and the types it only annotates with. A function
 * whose signature names six interfaces listed them between its real callees, so "what does this
 * call" had to be read off the per-row kind badges.
 */
export function partitionTypeRefs(edges: CallEdge[]): { uses: CallEdge[]; types: CallEdge[] } {
  const uses: CallEdge[] = [];
  const types: CallEdge[] = [];
  for (const e of edges) (e.kinds.every((k) => k === KIND_INDEX.type) ? types : uses).push(e);
  return { uses, types };
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
 * from a hierarchy row. Scans `to`'s references, which are already grouped per symbol. With
 * `prefer`, a row of one of those kinds wins over an earlier row of another kind (an
 * anonymous class's `extends` clause rather than a type annotation above it).
 */
export function callSite(
  symbols: CodeSymbols,
  refsOf: Adjacency,
  from: number,
  to: number,
  prefer?: ReadonlySet<number>,
): { file: number; line: number; col: number; len: number } | null {
  const r = symbols.refs;
  let fallback: number | null = null;
  for (let i = refsOf.offsets[to]!; i < refsOf.offsets[to + 1]!; i++) {
    const row = refsOf.targets[i]!;
    if (r.from[row] !== from || NOT_A_USE.has(r.kind[row]!)) continue;
    if (!prefer || prefer.has(r.kind[row]!)) return { file: r.file[row]!, line: r.line[row]!, col: r.col[row]!, len: r.len[row]! };
    fallback ??= row;
  }
  return fallback === null ? null : { file: r.file[fallback]!, line: r.line[fallback]!, col: r.col[fallback]!, len: r.len[fallback]! };
}

export const HERITAGE_KINDS: ReadonlySet<number> = HERITAGE;

/**
 * How often a symbol refers to itself (direct recursion). callEdges leaves the self-edge out,
 * because a row naming the symbol inside its own hierarchy would expand forever, so this is
 * the one place recursion is counted; mutual recursion shows as a cycle when rows expand.
 */
export function selfCalls(symbols: CodeSymbols, symbol: number): number {
  const idx = callIndex(symbols);
  let n = 0;
  for (let i = idx.byFrom.offsets[symbol]!; i < idx.byFrom.offsets[symbol + 1]!; i++) {
    const row = idx.byFrom.targets[i]!;
    const kind = symbols.calls.kind[row]!;
    if (symbols.calls.to[row] === symbol && !NOT_A_USE.has(kind) && !HERITAGE.has(kind)) n += symbols.calls.count[row]!;
  }
  return n;
}

/**
 * Callers that reach a symbol through what it implements or overrides. A method behind an
 * interface is called as `this.saves.read(slot)`, and the checker resolves that to
 * SaveStore.read, so IndexedDbSaveStore.read had no callers of its own and its record said
 * "Nothing in the project calls or uses it" about code that runs on every load. One level of
 * bases is followed: the interface member, or the overridden base method.
 */
export function callsThroughBases(symbols: CodeSymbols, symbol: number): { base: number; edges: CallEdge[] }[] {
  return heritage(symbols, symbol)
    .bases.map(({ symbol: base }) => ({
      base,
      edges: callEdges(symbols, base, "incoming").filter((e) => e.symbol !== symbol),
    }))
    .filter((g) => g.edges.length > 0);
}
