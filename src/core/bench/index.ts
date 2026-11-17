/**
 * `skyplate bench`: an anonymous measurement of one analysis, for whoever maintains Skyplate.
 *
 *   runBenchmark(root)        analyze, measure, and return a closed projection of what happened
 *   writeBenchmark(b, out)    benchmark.json and benchmark.md, in a new folder outside the project
 *   renderMarkdown(b)         the same content, laid out for the person deciding whether to share it
 *
 * Someone runs Skyplate on a repository they are not allowed to share, and it is slow, or wrong,
 * or it fails. What they can hand back is this: what each phase cost, how well imports and the
 * compiler pass resolved, which caps cut something short, how large and slow the agent-facing
 * answers were, and coded anomalies that each name the Skyplate source file to start in
 * (docs/benchmark.md lists them). No path, name, identifier, author or date is in it, by
 * construction (privacy.ts), and nothing is sent anywhere: the command writes two files and
 * says where.
 *
 * The analysis itself is the ordinary one. The extra numbers come through the pipeline's
 * optional diagnostics argument (diagnostics.ts), a side channel, so the Report the viewer
 * reads is unchanged.
 */

import { availableParallelism, homedir, totalmem } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { SCHEMA_VERSION, SymbolFlag, type FileRecord } from "../../shared/schema";
import { computeWeb, webInputFromReport } from "../../shared/web";
import { unusedExportKind } from "../../shared/calls";
import { analyzeProject, DEFAULT_OPTIONS, type AnalysisResult, type AnalyzeOptions, type ProgressEvent } from "../pipeline";
import { dataScript, MAX_ASSET_BYTES, outputPlacement, reportExcludes } from "../site";
import { validateReport } from "../validate";
import { findCandidates } from "../ts/projects";
import { AnalysisDiagnostics, DIAGNOSTIC_CODES } from "./diagnostics";
import {
  ANOMALIES,
  coarse,
  counter,
  counters,
  distribution,
  duration,
  languageId,
  member,
  PHASES,
  rate,
  ratio,
  safeFailure,
  validateVocabulary,
  VALIDATION_RULES,
  type Counter,
  type Rate,
  type SafeFailure,
} from "./privacy";
import { validateShape } from "./shape";
import { makeSkeleton, validateSkeleton, type Skeleton } from "./skeleton";
import { measureQueries, type QueryMeasurement } from "./workload";
import { type SessionSummary, ToolRecorder } from "./recorder";

export { ToolRecorder } from "./recorder";
export { generateSynthetic } from "./skeleton";
export { validateVocabulary } from "./privacy";
export type { ToolSample, SessionSummary } from "./recorder";

interface Boundary {
  phase: string;
  status: string;
  rss: number;
  heap: number;
}
interface PhaseCost {
  phase: string;
  status: string;
  ms: number;
  filesPerSecond: number;
  bytesPerSecond: number;
}
interface Anomaly {
  code: string;
  source: string;
  evidence: Counter[];
  language?: string;
  phase?: string;
  tool?: string;
  rank?: string;
}
interface ImportQuality {
  language: string;
  internal: number;
  external: number;
  unresolved: number;
  unresolvedShare: number;
  shapes: Counter[];
}
interface Group {
  language: string;
  totals: Counter[];
  diagnostics: Counter[];
}
export interface Benchmark {
  format: "skyplate-benchmark";
  version: number;
  privacy: { level: "aggregate" | "skeleton"; coarsening: "power-of-two"; durations: "two-significant-figures"; ratios: "hundredths"; retainsShape: boolean };
  environment: ReturnType<typeof environment>;
  options: Counter[];
  scale: { totals: Counter[]; languages: Group[]; categories: { category: string; totals: Counter[] }[]; distributions: ReturnType<typeof distribution>[] };
  cost: {
    /** Wall time of the whole benchmark run. */
    totalMs: number;
    /** How often memory was sampled: a constant of this file, not a measurement. */
    samplingMs: number;
    phases: PhaseCost[];
    memory: Boundary[];
    totals: Counter[];
    workers: Counter[];
    payloads: Counter[];
    layout: { ms: number; budgetMs: number; siblingBudgetMs: number; exceeded: boolean }[];
  };
  quality: {
    errors: SafeFailure[];
    imports: ImportQuality[];
    /** Shares that say how well the analysis worked (privacy.ts ratio). */
    rates: Rate[];
    typescript: Counter[];
    unusedExports: Counter[];
    entryPoints: Counter[];
    cycles: Counter[];
    validation: Counter[];
    diagnostics: Counter[];
  };
  limits: Counter[];
  queries: QueryMeasurement[];
  anomalies: Anomaly[];
  failures: SafeFailure[];
  session: SessionSummary;
  skeleton?: Skeleton;
}
function version(v: string): number[] {
  // A build suffix may contain a checkout name, so only release components are kept.
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? m.slice(1).map(Number) : [0, 0, 0];
}
function environment() {
  return {
    skyplate: version(pkg.version),
    reportSchema: SCHEMA_VERSION,
    bun: version(Bun.version),
    platform: member(process.platform, ["darwin", "linux", "win32"], "other"),
    architecture: member(process.arch, ["arm64", "x64", "arm", "ia32"], "other"),
    cores: coarse(availableParallelism()),
    memoryBytes: coarse(totalmem()),
  };
}
/** How often memory is sampled while the analysis runs. */
const SAMPLING_MS = 100;

