import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { PARAMS, TOOLS } from "../src/core/bench/privacy";
import { parseHunks } from "../src/mcp/changes";
import { changeImpact, locateCode, mapCodebase } from "../src/mcp/query";
import { createServer } from "../src/mcp/server";
import { Workspace } from "../src/mcp/workspace";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-adoption-")));
const REPO = join(TMP, "project");
const SECRET = "private-fixture-value-7c11";
const ws = new Workspace(TMP);
const client = new Client({ name: "adoption-test", version: "1" });
function write(path: string, text: string) {
  mkdirSync(join(REPO, path, ".."), { recursive: true });
  writeFileSync(join(REPO, path), text);
}
function git(...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd: REPO, env: { PATH: process.env.PATH!, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode) throw new Error(r.stderr.toString());
}
async function call(name: string, args: Record<string, unknown> = {}) {
  // open names its project with `path`; every other tool takes `project`.
  const r = await client.callTool({ name, arguments: name === "open" ? args : { project: REPO, ...args } }, { timeout: 120000 });
  expect(JSON.stringify(r)).not.toContain(SECRET);
  if (r.isError) throw new Error(JSON.stringify(r));
  const data = (r.structuredContent as { data: any }).data as any;
  expect(data).toEqual(JSON.parse((r.content[0] as { text: string }).text.replace(/^note: .*\n/, "")));
  return data;
}
beforeAll(async () => {
  write("package.json", JSON.stringify({ name: "fixture", private: true, scripts: { start: "bun src/app.ts" }, dependencies: { zod: "1" } }));
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" }, include: ["src", "test"] }));
  write("src/billing/invoice.ts", '/** Render a customer invoice as pdf. */\nexport function renderInvoice() { return "invoice pdf"; }\n');
  write("src/app.ts", 'import { renderInvoice } from "./billing/invoice";\nexport function main() { return renderInvoice(); }\n');
  write("src/legacy.ts", 'export const marker = "no semantic match here";\n');
  write("src/parser.ts", 'import { z } from "zod";\nexport const parse = z;\n');
  write("test/invoice.test.ts", 'import { main } from "../src/app";\nexport const ok = main();\n');
  write("test/zzz-direct.test.ts", 'import { renderInvoice } from "../src/billing/invoice";\nexport const result = renderInvoice();\n');
  write(".env", `needle=${SECRET}\n`);
  for (let i = 0; i < 25; i++) write(`parts/p${i}/leaf.ts`, `export const value${i} = ${i};\n`);
  git("init", "-q", "-b", "main");
  git("add", "-A"); git("commit", "-qm", "initial");
  write("src/legacy.ts", 'export const marker = "no semantic match here!";\n');
  git("add", "-A"); git("commit", "-qm", "fix: invoice pdf integration");
  for (let i = 0; i < 10; i++) {
    write("src/billing/invoice.ts", `/** Render a customer invoice as pdf. */\nexport function renderInvoice() { return "invoice pdf ${i}"; }\n`);
    write("src/app.ts", `import { renderInvoice } from "./billing/invoice";\nexport function main() { return renderInvoice() + "${i}"; }\n`);
    git("add", "-A"); git("commit", "-qm", `fix: invoice integration ${i}`);
  }
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createServer(ws).connect(s); await client.connect(c);
  const opened = await call("open", { path: REPO, watch: false, wait_seconds: 120 });
  expect(opened.project.state).toBe("ready");
}, 120000);
afterAll(async () => { await client.close(); ws.shutdown(); rmSync(TMP, { recursive: true, force: true }); });

