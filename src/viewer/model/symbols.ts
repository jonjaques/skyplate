/**
 * Derived indexes over the code-intelligence tables (CodeSymbols), built when they load.
 *
 * The tables arrive grouped for the source reader (references sorted by file and position).
 * Following a function outward ("who calls this, and who calls them") needs the other
 * groupings: references by symbol, callers and callees by symbol, symbols by file. They are
 * built once here as CSR arrays so a selection can light up the galaxy without scanning
 * hundreds of thousands of references.
 */

import { CALL_KINDS } from "../../shared/calls";
import type { CodeSymbols } from "../../shared/schema";
import type { Adjacency, Model } from "./indices";

// CALL_KINDS and hostUsesOf moved to src/shared/calls.ts, where the MCP server reads them too;
// re-exported so the viewer keeps importing them from here.
export { CALL_KINDS, hostUsesOf, type HostUse } from "../../shared/calls";

export interface SymbolModel {
  /** Reference row ids per symbol. */
  refsOf: Adjacency;
  /** Distinct caller symbols per symbol (incoming edges of the call table, any kind). */
  callersOf: Adjacency;
  /** Distinct callee symbols per symbol (outgoing edges). */
  calleesOf: Adjacency;
  /** Symbol ids declared in each file, in source order. */
  symbolsInFile: Adjacency;
  /** Lowercased names, for search. */
  lowerNames: string[];
}

export function buildSymbolModel(symbols: CodeSymbols, model: Model): SymbolModel {
  const count = symbols.symbols.name.length;
  const refs = symbols.refs;

  const refsOf = group(count, refs.symbol, (i) => i);
  const callersOf = dedupedGroup(count, symbols.calls.to, symbols.calls.from);
  const calleesOf = dedupedGroup(count, symbols.calls.from, symbols.calls.to);

  const byFile = Array.from({ length: symbols.symbols.file.length }, (_, i) => i).sort(
    (a, b) =>
      symbols.symbols.file[a]! - symbols.symbols.file[b]! || symbols.symbols.line[a]! - symbols.symbols.line[b]!,
  );
  const symbolsInFile = group(model.fileCount, byFile.map((s) => symbols.symbols.file[s]!), (i) => byFile[i]!);

  return {
    refsOf,
    callersOf,
    calleesOf,
    symbolsInFile,
    lowerNames: symbols.symbols.name.map((n) => n.toLowerCase()),
  };
}

function group(n: number, keys: ArrayLike<number>, value: (row: number) => number): Adjacency {
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < keys.length; i++) offsets[keys[i]! + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const targets = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) targets[fill[keys[i]!]!++] = value(i);
  return { offsets, targets };
}

function dedupedGroup(n: number, keys: number[], values: number[]): Adjacency {
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < keys.length; i++) if (keys[i] !== values[i]) sets[keys[i]!]!.add(values[i]!);
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + sets[i]!.size;
  const targets = new Int32Array(offsets[n]!);
  for (let i = 0; i < n; i++) targets.set([...sets[i]!], offsets[i]!);
  return { offsets, targets };
}

/**
 * Change impact: every symbol that reaches `start` through callers, up to `maxDepth` hops,
 * with its distance. Depth 1 is direct callers. This is what the galaxy draws as ripples:
 * change this function, and these are the places that might feel it.
 */
export function impactOf(sm: SymbolModel, start: number, maxDepth = 3): Map<number, number> {
  const depth = new Map<number, number>([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const s of frontier) {
      const { offsets, targets } = sm.callersOf;
      for (let i = offsets[s]!; i < offsets[s + 1]!; i++) {
        const caller = targets[i]!;
        if (!depth.has(caller)) {
          depth.set(caller, d);
          next.push(caller);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

/** Files referencing a symbol, with reference counts split into call-like and other uses. */
export function referencingFiles(
  symbols: CodeSymbols,
  sm: SymbolModel,
  symbol: number,
): Map<number, { calls: number; other: number }> {
  const out = new Map<number, { calls: number; other: number }>();
  const { offsets, targets } = sm.refsOf;
  for (let i = offsets[symbol]!; i < offsets[symbol + 1]!; i++) {
    const row = targets[i]!;
    const file = symbols.refs.file[row]!;
    const entry = out.get(file) ?? { calls: 0, other: 0 };
    if (CALL_KINDS.has(symbols.refs.kind[row]!)) entry.calls++;
    else entry.other++;
    out.set(file, entry);
  }
  return out;
}
