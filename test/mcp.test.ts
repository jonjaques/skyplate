/**
 * The MCP server end to end: a real MCP client, in process, against a small git repository.
 *
 * The fixture has what the tools answer about: TypeScript that imports and calls itself in a
 * cycle, a method reached only through an interface, a test file, two authors over several
 * commits, a declared-but-unused and an imported-but-undeclared package, Markdown links, and a
 * committed .env whose contents must never come back from any tool. The same questions are
 * asked of the live project and of a report folder built from it, and must agree.
 *
 * Git runs under an isolated config and HOME, as in test/pipeline.test.ts.
 *
 * Run: bun test test/mcp.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { parseDataScript } from "../src/core/site";
import { parseSince } from "../src/mcp/query";
import { createServer } from "../src/mcp/server";
import { render } from "../src/mcp/text";
import { relevantChange, Workspace } from "../src/mcp/workspace";
import { validateReport } from "../src/core/validate";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-mcp-test-")));
const REPO = join(TMP, "demo");
const OUT = join(TMP, "out", "demo.skyplate");
const SECRET = "skyplate-mcp-secret-3a7f0c9e21";

const ISOLATED = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: TMP,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

function git(args: string[], env: Record<string, string> = {}): void {
  const r = Bun.spawnSync(["git", ...args], { cwd: REPO, env: { ...ISOLATED, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
}

function write(path: string, content: string): void {
  const abs = join(REPO, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function commit(name: string, date: string, message: string): void {
  const email = `${name.toLowerCase()}@example.com`;
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

const ws = new Workspace();
const client = new Client({ name: "skyplate-test", version: "0" });
/** Every text any tool returned, to prove the secret never left the server. */
const seen: string[] = [];

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; error: boolean }> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  seen.push(text);
  if (r.structuredContent) seen.push(JSON.stringify(r.structuredContent));
  return { text, error: !!r.isError };
}

/** A tool's JSON result; read_source and errors are plain text and go through call(). */
async function json(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const { text, error } = await call(name, args);
  if (error) throw new Error(`${name} failed: ${text}`);
  // A stale or refreshing answer leads with one "note:" line.
  return JSON.parse(text.startsWith("note: ") ? text.slice(text.indexOf("\n") + 1) : text);
}