test("map_codebase returns multiple levels, summaries and collapsed branches within budget", async () => {
  const result = await call("map_codebase", { depth: 4, token_budget: 12000 });
  expect(result.rows.find((r: any) => r.path === "src").collapsed).toBeGreaterThan(0);
  expect(result.rows[0].symbols.length).toBeGreaterThan(0);
  expect(result.rows.find((r: any) => r.path === "src").entries).toContain("src/app.ts");
  const subtree = await call("map_codebase", { path: "src", min_files: 0, depth: 2 });
  expect(subtree.rows.map((r: any) => r.path)).toContain("src/billing");
  expect(subtree.rows.every((r: any) => r.path.startsWith("src"))).toBe(true);
  const small = await call("map_codebase", { min_files: 0, token_budget: 500 });
  expect(small.budget.omittedRows).toBeGreaterThan(0);
  expect(small.directoryCount).toBeGreaterThan(small.rows.length);
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(2000);
  expect(small.next.tool).toBe("dir");
});

test("locate_code fuses paths, declarations, doc comments, commits and content with directory evidence", async () => {
  const r = await call("locate_code", { query: "invoice pdf", token_budget: 6000 });
  expect(r.files[0].path).toBe("src/billing/invoice.ts");
  expect(r.files[0].matchedTerms).toEqual(expect.arrayContaining(["invoice", "pdf"]));
  expect(r.files[0].evidence.map((e: any) => e.signal)).toEqual(expect.arrayContaining(["path", "symbol", "doc", "content"]));
  expect(r.files.find((f: any) => f.path === "src/legacy.ts").evidence).toContainEqual(expect.objectContaining({ signal: "commit", text: expect.stringContaining("invoice pdf") }));
  expect(r.directories.some((d: any) => d.path === "src/billing")).toBe(true);
  expect(r.content.scanned).toBeGreaterThan(0);
  const scoped = await call("locate_code", { query: "invoice", path: "src/billing", content: false });
  expect(scoped.files.every((f: any) => f.path.startsWith("src/billing/"))).toBe(true);
  expect(scoped.content.searched).toBe(false);
  expect((await call("locate_code", { query: "needle" })).matchedFiles).toBe(0);
});

test("locate_code distinguishes package declarations from verified importers", async () => {
  const r = await call("locate_code", { query: "zod" });
  expect(r.files.find((f: any) => f.path === "src/parser.ts").evidence).toContainEqual(expect.objectContaining({ signal: "package", text: "zod" }));
  expect(r.files.find((f: any) => f.path === "package.json").evidence).toContainEqual(expect.objectContaining({ signal: "package", text: "declares zod" }));
});

test("change_impact joins callers, transitive test candidates, owners and entry warnings", async () => {
  const r = await call("change_impact", { symbols: [{ name: "renderInvoice" }], token_budget: 6000 });
  expect(r.selected.paths).toEqual(["src/billing/invoice.ts"]);
  expect(r.compilerUsers.rows).toContainEqual(expect.objectContaining({ name: "main" }));
  expect(r.dependents.files).toBe(3);
  expect(r.tests.rows).toContainEqual(expect.objectContaining({ path: "test/invoice.test.ts" }));
  expect(r.tests.basis).toContain("not runtime coverage");
  expect(r.owners[0].name).toBe("Ada");
  expect(r.coChange.rows).toContainEqual(expect.objectContaining({ also: "src/app.ts", sharedCommits: 10 }));
  expect((await call("change_impact", { paths: ["src/app.ts"] })).warnings.rows).toContainEqual(expect.objectContaining({ warning: expect.stringContaining("entry point") }));
  const limited = await call("change_impact", { paths: ["src/billing"], depth: 1 });
  expect(limited.dependents.files).toBe(2);
  expect(limited.tests.rows[0].path).toBe("test/zzz-direct.test.ts");
  const firstTest = await call("change_impact", { paths: ["src/billing"], limit: 1 });
  expect(firstTest.tests.rows[0].path).toBe("test/zzz-direct.test.ts");
});

test("bounded answers retain explicit unavailable measurements without compiler or history", async () => {
  const snap = ws.resolve(REPO).snapshot!;
  const report = { ...snap.report, git: undefined };
  expect(mapCodebase(report, undefined).notes.join(" ")).toContain("No compiler");
  expect((await locateCode(report, undefined, { query: "invoice" })).notes.join(" ")).toContain("No git history");
  const impact = changeImpact(report, undefined, { paths: ["src/app.ts"] });
  expect(impact.compilerUsers.count).toBe(0);
  expect(impact.notes.join(" ")).toContain("unavailable");
});

