/**
 * The starchart report contract.
 *
 * This file is the single seam between the analyzer (runs in Bun, writes the report) and the
 * viewer (runs in the browser, reads it). Both sides import these types; nothing else crosses.
 *
 * Shape rules, and why:
 * - Files, directories, authors and commits are referenced by integer index, never by path or
 *   name. A 40k-file report repeats each reference many times (edges, commits, coupling); paths
 *   would multiply the payload several times over.
 * - Per-file numeric arrays (layout positions) are flat `number[]` with a stride, not arrays of
 *   tuples, so the viewer can hand them to a Float32Array / BufferAttribute without reshaping.
 * - Times are unix seconds (UTC). Milliseconds buy nothing for commit history and cost bytes.
 * - Optional sections are omitted, not nulled, when their input is missing (no git, --no-source).
 */

export const SCHEMA_VERSION = 1 as const;

// ─── Classification ──────────────────────────────────────────────────────────────────────────

/**
 * What a file *is for*. Exactly one per file. Orthogonal facts (generated, vendored, minified)
 * are flags on the record, so a vendored test is still category "test" with `vendored: true`.
 */
export type Category =
  | "code" //       programming-language source that is not a test
  | "test" //       tests, specs, fixtures that sit under test conventions
  | "markup" //     HTML, XML, templates, JSX-free markup
  | "style" //      CSS, SCSS, Less, Stylus
  | "data" //       JSON, CSV, YAML-as-data, SQL dumps, Parquet, protobuf schemas
  | "config" //     dotfiles, tool configs, editor configs, env templates
  | "docs" //       prose: Markdown, reStructuredText, AsciiDoc, plain text, LICENSE, CHANGELOG
  | "build" //      Dockerfile, Makefile, CI workflows, build scripts, IaC
  | "notebook" //   Jupyter and similar cell documents
  | "image" //      raster and vector images (SVG counts here, not as markup)
  | "media" //      audio and video
  | "font" //       font files
  | "archive" //    zip, tar, gz, jar, wheel…
  | "binary" //     executables, object files, databases, model weights, unknown binary
  | "lockfile" //   package-manager lockfiles
  | "unknown"; //   text we could not classify

/** The seven groups the viewer colors by. Categorical palettes cap at 8 slots (see DESIGN). */
export type CategoryGroup =
  | "code"
  | "test"
  | "docs"
  | "config" // config + build + lockfile
  | "data" //   data + notebook
  | "markup" // markup + style
  | "asset"; // image + media + font + archive + binary + unknown

export const CATEGORY_GROUP: Record<Category, CategoryGroup> = {
  code: "code",
  test: "test",
  markup: "markup",
  style: "markup",
  data: "data",
  notebook: "data",
  config: "config",
  build: "config",
  lockfile: "config",
  docs: "docs",
  image: "asset",
  media: "asset",
  font: "asset",
  archive: "asset",
  binary: "asset",
  unknown: "asset",
};

/** How the language was decided. Surfaced in the UI so a wrong guess is explainable. */
export type DetectionReason =
  | "filename" //  exact filename match (Makefile, Dockerfile, .bashrc)
  | "extension" // unambiguous extension
  | "heuristic" // ambiguous extension settled by content rules (.h, .m, .pl, .ts)
  | "shebang" //   #! interpreter line
  | "modeline" //  vim/emacs modeline
  | "content" //   sniffed from bytes (binary magic numbers, JSON/XML shape)
  | "fallback"; // nothing matched; language is "Text" or "Binary"

// ─── Languages ───────────────────────────────────────────────────────────────────────────────

