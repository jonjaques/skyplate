import { analyzeProject } from "../../src/core/pipeline";
import { analyzeTypeScript } from "../../src/core/ts/index";
import { resolveSymbol, seam, symbol } from "../../src/mcp/query";
import { REF_KINDS, SymbolFlag } from "../../src/shared/schema";
import { args, fixture, label, output, portable, tsInput, write } from "./common";

const flags = args(["out"]);
const out = output(flags);
const root = fixture(out, "probes");
const events: unknown[] = [];
const analysis = await analyzeProject(root, { git: false, workers: 1 }, (e) => events.push(e));
const S = analysis.symbols;
if (!S) throw new Error("Probe compiler pass returned no symbols");
const t = S.symbols;
const rows = t.name.flatMap((_, id) => t.kind[id] !== "module" ? [{
  id, name: label(S, id), kind: t.kind[id], file: analysis.report.files[t.file[id]!]!.path,
  line: t.line[id]! + 1, signature: t.signature[id], complexity: t.complexity[id],
  unused: !!(t.flags[id]! & SymbolFlag.unusedExport),
  host: S.hostUses?.symbol.flatMap((s, i) => s === id ? [analysis.report.files[S.hostUses!.file[i]!]!.path] : []),
  refs: S.refs.symbol.flatMap((s, i) => s === id ? [
    `${analysis.report.files[S.refs.file[i]!]!.path}:${S.refs.line[i]! + 1}:${S.refs.col[i]! + 1} ${REF_KINDS[S.refs.kind[i]!]} from ${label(S, S.refs.from[i]!)}`,
  ] : []),
}] : []);
const queries: Record<string, unknown> = {};
for (const name of ["Leaf.run", "Base.run", "Middle.run", "hostOnly", "aliasOnly", "neverRunsCallback", "cb", "Merged"]) {
  try { queries[name] = symbol(analysis.report, S, resolveSymbol(analysis.report, S, { name }), { impactDepth: 3, limit: 100 }); }
  catch (error) { queries[name] = { error: String(error) }; }
}
queries.seam = seam(analysis.report, S, "object.ts");
write(out, "probe-rows.json", rows);
write(out, "probe-queries.json", queries);
write(out, "probes.json", portable({ report: analysis.report, symbols: S, events }, [[root, "."], [out, "<out>"]]));
const workspace = fixture(out, "workspace-probe");
const input = tsInput(workspace, undefined, 100, 1_000);
const logs: string[] = [];
const symbols = await analyzeTypeScript({ ...input, onProgress: (m) => logs.push(m) });
write(out, "workspace-probe.json", portable({ paths: input.paths, symbols, logs }, [[workspace, "."]]));
console.log(JSON.stringify({ stats: S.stats, warnings: analysis.report.warnings, workspace: symbols?.stats }));