beforeAll(async () => {
  mkdirSync(REPO, { recursive: true });
  git(["init", "-q", "-b", "main"]);
  write("README.md", "# Demo\n\nA fixture for the skyplate MCP test. See [the guide](docs/guide.md).\n");
  write("docs/guide.md", "# Guide\n\nBack to the [readme](../README.md).\n");
  write("package.json", JSON.stringify({ name: "demo", version: "1.0.0", scripts: { start: "bun src/app.ts" }, dependencies: { "left-pad": "1.0.0" } }, null, 2));
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["src", "tests"] }));
  write(".env", `API_KEY=${SECRET}\n`);
  write(
    "src/math.ts",
    'import { log } from "./app";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function twice(x: number): number {\n  log("twice");\n  return add(x, x);\n}\n',
  );
  write(
    "src/app.ts",
    'import { twice } from "./math";\nimport { total } from "./shapes";\n\nexport function log(msg: string): void {\n  console.log(msg);\n}\n\nexport function main(): number {\n  return twice(2) + total([]);\n}\n\nexport const neverUsed = 1;\n',
  );
  commit("Ada", "2026-01-05T10:00:00Z", "feat: math and app");
  write(
    "src/shapes.ts",
    'import { z } from "zod";\n\nexport interface Shape {\n  area(): number;\n}\n\nexport class Circle implements Shape {\n  constructor(private r: number) {}\n  area(): number {\n    return Math.PI * this.r * this.r;\n  }\n}\n\nexport function total(shapes: Shape[]): number {\n  z.number();\n  return shapes.reduce((sum, s) => sum + s.area(), 0);\n}\n',
  );
  write("tests/math.test.ts", 'import { add } from "../src/math";\n\nexport const ok = add(1, 2) === 3;\n');
  // A relay: its whole body is one call into src/, which makes twice part of src's interface.
  write("lib/double.ts", 'import { join } from "node:path";\nimport { label } from "../big/b/two";\nimport { twice } from "../src/math";\n\nexport function double(x: number): number {\n  return twice(x);\n}\n\nexport const four = double(2) + join("a").length + label([]).length;\n');
  // The parent keeps a direct file when review splits its two larger subdirectories.
  write("big/direct.ts", "export function offset(value: number): number { return value + 1; }\n");
  write(
    "big/a/one.ts",
    'import { offset } from "../direct";\n\nexport function scale(values: number[], k: number): number[] {\n  const out: number[] = [];\n  for (const v of values) {\n    if (v < 0) out.push(0);\n    else out.push(offset(v * k));\n  }\n  return out;\n}\n\nexport function mean(values: number[]): number {\n  let sum = 0;\n  for (const v of values) sum += v;\n  return values.length ? sum / values.length : 0;\n}\n',
  );
  write(
    "big/b/two.ts",
    'import { mean, scale } from "../a/one";\n\nexport function summary(values: number[]): string {\n  const m = mean(scale(values, 2));\n  if (m > 10) return "high";\n  if (m > 5) return "medium";\n  return "low";\n}\n\nexport const label = (values: number[]): string => `mean ${summary(values)}`;\n',
  );
  // A config a tool loads: its default export is unreferenced, and not dead.
  write("app.config.ts", 'export default { name: "demo" };\n');
  // A loop closed only by `import type`: b reads A's shape, a constructs a B. Not a cycle at runtime.
  write("types/a.ts", 'import { B } from "./b";\n\nexport interface A {\n  n: number;\n}\n\nexport const made = new B();\n');
  write("types/b.ts", 'import type { A } from "./a";\n\nexport class B {\n  value(x: A): number {\n    return x.n;\n  }\n}\n');
  commit("Grace", "2026-02-10T10:00:00Z", "feat: shapes and a test");
  write("src/math.ts", 'import { log } from "./app";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function twice(x: number): number {\n  log("twice!");\n  return add(x, x);\n}\n');
  write("src/app.ts", 'import { twice } from "./math";\nimport { total } from "./shapes";\n\nexport function log(msg: string): void {\n  console.log(`[demo] ${msg}`);\n}\n\nexport function main(): number {\n  return twice(2) + total([]);\n}\n\nexport const neverUsed = 1;\n');
  commit("Ada", "2026-03-01T10:00:00Z", "fix: louder logs");

  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await createServer(ws).connect(serverEnd);
  await client.connect(clientEnd);
});

afterAll(async () => {
  await client.close();
  ws.shutdown();
  rmSync(TMP, { recursive: true, force: true });
});

describe("tools", () => {
  test("list every tool, read-only ones marked", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["build_report", "close", "dependencies", "dir", "file", "files", "findings", "graph", "history", "open", "overview", "read_source", "seam", "seams", "search_symbols", "serve_report", "status", "symbol"].sort(),
    );
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("symbol")!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("build_report")!.annotations?.readOnlyHint).toBe(false);
  });

  test("nothing open is an error that says what to do", async () => {
    const r = await call("overview");
    expect(r.error).toBe(true);
    expect(r.text).toContain("call open");
  });
});

