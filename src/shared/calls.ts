/**
 * What the call table means: callers, callees, the type hierarchy and calls through bases.
 *
 * CodeSymbols.calls stores one row per (from, to, kind). Reading it as "who calls this" takes
 * rules: import/export specifiers are wiring, not use; extends/implements rows are the type
 * hierarchy; a symbol's rows naming itself are recursion. Those rules decide what the viewer's
 * symbol record lists and what the MCP server answers (src/mcp/), so they live here, once,
 * where both import them: two copies would let "Callers 12" in the record and "12 callers" from
 * an agent drift apart. The analyzer's own `callers` column follows the same rule
 * (src/core/ts/tables.ts).
 *
 * Pure, no DOM. The indexes are CSR arrays cached against the table they came from (WeakMap),
 * so a report swap drops them with the old data.
 */

import { REF_KINDS, type CodeSymbols, type SymbolKind } from "./schema";

/** Compressed sparse rows: neighbors of node i are targets[offsets[i] .. offsets[i + 1]). */
export interface Adjacency {
  offsets: Int32Array;
  targets: Int32Array;
}

/** Group `values` by `keys` (each in 0..n-1), keeping row order within a key. */
export function csr(n: number, keys: ArrayLike<number>, values: ArrayLike<number>): Adjacency {
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < keys.length; i++) offsets[keys[i]! + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const targets = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) targets[fill[keys[i]!]!++] = values[i]!;
  return { offsets, targets };
}

/**
 * Ref kinds that invoke the symbol (a call, `new`, a JSX element). A caller is labeled by these:
 * an interface read "Callers 435" when all 435 were type annotations.
 */
export const CALL_KINDS: ReadonlySet<number> = new Set<number>([
  REF_KINDS.indexOf("call"),
  REF_KINDS.indexOf("new"),
  REF_KINDS.indexOf("jsx"),
]);

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

// ─── Host uses ───────────────────────────────────────────────────────────────────────────────

export interface HostUse {
  /** The importing file: a Vue, Svelte or Astro component, a VitePress page, an MDX file. */
  file: number;
  /** 0-based line of its import statement. */
  line: number;
}

const hostUseIndex = new WeakMap<CodeSymbols, Adjacency>();

/**
 * Imports of a symbol from files the compiler never read (CodeSymbols.hostUses), in file order.
 * They are not references, so refs, callers and files all leave them out, and a composable used
 * only from .vue files read "References 0, Callers 0" with nothing to say where it is used.
 * Grouped once per table rather than binary-searched, so it holds even if a report's rows ever
 * arrive unsorted.
 */
export function hostUsesOf(symbols: CodeSymbols, symbol: number): HostUse[] {
  const host = symbols.hostUses;
  if (!host || host.symbol.length === 0) return [];
  let index = hostUseIndex.get(symbols);
  if (!index) {
    index = csr(
      symbols.symbols.name.length,
      host.symbol,
      Array.from({ length: host.symbol.length }, (_, i) => i),
    );
    hostUseIndex.set(symbols, index);
  }
  const out: HostUse[] = [];
  for (let i = index.offsets[symbol]!; i < index.offsets[symbol + 1]!; i++) {
    const row = index.targets[i]!;
    out.push({ file: host.file[row]!, line: host.line[row]! });
  }
  return out;
}

// ─── Unreferenced symbols ────────────────────────────────────────────────────────────────────

const unreferencedCache = new WeakMap<CodeSymbols, Uint8Array>();

/**
 * 1 for each symbol nothing references at all: no callers (the column is counted before the
 * reference cap, so a truncated table cannot fake it) and no reference rows but import/export
 * specifiers, which name a symbol without using it. Of the unused exports (exported, nothing
 * outside its file uses it) these are the dead ones; the rest are used inside their own file
 * and only need to lose `export`. The findings and the MCP server's search both split the two
 * with this, so a count in one is a count in the other.
 */
export function unreferenced(symbols: CodeSymbols): Uint8Array {
  let mask = unreferencedCache.get(symbols);
  if (mask) return mask;
  const count = symbols.symbols.name.length;
  const used = new Uint8Array(count);
  const r = symbols.refs;
  for (let i = 0; i < r.symbol.length; i++) if (!NOT_A_USE.has(r.kind[i]!)) used[r.symbol[i]!] = 1;
  mask = new Uint8Array(count);
  for (let s = 0; s < count; s++) mask[s] = symbols.symbols.callers[s] === 0 && !used[s] ? 1 : 0;
  unreferencedCache.set(symbols, mask);
  return mask;
}
