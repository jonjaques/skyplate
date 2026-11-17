import { realpathSync } from "node:fs";
import { analyzeTypeScript } from "../../src/core/ts/index";
import { args, integer, output, portable, required, sourcePattern, tsInput, write } from "./common";

const flags = args(["project", "out", "max-files", "max-refs"]);
const root = realpathSync(required(flags, "project"));
const out = output(flags, root);
const input = tsInput(root, undefined, integer(flags["max-files"], 20_000), integer(flags["max-refs"], 600_000));
const logs: string[] = [];
const start = performance.now();
const data = await analyzeTypeScript({ ...input, onProgress: (message) => logs.push(message) });
const elapsed = performance.now() - start;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const summary = {
  root: ".", revision: revision.exitCode === 0 ? revision.stdout.toString().trim() : null,
  paths: input.paths.length, candidates: input.paths.filter((p) => sourcePattern.test(p)).length,
  configs: input.configs.length, elapsed,
  rss: process.resourceUsage().maxRSS, stats: data?.stats, projects: data?.projects, logs,
};
write(out, "analysis.json", portable({ summary, paths: input.paths, data }, [[root, "."]]));
write(out, "summary.json", portable(summary, [[root, "."]]));
console.log(JSON.stringify(summary.stats ?? { skipped: true }));
