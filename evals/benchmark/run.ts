import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { generateSynthetic, renderMarkdown, runBenchmark, validateBenchmark, writeBenchmark, type Benchmark } from "../../src/core/bench";
import { analyzeProject } from "../../src/core/pipeline";
import { validateReport } from "../../src/core/validate";
import { args, freshOut, json, metadata, required } from "../structure/io";

const values = args(["--project", "--out", "--workers", "--max-commits"]);
const project = resolve(required(values, "--project"));
const out = freshOut(required(values, "--out"), [project]);
const workers = Number(values.get("--workers") ?? 2);
const maxCommits = values.has("--max-commits") ? Number(values.get("--max-commits")) : undefined;
if (!Number.isSafeInteger(workers) || workers < 1 || (maxCommits !== undefined && (!Number.isSafeInteger(maxCommits) || maxCommits < 1))) throw new Error("Worker and commit limits must be positive integers");
const started = performance.now();
const benchmark = await runBenchmark(project, { analysis: { workers, ...(maxCommits === undefined ? {} : { maxCommits }) }, skeleton: true });
validateBenchmark(benchmark);
const output = await writeBenchmark(benchmark, join(out, "benchmark"), project);
if (await Bun.file(output.markdown).text() !== renderMarkdown(benchmark)) throw new Error("Markdown mismatch");
if (benchmark.failures.length || benchmark.quality.validation.length || !benchmark.skeleton) throw new Error("Benchmark failed or has no usable skeleton");

const synthetic = join(out, "synthetic");
await generateSynthetic(benchmark.skeleton, synthetic);
const { report } = await analyzeProject(synthetic, { git: false, symbols: false, source: false, workers });
if (validateReport(report).length) throw new Error("Synthetic report failed validation");
const skeleton = benchmark.skeleton;
const fileId = (id: number) => {
  const match = report.files[id]?.name.match(/^f(\d+)\.ts$/);
  if (!match) throw new Error("Unexpected synthetic filename");
  return Number(match[1]);
};
const rootId = skeleton.dirs.findIndex((d) => d.parent === -1);
const dirId = (id: number) => id === 0 ? rootId : Number(report.dirs[id]!.name.slice(1));
const typeOnly = new Set(report.edges.typeOnly ?? []);
const actual = report.edges.from.map((f, i) => `${fileId(f)}:${fileId(report.edges.to[i]!)}:${typeOnly.has(i)}`).sort();
const expected = skeleton.edges.map((e) => `${e.from}:${e.to}:${e.type}`).sort();
const proof = {
  files: report.files.length, dirs: report.dirs.length, edges: actual.length,
  countsMatch: report.files.length === skeleton.files.length && report.dirs.length === skeleton.dirs.length,
  edgesAndTypesMatch: JSON.stringify(actual) === JSON.stringify(expected),
  parentsMatch: report.dirs.every((d) => d.parent < 0 ? skeleton.dirs[dirId(d.id)]!.parent === -1 : skeleton.dirs[dirId(d.id)]!.parent === dirId(d.parent)),
  membershipsMatch: report.files.every((f) => skeleton.files[fileId(f.id)]!.dir === dirId(f.dir)),
};
json(join(out, "shape-proof.json"), proof);
if (Object.values(proof).some((v) => v === false)) throw new Error("Skeleton round trip differs");

// Random strings cover independent leak sources. No credentials or outside identity are used.
const tokens = Array.from({ length: 24 }, () => "CNY_" + randomUUID().replaceAll("-", ""));
const token = (n: number) => tokens[n]!;
const canaryRoot = join(out, token(0));
mkdirSync(canaryRoot);
mkdirSync(join(canaryRoot, token(1)));
writeFileSync(join(canaryRoot, token(1), token(2) + ".ts"), `export function ${token(3)}() { return "${token(4)}"; }\n`);
writeFileSync(join(canaryRoot, token(1), token(5) + ".ts"), `import { ${token(3)} } from "./${token(2)}";\nexport const ${token(6)} = ${token(3)}();\nimport "${token(7)}";\n`);
writeFileSync(join(canaryRoot, "." + token(8)), token(9));
writeFileSync(join(canaryRoot, ".env." + token(10)), token(11) + "=" + token(12));
writeFileSync(join(canaryRoot, "package.json"), JSON.stringify({ name: token(13), dependencies: { [token(14)]: "1.0.0" } }));
writeFileSync(join(canaryRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "bundler" }, include: [token(1)] }));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: token(15), GIT_AUTHOR_EMAIL: token(16) + "@example.invalid", GIT_COMMITTER_NAME: token(15), GIT_COMMITTER_EMAIL: token(16) + "@example.invalid", GIT_AUTHOR_DATE: "2024-01-01T12:00:00Z", GIT_COMMITTER_DATE: "2024-01-01T12:00:00Z" };
function git(...argv: string[]): void {
  const proc = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...argv], { cwd: canaryRoot, env, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode) throw new Error("Canary fixture Git command failed");
}
git("init", "-q", "-b", token(17));
git("add", ".");
git("commit", "-qm", token(18));
git("remote", "add", "origin", `https://${token(19)}.invalid/${token(20)}/${token(21)}`);
git("tag", token(22));
const canary = await runBenchmark(canaryRoot, { analysis: { workers }, skeleton: true });
const assertPrivate = (value: Benchmark, markdown: string) => {
  validateBenchmark(value);
  const serialized = JSON.stringify(value);
  if (tokens.some((t) => serialized.includes(t) || markdown.includes(t))) throw new Error("Canary leak detected");
};
assertPrivate(canary, renderMarkdown(canary));
await writeBenchmark(canary, join(out, "canary"), canaryRoot);
let markdownMutationCaught = false;
try { assertPrivate(canary, renderMarkdown(canary) + token(23)); } catch { markdownMutationCaught = true; }
let jsonMutationCaught = false;
try { validateBenchmark({ ...canary, format: token(23) } as Benchmark); } catch { jsonMutationCaught = true; }
const canaryProof = { tokens: tokens.length, jsonAndMarkdownPrivate: true, markdownMutationCaught, jsonMutationCaught, failures: canary.failures.length, reportValidation: canary.quality.validation };
json(join(out, "canary-proof.json"), canaryProof);
if (!markdownMutationCaught || !jsonMutationCaught || canary.failures.length || canary.quality.validation.length) throw new Error("Canary control failed");
json(join(out, "run.json"), { ...metadata(project), workers, maxCommits: maxCommits ?? "default", wallMs: performance.now() - started, benchmarkMs: benchmark.cost.totalMs, shape: proof, canary: canaryProof });
console.log(JSON.stringify({ benchmarkMs: benchmark.cost.totalMs, shape: proof, canary: canaryProof }));
