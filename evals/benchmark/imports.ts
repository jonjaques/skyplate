import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeProject } from "../../src/core/pipeline";
import { extractImports } from "../../src/core/imports/extract";
import { createResolver } from "../../src/core/imports/resolve";
import { args, freshOut, json, metadata, required } from "../structure/io";

const values = args(["--project", "--out"]);
const project = resolve(required(values, "--project"));
const out = freshOut(required(values, "--out"), [project]);
const { report } = await analyzeProject(project, { source: false, git: false, symbols: false, workers: 2 });
const byPath = new Map(report.files.map((f) => [f.path, f]));
const readText = (path: string): string | undefined => {
  const file = byPath.get(path);
  if (!file || file.secret || file.binary || file.bytes > 8388608) return undefined;
  try { return readFileSync(join(project, path), "utf8"); } catch { return undefined; }
};
const resolver = createResolver({ root: project, paths: report.files.map((f) => f.path), manifests: report.manifests, readText });
const unresolved = [];
for (const file of report.files) {
  const text = readText(file.path);
  if (text === undefined) continue;
  for (const imp of extractImports(file.path, text, file.language)) {
    if (imp.kind !== "link" && "unresolved" in resolver(file.id, imp, file.language)) unresolved.push({ path: file.path, spec: imp.spec, line: imp.line, language: file.language });
  }
}
// This is local source evidence, outside the anonymous benchmark's contract.
json(join(out, "unresolved.json"), { ...metadata(project), unresolved });
console.log(JSON.stringify({ unresolved: unresolved.length }));
