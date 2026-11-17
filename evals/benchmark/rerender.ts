import { join, resolve } from "node:path";
import { renderMarkdown, validateBenchmark, writeBenchmark, type Benchmark } from "../../src/core/bench";
import { args, freshOut, json, required } from "../structure/io";

const values = args(["--input", "--out"]);
const input = resolve(required(values, "--input"));
const benchmark = await Bun.file(join(input, "benchmark.json")).json() as Benchmark;
// A renderer change can invalidate byte equality without invalidating the measured JSON.
// Retired schemas still fail here; this command never edits or migrates measurements.
validateBenchmark(benchmark);
const out = freshOut(required(values, "--out"), [input]);
await writeBenchmark(benchmark, join(out, "sample"), input);
json(join(out, "provenance.json"), { measurementsUnchanged: true, originalMarkdownMatchesCurrentRenderer: renderMarkdown(benchmark) === await Bun.file(join(input, "benchmark.md")).text(), regeneratedMarkdown: true });
console.log("Validated measured JSON and regenerated only its Markdown rendering");
