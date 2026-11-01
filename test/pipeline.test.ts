/**
 * End to end: analyzeProject + writeSite over a small git repository built in a temp dir.
 *
 * The fixture has a little of everything the pipeline wires together: TypeScript files that
 * import and call each other (an import cycle, symbols, calls), a test file, Python with a
 * rename in its history, Go, CSS, JSON, Markdown pages that link to each other (link edges
 * that must stay out of the code graph), a PNG (copied as a preview asset) and a committed
 * .env whose contents must never appear in any written file.
 *
 * Git runs under an isolated config and HOME, as in test/git.test.ts, so the developer's
 * signing, hooks and global excludes cannot change what gets committed.
 *
 * Run: bun test test/pipeline.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, type AnalysisResult, type ProgressEvent } from "../src/core/pipeline";
import { isReplaceable, outputPlacement, writeSite } from "../src/core/site";
import { validateReport } from "../src/core/validate";
import { REF_KINDS, SymbolFlag, type Report } from "../src/shared/schema";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "starchart-pipeline-test-")));
const REPO = join(TMP, "demo");
const OUT = join(TMP, "out", "demo.starchart");
const SECRET = "starchart-test-secret-6f1c9e0d7b";

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

function write(path: string, content: string | Uint8Array): void {
  const abs = join(REPO, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function commit(name: string, email: string, date: string, message: string): void {
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

/** A valid 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

let result: AnalysisResult;
let report: Report;
const events: ProgressEvent[] = [];
const id = (path: string) => report.files.findIndex((f) => f.path === path);

beforeAll(async () => {
  mkdirSync(REPO, { recursive: true });
  git(["init", "-q", "-b", "main"]);
  write("README.md", "# Demo Project\n\nA small fixture for the starchart pipeline test.\n\nSee [the guide](docs/guide.md).\n");
  write("docs/guide.md", "# Guide\n\nBack to the [readme](../README.md).\n");
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["src", "tests"] }, null, 2));
  write(
    "src/math.ts",
    'import { log } from "./app";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function twice(x: number): number {\n  log("twice");\n  return add(x, x);\n}\n',
  );
  write(
    "src/app.ts",
    'import { twice } from "./math";\n\nexport function log(message: string): void {\n  console.log(message);\n}\n\nexport function main(): number {\n  // TODO: read the input from argv\n  return twice(21);\n}\n',
  );
  write("tests/math.test.ts", 'import { add } from "../src/math";\n\nif (add(1, 2) !== 3) throw new Error("add is broken");\n');
  write("lib/__init__.py", "from .util import helper\n");
  write("lib/util.py", 'import os\n\n\ndef helper(x):\n    """Join x under a."""\n    if x:\n        return os.path.join("a", x)\n    return None\n');
  write("old_name.py", 'from lib.util import helper\n\nprint(helper("b"))\n');
  write("main.go", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n');
  write("web/style.css", "body {\n  color: red;\n}\n");
  write("data/sample.json", '{\n  "a": 1,\n  "b": [1, 2, 3]\n}\n');
  write(".env", `API_TOKEN=${SECRET}\n`);
  write("assets/logo.png", PNG);
  commit("Alice Liddell", "alice@example.com", "2024-01-01T09:00:00Z", "feat: initial import");

  git(["mv", "old_name.py", "lib/renamed.py"]);
  write("lib/renamed.py", 'from lib.util import helper\n\nprint(helper("b"))\nprint(helper("c"))\n');
  commit("Alice Liddell", "alice@example.com", "2024-02-01T09:00:00Z", "refactor: move the script into lib");

  write(
    "src/app.ts",
    'import { twice } from "./math";\n\nexport function log(message: string): void {\n  console.log(`[demo] ${message}`);\n}\n\nexport function main(): number {\n  // TODO: read the input from argv\n  return twice(21);\n}\n',
  );
  commit("Bob Builder", "bob@example.com", "2024-03-01T09:00:00Z", "fix(app): prefix log lines");

  result = await analyzeProject(REPO, { workers: 2 }, (e) => events.push(e));
  report = result.report;
  await writeSite(result, OUT);
}, 120_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function loadData<T>(file: string): T {
  const text = readFileSync(file, "utf8");
  const m = /^window\.__starchart\.resolve\("([^"]+)", ([\s\S]*)\);\n$/.exec(text);
  if (!m) throw new Error(`${file} is not a data script`);
  return JSON.parse(m[2]!) as T;
}

describe("report integrity", () => {
  test("validateReport finds nothing wrong", () => {
    expect(validateReport(report, result.symbols)).toEqual([]);
  });

  test("the report written to disk round-trips and still validates", () => {
    const fromDisk = loadData<Report>(join(OUT, "data/report.js"));
    expect(fromDisk.files.length).toBe(report.files.length);
    expect(validateReport(fromDisk, loadData(join(OUT, "data/symbols.js")))).toEqual([]);
  });

  test("every walked file is in the report, ids in path order", () => {
    const paths = report.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain("lib/renamed.py");
    expect(paths).not.toContain("old_name.py");
  });

  test("project facts come from the README", () => {
    expect(report.project.name).toBe("Demo Project");
    expect(report.project.readme).toBe("README.md");
    expect(report.project.description).toContain("small fixture");
    expect(report.project.root).toBe(REPO);
    expect(report.dirs[0]!.name).toBe("Demo Project");
  });

  test("timings cover every phase", () => {
    for (const phase of ["walk", "detect", "files", "imports", "graph", "layout", "git", "typescript", "stats", "findings", "total", "write"]) {
      expect(report.timings[phase]).toBeGreaterThanOrEqual(0);
    }
    expect(events.some((e) => e.phase === "files" && e.status === "update" && e.done === e.total)).toBe(true);
  });
});

describe("secrets", () => {
  test("the .env is flagged, measured, and neither embedded nor hashed", () => {
    const env = report.files[id(".env")]!;
    expect(env.secret).toBe(true);
    expect(env.lines).toBe(1);
    expect(env.src).toBe(-1);
    expect(env.hash).toBe("");
    expect(result.sources.has(env.id)).toBe(false);
  });

  test("no written file contains the .env contents", () => {
    const files = walkFiles(OUT);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, "utf8").includes(SECRET)).toBe(false);
  });

  test("a finding lists the credential-like file by path", () => {
    const f = report.findings.find((x) => x.id === "secret-files");
    expect(f?.files).toEqual([id(".env")]);
    expect(f?.severity).toBe("warning"); // committed to history
  });
});

describe("imports and graph", () => {
  test("the two TypeScript files import each other and form a cycle", () => {
    const app = id("src/app.ts");
    const math = id("src/math.ts");
    const pairs = report.edges.from.map((f, i) => `${f}>${report.edges.to[i]}:${report.edges.kind[i]}`);
    expect(pairs).toContain(`${app}>${math}:import`);
    expect(pairs).toContain(`${math}>${app}:import`);
    expect(report.files[app]!.cycle).toBeGreaterThanOrEqual(0);
    expect(report.files[app]!.cycle).toBe(report.files[math]!.cycle);
  });

  test("Markdown links are edges but stay out of the code graph", () => {
    const readme = id("README.md");
    const guide = id("docs/guide.md");
    const kinds = report.edges.from.flatMap((f, i) => (f === readme && report.edges.to[i] === guide ? [report.edges.kind[i]] : []));
    expect(kinds).toEqual(["link"]);
    expect(report.files[readme]!.cycle).toBe(-1);
    expect(report.files[readme]!.fanIn).toBe(0);
    expect(report.graph.cycles.length).toBe(1);
  });

  test("a file's import count leaves out its doc links, so the counts add up to the graph's", () => {
    expect(report.files[id("README.md")]!.imports).toBe(0); //   one link, no imports
    expect(report.files[id("docs/guide.md")]!.imports).toBe(0);
    expect(report.files[id("src/app.ts")]!.imports).toBe(1);
    const sum = report.files.reduce((s, f) => s + f.imports, 0);
    expect(sum).toBe(report.graph.resolved + report.graph.external + report.graph.unresolved);
  });

  test("externals merge import-only packages", () => {
    const names = report.externals.map((e) => `${e.ecosystem}:${e.name}`);
    expect(names.some((n) => n.endsWith(":fmt"))).toBe(true);
    expect(names.some((n) => n.endsWith(":os"))).toBe(true);
  });
});

describe("git", () => {
  test("history follows the rename", () => {
    const renamed = report.files[id("lib/renamed.py")]!;
    expect(renamed.git?.commits).toBe(2);
    expect(report.git?.analyzedCommits).toBe(3);
  });

  test("directory churn counts each commit once", () => {
    expect(report.dirs[0]!.commits).toBe(3);
    const src = report.dirs.find((d) => d.path === "src")!;
    expect(src.commits).toBe(2); // the initial import and Bob's fix
  });

  test("three commits are too few for hotspots: every score stays 0, and a warning says why", () => {
    expect(report.files.every((f) => f.hotspot === 0)).toBe(true);
    expect(report.warnings.some((w) => w.startsWith("Hotspot scores are all 0: 3 commits"))).toBe(true);
    expect(report.findings.some((f) => f.id === "top-hotspots")).toBe(false);
  });

  test("with ten or more commits, hotspots are normalized over code files only", async () => {
    const repo = join(TMP, "history");
    const run = (args: string[], env: Record<string, string> = {}) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: repo, env: { ...ISOLATED, ...env }, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
    };
    mkdirSync(repo, { recursive: true });
    run(["init", "-q", "-b", "main"]);
    for (let i = 0; i < 10; i++) {
      // hot.ts changes every commit and branches; calm.ts is written once; the README changes
      // every commit but is prose, so it must stay at 0 however much it churns.
      writeFileSync(join(repo, "hot.ts"), `export function f(x: number) {\n${"  if (x > 0) x--;\n".repeat(i + 1)}  return x;\n}\n`);
      if (i === 0) writeFileSync(join(repo, "calm.ts"), "export const calm = 1;\n");
      writeFileSync(join(repo, "README.md"), `# History\n\nRevision ${i}.\n`);
      run(["add", "-A"]);
      const date = `2024-01-${String(i + 1).padStart(2, "0")}T09:00:00Z`;
      run(["commit", "-q", "-m", `rev ${i}`], { GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@example.com", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@example.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    }
    const r = (await analyzeProject(repo, { workers: 1, symbols: false, source: false })).report;
    const file = (p: string) => r.files.find((f) => f.path === p)!;
    expect(r.git?.analyzedCommits).toBe(10);
    expect(file("hot.ts").hotspot).toBe(1);
    expect(file("calm.ts").hotspot).toBeGreaterThan(0);
    expect(file("calm.ts").hotspot).toBeLessThan(1);
    expect(file("README.md").hotspot).toBe(0);
    expect(r.warnings.some((w) => w.startsWith("Hotspot scores"))).toBe(false);
    expect(validateReport(r)).toEqual([]);
  }, 60_000);
});

describe("code intelligence", () => {
  test("symbols exist for the TypeScript functions", () => {
    const s = result.symbols!.symbols;
    for (const name of ["add", "twice", "log", "main"]) {
      const i = s.name.indexOf(name);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(s.kind[i]).toBe("function");
    }
    expect(report.symbols?.url).toBe("data/symbols.js");
  });

  test("calls connect the functions across both files", () => {
    const { symbols: s, calls } = result.symbols!;
    const sym = (name: string) => s.name.indexOf(name);
    const call = REF_KINDS.indexOf("call");
    const has = (from: string, to: string) =>
      calls.from.some((f, i) => f === sym(from) && calls.to[i] === sym(to) && calls.kind[i] === call);
    expect(has("main", "twice")).toBe(true); // app.ts → math.ts
    expect(has("twice", "add")).toBe(true); //  within math.ts
    expect(has("twice", "log")).toBe(true); //  math.ts → app.ts
  });

  test("the demo has installed nothing to miss and no component files: no caveats", () => {
    expect(result.symbols!.stats.uninstalledManifests).toBeUndefined();
    expect(result.symbols!.stats.hostFiles).toBeUndefined();
    expect(result.symbols!.hostUses).toBeUndefined();
  });

  test("exports used only from Vue components and VitePress pages are not reported unused", async () => {
    // vite's useSponsor was "Exported, but nothing outside sponsor.ts uses it" while two Vue
    // components and a docs page import it: the compiler reads none of those files.
    const dir = join(TMP, "hosts");
    const put = (path: string, text: string) => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    put("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler" }, include: ["src"] }));
    put("package.json", JSON.stringify({ name: "hosts", dependencies: { "some-ui-kit": "^1.0.0" } }));
    put("src/composables/sponsor.ts", "export function useSponsor() {\n  return 1;\n}\n\nexport function onlyInASample() {\n  return 2;\n}\n");
    put("src/helper.ts", "export function helper() {\n  return 3;\n}\n");
    put("src/barrel.ts", 'export { helper } from "./helper";\n');
    put("src/everything.ts", "export const one = 1;\nexport const two = 2;\n");
    // Many names from an uninstalled package: what a fresh clone looks like to the checker.
    put("src/kit.ts", `import kit from "some-ui-kit";\n\n${Array.from({ length: 30 }, (_, i) => `export const k${i} = kit.make${i}(kit.opt${i});`).join("\n")}\n`);
    put(
      "components/Aside.vue",
      '<template><p>{{ data }}</p></template>\n<script setup lang="ts">\nimport { useSponsor } from "../src/composables/sponsor"\nimport { helper } from "../src/barrel"\nimport * as all from "../src/everything"\nconst data = useSponsor() + helper() + all.one\n</script>\n',
    );
    put(
      "docs/thanks.md",
      '# Thanks\n\n<script setup>\nimport { useSponsor } from "../src/composables/sponsor"\n</script>\n\n```vue\n<script setup>\nimport { onlyInASample } from "../src/composables/sponsor"\n</script>\n```\n',
    );
    const r = await analyzeProject(dir, { workers: 1, git: false, source: false });
    const s = r.symbols!;
    const t = s.symbols;
    const sym = (name: string) => t.name.indexOf(name);
    const unused = (name: string) => (t.flags[sym(name)]! & SymbolFlag.unusedExport) !== 0;
    expect(unused("useSponsor")).toBe(false);
    expect(unused("helper")).toBe(false); //   through the barrel's re-export
    expect(unused("one")).toBe(false); //      a namespace import takes every export
    expect(unused("two")).toBe(false);
    expect(unused("onlyInASample")).toBe(true); // imported only inside a fenced sample
    expect(s.stats.unusedExports).toBe(t.flags.filter((f) => f & SymbolFlag.unusedExport).length);
    expect(s.stats.hostFiles).toBe(2);
    const path = (f: number) => r.report.files[f]!.path;
    const rows = s.hostUses!.symbol.map((x, i) => `${t.name[x]} ← ${path(s.hostUses!.file[i]!)}:${s.hostUses!.line[i]}`);
    // By symbol (declaration order: sponsor.ts, everything.ts, helper.ts), then importing file.
    expect(rows).toEqual(["useSponsor ← components/Aside.vue:2", "useSponsor ← docs/thanks.md:3", "one ← components/Aside.vue:4", "two ← components/Aside.vue:4", "helper ← components/Aside.vue:3"]);
    // Not references: the checker's counts stay what the checker resolved.
    expect(t.refs[sym("useSponsor")]).toBe(0);
    // The page's import is a real dependency of the page, so it is an edge.
    const thanks = r.report.files.findIndex((f) => f.path === "docs/thanks.md");
    const sponsor = r.report.files.findIndex((f) => f.path === "src/composables/sponsor.ts");
    expect(r.report.edges.from.some((f, i) => f === thanks && r.report.edges.to[i] === sponsor && r.report.edges.kind[i] === "import")).toBe(true);

    // Nothing installed for package.json, and it shows: the counts say so, in a warning.
    expect(s.stats.uninstalledManifests).toBe(1);
    expect(r.report.warnings.some((w) => w.startsWith("Dependencies are not installed (1 package.json without node_modules)"))).toBe(true);
    expect(validateReport(r.report, s)).toEqual([]);

    // Installed (an empty node_modules is enough to say someone ran the installer): no caveat.
    mkdirSync(join(dir, "node_modules"));
    const installed = await analyzeProject(dir, { workers: 1, git: false, source: false });
    expect(installed.symbols!.stats.uninstalledManifests).toBeUndefined();
    expect(installed.report.warnings.some((w) => w.startsWith("Dependencies are not installed"))).toBe(false);
  }, 60_000);
});

describe("site", () => {
  test("data files are classic scripts the viewer can load over file://", () => {
    for (const f of ["data/report.js", "data/symbols.js", "data/source/0000.js"]) {
      expect(readFileSync(join(OUT, f), "utf8").startsWith("window.__starchart.resolve(")).toBe(true);
    }
    expect(existsSync(join(OUT, "index.html"))).toBe(true);
    expect(existsSync(join(OUT, "data/report.json"))).toBe(false);
  });

  test("the viewer is copied without its source maps, and nothing points at one", () => {
    // dist/viewer keeps app.js.map for development; a report folder must not carry it (7.5 MB
    // of viewer sources in every report) or a trailer naming a file it does not have.
    const assets = walkFiles(join(OUT, "assets"));
    expect(assets.some((p) => p.endsWith("app.js"))).toBe(true);
    expect(assets.filter((p) => p.endsWith(".map"))).toEqual([]);
    for (const p of assets.filter((p) => p.endsWith(".js") || p.endsWith(".css"))) {
      expect(readFileSync(p, "utf8")).not.toMatch(/sourceMappingURL=\S*\.map/);
    }
  });

  test("source is embedded by chunk and the reader can find it", () => {
    const math = report.files[id("src/math.ts")]!;
    expect(math.src).toBe(0);
    const chunk = loadData<{ chunk: number; files: Record<string, string> }>(join(OUT, report.source!.chunks[0]!));
    expect(chunk.files[String(math.id)]).toContain("export function twice");
    expect(report.source!.skipped.binary).toBe(1);
    expect(report.source!.skipped.disabled).toBe(1); // the .env
  });

  test("the image is copied as a preview asset", () => {
    const logo = report.files[id("assets/logo.png")]!;
    expect(logo.asset).toBe(`data/assets/${logo.id}.png`);
    expect(statSync(join(OUT, logo.asset!)).size).toBe(PNG.length);
    expect(logo.facts?.width).toBe(1);
  });

  test("rewriting replaces the previous report and leaves no staging folders", async () => {
    await writeSite(result, OUT, { json: true });
    expect(existsSync(join(OUT, "data/report.json"))).toBe(true);
    const siblings = readdirSync(join(OUT, ".."));
    expect(siblings).toEqual(["demo.starchart"]);
  });

  test("refuses to replace a folder that is not a report", async () => {
    const other = join(TMP, "not-a-report");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "notes.txt"), "keep me");
    await expect(writeSite(result, other)).rejects.toThrow(/not a starchart report/);
    expect(readFileSync(join(other, "notes.txt"), "utf8")).toBe("keep me");
  });

  test("a data/report.js of a project's own is not a report marker", async () => {
    // The shape that used to be deleted: any folder with a data/report.js counted as a report.
    const victim = join(TMP, "victim");
    mkdirSync(join(victim, "data"), { recursive: true });
    mkdirSync(join(victim, "src"), { recursive: true });
    writeFileSync(join(victim, "data", "report.js"), "export const report = {};\n");
    writeFileSync(join(victim, "src", "important.txt"), "keep me");
    await expect(writeSite(result, victim)).rejects.toThrow(/not a starchart report/);
    expect(readFileSync(join(victim, "src", "important.txt"), "utf8")).toBe("keep me");
    expect(isReplaceable(victim)).toBe(false);
  });

  test("a real report with anything extra at its top level is not replaced", async () => {
    const copy = join(TMP, "report-plus");
    cpSync(OUT, copy, { recursive: true });
    expect(isReplaceable(copy)).toBe(true); // the markers of a real report are all recognized
    writeFileSync(join(copy, "notes.md"), "mine");
    expect(isReplaceable(copy)).toBe(false);
    rmSync(join(copy, "notes.md"));
    writeFileSync(join(copy, "data", "report.js"), "// hand-written\n");
    expect(isReplaceable(copy)).toBe(false);
  });

  test("refuses to write over the analyzed project or a folder that holds it", async () => {
    expect(result.root).toBe(REPO);
    await expect(writeSite(result, REPO)).rejects.toThrow(/is the project being analyzed/);
    await expect(writeSite(result, TMP)).rejects.toThrow(/contains the project being analyzed/);
    expect(existsSync(join(REPO, "src", "app.ts"))).toBe(true);
    // A new folder inside the project is fine: that is where `starchart .` writes by default.
    expect(outputPlacement(join(REPO, "fresh.starchart"), REPO)).toBe("inside");
  });

  test("an output path under a file fails in one line, naming the file", async () => {
    const file = join(TMP, "plain-file");
    writeFileSync(file, "x");
    await expect(writeSite(result, join(file, "deeper", "out"))).rejects.toThrow(`output path is inside a file: ${file}`);
  });
});

describe("options", () => {
  test("--no-source, --no-git and --no-symbols leave their sections out", async () => {
    const r = await analyzeProject(REPO, { workers: 1, source: false, git: false, symbols: false, redactPaths: true });
    expect(r.report.source).toBeUndefined();
    expect(r.report.git).toBeUndefined();
    expect(r.report.symbols).toBeUndefined();
    expect(r.report.project.root).toBeUndefined();
    expect(r.report.files.every((f) => f.src === -1 && f.asset === undefined && f.git === undefined)).toBe(true);
    expect(r.sources.size).toBe(0);
    expect(validateReport(r.report)).toEqual([]);
  }, 60_000);

  test("--redact-paths scrubs the root from every string, including a git failure's warning", async () => {
    // A repository whose older tree object is missing: git log fails, and git's error names
    // the directory it ran in, which used to reach report.warnings verbatim.
    const repo = join(TMP, "corrupt");
    const run = (args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: repo, env: { ...ISOLATED, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@example.com", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@example.com" }, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
      return r.stdout.toString().trim();
    };
    mkdirSync(repo, { recursive: true });
    // The path as macOS's tmpdir() spells it (/var/...) and as realpath does (/private/var/...):
    // tools print whichever they were handed, so both must go.
    const spellings = [repo, repo.replace(/^\/private\//, "/")];
    writeFileSync(join(repo, "README.md"), `# Corrupt\n\nBuilt in ${spellings.at(-1)}/build on this machine.\n`);
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    run(["init", "-q", "-b", "main"]);
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "one"]);
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    run(["commit", "-q", "-am", "two"]);
    const tree = run(["rev-parse", "HEAD~1^{tree}"]);
    rmSync(join(repo, ".git", "objects", tree.slice(0, 2), tree.slice(2)));

    const r = await analyzeProject(repo, { workers: 1, symbols: false, redactPaths: true });
    expect(r.report.project.root).toBeUndefined();
    // Whatever the git module makes of the damage, it says so in a warning.
    expect(r.report.warnings.some((w) => /git/i.test(w))).toBe(true);
    const text = JSON.stringify(r.report);
    for (const s of spellings) expect(text.includes(s)).toBe(false);
    expect(r.report.project.description).toContain("<project>/build");
    // Never written out, so it keeps the real root for the site writer's checks.
    expect(r.root).toBe(repo);
  }, 60_000);

  test("duplicate sets are ranked by bytes repeated, and the finding counts every set", async () => {
    const dir = join(TMP, "dups");
    mkdirSync(dir, { recursive: true });
    // 210 sets of tiny copies would fill the 200-set cap if sets were ranked by copy count.
    for (let g = 0; g < 210; g++) for (let c = 0; c < 3; c++) writeFileSync(join(dir, `tiny-${g}-${c}.txt`), `t${String(g).padStart(6, "0")}`);
    // Sizes differ by a byte so the costliest set is big-4, not whichever pair hashes first.
    for (let g = 0; g < 5; g++) for (let c = 0; c < 2; c++) writeFileSync(join(dir, `big-${g}-${c}.txt`), `${g}`.repeat(48_001 + g));
    for (let g = 0; g < 201; g++) for (let c = 0; c < 2; c++) writeFileSync(join(dir, `mid-${g}-${c}.txt`), `${String(g).padStart(4, "0")}`.repeat(75));
    const r = (await analyzeProject(dir, { workers: 2, git: false, symbols: false, source: false })).report;
    const dups = r.stats.duplicates;
    expect(dups.length).toBe(200);
    expect(dups.slice(0, 5).map((d) => d.bytes)).toEqual([48_005, 48_004, 48_003, 48_002, 48_001]);
    expect(dups.slice(5).every((d) => d.bytes === 300)).toBe(true);
    const finding = r.findings.find((f) => f.id === "duplicate-files")!;
    // 5 big pairs and all 201 mid pairs, though only 195 of those survive the cap.
    expect(finding.title).toStartWith("206 sets of identical files (412 copies, ");
    expect(finding.metric?.value).toBe(5 * 48_001 + 10 + 201 * 300);
    expect(finding.files?.map((f) => r.files[f]!.path).sort()).toEqual(["big-4-0.txt", "big-4-1.txt"]);
    expect(validateReport(r)).toEqual([]);
  }, 60_000);

  test("palette slots go to the seven largest languages by code lines, whatever their type", async () => {
    // The shape of the bug: a TypeScript app whose second-largest language is its Markdown
    // docs, then JSON. Slots used to go to programming and markup first, so a 2-line HTML page
    // and a 1-line script were named in the key while the docs and data folded into Other.
    // Ranked over what the viewer shows by default, which counts lockfiles but hides vendored
    // code, so the tray's largest languages are always the colored ones.
    const dir = join(TMP, "slots");
    const lines = (n: number, line: string) => Array.from({ length: n }, (_, i) => line.replace("#", String(i))).join("\n") + "\n";
    const files: Record<string, string> = {
      "src/app.ts": lines(120, "export const v# = #;"),
      "docs/guide.md": lines(90, "Paragraph # of the guide."),
      "data/rows.json": "[\n" + lines(70, '  { "id": # },').replace(/,\n$/, "\n") + "]\n",
      // A lockfile: the tray counts its lines, so YAML is what this project shows 60 of.
      "pnpm-lock.yaml": lines(60, "key#: value"),
      "cmd/main.go": "package main\n\n" + lines(8, "var V# = #"),
      "tools/run.py": lines(6, "x# = #"),
      "web/site.css": lines(5, ".c# { color: blue; }"),
      "web/index.html": "<!doctype html>\n<p>hi</p>\n",
      "bin/go.sh": "#!/bin/sh\necho hi\n",
      // Vendored: the largest language here, but hidden until asked for, so no color.
      "vendor/legacy/big.rb": lines(500, "V# = #"),
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const r = (await analyzeProject(dir, { workers: 1, git: false, symbols: false, source: false })).report;
    const slot = (id: string) => r.languages.find((l) => l.id === id)?.slot;
    const named = r.languages.filter((l) => l.slot >= 0).sort((a, b) => a.slot - b.slot).map((l) => l.id);
    expect(named).toEqual(["typescript", "markdown", "json", "yaml", "go", "python", "css"]);
    expect(slot("html")).toBe(-1);
    expect(slot("shell")).toBe(-1);
    expect(r.files.find((f) => f.path === "vendor/legacy/big.rb")?.vendored).toBe(true);
    expect(slot("ruby")).toBe(-1);
    expect(r.files.find((f) => f.path === "pnpm-lock.yaml")?.category).toBe("lockfile");
    expect(validateReport(r)).toEqual([]);
  }, 60_000);

  test("layout is deterministic across runs", async () => {
    const r = await analyzeProject(REPO, { workers: 1, git: false, symbols: false });
    expect(r.report.layout).toEqual(report.layout);
  }, 60_000);

  test("files over the read cap are line-counted and reported", async () => {
    const r = await analyzeProject(REPO, { workers: 1, git: false, symbols: false, maxReadBytes: 64 });
    const math = r.report.files.find((f) => f.path === "src/math.ts")!;
    expect(math.lines).toBe(10);
    expect(math.code + math.comment + math.blank).toBe(math.lines);
    expect(math.imports).toBe(0);
    expect(r.report.warnings.some((w) => w.includes("line-counted but not measured"))).toBe(true);
    expect(validateReport(r.report)).toEqual([]);
  }, 60_000);
});
