/**
 * The benchmark's privacy contract, as code.
 *
 * A benchmark is handed back by someone who may not share their repository, so it is anonymous
 * by construction rather than by scrubbing: every value is a number, a boolean, or a string
 * from the lists in this file, all of which Skyplate ships. Nothing here is ever derived from
 * the analyzed project. validateVocabulary walks a finished benchmark and fails closed on
 * anything else, and it runs before a byte is written.
 *
 * Numbers come in three classes, by what each could give away:
 *
 *   coarse()    counts and sizes. An exact file or line count can confirm that a benchmark came
 *               from a repository someone already knows, so each becomes the power of two at or
 *               above it.
 *   duration()  milliseconds, to two significant figures. A time depends on the machine as much
 *               as on the project and identifies neither, and as a power of two a phase that
 *               took five seconds and one that took eight were the same number, which is the
 *               question a benchmark exists to answer.
 *   ratio()     a share of a whole, to the nearest hundredth. "0.79 of eligible files covered"
 *               names no count, and as a power of two every share from 51% to 100% read as 1.
 *
 * Throughputs stay coarse: a precise rate times a precise duration would be a precise count.
 */

import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../languages/linguist.generated";
import { toLanguageId } from "../languages/registry";
import { CATEGORY_GROUP } from "../../shared/schema";
import { DIAGNOSTIC_CODES, SPECIFIER_SHAPES } from "./diagnostics";
import { SKYPLATE_SOURCES } from "./sources";

export const PHASES = ["walk", "detect", "files", "git", "typescript", "imports", "graph", "layout", "stats", "findings"] as const;
/**
 * The MCP server's tools and their argument keys (src/mcp/server.ts), for the session summary.
 * Written out rather than read from the server: a list computed at run time is a list a bug
 * could add a project's string to. test/bench-recorder.test.ts fails when the server gains a
 * tool or an argument that is missing here.
 */
export const TOOLS = [
  ...["map_codebase", "locate_code", "change_impact", "open", "status", "close", "overview", "findings", "files", "file", "dir"],
  ...["search_symbols", "symbol", "seams", "seam", "graph", "history", "dependencies", "read_source", "build_report", "serve_report"],
  ...["benchmark", "unknown_tool"],
] as const;
export const PARAMS = [
  ...["author", "category", "content", "depth", "dir", "ecosystem", "end_line", "exclude", "exported", "files_per_finding", "filter", "flag", "git", "id"],
  ...["impact_depth", "include_generated", "include_ignored", "include_tests", "include_type_only", "include_vendored", "job", "json", "kind", "language"],
  ...["limit", "max_commits", "max_source_file", "max_source_total", "min_files", "name", "offset", "open_browser", "out", "owner", "path", "paths", "port"],
  ...["project", "query", "reanalyze", "redact_paths", "references", "references_offset", "refresh", "runtime_only", "scope", "serve", "severity", "since"],
  ...["skeleton", "sort", "source", "start_line", "stop", "symbols", "to", "token_budget", "ts_max_files", "type", "until", "unused_exports", "unused_kind"],
  ...["view", "wait_seconds", "watch", "weeks", "working_tree", "unknown_parameter"],
] as const;
export const ERRORS = [
  "none",
  "error",
  "type_error",
  "range_error",
  "syntax_error",
  "permission",
  "missing",
  "io",
  "query_error",
  "invalid_parameters",
  "cancelled",
  "timeout",
  "unknown_error",
] as const;
export const ANOMALIES = [
  "IMPORT_RESOLUTION_LOW",
  "TS_COVERAGE_LOW",
  "TS_UNRESOLVED_HIGH",
  "UNUSED_EXPORTS_HIGH",
  "PHASE_COST_HIGH",
  "QUERY_SLOW",
  "QUERY_LARGE",
  "LAYOUT_BUDGET",
  "VALIDATION_FAILED",
  "ANALYSIS_FAILED",
] as const;
export const VALIDATION_RULES = [
  "authors",
  "calls",
  "categories",
  "commits",
  "commits-order",
  "coupling",
  "cycles",
  "dir-children",
  "dir-commits",
  "dir-depth",
  "dir-files",
  "dir-id",
  "dir-parent",
  "dir-totals",
  "duplicates",
  "edges",
  "file-asset",
  "file-cycle",
  "file-dir",
  "file-git",
  "file-hotspot",
  "file-id",
  "file-lines",
  "file-rank",
  "file-ref-start",
  "file-secret",
  "file-src",
  "files",
  "findings",
  "finite",
  "imports",
  "language-churn",
  "languages",
  "layout",
  "module-symbol",
  "modules",
  "punchcard",
  "refs",
  "slots",
  "source",
  "symbols",
  "totals",
  "truck-factor",
  "unclassified_validation",
] as const;
export const METRICS =
  `files dirs bytes lines code comment blank binaryFiles generatedFiles vendoredFiles ignored languages secrets internal external unresolved projects present eligible covered references symbols unusedExports truncated uninstalledManifests coverage unresolvedShare exports unusedShare hostFiles warnings_total analyzedCommits totalCommits shallow age_days commits authors fanIn fanOut file_bytes file_lines file_depth directory_fanout symbols_per_file references_per_symbol commits_per_file authors_per_file cycle_size runtime_cycles type_cycles source_file_cap source_total_cap source_disabled maxReadBytes maxCommits maxSourceFile maxSourceTotal tsMaxFiles tsMaxRefs workers exclude_count includeIgnored git source redactPaths size submitted completed failed spawned queuePeak busyPeak waitMs runMs report symbols_payload source_chunk assets boundary_rss boundary_heap peak_rss peak_heap high_water_rss sampling_ms total_ms layout_ms layout_budget_ms sibling_budget_ms files_per_second bytes_per_second budget_ratio unknown_parameter_count git_sweep_threshold git_sweep_commits asset_size_cap source_secret_disabled source_binary_disabled symbols_disabled git_disabled`.split(
    /\s+/,
  );
