/**
 * From the raw stores to the report's tables: sort references by (file, position), derive
 * per-symbol totals, aggregate the call table, flag unused exports, and apply the size cap.
 *
 * Totals, call edges and the unused-export flag are computed over every resolved reference,
 * before the cap. The cap exists to bound the data file; it should not make a symbol look
 * unused or a caller disappear from the graph, so only the per-reference rows are dropped.
 */

import { SymbolFlag, type CallTable, type RefTable, type SymbolTable } from "../../shared/schema";
import { REF, type FileDecls, type RefStore, type SymbolStore } from "./store";

export interface Tables {
  symbols: SymbolTable;
  refs: RefTable;
  calls: CallTable;
  fileRefStart: number[];
  moduleSymbol: number[];
  unusedExports: number;
  truncated: number;
}

export function buildTables(store: SymbolStore, refs: RefStore, fileCount: number, decls: Iterable<FileDecls>, maxRefs: number): Tables {
  const R = refs.length;
  const S = store.size;
  const sym = refs.symbol.data;
  const file = refs.file.data;
  const pos = refs.pos.data;
  const kind = refs.kind.data;
  const from = refs.from.data;

  // ─── Order: counting sort by file, then by position within each file ─────────────────────
  const start = new Int32Array(fileCount + 1);
  for (let i = 0; i < R; i++) start[file[i]! + 1]!++;
  for (let f = 0; f < fileCount; f++) start[f + 1]! += start[f]!;
  const order = new Int32Array(R);
  const cursor = start.slice(0, fileCount);
  for (let i = 0; i < R; i++) order[cursor[file[i]!]!++] = i;
  for (let f = 0; f < fileCount; f++) {
    const a = start[f]!;
    const b = start[f + 1]!;
    if (b - a > 1) order.subarray(a, b).sort((x, y) => pos[x]! - pos[y]! || x - y);
  }

  // ─── Totals and call edges, over every reference ─────────────────────────────────────────
  const refCount = new Int32Array(S);
  const fileTotals = new Int32Array(S);
  const lastFile = new Int32Array(S).fill(-1);
  const usedElsewhere = new Uint8Array(S);
  // (from, to, kind) packed into one safe integer: from·S + to < 2^40 for any real repository,
  // times 16 kinds stays well under 2^53.
  const edges = new Map<number, number>();
  for (let j = 0; j < R; j++) {
    const i = order[j]!;
    const s = sym[i]!;
    const f = file[i]!;
    const k = kind[i]!;
    refCount[s]!++;
    if (lastFile[s] !== f) {
      lastFile[s] = f;
      fileTotals[s]!++;
    }
    // Import and re-export lines are bookkeeping, not use: a barrel re-exporting a function
    // does not make it used, and neither does an import nobody reads.
    if (f !== store.file[s] && k !== REF.import && k !== REF.export) usedElsewhere[s] = 1;
    const key = (from[i]! * S + s) * 16 + k;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }

  const keys = [...edges.keys()].sort((a, b) => a - b);
  const calls: CallTable = { from: [], to: [], kind: [], count: [] };
  const callers = new Int32Array(S);
  let lastPair = -1;
  for (const key of keys) {
    const k = key % 16;
    const pair = (key - k) / 16;
    const to = pair % S;
    const caller = (pair - to) / S;
    calls.from.push(caller);
    calls.to.push(to);
    calls.kind.push(k);
    calls.count.push(edges.get(key)!);
    // Distinct callers, counted by the same rule the record's call hierarchy lists them
    // (callEdges in src/shared/calls.ts), because the record prints the two together:
    // - import/export rows are bookkeeping (the importing module is not a caller just because
    //   it names the symbol at the top of the file);
    // - extends/implements rows are the type hierarchy, which the record shows on its own. vite's
    //   BaseEnvironment read "Callers 4" above "Nothing in the project calls or uses it" when
    //   these counted: the four were subclasses;
    // - a symbol using itself (recursion) is not its own caller: vite's recursive `flatten`,
    //   called from one place, read "Callers 2" over a hierarchy listing one.
    if (k !== REF.import && k !== REF.export && k !== REF.extends && k !== REF.implements && caller !== to && pair !== lastPair) {
      callers[to]!++;
      lastPair = pair;
    }
  }

  let unusedExports = 0;
  for (let s = 0; s < S; s++) {
    if (store.flags[s]! & SymbolFlag.exported && store.kind[s] !== "module" && !usedElsewhere[s]) {
      store.flags[s]! |= SymbolFlag.unusedExport;
      unusedExports++;
    }
  }

  // ─── The cap ─────────────────────────────────────────────────────────────────────────────
  // Dropping the tail in file order would erase every reference in the last files of the repo.
  // Instead cap the most-referenced symbols: find the largest per-symbol allowance T such that
  // Σ min(refs(s), T) fits, so every symbol under T keeps all of its references and only the
  // heaviest (a logger, a vector type used 20,000 times) are cut, each to its first T.
  const limit = Number.isFinite(maxRefs) && maxRefs >= 0 ? Math.floor(maxRefs) : R;
  let kept: Int32Array = order;
  if (R > limit) {
    let max = 0;
    for (let s = 0; s < S; s++) if (refCount[s]! > max) max = refCount[s]!;
    const total = (t: number) => {
      let sum = 0;
      for (let s = 0; s < S; s++) sum += Math.min(refCount[s]!, t);
      return sum;
    };
    let lo = 0;
    let hi = max;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (total(mid) <= limit) lo = mid;
      else hi = mid - 1;
    }
    // Hand the rounding slack to the heaviest symbols in id order, one extra each.
    let slack = limit - total(lo);
    const allowance = new Int32Array(S);
    for (let s = 0; s < S; s++) {
      allowance[s] = Math.min(refCount[s]!, lo);
      if (slack > 0 && refCount[s]! > lo) {
        allowance[s]!++;
        slack--;
      }
    }
    kept = new Int32Array(limit);
    let n = 0;
    for (let j = 0; j < R; j++) {
      const i = order[j]!;
      const s = sym[i]!;
      if (allowance[s]! > 0) {
        allowance[s]!--;
        kept[n++] = i;
      }
    }
    kept = kept.subarray(0, n);
  }

  const out: RefTable = { symbol: [], file: [], line: [], col: [], len: [], kind: [], from: [] };
  const fileRefStart = new Array<number>(fileCount + 1).fill(0);
  for (const i of kept) {
    out.symbol.push(sym[i]!);
    out.file.push(file[i]!);
    out.line.push(refs.line.data[i]!);
    out.col.push(refs.col.data[i]!);
    out.len.push(refs.len.data[i]!);
    out.kind.push(kind[i]!);
    out.from.push(from[i]!);
    fileRefStart[file[i]! + 1]!++;
  }
  for (let f = 0; f < fileCount; f++) fileRefStart[f + 1]! += fileRefStart[f]!;

  const moduleSymbol = new Array<number>(fileCount).fill(-1);
  for (const d of decls) moduleSymbol[d.fileId] = d.moduleSymbol;

  const symbols: SymbolTable = {
    name: store.name,
    kind: store.kind,
    file: store.file,
    line: store.line,
    col: store.col,
    endLine: store.endLine,
    parent: store.parent,
    flags: store.flags,
    signature: store.signature,
    doc: store.doc,
    complexity: store.complexity,
    params: store.params,
    refs: Array.from(refCount),
    callers: Array.from(callers),
    files: Array.from(fileTotals),
  };
  return { symbols, refs: out, calls, fileRefStart, moduleSymbol, unusedExports, truncated: R - kept.length };
}
