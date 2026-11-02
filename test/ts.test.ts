/**
 * src/core/ts: code intelligence through the TypeScript 7 compiler API.
 *
 * Most assertions run against test/fixtures/ts, a small strict project that exercises each
 * construct the module has a rule for. Reference lists are asserted exactly, position by
 * position: a missing or extra reference is the bug this module most needs to not have.
 *
 * Positions in expectations are 0-based `line:col`, as the report stores them.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REF_KINDS, SymbolFlag, type CodeSymbols } from "../src/shared/schema";
import type { TsInput } from "../src/core/contracts";
import { analyzeTypeScript } from "../src/core/ts";
import { limits } from "../src/core/ts/projects";
import { REF, RefStore, SymbolStore } from "../src/core/ts/store";
import { buildTables } from "../src/core/ts/tables";

const FIXTURE = join(import.meta.dir, "fixtures/ts");

const LANG: Record<string, string> = { ts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", json: "json" };

function inputFor(root: string, paths: string[], extra: Partial<TsInput> = {}): TsInput {
  return {
    root,
    paths,
    languages: paths.map((p) => LANG[p.split(".").pop()!] ?? "text"),
    isTest: paths.map((p) => /\.testcase\./.test(p)),
    configs: paths.filter((p) => /(^|\/)tsconfig\.json$/.test(p)),
    maxFiles: 1000,
    maxRefs: 1_000_000,
    ...extra,
  };
}

const fixturePaths = [...new Bun.Glob("**/*").scanSync({ cwd: FIXTURE })].sort();

let r: CodeSymbols;
const progress: string[] = [];

beforeAll(async () => {
  const out = await analyzeTypeScript(inputFor(FIXTURE, fixturePaths, { onProgress: (m) => progress.push(m) }));
  if (!out) throw new Error(`analysis returned null: ${progress.join("\n")}`);
  r = out;
}, 60_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

const fileId = (path: string) => fixturePaths.indexOf(path);

/** The one symbol with this name (and kind / file, when the name is ambiguous). */
function sym(name: string, opts: { kind?: string; file?: string } = {}): number {
  const S = r.symbols;
  const hits: number[] = [];
  for (let i = 0; i < S.name.length; i++) {
    if (S.name[i] !== name) continue;
    if (opts.kind && S.kind[i] !== opts.kind) continue;
    if (opts.file && S.file[i] !== fileId(opts.file)) continue;
    hits.push(i);
  }
  if (hits.length !== 1) throw new Error(`${hits.length} symbols match ${name} ${JSON.stringify(opts)}`);
  return hits[0]!;
}

/** Every reference to a symbol as "file line:col kind ← caller", in table order. */
function refsTo(s: number): string[] {
  const R = r.refs;
  const out: string[] = [];
  for (let i = 0; i < R.symbol.length; i++) {
    if (R.symbol[i] !== s) continue;
    out.push(`${fixturePaths[R.file[i]!]} ${R.line[i]}:${R.col[i]} ${REF_KINDS[R.kind[i]!]} ← ${r.symbols.name[R.from[i]!]}`);
  }
  return out;
}

/** A member of a class / interface / namespace, by its parent's name. */
function member(parent: string, name: string, kind?: string): number {
  const p = sym(parent);
  const i = r.symbols.name.findIndex((n, j) => n === name && r.symbols.parent[j] === p && (!kind || r.symbols.kind[j] === kind));
  if (i < 0) throw new Error(`no member ${parent}.${name}`);
  return i;
}

const has = (s: number, flag: number) => (r.symbols.flags[s]! & flag) !== 0;

// ─── Projects and totals ─────────────────────────────────────────────────────────────────────

describe("projects", () => {
  test("one configured project owns every TS/JS file", () => {
    const tsFiles = fixturePaths.filter((p) => /\.(ts|tsx|js)$/.test(p));
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]!.config).toBe("tsconfig.json");
    expect(r.projects[0]!.files).toBe(tsFiles.length);
    expect(r.stats.files).toBe(tsFiles.length);
    for (const p of tsFiles) expect(r.moduleSymbol[fileId(p)]).toBeGreaterThanOrEqual(0);
    expect(r.moduleSymbol[fileId("tsconfig.json")]).toBe(-1);
  });

  test("engine is the installed typescript", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../node_modules/typescript/package.json"), "utf8"));
    expect(r.engine).toEqual({ name: "typescript", version: pkg.version });
  });

  test("unresolved counts only names the checker could not bind (one deliberate one in app.ts)", () => {
    expect(r.stats.unresolved).toBe(1);
    expect(r.stats.truncated).toBe(0);
    expect(r.stats.references).toBe(r.refs.symbol.length);
    expect(r.stats.symbols).toBe(r.symbols.name.length);
  });
});

// ─── Symbols ─────────────────────────────────────────────────────────────────────────────────