export interface BenchOptions {
  analysis?: Partial<AnalyzeOptions>;
  skeleton?: boolean;
  /** The server can pass its recorder after a live session. Nothing is wired into MCP here. */
  recorder?: ToolRecorder;
}

/** Local only. Returns a closed projection, never an AnalysisResult, path or query answer. */
export async function runBenchmark(root: string, options: BenchOptions = {}): Promise<Benchmark> {
  const opts = { ...DEFAULT_OPTIONS, ...options.analysis };
  const recoverable: SafeFailure[] = [];
  const diagnostics = new AnalysisDiagnostics((error, phase) => {
    if (recording) recoverable.push(safeFailure(error, phase));
  });
  const boundaries: Boundary[] = [],
    phases: PhaseCost[] = [];
  let peakRss = 0,
    peakHeap = 0,
    active = "walk",
    recording = true;
  const starts = new Map<string, number>();
  const sample = () => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    return m;
  };
  const events = (e: ProgressEvent) => {
    if (!recording) return;
    if (e.status === "start") {
      active = e.phase;
      starts.set(e.phase, performance.now());
    }
    const m = sample();
    if (e.status !== "update") boundaries.push({ phase: e.phase, status: e.status, rss: coarse(m.rss), heap: coarse(m.heapUsed) });
    if (e.status === "done" || e.status === "skip")
      phases.push({ phase: e.phase, status: e.status === "skip" ? "skipped" : "ok", ms: duration(e.ms ?? 0), filesPerSecond: 0, bytesPerSecond: 0 });
  };
  const b: Benchmark = {
    format: "skyplate-benchmark",
    version: 1,
    privacy: {
      level: options.skeleton ? "skeleton" : "aggregate",
      coarsening: "power-of-two",
      durations: "two-significant-figures",
      ratios: "hundredths",
      retainsShape: !!options.skeleton,
    },
    environment: environment(),
    options: counters({
      ...Object.fromEntries(
        Object.entries(opts)
          .filter(([, v]) => typeof v === "number" || typeof v === "boolean")
          .map(([k, v]) => [k, Number(v)]),
      ),
      exclude_count: opts.exclude.length,
    }),
    scale: { totals: [], languages: [], categories: [], distributions: [] },
    cost: { totalMs: 0, samplingMs: SAMPLING_MS, phases, memory: boundaries, totals: [], workers: [], payloads: [], layout: [] },
    quality: { errors: recoverable, imports: [], rates: [], typescript: [], unusedExports: [], entryPoints: [], cycles: [], validation: [], diagnostics: [] },
    limits: [],
    queries: [],
    anomalies: [],
    failures: [],
    session: options.recorder?.summary() ?? new ToolRecorder().summary(),
  };
  const started = performance.now();
  sample();
  const timer = setInterval(sample, SAMPLING_MS);
  try {
    const result = await analyzeProject(root, { ...opts, exclude: reportExcludes(root, undefined, opts.exclude) }, events, diagnostics);
    await summarize(b, result, diagnostics, opts);
    if (options.skeleton) b.skeleton = makeSkeleton(result.report);
  } catch (e) {
    b.failures.push(safeFailure(e, active));
    b.anomalies.push({ code: "ANALYSIS_FAILED", source: "src/core/pipeline.ts", evidence: [] });
  } finally {
    recording = false;
    clearInterval(timer);
    sample();
    for (const phase of PHASES) {
      if (!phases.some((p) => p.phase === phase))
        phases.push({
          phase,
          status: starts.has(phase) ? "incomplete" : "skipped",
          ms: starts.has(phase) ? duration(performance.now() - starts.get(phase)!) : 0,
          filesPerSecond: 0,
          bytesPerSecond: 0,
        });
      const row = phases.find((p) => p.phase === phase)!;
      if (
        diagnostics.counts.has(phase === "git" ? "git_failed" : phase === "typescript" ? "ts_failed" : "resolver_failed") &&
        (phase === "git" || phase === "typescript")
      )
        row.status = "failed";
      if (phase === "typescript" && diagnostics.counts.has("ts_file_cap")) row.status = "skipped";
    }
    b.cost.totals = counters({
      peak_rss: peakRss,
      peak_heap: peakHeap,
      high_water_rss: process.resourceUsage().maxRSS * 1024,
    });
    b.cost.totalMs = duration(performance.now() - started);
    b.cost.workers = counters(diagnostics.workers);
    b.quality.diagnostics.push(...[...diagnostics.counts].filter(([, v]) => v > 0).map(([code, value]) => counter(code, value)));
  }
  validateBenchmark(b);
  return b;
}

