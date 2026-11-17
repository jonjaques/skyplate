import { ANOMALIES, ERRORS, PHASES, TOOLS } from "./privacy";
import { SKYPLATE_SOURCES } from "./sources";

type Guard = (value: unknown) => boolean;
const text: Guard = (v) => typeof v === "string";
const bool: Guard = (v) => typeof v === "boolean";
const number: Guard = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer: Guard = (v) => number(v) && Number.isInteger(v);
const bucket: Guard = (v) => number(v) && (v === 0 || Number.isInteger(Math.log2(v as number)));
/** The three number classes of privacy.ts, each checked as written. */
const duration: Guard = (v) => number(v) && Number((v as number).toPrecision(2)) === v;
const ratio: Guard = (v) => number(v) && (v as number) <= 1 && Math.round((v as number) * 100) / 100 === v;
const choice =
  (values: readonly string[]): Guard =>
  (v) =>
    typeof v === "string" && values.includes(v);
const list =
  (element: Guard): Guard =>
  (v) =>
    Array.isArray(v) && v.every(element);
function object(fields: Record<string, Guard>, optional: readonly string[] = []): Guard {
  return (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const row = v as Record<string, unknown>;
    if (Object.keys(row).some((k) => !Object.hasOwn(fields, k))) return false;
    return Object.entries(fields).every(([k, guard]) => (Object.hasOwn(row, k) ? guard(row[k]) : optional.includes(k)));
  };
}
const release: Guard = (v) => Array.isArray(v) && v.length === 3 && v.every(integer);
const counter = object({ code: text, value: bucket });
const counters = list(counter);
const rates = list(object({ code: text, value: ratio }));
const histogram = object({ upper: bucket, count: bucket });
const distribution = object({
  metric: text,
  count: bucket,
  minimum: bucket,
  p50: bucket,
  p90: bucket,
  p99: bucket,
  maximum: bucket,
  histogram: list(histogram),
});
const boundary = object({ phase: choice(PHASES), status: choice(["start", "done", "skip"]), rss: bucket, heap: bucket });
const phase = object({
  phase: choice(PHASES),
  status: choice(["ok", "skipped", "failed", "incomplete"]),
  ms: duration,
  filesPerSecond: bucket,
  bytesPerSecond: bucket,
});
const layout = object({ ms: duration, budgetMs: number, siblingBudgetMs: number, exceeded: bool });
const query = object({
  tool: choice(TOOLS),
  rank: choice(["top_hotspot", "most_referenced", "largest_directory", "median_file", "median_directory", "cold", "warm"]),
  status: choice(["ok", "skipped", "failed"]),
  ms: duration,
  responseBytes: bucket,
  tokens: bucket,
  truncated: bucket,
  error: choice(ERRORS),
});
const anomaly = object(
  { code: choice(ANOMALIES), source: choice(SKYPLATE_SOURCES), evidence: counters, language: text, phase: choice(PHASES), tool: choice(TOOLS), rank: text },
  ["language", "phase", "tool", "rank"],
);
const failure = object({
  phase: choice([...PHASES, "unknown"]),
  error: choice(ERRORS),
  frames: list(object({ source: choice(SKYPLATE_SOURCES), line: integer, column: integer })),
});
const session = object({
  calls: list(object({ tool: choice(TOOLS), count: bucket, durationMs: distribution, responseBytes: distribution, errors: counters, parameters: counters })),
  transitions: list(object({ previous: choice(TOOLS), next: choice(TOOLS), count: bucket })),
});
const benchmark = object(
  {
    format: choice(["skyplate-benchmark"]),
    version: (v) => v === 1,
    privacy: object({
      level: choice(["aggregate", "skeleton"]),
      coarsening: choice(["power-of-two"]),
      durations: choice(["two-significant-figures"]),
      ratios: choice(["hundredths"]),
      retainsShape: bool,
    }),
    environment: object({
      skyplate: release,
      reportSchema: integer,
      bun: release,
      platform: choice(["darwin", "linux", "win32", "other"]),
      architecture: choice(["arm64", "x64", "arm", "ia32", "other"]),
      cores: bucket,
      memoryBytes: bucket,
    }),
    options: counters,
    scale: object({
      totals: counters,
      languages: list(object({ language: text, totals: counters, diagnostics: counters })),
      categories: list(object({ category: text, totals: counters })),
      distributions: list(distribution),
    }),
    cost: object({
      totalMs: duration,
      samplingMs: number,
      phases: list(phase),
      memory: list(boundary),
      totals: counters,
      workers: counters,
      payloads: counters,
      layout: list(layout),
    }),
    quality: object({
      errors: list(failure),
      imports: list(object({ language: text, internal: bucket, external: bucket, unresolved: bucket, unresolvedShare: ratio, shapes: counters })),
      rates,
      typescript: counters,
      unusedExports: counters,
      entryPoints: counters,
      cycles: counters,
      validation: counters,
      diagnostics: counters,
    }),
    limits: counters,
    queries: list(query),
    anomalies: list(anomaly),
    failures: list(failure),
    session,
    skeleton: (v) => !!v && typeof v === "object", // Its graph/tree constraints are checked by validateSkeleton.
  },
  ["skeleton"],
);

/** Call only after validateVocabulary, which rejects custom serializers and accessors. */
export function validateShape(value: unknown): void {
  if (!benchmark(value)) throw new Error("invalid benchmark shape");
}
