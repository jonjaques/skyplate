import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  checkBenchmarkOut,
  renderMarkdown,
  runBenchmark,
  ToolRecorder,
  validateBenchmark,
  validateVocabulary,
  writeBenchmark,
  type Benchmark,
} from "../src/core/bench";
import { coarse, safeFailure } from "../src/core/bench/privacy";
import { AnalysisDiagnostics, specifierShape } from "../src/core/bench/diagnostics";
import { WorkerPool } from "../src/core/pool";
import { parseCommand } from "../src/cli/args";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-bench-test-")));
const tokens = Array.from({ length: 24 }, () => "CNY_" + randomUUID().replaceAll("-", ""));
const root = join(temp, tokens[0]!);
const sub = tokens[1]!;
const config = `tsconfig.${tokens[2]}.json`;
const unreadable = join(root, sub, `${tokens[3]}.ts`);
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: tokens[4],
  GIT_AUTHOR_EMAIL: `${tokens[5]}@example.invalid`,
  GIT_COMMITTER_NAME: tokens[4],
  GIT_COMMITTER_EMAIL: `${tokens[5]}@example.invalid`,
};
function git(...args: string[]): void {
  const proc = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode) throw new Error(proc.stderr.toString());
}
let normal: Benchmark;
function assertPrivate(b: Benchmark): void {
  validateBenchmark(b);
  validateVocabulary(b);
  const json = JSON.stringify(b),
    md = renderMarkdown(b);
  for (const token of tokens) {
    expect(json).not.toContain(token);
    expect(md).not.toContain(token);
  }
  expect(json).not.toContain(root);
  expect(md).not.toContain(root);
}
beforeAll(async () => {
  mkdirSync(join(root, sub), { recursive: true });
  writeFileSync(join(root, sub, `${tokens[6]}.ts`), `export function ${tokens[7]}() { return "${tokens[8]}"; }\n`);
  writeFileSync(unreadable, `import { ${tokens[7]} } from "./${tokens[6]}";\nimport "./${tokens[9]}";\nexport const ${tokens[10]} = ${tokens[7]}();\n`);
  writeFileSync(join(root, `.${tokens[11]}`), `${tokens[12]}\n`);
  writeFileSync(join(root, `.env.${tokens[13]}`), `${tokens[14]}=${tokens[15]}\n`);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: tokens[16], dependencies: { [tokens[17]!]: "1.0.0" } }));
  writeFileSync(join(root, config), JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "bundler" }, include: [sub] }));
  git("init", "-q", "-b", tokens[18]!);
  git("add", "-A");
  git("commit", "-qm", tokens[19]!);
  git("remote", "add", "origin", `https://${tokens[9]}.invalid/${tokens[10]}/${tokens[11]}`);
  git("tag", tokens[20]!);
  writeFileSync(join(root, sub, `${tokens[6]}.ts`), `export function ${tokens[7]}() { return "${tokens[12]}"; }\n`);
  git("add", "-A");
  git("commit", "-qm", tokens[8]!);
  normal = await runBenchmark(root, { analysis: { workers: 2, maxCommits: 1 }, skeleton: true });
}, 30000);
afterAll(() => {
  chmodSync(unreadable, 0o600);
  rmSync(temp, { recursive: true, force: true });
});