async function summarize(b: Benchmark, { report: r, symbols: s, sources, chunks }: AnalysisResult, d: AnalysisDiagnostics, opts: AnalyzeOptions): Promise<void> {
  const anomaly = (code: string, source: string, evidence: Record<string, number>) => b.anomalies.push({ code, source, evidence: counters(evidence) });
  const rules: Record<string, number> = {};
  validateReport(r, s, (rule) => {
    const code = member(rule, VALIDATION_RULES, "unclassified_validation");
    rules[code] = (rules[code] ?? 0) + 1;
  });
  b.quality.validation = counters(rules);
  if (Object.keys(rules).length) {
    anomaly("VALIDATION_FAILED", "src/core/validate.ts", { errors: Object.values(rules).reduce((a, c) => a + c, 0) });
    return; // The viewer and query functions assume valid ids. Do not feed them a broken report.
  }
  const files = r.files;
  b.scale.totals = counters({ ...r.totals, secrets: files.filter((f) => f.secret).length });
  const fileTotals = (group: FileRecord[]) =>
    counters({
      files: group.length,
      bytes: group.reduce((n, f) => n + f.bytes, 0),
      lines: group.reduce((n, f) => n + f.lines, 0),
      code: group.reduce((n, f) => n + f.code, 0),
      comment: group.reduce((n, f) => n + f.comment, 0),
      blank: group.reduce((n, f) => n + f.blank, 0),
    });
  const byLang = new Map<string, FileRecord[]>();
  for (const f of files) {
    const id = languageId(f.language);
    const group = byLang.get(id) ?? [];
    group.push(f);
    byLang.set(id, group);
  }
  b.scale.languages = [...byLang]
    .sort(([a], [c]) => a.localeCompare(c))
    .map(([language, group]) => {
      const reasons: Record<string, number> = {};
      for (const f of group) reasons[f.detection] = (reasons[f.detection] ?? 0) + 1;
      return { language, totals: fileTotals(group), diagnostics: counters(reasons) };
    });
  b.scale.categories = r.categories.map((c) => ({ category: c.category, totals: counters({ files: c.files, bytes: c.bytes, lines: c.lines }) }));
  const symbolsPerFile = files.map(() => 0);
  if (s) for (const f of s.symbols.file) if (symbolsPerFile[f] !== undefined) symbolsPerFile[f]!++;
  b.scale.distributions = [
    distribution(
      "file_bytes",
      files.map((f) => f.bytes),
    ),
    distribution(
      "file_lines",
      files.map((f) => f.lines),
    ),
    distribution(
      "file_depth",
      files.map((f) => r.dirs[f.dir]?.depth ?? 0),
    ),
    distribution(
      "directory_fanout",
      r.dirs.map((dir) => dir.dirs.length + dir.files.length),
    ),
    distribution(
      "fanIn",
      files.map((f) => f.fanIn),
    ),
    distribution(
      "fanOut",
      files.map((f) => f.fanOut),
    ),
    distribution("symbols_per_file", symbolsPerFile),
    distribution("references_per_symbol", s?.symbols.refs ?? []),
    distribution(
      "commits_per_file",
      files.map((f) => f.git?.commits ?? 0),
    ),
    distribution(
      "authors_per_file",
      files.map((f) => f.git?.authors ?? 0),
    ),
    distribution(
      "age_days",
      files.filter((f) => f.git).map((f) => Math.max(0, (Date.now() / 1000 - f.git!.created) / 86400)),
    ),
    distribution(
      "cycle_size",
      r.graph.cycles.map((c) => c.files.length),
    ),
  ];
  for (const phase of b.cost.phases) {
    const ms = r.timings[phase.phase] ?? 0;
    if (phase.status !== "skipped" && ms > 0) {
      phase.filesPerSecond = coarse((files.length * 1000) / ms);
      phase.bytesPerSecond = coarse((r.totals.bytes * 1000) / ms);
    }
    // Deliberately loose warning thresholds, not a claim about expected wall time on every CPU.
    const budget = phase.phase === "typescript" || phase.phase === "git" ? 50 : 5;
    if (files.length >= 100 && ms > Math.max(1000, files.length * budget)) {
      anomaly("PHASE_COST_HIGH", phase.phase === "typescript" ? "src/core/ts/index.ts" : phase.phase === "git" ? "src/core/git.ts" : "src/core/pipeline.ts", {
        files: files.length,
        ms,
        budget_ratio: ms / Math.max(1, files.length * budget),
      });
      b.anomalies.at(-1)!.phase = phase.phase;
    }
  }
  const payload = (code: string, name: string, value: unknown) => b.cost.payloads.push(counter(code, Buffer.byteLength(dataScript(name, value))));
  payload("report", "report", r);
  if (s) payload("symbols_payload", "symbols", s);
  for (let i = 0; i < chunks.length; i++) {
    const contents: Record<number, string> = {};
    for (const id of chunks[i]!) contents[id] = sources.get(id)!;
    payload("source_chunk", `source/${i}`, { chunk: i, files: contents });
  }
  b.cost.payloads.push(
    counter(
      "assets",
      files.filter((f) => f.asset).reduce((n, f) => n + f.bytes, 0),
    ),
  );
  const input = webInputFromReport(r);
  let layoutMs = Infinity;
  for (let i = 0; i < 2; i++) {
    const t = performance.now();
    computeWeb(input, i === 0 ? "dependencies" : "complexity");
    layoutMs = Math.min(layoutMs, performance.now() - t);
  }
  const budget = files.length <= 20000 ? 150 : files.length <= 50000 ? 400 : (400 * files.length) / 50000;
  const siblingBudget = r.dirs.some((dir) => dir.dirs.length >= 10000) ? 300 : 0;
  b.cost.layout = [
    {
      ms: duration(layoutMs),
      budgetMs: files.length <= 50000 ? budget : coarse(budget),
      siblingBudgetMs: siblingBudget,
      exceeded: layoutMs > budget || (siblingBudget > 0 && layoutMs > siblingBudget),
    },
  ];
  if (b.cost.layout[0]!.exceeded)
    anomaly("LAYOUT_BUDGET", "src/shared/web.ts", { files: files.length, dirs: r.dirs.length, ms: layoutMs, layout_budget_ms: budget });
  for (const [lang, counts] of d.imports) {
    const language = languageId(lang);
    const total = counts.internal + counts.external + counts.unresolved;
    b.quality.imports.push({
      language,
      internal: coarse(counts.internal),
      external: coarse(counts.external),
      unresolved: coarse(counts.unresolved),
      unresolvedShare: ratio(total ? counts.unresolved / total : 0),
      shapes: counters(counts.shapes),
    });
    if (total >= 20 && counts.internal + counts.external < 0.1 * total) {
      anomaly("IMPORT_RESOLUTION_LOW", "src/core/imports/resolve.ts", {
        files: byLang.get(language)?.length ?? 0,
        internal: counts.internal,
        external: counts.external,
        unresolved: counts.unresolved,
      });
      b.anomalies.at(-1)!.language = language;
    }
  }
  const eligible = findCandidates({
    root: "",
    paths: files.map((f) => f.path),
    languages: files.map((f) => f.language),
    isTest: files.map((f) => f.category === "test"),
    skip: files.map((f) => f.generated || f.vendored),
    configs: [],
    maxFiles: opts.tsMaxFiles,
    maxRefs: opts.tsMaxRefs,
  }).length;
  const present = files.filter((f) => ["typescript", "tsx", "javascript", "jsx"].includes(f.language)).length;
  const covered = s?.stats.files ?? 0,
    refs = (s?.stats.references ?? 0) + (s?.stats.truncated ?? 0),
    unresolved = s?.stats.unresolved ?? 0;
  b.quality.typescript = counters({
    present,
    eligible,
    covered,
    projects: s?.projects.length ?? 0,
    references: refs,
    symbols: s?.stats.symbols ?? 0,
    unresolved,
    uninstalledManifests: s?.stats.uninstalledManifests ?? d.counts.get("uninstalled_manifests") ?? 0,
    hostFiles: s?.stats.hostFiles ?? 0,
  });
  if (opts.symbols && eligible >= 20 && covered < eligible * 0.8 && !d.counts.has("ts_file_cap"))
    anomaly("TS_COVERAGE_LOW", "src/core/ts/projects.ts", { eligible, covered });
  if (unresolved >= 20 && unresolved > 0.3 * (refs + unresolved))
    anomaly("TS_UNRESOLVED_HIGH", "src/core/ts/resolve.ts", {
      references: refs,
      unresolved,
      uninstalledManifests: s?.stats.uninstalledManifests ?? d.counts.get("uninstalled_manifests") ?? 0,
    });
  const unused: Record<string, number> = {};
  let exported = 0,
    unusedCount = 0;
  if (s)
    for (let id = 0; id < s.symbols.name.length; id++) {
      if (s.symbols.flags[id]! & SymbolFlag.exported) exported++;
      const f = files[s.symbols.file[id]!];
      const kind = f ? unusedExportKind(s, id, f) : undefined;
      if (kind) {
        unused[kind] = (unused[kind] ?? 0) + 1;
        unusedCount++;
      }
    }
  b.quality.unusedExports = counters({ exports: exported, unusedExports: unusedCount, ...unused });
  b.quality.rates = [
    rate("ts_coverage", eligible ? covered / eligible : 0),
    rate("ts_unresolved_share", refs + unresolved ? unresolved / (refs + unresolved) : 0),
    rate("unused_export_share", exported ? unusedCount / exported : 0),
  ];
  if (exported >= 20 && unusedCount > 0.8 * exported)
    anomaly("UNUSED_EXPORTS_HIGH", "src/core/ts/tables.ts", { exports: exported, unusedExports: unusedCount, unresolved });
  const entries: Record<string, number> = {};
  for (const f of files) if (f.entry) entries[f.entry] = (entries[f.entry] ?? 0) + 1;
  b.quality.entryPoints = counters(entries);
  b.quality.cycles = counters({ runtime_cycles: r.graph.cycles.length, type_cycles: r.graph.typeLoops?.length ?? 0 });
  b.quality.diagnostics = [counter("warnings_total", r.warnings.length)];
  const sweep = r.git?.sweepFiles ?? 0;
  b.limits = counters({
    rust_use_cap: d.counts.get("rust_use_cap") ?? 0,
    rust_statement_cap: d.counts.get("rust_statement_cap") ?? 0,
    pagerank_iteration_cap: d.counts.get("pagerank_iteration_cap") ?? 0,
    module_split_cap: d.counts.get("module_split_cap") ?? 0,
    git_coupling_cap: d.counts.get("git_coupling_cap") ?? 0,
    git_sweep_threshold: sweep,
    git_sweep_commits: r.git?.commits.width?.filter((w) => w > sweep).length ?? 0,
    asset_size_cap: files.filter((f) => f.category === "image" && f.bytes > MAX_ASSET_BYTES).length,
    source_secret_disabled: r.source?.skipped.disabled ?? 0,
    source_binary_disabled: r.source?.skipped.binary ?? 0,
    symbols_disabled: Number(!opts.symbols),
    git_disabled: Number(!opts.git),
    text_read_cap: d.counts.get("text_read_cap") ?? 0,
    binary_read_cap: d.counts.get("binary_read_cap") ?? 0,
    ts_file_cap: d.counts.get("ts_file_cap") ?? 0,
    ts_reference_cap: s?.stats.truncated ?? 0,
    package_sibling_cap: d.counts.get("package_sibling_cap") ?? 0,
    git_rename_limit: d.counts.get("git_rename_limit") ?? 0,
    git_move_limit: d.counts.get("git_move_limit") ?? 0,
    shallow: Number(r.git?.shallow ?? false),
    truncated: Number(r.git?.truncated ?? false),
    analyzedCommits: r.git?.analyzedCommits ?? 0,
    totalCommits: r.git?.totalCommits ?? 0,
    source_file_cap: r.source?.skipped.tooLarge ?? 0,
    source_total_cap: r.source?.skipped.overBudget ?? 0,
    source_disabled: Number(!opts.source),
  });
  b.queries = await measureQueries({ report: r, ...(s ? { symbols: s } : {}), sources, chunks, abs: [], root: "" });
  for (const q of b.queries) {
    if (q.ms > 1024) {
      anomaly("QUERY_SLOW", "src/mcp/query.ts", { ms: q.ms, responseBytes: q.responseBytes });
      Object.assign(b.anomalies.at(-1)!, { tool: q.tool, rank: q.rank });
    }
    if (q.responseBytes > 65536) {
      anomaly("QUERY_LARGE", "src/mcp/query.ts", { responseBytes: q.responseBytes, tokens: q.tokens });
      Object.assign(b.anomalies.at(-1)!, { tool: q.tool, rank: q.rank });
    }
  }
}

