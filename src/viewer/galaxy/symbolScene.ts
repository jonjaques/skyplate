/**
 * A selected symbol's neighborhood, in files: where it is defined, every file that references
 * it (split into calls and other uses), the callers-of-callers ripple, what it calls, and,
 * for class and interface members, the implementations that answer for it.
 *
 * This is the user's own ask, verbatim: "dig down into a function def and see it light up the
 * project in the galaxy for usage, callsites, all interrelated". The galaxy draws exactly what
 * the compiler resolved, nothing inferred.
 */

import { REF_KINDS, type CodeSymbols } from "../../shared/schema";
import type { Model } from "../model/indices";
import { impactOf, referencingFiles, type SymbolModel } from "../model/symbols";
import { DIM } from "./encode";

const EXTENDS = REF_KINDS.indexOf("extends");
const IMPLEMENTS = REF_KINDS.indexOf("implements");

export interface SymbolArc {
  /** The referencing file (the arc's start); the definition file is the end. */
  file: number;
  calls: number;
  other: number;
  /** An implementation rather than a reference: drawn in the "other use" pattern. */
  implementation: boolean;
}

export interface SymbolScene {
  symbol: number;
  defFile: number;
  arcs: SymbolArc[];
  /** Files the symbol calls into (excluding its own file), with call-row counts. */
  callees: { file: number; count: number }[];
  /** Ripple depth per file (1 = direct callers, up to 3), -1 when not reached. */
  depth: Int8Array;
  /** Per-file emphasis for the star shader (see encodeEmphasis). */
  light: Float32Array;
  /** Files worth framing: definition, references, implementations. */
  frame: number[];
  /** Totals for the plate legend. */
  totals: { files: number; calls: number; other: number; ripple: number; implementations: number };
}

/** Members of `owner` whose name matches, found through the owner's file's symbol list. */
function memberNamed(symbols: CodeSymbols, sm: SymbolModel, owner: number, name: string): number[] {
  const file = symbols.symbols.file[owner]!;
  const out: number[] = [];
  const { offsets, targets } = sm.symbolsInFile;
  for (let k = offsets[file]!; k < offsets[file + 1]!; k++) {
    const s = targets[k]!;
    if (symbols.symbols.parent[s] === owner && symbols.symbols.name[s] === name) out.push(s);
  }
  return out;
}

export function buildSymbolScene(model: Model, symbols: CodeSymbols, sm: SymbolModel, symbol: number): SymbolScene {
  const n = model.fileCount;
  const table = symbols.symbols;
  const defFile = table.file[symbol]!;

  // Implementations: rows of the call table that say "X extends/implements Y". For a type,
  // they are its implementers; for a member of a type, the same-named member of each
  // implementer (an interface method lights the classes that implement it).
  const implSymbols = new Set<number>();
  const kind = table.kind[symbol];
  const owner = table.parent[symbol]!;
  const implementersOf = (type: number) => {
    const out: number[] = [];
    const calls = symbols.calls;
    for (let r = 0; r < calls.to.length; r++) {
      if (calls.to[r] === type && (calls.kind[r] === EXTENDS || calls.kind[r] === IMPLEMENTS)) out.push(calls.from[r]!);
    }
    return out;
  };
  if (kind === "class" || kind === "interface") {
    for (const s of implementersOf(symbol)) implSymbols.add(s);
  } else if (owner >= 0 && (table.kind[owner] === "class" || table.kind[owner] === "interface")) {
    for (const impl of implementersOf(owner)) for (const m of memberNamed(symbols, sm, impl, table.name[symbol]!)) implSymbols.add(m);
  }

  const refs = referencingFiles(symbols, sm, symbol);
  const arcs: SymbolArc[] = [];
  let calls = 0;
  let other = 0;
  for (const [file, c] of refs) {
    calls += c.calls;
    other += c.other;
    if (file !== defFile) arcs.push({ file, calls: c.calls, other: c.other, implementation: false });
  }
  const implFiles = new Set<number>();
  for (const s of implSymbols) {
    const f = table.file[s]!;
    if (f !== defFile && !refs.has(f)) implFiles.add(f);
  }
  for (const f of implFiles) arcs.push({ file: f, calls: 0, other: 1, implementation: true });
  // Heaviest first: if the arc budget ever truncates, the lightest uses go.
  arcs.sort((a, b) => b.calls + b.other - (a.calls + a.other) || a.file - b.file);

  // Ripple: callers of callers, by the shortest distance any of a file's symbols has.
  const depth = new Int8Array(n).fill(-1);
  const impact = impactOf(sm, symbol, 3);
  for (const [s, d] of impact) {
    if (d === 0) continue;
    const f = table.file[s]!;
    if (depth[f] === -1 || d < depth[f]!) depth[f] = d;
  }

  const calleeCount = new Map<number, number>();
  const { offsets, targets } = sm.calleesOf;
  for (let k = offsets[symbol]!; k < offsets[symbol + 1]!; k++) {
    const f = table.file[targets[k]!]!;
    if (f !== defFile) calleeCount.set(f, (calleeCount.get(f) ?? 0) + 1);
  }
  const callees = [...calleeCount].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count || a.file - b.file);

  // Emphasis: references lit by count (log-scaled so a 200-call hub does not blow out the
  // plate), the ripple at falling intensity, callees faint, everything else receding.
  const light = new Float32Array(n).fill(DIM);
  let maxRefs = 1;
  for (const a of arcs) maxRefs = Math.max(maxRefs, a.calls + a.other);
  let ripple = 0;
  for (let f = 0; f < n; f++) {
    const d = depth[f]!;
    if (d === 2) {
      light[f] = 0.75;
      ripple++;
    } else if (d === 3) {
      light[f] = 0.48;
      ripple++;
    }
  }
  for (const c of callees) light[c.file] = Math.max(light[c.file]!, 0.6);
  for (const a of arcs) {
    const t = Math.log1p(a.calls + a.other) / Math.log1p(maxRefs);
    light[a.file] = Math.max(light[a.file]!, a.implementation ? 1.25 : 1.15 + 0.85 * t);
  }
  light[defFile] = 2.2;

  const frame = [defFile, ...arcs.map((a) => a.file)];
  return {
    symbol,
    defFile,
    arcs,
    callees,
    depth,
    light,
    frame,
    totals: { files: refs.size, calls, other, ripple, implementations: implFiles.size },
  };
}
