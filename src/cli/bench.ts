import { resolve } from "node:path";
import { checkBenchmarkOut, defaultBenchmarkOut, generateSynthetic, runBenchmark, validateBenchmark, writeBenchmark, type Benchmark } from "../core/bench";
import type { BenchCommand, SynthesizeCommand } from "./args";

export async function benchCommand(cmd: BenchCommand | SynthesizeCommand): Promise<number> {
  if (cmd.kind === "synthesize") {
    const b = (await Bun.file(cmd.file).json()) as Benchmark;
    validateBenchmark(b);
    if (!b.skeleton) throw new Error("benchmark has no skeleton; rerun with --skeleton only if sharing its structure is acceptable");
    await generateSynthetic(b.skeleton, cmd.out);
    process.stderr.write(`Wrote synthetic repository to ${resolve(cmd.out)}\n`);
    return 0;
  }
  const out = cmd.out ? resolve(cmd.out) : defaultBenchmarkOut();
  checkBenchmarkOut(out, cmd.path);
  if (!cmd.quiet)
    process.stderr.write(
      cmd.skeleton
        ? "Measuring locally. Skeleton output retains the directory tree and import graph; review before sharing.\n"
        : "Measuring locally. Output contains coarse counts and timings; review before sharing.\n",
    );
  const result = await runBenchmark(cmd.path, { analysis: cmd.options, skeleton: cmd.skeleton });
  const paths = await writeBenchmark(result, out, cmd.path);
  process.stderr.write(`Wrote ${paths.json}\nWrote ${paths.markdown}\n`);
  if (result.failures.length) process.stderr.write("Analysis failed; the benchmark includes safe failure codes and Skyplate frames.\n");
  return result.failures.length ? 1 : 0;
}