test("first question auto-opens an explicit project and returns a resumable pending state", async () => {
  const fresh = new Workspace(TMP);
  const c = new Client({ name: "first-question", version: "1" });
  const [ce, se] = InMemoryTransport.createLinkedPair();
  await createServer(fresh).connect(se); await c.connect(ce);
  try {
    const r = await c.callTool({ name: "map_codebase", arguments: { project: REPO, wait_seconds: 0 } });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { data: any }).data).toMatchObject({ state: "analyzing", next: { tool: "status", arguments: { project: "project" } } });
    await fresh.resolve(REPO).job!.done;
    const ready = await c.callTool({ name: "map_codebase", arguments: {} });
    expect((ready.structuredContent as { data: any }).data).toHaveProperty("rows");
  } finally { await c.close(); fresh.shutdown(); }
}, 120000);

test("map_codebase prints a tree: every directory right after its parent's earlier children", async () => {
  const rows = (await call("map_codebase", { depth: 4, min_files: 0, token_budget: 12000 })).rows as { path: string; depth: number }[];
  expect(rows[0]!.path).toBe(".");
  const open: string[] = [];
  for (const row of rows.slice(1)) {
    // The nearest earlier row one level up must be this row's own parent.
    open.length = row.depth - 1;
    const parent = open[row.depth - 2];
    if (parent !== undefined) expect(row.path.startsWith(parent + "/")).toBe(true);
    open[row.depth - 1] = row.path;
  }
  expect(rows.map((r) => r.path)).toContain("src/billing");
});

test("locate_code leaves out the subject of a commit that swept the whole tree", async () => {
  // "initial" touched every file; its subject says nothing about any one of them.
  expect((await call("locate_code", { query: "initial", content: false })).matchedFiles).toBe(0);
});

test("an unknown argument is an error that names the real ones, not a silently different question", async () => {
  const r = await client.callTool({ name: "seams", arguments: { project: REPO, path: "src/billing" } });
  expect(r.isError).toBe(true);
  const text = (r.content as { text: string }[])[0]!.text;
  expect(text).toContain('unknown argument "path"');
  expect(text).toContain("this tool takes: project, depth, sort, limit, offset, wait_seconds");
});

test("symbol pages through reference locations", async () => {
  const sites = (r: any) => r.references.byFile.flatMap((f: any) => f.at.map((at: string) => `${f.path}:${at}`));
  const all = await call("symbol", { name: "renderInvoice" });
  const rest = await call("symbol", { name: "renderInvoice", references_offset: 2 });
  expect(all.references.stored).toBeGreaterThan(2);
  expect(rest.references.offset).toBe(2);
  expect(sites(rest)).toEqual(sites(all).slice(2));
  expect(rest.references.nextOffset).toBeUndefined();
});

test("parseHunks reads added, rewritten and removed line ranges per file", () => {
  const diff = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -3 +3,2 @@ ctx", "+x", "+y", "@@ -10,2 +11,0 @@", "-gone", "diff --git a/old.ts b/old.ts", "--- a/old.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a"].join("\n");
  const ranges = parseHunks(diff);
  expect(ranges.get("src/a.ts")).toEqual([[3, 4], [11, 11]]);
  expect(ranges.has("old.ts")).toBe(false);
});

