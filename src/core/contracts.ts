/**
 * Internal module contracts for the analyzer.
 *
 * The analyzer is built as independent modules that the pipeline (src/core/pipeline.ts)
 * composes. Each module owns one concern and exports exactly the functions named here, so the
 * modules can be written, tested and replaced separately. These are types only; every
 * implementation lives in the file named in its section header.
 *
 * Paths are always repo-relative POSIX ("src/a/b.ts"), never absolute, except `abs` fields.
 * File ids are indexes into the walk result's `files` array, in the order the walker returns
 * them (sorted by path), and stay stable through the whole pipeline.
 */

import type {
  Category,
  CodeSymbols,
  DetectionReason,
  EdgeKind,
  ExternalDependency,
  FileFacts,
  FileGit,
  GitSummary,
  GraphSummary,
  Manifest,
} from "../shared/schema";

// ─── src/core/walk.ts ────────────────────────────────────────────────────────────────────────

export interface WalkOptions {
  /** Include files git (or .gitignore) would ignore. */
  includeIgnored: boolean;
  /** Extra glob patterns (gitignore syntax) to exclude. */
  exclude: string[];
}

export interface WalkedFile {
  path: string;
  abs: string;
  bytes: number;
  mtimeMs: number;
}

export interface WalkResult {
  root: string; //          absolute, realpath'd
  files: WalkedFile[]; //   sorted by path
  isGit: boolean;
  /** Files seen but skipped (ignored, unreadable, sockets). */
  ignored: number;
  warnings: string[];
}

export type WalkProject = (root: string, opts: WalkOptions) => Promise<WalkResult>;

// ─── src/core/languages/ (registry.ts, detect.ts, syntax.ts) ─────────────────────────────────

export interface LanguageInfo {
  id: string; //            lowercase slug, stable ("typescript", "c++", "shell")
  name: string; //          display name ("TypeScript")
  type: "programming" | "markup" | "data" | "prose" | "binary" | "other";
  /** linguist color, informational only; the viewer colors by its own validated palette. */
  color?: string;
  /** Parent language for grouping (e.g. "TSX" → "typescript"), when linguist names one. */
  group?: string;
}

export interface Detection {
  language: string; //      LanguageInfo.id; "text" / "binary" as fallbacks
  category: Category;
  reason: DetectionReason;
  generated: boolean;
  vendored: boolean;
  binary: boolean;
  secret: boolean;
  /** Binary magic-number label when known ("PNG", "ELF", "SQLite"...). */
  format?: string;
}

/** `head` is the first ≤ 8 KiB of the file (empty for zero-byte files). */
export type DetectFile = (path: string, head: Uint8Array) => Detection;
export type GetLanguage = (id: string) => LanguageInfo | undefined;

/**
 * Lexical rules for one language family, enough to count comments, find strings to skip,
 * and estimate complexity without a parser.
 */
export interface Syntax {
  /** Line comment openers, e.g. ["//"], ["#"], ["--"], [";"]. */
  line: string[];
  /** Block comment pairs, e.g. [["/*", "*\/"]], [["<!--", "-->"]]. */
  block: [string, string][];
  /** Block comments nest (Rust, Swift, Haskell, OCaml, D). */
  nested?: boolean;
  /** String delimiters to skip, e.g. ['"', "'", "`"]; triple-quoted handled when listed. */
  strings: string[];
  /** Python-style docstrings count as comments when a statement is only a string. */
  docstrings?: boolean;
  /** Words that open a decision point (if, for, while, case, catch, elif, when, &&...). */
  branches: string[];
  /** Regexes (applied per line, comments/strings blanked) that mark a function definition. */
  functions: RegExp[];
  /** Nesting is measured by indentation instead of braces (Python, YAML, CoffeeScript). */
  indent?: boolean;
}

export type GetSyntax = (languageId: string) => Syntax | undefined;

// ─── src/core/metrics.ts ─────────────────────────────────────────────────────────────────────

