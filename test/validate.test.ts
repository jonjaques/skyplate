/**
 * validateReport: each rule catches the corruption it exists for, and a sound report passes.
 *
 * The base report comes from analyzing a small plain directory (no git, no TypeScript), then
 * each test breaks one invariant on a deep copy and checks the error names it.
 *
 * Run: bun test test/validate.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject } from "../src/core/pipeline";
import { validateReport } from "../src/core/validate";
import type { CodeSymbols, Report } from "../src/shared/schema";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "starchart-validate-test-")));
let base: Report;

beforeAll(async () => {
  const files: Record<string, string> = {
    "a.ts": 'import { b } from "./lib/b";\nexport const a = () => b() + 1;\n',
    "lib/b.ts": 'import { c } from "./c";\nexport function b() {\n  return c();\n}\n',
    "lib/c.ts": "// the leaf\nexport function c() {\n  return 2;\n}\n",
    "lib/c.copy.ts": "// the leaf\nexport function c() {\n  return 2;\n}\n",
    "README.md": "# Fixture\n\nThree files in a chain.\n",
    "style.css": "a { color: blue; }\n",
  };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(TMP, p, ".."), { recursive: true });
    writeFileSync(join(TMP, p), text);
  }
  base = (await analyzeProject(TMP, { workers: 1, git: false, symbols: false })).report;
}, 60_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const copy = (): Report => structuredClone(base);
const errorsOf = (mutate: (r: Report) => void): string[] => {
  const r = copy();
  mutate(r);
  return validateReport(r);
};

describe("validateReport", () => {
  test("a fresh report is sound", () => {
    expect(validateReport(base)).toEqual([]);
    expect(base.edges.from.length).toBe(2);
  });

  test("line counts must add up", () => {
    const errs = errorsOf((r) => r.files[0]!.code++);
    expect(errs.some((e) => e.includes("code+comment+blank"))).toBe(true);
    expect(errs.some((e) => e.startsWith("totals.code"))).toBe(true);
  });

  test("directory totals must equal the sum of their files", () => {
    expect(errorsOf((r) => r.dirs[1]!.totalLines++).some((e) => e.includes("totals"))).toBe(true);
  });

  test("NaN and Infinity are refused anywhere", () => {
    expect(errorsOf((r) => (r.layout.graph[4] = Number.NaN)).some((e) => e.includes("non-finite number NaN at report.layout.graph[4]"))).toBe(true);
    expect(errorsOf((r) => (r.stats.linesPerFile.mean = Infinity)).some((e) => e.includes("non-finite"))).toBe(true);
  });

  test("the layout must match the file count and carry a radius", () => {
    expect(errorsOf((r) => r.layout.graph.pop()).some((e) => e.includes("layout.graph"))).toBe(true);
    expect(errorsOf((r) => (r.layout.radius = -1)).some((e) => e.includes("layout.radius"))).toBe(true);
  });

  test("edges must be in range, non-self and distinct", () => {
    expect(errorsOf((r) => (r.edges.to[0] = r.files.length)).some((e) => e.includes("out of range"))).toBe(true);
    expect(errorsOf((r) => (r.edges.to[0] = r.edges.from[0]!)).some((e) => e.includes("self-edge"))).toBe(true);
    const dup = errorsOf((r) => {
      r.edges.from.push(r.edges.from[0]!);
      r.edges.to.push(r.edges.to[0]!);
      r.edges.kind.push("import");
    });
    expect(dup.some((e) => e.includes("duplicate"))).toBe(true);
  });

  test("language slots must be unique and within 0-6", () => {
    const twice = errorsOf((r) => {
      const [x, y] = r.languages;
      x!.slot = 0;
      y!.slot = 0;
    });
    expect(twice.some((e) => e.includes("slot 0 assigned twice"))).toBe(true);
    expect(errorsOf((r) => (r.languages[0]!.slot = 7)).some((e) => e.includes("outside -1..6"))).toBe(true);
  });

  test("language and category totals must equal their files", () => {
    expect(errorsOf((r) => r.languages[0]!.bytes++).some((e) => e.includes("totals differ"))).toBe(true);
    expect(errorsOf((r) => r.categories[0]!.files++).some((e) => e.includes("category"))).toBe(true);
  });

  test("files must belong to exactly the directory they name", () => {
    expect(errorsOf((r) => r.dirs[0]!.files.pop()).some((e) => e.includes("in no directory"))).toBe(true);
    expect(errorsOf((r) => (r.files[0]!.dir = 99)).some((e) => e.includes("out of range"))).toBe(true);
  });

  test("the commit table must be newest first, with author ids in range", () => {
    const withGit = errorsOf((r) => {
      r.git = {
        branch: "main",
        head: "abc",
        totalCommits: 2,
        analyzedCommits: 2,
        truncated: false,
        shallow: false,
        first: 1,
        last: 2,
        authors: [{ id: 0, name: "A", email: "a@x", commits: 2, added: 0, deleted: 0, first: 1, last: 2, owned: 0, bot: false }],
        commits: { hash: ["a", "b"], time: [1, 2], author: [0, 3], added: [0, 0], deleted: [0, 0], files: [[0], []], subject: ["x", "y"], type: ["", ""] },
        weekly: [],
        punchcard: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        growth: [],
        languageChurn: { months: [], series: {} },
        coupling: [],
        truckFactor: { value: 0, authors: [] },
      };
    });
    expect(withGit.some((e) => e.includes("newest first"))).toBe(true);
    expect(withGit.some((e) => e.includes("commits.author[1] 3 out of range"))).toBe(true);
  });

  test("symbol tables: fileRefStart must be files + 1 long and monotone", () => {
    const n = base.files.length;
    const symbols: CodeSymbols = {
      engine: { name: "typescript", version: "7" },
      projects: [],
      symbols: { name: ["f"], kind: ["function"], file: [0], line: [0], col: [0], endLine: [0], parent: [-1], flags: [0], signature: [""], doc: [""], complexity: [1], params: [0], refs: [1], callers: [1], files: [1] },
      refs: { symbol: [0], file: [1], line: [0], col: [0], len: [1], kind: [2], from: [0] },
      calls: { from: [0], to: [0], kind: [2], count: [1] },
      fileRefStart: [0, 0, ...new Array(n - 1).fill(1)],
      moduleSymbol: new Array(n).fill(-1),
      stats: { files: 1, symbols: 1, references: 1, unresolved: 0, unusedExports: 0, truncated: 0, ms: 0 },
    };
    expect(validateReport(base, symbols)).toEqual([]);
    const short = { ...symbols, fileRefStart: symbols.fileRefStart.slice(1) };
    expect(validateReport(base, short).some((e) => e.includes("fileRefStart has"))).toBe(true);
    const bumpy = { ...symbols, fileRefStart: [0, 1, 0, ...new Array(n - 2).fill(1)] };
    expect(validateReport(base, bumpy).some((e) => e.includes("decreases"))).toBe(true);
    const wrongFile = { ...symbols, refs: { ...symbols.refs, symbol: [5] } };
    expect(validateReport(base, wrongFile).some((e) => e.includes("refs.symbol[0] 5 out of range"))).toBe(true);
  });

  test("per-file import counts must add up to the graph's statement totals", () => {
    expect(base.files.reduce((s, f) => s + f.imports, 0)).toBe(2);
    expect(errorsOf((r) => r.files[0]!.imports++).some((e) => e.includes("imports sum to 3"))).toBe(true);
  });

  test("a hotspot needs git data behind it", () => {
    expect(errorsOf((r) => (r.files[0]!.hotspot = 0.5)).some((e) => e.includes("hotspot 0.5 but no git data"))).toBe(true);
  });

  test("duplicate sets must hold two or more files that share the set's hash", () => {
    expect(base.stats.duplicates.length).toBe(1); // lib/c.ts and lib/c.copy.ts
    expect(errorsOf((r) => r.stats.duplicates[0]!.files.pop()).some((e) => e.includes("needs two"))).toBe(true);
    expect(errorsOf((r) => (r.stats.duplicates[0]!.hash = "0000")).some((e) => e.includes("hash or size differs"))).toBe(true);
    expect(errorsOf((r) => r.stats.duplicates[0]!.files.push(99)).some((e) => e.includes("out of range"))).toBe(true);
  });

  test("a systematic bug is summarized, not repeated per row", () => {
    const errs = errorsOf((r) => r.files.forEach((f) => (f.lines += 1)));
    expect(errs.filter((e) => e.includes("code+comment+blank")).length).toBe(5);
    expect(errs.some((e) => e.includes("further errors suppressed"))).toBe(true);
  });
});