describe("a live project", () => {
  test("open analyzes it and returns the overview", async () => {
    const r = await json("open", { path: REPO, wait_seconds: 120 });
    expect(r.project).toMatchObject({ id: "demo", kind: "live", state: "ready" });
    expect(r.overview.project.name).toBe("Demo");
    expect(r.overview.git).toMatchObject({ commits: 3, authors: 2 });
    expect(r.overview.codeIntelligence.symbols).toBeGreaterThan(5);
    expect(r.overview.structure.cycles).toBe(1);
  }, 120_000);

  test("files filter, sort and search", async () => {
    const all = await json("files", { sort: "code", limit: 3 });
    expect(all.files.map((f: any) => f.path)).toContain("src/shapes.ts");
    const src = await json("files", { path: "src", sort: "path" });
    expect(src.files.map((f: any) => f.path)).toEqual(["src/app.ts", "src/math.ts", "src/shapes.ts"]);
    const glob = await json("files", { path: "**/*.test.ts" });
    expect(glob.files.map((f: any) => f.path)).toEqual(["tests/math.test.ts"]);
    const fuzzy = await json("files", { query: "shap" });
    expect(fuzzy.files[0].path).toBe("src/shapes.ts");
    const owned = await json("files", { owner: "grace" });
    expect(owned.files.map((f: any) => f.path)).toEqual(expect.arrayContaining(["src/shapes.ts", "tests/math.test.ts"]));
    const cyc = await json("files", { flag: "in_cycle" });
    expect(cyc.files.map((f: any) => f.path).sort()).toEqual(["src/app.ts", "src/math.ts"]);
  });

  test("explicit file sorts override query relevance before pagination", async () => {
    const relevant = await json("files", { query: "src" });
    expect(relevant.files[0].path).toBe("src/app.ts");
    const byCode = await json("files", { query: "src", sort: "code" });
    expect(byCode.files.map((f: any) => f.path)).toEqual(["src/shapes.ts", "src/app.ts", "src/math.ts"]);
    const page = await json("files", { query: "src", sort: "code", offset: 1, limit: 1 });
    expect(page.files.map((f: any) => f.path)).toEqual(["src/app.ts"]);
    const byPath = await json("files", { query: "app", sort: "path" });
    expect(byPath.files.map((f: any) => f.path)).toEqual(["app.config.ts", "src/app.ts"]);
  });

  test("structured answers preserve arrays and freshness warnings", async () => {
    const response = await client.callTool({ name: "findings", arguments: {} });
    const payload = response.structuredContent as { data: unknown };
    expect(payload.data).toEqual(JSON.parse((response.content[0] as { text: string }).text));
    const p = ws.resolve("demo");
    const previous = p.changedAt;
    p.refresh = "manual";
    p.changedAt = p.snapshot!.startedAt + 1;
    try {
      const stale = await client.callTool({ name: "overview", arguments: {} });
      expect(stale.structuredContent).toHaveProperty("freshnessNote", expect.stringContaining("refresh is manual"));
    } finally {
      p.changedAt = previous;
      p.refresh = "on_read";
    }
  });

  test("runtime traversal omits type-only edges in both directions", async () => {
    expect((await json("graph", { view: "dependencies", path: "types/b.ts" })).total).toBe(1);
    expect((await json("graph", { view: "dependencies", path: "types/b.ts", runtime_only: true })).total).toBe(0);
    expect((await json("graph", { view: "dependents", path: "types/a.ts", runtime_only: true })).total).toBe(0);
    expect((await json("graph", { view: "dependents", path: "types/b.ts", runtime_only: true })).total).toBe(1);
    const blocked = await json("graph", { view: "path", path: "types/b.ts", to: "types/a.ts", runtime_only: true });
    expect(blocked).toMatchObject({ found: false, runtimeOnly: true });
    expect(blocked.note).toContain("reverse exists");
    expect((await json("graph", { view: "path", path: "types/a.ts", to: "types/b.ts", runtime_only: true })).found).toBe(true);
  });

  test("module ranking pages without repeating or hiding the remainder", async () => {
    const all = await json("seams", { limit: 100 });
    const first = await json("seams", { limit: 1 });
    const next = await json("seams", { offset: 1, limit: 100 });
    expect([...first.rows, ...next.rows]).toEqual(all.rows);
    expect(first.more).toBe(all.modules - 1);
    expect(next.more).toBeUndefined();
  });

  test("a file's record joins the graph, history and symbols", async () => {
    const f = await json("file", { path: "src/math.ts" });
    expect(f.imports.files).toEqual(["src/app.ts"]);
    expect(f.importedBy.files.sort()).toEqual(["lib/double.ts", "src/app.ts", "tests/math.test.ts"]);
    expect(f.graph.cycle.files.sort()).toEqual(["src/app.ts", "src/math.ts"]);
    expect(f.history).toMatchObject({ commits: 2, owner: "Ada" });
    expect(f.symbols.topLevel.map((s: any) => s.name)).toEqual(["add", "twice"]);
    // Markdown links are not imports, and are listed apart.
    const readme = await json("file", { path: "README.md" });
    expect(readme.imports.count).toBe(0);
    expect(readme.linksTo.files).toEqual(["docs/guide.md"]);
    // An absolute path under the root works; a wrong one suggests the closest.
    expect((await json("file", { path: join(REPO, "src/app.ts") })).path).toBe("src/app.ts");
    const miss = await call("file", { path: "src/mth.ts" });
    expect(miss.error).toBe(true);
    expect(miss.text).toContain("src/math.ts");
  });

  test("a directory's record", async () => {
    const root = await json("dir", {});
    expect(root.dirs.map((d: any) => d.path)).toEqual(expect.arrayContaining(["src", "tests", "docs"]));
    const src = await json("dir", { path: "src/" });
    expect(src.totals.files).toBe(3);
    expect(src.owners[0].author).toBeDefined();
  });

  test("symbols: search, callers with call sites, calls, impact", async () => {
    const found = await json("search_symbols", { query: "twice" });
    expect(found.symbols[0]).toMatchObject({ name: "twice", kind: "function", at: "src/math.ts:7" });
    const unused = await json("search_symbols", { unused_exports: true });
    expect(unused.symbols.map((s: any) => s.name)).toContain("neverUsed");

    const add = await json("symbol", { name: "add", impact_depth: 3 });
    expect(add.calledBy.rows.map((r: any) => r.name)).toContain("twice");
    expect(add.calledBy.rows.find((r: any) => r.name === "twice").site).toBe("src/math.ts:9");
    expect(add.references.byFile.map((f: any) => f.path)).toContain("tests/math.test.ts");
    // add ← twice ← main: two levels of callers.
    expect(add.impact.nearest.map((n: any) => n.name)).toEqual(expect.arrayContaining(["twice", "main"]));

    const twice = await json("symbol", { name: "twice" });
    expect(twice.calls.rows.map((r: any) => r.name).sort()).toEqual(["add", "log"]);
  });

  test("a method reached only through its interface shows those callers", async () => {
    const area = await json("symbol", { name: "Circle.area" });
    expect(area.calledThroughBases[0].base).toBe("Shape.area");
    expect(area.calledThroughBases[0].callers.rows.map((r: any) => r.name)).toContain("total");
    const circle = await json("symbol", { name: "Circle" });
    expect(circle.extends.map((b: any) => b.name)).toEqual(["Shape"]);
  });

  test("an ambiguous or unknown name lists candidates", async () => {
    const amb = await call("symbol", { name: "area" });
    expect(amb.error).toBe(true);
    expect(amb.text).toContain("2 symbols are named");
    const none = await call("symbol", { name: "twce" }); // a dropped letter still ranks as a subsequence
    expect(none.error).toBe(true);
    expect(none.text).toContain("Closest");
  });

  test("graph: dependents, a path, cycles, hubs", async () => {
    const deps = await json("graph", { view: "dependents", path: "src/shapes.ts" });
    expect(deps.files.map((f: any) => f.path)).toEqual(expect.arrayContaining(["src/app.ts", "src/math.ts", "tests/math.test.ts"]));
    const path = await json("graph", { view: "path", path: "tests/math.test.ts", to: "src/shapes.ts" });
    expect(path).toMatchObject({ found: true, chain: ["tests/math.test.ts", "src/math.ts", "src/app.ts", "src/shapes.ts"] });
    const back = await json("graph", { view: "path", path: "src/shapes.ts", to: "src/app.ts" });
    expect(back.found).toBe(false);
    const cycles = await json("graph", { view: "cycles" });
    expect(cycles.total).toBe(1);
    expect((await json("graph", { view: "hubs" })).files.length).toBeGreaterThan(0);
  });

  test("history: summary, commits by path and author, ownership", async () => {
    const sum = await json("history", { view: "summary" });
    expect(sum).toMatchObject({ commits: 3, authors: 2, branch: "main" });
    const commits = await json("history", { view: "commits", path: "src/math.ts" });
    expect(commits.commits.map((c: any) => c.subject)).toEqual(["fix: louder logs", "feat: math and app"]);
    const grace = await json("history", { view: "commits", author: "grace" });
    expect(grace.total).toBe(1);
    const fixes = await json("history", { view: "commits", type: "fix", since: "2026-02-15" });
    expect(fixes.total).toBe(1);
    const own = await json("history", { view: "ownership", path: "src" });
    expect(own.owners.map((o: any) => o.author).sort()).toEqual(["Ada", "Grace"]);
  });

  test("declared entry points are not unimported", async () => {
    const unimported = (await json("files", { flag: "unimported" })).files.map((f: any) => f.path);
    expect(unimported).toEqual(["lib/double.ts"]);
    const entries = (await json("files", { flag: "entry" })).files.map((f: any) => f.path);
    expect(entries).toEqual(["app.config.ts", "src/app.ts"]);
    expect((await json("file", { path: "src/app.ts" })).entry).toBe("entry point: package script");
  });

  test("dependencies: unused and undeclared", async () => {
    const unused = await json("dependencies", { filter: "unused" });
    expect(unused.dependencies.map((d: any) => d.name)).toContain("left-pad");
    const undeclared = await json("dependencies", { filter: "undeclared" });
    expect(undeclared.dependencies.map((d: any) => d.name)).toEqual(["zod"]); // node:path is a builtin, not undeclared
    const builtin = await json("dependencies", { filter: "builtin" });
    expect(builtin.dependencies).toEqual([expect.objectContaining({ name: "path", ecosystem: "node" })]);
    expect(builtin.builtins).toBe(1);
  });

  test("findings name their files", async () => {
    const all = await json("findings");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f: any) => typeof f.title === "string")).toBe(true);
  });

  test("read_source numbers lines and lists declarations; credentials never come back", async () => {
    const r = await call("read_source", { path: "src/math.ts", start_line: 3, end_line: 5 });
    expect(r.error).toBe(false);
    expect(r.text).toContain("from disk");
    expect(r.text).toContain("3  export function add(a: number, b: number): number {");
    expect(r.text).toContain("function add");
    const env = await call("read_source", { path: ".env" });
    expect(env.error).toBe(true);
    expect(env.text).toContain("credentials");
    const structured = await client.callTool({ name: "read_source", arguments: { path: "src/math.ts", start_line: 3, end_line: 5 } });
    expect(structured.structuredContent).toMatchObject({ data: { path: "src/math.ts", startLine: 3, endLine: 5, source: "export function add(a: number, b: number): number {\n  return a + b;\n}" } });
    expect((await call("read_source", { path: "src/math.ts", start_line: 5, end_line: 3 })).error).toBe(true);
  });

  test("the report is valid, and a loop closed only by import type is not a cycle", async () => {
    const snap = ws.resolve("demo").snapshot!;
    expect(validateReport(snap.report, await snap.symbols())).toEqual([]);
    expect(snap.report.edges.typeOnly?.length).toBe(1);
    const cycles = await json("graph", { view: "cycles" });
    expect(cycles.total).toBe(1); // math ↔ app, which runs
    expect(cycles.typeOnlyLoops).toBe(1);
    expect((await json("overview")).structure).toMatchObject({ cycles: 1, typeOnlyEdges: 1, typeOnlyLoops: 1 });
    const [loopFinding] = await json("findings", { id: "type-only-loops" });
    expect(loopFinding).toMatchObject({ severity: "info", files: ["types/a.ts", "types/b.ts"].sort() });
    expect(loopFinding.title).toBe("One import loop closes only through `import type`, tying 2 files together");
    expect(loopFinding.detail).toContain("types/b.ts → types/a.ts");
    expect(cycles.typeOnly).toBeUndefined();
    const typed = await json("graph", { view: "cycles", include_type_only: true });
    expect(typed.typeOnly).toEqual([expect.objectContaining({ size: 2, closedBy: ["types/b.ts → types/a.ts"] })]);
    expect(typed.typeOnly[0].inRuntimeCycle).toBeUndefined();
    const b = await json("file", { path: "types/b.ts" });
    expect(b.typeOnlyImports).toEqual(["types/a.ts"]);
    expect(b.graph.cycle).toBeUndefined();
    const path = await json("graph", { view: "path", path: "types/b.ts", to: "types/a.ts" });
    expect(path.typeOnlyHops).toEqual(["types/b.ts → types/a.ts"]);
    expect((await json("file", { path: "src/math.ts" })).typeOnlyImports).toBeUndefined();
  });

  test("unused exports list the ones referenced nowhere first", async () => {
    const r = await json("search_symbols", { unused_exports: true, limit: 50 });
    const names = r.symbols.map((x: any) => x.name);
    const dead = r.symbols.filter((x: any) => x.flags.includes("unreferenced")).map((x: any) => x.name);
    // Circle is referenced nowhere; Shape is used inside shapes.ts (Circle implements it, total takes it).
    expect(dead).toContain("Circle");
    expect(dead).not.toContain("Shape");
    expect(dead).not.toContain("neverUsed"); // an entry export, below
    expect(names.indexOf("Shape")).toBeGreaterThan(Math.max(...dead.map((d: string) => names.indexOf(d))));
    expect(r.unusedExports.unreferenced).toBe(dead.length);
    // app.config.ts is a tool config and src/app.ts a file a script runs: their exports belong to
    // whatever loads them, so neverUsed (src/app.ts) is an entry export, not dead.
    expect(r.symbols.at(-1).flags).toContain("entry-export");
    const entryRows = r.symbols.filter((x: any) => x.flags.includes("entry-export")).map((x: any) => x.at);
    expect(entryRows).toEqual(expect.arrayContaining(["app.config.ts:1", "src/app.ts:12"]));
    expect(r.unusedExports["entry-export"]).toBe(entryRows.length);
    const u = r.unusedExports;
    expect(u.unreferenced + u["used-in-own-file"] + u["entry-export"] + u["public-api"]).toBe(r.matched);
    // The filter returns one kind, and the rows carry their doc comments.
    const only = await json("search_symbols", { unused_kind: "entry-export" });
    expect(only.matched).toBe(entryRows.length);
    expect(only.symbols.every((x: any) => x.flags.includes("entry-export"))).toBe(true);
    expect(only.unusedExports).toEqual(r.unusedExports); // the header still counts every class
    const finding = (await json("findings", { id: "unused-exports" }))[0];
    expect(finding.detail).toMatch(/^Of these, \d+ (is|are) referenced nowhere at all; \d+ (is|are) used inside/);
  });

  test("an edit marks the project stale, and the next question re-analyzes", async () => {
    write("src/math.ts", 'import { log } from "./app";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function twice(x: number): number {\n  log("twice!");\n  return add(x, x);\n}\n\nexport function thrice(x: number): number {\n  return add(add(x, x), x);\n}\n');
    // The watcher hears it asynchronously (FSEvents batches on macOS, inotify on Linux).
    let state = "";
    for (let i = 0; i < 100 && state !== "stale"; i++) {
      state = (await json("status", { project: "demo", wait_seconds: 0 })).state;
      if (state !== "stale") await Bun.sleep(100);
    }
    expect(state).toBe("stale");
    const found = await json("search_symbols", { query: "thrice", wait_seconds: 120 });
    expect(found.symbols[0]).toMatchObject({ name: "thrice", at: "src/math.ts:12" });
    expect((await json("status", { project: "demo" })).state).toBe("ready");
  }, 130_000);
});