export function validateBenchmark(b: Benchmark): void {
  validateVocabulary(b);
  validateShape(b);
  if (
    b.privacy.retainsShape !== (b.privacy.level === "skeleton") ||
    (b.skeleton && b.privacy.level !== "skeleton") ||
    (!b.skeleton && b.privacy.level === "skeleton" && b.failures.length === 0)
  )
    throw new Error("invalid benchmark privacy level");
  if (b.skeleton) validateSkeleton(b.skeleton);
}

// ─── The readable rendering ──────────────────────────────────────────────────────────────────
//
// Whoever ran the benchmark has to read it before they hand it over, so the Markdown is the
// JSON laid out for reading and nothing else: every leaf is printed, none is summarized, and
// none is added. The layout is generic on purpose. A renderer that knew each section would have
// to be taught about every new field, and a field it was not taught would be in the JSON and
// not in the page, which is the one thing this file must never do.
//
//   an object       a heading, its scalar fields as a list, then its other fields beneath
//   a list of rows  a table, one row each; a nested list is written out inside its cell
//   the skeleton    tables with an `id` column, since a row's position is its id

type Row = Record<string, unknown>;

const scalar = (v: unknown): boolean => v === null || typeof v !== "object";
const scalars = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(scalar);
const hasKeys = (v: unknown, keys: string[]): v is Row => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every((k) => k in v);