const FIELDS =
  `format version privacy environment options scale cost quality limits queries anomalies failures session skeleton level coarsening retainsShape skyplate reportSchema bun platform architecture cores memoryBytes totals languages categories distributions language category metric value count minimum p50 p90 p99 maximum histogram upper phases phase status ms filesPerSecond bytesPerSecond rss heap memory workers payloads layout budgetMs siblingBudgetMs exceeded imports internal external unresolved shapes typescript unusedExports entryPoints cycles validation diagnostics code source evidence error frames line column tool rank responseBytes tokens parameterKeys transitions previous next calls errors parameters unknownParameters durationMs bytes parent dirs files from to kind binary generated vendored secret attributes root file dir edges`.split(
    /\s+/,
  );
export const LANGUAGE_IDS = new Set(["binary", "text", ...LANGUAGES.map((l) => toLanguageId(l[0]))]);
const vocabulary = new Set<string>([
  ...FIELDS,
  ...METRICS,
  ...PHASES,
  ...TOOLS,
  ...PARAMS,
  ...ERRORS,
  ...ANOMALIES,
  ...VALIDATION_RULES,
  ...DIAGNOSTIC_CODES,
  ...SPECIFIER_SHAPES,
  ...SKYPLATE_SOURCES,
  ...LANGUAGE_IDS,
  ...Object.keys(CATEGORY_GROUP),
  "skyplate-benchmark",
  "power-of-two",
  "two-significant-figures",
  "hundredths",
  ...["rates", "totalMs", "samplingMs", "durations", "ratios", "ts_coverage", "ts_unresolved_share", "unused_export_share"],
  "aggregate",
  "skeleton",
  "ok",
  "skipped",
  "failed",
  "incomplete",
  "start",
  "update",
  "done",
  "skip",
  "none",
  "darwin",
  "linux",
  "win32",
  "other",
  "arm64",
  "x64",
  "arm",
  "ia32",
  "filename",
  "extension",
  "heuristic",
  "shebang",
  "modeline",
  "content",
  "fallback",
  "relative",
  "absolute",
  "url",
  "alias",
  "scoped",
  "dotted",
  "bare",
  "unreferenced",
  "entry-export",
  "public-api",
  "used-in-own-file",
  "unknown",
  "package main",
  "package bin",
  "package exports",
  "package script",
  "knip entry",
  "workflow step",
  "agent hook",
  "t3 script",
  "tool config",
  "type declarations",
  "top_hotspot",
  "most_referenced",
  "largest_directory",
  "median_file",
  "median_directory",
  "cold",
  "warm",
  "import",
  "require",
  "include",
  "reference",
  "link",
]);

