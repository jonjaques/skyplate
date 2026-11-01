/**
 * The galaxy's pure logic (src/viewer/galaxy): what a selected symbol lights and why, how the
 * plate dims under filters, where the scrubber's columns go, and the label overlay's geometry.
 *
 * The symbol cases run on a hand-built code-intelligence table small enough to read: one
 * interface with a method, an implementing class, a direct caller, a caller of that caller, a
 * file that only mentions the types, and a file that only imports the caller.
 *
 *   bun test src/viewer/galaxy
 */

import { describe, expect, test } from "bun:test";
import { REF_KINDS, type CodeSymbols, type FileRecord, type RefKind, type SymbolKind } from "../../shared/schema";
import type { Model } from "../model/indices";
import { buildSymbolModel } from "../model/symbols";
import type { Filters } from "../state/store";
import { DIM, encodeEmphasis } from "./encode";
import { segmentHitsRect } from "./Labels";
import { columnPath } from "./Scrubber";
import { buildSymbolScene, describeRelation } from "./symbolScene";

// ─── A tiny code-intelligence table ──────────────────────────────────────────────────────────

interface Sym {
  name: string;
  kind: SymbolKind;
  file: number;
  parent?: number;
}
interface Ref {
  symbol: number;
  file: number;
  kind: RefKind;
  from: number;
}

function table(syms: Sym[], refs: Ref[]): CodeSymbols {
  const k = (r: RefKind) => REF_KINDS.indexOf(r);
  // The call table aggregates refs into (from, to, kind) rows, as the analyzer does.
  const rows = new Map<string, { from: number; to: number; kind: number; count: number }>();
  for (const r of refs) {
    const key = `${r.from}:${r.symbol}:${r.kind}`;
    const row = rows.get(key) ?? { from: r.from, to: r.symbol, kind: k(r.kind), count: 0 };
    row.count++;
    rows.set(key, row);
  }
  const calls = [...rows.values()];
  const files = Math.max(...syms.map((s) => s.file)) + 1;
  return {
    engine: { name: "typescript", version: "test" },
    projects: [],
    symbols: {
      name: syms.map((s) => s.name),
      kind: syms.map((s) => s.kind),
      file: syms.map((s) => s.file),
      line: syms.map((_, i) => i),
      col: syms.map(() => 0),
      endLine: syms.map((_, i) => i),
      parent: syms.map((s) => s.parent ?? -1),
      flags: syms.map(() => 0),
      signature: syms.map(() => ""),
      doc: syms.map(() => ""),
      complexity: syms.map(() => 1),
      params: syms.map(() => 0),
      refs: syms.map((_, i) => refs.filter((r) => r.symbol === i).length),
      callers: syms.map(() => 0),
      files: syms.map((_, i) => new Set(refs.filter((r) => r.symbol === i).map((r) => r.file)).size),
    },
    refs: {
      symbol: refs.map((r) => r.symbol),
      file: refs.map((r) => r.file),
      line: refs.map(() => 0),
      col: refs.map(() => 0),
      len: refs.map(() => 1),
      kind: refs.map((r) => k(r.kind)),
      from: refs.map((r) => r.from),
    },
    calls: { from: calls.map((c) => c.from), to: calls.map((c) => c.to), kind: calls.map((c) => c.kind), count: calls.map((c) => c.count) },
    fileRefStart: new Array<number>(files + 1).fill(0),
    moduleSymbol: new Array<number>(files).fill(-1),
    stats: { files, symbols: syms.length, references: refs.length, unresolved: 0, unusedExports: 0, truncated: 0, ms: 0 },
  };
}