describe("symbols", () => {
  test("module symbols, one per file, at line 0", () => {
    const m = sym("math.ts", { kind: "module" });
    expect(r.moduleSymbol[fileId("src/math.ts")]).toBe(m);
    expect([r.symbols.line[m], r.symbols.col[m], r.symbols.parent[m]]).toEqual([0, 0, -1]);
  });

  test("functions: position, extent, doc, params, signature", () => {
    const add = sym("add");
    const S = r.symbols;
    expect([S.kind[add], S.file[add], S.line[add], S.col[add], S.endLine[add]]).toEqual(["function", fileId("src/math.ts"), 1, 16, 3]);
    expect(S.doc[add]).toBe("Adds two numbers.");
    expect(S.params[add]).toBe(2);
    expect(S.signature[add]).toBe("(a: number, b: number) => number");
    expect(S.complexity[add]).toBe(1);
    expect(has(add, SymbolFlag.exported)).toBe(true);
  });

  test("arrow consts are functions named by their variable", () => {
    const d = sym("double");
    expect(r.symbols.kind[d]).toBe("function");
    expect(r.symbols.signature[d]).toBe("(n: number) => number");
  });

  test("overloads are one symbol spanning every signature and the implementation", () => {
    const f = sym("format");
    expect(r.symbols.line[f]).toBe(12);
    expect(r.symbols.endLine[f]).toBe(19);
    expect(r.symbols.signature[f]).toBe("{ (value: string): string; (value: number): string; }");
    // 1 + if + && + ||
    expect(r.symbols.complexity[f]).toBe(4);
  });

  test("flags from modifiers and JSDoc", () => {
    expect(has(sym("legacyAdd"), SymbolFlag.deprecated)).toBe(true);
    const cd = sym("countdown");
    expect(has(cd, SymbolFlag.async) && has(cd, SymbolFlag.generator)).toBe(true);
    const total = sym("sum");
    expect(has(total, SymbolFlag.defaultExport) && has(total, SymbolFlag.exported)).toBe(true);
    expect(has(sym("Shape"), SymbolFlag.abstract)).toBe(true);
    expect(has(member("Shape", "area"), SymbolFlag.abstract)).toBe(true);
    expect(has(member("Circle", "area"), SymbolFlag.abstract)).toBe(false);
    expect(has(member("Circle", "unit"), SymbolFlag.static)).toBe(true);
    expect(has(sym("count"), SymbolFlag.static)).toBe(true);
    expect(has(sym("id", { file: "src/shapes.ts" }), SymbolFlag.protected)).toBe(true);
    expect(has(sym("#secret"), SymbolFlag.private)).toBe(true);
    expect(has(sym("hidden"), SymbolFlag.private)).toBe(true);
    expect(has(sym("checkAdd"), SymbolFlag.test)).toBe(true);
    expect(has(sym("BUILD_ID"), SymbolFlag.ambient)).toBe(true);
    expect(has(sym("JSX"), SymbolFlag.ambient)).toBe(true);
  });

  test("class members: methods, accessors, statics, private names, parameter properties", () => {
    const shape = sym("Shape");
    const members = r.symbols.name
      .map((n, i) => [n, r.symbols.kind[i], r.symbols.parent[i]] as const)
      .filter(([, , p]) => p === shape)
      .map(([n, k]) => `${k} ${n}`);
    expect(members).toEqual([
      "property count",
      "property id",
      "property #secret",
      "constructor constructor",
      "method area",
      "getter label",
      "setter label",
      "method #reveal",
      "method hidden",
    ]);
    const radius = sym("radius");
    expect([r.symbols.kind[radius], r.symbols.parent[radius]]).toEqual(["property", sym("Circle")]);
    expect(has(radius, SymbolFlag.private)).toBe(true);
    expect(r.symbols.signature[sym("Circle")]).toBe("class Circle extends Shape");
    const ctor = member("Circle", "constructor");
    expect([r.symbols.kind[ctor], r.symbols.line[ctor], r.symbols.col[ctor], r.symbols.params[ctor]]).toEqual(["constructor", 33, 2, 1]);
    expect(r.symbols.signature[ctor]).toBe("constructor(private radius: number)");
  });

  test("interfaces, type aliases, enums, namespaces", () => {
    const S = r.symbols;
    expect(S.kind[sym("HasArea")]).toBe("interface");
    expect(S.kind[member("HasArea", "area")]).toBe("method");
    expect(S.kind[member("HasArea", "label")]).toBe("property");
    expect(S.kind[sym("ShapeList")]).toBe("type");
    expect(S.signature[sym("ShapeList")]).toBe("type ShapeList = readonly Shape[];");
    const color = sym("Color");
    expect(S.kind[color]).toBe("enum");
    expect([S.kind[sym("Red")], S.parent[sym("Red")]]).toEqual(["property", color]);
    const geo = sym("Geometry");
    expect(S.kind[geo]).toBe("namespace");
    expect(S.parent[sym("origin")]).toBe(geo);
    expect(S.parent[sym("Point")]).toBe(geo);
  });

  test("React conventions: components and hooks", () => {
    expect(r.symbols.kind[sym("useCounter")]).toBe("hook");
    expect(r.symbols.kind[sym("Button")]).toBe("component");
    expect(r.symbols.kind[sym("Toolbar")]).toBe("component");
    expect(r.symbols.signature[sym("Button")]).toBe("(props: ButtonProps) => JSX.Element");
  });

  test("used as a JSX tag makes a component, even rendering nothing or loaded lazily", () => {
    expect(r.symbols.kind[sym("Quiet")]).toBe("component"); // `return null`
    expect(r.symbols.kind[sym("Later")]).toBe("component"); // `lazy(() => …)`
    expect(r.symbols.complexity[sym("Later")]).toBe(1);
    expect(r.symbols.kind[sym("lazy")]).toBe("function");
  });

  test("`const useX = call()` is a hook only when the call returns something callable", () => {
    const defaults = sym("useDefaults");
    expect([r.symbols.kind[defaults], r.symbols.complexity[defaults]]).toEqual(["variable", 0]);
    expect(r.symbols.kind[sym("useStore")]).toBe("hook");
  });

  test("JavaScript with JSDoc gets doc and checker-inferred signature", () => {
    const t = sym("times");
    expect(r.symbols.doc[t]).toBe("Multiplies by repeated addition.");
    expect(r.symbols.signature[t]).toBe("(a: number, b: number) => number");
    expect(r.symbols.complexity[t]).toBe(2);
  });

  test("locals and parameters are not symbols", () => {
    for (const local of ["c", "list", "value", "acc", "xs", "props", "out"]) {
      expect(r.symbols.name.includes(local)).toBe(false);
    }
  });
});

