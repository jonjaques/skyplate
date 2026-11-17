import { mkdirSync } from "node:fs";
import { join } from "node:path";
// The oracle package intentionally owns TS5.9. Fault injection must patch the same TS7
// class that the analyzer imports, so it reaches into the root package explicitly.
import { Checker, type Symbol as NativeSymbol } from "../../node_modules/typescript/dist/api/async/api.js";
import type { Node } from "../../node_modules/typescript/dist/ast/index.js";
import { analyzeProject } from "../../src/core/pipeline";
import { analyzeTypeScript } from "../../src/core/ts/index";
import { seam } from "../../src/mcp/query";
import { unreferenced, unusedExportKind } from "../../src/shared/calls";
import { args, fixture, output, portable, tsInput, write } from "./common";

const out = output(args(["out"]));
const root = fixture(out, "failures");
const saved = Checker.prototype.getSymbolAtLocation;
function injected(this: Checker, node: Node): Promise<NativeSymbol | undefined>;
function injected(this: Checker, node: readonly Node[]): Promise<(NativeSymbol | undefined)[]>;
async function injected(this: Checker, node: Node | readonly Node[]): Promise<NativeSymbol | undefined | (NativeSymbol | undefined)[]> {
  const first = "length" in node ? node[0] : node;
  if (first?.getSourceFile().fileName.includes("/bad/")) throw new Error("eval injected checker failure in bad project");
  return "length" in node ? saved.bind(this)(node) : (saved.bind(this) as (n: Node) => Promise<NativeSymbol | undefined>)(node);
}
Checker.prototype.getSymbolAtLocation = injected;
const events: unknown[] = [];
try {
  const a = await analyzeProject(root, { git: false, workers: 1 }, (e) => events.push(e));
  write(out, "partial-failure.json", portable({ report: a.report, symbols: a.symbols, events }, [[root, "."]]));
} finally {
  Checker.prototype.getSymbolAtLocation = saved;
}

const cap = fixture(out, "cap");
const runs = [];
for (const maxRefs of [100, 0]) {
  const S = await analyzeTypeScript(tsInput(cap, ["x.ts"], 10, maxRefs));
  if (!S) throw new Error("Recursion fixture produced no symbols");
  const id = S.symbols.name.indexOf("rec");
  // unusedExportKind only reads file entry metadata; this fixture has no entry points.
  const metadata = { files: [] } as unknown as Parameters<typeof unusedExportKind>[2];
  runs.push({ maxRefs, stats: S.stats, refs: S.symbols.refs[id], callers: S.symbols.callers[id],
    unreferenced: unreferenced(S)[id], class: unusedExportKind(S, id, metadata) });
}
write(out, "cap-recursion.json", runs);

// An empty unrelated ancestor installation is enough to reproduce the directory-existence
// heuristic. Keeping it under --out isolates this from the eval's own installed packages.
mkdirSync(join(out, "node_modules"));
const missing = fixture(out, "missing-deps");
const miss = await analyzeProject(missing, { git: false, workers: 1 });
write(out, "missing-deps.json", portable({ report: miss.report, symbols: miss.symbols }, [[missing, "."]]));

const seamRoot = fixture(out, "seam-cap");
const seamRuns = [];
for (const tsMaxRefs of [100, 0]) {
  const a = await analyzeProject(seamRoot, { git: false, workers: 1, tsMaxRefs });
  seamRuns.push({ tsMaxRefs, stats: a.symbols?.stats, warnings: a.report.warnings, seam: seam(a.report, a.symbols, "lib") });
}
write(out, "seam-cap.json", seamRuns);
const prototype = fixture(out, "prototype-probe");
const input = tsInput(prototype);
const data = await analyzeTypeScript(input);
write(out, "prototype-probe.json", { paths: input.paths, data });
console.log(JSON.stringify({ recursion: runs, missingDependencies: miss.symbols?.stats, prototype: data?.stats }));