/** One value on one line, for a table cell: laid out, never shortened. */
function inline(v: unknown): string {
  if (scalar(v)) return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "none";
    if (scalars(v)) return v.join(", ");
    if (v.every((c) => hasKeys(c, ["code", "value"]))) return (v as Row[]).map((c) => `${c.code} ${c.value}`).join(" · ");
    if (v.every((c) => hasKeys(c, ["upper", "count"]))) return (v as Row[]).map((c) => `≤${c.upper}: ${c.count}`).join(" · ");
    return v.map((x) => `(${inline(x)})`).join(" ");
  }
  return Object.entries(v as Row)
    .map(([k, x]) => `${k} ${scalar(x) ? String(x) : `[${inline(x)}]`}`)
    .join(", ");
}

function table(rows: Row[], withId: boolean): string[] {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const head = withId ? ["id", ...columns] : columns;
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r, i) => `| ${[...(withId ? [String(i)] : []), ...columns.map((c) => (c in r ? inline(r[c]) : ""))].join(" | ")} |`),
  ];
}

function section(lines: string[], key: string, value: unknown, depth: number, withId: boolean): void {
  lines.push("", `${"#".repeat(Math.min(depth, 6))} ${key}`, "");
  if (Array.isArray(value)) {
    if (!value.length) lines.push("None.");
    else if (scalars(value)) lines.push(value.join(", "));
    else lines.push(...table(value as Row[], withId));
    return;
  }
  const entries = Object.entries(value as Row);
  const flat = entries.filter(([, v]) => scalar(v) || scalars(v));
  for (const [k, v] of flat) lines.push(`- ${k}: ${!Array.isArray(v) ? String(v) : v.length ? v.join(k === "skyplate" || k === "bun" ? "." : ", ") : "none"}`);
  for (const [k, v] of entries) if (!flat.some(([f]) => f === k)) section(lines, k, v, depth + 1, withId || k === "skeleton");
}

