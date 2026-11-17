import { readFileSync } from "node:fs";
import { join } from "node:path";
import { args, output, required, write } from "./common";
import { score, type OracleRow, type Score } from "./scoring";

const flags = args(["results", "installed", "bare", "out"]);
const out = output(flags);
const metrics = ["refs", "calls", "callers"] as const;
type Totals = Record<typeof metrics[number], Score>;
const emptyScore = (): Score => ({ tp: 0, fp: 0, fn: 0, precision: null, recall: null });
const empty = (): Totals => ({ refs: emptyScore(), calls: emptyScore(), callers: emptyScore() });
const read = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { results: OracleRow[] }).results;
function add(totals: Totals, row: OracleRow): void {
  for (const metric of metrics) {
    const counts = row[metric];
    if (!counts) throw new Error(`Incomplete oracle row: ${JSON.stringify(row.sel)}`);
    for (const k of ["tp", "fp", "fn"] as const) totals[metric][k] += counts[k];
  }
}
function rates(totals: Totals): Totals {
  for (const m of metrics) {
    const t = totals[m];
    t.precision = t.tp + t.fp ? t.tp / (t.tp + t.fp) : null;
    t.recall = t.tp + t.fn ? t.tp / (t.tp + t.fn) : null;
  }
  return totals;
}
if (flags.installed || flags.bare) {
  const gold = read(required(flags, "installed"));
  const bare = read(required(flags, "bare"));
  const totals = empty();
  for (const row of gold) {
    const other = bare.find((r) => JSON.stringify(r.sel) === JSON.stringify(row.sel));
    if (!other?.sky || !row.oracle || !other.callers || !row.callers) throw new Error("Missing paired selection");
    add(totals, { sel: row.sel,
      refs: score(row.oracle.map((v) => v.key), other.sky.map((v) => v.key)),
      calls: score(row.oracle.filter((v) => v.call).map((v) => v.key), other.sky.filter((v) => v.call).map((v) => v.key)),
      callers: { ...score(row.callers.oracle, other.callers.sky), oracle: row.callers.oracle, sky: other.callers.sky },
    });
  }
  write(out, "paired.json", rates(totals));
} else {
  const root = required(flags, "results");
  const repos: Record<string, { samples: number; totals: Totals }> = {};
  const strata: Record<string, { samples: number; totals: Totals }> = {};
  const total = empty();
  for (const corpus of ["sky-installed", "query-bare", "express-installed", "plimit-installed"]) {
    const rows = read(join(root, corpus + "-oracle.json"));
    const counts = empty();
    for (const row of rows) {
      add(counts, row);
      add(total, row);
      const stratum = ["component", "hook"].includes(row.kind!) ? "React function"
        : ["type", "interface", "class"].includes(row.kind!) ? "type/interface/class" : row.kind!;
      const group = strata[stratum] ??= { samples: 0, totals: empty() };
      group.samples++;
      add(group.totals, row);
    }
    repos[corpus] = { samples: rows.length, totals: rates(counts) };
  }
  for (const group of Object.values(strata)) rates(group.totals);
  write(out, "summary.json", { repos, strata, total: rates(total) });
}