describe("seams", () => {
  test("seam measures a module at its interface", async () => {
    const src = await json("seam", { path: "src" });
    expect(src.implementation.files).toBe(3);
    // twice is used from lib/ (production code); add only from tests/, which reach past the interface.
    expect(src.interface.rows.map((r: any) => r.name)).toContain("twice");
    expect(src.interface.rows.map((r: any) => r.name)).not.toContain("add");
    expect(src.testsPastInterface.rows.map((r: any) => r.name)).toEqual(["add"]);
    expect(src.testsPastInterface.rows[0].testFiles).toEqual(["tests/math.test.ts"]);
    expect(src.imports.inbound).toMatchObject({ files: 1, testFiles: 1 }); // lib/double.ts; tests/math.test.ts apart
    expect(src.locality.commits).toBeGreaterThan(0);
  });

  test("relays and adapters", async () => {
    const lib = await json("seam", { path: "lib/double.ts" });
    expect(lib.relays).toEqual([expect.objectContaining({ name: "double", forwardsTo: "twice", callers: 1 })]);
    // total is one call too, but a reduce over a callback is a loop, not a forward.
    const shapes = await json("seam", { path: "src/shapes.ts" });
    expect(shapes.relays).toEqual([]); // measured, and none: an empty list, not a missing one
    expect(shapes.imports.cyclesAcross).toEqual([]);
    expect(shapes.adapters).toEqual([expect.objectContaining({ name: "Shape", implementations: 1 })]);
    expect(shapes.adapters[0].rows[0].name).toBe("Circle");
  });

  test("seams splits a module holding over a quarter of the code into its subdirectories", async () => {
    const snap = ws.resolve("demo").snapshot!.report;
    const own = snap.files.filter((f) => (f.category === "code" || f.category === "test") && !f.generated && !f.vendored);
    const big = own.filter((f) => f.path.startsWith("big/")).reduce((a, f) => a + f.code, 0);
    expect(big / own.reduce((a, f) => a + f.code, 0)).toBeGreaterThan(0.25); // the premise
    expect(snap.graph.modules.map((m) => snap.dirs[m.dir]!.path)).toContain("big"); // the analyzer stops here
    const modules = (await json("seams", { limit: 100 })).rows.map((r: any) => r.module);
    expect(modules).toEqual(expect.arrayContaining(["big/a", "big/b"]));
    expect(modules).toContain("big"); // direct.ts remains in the parent module
  });

  test("ranked module drilldowns preserve residual parents and the selected partition", async () => {
    for (const depth of [undefined, 1, 2]) {
      const ranked = await json("seams", { depth, limit: 100 });
      for (const row of ranked.rows) {
        const detail = await json("seam", { ...row.selector, limit: 500 });
        expect(detail.implementation.files).toBe(row.files);
        expect(detail.tests.files).toBe(row.testFiles ?? 0);
        expect(detail.implementation.code).toBe(row.code);
        expect(detail.implementation.complexity).toBe(row.complexity);
        expect(detail.interface.symbols).toBe(row.interface);
        expect(detail.locality.commits).toBe(row.commits);
        expect(detail.locality.spread).toBe(row.spread);
        expect(detail.locality.leaving).toBe(row.leaving);
        expect(detail.locality.coChangeMore).toBeUndefined();
        expect(row.hiddenCoupling).toBe(detail.locality.coChange.filter((pair: any) => pair.imports === "none").length);
        expect(detail.selector).toEqual(row.selector);
      }
    }
    const ranked = await json("seams", { limit: 100 });
    const parent = ranked.rows.find((row: any) => row.module === "big");
    expect(parent.selector).toEqual({ path: "big", scope: "module" });
    const detail = await json("seam", parent.selector);
    expect(detail.implementation.files).toBe(1);
    expect(detail.interface.rows.map((row: any) => row.name)).toContain("offset");
    const recursive = await json("seam", { path: "big" });
    expect(recursive.implementation.files).toBe(3);
    expect(recursive.implementation.code).toBeGreaterThan(detail.implementation.code);
    expect((await call("seam", { path: "big/a", scope: "module", depth: 1 })).error).toBe(true);
  });

  test("a module's own tests are clients; siblings' exports are internal; implementation is code only", async () => {
    const src = await json("seam", { path: "src" });
    // add's only outside user is a test: past the interface. twice is used from lib/.
    expect(src.testsPastInterface.rows.map((r: any) => r.name)).toEqual(["add"]);
    // total is exported for a sibling; log also belongs to a declared entry point.
    expect(src.internalExports.rows.map((r: any) => r.name)).toContain("total");
    expect(src.externalExports.rows.map((r: any) => r.name)).toContain("log");
    expect(src.couldHide.rows.map((r: any) => r.name)).not.toContain("log");
    expect(src.implementation.files).toBe(3);
    expect(src.tests).toEqual({ files: 0, code: 0 });
    const tests = await json("seam", { path: "tests" });
    expect(tests.implementation.files).toBe(0);
    expect(tests.tests.files).toBe(1);
  });

  test("seams ranks every module with its signals", async () => {
    const all = await json("seams", { sort: "code" });
    expect(all.sortedBy).toBe("code");
    const src = all.rows.find((r: any) => r.module === "src");
    expect(src).toMatchObject({ files: 3, testsPastInterface: 1 });
    expect(src.interface).toBeGreaterThanOrEqual(1);
    expect(all.legend.interface).toBeDefined();
    const byDepth = await json("seams", { depth: 1 });
    expect(byDepth.rows.map((r: any) => r.module)).toEqual(expect.arrayContaining(["src", "lib", "tests"]));
  });
});

