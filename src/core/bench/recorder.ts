import { coarse, distribution, ERRORS, member, PARAMS, TOOLS, validateVocabulary } from "./privacy";

export interface ToolSample {
  tool: string;
  durationMs: number;
  responseBytes: number;
  /** A code, never an exception message. Unknown codes become unknown_error. */
  errorCode?: string;
  /** Object.keys(params), never params or any parameter value. */
  parameterKeys?: readonly string[];
}
export interface SessionSummary {
  calls: {
    tool: string;
    count: number;
    durationMs: ReturnType<typeof distribution>;
    responseBytes: ReturnType<typeof distribution>;
    errors: { code: string; value: number }[];
    parameters: { code: string; value: number }[];
  }[];
  transitions: { previous: string; next: string; count: number }[];
}
interface LogHistogram {
  counts: Map<number, number>;
  count: number;
}
const histogram = (): LogHistogram => ({ counts: new Map(), count: 0 });
function add(h: LogHistogram, v: number): void {
  const upper = coarse(v);
  h.counts.set(upper, (h.counts.get(upper) ?? 0) + 1);
  h.count++;
}
function summary(metric: string, h: LogHistogram): ReturnType<typeof distribution> {
  const buckets = [...h.counts].sort((a, b) => a[0] - b[0]);
  const quantile = (q: number) => {
    let n = 0;
    for (const [upper, count] of buckets) {
      n += count;
      if (n > Math.floor(q * Math.max(0, h.count - 1))) return upper;
    }
    return 0;
  };
  return {
    metric,
    count: coarse(h.count),
    minimum: quantile(0),
    p50: quantile(0.5),
    p90: quantile(0.9),
    p99: quantile(0.99),
    maximum: quantile(1),
    histogram: buckets.map(([upper, count]) => ({ upper, count: coarse(count) })),
  };
}

/** Bounded memory, no clock, I/O, session identity, timestamps or raw-call retention. */
export class ToolRecorder {
  private readonly rows = new Map<
    string,
    { count: number; ms: LogHistogram; bytes: LogHistogram; errors: Map<string, number>; parameters: Map<string, number> }
  >();
  private readonly transitions = new Map<string, number>();
  private previous?: string;
  record(sample: ToolSample): void {
    // Validate numbers before mutation, so a rejected sample changes nothing.
    coarse(sample.durationMs);
    coarse(sample.responseBytes);
    const tool = member(sample.tool, TOOLS, "unknown_tool");
    let row = this.rows.get(tool);
    if (!row) this.rows.set(tool, (row = { count: 0, ms: histogram(), bytes: histogram(), errors: new Map(), parameters: new Map() }));
    row.count++;
    add(row.ms, sample.durationMs);
    add(row.bytes, sample.responseBytes);
    const code = member(sample.errorCode ?? "none", ERRORS, "unknown_error");
    row.errors.set(code, (row.errors.get(code) ?? 0) + 1);
    for (const key of new Set((sample.parameterKeys ?? []).map((k) => member(k, PARAMS, "unknown_parameter"))))
      row.parameters.set(key, (row.parameters.get(key) ?? 0) + 1);
    if (this.previous) {
      const pair = `${this.previous}\0${tool}`;
      this.transitions.set(pair, (this.transitions.get(pair) ?? 0) + 1);
    }
    this.previous = tool;
  }
  /** Break the sequence between unrelated clients without recording client identity. */
  breakSequence(): void {
    this.previous = undefined;
  }
  summary(): SessionSummary {
    const counts = (m: Map<string, number>) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([code, value]) => ({ code, value: coarse(value) }));
    const result: SessionSummary = {
      calls: [...this.rows]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, row]) => ({
          tool,
          count: coarse(row.count),
          durationMs: summary("ms", row.ms),
          responseBytes: summary("bytes", row.bytes),
          errors: counts(row.errors),
          parameters: counts(row.parameters),
        })),
      transitions: [...this.transitions]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pair, count]) => {
          const [previous, next] = pair.split("\0");
          return { previous: previous!, next: next!, count: coarse(count) };
        }),
    };
    validateVocabulary(result);
    return result;
  }
}