/** benchmark.md: everything benchmark.json holds, and nothing it does not. */
export function renderMarkdown(b: Benchmark): string {
  validateBenchmark(b);
  const lines = [
    "# Skyplate benchmark",
    "",
    "This page is `benchmark.json` laid out for reading: every value in that file is on this page,",
    "and nothing here is missing from it. It holds numbers, true/false, and words from Skyplate's",
    "own vocabulary (its phases, tools, codes and language names). It holds no path, file name,",
    "identifier, code, author, commit, branch, remote, package name or date.",
    "",
    "- Counts and sizes are rounded up to a power of two.",
    "- Durations (`ms`, `totalMs`) are in milliseconds, to two significant figures.",
    "- Shares (`rates`, `unresolvedShare`) are fractions of 1, to the nearest hundredth.",
    "- Versions, schema constants, source positions in Skyplate's own files and skeleton ids are exact.",
    "",
    "A reader can still tell roughly how large the project is and which languages it uses.",
    ...(b.skeleton ? ["The `skeleton` section also keeps the exact shape of the directory tree and the import graph, as anonymous ids."] : []),
    "Nothing was sent anywhere; sharing this file is your decision.",
    "",
  ];
  const entries = Object.entries(b);
  for (const [k, v] of entries) if (scalar(v)) lines.push(`- ${k}: ${String(v)}`);
  for (const [k, v] of entries) if (!scalar(v)) section(lines, k, v, 2, k === "skeleton");
  return lines.join("\n") + "\n";
}

