/**
 * A selected symbol's neighborhood, in files: where it is defined, every file that references
 * it (split into calls, implementations and other uses), the callers-of-callers ripple, what
 * it calls, and, per file, why that file is lit (the hover card reads it).
 *
 * This is the user's own ask, verbatim: "dig down into a function def and see it light up the
 * project in the galaxy for usage, callsites, all interrelated". The galaxy draws exactly what
 * the compiler resolved, nothing inferred.
 */

import { REF_KINDS, type CodeSymbols, type RefKind, type SymbolKind } from "../../shared/schema";
import { formatInt, plural } from "../lib/format";
import type { Model } from "../model/indices";
import type { SymbolModel } from "../model/symbols";
import { DIM } from "./encode";

const kindIndex = (k: RefKind) => REF_KINDS.indexOf(k);
const CALL = kindIndex("call");
const NEW = kindIndex("new");
const JSX = kindIndex("jsx");
const READ = kindIndex("read");
const WRITE = kindIndex("write");
const EXTENDS = kindIndex("extends");
const IMPLEMENTS = kindIndex("implements");

const isCallish = (k: number) => k === CALL || k === NEW || k === JSX;
const isImpl = (k: number) => k === EXTENDS || k === IMPLEMENTS;
/** A use that moves the value at run time: calling it, constructing it, reading or writing it. */
const isValueUse = (k: number) => isCallish(k) || k === READ || k === WRITE;

/**
 * Kinds that exist only for the type checker. Nothing calls an interface or a type alias at run
 * time, so "callers of callers" means nothing for them: a ripple through code that merely
 * mentions the type lit 435 of 1,079 files for one alias. They get no ripple at all.
 */
export const TYPE_LEVEL: ReadonlySet<SymbolKind> = new Set<SymbolKind>(["interface", "type"]);
export const CALLABLE: ReadonlySet<SymbolKind> = new Set<SymbolKind>(["function", "method", "constructor", "getter", "setter", "component", "hook"]);

export interface SymbolArc {
  /** The referencing file (the arc's start); the definition file is the end. */
  file: number;
  /** call, new and jsx rows. */
  calls: number;
  /** extends and implements rows: the file declares an implementation or override of it. */
  impl: number;
  /** Every other row: types, reads, writes, imports, exports. */
  other: number;
  /** Rows per REF_KINDS index, for the hover card ("12 calls, 1 import of vec3"). */
  kinds: Uint32Array;
  /** Drawn in the implementation style (it has extends or implements rows). */
  implementation: boolean;
  /** 1 for the heaviest arc (most rows), counting up. */
  rank: number;
}

export interface RippleStep {
  /** Hops from the definition: 2 is a caller of a direct user, 3 one further out. */
  depth: number;
  /** The symbol in this file that was reached. */
  caller: number;
  /** The symbol it calls, one hop nearer the definition. */
  via: number;
}

export interface SymbolScene {
  symbol: number;
  defFile: number;
  /** An interface or type alias: no ripple, and the legend says "uses", not "calls". */
  typeLevel: boolean;
  callable: boolean;
  arcs: SymbolArc[];
  arcOf: Map<number, SymbolArc>;
  /** References inside the definition's own file (they draw no arc), with rows per kind. */
  own: { calls: number; impl: number; other: number; kinds: ArrayLike<number> };
  /** Files the symbol calls into (call, new and jsx only; not its own file), with symbol counts. */
  callees: { file: number; count: number }[];
  /** The callee symbols in each of those files. */
  calleeSymbols: Map<number, number[]>;
  /** Ripple files (not direct users), with the hop that reached each. */
  ripple: Map<number, RippleStep>;
  /** Hops per file for the shader's wave (0 definition, 1 direct, 2-3 ripple), -1 when not reached. */
  depth: Int8Array;
  /** Per-file emphasis for the star shader (see encodeEmphasis). */
  light: Float32Array;
  /** Files worth framing: definition, references, and the ripple when the direct set is tiny. */
  frame: number[];
  /** Totals for the plate legend. */
  totals: {
    /** Distinct files with any reference, the definition's own file included. */
    files: number;
    calls: number;
    other: number;
    /** Files that implement or override it, its own file included. */
    implementations: number;
    ripple: number;
  };
}

// ─── Call index: the call table regrouped, call-like rows only ───────────────────────────────

