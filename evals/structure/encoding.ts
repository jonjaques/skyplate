import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeProject } from "../../src/core/pipeline";
import { validateReport } from "../../src/core/validate";
import { args, freshOut, json, required } from "./io";

const values = args(["--out"]);
const out = freshOut(required(values, "--out"));
const root = join(out, "specimen");
mkdirSync(root);
copyFileSync(join(import.meta.dir, "fixtures/japanese.py"), join(root, "japanese.py"));
const expected = new TextDecoder("shift_jis", { fatal: true }).decode(await Bun.file(join(root, "japanese.py")).bytes());
const { report, sources } = await analyzeProject(root, { git: false, symbols: false, source: true, workers: 1 });
const source = [...sources];
const valid = validateReport(report);
if (valid.length) throw new Error("Invalid encoding report");
const matches = source[0]?.[1] === expected;
json(join(out, "encoding.json"), { file: report.files[0], source, expected, sourceMatchesShiftJis: matches, reproducesS7: !report.files[0]?.binary && !matches });
console.log(JSON.stringify({ sourceMatchesShiftJis: matches, binary: report.files[0]?.binary }));
