import { join, resolve } from "node:path";
import { renderMarkdown, validateBenchmark, type Benchmark } from "../../src/core/bench";
import { args, freshOut, json, required } from "../structure/io";

const values = args(["--input", "--out"]);
const input = resolve(required(values, "--input"));
const out = freshOut(required(values, "--out"), [input]);
// Loading is inside the try, and the result reads the input defensively: a file that is not
// a benchmark at all (null, a string, truncated JSON) must still end in a recorded rejection.
let benchmark: Partial<Benchmark> | null = null;
let vocabularyAndShapeValid = false;
let renderingMatches: boolean | null = null;
let error: string | null = null;
try {
  benchmark = await Bun.file(join(input, "benchmark.json")).json();
  validateBenchmark(benchmark as Benchmark); // it checks untrusted input and throws on anything else
  vocabularyAndShapeValid = true;
  renderingMatches = renderMarkdown(benchmark as Benchmark) === await Bun.file(join(input, "benchmark.md")).text();
  if (!renderingMatches) error = "Markdown differs from the current renderer";
} catch (caught) {
  error = caught instanceof Error ? caught.message : "Validation failed";
}
const shape = benchmark !== null && typeof benchmark === "object" ? benchmark : {};
const result = {
  vocabularyAndShapeValid,
  renderingMatches,
  version: shape.version ?? null,
  failures: Array.isArray(shape.failures) ? shape.failures.length : null,
  reportValidation: shape.quality?.validation ?? null,
  error,
};
json(join(out, "validation.json"), result);
console.log(JSON.stringify(result));
if (error) process.exitCode = 1;