interface Csr {
  offsets: Int32Array;
  targets: Int32Array;
}

interface CallIndex {
  /** Distinct symbols calling each symbol (call, new, jsx). */
  callers: Csr;
  /** Distinct symbols each symbol calls (call, new, jsx). */
  callees: Csr;
  /** Distinct symbols using each symbol's value (calls plus reads and writes). */
  valueUsers: Csr;
}

/**
 * The symbol model's callersOf / calleesOf count every row of the call table, import and export
 * specifiers and type references included, so "callers of callers" there is partly "importers
 * of importers". The galaxy's ripple and callee lanes need the run-time edges only. Built once
 * per loaded table (a WeakMap, so a new report drops it) rather than per selection.
 */
const callIndexCache = new WeakMap<CodeSymbols, CallIndex>();

function grouped(n: number, keys: number[], values: number[]): Csr {
  const offsets = new Int32Array(n + 1);
  for (const k of keys) offsets[k + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const raw = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) raw[fill[keys[i]!]!++] = values[i]!;
  // The call table is one row per (from, to, kind), so a pair repeats only across kinds (a
  // `new X()` and an `X.of()` from one function). Sort each group and drop repeats in place.
  const out = new Int32Array(n + 1);
  let w = 0;
  for (let k = 0; k < n; k++) {
    const group = raw.subarray(offsets[k]!, offsets[k + 1]!).sort();
    out[k] = w;
    for (let i = 0; i < group.length; i++) if (i === 0 || group[i] !== group[i - 1]) raw[w++] = group[i]!;
  }
  out[n] = w;
  return { offsets: out, targets: raw.slice(0, w) };
}

export function callIndex(symbols: CodeSymbols): CallIndex {
  const cached = callIndexCache.get(symbols);
  if (cached) return cached;
  const n = symbols.symbols.name.length;
  const { from, to, kind } = symbols.calls;
  const callTo: number[] = [];
  const callFrom: number[] = [];
  const useTo: number[] = [];
  const useFrom: number[] = [];
  for (let r = 0; r < from.length; r++) {
    const k = kind[r]!;
    if (from[r] === to[r]) continue;
    if (isValueUse(k)) {
      useTo.push(to[r]!);
      useFrom.push(from[r]!);
    }
    if (isCallish(k)) {
      callTo.push(to[r]!);
      callFrom.push(from[r]!);
    }
  }
  const index: CallIndex = {
    callers: grouped(n, callTo, callFrom),
    callees: grouped(n, callFrom, callTo),
    valueUsers: grouped(n, useTo, useFrom),
  };
  callIndexCache.set(symbols, index);
  return index;
}

/** Ripple frames are capped: past this many files the frame is the whole galaxy anyway. */
const RIPPLE_FRAME_CAP = 240;
/** "Tiny" direct set: fewer arcs than this and the ripple joins the frame. */
const TINY_DIRECT = 6;