describe("a built report", () => {
  test("build_report writes a folder, reusing the live analysis", async () => {
    const r = await json("build_report", { out: OUT, wait_seconds: 120 });
    expect(r.state).toBe("done");
    expect(r.result).toMatchObject({ out: OUT, reusedAnalysis: true });
    expect(existsSync(join(OUT, "index.html"))).toBe(true);
    expect(existsSync(join(OUT, "data", "report.js"))).toBe(true);
  }, 120_000);

  test("build_report refuses to replace a folder that is not a report", async () => {
    const r = await call("build_report", { out: join(REPO, "src") });
    expect(r.error).toBe(true);
    expect(r.text).toContain("not a skyplate report");
  });

  test("the folder opens as a report and answers like the live project", async () => {
    const opened = await json("open", { path: OUT, wait_seconds: 60 });
    expect(opened.project).toMatchObject({ kind: "report", state: "ready" });
    const id = opened.project.id;
    // Two projects are open now, so leaving project out is an error naming both.
    const vague = await call("overview");
    expect(vague.error).toBe(true);
    expect(vague.text).toContain(id);

    const live = await json("symbol", { project: "demo", name: "add" });
    const report = await json("symbol", { project: id, name: "add" });
    expect(report.counts).toEqual(live.counts);
    expect(report.calledBy).toEqual(live.calledBy);
    expect((await json("files", { project: id, sort: "code" })).files).toEqual((await json("files", { project: "demo", sort: "code" })).files);

    const src = await call("read_source", { project: id, path: "src/math.ts" });
    expect(src.text).toContain("embedded in the report");
    expect(src.text).toContain("export function thrice");
    expect((await call("read_source", { project: id, path: ".env" })).error).toBe(true);
  });

  test("serve_report serves it and stops", async () => {
    const served = await json("serve_report", { dir: OUT, port: 0 });
    expect(served.url).toStartWith("http://localhost:");
    const page = await fetch(served.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("skyplate");
    expect((await json("serve_report", { dir: OUT, port: 0 })).already).toBe(true);
    const stopped = await json("serve_report", { stop: true });
    expect(stopped.stopped).toEqual([served.url]);
  });

  test("close drops a project", async () => {
    const list = await json("status");
    const report = list.projects.find((p: any) => p.kind === "report");
    expect((await json("close", { project: report.id })).closed).toBe(report.id);
    expect((await json("status")).projects.map((p: any) => p.id)).toEqual(["demo"]);
  });

  test("no tool ever returned the secret", () => {
    expect(seen.length).toBeGreaterThan(20);
    for (const text of seen) expect(text).not.toContain(SECRET);
  });
});

describe("pieces", () => {
  test("the watcher ignores what cannot change the analysis", () => {
    const known = new Set(["", "src", "src/a.ts"]);
    expect(relevantChange("src/a.ts", known, true)).toBe(true);
    expect(relevantChange("src/new.ts", known, true)).toBe(true); // a new file in a listed folder
    expect(relevantChange("dist/a.js", known, true)).toBe(false); // inside a folder never listed
    expect(relevantChange("src/.DS_Store", known, true)).toBe(false);
    expect(relevantChange("node_modules/x/index.js", known, true)).toBe(false);
    expect(relevantChange("demo.skyplate/data/report.js", known, true)).toBe(false);
    expect(relevantChange(".demo.skyplate.tmp-1-abc", known, true)).toBe(false);
    expect(relevantChange(".git/HEAD", known, true)).toBe(true);
    expect(relevantChange(".git/refs/heads/main", known, true)).toBe(true);
    expect(relevantChange(".git/objects/ab/cdef", known, true)).toBe(false);
    expect(relevantChange(".git/HEAD", known, false)).toBe(false);
    expect(relevantChange("anything", undefined, true)).toBe(true);
  });

  test("render keeps short values on one line and breaks long ones", () => {
    expect(render({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
    const rows = Array.from({ length: 5 }, (_, i) => ({ path: `src/some/longer/path/file-${i}.ts`, lines: 100 + i, code: 80 + i }));
    const out = render({ files: rows });
    expect(out.split("\n")).toHaveLength(rows.length + 4);
    expect(JSON.parse(out)).toEqual({ files: rows });
  });

  test("data scripts read back what site.ts writes", () => {
    const text = `window.__skyplate.resolve("report", ${JSON.stringify({ a: ");" })});\n`;
    expect(parseDataScript(text, "report")).toEqual({ a: ");" });
    expect(parseDataScript(text, "symbols")).toBeUndefined();
    expect(() => parseDataScript(`window.__skyplate.resolve("report", {"a":`, "report")).toThrow();
  });

  test("dates take ISO days or spans back from now", () => {
    const now = Date.parse("2026-11-08T00:00:00Z") / 1000;
    expect(parseSince("2026-01-31", now)).toBe(Date.parse("2026-01-31") / 1000);
    expect(parseSince("30d", now)).toBe(now - 30 * 86_400);
    expect(() => parseSince("last tuesday", now)).toThrow();
  });
});