// ─── References ──────────────────────────────────────────────────────────────────────────────

describe("references", () => {
  test("a function: imports, calls from every file, the JS file included", () => {
    expect(refsTo(sym("add"))).toEqual([
      "src/legacy.js 1:9 import ← legacy.js",
      "src/legacy.js 11:36 call ← times",
      "src/math.testcase.ts 0:9 import ← math.testcase.ts",
      "src/math.testcase.ts 4:9 call ← checkAdd",
      "src/math.ts 5:45 call ← double",
      "src/math.ts 9:9 call ← legacyAdd",
      "src/math.ts 44:31 call ← sum",
    ]);
  });

  test("renamed re-exports and default exports resolve to the original declaration", () => {
    // `export { default as total } from "./math"`, imported through the barrel as `total`.
    expect(refsTo(sym("sum"))).toEqual([
      "src/app.ts 1:16 import ← app.ts",
      "src/app.ts 12:12 call ← main",
      "src/index.ts 2:9 export ← index.ts",
    ]);
    // `export { Circle as Round }`, used as `Round`.
    expect(refsTo(sym("Circle"))).toEqual([
      "src/app.ts 1:9 import ← app.ts",
      "src/app.ts 10:16 new ← main",
      "src/app.ts 11:30 read ← main",
      "src/index.ts 1:9 export ← index.ts",
      "src/shapes.ts 41:17 type ← unit",
      "src/shapes.ts 42:15 new ← unit",
    ]);
  });

  test("a namespace import references the module; its members resolve through it", () => {
    expect(refsTo(sym("math.ts", { kind: "module" }))).toEqual([
      "src/app.ts 0:12 import ← app.ts",
      "src/app.ts 6:30 read ← describe",
      "src/app.ts 13:16 read ← main",
      "src/app.ts 15:50 read ← main",
    ]);
    expect(refsTo(sym("format"))).toEqual(["src/app.ts 6:32 call ← describe"]);
    expect(refsTo(sym("Green"))).toEqual(["src/app.ts 13:24 read ← main"]);
  });

  test("type-only imports, type positions, heritage clauses", () => {
    expect(refsTo(sym("HasArea"))).toEqual([
      "src/app.ts 2:14 import ← app.ts",
      "src/app.ts 5:32 type ← describe",
      "src/shapes.ts 5:39 implements ← Shape",
    ]);
    expect(refsTo(sym("Shape"))).toEqual([
      "src/index.ts 1:26 export ← index.ts",
      "src/shapes.ts 11:4 read ← constructor",
      "src/shapes.ts 12:14 read ← constructor",
      "src/shapes.ts 32:28 extends ← Circle",
      "src/shapes.ts 46:33 type ← ShapeList",
    ]);
  });

  test("method calls through an interface, statics, private names", () => {
    // `shape.area()` on a HasArea: the interface method, not either class's implementation.
    // Shape's abstract `area` implements it, and is linked to it from its own name.
    expect(refsTo(member("HasArea", "area"))).toEqual(["src/app.ts 6:45 call ← describe", "src/shapes.ts 15:11 implements ← area"]);
    expect(refsTo(member("Circle", "area"))).toEqual([]);
    // Circle's `area` overrides the nearest declaration up its chain, Shape's, not the interface.
    expect(refsTo(member("Shape", "area"))).toEqual(["src/shapes.ts 37:2 extends ← area"]);
    expect(refsTo(sym("unit"))).toEqual(["src/app.ts 11:36 call ← main"]);
    expect(refsTo(sym("#reveal"))).toEqual(["src/shapes.ts 18:36 call ← label"]);
    expect(refsTo(sym("#secret"))).toEqual(["src/shapes.ts 26:16 read ← #reveal"]);
    expect(refsTo(sym("radius"))).toEqual(["src/shapes.ts 38:26 read ← area"]);
  });

  test("a get/set pair: writes go to the setter, reads through the interface to its property", () => {
    expect(refsTo(sym("label", { kind: "setter" }))).toEqual(["src/app.ts 14:4 write ← main"]);
    expect(refsTo(sym("label", { kind: "getter" }))).toEqual([]);
    expect(refsTo(member("HasArea", "label"))).toEqual([
      "src/app.ts 6:15 read ← describe",
      "src/shapes.ts 17:6 implements ← label",
      "src/shapes.ts 21:6 implements ← label",
    ]);
  });

  test("a member access on a union credits every member that declares it", () => {
    // `p: Alpha | Beta`: `p.dispose()` calls whichever one p holds.
    for (const cls of ["Alpha", "Beta"]) {
      expect(refsTo(member(cls, "dispose"))).toEqual(["src/client.ts 4:4 call ← exercise"]);
      expect(refsTo(member(cls, "warm"))).toEqual(["src/client.ts 5:4 call ← exercise"]);
    }
    // `m: MsgA | MsgB` reads `job` of both.
    expect(refsTo(member("MsgA", "job"))).toEqual(["src/client.ts 6:10 read ← exercise"]);
    expect(refsTo(member("MsgB", "job"))).toEqual([
      "src/client.ts 6:10 read ← exercise",
      "src/client.ts 9:33 write ← exercise",
      "src/client.ts 16:14 read ← exercise",
    ]);
  });

  test("an object literal in a union context writes only the members it is", () => {
    // `{ kind: "b", job: 2 }` where a Msg is expected is a MsgB.
    expect(refsTo(member("MsgB", "kind"))).toEqual(["src/client.ts 9:22 write ← exercise"]);
    expect(refsTo(member("MsgA", "kind"))).toEqual([]);
  });

  test("a type and a value under one name: values go to the value, imports to both", () => {
    const type = sym("Mode", { kind: "type" });
    const value = sym("Mode", { kind: "variable" });
    expect(refsTo(value)).toEqual([
      "src/client.ts 0:17 import ← client.ts",
      "src/client.ts 10:21 read ← exercise",
      // `typeof Mode` is a type position naming the value.
      "src/client.ts 11:22 type ← exercise",
      "src/client.ts 11:29 read ← exercise",
    ]);
    expect(refsTo(type)).toEqual([
      "src/client.ts 0:17 import ← client.ts",
      "src/client.ts 10:14 type ← exercise",
      "src/members.ts 34:32 type ← Mode",
      "src/members.ts 34:48 type ← Mode",
      "src/members.ts 40:49 type ← Worker",
    ]);
    expect(has(value, SymbolFlag.unusedExport)).toBe(false);
    expect(has(type, SymbolFlag.unusedExport)).toBe(false);
  });

  test("an implementation and an override reference the member they implement", () => {
    const runner = member("Runner", "run");
    const worker = member("Worker", "run");
    const night = member("Night", "run");
    expect(refsTo(runner)).toEqual([
      "src/client.ts 6:4 call ← exercise",
      "src/members.ts 40:33 type ← Worker",
      "src/members.ts 44:2 implements ← run",
    ]);
    expect(refsTo(worker)).toEqual(["src/client.ts 7:16 call ← exercise", "src/members.ts 54:11 extends ← run", "src/members.ts 55:10 call ← run"]);
    // The links are call-table edges, implementation → the member callers name.
    const edge = (from: number, to: number, kind: string) =>
      r.calls.from.some((f, i) => f === from && r.calls.to[i] === to && REF_KINDS[r.calls.kind[i]!] === kind);
    expect(edge(worker, runner, "implements")).toBe(true);
    expect(edge(night, worker, "extends")).toBe(true);
  });

  test("constructors: `new` credits the class and its constructor, `super()` the base constructor", () => {
    expect(refsTo(member("Circle", "constructor"))).toEqual(["src/app.ts 10:16 new ← main", "src/shapes.ts 42:15 new ← unit"]);
    expect(refsTo(member("Shape", "constructor"))).toEqual(["src/shapes.ts 34:4 call ← constructor"]);
    expect(refsTo(member("Worker", "constructor"))).toEqual([
      "src/client.ts 7:6 new ← exercise",
      "src/client.ts 12:34 new ← exercise",
      "src/members.ts 51:4 call ← constructor",
    ]);
    expect(refsTo(member("Night", "constructor"))).toEqual(["src/client.ts 8:6 new ← exercise"]);
    // The class keeps its own `new` references.
    expect(refsTo(sym("Night"))).toEqual(["src/client.ts 0:23 import ← client.ts", "src/client.ts 8:6 new ← exercise"]);
  });

  test("string literals naming members: `T[\"p\"]` types and `o[\"p\"]` element access", () => {
    expect(refsTo(member("Box", "width"))).toEqual(["src/client.ts 12:20 type ← exercise"]);
    expect(refsTo(sym("id", { file: "src/members.ts" }))).toEqual(["src/client.ts 12:45 read ← exercise"]);
  });

  test("a call through `as`, `satisfies` or `<T>` is still a call", () => {
    expect(refsTo(sym("helper"))).toEqual([
      "src/client.ts 0:9 import ← client.ts",
      "src/client.ts 13:3 call ← exercise",
      "src/client.ts 14:3 call ← exercise",
      "src/client.ts 15:26 call ← exercise",
    ]);
  });

  test("JSDoc `{@link X}`, `{@link X.y}` and `@see X` reference their targets", () => {
    expect(refsTo(sym("Runner"))).toContain("src/members.ts 40:26 type ← Worker");
    expect(refsTo(sym("pick"))).toEqual(["src/client.ts 0:30 import ← client.ts", "src/client.ts 3:12 call ← exercise", "src/members.ts 40:61 type ← Worker"]);
  });

  test("writes: assignment and increment", () => {
    expect(refsTo(sym("counter"))).toEqual([
      "src/math.ts 38:2 write ← bump",
      "src/math.ts 39:2 write ← bump",
      "src/math.ts 39:12 read ← bump",
      "src/math.ts 40:9 read ← bump",
    ]);
    expect(refsTo(sym("count"))).toEqual(["src/shapes.ts 11:10 write ← constructor", "src/shapes.ts 12:20 read ← constructor"]);
  });

  test("JSX: tags (opening only), attributes and destructured props reach the props interface", () => {
    expect(refsTo(sym("Button"))).toEqual(["src/ui.tsx 30:7 jsx ← Toolbar", "src/ui.tsx 31:7 jsx ← Toolbar"]);
    const label = sym("label", { file: "src/ui.tsx" });
    expect(refsTo(label)).toEqual([
      "src/ui.tsx 23:48 read ← Button",
      "src/ui.tsx 30:14 write ← Toolbar",
      "src/ui.tsx 31:14 write ← Toolbar",
      "src/ui.tsx 36:24 read ← Badge",
    ]);
    expect(refsTo(sym("useCounter"))).toEqual(["src/ui.tsx 27:23 call ← Toolbar"]);
  });

  test("contextually typed object literals write the interface's properties", () => {
    expect(refsTo(sym("x", { file: "src/geometry.ts" }))).toEqual(["src/app.ts 16:35 write ← main", "src/geometry.ts 7:13 write ← origin"]);
    expect(refsTo(sym("Point"))).toEqual(["src/app.ts 16:25 type ← main", "src/geometry.ts 6:28 type ← origin"]);
  });

  test("an ambient global declared in a .d.ts", () => {
    expect(refsTo(sym("BUILD_ID"))).toEqual(["src/app.ts 16:44 read ← main"]);
  });

  test("top-level statements are made by the module symbol", () => {
    expect(refsTo(sym("main"))).toEqual(["src/app.ts 20:0 call ← app.ts"]);
  });

  test("every reference slices to its identifier, including after astral characters", () => {
    const text = new Map<number, string[]>();
    for (let i = 0; i < r.refs.symbol.length; i++) {
      const f = r.refs.file[i]!;
      if (!text.has(f)) text.set(f, readFileSync(join(FIXTURE, fixturePaths[f]!), "utf8").split("\n"));
      const line = text.get(f)![r.refs.line[i]!]!;
      const slice = line.slice(r.refs.col[i]!, r.refs.col[i]! + r.refs.len[i]!);
      expect(slice).toMatch(/^#?[A-Za-z_$][\w$]*$/);
    }
    // `Geometry.origin()` sits after "é😀" on its line: UTF-16 columns, not bytes or code points.
    const origin = refsTo(sym("origin"));
    expect(origin).toEqual(["src/app.ts 15:86 call ← main"]);
  });

  test("references are grouped by file and sorted by position; fileRefStart slices them", () => {
    const R = r.refs;
    expect(r.fileRefStart).toHaveLength(fixturePaths.length + 1);
    expect(r.fileRefStart[fixturePaths.length]).toBe(R.symbol.length);
    for (let f = 0; f < fixturePaths.length; f++) {
      for (let i = r.fileRefStart[f]!; i < r.fileRefStart[f + 1]!; i++) {
        expect(R.file[i]).toBe(f);
        if (i > r.fileRefStart[f]!) {
          const before = R.line[i - 1]! < R.line[i]! || (R.line[i - 1] === R.line[i] && R.col[i - 1]! <= R.col[i]!);
          expect(before).toBe(true);
        }
      }
    }
  });
});

// ─── Aggregates ──────────────────────────────────────────────────────────────────────────────

describe("aggregates", () => {
  test("totals per symbol", () => {
    const add = sym("add");
    expect(r.symbols.refs[add]).toBe(7);
    expect(r.symbols.files[add]).toBe(3);
    // times, checkAdd, double, legacyAdd, sum; the importing modules are not callers.
    expect(r.symbols.callers[add]).toBe(5);
  });

  test("callers leave out the type hierarchy, so they agree with the record's incoming edges", () => {
    // Night extends Worker and Worker.run implements Runner.run: both rows are in the call table
    // (the record's type hierarchy reads them), but neither is a use.
    const R = REF_KINDS.indexOf("extends");
    const night = sym("Night");
    const worker = sym("Worker");
    expect(r.calls.from.some((f, i) => f === night && r.calls.to[i] === worker && r.calls.kind[i] === R)).toBe(true);
    expect(r.symbols.callers[worker]).toBe(1); // exercise()
    // exercise() calls it, and Worker's JSDoc links to it ({@link Runner.run}); the implementing
    // Worker.run is not a third caller.
    expect(r.symbols.callers[member("Runner", "run")]).toBe(2);

    // And for every symbol: callers is the distinct peers the hierarchy lists as incoming.
    const notUse = new Set(["import", "export", "extends", "implements"].map((k) => REF_KINDS.indexOf(k as (typeof REF_KINDS)[number])));
    const incoming = r.symbols.name.map(() => new Set<number>());
    for (let i = 0; i < r.calls.from.length; i++) {
      const from = r.calls.from[i]!;
      const to = r.calls.to[i]!;
      if (!notUse.has(r.calls.kind[i]!) && from !== to) incoming[to]!.add(from);
    }
    expect(r.symbols.callers).toEqual(incoming.map((s) => s.size));
  });

  test("a recursive function is not its own caller (buildTables)", () => {
    // vite's flatten calls itself and is called from one place: "Callers 2" over one incoming row.
    const store = new SymbolStore();
    const base = { file: 0, line: 0, col: 0, endLine: 0, parent: -1, flags: 0, signature: "", doc: "", params: 0 };
    const mod = store.add({ ...base, name: "a.ts", kind: "module" });
    const flatten = store.add({ ...base, name: "flatten", kind: "function", line: 1 });
    const main = store.add({ ...base, name: "main", kind: "function", line: 5 });
    const refs = new RefStore();
    refs.push(flatten, 0, 30, 2, 4, 7, REF.call, flatten); // the recursive call
    refs.push(flatten, 0, 60, 6, 4, 7, REF.call, main);
    refs.push(main, 0, 90, 8, 0, 4, REF.call, mod);
    const t = buildTables(store, refs, 1, [{ fileId: 0, moduleSymbol: mod, scopes: new Map(), aliases: new Map(), names: new Set(), exportNodes: [] }], Infinity);
    expect(t.symbols.callers[flatten]).toBe(1);
    expect(t.symbols.refs[flatten]).toBe(2); // the self-call is still a reference
    expect(t.calls.from.some((f, i) => f === flatten && t.calls.to[i] === flatten)).toBe(true);
  });

  test("call table rows aggregate by (from, to, kind)", () => {
    const rows = new Map<string, number>();
    for (let i = 0; i < r.calls.from.length; i++) {
      rows.set(`${r.symbols.name[r.calls.from[i]!]}->${r.symbols.name[r.calls.to[i]!]}:${REF_KINDS[r.calls.kind[i]!]}`, r.calls.count[i]!);
    }
    expect(rows.get("main->describe:call")).toBe(1);
    expect(rows.get("bump->counter:write")).toBe(2);
    expect(rows.get("bump->counter:read")).toBe(2);
    expect(rows.get("Toolbar->Button:jsx")).toBe(2);
    expect(rows.get("Circle->Shape:extends")).toBe(1);
    expect(rows.get("app.ts->main:call")).toBe(1);
    let total = 0;
    for (const c of r.calls.count) total += c;
    expect(total).toBe(r.refs.symbol.length);
  });

  test("unused exports: exported, and nothing outside its file uses it (re-exports do not count)", () => {
    const unused = r.symbols.name.filter((_, i) => has(i, SymbolFlag.unusedExport)).sort();
    expect(unused).toEqual(
      [
        "Badge",
        "Button",
        "Shape",
        "Toolbar",
        "bump",
        "checkAdd",
        "countdown",
        "describe",
        "legacyAdd",
        "main",
        "neverUsed",
        "times",
        "useCounter",
        // members.ts / client.ts: used only through their members, or not at all.
        "Alpha",
        "Beta",
        "MsgA",
        "MsgB",
        "exercise",
        // ui.tsx: used only inside it.
        "Later",
        "Quiet",
        "Shell",
        "useDefaults",
        "useStore",
      ].sort(),
    );
    expect(r.stats.unusedExports).toBe(unused.length);
    // Used from another file, so not flagged.
    for (const used of ["add", "sum", "Circle", "HasArea", "Geometry", "origin", "Point", "square", "double"]) {
      expect(has(sym(used), SymbolFlag.unusedExport)).toBe(false);
    }
  });
});

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────

describe("limits", () => {
  test("maxRefs caps the heaviest symbols first and keeps totals, edges and flags", async () => {
    const cap = 50;
    const t = (await analyzeTypeScript(inputFor(FIXTURE, fixturePaths, { maxRefs: cap })))!;
    expect(t.refs.symbol).toHaveLength(cap);
    expect(t.stats.truncated).toBe(r.refs.symbol.length - cap);
    expect(t.symbols.refs).toEqual(r.symbols.refs);
    expect(t.calls).toEqual(r.calls);
    expect(t.symbols.flags).toEqual(r.symbols.flags);
    const kept = new Array<number>(t.symbols.name.length).fill(0);
    for (const s of t.refs.symbol) kept[s]!++;
    // Every symbol that lost references kept at least as many as any symbol that kept all of
    // its own; i.e. only symbols above the water line were cut.
    const cutLevels = kept.filter((k, s) => k < r.symbols.refs[s]!);
    expect(cutLevels.length).toBeGreaterThan(0);
    const level = Math.min(...cutLevels);
    kept.forEach((k, s) => {
      if (k === r.symbols.refs[s]) return;
      expect(k).toBeGreaterThanOrEqual(level);
    });
    for (let s = 0; s < kept.length; s++) if (r.symbols.refs[s]! < level) expect(kept[s]).toBe(r.symbols.refs[s]!);
    expect(t.fileRefStart[t.fileRefStart.length - 1]).toBe(cap);
  }, 60_000);

  test("maxFiles: more TS/JS files than the cap returns null and says why", async () => {
    const messages: string[] = [];
    const t = await analyzeTypeScript(inputFor(FIXTURE, fixturePaths, { maxFiles: 3, onProgress: (m) => messages.push(m) }));
    expect(t).toBeNull();
    expect(messages.join("\n")).toContain("exceed the limit of 3");
  });

  test("nothing to analyze returns null", async () => {
    expect(await analyzeTypeScript(inputFor(FIXTURE, ["README.md", "data.json"]))).toBeNull();
  });

  test("skip: a generated or vendored file has no symbols, and references into it are counted, not stored", async () => {
    const messages: string[] = [];
    const legacy = fileId("src/legacy.js");
    const skip = fixturePaths.map((_, i) => i === legacy);
    const t = (await analyzeTypeScript(inputFor(FIXTURE, fixturePaths, { skip, onProgress: (m) => messages.push(m) })))!;
    expect(t.moduleSymbol[legacy]).toBe(-1);
    expect(t.symbols.file.includes(legacy)).toBe(false);
    expect(t.refs.file.includes(legacy)).toBe(false);
    expect(t.stats.files).toBe(r.stats.files - 1);
    // math.testcase.ts imports and calls `square`, declared in the skipped file.
    expect(messages).toContain("TypeScript: 2 references into generated, vendored or minified files were left out");
    expect(t.stats.unresolved).toBe(r.stats.unresolved);
  }, 60_000);

  test("never throws: an unusable root is reported, not raised", async () => {
    const messages: string[] = [];
    const t = await analyzeTypeScript(inputFor("/nonexistent/starchart-root", ["a.ts"], { onProgress: (m) => messages.push(m) }));
    expect(t).toBeNull();
    expect(messages.length).toBeGreaterThan(0);
  }, 60_000);
});

// ─── CommonJS in an inferred project ─────────────────────────────────────────────────────────

describe("CommonJS without a config", () => {
  // Built in the OS temp dir rather than under test/fixtures: an inferred project searches the
  // file's ancestors for a tsconfig, and under this repo it would find starchart's own.
  let dir = "";
  let c: CodeSymbols;
  const files: Record<string, string> = {
    "index.js": [
      "const View = require('./lib/view');",
      "const { helper } = require('./lib/util');",
      "new View('home').render();",
      "helper();",
      "",
    ].join("\n"),
    "lib/util.js": [
      "/** Lowercases a slug. */",
      "exports.slugify = function (s) { return s.toLowerCase(); };",
      "function helper() { return 1; }",
      "module.exports.helper = helper;",
      "",
    ].join("\n"),
    "lib/view.js": [
      "var slug = require('./util').slugify;",
      "function View(name) { this.name = name; }",
      "View.prototype.render = function render() { return this.name ? slug(this.name) : ''; };",
      "module.exports = View;",
      "",
    ].join("\n"),
    // express's shape: the package entry re-exports the factory another file exports.
    "lib/app.js": ["exports = module.exports = createApp;", "function createApp() { return {}; }", ""].join("\n"),
    "main.js": ["module.exports = require('./lib/app');", ""].join("\n"),
    "start.js": ["const make = require('./main');", "make();", "make();", ""].join("\n"),
    "run.cts": ["export = function run(command: string): string {", "  return command;", "};", ""].join("\n"),
  };
  const paths = Object.keys(files).sort();
  const name = (s: number) => c.symbols.name[s];
  const refs = (s: number) =>
    c.refs.symbol.flatMap((x, i) => (x === s ? [`${paths[c.refs.file[i]!]} ${c.refs.line[i]}:${c.refs.col[i]} ${REF_KINDS[c.refs.kind[i]!]} ← ${name(c.refs.from[i]!)}`] : []));
  const find = (n: string) => c.symbols.name.indexOf(n);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "starchart-ts-cjs-"));
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    c = (await analyzeTypeScript(inputFor(dir, paths, { configs: [] })))!;
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  test("files land in the inferred project", () => {
    expect(c.projects).toEqual([{ config: "", files: paths.length, ms: c.projects[0]!.ms }]);
  });

  test("module.exports = require('./x') hands x's export through, so calls reach the function", () => {
    const createApp = find("createApp");
    expect(refs(createApp)).toEqual([
      "lib/app.js 0:27 export ← app.js",
      "start.js 0:6 import ← start.js",
      "start.js 1:0 call ← start.js",
      "start.js 2:0 call ← start.js",
    ]);
    // Nothing is left on the re-exporting file's module symbol.
    expect(refs(c.moduleSymbol[paths.indexOf("main.js")]!)).toEqual([]);
  });

  test("export = function run() is placed at its name, not at `export`", () => {
    const run = find("run");
    expect([c.symbols.kind[run], c.symbols.line[run], c.symbols.col[run]]).toEqual(["function", 0, 18]);
  });

  test("exports.x = function, module.exports = X, prototype methods", () => {
    const slugify = find("slugify");
    expect(c.symbols.kind[slugify]).toBe("function");
    expect(c.symbols.doc[slugify]).toBe("Lowercases a slug.");
    expect(c.symbols.flags[slugify]! & SymbolFlag.exported).toBeTruthy();
    const view = find("View");
    expect(c.symbols.flags[view]! & SymbolFlag.defaultExport).toBeTruthy();
    const render = find("render");
    expect([c.symbols.kind[render], c.symbols.parent[render]]).toEqual(["method", view]);
    expect(c.symbols.kind[find("slug")]).toBe("variable");
  });

  test("require bindings resolve to what the module exports", () => {
    expect(refs(find("View"))).toEqual([
      "index.js 0:6 import ← index.js",
      "index.js 2:4 new ← index.js",
      "lib/view.js 2:0 read ← view.js",
      "lib/view.js 3:17 export ← view.js",
    ]);
    expect(refs(find("helper"))).toEqual([
      "index.js 1:8 import ← index.js",
      "index.js 3:0 call ← index.js",
      "lib/util.js 3:24 export ← util.js",
    ]);
    // `var slug = require('./util').slugify` is a variable to tsgo, not an alias: the export is
    // read once by `slug`, and the prototype method calls `slug`.
    expect(refs(find("slugify"))).toEqual(["lib/view.js 0:29 read ← slug"]);
    expect(refs(find("slug"))).toEqual(["lib/view.js 2:63 call ← render"]);
  });
});