// Files: 0 store.ts (definitions), 1 engine.ts (caller), 2 impl.ts, 3 types.ts, 4 app.ts (caller
// of the caller), 5 importer.ts (imports engine.ts and nothing else), 6 log.ts (a callee).
const S = {
  storeModule: 0,
  Svc: 1,
  run: 2, //       Svc.run
  load: 3, //      engine.ts: calls Svc.run
  Impl: 4, //      impl.ts: implements Svc
  implRun: 5, //   Impl.run: implements Svc.run
  App: 6, //       app.ts: calls load
  TypeUser: 7, //  types.ts: mentions Svc as a type
  importer: 8, //  importer.ts's module symbol: imports load
  write: 9, //     log.ts
  persist: 10, //  store.ts: a function that calls write and names Svc in its signature
};
const SYMBOLS = table(
  [
    { name: "store.ts", kind: "module", file: 0 },
    { name: "Svc", kind: "interface", file: 0 },
    { name: "run", kind: "method", file: 0, parent: 1 },
    { name: "load", kind: "function", file: 1 },
    { name: "Impl", kind: "class", file: 2 },
    { name: "run", kind: "method", file: 2, parent: 4 },
    { name: "App", kind: "component", file: 4 },
    { name: "TypeUser", kind: "function", file: 3 },
    { name: "importer.ts", kind: "module", file: 5 },
    { name: "write", kind: "function", file: 6 },
    { name: "persist", kind: "function", file: 0 },
  ],
  [
    { symbol: S.run, file: 1, kind: "call", from: S.load },
    { symbol: S.run, file: 1, kind: "call", from: S.load },
    { symbol: S.Svc, file: 1, kind: "import", from: S.load },
    { symbol: S.Svc, file: 2, kind: "implements", from: S.Impl },
    { symbol: S.run, file: 2, kind: "implements", from: S.implRun },
    { symbol: S.load, file: 4, kind: "call", from: S.App },
    { symbol: S.Svc, file: 3, kind: "type", from: S.TypeUser },
    { symbol: S.load, file: 3, kind: "type", from: S.TypeUser },
    { symbol: S.load, file: 5, kind: "import", from: S.importer },
    { symbol: S.write, file: 6, kind: "call", from: S.persist },
    { symbol: S.Svc, file: 0, kind: "type", from: S.persist },
  ],
);
const MODEL = { fileCount: 7 } as unknown as Model;
const SM = buildSymbolModel(SYMBOLS, MODEL);
const scene = (s: number) => buildSymbolScene(MODEL, SYMBOLS, SM, s);

describe("buildSymbolScene", () => {
  test("an implementer's file draws an implementation arc, not a generic other-use arc", () => {
    const sc = scene(S.run);
    const impl = sc.arcOf.get(2)!;
    expect(impl.implementation).toBe(true);
    expect(impl.impl).toBe(1);
    expect(sc.arcOf.get(1)!.implementation).toBe(false);
    expect(sc.arcOf.get(1)!.calls).toBe(2);
    expect(sc.totals.implementations).toBe(1);
  });

  test("the ripple follows calls only: importers and type mentions of a caller stay dark", () => {
    const sc = scene(S.run);
    // app.ts calls load, which calls Svc.run: two hops.
    expect(sc.ripple.get(4)).toEqual({ depth: 2, caller: S.App, via: S.load });
    // importer.ts only imports load; types.ts only names it as a type.
    expect(sc.ripple.has(5)).toBe(false);
    expect(sc.ripple.has(3)).toBe(false);
    expect(sc.totals.ripple).toBe(1);
    expect(sc.depth[0]).toBe(0);
    expect(sc.depth[1]).toBe(1);
    expect(sc.depth[4]).toBe(2);
    expect(sc.depth[5]).toBe(-1);
  });

  test("an interface has no ripple, and its uses split into implementations and others", () => {
    const sc = scene(S.Svc);
    expect(sc.typeLevel).toBe(true);
    expect(sc.ripple.size).toBe(0);
    expect(sc.arcOf.get(2)!.implementation).toBe(true);
    expect(sc.arcOf.get(3)!.implementation).toBe(false);
    expect(sc.arcOf.get(3)!.other).toBe(1);
    // The definition's own file references it (persist's signature) without drawing an arc.
    expect(sc.own.other).toBe(1);
    expect(sc.arcOf.has(0)).toBe(false);
  });

  test("callees come from call edges only, never from types named in a signature", () => {
    const sc = scene(S.persist);
    expect(sc.callees).toEqual([{ file: 6, count: 1 }]);
  });

  test("a tiny direct set frames its ripple too", () => {
    const sc = scene(S.run);
    expect(sc.frame).toContain(4);
  });

  test("relations say why a file is lit", () => {
    const sc = scene(S.run);
    expect(describeRelation(sc, SYMBOLS, 1)).toBe("2 calls of Svc.run · 1st heaviest of 2");
    expect(describeRelation(sc, SYMBOLS, 2)).toBe("Implements Svc.run · 2nd heaviest of 2");
    expect(describeRelation(sc, SYMBOLS, 4)).toBe("Ripple, 2 hops: App calls load");
    expect(describeRelation(sc, SYMBOLS, 0)).toBe("Defines Svc.run");
    expect(describeRelation(sc, SYMBOLS, 5)).toBeNull();
    expect(describeRelation(scene(S.persist), SYMBOLS, 6)).toBe("persist calls into this file: write");
  });
});

// ─── Emphasis ────────────────────────────────────────────────────────────────────────────────

