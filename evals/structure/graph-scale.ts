import { join } from "node:path";
import { analyzeGraph } from "../../src/core/graph";
import { args, freshOut, json, required } from "./io";

const values = args(["--out", "--sizes"]);
const sizes = (values.get("--sizes") ?? "100000,1000000").split(",").map(Number);
if (sizes.some((n) => !Number.isSafeInteger(n) || n < 2 || n > 1000000)) throw new Error("Sizes must be integers from 2 through 1000000");
const out = freshOut(required(values, "--out"));
const rows = [];
for (const n of sizes) {
  const from = Array.from({ length: n - 1 }, (_, i) => i);
  const to = from.map((x) => x + 1);
  const start = performance.now();
  const graph = analyzeGraph({ fileCount: n, from, to, fileDir: Array<number>(n).fill(1), dirParent: [-1, 0], dirDepth: [0, 1] });
  rows.push({ files: n, edges: n - 1, ms: performance.now() - start, rss: process.memoryUsage().rss, cycles: graph.summary.cycles.length, rankLast: graph.rank[n - 1] });
}
json(join(out, "graph-scale.json"), rows);
console.log(JSON.stringify(rows));