describe("doc comments with every link form", () => {
  // A bare `{@link}` made the compiler's own comment formatter throw, and that one comment
  // ended the analysis of the whole project: starchart's report of itself had no symbols.
  let dir = "";
  let c: CodeSymbols | null;
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
    "src/store.ts": [
      "export class Store {",
      "  read(): number { return 1; }",
      "  write(): void {}",
      "}",
      "/** Reads a {@link Store} by {@link Store.read}, {@link Store#write}, {@linkcode Store | the store} and {@link}. Then more. */",
      "export function use(s: Store): number { return s.read(); }",
      "",
    ].join("\n"),
  };
  const paths = Object.keys(files).sort();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "starchart-ts-links-"));
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    c = await analyzeTypeScript(inputFor(dir, paths));
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  test("the analysis survives, and the summary keeps each link as written", () => {
    expect(c).not.toBeNull();
    const use = c!.symbols.name.indexOf("use");
    expect(c!.symbols.doc[use]).toBe(
      "Reads a {@link Store} by {@link Store.read}, {@link Store#write}, {@linkcode Store | the store} and {@link}.",
    );
    // The links still count as references to what they name.
    const store = c!.symbols.name.indexOf("Store");
    expect(c!.refs.symbol.filter((s, i) => s === store && c!.refs.from[i] === use).length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Configs the compiler cannot open ────────────────────────────────────────────────────────

describe("a circular tsconfig `extends`", () => {
  // tsgo never answers a request that loads one of these configs, and loads it for any file
  // beneath it, so before the fix the whole CLI hung with both processes idle.
  let dir = "";
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.other.json", include: ["src"] }),
    "tsconfig.other.json": JSON.stringify({ extends: "./tsconfig.json", include: ["src"] }),
    "src/c.ts": "export const c = 1;\nexport const d = c;\n",
  };
  const paths = Object.keys(files).sort();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "starchart-ts-circular-"));
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("is skipped with a reason, and its files are still analyzed without it", async () => {
    const messages: string[] = [];
    const configs = paths.filter((p) => p.endsWith(".json"));
    const t = await analyzeTypeScript(inputFor(dir, paths, { configs, onProgress: (m) => messages.push(m) }));
    expect(messages).toContain('TypeScript: skipping tsconfig.json: its "extends" chain is circular, which the compiler cannot open');
    expect(t?.projects.map((p) => p.config)).toEqual([""]);
    expect(t?.stats.references).toBe(1);
  }, 30_000);

  test("one the walker did not list cannot hang the analysis either: the request is bounded", async () => {
    const messages: string[] = [];
    const saved = limits.snapshotMs;
    limits.snapshotMs = () => 1500;
    try {
      const started = performance.now();
      const t = await analyzeTypeScript(inputFor(dir, paths, { configs: [], onProgress: (m) => messages.push(m) }));
      expect(t).toBeNull();
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(messages.some((m) => m.includes("got no answer"))).toBe(true);
    } finally {
      limits.snapshotMs = saved;
    }
  }, 30_000);
});
