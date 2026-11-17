import { join, resolve } from "node:path";
import { renderMarkdown, validateBenchmark, type Benchmark } from "../../src/core/bench";
import { args, freshOut, json, required } from "../structure/io";

const values = args(["--input", "--out"]);
const input = resolve(required(values, "--input"));
const out = freshOut(required(values, "--out"), [input]);
const benchmark = await Bun.file(join(input, "benchmark.json")).json() as Benchmark;
let vocabularyAndShapeValid = false;
let renderingMatches: boolean | null = null;
let error: string | null = null;
try {
  validateBenchmark(benchmark);
  vocabularyAndShapeValid = true;
  renderingMatches = renderMarkdown(benchmark) === await Bun.file(join(input, "benchmark.md")).text();
  if (!renderingMatches) error = "Markdown differs from the current renderer";
} catch (caught) {
  error = caught instanceof Error ? caught.message : "Validation failed";
}
const result = { vocabularyAndShapeValid, renderingMatches, version: benchmark.version, failures: benchmark.failures?.length ?? null, reportValidation: benchmark.quality?.validation ?? null, error };
json(join(out, "validation.json"), result);
console.log(JSON.stringify(result));
if (error) process.exitCode = 1;