export interface LanguageSummary {
  /** Stable id (lowercase, linguist name slug), e.g. "typescript", "c++", "objective-c". */
  id: string;
  /** Display name, e.g. "TypeScript". */
  name: string;
  /** linguist type. */
  type: "programming" | "markup" | "data" | "prose" | "binary" | "other";
  files: number;
  bytes: number;
  lines: number;
  code: number;
  comment: number;
  blank: number;
  /**
   * Categorical palette slot (0-7) or -1 for the folded "Other" bucket. Assigned once, by
   * descending `code + comment` lines at report time, so color follows the language through
   * every filter instead of being re-ranked when a filter changes the visible set.
   */
  slot: number;
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export interface DirRecord {
  id: number;
  /** Repo-relative POSIX path. The root is "" (and its `name` is the project name). */
  path: string;
  name: string;
  /** Parent directory id; -1 for the root. */
  parent: number;
  depth: number;
  /** Direct children. */
  dirs: number[];
  files: number[];
  /** Recursive totals over every descendant file. */
  totalFiles: number;
  totalBytes: number;
  totalLines: number;
  totalCode: number;
  /** Language id with the most code lines beneath this directory ("" when no code). */
  dominantLanguage: string;
  /** Recursive git churn (commits touching descendants, counted once per commit). */
  commits?: number;
}

// ─── Files ───────────────────────────────────────────────────────────────────────────────────

export interface FileGit {
  /** Commits that touched this file (following renames). */
  commits: number;
  added: number;
  deleted: number;
  /** Distinct authors. */
  authors: number;
  /** Author index (into GitSummary.authors) with the most lines added. */
  owner: number;
  /** Share of added lines by `owner`, 0-1. 1 means a single person wrote it. */
  ownership: number;
  /** Unix seconds. */
  created: number;
  modified: number;
}

/**
 * Format-specific facts the analyzer could read cheaply. All optional; present only when the
 * format applies. Never contains file contents.
 */
export interface FileFacts {
  /** Images: pixel dimensions read from the header. */
  width?: number;
  height?: number;
  /** Notebooks: cell counts. */
  cells?: number;
  codeCells?: number;
  markdownCells?: number;
  /** Notebooks: kernel language. */
  kernel?: string;
  /** CSV/TSV: row and column counts (rows excludes the header). */
  rows?: number;
  columns?: number;
  /** Markdown/AsciiDoc/RST: heading count and title (first H1). */
  headings?: number;
  title?: string;
  /** Markdown: outbound links (absolute URLs) and relative links. */
  links?: number;
  /** JSON/YAML/TOML: top-level key count. */
  keys?: number;
  /** Binary: magic-number format label, e.g. "ELF", "Mach-O", "PDF", "SQLite", "GGUF". */
  format?: string;
}

export interface FileRecord {
  id: number;
  path: string;
  name: string;
  /** Directory id. */
  dir: number;
  /** Lowercased extension without the dot ("" when none). Compound kept: "d.ts" → "ts". */
  ext: string;
  /** Language id (key into Report.languages by id). "text" or "binary" as fallbacks. */
  language: string;
  category: Category;
  detection: DetectionReason;

  bytes: number;
  binary: boolean;
  generated: boolean;
  vendored: boolean;
  /** One very long line, or average line length > 300: almost certainly built output. */
  minified: boolean;

  /** Line counts. All zero for binary files. code + comment + blank === lines. */
  lines: number;
  code: number;
  comment: number;
  blank: number;
  /** Longest line in characters. */
  longestLine: number;

  /**
   * Decision-point count + 1 (McCabe-style, keyword/operator based) for programming languages;
   * 0 for everything else. Comparable within a language family, approximate across them.
   */
  complexity: number;
  /** Deepest block nesting seen (brace or indentation based). */
  maxDepth: number;
  /** Function/method definitions recognized. */
  functions: number;
  /** TODO / FIXME / HACK / XXX markers in comments. */
  todos: number;

  /** Import/include/require statements found (resolved or not). */
  imports: number;
  /** Resolved internal edges in / out (counts of distinct files). */
  fanIn: number;
  fanOut: number;
  /** PageRank over the internal import graph, normalized so the max file is 1. */
  rank: number;
  /** Strongly connected component id when the file sits in an import cycle, else -1. */
  cycle: number;

  /** Content hash (hex, first 16 chars of SHA-1) for duplicate detection. "" for skipped. */
  hash: string;

  git?: FileGit;
  /**
   * Hotspot score 0-1: normalized (log churn × complexity) per Tornhill. 0 when either input is
   * missing. The viewer's hotspot chart and color mode both read this one number.
   */
  hotspot: number;

  facts?: FileFacts;

