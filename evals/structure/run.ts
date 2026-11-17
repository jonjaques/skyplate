import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { extractImports } from "../../src/core/imports/extract";
import { createResolver } from "../../src/core/imports/resolve";
import { validateReport } from "../../src/core/validate";
import type { Report } from "../../src/shared/schema";
import type { RawImport } from "../../src/core/contracts";
import { args, checkout, freshOut, json, metadata, required } from "./io";

const values = args(["--project", "--name", "--out", "--git", "--max-commits", "--workers"]);
const project = resolve(required(values, "--project"));
const name = required(values, "--name");
const corpus = await Bun.file(join(import.meta.dir, "corpus.json")).json() as { name: string; languages: string[]; commit: string }[];
const input = corpus.find((c) => c.name === name);
if (!input) throw new Error("--name must identify a corpus.json row");
const out = freshOut(required(values, "--out"), [project]);
const reportDir = join(out, "report");
const cli = [process.execPath, join(checkout, "bin/skyplate.ts"), project, "--json", "--no-source", "--no-symbols", "--out", reportDir, "--quiet"];
if (values.get("--git") === "false") cli.push("--no-git");
else if (values.has("--git") && values.get("--git") !== "true") throw new Error("--git is true or false");
for (const key of ["--max-commits", "--workers"]) if (values.has(key)) cli.push(key, required(values, key));
// BSD and GNU time disagree on flags and RSS units. Keep their original text and label the platform.
const command = process.platform === "darwin" ? ["/usr/bin/time", "-l", ...cli] : process.platform === "linux" ? ["/usr/bin/time", "-v", ...cli] : cli;
const start = performance.now();
const proc = Bun.spawn(command, { cwd: checkout, stdout: "pipe", stderr: "pipe" });
const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const wallSeconds = (performance.now() - start) / 1000;
const scrub = (text: string) => text.replaceAll(project, "<project>").replaceAll(checkout, "<skyplate>").replaceAll(out, "<out>");
writeFileSync(join(out, "cli.log"), scrub(stdout + "\n" + stderr), { flag: "wx" });
if (code !== 0) throw new Error(`CLI exited ${code}; inspect --out/cli.log`);
const report = await Bun.file(join(reportDir, "data/report.json")).json() as Report;
const valid = validateReport(report);
if (valid.length) throw new Error(`Report validation found ${valid.length} errors`);
const paths = report.files.map((f) => f.path);
const byPath = new Map(report.files.map((f) => [f.path, f]));
const readText = (path: string): string | undefined => {
  const file = byPath.get(path);
  if (!file || file.binary || file.secret || file.bytes > 8388608) return undefined;
  try { return readFileSync(join(project, path), "utf8"); } catch { return undefined; }
};
const resolver = createResolver({ root: project, paths, manifests: report.manifests, readText });
interface Row extends RawImport {
  path: string; language: string; category: string; generated: boolean; vendored: boolean;
  status: "internal" | "external" | "unresolved"; to?: string; also?: string[]; self?: boolean;
  external?: { name: string; ecosystem: string };
}
const rows: Row[] = [];
const by: Record<string, { files: number; internal: number; external: number; unresolved: number; self: number }> = {};
for (const f of report.files) {
  if (!input.languages.includes(f.language)) continue;
  const text = readText(f.path);
  if (text === undefined) continue;
  for (const imp of extractImports(f.path, text, f.language)) {
    if (imp.kind === "link") continue;
    const result = resolver(f.id, imp, f.language);
    const status = "file" in result ? "internal" : "external" in result ? "external" : "unresolved";
    const row: Row = { path: f.path, language: f.language, category: f.category, generated: f.generated, vendored: f.vendored, ...imp, status };
    if ("file" in result) {
      row.to = paths[result.file];
      row.also = result.also?.map((id) => paths[id]!);
      row.self = result.file === f.id;
    } else if ("external" in result) row.external = result.external;
    rows.push(row);
    const counts = by[f.language] ??= { files: report.files.filter((x) => x.language === f.language).length, internal: 0, external: 0, unresolved: 0, self: 0 };
    counts[status]++;
    if (row.self) counts.self++;
  }
}
writeFileSync(join(out, "imports.ndjson.gz"), gzipSync(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"), { flag: "wx" });
const hashOrder = (a: string, b: string) => Bun.hash(a).toString().localeCompare(Bun.hash(b).toString());
json(join(out, "sample.json"), rows.filter((r) => r.status === "internal" && !r.self).sort((a, b) => hashOrder(a.path + "|" + a.spec, b.path + "|" + b.spec)).slice(0, 20));
json(join(out, "detection-sample.json"), report.files.filter((f) => !f.binary && !f.secret).sort((a, b) => hashOrder(a.path, b.path)).slice(0, 20).map((f) => ({ path: f.path, language: f.language, category: f.category, generated: f.generated, vendored: f.vendored, head: readText(f.path)?.split("\n").slice(0, 8).join("\n") })));

const actualPairs = new Set<string>();
const nominalPairs = new Set<string>();
let cappedImports = 0;
const packages = new Map<string, string[]>();
for (const f of report.files) {
  if (f.language !== "go" || f.category === "test") continue;
  const dir = dirname(f.path);
  const members = packages.get(dir) ?? [];
  members.push(f.path);
  packages.set(dir, members);
}
const internal = rows.filter((r) => r.language === "go" && r.to);
for (const row of internal) {
  const members = packages.get(dirname(row.to!)) ?? [];
  const projected = [row.to!, ...(row.also ?? [])];
  if (members.some((m) => !projected.includes(m))) cappedImports++;
  for (const to of members) if (to !== row.path) nominalPairs.add(row.path + "|" + to);
  for (const to of projected) if (to !== row.path) actualPairs.add(row.path + "|" + to);
}
json(join(out, "package-cap.json"), { internalImports: internal.length, cappedImports, nominalProjectedPairs: nominalPairs.size, actualProjectedPairs: actualPairs.size, projectionCoverage: nominalPairs.size ? actualPairs.size / nominalPairs.size : null, largestPackages: [...packages].map(([path, members]) => [path, members.length]).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5) });
const summary = { name, ...metadata(project), expectedCommit: input.commit, commitMatches: metadata(project).inputCommit === input.commit, wallSeconds, totals: report.totals, timings: report.timings, graph: report.graph, warnings: report.warnings.map(scrub), by, valid, entries: report.files.filter((f) => f.entry).map((f) => ({ path: f.path, entry: f.entry })), unresolved: rows.filter((r) => r.status === "unresolved"), unused: report.externals.filter((d) => d.declaredIn.length && d.importers === 0) };
json(join(out, "summary.json"), summary);
console.log(JSON.stringify({ name, files: report.files.length, by, wallSeconds, commitMatches: summary.commitMatches }));
