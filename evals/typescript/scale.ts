import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTypeScript } from "../../src/core/ts/index";
import { args, integer, output, tsInput, write } from "./common";

const flags = args(["out", "count", "max-files"]);
const out = output(flags);
const count = integer(flags.count, 1_000);
if (count < 1) throw new Error("--count must be positive");
const cap = integer(flags["max-files"], 20_000);
const root = join(out, "chain");
mkdirSync(root);
writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
  compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["*.ts"],
}));
const paths = ["tsconfig.json"];
for (let i = 0; i < count; i++) {
  const file = `f${String(i).padStart(5, "0")}.ts`;
  paths.push(file);
  const previous = `f${String(i - 1).padStart(5, "0")}`;
  // Source is generated before analysis; the one edit is the experiment's input mutation.
  writeFileSync(join(root, file), `${i ? `import {f${i - 1}} from './${previous}';\n` : ""}export function f${i}(x:number){return x?${i ? `f${i - 1}(x)` : "x+1"}:0}\n`);
}
const input = tsInput(root, paths, cap);
const runs = [];
for (let pass = 0; pass < 2; pass++) {
  const logs: string[] = [];
  const start = performance.now();
  const data = await analyzeTypeScript({ ...input, onProgress: (m) => logs.push(m) });
  runs.push({ elapsed: performance.now() - start, stats: data?.stats, projects: data?.projects,
    logs, maxRSSKiB: process.resourceUsage().maxRSS });
  if (pass === 0) {
    const file = join(root, paths[1]!);
    writeFileSync(file, readFileSync(file, "utf8") + "// one edit\n");
  }
}
write(out, "scale.json", { count, cap, runs });
console.log(JSON.stringify({ count, cap, runs }));