test("change_impact reviews the uncommitted diff: changed declarations, their users, what is missing", async () => {
  const invoice = join(REPO, "src/billing/invoice.ts");
  const before = await Bun.file(invoice).text();
  try {
    // Line 2 is renderInvoice's body: the edit lands inside it, not across the whole file.
    writeFileSync(invoice, before.replace('"invoice pdf 9"', '"invoice pdf 9!"'));
    write("src/billing/fresh.ts", "export const fresh = 1;\n");
    rmSync(join(REPO, "src/legacy.ts"));
    const r = await call("change_impact", { working_tree: true, token_budget: 6000 });
    expect(r.workingTree.changed).toBe(1);
    expect(r.workingTree.changedSymbols.rows.map((s: any) => s.name)).toEqual(["renderInvoice"]);
    expect(r.workingTree.deleted).toEqual(["src/legacy.ts"]);
    // Written after the analysis this project (watch: false) answers from.
    expect(r.workingTree.notAnalyzed).toEqual(["src/billing/fresh.ts"]);
    expect(r.selected.paths).toEqual(["src/billing/invoice.ts"]);
    expect(r.compilerUsers.rows).toContainEqual(expect.objectContaining({ name: "main" }));
    expect(r.tests.rows.map((t: any) => t.path)).toEqual(expect.arrayContaining(["test/zzz-direct.test.ts", "test/invoice.test.ts"]));
    // app.ts changed with invoice.ts in ten commits and is not in this diff.
    expect(r.coChange.rows).toContainEqual(expect.objectContaining({ also: "src/app.ts" }));
    expect(r.notes.join(" ")).toContain("Deleted files are gone from the analysis");
    expect(r.next).toMatchObject({ tool: "symbol", arguments: { impact_depth: 2 } });
  } finally {
    writeFileSync(invoice, before);
    rmSync(join(REPO, "src/billing/fresh.ts"), { force: true });
    git("checkout", "-q", "--", "src/legacy.ts");
  }
  const clean = await client.callTool({ name: "change_impact", arguments: { project: REPO, working_tree: true } });
  expect(clean.isError).toBe(true);
  expect((clean.content as { text: string }[])[0]!.text).toContain("no changes against HEAD");
});

test("a structure question is answered from the first pass while history and the compiler still run", async () => {
  const fresh = new Workspace(TMP, { structureGraceMs: 0 });
  const c = new Client({ name: "staged", version: "1" });
  const [ce, se] = InMemoryTransport.createLinkedPair();
  await createServer(fresh).connect(se); await c.connect(ce);
  try {
    const early = await c.callTool({ name: "map_codebase", arguments: { project: REPO, min_files: 0 } });
    const envelope = early.structuredContent as { data: any; freshnessNote?: string };
    expect(envelope.data.rows.map((r: any) => r.path)).toContain("src/billing");
    expect(envelope.freshnessNote).toContain("answered from the structure pass");
    expect(envelope.data.notes.join(" ")).toContain("No git history");
    const p = fresh.resolve(REPO);
    expect(p.snapshot!.partial).toBe(true);
    expect(p.view()).toMatchObject({ state: "analyzing", partial: expect.stringContaining("Structure pass only") });
    // A symbol question has nothing to read there: for it the analysis is still running.
    const symbols = await c.callTool({ name: "search_symbols", arguments: { wait_seconds: 0 } });
    expect((symbols.structuredContent as { data: any }).data).toMatchObject({ state: "analyzing", next: { tool: "status" } });
    await p.job!.done;
    expect(p.snapshot!.partial).toBeUndefined();
    const whole = await c.callTool({ name: "map_codebase", arguments: {} });
    expect((whole.structuredContent as { freshnessNote?: string }).freshnessNote).toBeUndefined();
    expect((await c.callTool({ name: "search_symbols", arguments: { query: "renderInvoice" } })).isError).toBeFalsy();
  } finally { await c.close(); fresh.shutdown(); }
}, 120000);

test("a project with no slow pass to wait for is analyzed once", async () => {
  const fresh = new Workspace(TMP);
  try {
    const p = await fresh.open(REPO, { options: { git: false, symbols: false }, watch: false });
    expect(p.structure).toBeUndefined();
    await p.job!.done;
    expect(p.snapshot!.partial).toBeUndefined();
  } finally { fresh.shutdown(); }
}, 120000);

test("the benchmark vocabulary names every tool and every argument the server has", async () => {
  // The lists are written out so nothing computed at run time can add to them; this is what
  // keeps them from falling behind the server.
  const { tools } = await client.listTools();
  for (const tool of tools) {
    expect(TOOLS as readonly string[]).toContain(tool.name);
    for (const key of Object.keys((tool.inputSchema as { properties?: object }).properties ?? {})) expect(PARAMS as readonly string[]).toContain(key);
  }
});