  /**
   * Where to fetch the file's contents: index into Report.source.chunks, or -1 when not
   * embedded (binary, over the cap, --no-source). Images may instead have `asset`.
   */
  src: number;
  /** Relative URL (from the report root) of a copied asset, e.g. images for preview. */
  asset?: string;
}

// ─── Dependencies ────────────────────────────────────────────────────────────────────────────

export type EdgeKind = "import" | "include" | "require" | "reference" | "link";

/** Flat edge list: [from, to, kind] triples where from/to are file ids. */
export interface EdgeTable {
  from: number[];
  to: number[];
  kind: EdgeKind[];
}

export interface ExternalDependency {
  /** Package / module name as written (normalized: "react", "github.com/spf13/cobra"). */
  name: string;
  /** Ecosystem, e.g. "npm", "pypi", "cargo", "go", "maven", "gem", "composer", "nuget", "system". */
  ecosystem: string;
  /** Version constraint from a manifest, when one declared it. */
  version?: string;
  /** Manifest paths that declare it. Empty when only seen through imports. */
  declaredIn: string[];
  /** "dev" for devDependencies and their equivalents. */
  scope: "runtime" | "dev" | "peer" | "optional" | "build" | "unknown";
  /** Number of distinct files importing it. 0 when declared but never imported. */
  importers: number;
}

export interface Manifest {
  path: string;
  /** "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ... */
  kind: string;
  ecosystem: string;
  /** Declared package/module name, when the manifest names one. */
  name?: string;
  version?: string;
  dependencies: number;
}

export interface Cycle {
  id: number;
  /** File ids in the strongly connected component, sorted by rank descending. */
  files: number[];
}

export interface GraphSummary {
  edges: number;
  /** Files with at least one resolved edge. */
  connected: number;
  /** Import statements that resolved to a file in the repo / to an external package / to nothing. */
  resolved: number;
  external: number;
  unresolved: number;
  cycles: Cycle[];
  /**
   * Directory-level coupling, Robert C. Martin style, for directories at the report's module
   * depth (see `moduleDepth`). Ca = afferent (incoming), Ce = efferent (outgoing).
   */
  modules: {
    dir: number;
    ca: number;
    ce: number;
    /** Ce / (Ca + Ce); 0 = stable, 1 = unstable. */
    instability: number;
  }[];
  /** Matrix of edge counts between `modules` (same order), row = from. */
  moduleMatrix: number[][];
  moduleDepth: number;
}

// ─── Git ─────────────────────────────────────────────────────────────────────────────────────

export interface Author {
  id: number;
  name: string;
  /** Lowercased email (mailmap applied by git). */
  email: string;
  commits: number;
  added: number;
  deleted: number;
  first: number;
  last: number;
  /** Files this author owns (is `owner` of). */
  owned: number;
}

/**
 * Commit table in columnar form. Index i across every array is one commit, newest first.
 * `files[i]` lists current file ids the commit touched (renames followed; files that no longer
 * exist are dropped, so it can be empty).
 */
export interface CommitTable {
  hash: string[]; //    abbreviated (10 chars)
  time: number[];
  author: number[];
  added: number[];
  deleted: number[];
  files: number[][];
  /** First line of the message, truncated to 120 chars. */
  subject: string[];
  /** Conventional-commit type when the subject follows `type(scope): …`, else "". */
  type: string[];
}

export interface CouplingPair {
  a: number;
  b: number;
  /** Commits touching both. */
  shared: number;
  /** shared / min(commits(a), commits(b)), 0-1. */
  degree: number;
}

export interface GitSummary {
  branch: string;
  head: string;
  remote?: string;
  /** Commits in the full history of HEAD. */
  totalCommits: number;
  /** Commits actually analyzed (history may be capped; see `truncated`). */
  analyzedCommits: number;
  truncated: boolean;
  first: number;
  last: number;
  authors: Author[];
  commits: CommitTable;
  /** Weekly buckets from first to last commit. `start` is the Monday 00:00 UTC of the week. */
  weekly: { start: number; commits: number; added: number; deleted: number; authors: number }[];
  /** commits by [weekday 0=Mon..6=Sun][hour 0-23], in the author's local time zone. */
  punchcard: number[][];
  /** Net lines (added - deleted) accumulated over time, sampled per week, all files. */
  growth: { start: number; lines: number; files: number }[];
  /**
   * Lines added per language per month: `months[i]` is the month start; `series[langId][i]` the
   * lines added in that month. Only languages present in Report.languages appear.
   */
  languageChurn: { months: number[]; series: Record<string, number[]> };
  coupling: CouplingPair[];
  /**
   * Truck factor (Avelino et al. 2016, greedy): the fewest authors whose departure leaves more
   * than half the files without an active owner. `authors` lists them in removal order.
   */
  truckFactor: { value: number; authors: number[] };
}

// ─── Statistics and findings ─────────────────────────────────────────────────────────────────

export interface Distribution {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p90: number;
  p99: number;
  /** Gini coefficient 0-1: 0 = perfectly even, 1 = everything in one item. */
  gini: number;
  /** Histogram on log2 bins: bins[i] counts values in [2^i, 2^(i+1)), bins[0] includes 0-1. */
  log2Bins: number[];
}

export interface Stats {
  /** Over code files (category code + test, not generated/vendored). */
  linesPerFile: Distribution;
  complexityPerFile: Distribution;
  /** Over files with git data. */
  commitsPerFile?: Distribution;
  /** Over authors: commits each. Its gini is the "how concentrated is the work" figure. */
  commitsPerAuthor?: Distribution;
  /** Comment lines / (code + comment lines), code files only. */
  commentRatio: number;
  /** Test files / code files. */
  testRatio: number;
  /** Groups of file ids with identical content (size > 0), largest groups first. */
  duplicates: { hash: string; bytes: number; files: number[] }[];
}

export type Severity = "info" | "notice" | "warning" | "critical";

/**
 * A plain-language observation the report leads with. Generated from the numbers, never
 * invented: every finding cites the files or authors it is about.
 */
export interface Finding {
  id: string; //       stable slug, e.g. "hotspot-concentration"
  severity: Severity;
  title: string; //    sentence case, one line, states the fact
  detail: string; //   one or two sentences of why it matters
  files?: number[];
  dirs?: number[];
  authors?: number[];
  /** The headline number behind the finding, for display. */
  metric?: { label: string; value: number; unit?: string };
}

// ─── Layout (written by the analyzer, read by the 3D view) ────────────────────────────────────

export interface Layouts {
  /**
   * Galaxy layout from the directory tree: [x, y, z] per file id, stride 3. Units are arbitrary
   * world units; the viewer frames the bounding sphere.
   */
  tree: number[];
  /** Force layout from the import graph, same stride and file order. */
  graph: number[];
  /** Directory centers in the tree layout, stride 3, by dir id, plus radius per dir. */
  dirCenters: number[];
  dirRadius: number[];
  /** Bounding radius of each layout, for camera framing. */
  radius: { tree: number; graph: number };
}

// ─── Source chunks ───────────────────────────────────────────────────────────────────────────

export interface SourceIndex {
  /** Relative URLs (from the report root) of chunk files, e.g. "data/source/0003.js". */
  chunks: string[];
  /** Files embedded / skipped and why. */
  embedded: number;
  skipped: { binary: number; tooLarge: number; overBudget: number; disabled: number };
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** Payload of one source chunk file: file id → contents. */
export interface SourceChunk {
  chunk: number;
  files: Record<number, string>;
}

// ─── The report ──────────────────────────────────────────────────────────────────────────────

export interface Report {
  schemaVersion: typeof SCHEMA_VERSION;
  tool: { name: "starchart"; version: string };
  /** ISO 8601. */
  generatedAt: string;
  /** Wall-clock analysis time in milliseconds, per phase. */
  timings: Record<string, number>;

