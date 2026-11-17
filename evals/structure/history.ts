import { join, resolve } from "node:path";
import { analyzeProject } from "../../src/core/pipeline";
import { validateReport } from "../../src/core/validate";
import { args, freshOut, json, required } from "./io";

const values = args(["--project", "--out"]);
const project = resolve(required(values, "--project"));
const out = freshOut(required(values, "--out"), [project]);
const { report } = await analyzeProject(project, { symbols: false, source: false, workers: 1 });
const valid = validateReport(report);
if (valid.length) throw new Error("History report validation failed");
const files = report.files.map((f) => ({ path: f.path, hotspot: f.hotspot, git: f.git }));
json(join(out, "history.json"), { files, git: report.git, warnings: report.warnings });
console.log(JSON.stringify({ files: files.length, commits: report.git?.analyzedCommits }));