export function buildSymbolScene(model: Model, symbols: CodeSymbols, sm: SymbolModel, symbol: number): SymbolScene {
  const n = model.fileCount;
  const table = symbols.symbols;
  const defFile = table.file[symbol]!;
  const kind = table.kind[symbol]!;
  const typeLevel = TYPE_LEVEL.has(kind);
  const index = callIndex(symbols);

  // ── Every reference row, split three ways per file ──
  // Implementations arrive as reference rows: the heritage clause (`class A implements Svc`)
  // writes one on the type, and the analyzer's override linking writes one from each
  // implementing member to the member it implements. Reading them here, rather than looking
  // implementers up in the call table and skipping files already in the references, is what
  // lets them be drawn at all: an implementer's file always holds that very row.
  const perFile = new Map<number, SymbolArc>();
  const { offsets, targets } = sm.refsOf;
  for (let i = offsets[symbol]!; i < offsets[symbol + 1]!; i++) {
    const row = targets[i]!;
    const file = symbols.refs.file[row]!;
    const k = symbols.refs.kind[row]!;
    let arc = perFile.get(file);
    if (!arc) perFile.set(file, (arc = { file, calls: 0, impl: 0, other: 0, kinds: new Uint32Array(REF_KINDS.length), implementation: false, rank: 0 }));
    arc.kinds[k]!++;
    if (isCallish(k)) arc.calls++;
    else if (isImpl(k)) arc.impl++;
    else arc.other++;
  }

  const own: SymbolScene["own"] = { calls: 0, impl: 0, other: 0, kinds: new Uint32Array(REF_KINDS.length) };
  const arcs: SymbolArc[] = [];
  let calls = 0;
  let other = 0;
  let implFiles = 0;
  for (const arc of perFile.values()) {
    calls += arc.calls;
    other += arc.other;
    if (arc.impl > 0) implFiles++;
    arc.implementation = arc.impl > 0;
    if (arc.file === defFile) {
      own.calls = arc.calls;
      own.impl = arc.impl;
      own.other = arc.other;
      own.kinds = arc.kinds;
    } else arcs.push(arc);
  }
  // Heaviest first: if the arc budget ever truncates, the lightest uses go.
  arcs.sort((a, b) => b.calls + b.impl + b.other - (a.calls + a.impl + a.other) || a.file - b.file);
  arcs.forEach((a, i) => (a.rank = i + 1));
  const arcOf = new Map(arcs.map((a) => [a.file, a]));

  // ── Ripple: who calls the code that uses it, up to three hops, run-time edges only ──
  const depth = new Int8Array(n).fill(-1);
  const ripple = new Map<number, RippleStep>();
  if (!typeLevel) {
    const reached = new Map<number, number>([[symbol, 0]]);
    const parent = new Map<number, number>();
    let frontier: number[] = [];
    const users = index.valueUsers;
    for (let k = users.offsets[symbol]!; k < users.offsets[symbol + 1]!; k++) {
      const s = users.targets[k]!;
      if (reached.has(s)) continue;
      reached.set(s, 1);
      parent.set(s, symbol);
      frontier.push(s);
    }
    const callers = index.callers;
    for (let d = 2; d <= 3 && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const s of frontier) {
        for (let k = callers.offsets[s]!; k < callers.offsets[s + 1]!; k++) {
          const c = callers.targets[k]!;
          if (reached.has(c)) continue;
          reached.set(c, d);
          parent.set(c, s);
          next.push(c);
        }
      }
      frontier = next;
    }
    for (const [s, d] of reached) {
      if (d < 2) continue;
      const f = table.file[s]!;
      if (f === defFile || perFile.has(f)) continue;
      const prev = ripple.get(f);
      if (!prev || d < prev.depth) ripple.set(f, { depth: d, caller: s, via: parent.get(s)! });
    }
  }
  for (const [f, step] of ripple) depth[f] = step.depth;
  for (const a of arcs) depth[a.file] = 1;
  depth[defFile] = 0;

  // ── What it calls: call-like edges only, so a signature's types are not "callees" ──
  const calleeSymbols = new Map<number, number[]>();
  const out = index.callees;
  for (let k = out.offsets[symbol]!; k < out.offsets[symbol + 1]!; k++) {
    const s = out.targets[k]!;
    const f = table.file[s]!;
    if (f === defFile) continue;
    const list = calleeSymbols.get(f);
    if (list) list.push(s);
    else calleeSymbols.set(f, [s]);
  }
  const callees = [...calleeSymbols].map(([file, list]) => ({ file, count: list.length })).sort((a, b) => b.count - a.count || a.file - b.file);

  // ── Emphasis: references lit by count (log-scaled so a 200-call hub does not blow out the
  // plate), the ripple at falling intensity, callees faint, everything else receding ──
  const light = new Float32Array(n).fill(DIM);
  let maxRefs = 1;
  for (const a of arcs) maxRefs = Math.max(maxRefs, a.calls + a.impl + a.other);
  for (const [f, step] of ripple) light[f] = step.depth === 2 ? 0.75 : 0.48;
  for (const c of callees) light[c.file] = Math.max(light[c.file]!, 0.6);
  for (const a of arcs) {
    const t = Math.log1p(a.calls + a.impl + a.other) / Math.log1p(maxRefs);
    light[a.file] = Math.max(light[a.file]!, 1.15 + 0.85 * t);
  }
  light[defFile] = 2.2;

  // A symbol used only in its own file, or by one or two others, framed on its direct set
  // alone is a close-up of one star while the "14 more files" of ripple sit off-screen.
  const frame = [defFile, ...arcs.map((a) => a.file)];
  if (arcs.length < TINY_DIRECT) {
    const extra = [...ripple].sort((a, b) => a[1].depth - b[1].depth || a[0] - b[0]).slice(0, RIPPLE_FRAME_CAP);
    for (const [f] of extra) frame.push(f);
  }

  return {
    symbol,
    defFile,
    typeLevel,
    callable: CALLABLE.has(kind),
    arcs,
    arcOf,
    own,
    callees,
    calleeSymbols,
    ripple,
    depth,
    light,
    frame,
    totals: { files: perFile.size, calls, other, implementations: implFiles, ripple: ripple.size },
  };
}

