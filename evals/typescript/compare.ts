import { readFileSync } from "node:fs";
import { join } from "node:path";
import { args, output, required, write } from "./common";
import type { OracleRow } from "./scoring";

const flags = args(["kind", "baseline", "current", "out"]);
const out = output(flags);
const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
if (required(flags, "kind") === "oracle") {
  const baseline = read(required(flags, "baseline")) as { results: OracleRow[] };
  const current = read(required(flags, "current")) as { results: OracleRow[] };
  const changes = [];
  function semantic(row: OracleRow) {
    return {
      error: row.error, kind: row.kind,
      oracle: row.oracle?.map((r) => `${r.key} ${r.call}`).sort(),
      sky: row.sky?.map((r) => `${r.key} ${r.call}`).sort(),
      callers: { oracle: row.callers?.oracle.toSorted(), sky: row.callers?.sky.toSorted() },
    };
  }
  for (const row of baseline.results) {
    const other = current.results.find((r) => JSON.stringify(r.sel) === JSON.stringify(row.sel));
    if (!other || JSON.stringify(semantic(row)) !== JSON.stringify(semantic(other))) {
      changes.push({ selection: row.sel, baseline: semantic(row), current: other && semantic(other) });
    }
  }
  const additions = current.results.filter((r) => !baseline.results.some((b) => JSON.stringify(b.sel) === JSON.stringify(r.sel)));
  write(out, "comparison.json", { baselineSelections: baseline.results.length, currentSelections: current.results.length, changes, additions });
  console.log(JSON.stringify({ changedSelections: changes.length, addedSelections: additions.length }));
} else if (flags.kind === "probes") {
  const baseline = required(flags, "baseline");
  const current = required(flags, "current");
  function withoutIds(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutIds);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "id").map(([key, item]) => [key, withoutIds(item)]));
    return value;
  }
  const oldRows = withoutIds(read(join(baseline, "probe-rows.json"))) as { name: string; file: string }[];
  const newRows = withoutIds(read(join(current, "probe-rows.json"))) as { name: string; file: string }[];
  const changedRows = oldRows.flatMap((row, i) => JSON.stringify(row) === JSON.stringify(newRows[i]) ? [] : [{ baseline: row, current: newRows[i] }]);
  const oldQueries = withoutIds(read(join(baseline, "probe-queries.json"))) as Record<string, unknown>;
  const newQueries = withoutIds(read(join(current, "probe-queries.json"))) as Record<string, unknown>;
  const changedQueries = Object.keys(oldQueries).flatMap((name) => JSON.stringify(oldQueries[name]) === JSON.stringify(newQueries[name])
    ? [] : [{ name, baseline: oldQueries[name], current: newQueries[name] }]);
  write(out, "comparison.json", { baselineRows: oldRows.length, currentRows: newRows.length, changedRows, changedQueries });
  console.log(JSON.stringify({ changedRows: changedRows.length, changedQueries: changedQueries.map((q) => q.name) }));
} else throw new Error("--kind must be oracle or probes");