test("benchmark writes an anonymous file that includes how this session used the tools", async () => {
  const fresh = new Workspace(TMP);
  const c = new Client({ name: "bench", version: "1" });
  const [ce, se] = InMemoryTransport.createLinkedPair();
  await createServer(fresh).connect(se); await c.connect(ce);
  const out = join(TMP, "bench-out");
  try {
    const ask = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: { project: REPO, ...args } }, { timeout: 120000 });
    await ask("status", { wait_seconds: 60 });
    await ask("locate_code", { query: "invoice pdf" });
    await ask("change_impact", { symbols: [{ name: "renderInvoice" }] });
    // An argument the tool does not take: rejected before any handler, and still counted, once.
    expect((await ask("seams", { path: "src/billing" })).isError).toBe(true);
    expect((await ask("symbol", { name: "noSuchSymbolAnywhere" })).isError).toBe(true);
    const r = await ask("benchmark", { out, wait_seconds: 120 });
    expect(r.isError).toBeFalsy();
    const result = (r.structuredContent as { data: any }).data.result;
    expect(result).toMatchObject({ json: join(out, "benchmark.json"), markdown: join(out, "benchmark.md"), level: "aggregate" });
    expect(existsSync(join(REPO, "benchmark.json"))).toBe(false);
    const json = readFileSync(result.json, "utf8");
    const md = readFileSync(result.markdown, "utf8");
    // Nothing of the project: not its folder, a path, a symbol, an author, a query or a secret.
    for (const leak of [REPO, TMP, "billing", "invoice", "renderInvoice", "noSuchSymbol", "Ada", "example.com", "zod", SECRET]) {
      expect(json).not.toContain(leak);
      expect(md).not.toContain(leak);
    }
    const session = JSON.parse(json).session as { calls: any[]; transitions: any[] };
    const call = (tool: string) => session.calls.find((x) => x.tool === tool);
    expect(call("locate_code").parameters).toContainEqual({ code: "query", value: 1 });
    expect(call("change_impact").errors).toContainEqual({ code: "none", value: 1 });
    expect(call("seams").errors).toEqual([{ code: "invalid_parameters", value: 1 }]);
    expect(call("seams").parameters).toEqual([{ code: "unknown_parameter", value: 1 }]);
    expect(call("symbol").errors).toContainEqual({ code: "query_error", value: 1 });
    expect(session.transitions).toContainEqual({ previous: "locate_code", next: "change_impact", count: 1 });
    expect(md).toContain("| locate_code |");
    // A second run may not replace the first: the folder is the user's to read and share.
    const again = await ask("benchmark", { out });
    expect(again.isError).toBe(true);
    expect((again.content as { text: string }[])[0]!.text).toContain("already exists");
  } finally { await c.close(); fresh.shutdown(); }
}, 180000);

test("a briefing for a named symbol says how many sites it has and where to list them", async () => {
  const r = await call("change_impact", { symbols: [{ name: "renderInvoice" }] });
  const picked = r.selected.symbols[0];
  expect(picked.name).toBe("renderInvoice");
  expect(picked.references).toBeGreaterThan(0);
  expect(picked.inFiles).toBeGreaterThan(0);
  // The briefing counts reach; the sites themselves are one call away.
  expect(r.next).toMatchObject({ tool: "symbol", arguments: { id: picked.id, project: REPO } });
  // Paths alone keep the dependents follow-up.
  expect((await call("change_impact", { paths: ["src/billing"] })).next.tool).toBe("graph");
});

test("map_codebase takes the small asks an agent actually makes: depth 0 and a tiny budget", async () => {
  const one = await call("map_codebase", { path: "src", depth: 0 });
  expect(one.rows.map((r: any) => r.path)).toEqual(["src"]);
  const tiny = await call("map_codebase", { token_budget: 300 });
  expect(tiny.rows.length).toBeGreaterThan(0);
  expect(tiny.directoryCount).toBeGreaterThan(0);
});