test("canary paths, source, symbols, git identities, branches, remotes and packages never reach either rendering", () => {
  assertPrivate(normal);
  expect(normal.failures).toEqual([]);
  expect(normal.quality.typescript.find((r) => r.code === "symbols")!.value).toBeGreaterThan(0);
  expect(normal.limits.find((r) => r.code === "truncated")!.value).toBe(1);
  expect(normal.scale.totals.find((r) => r.code === "secrets")!.value).toBe(1);
  expect(normal.quality.imports.some((i) => i.internal > 0)).toBe(true);
});
test("validator fails closed on a canary in a value, key, unknown field, non-finite value or accessor", () => {
  for (const bad of [
    { ...normal, [tokens[0]!]: 1 },
    { ...normal, format: tokens[0] },
    { ...normal, version: Infinity },
    { ...normal, unknown_parameter: true },
  ])
    expect(() => validateBenchmark(bad as Benchmark)).toThrow();
  expect(() => validateVocabulary({ code: tokens[0] })).toThrow();
  expect(() => validateBenchmark({ ...normal, cost: { ...normal.cost, source: true } } as Benchmark)).toThrow("shape");
  expect(() => validateBenchmark({ ...normal, privacy: { ...normal.privacy, level: "aggregate" } })).toThrow();
  expect(() =>
    validateVocabulary({
      get code() {
        throw new Error(tokens[0]);
      },
    }),
  ).toThrow("accessor");
  const array: unknown[] = [];
  Object.defineProperty(array, "toJSON", { value: () => tokens[0] });
  expect(() => validateVocabulary(array)).toThrow("array");
});
test("unreadable file and circular/malformed tsconfig become counted codes", async () => {
  chmodSync(unreadable, 0);
  writeFileSync(join(root, config), JSON.stringify({ extends: `./${config}` }));
  try {
    const b = await runBenchmark(root, { analysis: { workers: 2 } });
    assertPrivate(b);
    expect(b.quality.diagnostics.find((r) => r.code === "unreadable_file")!.value).toBeGreaterThan(0);
    expect(b.quality.diagnostics.find((r) => r.code === "ts_config_circular")!.value).toBeGreaterThan(0);
    writeFileSync(join(root, config), `{ ${tokens[8]} broken`);
    const malformed = await runBenchmark(root, { analysis: { workers: 2 } });
    assertPrivate(malformed);
    expect(malformed.quality.diagnostics.find((r) => r.code === "ts_config_invalid")!.value).toBeGreaterThan(0);
  } finally {
    chmodSync(unreadable, 0o600);
  }
}, 30000);
test("a thrown error inside a phase produces a safe class and only shipped Skyplate frames", async () => {
  const original = WorkerPool.prototype.run;
  const mock = spyOn(WorkerPool.prototype, "run").mockImplementation(function (this: WorkerPool, request) {
    if (request.type === "measure") throw new TypeError(tokens[4] + " " + unreadable);
    return original.call(this, request);
  });
  try {
    const b = await runBenchmark(root, { analysis: { git: false, symbols: false, workers: 1 } });
    assertPrivate(b);
    expect(b.failures[0]!.error).toBe("type_error");
    expect(b.failures[0]!.phase).toBe("files");
    expect(b.failures[0]!.frames.some((f) => f.source === "src/core/pipeline.ts")).toBe(true);
    const out = join(temp, "failed-benchmark");
    await writeBenchmark(b, out, root);
    expect(readFileSync(join(out, "benchmark.json"), "utf8")).not.toContain(tokens[4]!);
  } finally {
    mock.mockRestore();
  }
});
test("git subprocess failure containing a canary never enters the output", async () => {
  const bin = join(temp, "bin");
  mkdirSync(bin);
  const realGit = Bun.which("git")!;
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nfor arg in "$@"; do\n if [ "$arg" = log ]; then echo '${tokens[0]}' >&2; exit 1; fi\ndone\nexec '${realGit}' "$@"\n`,
    { mode: 0o700 },
  );
  const out = join(temp, "git-failure");
  const p = Bun.spawn([process.execPath, "bin/skyplate.ts", "bench", root, "--no-symbols", "--workers", "1", "--out", out], {
    cwd: resolve(import.meta.dir, ".."),
    env: { ...env, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(code).toBe(0);
  expect(stdout).toBe("");
  const b = JSON.parse(readFileSync(join(out, "benchmark.json"), "utf8")) as Benchmark;
  assertPrivate(b);
  expect(b.quality.diagnostics.some((r) => r.code === "git_failed")).toBe(true);
  expect(b.quality.errors[0]!.phase).toBe("git");
  expect(b.quality.errors[0]!.frames.some((f) => f.source === "src/core/git.ts")).toBe(true);
  expect(stderr).not.toContain(tokens[0]!);
}, 30000);
test("privacy guard runs before either file is created, and outputs never enter the analyzed tree", async () => {
  const target = join(temp, "must-not-exist");
  await expect(writeBenchmark({ ...normal, format: tokens[0] } as Benchmark, target, root)).rejects.toThrow();
  expect(existsSync(target)).toBe(false);
  expect(() => checkBenchmarkOut(join(root, "output"), root)).toThrow();
  expect(() => checkBenchmarkOut(temp, root)).toThrow();
  expect(() => checkBenchmarkOut(root, root)).toThrow();
  const out = join(temp, "valid-output");
  const paths = await writeBenchmark(normal, out, root);
  expect(JSON.parse(readFileSync(paths.json, "utf8"))).toEqual(normal);
  expect(readFileSync(paths.markdown, "utf8")).toBe(renderMarkdown(normal));
  await expect(writeBenchmark(normal, out, root)).rejects.toThrow();
});
test("all measurements use stable upper buckets; safe failures drop non-Skyplate paths", () => {
  expect([0, 1, 3, 23, 1001, 0.03].map(coarse)).toEqual([0, 1, 4, 32, 1024, 0.03125]);
  const e = new Error(tokens[0]);
  e.stack = `Error: ${tokens[0]}\n at x (/private/${tokens[1]}/src/core/pipeline.ts:2:3)`;
  expect(safeFailure(e, tokens[2]!).frames).toEqual([]);
  class QueryError extends Error {}
  expect(safeFailure(new QueryError(tokens[0]), "unknown").error).toBe("query_error");
  for (const v of [NaN, Infinity, -1]) expect(() => coarse(v)).toThrow();
});
test("specifier classifier retains shape only", () => {
  expect(["./x", "/x", "https://x", "@/x", "@scope/pkg", "one.two", "package", "<x>"].map(specifierShape)).toEqual([
    "relative",
    "absolute",
    "url",
    "alias",
    "scoped",
    "dotted",
    "bare",
    "other",
  ]);
  const d = new AnalysisDiagnostics();
  d.import("typescript", "unresolved", tokens[0]!);
  expect(JSON.stringify([...d.imports])).not.toContain(tokens[0]!);
});
test("bench CLI parses analysis caps and rejects serving flags", () => {
  expect(parseCommand(["bench", ".", "--skeleton", "--workers", "2"]).kind).toBe("bench");
  expect(parseCommand(["bench", "synth", "benchmark.json", "--out", "new-dir"]).kind).toBe("synthesize");
  expect(() => parseCommand(["bench", ".", "--open"])).toThrow();
  expect(() => parseCommand(["mcp", "--skeleton"])).toThrow();
});

test("read, embedding, compiler and Rust extraction limits remain visible without their private text", async () => {
  const caps = join(temp, "cap-fixture");
  mkdirSync(caps);
  writeFileSync(join(caps, "a.ts"), `export const ${tokens[21]} = 1;\n`);
  writeFileSync(
    join(caps, "b.ts"),
    `import { ${tokens[21]} } from "./a";\n` + Array.from({ length: 30 }, (_, i) => `export const v${i} = ${tokens[21]};\n`).join(""),
  );
  writeFileSync(join(caps, "binary.dat"), new Uint8Array(1024));
  const measured = await runBenchmark(caps, {
    analysis: { git: false, workers: 1, maxReadBytes: 128, maxSourceFile: 16, maxSourceTotal: 1, tsMaxRefs: 1, exclude: [tokens[23]!] },
  });
  assertPrivate(measured);
  for (const code of ["text_read_cap", "binary_read_cap", "source_file_cap", "ts_reference_cap"])
    expect(measured.limits.find((c) => c.code === code)!.value).toBeGreaterThan(0);
  const skipped = await runBenchmark(caps, { analysis: { git: false, workers: 1, tsMaxFiles: 0 } });
  assertPrivate(skipped);
  expect(skipped.limits.find((c) => c.code === "ts_file_cap")!.value).toBeGreaterThan(0);
  writeFileSync(join(caps, "leaf.rs"), `use ${tokens[22]}::{` + Array.from({ length: 40 }, (_, i) => `item${i}`).join(",") + "};\n");
  writeFileSync(join(caps, "long.rs"), `use ${tokens[22]}::{` + Array.from({ length: 1000 }, (_, i) => `item${i}`).join(",") + "};\n");
  const rust = await runBenchmark(caps, { analysis: { git: false, symbols: false, workers: 1 } });
  assertPrivate(rust);
  expect(rust.limits.find((c) => c.code === "rust_use_cap")!.value).toBe(8);
  expect(rust.limits.find((c) => c.code === "rust_statement_cap")!.value).toBe(1);
}, 30000);

test("package projections reuse the anonymous cap counter without leaking package names", async () => {
  const fixture = join(temp, "package-cap");
  const moduleName = `example.invalid/${tokens[16]}`;
  mkdirSync(join(fixture, sub), { recursive: true });
  writeFileSync(join(fixture, "go.mod"), `module ${moduleName}\n`);
  writeFileSync(join(fixture, "main.go"), `package main\nimport "${moduleName}/${sub}"\n`);
  for (let member = 0; member < 24; member++) writeFileSync(join(fixture, sub, `${tokens[6]}${member}.go`), `package ${sub}\n`);
  const measured = await runBenchmark(fixture, { analysis: { git: false, symbols: false, workers: 1 } });
  assertPrivate(measured);
  expect(measured.limits.find((counter) => counter.code === "package_sibling_cap")!.value).toBe(coarse(7));
});