/** Upper power-of-two bucket. Zero stays zero; no exact dates or raw counts are serialized. */
export function coarse(n: number): number {
  if (!Number.isFinite(n) || n < 0) throw new Error("invalid benchmark measurement");
  const result = n === 0 ? 0 : 2 ** Math.ceil(Math.log2(n));
  if (!Number.isFinite(result)) throw new Error("invalid benchmark measurement");
  return result;
}
/** Milliseconds, to two significant figures (the header says why this is not a bucket). */
export function duration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("invalid benchmark measurement");
  return ms === 0 ? 0 : Number(ms.toPrecision(2));
}
/** A share of a whole, to the nearest hundredth. */
export function ratio(share: number): number {
  if (!Number.isFinite(share) || share < 0) throw new Error("invalid benchmark measurement");
  return Math.round(Math.min(1, share) * 100) / 100;
}
export interface Rate {
  code: string;
  value: number;
}
export const rate = (code: string, share: number): Rate => ({ code, value: ratio(share) });
export function languageId(id: string): string {
  return LANGUAGE_IDS.has(id) ? id : "unknown";
}
export function member(value: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(value) ? value : fallback;
}
export interface Counter {
  code: string;
  value: number;
}
export const counter = (code: string, value: number): Counter => ({ code, value: coarse(value) });
export const counters = (values: Record<string, number>): Counter[] => Object.entries(values).map(([code, value]) => counter(code, value));

/** Check keys as well as values. Unknown strings, NaN, null, accessors and non-JSON objects fail closed. */
export function validateVocabulary(value: unknown): void {
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (!vocabulary.has(v)) throw new Error("benchmark vocabulary violation");
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("benchmark numeric violation");
    } else if (typeof v === "boolean") {
      /* fixed type */
    } else if (v && typeof v === "object") {
      if (seen.has(v)) throw new Error("benchmark cyclic value");
      seen.add(v);
      if (Array.isArray(v)) {
        if (
          Object.getPrototypeOf(v) !== Array.prototype ||
          Reflect.ownKeys(v).some((k) => typeof k !== "string" || (k !== "length" && !/^(0|[1-9]\d*)$/.test(k)))
        )
          throw new Error("benchmark array violation");
        for (let i = 0; i < v.length; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d || !Object.hasOwn(d, "value")) throw new Error("benchmark array accessor violation");
          walk(d.value);
        }
      } else {
        if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error("benchmark object violation");
        if (Reflect.ownKeys(v).some((k) => typeof k !== "string")) throw new Error("benchmark symbol violation");
        for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
          if (!FIELDS.includes(k) && !vocabulary.has(k)) throw new Error("benchmark key violation");
          if (!Object.hasOwn(d, "value")) throw new Error("benchmark accessor violation");
          walk(d.value);
        }
      }
      seen.delete(v);
    } else throw new Error("benchmark type violation");
  };
  walk(value);
}

export interface SafeFailure {
  phase: string;
  error: string;
  frames: { source: string; line: number; column: number }[];
}
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ownSources: ReadonlySet<string> = new Set(SKYPLATE_SOURCES);
export function safeFailure(error: unknown, phase: string): SafeFailure {
  let code = "unknown_error";
  if (error instanceof TypeError) code = "type_error";
  else if (error instanceof RangeError) code = "range_error";
  else if (error instanceof SyntaxError) code = "syntax_error";
  else if (error instanceof Error) code = error.name === "QueryError" || error.constructor.name === "QueryError" ? "query_error" : "error";
  const errno = (error as { code?: unknown } | undefined)?.code;
  if (errno === "EACCES" || errno === "EPERM") code = "permission";
  else if (errno === "ENOENT") code = "missing";
  else if (errno === "EIO" || errno === "ENOSPC") code = "io";
  const frames: SafeFailure["frames"] = [];
  // Match exact installed source paths, not suffixes a project's similarly named file can spoof.
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  for (const line of stack.split("\n").slice(1)) {
    const at = line.indexOf(packageRoot);
    if (at < 0) continue;
    const match = /^(src\/[^\s():]+):(\d+):(\d+)\)?$/.exec(line.slice(at + packageRoot.length));
    if (match && ownSources.has(match[1]!)) frames.push({ source: match[1]!, line: Number(match[2]), column: Number(match[3]) });
    if (frames.length === 12) break;
  }
  return { phase: member(phase, PHASES, "unknown"), error: code, frames };
}

export function distribution(metric: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => coarse(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
  const hist = new Map<number, number>();
  for (const v of values) {
    const bucket = coarse(v);
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
  }
  return {
    metric,
    count: coarse(values.length),
    minimum: pick(0),
    p50: pick(0.5),
    p90: pick(0.9),
    p99: pick(0.99),
    maximum: pick(1),
    histogram: [...hist].sort((a, b) => a[0] - b[0]).map(([upper, count]) => ({ upper, count: coarse(count) })),
  };
}