// ─── Why a file is lit ───────────────────────────────────────────────────────────────────────

const KIND_WORD: Record<RefKind, [string, string]> = {
  call: ["call", "calls"],
  new: ["construction", "constructions"],
  jsx: ["JSX use", "JSX uses"],
  read: ["read", "reads"],
  write: ["write", "writes"],
  type: ["type use", "type uses"],
  import: ["import", "imports"],
  export: ["re-export", "re-exports"],
  extends: ["extends row", "extends rows"],
  implements: ["implements row", "implements rows"],
};

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "12 calls, 1 import": the largest kinds first, at most three, implementation rows left out. */
export function usePhrase(kinds: ArrayLike<number>): string {
  const parts: [number, number][] = [];
  for (let k = 0; k < kinds.length; k++) if (kinds[k]! > 0 && !isImpl(k)) parts.push([k, kinds[k]!]);
  parts.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return parts
    .slice(0, 3)
    .map(([k, c]) => {
      const [one, many] = KIND_WORD[REF_KINDS[k]!];
      return plural(c, one, many);
    })
    .join(", ");
}

/** A member as people write it ("SaveStore.read"); top-level names as they are. */
function qualified(table: CodeSymbols["symbols"], s: number): string {
  const p = table.parent[s]!;
  return p >= 0 && table.kind[p] !== "module" ? `${table.name[p]}.${table.name[s]}` : table.name[s]!;
}

/** Who did the calling: a symbol by name, or a file's top-level code. */
function caller(table: CodeSymbols["symbols"], s: number): string {
  return table.kind[s] === "module" ? `top-level code in ${table.name[s]}` : qualified(table, s);
}

function names(table: CodeSymbols["symbols"], ids: number[], max = 2): string {
  const shown = ids.slice(0, max).map((s) => qualified(table, s));
  return ids.length > max ? `${shown.join(", ")} and ${ids.length - max} more` : shown.join(", ");
}

/**
 * One line on why `file` is lit while the scene is shown, for the hover card's footnote: a
 * direct use (with its kinds and rank), an implementation, a ripple hop, or a callee. Null when
 * the file plays no part (the card falls back to its ordinary det. line).
 */
export function describeRelation(scene: SymbolScene, symbols: CodeSymbols, file: number): string | null {
  const t = symbols.symbols;
  const name = qualified(t, scene.symbol);
  const member = t.parent[scene.symbol]! >= 0 && t.kind[t.parent[scene.symbol]!] !== "module";
  if (file === scene.defFile) {
    const { calls, other, kinds } = scene.own;
    const here = calls + other > 0 ? `; ${plural(calls + other, "use")} in this file` : "";
    const also = kinds[IMPLEMENTS]! > 0 ? ", implemented here too" : kinds[EXTENDS]! > 0 ? (member ? ", overridden here too" : ", extended here too") : "";
    return `Defines ${name}${here}${also}`;
  }
  const arc = scene.arcOf.get(file);
  if (arc) {
    const uses = usePhrase(arc.kinds);
    const rank = `${ordinal(arc.rank)} heaviest of ${formatInt(scene.arcs.length)}`;
    if (arc.implementation) {
      const verb = arc.kinds[IMPLEMENTS]! > 0 ? "Implements" : member ? "Overrides" : "Extends";
      return `${verb} ${name}${uses ? `, plus ${uses}` : ""} · ${rank}`;
    }
    return `${uses} of ${name} · ${rank}`;
  }
  const step = scene.ripple.get(file);
  if (step) return `Ripple, ${step.depth} hops: ${caller(t, step.caller)} calls ${qualified(t, step.via)}`;
  const callees = scene.calleeSymbols.get(file);
  if (callees) return `${name} calls into this file: ${names(t, callees)}`;
  return null;
}