describe("encodeEmphasis", () => {
  // Four files: 0-1 in directory 1 (lib), 2-3 in directory 2. Files 0 and 2 are JavaScript.
  const files = [
    { language: "javascript", category: "code" },
    { language: "typescript", category: "code" },
    { language: "javascript", category: "code" },
    { language: "typescript", category: "code" },
  ].map((f, id) => ({ ...f, id, generated: false, vendored: false })) as unknown as FileRecord[];
  const model = {
    fileCount: 4,
    report: { files },
    fileOrderIndex: Int32Array.from([0, 1, 2, 3]),
    dirStart: Int32Array.from([0, 0, 2]),
    dirEnd: Int32Array.from([4, 2, 4]),
    imports: { offsets: Int32Array.from([0, 1, 1, 1, 1]), targets: Int32Array.from([1]) },
    importedBy: { offsets: Int32Array.from([0, 0, 1, 1, 1]), targets: Int32Array.from([0]) },
    authorFiles: [[0, 1, 2, 3]],
  } as unknown as Model;
  const jsOnly: Filters = { languages: new Set(["javascript"]), categories: null, hideGenerated: false, hideVendored: true };
  const none: Filters = { languages: null, categories: null, hideGenerated: false, hideVendored: true };
  const run = (filters: Filters, extra: Partial<Parameters<typeof encodeEmphasis>[1]> = {}) => {
    const out = new Float32Array(4);
    encodeEmphasis(model, { focusDir: null, filters, selection: null, symbolLight: null, ...extra }, out);
    return [...out];
  };

  test("a selected directory never lifts files the filters exclude", () => {
    const e = run(jsOnly, { focusDir: 1, selection: { kind: "dir", id: 1 } });
    expect(e[0]).toBeGreaterThan(1); //   lib's JavaScript file: lit
    expect(e[1]).toBeLessThanOrEqual(DIM); // lib's TypeScript file: filtered out, stays dim
  });

  test("an author's files respect the filters too", () => {
    const e = run(jsOnly, { selection: { kind: "author", id: 0 } });
    expect(e[1]).toBeLessThanOrEqual(DIM);
    expect(e[3]).toBeLessThanOrEqual(DIM);
    expect(e[2]).toBeGreaterThan(1);
  });

  test("the selected file itself stays lit even when filtered out", () => {
    const e = run(jsOnly, { selection: { kind: "file", id: 1 } });
    expect(e[1]).toBeGreaterThan(1);
  });

  test("a previewed legend key dims everything outside it", () => {
    const e = run(none, { preview: (i) => i === 2 });
    expect(e[2]).toBe(1);
    expect(Math.max(e[0]!, e[1]!, e[3]!)).toBeLessThanOrEqual(DIM);
  });
});

// ─── Scrubber columns ────────────────────────────────────────────────────────────────────────

describe("columnPath", () => {
  const tops = (d: string) => [...d.matchAll(/V([\d.]+)Q/g)].map((m) => Number(m[1]));
  test("is linear in commits, like the activity tray", () => {
    // 81 and 39 commits in a 100px-tall strip: the columns' tops sit 81 and 39 px up (less the
    // 2px corner radius the path starts its curve at).
    const d = columnPath([81, 39], 0, 2, 200, 100);
    const [a, b] = tops(d);
    expect(100 - a! + 2).toBeCloseTo(100, 0);
    expect(100 - b! + 2).toBeCloseTo((39 / 81) * 100, 0);
  });

  test("draws nothing for a week without commits", () => {
    expect(columnPath([5, 0, 5], 0, 3, 300, 40).match(/M/g)!.length).toBe(2);
  });

  test("caps a column at 24px however wide its week is", () => {
    const d = columnPath([3, 3], 0, 2, 1000, 40);
    const xs = [...d.matchAll(/H([\d.]+)Q([\d.]+)/g)].map((m) => Number(m[2]));
    const starts = [...d.matchAll(/M([\d.]+) /g)].map((m) => Number(m[1]));
    expect(xs[0]! - starts[0]!).toBeCloseTo(24, 5);
  });
});

// ─── Label geometry ──────────────────────────────────────────────────────────────────────────

describe("segmentHitsRect", () => {
  const r = { x: 10, y: 10, w: 20, h: 10 };
  test("a segment through the rectangle hits it", () => expect(segmentHitsRect(0, 15, 40, 15, r)).toBe(true));
  test("a segment ending inside hits it", () => expect(segmentHitsRect(0, 0, 15, 15, r)).toBe(true));
  test("a segment passing beside it misses", () => expect(segmentHitsRect(0, 0, 40, 5, r)).toBe(false));
  test("a diagonal clearing the corner misses", () => expect(segmentHitsRect(0, 8, 8, 0, r)).toBe(false));
});
