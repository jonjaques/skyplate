/**
 * src/core/ts: code intelligence through the TypeScript 7 compiler API.
 *
 * Most assertions run against test/fixtures/ts, a small strict project that exercises each
 * construct the module has a rule for. Reference lists are asserted exactly, position by
 * position: a missing or extra reference is the bug this module most needs to not have.
 *
 * Positions in expectations are 0-based `line:col`, as the report stores them.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REF_KINDS, SymbolFlag, type CodeSymbols } from "../src/shared/schema";
import type { TsInput } from "../src/core/contracts";
import { analyzeTypeScript } from "../src/core/ts";

const FIXTURE = join(import.meta.dir, "fixtures/ts");

const LANG: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", json: "json" };

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
    expect(has(sym("id"), SymbolFlag.protected)).toBe(true);
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
    expect(refsTo(member("HasArea", "area"))).toEqual(["src/app.ts 6:45 call ← describe"]);
    expect(refsTo(member("Circle", "area"))).toEqual([]);
    expect(refsTo(sym("unit"))).toEqual(["src/app.ts 11:36 call ← main"]);
    expect(refsTo(sym("#reveal"))).toEqual(["src/shapes.ts 18:36 call ← label"]);
    expect(refsTo(sym("#secret"))).toEqual(["src/shapes.ts 26:16 read ← #reveal"]);
    expect(refsTo(sym("radius"))).toEqual(["src/shapes.ts 38:26 read ← area"]);
  });

  test("a get/set pair: writes go to the setter, reads through the interface to its property", () => {
    expect(refsTo(sym("label", { kind: "setter" }))).toEqual(["src/app.ts 14:4 write ← main"]);
    expect(refsTo(sym("label", { kind: "getter" }))).toEqual([]);
    expect(refsTo(member("HasArea", "label"))).toEqual(["src/app.ts 6:15 read ← describe"]);
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
      ["Badge", "Button", "Shape", "Toolbar", "bump", "checkAdd", "countdown", "describe", "legacyAdd", "main", "neverUsed", "times", "useCounter"].sort(),
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
    expect(c.projects).toEqual([{ config: "", files: 3, ms: c.projects[0]!.ms }]);
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
