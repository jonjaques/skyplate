import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractImports } from "../../src/core/imports/extract";
import { createResolver } from "../../src/core/imports/resolve";
import { readManifests } from "../../src/core/manifests";
import { findEntries } from "../../src/core/entries";
import { analyzeGraph } from "../../src/core/graph";
import { analyzeProject } from "../../src/core/pipeline";
import { validateReport } from "../../src/core/validate";
import { args, freshOut, json, required } from "./io";

const values = args(["--out"]);
const out = freshOut(required(values, "--out"));
const cases = await Bun.file(join(import.meta.dir, "fixtures/repros.json")).json() as { name: string; files: Record<string, string>; from: string; language: string }[];
const rows = [];
for (const fixture of cases) {
  const root = join(out, fixture.name);
  mkdirSync(root);
  for (const [path, text] of Object.entries(fixture.files)) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text, { flag: "wx" });
  }
  const paths = Object.keys(fixture.files).sort();
  const readText = (path: string) => fixture.files[path];
  const manifests = readManifests(paths, readText);
  // Match the old resolver probe's empty manifest context, then also measure the whole pipeline.
  const resolver = createResolver({ root, paths, manifests: [], readText });
  const result = extractImports(fixture.from, fixture.files[fixture.from]!, fixture.language).map((imp) => {
    const resolution = resolver(paths.indexOf(fixture.from), imp, fixture.language);
    return { ...imp, ...resolution, ...("file" in resolution ? { target: paths[resolution.file], siblings: resolution.also?.map((id) => paths[id]) } : {}) };
  });
  const { report } = await analyzeProject(root, { git: false, symbols: false, source: false, workers: 1 });
  const validation = validateReport(report);
  if (validation.length) throw new Error(`Invalid fixture report: ${fixture.name}`);
  rows.push({ name: fixture.name, result, manifests, entries: [...findEntries(paths, readText)], pipeline: { graph: report.graph, dependencies: report.externals, entries: report.files.filter((f) => f.entry).map((f) => f.path) } });
}
rows.push({ name: "known-graph", graph: analyzeGraph({ fileCount: 4, from: [0, 1, 2, 2, 3], to: [1, 2, 1, 1, 2], fileDir: [1, 2, 2, 1], dirParent: [-1, 0, 0], dirDepth: [0, 1, 1] }) });
json(join(out, "repros.json"), rows);
console.log(`Measured ${cases.length} repros and the known graph`);