export interface TextMetrics {
  lines: number;
  code: number;
  comment: number;
  blank: number;
  longestLine: number;
  complexity: number;
  maxDepth: number;
  functions: number;
  todos: number;
  minified: boolean;
  hash: string; //          first 16 hex chars of SHA-1 of the bytes
  facts?: FileFacts;
}

export type MeasureText = (path: string, text: string, languageId: string) => TextMetrics;
export type MeasureBinary = (
  path: string,
  bytes: Uint8Array,
  detection: Detection,
) => { hash: string; facts?: FileFacts };

// ─── src/core/imports/ (extract.ts, resolve.ts) ──────────────────────────────────────────────

export interface RawImport {
  /** Module specifier as written: "./util", "react", "github.com/x/y", "<stdio.h>", "os.path". */
  spec: string;
  kind: EdgeKind;
  line: number; //          0-based
}

export type ExtractImports = (path: string, text: string, languageId: string) => RawImport[];

export interface ResolveContext {
  root: string;
  /** Every repo path, file id = index. */
  paths: string[];
  manifests: Manifest[];
  /** Read a repo file as text (configs: tsconfig.json, go.mod, package.json, Cargo.toml). */
  readText: (path: string) => string | undefined;
}

export type ImportResolution =
  | { file: number } //                                   resolved to a repo file id
  | { external: { name: string; ecosystem: string } } //  a package / stdlib module
  | { unresolved: true };

export type CreateResolver = (
  ctx: ResolveContext,
) => (fromFile: number, imp: RawImport, languageId: string) => ImportResolution;

// ─── src/core/graph.ts ───────────────────────────────────────────────────────────────────────

export interface GraphInput {
  fileCount: number;
  from: number[];
  to: number[];
  /** Directory id of each file and the directory tree, for module-level metrics. */
  fileDir: number[];
  dirParent: number[];
  dirDepth: number[];
}

export interface GraphResult {
  fanIn: number[];
  fanOut: number[];
  rank: number[]; //        PageRank, max-normalized to 1
  cycle: number[]; //       SCC id or -1
  summary: Omit<GraphSummary, "resolved" | "external" | "unresolved">;
}

export type AnalyzeGraph = (input: GraphInput) => GraphResult;

// ─── src/core/manifests.ts ───────────────────────────────────────────────────────────────────

export type ReadManifests = (
  paths: string[],
  readText: (path: string) => string | undefined,
) => { manifests: Manifest[]; dependencies: ExternalDependency[] };

/** README description (first prose paragraph, plain text, ≤ 400 chars) and license guess. */
export type ReadProjectInfo = (
  paths: string[],
  readText: (path: string) => string | undefined,
) => { description?: string; readme?: string; license?: string };

// ─── src/core/git.ts ─────────────────────────────────────────────────────────────────────────

export interface GitInput {
  root: string;
  /** Current repo paths; file id = index. */
  paths: string[];
  /** Language id per file id, for language churn. */
  languages: string[];
  maxCommits: number;
  onProgress?: (done: number, total: number) => void;
}

export interface GitResult {
  summary: GitSummary;
  /** Per file id; undefined for files git never saw (untracked). */
  perFile: (FileGit | undefined)[];
}

/** Resolves to null when root is not inside a git work tree or git is not installed. */
export type MineGit = (input: GitInput) => Promise<GitResult | null>;

// ─── src/core/ts/ (TypeScript 7 compiler API) ────────────────────────────────────────────────

export interface TsInput {
  root: string;
  /** Repo paths, file id = index. Only TS/JS-family files are analyzed. */
  paths: string[];
  languages: string[];
  /** Test-file flag per file id (category === "test"). */
  isTest: boolean[];
  /** Repo-relative tsconfig.json / jsconfig.json paths found by the walker. */
  configs: string[];
  /** Skip the analysis when more TS/JS files than this would be analyzed. */
  maxFiles: number;
  /** Cap on stored references; the rest are counted in stats.truncated. */
  maxRefs: number;
  onProgress?: (message: string) => void;
}

/** Resolves to null when there is nothing to analyze or the compiler cannot start. */
export type AnalyzeTypeScript = (input: TsInput) => Promise<CodeSymbols | null>;