export function defaultBenchmarkOut(): string {
  // Deliberately ignore XDG_CACHE_HOME: it can point inside the project. Placement is checked too.
  const cache = process.platform === "darwin" ? join(homedir(), "Library", "Caches") : join(homedir(), ".cache");
  return join(cache, "skyplate", "benchmarks", `benchmark-${randomUUID()}`);
}
export function checkBenchmarkOut(out: string, root: string): void {
  if (outputPlacement(out, root) !== "apart") throw new Error("benchmark output must be outside the analyzed project and must not contain it");
  if (existsSync(out)) throw new Error("benchmark output already exists; choose a new directory");
}
export async function writeBenchmark(b: Benchmark, out: string, root: string): Promise<{ json: string; markdown: string }> {
  validateBenchmark(b);
  const jsonText = JSON.stringify(b, null, 2) + "\n",
    markdownText = renderMarkdown(b);
  checkBenchmarkOut(out, root);
  const dest = resolve(out);
  await mkdir(join(dest, ".."), { recursive: true });
  await mkdir(dest, { mode: 0o700 });
  const json = join(dest, "benchmark.json"),
    markdown = join(dest, "benchmark.md");
  try {
    await writeFile(json, jsonText, { flag: "wx", mode: 0o600 });
    await writeFile(markdown, markdownText, { flag: "wx", mode: 0o600 });
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    throw e;
  }
  return { json, markdown };
}
