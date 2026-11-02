/**
 * The galaxy's pure logic (src/viewer/galaxy): what a selected symbol lights and why, how the
 * plate dims under filters, where the scrubber's columns go, and the label overlay's geometry.
 *
 * The symbol cases run on a hand-built code-intelligence table small enough to read: one
 * interface with a method, an implementing class, a direct caller, a caller of that caller, a
 * file that only mentions the types, a test file that only imports the caller, and a Vue file
 * whose script imports the caller where the checker cannot see it.
 *
 *   bun test src/viewer/galaxy
 */

import { describe, expect, test } from "bun:test";
import { REF_KINDS, type CodeSymbols, type FileRecord, type RefKind, type SymbolKind } from "../../shared/schema";
import type { Model } from "../model/indices";
import { buildSymbolModel } from "../model/symbols";
import type { Filters } from "../state/store";
import { DIM, encodeEmphasis } from "./encode";
import { flashScale } from "./engine";
import { regionCost, segmentHitsRect } from "./Labels";
import { touchedBySpecimens } from "./RegionLabels";
import { columnPath } from "./Scrubber";
import { buildSymbolScene, describeRelation, reachPhrase } from "./symbolScene";

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

function table(syms: Sym[], refs: Ref[], hostUses?: CodeSymbols["hostUses"]): CodeSymbols {
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
  const files = Math.max(...syms.map((s) => s.file), ...(hostUses?.file ?? [])) + 1;
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
    ...(hostUses ? { hostUses } : {}),
    stats: { files, symbols: syms.length, references: refs.length, unresolved: 0, unusedExports: 0, truncated: 0, ms: 0 },
  };
}

// Files: 0 store.ts (definitions), 1 engine.ts (caller), 2 impl.ts, 3 types.ts, 4 app.ts (caller
// of the caller), 5 importer.test.ts (a test that imports engine.ts and nothing else), 6 log.ts
// (a callee), 7 Widget.vue (imports load from its script block: a host use, not a reference).
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
  { symbol: [S.load], file: [7], line: [2] },
);
const CATEGORIES = ["code", "code", "code", "code", "code", "test", "code", "markup"];
const MODEL = { fileCount: 8, report: { files: CATEGORIES.map((category, id) => ({ id, category })) } } as unknown as Model;
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

  test("an implementation reached only through its interface draws dispatch arcs from the interface's callers", () => {
    // Impl.run has no references of its own: engine.ts calls Svc.run, which the checker
    // resolves to the interface member.
    const sc = scene(S.implRun);
    expect(sc.arcs).toEqual([]);
    expect(sc.dispatch).toEqual([{ file: 1, base: S.run, callers: [S.load], count: 2, test: false }]);
    expect(sc.through).toBe("interface");
    expect(sc.totals.dispatch).toBe(1);
    expect(reachPhrase(sc.totals)).toBe("1 file");
    expect(sc.light[1]).toBeGreaterThan(DIM);
    expect(sc.depth[1]).toBe(1);
    expect(sc.frame).toContain(1);
    expect(describeRelation(sc, SYMBOLS, 1)).toBe("Through the interface: load calls Svc.run");
  });

  test("a symbol with direct uses draws no dispatch arcs from files that already use it", () => {
    // Svc.run's own callers are its direct users; it implements nothing, so nothing dispatches.
    expect(scene(S.run).dispatch).toEqual([]);
    expect(scene(S.run).through).toBeNull();
  });

  test("host imports light their files and draw arcs, without counting as checker references", () => {
    const sc = scene(S.load);
    const vue = sc.arcOf.get(7)!;
    expect(vue.host).toBe(1);
    expect(vue.calls + vue.other + vue.impl).toBe(0);
    expect(sc.totals.host).toBe(1);
    // The legend's row counts (calls, other) stay the checker's.
    expect(sc.totals.other).toBe(2);
    expect(sc.light[7]).toBeGreaterThan(1);
    expect(describeRelation(sc, SYMBOLS, 7)).toBe("Imports load from a script the checker does not read · 3rd heaviest of 3");
  });

  test("test files are counted apart, ranked after production, and lit fainter", () => {
    const sc = scene(S.load);
    // app.ts, types.ts and Widget.vue are production; importer.test.ts is a test.
    expect(sc.totals.files).toBe(4);
    expect(sc.totals.tests).toBe(1);
    expect(reachPhrase(sc.totals)).toBe("3 files + 1 test");
    expect(sc.arcs.map((a) => a.file)).toEqual([3, 4, 7, 5]);
    expect(sc.arcOf.get(5)!.test).toBe(true);
    expect(sc.light[5]).toBeLessThan(sc.light[3]!);
    expect(sc.light[5]).toBeGreaterThan(DIM);
    expect(describeRelation(sc, SYMBOLS, 5)).toBe("1 import of load · 1st heaviest of 1 in tests");
  });

  test("reach reads tests alone when nothing else uses it", () => {
    const t = { files: 2, tests: 2, calls: 0, other: 0, host: 0, implementations: 0, dispatch: 0, dispatchTests: 0, ripple: 0 };
    expect(reachPhrase(t)).toBe("2 test files");
    expect(reachPhrase({ ...t, tests: 0 })).toBe("2 files");
    expect(reachPhrase({ ...t, files: 0, tests: 0 })).toBe("0 files");
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

describe("region names as label obstacles", () => {
  const name = { x: 100, y: 100, w: 60, h: 16 };
  const card = { x: 0, y: 0, w: 40, h: 20 };
  test("a leader running through a name costs more than the densest star field or lane bundle", () => {
    // Star at (90, 108), label far to the right: the leader crosses the name's box.
    const cost = regionCost([name], { x: 200, y: 100, w: 40, h: 20 }, 90, 108, 200, 108);
    expect(cost).toBeGreaterThan(24);
  });
  test("a label and leader clear of every name cost nothing", () => {
    expect(regionCost([name], card, 20, 40, 20, 20)).toBe(0);
  });
  test("the open drawer's name costs more than any other", () => {
    const r = { x: 110, y: 104, w: 40, h: 20 };
    expect(regionCost([{ ...name, pinned: true }], r, 0, 0, 110, 104)).toBeGreaterThan(regionCost([name], r, 0, 0, 110, 104));
  });
  test("a name is touched by a card over it or a leader through it, not by one beside it", () => {
    expect(touchedBySpecimens(name, [{ x: 120, y: 90, w: 40, h: 20 }], [])).toBe(true);
    expect(touchedBySpecimens(name, [], [130, 60, 130, 140])).toBe(true);
    // A leader starting on a star under the name counts: the name sits on the pinned star.
    expect(touchedBySpecimens(name, [], [130, 108, 300, 300])).toBe(true);
    expect(touchedBySpecimens(name, [{ x: 200, y: 100, w: 40, h: 20 }], [180, 60, 180, 140])).toBe(false);
  });
});

// ─── History flash ───────────────────────────────────────────────────────────────────────────

describe("flashScale", () => {
  test("leaves a quiet week's flash at full strength", () => expect(flashScale(40)).toBe(1));
  test("scales a busy week down by the square root of how far it is over budget", () => {
    expect(flashScale(800)).toBeCloseTo(0.5, 5);
  });
  test("never scales a flash away entirely", () => expect(flashScale(1_000_000)).toBe(0.4));
});