  project: {
    name: string;
    /** Absolute path the report was generated from. Omitted with --redact-paths. */
    root?: string;
    /** First paragraph of the root README, plain text, ≤ 400 chars. */
    description?: string;
    readme?: string; // repo-relative path of the README used
    license?: string; // SPDX-ish guess from LICENSE file
  };

  options: {
    git: boolean;
    source: boolean;
    includeIgnored: boolean;
    maxCommits: number;
  };

  totals: {
    files: number;
    dirs: number;
    bytes: number;
    lines: number;
    code: number;
    comment: number;
    blank: number;
    binaryFiles: number;
    generatedFiles: number;
    vendoredFiles: number;
    /** Files the walker skipped (gitignored, too large to read, unreadable). */
    ignored: number;
    languages: number;
  };

  languages: LanguageSummary[];
  categories: { category: Category; files: number; bytes: number; lines: number }[];
  dirs: DirRecord[];
  files: FileRecord[];

  edges: EdgeTable;
  graph: GraphSummary;
  externals: ExternalDependency[];
  manifests: Manifest[];

  git?: GitSummary;
  stats: Stats;
  findings: Finding[];
  layout: Layouts;
  source?: SourceIndex;

  /** Non-fatal problems, shown in the report's about panel. */
  warnings: string[];
}

// ─── Data file protocol ──────────────────────────────────────────────────────────────────────

/**
 * Report data ships as classic scripts, not JSON, so a report folder works when opened straight
 * from disk: browsers refuse fetch() and module scripts over file://, but they still run a
 * plain <script src>. Each data file is one call:
 *
 *   window.__starchart.resolve("report", { ...Report });
 *   window.__starchart.resolve("source/12", { chunk: 12, files: {...} });
 *
 * The viewer installs `window.__starchart` before injecting the tags.
 */
export const DATA_GLOBAL = "__starchart" as const;
export const REPORT_FILE = "data/report.js" as const;
