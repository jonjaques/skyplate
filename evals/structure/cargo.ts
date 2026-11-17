import { join, relative, resolve } from "node:path";
import { args, freshOut, json, required } from "./io";
import { analyzeProject } from "../../src/core/pipeline";

const values = args(["--project", "--out"]);
const project = resolve(required(values, "--project"));
const out = freshOut(required(values, "--out"), [project]);
// --locked prevents metadata from updating an analyzed repository's lockfile.
const proc = Bun.spawnSync(["cargo", "metadata", "--offline", "--locked", "--no-deps", "--format-version", "1"], { cwd: project, stdout: "pipe", stderr: "pipe" });
if (proc.exitCode) throw new Error("cargo metadata failed; prepare the locked public clone with Cargo available");
const metadata = JSON.parse(proc.stdout.toString()) as { packages: { targets: { kind: string[]; name: string; src_path: string }[] }[] };
const cargoTargets = metadata.packages.flatMap((p) => p.targets).filter((t) => t.kind.some((kind) => ["bin", "test", "bench", "example", "custom-build"].includes(kind))).map((t) => ({ kind: t.kind, name: t.name, path: relative(project, t.src_path).replaceAll("\\", "/") }));
const { report } = await analyzeProject(project, { source: false, symbols: false, git: false, workers: 2 });
json(join(out, "entry-cargo-check.json"), { cargoTargets, skyplateEntries: report.files.filter((f) => f.entry).map((f) => ({ path: f.path, entry: f.entry })) });
console.log(`Compared ${cargoTargets.length} native targets with analyzer entries`);
