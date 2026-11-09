/**
 * Questions an agent asks of a report, answered from the tables the viewer reads.
 *
 *   overview(report)                 what this project is, at a glance
 *   files / file / dir               the measured tree
 *   searchSymbols / symbol           code intelligence: declarations, callers, callees, impact
 *   graph                            the import graph: dependents, paths, cycles, modules
 *   history                          git: authors, commits, co-change, activity, ownership
 *   dependencies / findings          externals and manifests; the report's own findings
 *
 * Every function is pure over (Report, CodeSymbols?) and returns plain objects for render().
 * Indexes are built on first use and cached against the table they came from (WeakMap), as
 * the viewer does, so a refreshed snapshot drops them with the old data.
 *
 * Counts follow the viewer's rules, not new ones: callers and callees go through
 * src/shared/calls.ts, fan-in and fan-out count code edges only (Markdown links are listed
 * apart, as the analyzer and the record split them), "own code" is stats.ts's isOwnCode, and
 * search ranks with the command palette's scorer (src/shared/search.ts). An agent and a reader
 * looking at the same report must read the same numbers.
 *
 * Lines are 1-based in every result (see text.ts); the tables store them 0-based.
 */

import { SWEEP_MIN_FILES } from "../core/git/derive";
import { isOwnCode, MIN_HISTORY } from "../core/stats";
import {
  CALL_KINDS,
  callEdges,
  callSite,
  callsThroughBases,
  csr,
  FUNCTION_LIKE,
  heritage,
  hostUsesOf,
  partitionByCall,
  partitionTypeRefs,
  selfCalls,
  unreferenced,
  unusedExportKind,
  type Adjacency,
  type CallEdge,
} from "../shared/calls";
import {
  CATEGORY_GROUP,
  REF_KINDS,
  SymbolFlag,
  type Category,
  type CodeSymbols,
  type CouplingPair,
  type DirRecord,
  type FileRecord,
  type Report,
  type Severity,
  type SymbolKind,
} from "../shared/schema";
import { rankScored, searchable, type Searchable } from "../shared/search";
import { at, clip, day, round, share } from "./text";

/** A question that cannot be answered as asked: the message says what to ask instead. */
export class QueryError extends Error {}

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "notice", "info"];
const DAY = 86_400;

// ─── Indexes ─────────────────────────────────────────────────────────────────────────────────

interface Index {
  path: Map<string, number>;
  dirPath: Map<string, number>;
  /** Code edges (import, include, require, reference): what fanIn / fanOut count. */
  imports: Adjacency;
  importedBy: Adjacency;
  /** Markdown links between files, kept apart for the same reason edgeSplit gives. */
  linksTo: Adjacency;
  linkedFrom: Adjacency;
  /** Commit rows (newest first) per file. */
  commits: Adjacency | null;
  /** Coupling-pair rows per file, either side. */
  coupling: Adjacency | null;
  /** Finding rows citing each file or directory. */
  fileFindings: Map<number, number[]>;
  dirFindings: Map<number, number[]>;
  /** Row of report.graph.modules for a directory that is a module. */
  module: Map<number, number>;
  duplicates: Map<string, number>;
  paths: Searchable;
  /** from * fileCount + to for every type-only edge (EdgeTable.typeOnly). */
  typeOnly: Set<number>;
}

const indexes = new WeakMap<Report, Index>();

function index(report: Report): Index {
  let ix = indexes.get(report);
  if (ix) return ix;
  const n = report.files.length;
  const code: [number[], number[]] = [[], []];
  const link: [number[], number[]] = [[], []];
  const { from, to, kind } = report.edges;
  const seen = new Set<number>();
  for (let i = 0; i < from.length; i++) {
    // One row per (from, to) in each edge set: a file that both imports and requires another
    // depends on it once here, as fanOut counts distinct files.
    const bucket = kind[i] === "link" ? link : code;
    const key = (from[i]! * n + to[i]!) * 2 + (bucket === link ? 1 : 0);
    if (seen.has(key)) continue;
    seen.add(key);
    bucket[0].push(from[i]!);
    bucket[1].push(to[i]!);
  }
  const git = report.git;
  let commits: Adjacency | null = null;
  let coupling: Adjacency | null = null;
  if (git) {
    const keys: number[] = [];
    const rows: number[] = [];
    git.commits.files.forEach((files, row) => {
      for (const f of files) {
        keys.push(f);
        rows.push(row);
      }
    });
    commits = csr(n, keys, rows);
    const ck: number[] = [];
    const cr: number[] = [];
    git.coupling.forEach((p, row) => {
      ck.push(p.a, p.b);
      cr.push(row, row);
    });
    coupling = csr(n, ck, cr);
  }
  const fileFindings = new Map<number, number[]>();
  const dirFindings = new Map<number, number[]>();
  report.findings.forEach((f, row) => {
    for (const id of f.files ?? []) fileFindings.set(id, [...(fileFindings.get(id) ?? []), row]);
    for (const id of f.dirs ?? []) dirFindings.set(id, [...(dirFindings.get(id) ?? []), row]);
  });
  ix = {
    path: new Map(report.files.map((f) => [f.path, f.id])),
    dirPath: new Map(report.dirs.map((d) => [d.path, d.id])),
    imports: csr(n, code[0], code[1]),
    importedBy: csr(n, code[1], code[0]),
    linksTo: csr(n, link[0], link[1]),
    linkedFrom: csr(n, link[1], link[0]),
    commits,
    coupling,
    fileFindings,
    dirFindings,
    module: new Map(report.graph.modules.map((m, row) => [m.dir, row])),
    duplicates: new Map(report.stats.duplicates.map((d, row) => [d.hash, row])),
    paths: searchable(report.files.map((f) => f.path)),
    typeOnly: new Set((report.edges.typeOnly ?? []).map((row) => report.edges.from[row]! * n + report.edges.to[row]!)),
  };
  indexes.set(report, ix);
  return ix;
}

/** Loops only type-only edges close (GraphSummary.typeLoops, computed by the analyzer). */
const typeLoops = (report: Report): number[][] => report.graph.typeLoops ?? [];

const isTypeOnly = (report: Report, from: number, to: number) => index(report).typeOnly.has(from * report.files.length + to);

const nonEmpty = <T,>(rows: T[]): T[] | undefined => (rows.length ? rows : undefined);
const neighbors = (adj: Adjacency, node: number): number[] => Array.from(adj.targets.subarray(adj.offsets[node]!, adj.offsets[node + 1]!));
const degree = (adj: Adjacency, node: number): number => adj.offsets[node + 1]! - adj.offsets[node]!;

interface SymIndex {
  /** Reference rows per symbol, in table order (by file, then position). */
  refsOf: Adjacency;
  /** Symbols declared in each file, by line. */
  inFile: Adjacency;
  /** Members by enclosing symbol. */
  children: Adjacency;
  /** "Class.method" for members, the bare name otherwise. */
  qualified: string[];
  names: Searchable;
}

const symIndexes = new WeakMap<CodeSymbols, SymIndex>();

function symIndex(S: CodeSymbols, fileCount: number): SymIndex {
  let ix = symIndexes.get(S);
  if (ix) return ix;
  const t = S.symbols;
  const count = t.name.length;
  const rows = Array.from({ length: S.refs.symbol.length }, (_, i) => i);
  const byLine = Array.from({ length: count }, (_, i) => i).sort((a, b) => t.file[a]! - t.file[b]! || t.line[a]! - t.line[b]! || a - b);
  const kids = byLine.filter((s) => t.parent[s]! >= 0);
  const qualified = t.name.map((name, i) => {
    const p = t.parent[i]!;
    return p >= 0 && t.kind[p] !== "module" ? `${t.name[p]}.${name}` : name;
  });
  ix = {
    refsOf: csr(count, S.refs.symbol, rows),
    inFile: csr(fileCount, byLine.map((s) => t.file[s]!), byLine),
    children: csr(count, kids.map((s) => t.parent[s]!), kids),
    qualified,
    names: searchable(qualified),
  };
  symIndexes.set(S, ix);
  return ix;
}

// ─── Resolving what the caller named ─────────────────────────────────────────────────────────

/** A repo-relative POSIX path from whatever was passed: "./src/a.ts", "/abs/root/src/a.ts". */
export function normalizePath(report: Report, raw: string): string {
  let p = raw.trim().replaceAll("\\", "/");
  const root = report.project.root?.replaceAll("\\", "/");
  if (root && (p === root || p.startsWith(root + "/"))) p = p.slice(root.length);
  p = p.replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return p === "." ? "" : p;
}

function suggest(report: Report, raw: string): string {
  const hits = rankScored(index(report).paths, raw, 5);
  return hits.length ? ` Closest: ${hits.map((h) => report.files[h.i]!.path).join(", ")}` : "";
}

export function fileId(report: Report, raw: string): number {
  const id = index(report).path.get(normalizePath(report, raw));
  if (id === undefined) throw new QueryError(`no file "${raw}" in this report.${suggest(report, raw)}`);
  return id;
}

export function dirId(report: Report, raw: string): number {
  const id = index(report).dirPath.get(normalizePath(report, raw));
  if (id === undefined) throw new QueryError(`no directory "${raw}" in this report.${suggest(report, raw)}`);
  return id;
}

const GLOB = /[*?[\]{}]/;

/**
 * Files a path argument names: a glob ("src/**\/*.test.ts"), one file, or everything under a
 * directory ("" is the whole project).
 */
export function filesMatching(report: Report, raw: string): Set<number> {
  const ix = index(report);
  const spec = normalizePath(report, raw);
  if (GLOB.test(spec)) {
    const glob = new Bun.Glob(spec);
    return new Set(report.files.filter((f) => glob.match(f.path)).map((f) => f.id));
  }
  const file = ix.path.get(spec);
  if (file !== undefined) return new Set([file]);
  const dir = ix.dirPath.get(spec);
  if (dir !== undefined) return new Set(filesUnder(report, dir));
  throw new QueryError(`no file or directory "${raw}" in this report.${suggest(report, raw)}`);
}

function filesUnder(report: Report, dir: number): number[] {
  const out: number[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = report.dirs[stack.pop()!]!;
    out.push(...d.files);
    stack.push(...d.dirs);
  }
  return out;
}

// ─── Shared row shapes ───────────────────────────────────────────────────────────────────────

const authorName = (report: Report, id: number | undefined): string | undefined =>
  id === undefined || id < 0 ? undefined : report.git?.authors[id]?.name;

function languageName(report: Report, id: string): string {
  return report.languages.find((l) => l.id === id)?.name ?? id;
}

function flagsOf(f: FileRecord): string[] | undefined {
  const flags = (["generated", "vendored", "minified", "binary", "secret"] as const).filter((k) => f[k]);
  if (f.cycle >= 0) (flags as string[]).push("in-cycle");
  if (f.entry) (flags as string[]).push("entry");
  return flags.length ? flags : undefined;
}

export function fileRow(report: Report, f: FileRecord) {
  return {
    path: f.path,
    language: languageName(report, f.language),
    category: f.category,
    lines: f.lines,
    code: f.code,
    complexity: f.complexity || undefined,
    hotspot: f.hotspot ? round(f.hotspot) : undefined,
    rank: f.rank ? round(f.rank) : undefined,
    fanIn: f.fanIn || undefined,
    fanOut: f.fanOut || undefined,
    commits: f.git?.commits,
    owner: authorName(report, f.git?.owner),
    modified: f.git ? day(f.git.modified) : undefined,
    flags: flagsOf(f),
  };
}

function commitRow(report: Report, row: number) {
  const c = report.git!.commits;
  return {
    hash: c.hash[row]!,
    date: day(c.time[row]!),
    author: authorName(report, c.author[row]!),
    subject: c.subject[row]!,
    files: c.files[row]!.length,
    added: c.added[row]!,
    deleted: c.deleted[row]!,
  };
}

const FLAG_NAMES: [number, string][] = [
  [SymbolFlag.exported, "exported"],
  [SymbolFlag.defaultExport, "default"],
  [SymbolFlag.async, "async"],
  [SymbolFlag.generator, "generator"],
  [SymbolFlag.static, "static"],
  [SymbolFlag.abstract, "abstract"],
  [SymbolFlag.private, "private"],
  [SymbolFlag.protected, "protected"],
  [SymbolFlag.deprecated, "deprecated"],
  [SymbolFlag.test, "test"],
  [SymbolFlag.ambient, "ambient"],
  [SymbolFlag.unusedExport, "unused-export"],
];

function symbolFlags(bits: number): string[] | undefined {
  const out = FLAG_NAMES.filter(([bit]) => bits & bit).map(([, name]) => name);
  return out.length ? out : undefined;
}

function symbolAt(report: Report, S: CodeSymbols, s: number): string {
  return at(report.files[S.symbols.file[s]!]!.path, S.symbols.line[s]!);
}

/** A module symbol is a file's top level; it reads as that, not as a name nobody declared. */
function symbolLabel(report: Report, S: CodeSymbols, ix: SymIndex, s: number): string {
  return S.symbols.kind[s] === "module" ? `(top level of ${report.files[S.symbols.file[s]!]!.path})` : ix.qualified[s]!;
}

function symbolRow(report: Report, S: CodeSymbols, ix: SymIndex, s: number) {
  const t = S.symbols;
  return {
    id: s,
    name: symbolLabel(report, S, ix, s),
    kind: t.kind[s]!,
    at: symbolAt(report, S, s),
    refs: t.refs[s]!,
    callers: t.callers[s]!,
    signature: t.signature[s] ? clip(t.signature[s]!, 160) : undefined,
    flags: symbolFlags(t.flags[s]!),
  };
}

function needSymbols(report: Report, S: CodeSymbols | undefined): CodeSymbols {
  if (S) return S;
  throw new QueryError(
    !report.symbols
      ? "this report has no code intelligence: no TypeScript or JavaScript was analyzed (no such files, the pass was skipped with --no-symbols, or there were more than --ts-max-files)"
      : "code intelligence is not loaded for this report",
  );
}

function needGit(report: Report) {
  if (report.git) return report.git;
  throw new QueryError("this report has no git history (not a git repository, or analyzed with --no-git)");
}

// ─── Overview ────────────────────────────────────────────────────────────────────────────────

export function overview(report: Report) {
  const files = report.files;
  const own = files.filter(isOwnCode);
  const top = (score: (f: FileRecord) => number, n = 5) =>
    own
      .filter((f) => score(f) > 0)
      .sort((a, b) => score(b) - score(a) || a.id - b.id)
      .slice(0, n)
      .map((f) => f.path);
  const git = report.git;
  const humans = git?.authors.filter((a) => !a.bot) ?? [];
  const sym = report.symbols;
  const st = report.stats;
  const cycles = report.graph.cycles;
  return {
    project: {
      name: report.project.name,
      root: report.project.root,
      description: report.project.description,
      license: report.project.license,
      readme: report.project.readme,
      generatedAt: report.generatedAt,
      tool: `${report.tool.name} ${report.tool.version}`,
    },
    totals: {
      files: report.totals.files,
      dirs: report.totals.dirs,
      lines: report.totals.lines,
      code: report.totals.code,
      comment: report.totals.comment,
      bytes: report.totals.bytes,
      generated: report.totals.generatedFiles,
      vendored: report.totals.vendoredFiles,
      binary: report.totals.binaryFiles,
      ignored: report.totals.ignored,
    },
    languages: report.languages
      .filter((l) => l.code > 0)
      .slice(0, 10)
      .map((l) => ({ name: l.name, files: l.files, code: l.code, share: share(l.code, report.totals.code) })),
    categories: report.categories.map((c) => ({ category: c.category, files: c.files, lines: c.lines })),
    structure: {
      importEdges: report.graph.edges,
      resolvedImports: report.graph.resolved,
      externalImports: report.graph.external,
      unresolvedImports: report.graph.unresolved,
      cycles: cycles.length,
      largestCycle: cycles.reduce((m, c) => Math.max(m, c.files.length), 0) || undefined,
      typeOnlyEdges: report.edges.typeOnly?.length || undefined,
      // Loops only `import type` closes: not cycles (nothing runs through them), but type
      // coupling an agent should hear about; graph's cycles view lists them.
      typeOnlyLoops: typeLoops(report).length || undefined,
      modules: report.graph.modules.length,
      externals: report.externals.length,
      manifests: report.manifests.map((m) => m.path),
    },
    git: git
      ? {
          branch: git.branch,
          head: git.head,
          remote: git.remote,
          commits: git.analyzedCommits,
          totalCommits: git.totalCommits,
          truncated: git.truncated || undefined,
          shallow: git.shallow || undefined,
          first: day(git.first),
          last: day(git.last),
          authors: humans.length,
          bots: git.authors.length - humans.length || undefined,
          truckFactor: git.truckFactor.value,
          truckFactorAuthors: git.truckFactor.authors.map((a) => authorName(report, a)),
        }
      : undefined,
    codeIntelligence: sym
      ? {
          engine: `${sym.engine.name} ${sym.engine.version}`,
          files: sym.stats.files,
          symbols: sym.stats.symbols,
          references: sym.stats.references,
          unresolved: sym.stats.unresolved,
          unusedExports: sym.stats.unusedExports,
          truncatedRefs: sym.stats.truncated || undefined,
          uninstalledManifests: sym.stats.uninstalledManifests,
          // Share of all identifiers the checker met that it could not resolve. Under a few
          // percent, member-level counts are close; past ten, read them as lower bounds.
          unresolvedShare: round(sym.stats.unresolved / Math.max(1, sym.stats.unresolved + sym.stats.references), 3),
        }
      : undefined,
    stats: {
      medianLinesPerFile: round(st.linesPerFile.median, 1),
      p90LinesPerFile: round(st.linesPerFile.p90, 1),
      medianComplexity: round(st.complexityPerFile.median, 1),
      p90Complexity: round(st.complexityPerFile.p90, 1),
      commentRatio: round(st.commentRatio),
      testRatio: round(st.testRatio),
      duplicateGroups: st.duplicates.length,
    },
    hotspots: top((f) => f.hotspot),
    hubs: top((f) => f.rank),
    findings: report.findings.map((f) => `[${f.severity}] ${f.title} (${f.id})`),
    warnings: report.warnings.length ? report.warnings : undefined,
  };
}

// ─── Findings ────────────────────────────────────────────────────────────────────────────────

export function findings(report: Report, opts: { severity?: Severity; id?: string; limitFiles?: number }) {
  const floor = SEVERITY_ORDER.indexOf(opts.severity ?? "info");
  const max = opts.limitFiles ?? 10;
  const rows = report.findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= floor && (!opts.id || f.id === opts.id));
  if (opts.id && rows.length === 0) {
    throw new QueryError(`no finding "${opts.id}". This report's findings: ${report.findings.map((f) => f.id).join(", ") || "none"}`);
  }
  return rows.map((f) => ({
    id: f.id,
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    metric: f.metric ? `${f.metric.label}: ${round(f.metric.value)}${f.metric.unit ? ` ${f.metric.unit}` : ""}` : undefined,
    files: f.files?.length ? f.files.slice(0, max).map((id) => report.files[id]!.path) : undefined,
    moreFiles: f.files && f.files.length > max ? f.files.length - max : undefined,
    dirs: f.dirs?.length ? f.dirs.map((id) => report.dirs[id]!.path || "(root)") : undefined,
    authors: f.authors?.length ? f.authors.map((id) => authorName(report, id)) : undefined,
  }));
}

// ─── Files ───────────────────────────────────────────────────────────────────────────────────

export const FILE_SORTS = [
  "code",
  "lines",
  "bytes",
  "complexity",
  "functions",
  "depth",
  "todos",
  "hotspot",
  "rank",
  "fan_in",
  "fan_out",
  "commits",
  "authors",
  "added",
  "modified",
  "created",
  "path",
] as const;
export type FileSort = (typeof FILE_SORTS)[number];

const SORT_KEY: Record<Exclude<FileSort, "path">, (f: FileRecord) => number> = {
  code: (f) => f.code,
  lines: (f) => f.lines,
  bytes: (f) => f.bytes,
  complexity: (f) => f.complexity,
  functions: (f) => f.functions,
  depth: (f) => f.maxDepth,
  todos: (f) => f.todos,
  hotspot: (f) => f.hotspot,
  rank: (f) => f.rank,
  fan_in: (f) => f.fanIn,
  fan_out: (f) => f.fanOut,
  commits: (f) => f.git?.commits ?? 0,
  authors: (f) => f.git?.authors ?? 0,
  added: (f) => f.git?.added ?? 0,
  modified: (f) => f.git?.modified ?? 0,
  created: (f) => f.git?.created ?? 0,
};

export const FILE_FLAGS = ["generated", "vendored", "binary", "minified", "secret", "in_cycle", "has_todos", "unimported", "entry", "single_owner"] as const;
export type FileFlag = (typeof FILE_FLAGS)[number];

const FLAG_TEST: Record<FileFlag, (f: FileRecord) => boolean> = {
  generated: (f) => f.generated,
  vendored: (f) => f.vendored,
  binary: (f) => f.binary,
  minified: (f) => f.minified,
  secret: (f) => f.secret,
  in_cycle: (f) => f.cycle >= 0,
  has_todos: (f) => f.todos > 0,
  // Code nothing in the project imports and nothing declares an entry point (FileRecord.entry):
  // the candidates for dead files. Declared entries (package main / bin / exports, a file a
  // script runs, a knip entry, a tool config) are listed by `entry` instead.
  unimported: (f) => f.category === "code" && f.fanIn === 0 && !f.entry,
  entry: (f) => !!f.entry,
  // FileGit.ownership: one author wrote nearly all of it (findings use the same 90%).
  single_owner: (f) => !!f.git && f.git.ownership >= 0.9,
};

export interface FilesQuery {
  path?: string;
  query?: string;
  language?: string;
  category?: string;
  flag?: FileFlag;
  owner?: string;
  includeGenerated?: boolean;
  includeVendored?: boolean;
  sort?: FileSort;
  limit?: number;
  offset?: number;
}

export function files(report: Report, q: FilesQuery) {
  const limit = q.limit ?? 30;
  const offset = q.offset ?? 0;
  let ids: number[] = q.path !== undefined ? [...filesMatching(report, q.path)] : report.files.map((f) => f.id);
  const lang = q.language?.toLowerCase();
  const langIds = lang ? new Set(report.languages.filter((l) => l.id === lang || l.name.toLowerCase() === lang).map((l) => l.id)) : null;
  if (langIds && langIds.size === 0) {
    throw new QueryError(`no language "${q.language}" in this report. Present: ${report.languages.map((l) => l.name).join(", ")}`);
  }
  const owners = q.owner ? new Set(report.git?.authors.filter((a) => a.name.toLowerCase().includes(q.owner!.toLowerCase()) || a.email.includes(q.owner!.toLowerCase())).map((a) => a.id)) : null;
  if (owners && owners.size === 0) throw new QueryError(`no author matching "${q.owner}"`);
  const cat = q.category?.toLowerCase();
  // An explicit flag of generated or vendored asks for those files, so it lifts that default filter.
  const showGenerated = q.includeGenerated || q.flag === "generated";
  const showVendored = q.includeVendored || q.flag === "vendored";
  let hidden = 0;
  ids = ids.filter((id) => {
    const f = report.files[id]!;
    if (langIds && !langIds.has(f.language)) return false;
    if (cat && f.category !== cat && CATEGORY_GROUP[f.category] !== cat) return false;
    if (q.flag && !FLAG_TEST[q.flag](f)) return false;
    if (owners && !(f.git && owners.has(f.git.owner))) return false;
    if ((f.generated && !showGenerated) || (f.vendored && !showVendored)) {
      hidden++;
      return false;
    }
    return true;
  });

  let order = ids;
  if (q.query) {
    const allowed = new Set(ids);
    order = rankScored(index(report).paths, q.query, Number.MAX_SAFE_INTEGER, (i) => allowed.has(i)).map((h) => h.i);
  }
  // Relevance is the default for a query; an explicit sort must order every match before paging.
  if (q.sort === "path" || (!q.sort && !q.query)) {
    order.sort((a, b) => a - b); // file ids are path order
  } else if (q.sort) {
    const key = SORT_KEY[q.sort];
    order.sort((a, b) => key(report.files[b]!) - key(report.files[a]!) || a - b);
  }
  return {
    matched: order.length,
    hiddenGeneratedOrVendored: hidden || undefined,
    offset: offset || undefined,
    files: order.slice(offset, offset + limit).map((id) => fileRow(report, report.files[id]!)),
    more: order.length > offset + limit ? order.length - offset - limit : undefined,
  };
}

export function file(report: Report, S: CodeSymbols | undefined, raw: string, opts: { limit?: number } = {}) {
  const max = opts.limit ?? 25;
  const id = fileId(report, raw);
  const f = report.files[id]!;
  const ix = index(report);
  const list = (ids: number[]) => ({
    count: ids.length,
    files: ids.slice(0, max).map((i) => report.files[i]!.path),
    more: ids.length > max ? ids.length - max : undefined,
  });
  const git = report.git;
  let history;
  if (f.git && git && ix.commits) {
    const rows = neighbors(ix.commits, id);
    const by = new Map<number, number>();
    for (const r of rows) by.set(git.commits.author[r]!, (by.get(git.commits.author[r]!) ?? 0) + 1);
    history = {
      commits: f.git.commits,
      added: f.git.added,
      deleted: f.git.deleted,
      authors: f.git.authors,
      owner: authorName(report, f.git.owner),
      ownership: round(f.git.ownership),
      created: day(f.git.created),
      modified: day(f.git.modified),
      contributors: [...by]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 5)
        .map(([a, n]) => ({ author: authorName(report, a), commits: n })),
      recent: rows.slice(0, 5).map((r) => commitRow(report, r)),
      coChanges: ix.coupling
        ? neighbors(ix.coupling, id)
            .map((row) => git.coupling[row]!)
            .sort((a, b) => b.degree - a.degree || b.shared - a.shared)
            .slice(0, 10)
            .map((p) => ({ path: report.files[p.a === id ? p.b : p.a]!.path, shared: p.shared, degree: round(p.degree) }))
        : undefined,
    };
  }
  let symbols;
  if (S && S.moduleSymbol[id] !== undefined && S.moduleSymbol[id]! >= 0) {
    const sx = symIndex(S, report.files.length);
    const top = neighbors(sx.inFile, id).filter((s) => {
      const p = S.symbols.parent[s]!;
      return S.symbols.kind[s] !== "module" && (p < 0 || S.symbols.kind[p] === "module");
    });
    symbols = {
      count: neighbors(sx.inFile, id).filter((s) => S.symbols.kind[s] !== "module").length,
      topLevel: top.slice(0, 40).map((s) => {
        const r = symbolRow(report, S, sx, s);
        return { id: r.id, name: r.name, kind: r.kind, line: S.symbols.line[s]! + 1, refs: r.refs, callers: r.callers, flags: r.flags };
      }),
      more: top.length > 40 ? top.length - 40 : undefined,
    };
  }
  const dup = f.hash ? report.stats.duplicates[ix.duplicates.get(f.hash) ?? -1] : undefined;
  const cycle = f.cycle >= 0 ? report.graph.cycles.find((c) => c.id === f.cycle) : undefined;
  return {
    path: f.path,
    language: languageName(report, f.language),
    detectedBy: f.detection,
    entry: f.entry ? `entry point: ${f.entry}` : undefined,
    category: f.category,
    flags: flagsOf(f),
    size: { bytes: f.bytes, lines: f.lines, code: f.code, comment: f.comment, blank: f.blank, longestLine: f.longestLine },
    complexity: f.complexity ? { complexity: f.complexity, maxDepth: f.maxDepth, functions: f.functions, todos: f.todos } : undefined,
    facts: f.facts,
    graph: {
      rank: round(f.rank),
      fanIn: f.fanIn,
      fanOut: f.fanOut,
      importStatements: f.imports,
      cycle: cycle ? { size: cycle.files.length, files: cycle.files.slice(0, 12).map((i) => report.files[i]!.path) } : undefined,
    },
    imports: list(neighbors(ix.imports, id)),
    importedBy: list(neighbors(ix.importedBy, id)),
    // Edges the compiler erases (`import type`): coupling, but nothing runs through them.
    typeOnlyImports: nonEmpty(neighbors(ix.imports, id).filter((x) => isTypeOnly(report, id, x)).map((x) => report.files[x]!.path).slice(0, max)),
    typeOnlyImportedBy: nonEmpty(neighbors(ix.importedBy, id).filter((x) => isTypeOnly(report, x, id)).map((x) => report.files[x]!.path).slice(0, max)),
    linksTo: degree(ix.linksTo, id) ? list(neighbors(ix.linksTo, id)) : undefined,
    linkedFrom: degree(ix.linkedFrom, id) ? list(neighbors(ix.linkedFrom, id)) : undefined,
    hotspot: f.hotspot ? round(f.hotspot) : undefined,
    history,
    duplicates: dup ? dup.files.filter((i) => i !== id).map((i) => report.files[i]!.path) : undefined,
    symbols,
    findings: (ix.fileFindings.get(id) ?? []).map((r) => `[${report.findings[r]!.severity}] ${report.findings[r]!.title} (${report.findings[r]!.id})`),
    source: f.secret ? "never shown: looks like it holds credentials" : f.binary ? "binary" : undefined,
  };
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export function dir(report: Report, raw: string, opts: { limit?: number } = {}) {
  const max = opts.limit ?? 30;
  const id = dirId(report, raw);
  const d = report.dirs[id]!;
  const ix = index(report);
  const under = filesUnder(report, id).map((i) => report.files[i]!);
  const own = under.filter(isOwnCode);
  const langs = new Map<string, number>();
  for (const f of own) langs.set(f.language, (langs.get(f.language) ?? 0) + f.code);
  const owners = new Map<number, { files: number; code: number }>();
  for (const f of own) {
    if (!f.git || f.git.owner < 0 || report.git?.authors[f.git.owner]?.bot) continue;
    const o = owners.get(f.git.owner) ?? { files: 0, code: 0 };
    o.files++;
    o.code += f.code;
    owners.set(f.git.owner, o);
  }
  const dirRow = (c: DirRecord) => ({
    path: c.path,
    files: c.totalFiles,
    code: c.totalCode,
    commits: c.commits,
    language: c.dominantLanguage ? languageName(report, c.dominantLanguage) : undefined,
  });
  const children = d.dirs.map((c) => report.dirs[c]!).sort((a, b) => b.totalCode - a.totalCode || a.id - b.id);
  const direct = d.files.map((f) => report.files[f]!).sort((a, b) => b.code - a.code || a.id - b.id);
  const mod = ix.module.get(id);
  const m = mod !== undefined ? report.graph.modules[mod]! : undefined;
  const rows = new Set([...(ix.dirFindings.get(id) ?? [])]);
  const inside = new Set(under.map((f) => f.id));
  report.findings.forEach((f, r) => {
    if (f.files?.some((x) => inside.has(x))) rows.add(r);
  });
  const best = (score: (f: FileRecord) => number) =>
    own
      .filter((f) => score(f) > 0)
      .sort((a, b) => score(b) - score(a) || a.id - b.id)
      .slice(0, 5)
      .map((f) => f.path);
  return {
    path: d.path || "(root)",
    totals: { files: d.totalFiles, bytes: d.totalBytes, lines: d.totalLines, code: d.totalCode, commits: d.commits },
    language: d.dominantLanguage ? languageName(report, d.dominantLanguage) : undefined,
    languages: [...langs]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([l, code]) => ({ language: languageName(report, l), code, share: share(code, d.totalCode) })),
    module: m ? { afferent: m.ca, efferent: m.ce, instability: round(m.instability) } : undefined,
    owners: [...owners]
      .sort((a, b) => b[1].code - a[1].code || a[0] - b[0])
      .slice(0, 5)
      .map(([a, o]) => ({ author: authorName(report, a), files: o.files, code: o.code })),
    hottest: best((f) => f.hotspot),
    hubs: best((f) => f.rank),
    dirs: children.slice(0, max).map(dirRow),
    moreDirs: children.length > max ? children.length - max : undefined,
    files: direct.slice(0, max).map((f) => fileRow(report, f)),
    moreFiles: direct.length > max ? direct.length - max : undefined,
    findings: [...rows].sort((a, b) => a - b).map((r) => `[${report.findings[r]!.severity}] ${report.findings[r]!.title} (${report.findings[r]!.id})`),
  };
}

// ─── Symbols ─────────────────────────────────────────────────────────────────────────────────

export const SYMBOL_SORTS = ["relevance", "refs", "callers", "files", "complexity", "name"] as const;
export type SymbolSort = (typeof SYMBOL_SORTS)[number];

export interface SymbolsQuery {
  query?: string;
  kind?: SymbolKind;
  path?: string;
  exported?: boolean;
  unusedExports?: boolean;
  includeTests?: boolean;
  sort?: SymbolSort;
  limit?: number;
  offset?: number;
  /** Only unused exports of this kind (implies unusedExports). */
  unusedKind?: "unreferenced" | "used-in-own-file" | "entry-export" | "public-api";
}

/**
 * The kind of unused export a symbol is (it carries SymbolFlag.unusedExport), or undefined
 * when it is not one: referenced nowhere (deletable), used inside its own file (it only needs
 * to lose `export`), an export of a declared entry point (FileRecord.entry), which whatever
 * loads the entry may read, or a published package's API (FileRecord.publicApi), which its
 * consumers may use. One function for search_symbols and symbol, so the same id carries the
 * same flag in both.
 */
export function unusedKind(report: Report, S: CodeSymbols, s: number): "unreferenced" | "entry-export" | "public-api" | "used-in-own-file" | undefined {
  return unusedExportKind(S, s, report.files[S.symbols.file[s]!]!);
}

export function searchSymbols(report: Report, Sx: CodeSymbols | undefined, q: SymbolsQuery) {
  const S = needSymbols(report, Sx);
  const t = S.symbols;
  const ix = symIndex(S, report.files.length);
  const limit = q.limit ?? 30;
  const inPath = q.path !== undefined ? filesMatching(report, q.path) : null;
  const include = (s: number) =>
    (q.kind ? t.kind[s] === q.kind : t.kind[s] !== "module") &&
    (!inPath || inPath.has(t.file[s]!)) &&
    (!q.exported || (t.flags[s]! & SymbolFlag.exported) !== 0) &&
    (!(q.unusedExports || q.unusedKind) || (t.flags[s]! & SymbolFlag.unusedExport) !== 0) &&
    (!q.unusedKind || unusedKind(report, S, s) === q.unusedKind) &&
    (q.includeTests !== false || (t.flags[s]! & SymbolFlag.test) === 0);
  const key: Record<Exclude<SymbolSort, "relevance" | "name">, (s: number) => number> = {
    refs: (s) => t.refs[s]!,
    callers: (s) => t.callers[s]!,
    files: (s) => t.files[s]!,
    complexity: (s) => t.complexity[s]!,
  };
  let order: number[];
  const nowhere = q.unusedExports || q.unusedKind ? unreferenced(S) : undefined;
  const sort = q.sort ?? (q.query ? "relevance" : "refs");
  // Four kinds of unused export (unusedKind): referenced nowhere (deletable), used inside its
  // own file (it only needs to lose `export`), an export of a declared entry point, and a
  // published package's API; neither of the last two is dead, and losing `export` there
  // breaks someone.
  const ORDER = { unreferenced: 0, "used-in-own-file": 1, "entry-export": 2, "public-api": 3 } as const;
  const kindOf = (s: number) => ORDER[unusedKind(report, S, s) ?? "used-in-own-file"];
  if (nowhere && !q.sort && !q.query) {
    // Unused exports with no sort asked for: dead first, then used-at-home, then entry exports,
    // each in path order. Sorting by refs put the second kind on top: Millimeters, 18 refs in
    // its own file.
    const pool = Array.from({ length: t.name.length }, (_, i) => i).filter(include);
    order = pool.sort((a, b) => kindOf(a) - kindOf(b) || t.file[a]! - t.file[b]! || t.line[a]! - t.line[b]! || a - b);
  } else if (q.query && sort === "relevance") {
    order = rankScored(ix.names, q.query, Number.MAX_SAFE_INTEGER, include, (s) => t.refs[s]!).map((h) => h.i);
  } else {
    const pool = q.query ? rankScored(ix.names, q.query, Number.MAX_SAFE_INTEGER, include).map((h) => h.i) : Array.from({ length: t.name.length }, (_, i) => i).filter(include);
    order =
      sort === "name" || sort === "relevance"
        ? pool.sort((a, b) => ix.qualified[a]!.localeCompare(ix.qualified[b]!) || a - b)
        : pool.sort((a, b) => key[sort](b) - key[sort](a) || a - b);
  }
  // The header counts every class whatever unused_kind narrows the rows to: a filtered call
  // that reported "used-in-own-file: 0" read as a fact about the project.
  const tally = [0, 0, 0, 0];
  if (nowhere && q.unusedKind) {
    const all = searchSymbols(report, S, { ...q, unusedKind: undefined, unusedExports: true, limit: 1, offset: 0 }).unusedExports!;
    tally.splice(0, 4, all.unreferenced!, all["used-in-own-file"]!, all["entry-export"]!, all["public-api"]!);
  } else if (nowhere) for (const s of order) tally[kindOf(s)]!++;
  return {
    matched: order.length,
    // Named after the row flags: `unreferenced`, `used-in-own-file` (rows carry no flag),
    // `entry-export`, `public-api`.
    unusedExports: nowhere ? { unreferenced: tally[0], "used-in-own-file": tally[1], "entry-export": tally[2], "public-api": tally[3] } : undefined,
    offset: q.offset || undefined,
    symbols: order.slice(q.offset ?? 0, (q.offset ?? 0) + limit).map((s) => {
      const row = symbolRow(report, S, ix, s);
      if (!nowhere) return row;
      const k = kindOf(s);
      // The doc comment travels with an unused export: a comment naming a consumer that does
      // not use it is the strongest evidence against deleting, and fetching it took a call a row.
      const doc = t.doc[s] ? clip(t.doc[s]!, 200) : undefined;
      return k === 1 ? { ...row, doc } : { ...row, doc, flags: [...(row.flags ?? []), (["unreferenced", "", "entry-export", "public-api"] as const)[k]] };
    }),
    more: order.length > (q.offset ?? 0) + limit ? order.length - (q.offset ?? 0) - limit : undefined,
  };
}

/**
 * The one symbol a reference names: an id, or a name ("render", "Workspace.open") narrowed by
 * file and kind. Several matches are an error listing them, not a guess: two `parse`
 * functions in two packages are different questions.
 */
export function resolveSymbol(report: Report, Sx: CodeSymbols | undefined, ref: { id?: number; name?: string; path?: string; kind?: SymbolKind }): number {
  const S = needSymbols(report, Sx);
  const t = S.symbols;
  if (ref.id !== undefined) {
    if (!Number.isInteger(ref.id) || ref.id < 0 || ref.id >= t.name.length) throw new QueryError(`no symbol id ${ref.id}; ids come from search_symbols`);
    return ref.id;
  }
  if (!ref.name) throw new QueryError("pass a symbol id or name");
  const ix = symIndex(S, report.files.length);
  const inPath = ref.path !== undefined ? filesMatching(report, ref.path) : null;
  const ok = (s: number) => (!inPath || inPath.has(t.file[s]!)) && (ref.kind ? t.kind[s] === ref.kind : t.kind[s] !== "module");
  const name = ref.name.trim();
  let hits = ix.qualified.flatMap((q, s) => (q === name || t.name[s] === name) && ok(s) ? [s] : []);
  if (hits.length === 0) {
    const lower = name.toLowerCase();
    hits = ix.qualified.flatMap((q, s) => (q.toLowerCase() === lower || t.name[s]!.toLowerCase() === lower) && ok(s) ? [s] : []);
  }
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) {
    const near = rankScored(ix.names, name, 8, ok, (s) => t.refs[s]!).map((h) => `${ix.qualified[h.i]} #${h.i} (${t.kind[h.i]}, ${symbolAt(report, S, h.i)})`);
    throw new QueryError(`no symbol named "${name}"${ref.path ? ` in ${ref.path}` : ""}.${near.length ? ` Closest: ${near.join("; ")}` : ""}`);
  }
  const listed = hits
    .sort((a, b) => t.refs[b]! - t.refs[a]! || a - b)
    .slice(0, 12)
    .map((s) => `#${s} ${t.kind[s]} at ${symbolAt(report, S, s)}`);
  throw new QueryError(`${hits.length} symbols are named "${name}"; pass id, or narrow with path or kind: ${listed.join("; ")}`);
}

/** Direct callers plus their callers, `depth` levels out, through bases (see callsThroughBases). */
function impact(S: CodeSymbols, start: number, depth: number): Map<number, number> {
  const seen = new Map<number, number>([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: number[] = [];
    for (const s of frontier) {
      const peers = [...callEdges(S, s, "incoming"), ...callsThroughBases(S, s).flatMap((g) => g.edges)];
      for (const e of peers) {
        if (seen.has(e.symbol)) continue;
        seen.set(e.symbol, d);
        next.push(e.symbol);
      }
    }
    frontier = next;
  }
  seen.delete(start);
  return seen;
}

export interface SymbolOpts {
  limit?: number;
  references?: boolean;
  impactDepth?: number;
}

export function symbol(report: Report, Sx: CodeSymbols | undefined, s: number, opts: SymbolOpts = {}) {
  const S = needSymbols(report, Sx);
  const t = S.symbols;
  const ix = symIndex(S, report.files.length);
  const max = opts.limit ?? 20;
  const kindNames = (e: CallEdge) => e.kinds.map((k) => REF_KINDS[k]);
  const edgeRow = (e: CallEdge, site: ReturnType<typeof callSite>) => ({
    id: e.symbol,
    name: symbolLabel(report, S, ix, e.symbol),
    kind: t.kind[e.symbol],
    count: e.count,
    how: kindNames(e),
    site: site ? at(report.files[site.file]!.path, site.line) : undefined,
  });
  const capped = <T,>(rows: T[]) => ({ count: rows.length, rows: rows.slice(0, max), more: rows.length > max ? rows.length - max : undefined });

  const incoming = callEdges(S, s, "incoming");
  const outgoing = callEdges(S, s, "outgoing");
  const { calls, other } = partitionByCall(incoming);
  const { uses, types } = partitionTypeRefs(outgoing);
  // What it runs, apart from what it only reads, writes or passes along: a function's "calls"
  // listed every property it touched beside the functions it called.
  const { calls: runs, other: touches } = partitionByCall(uses);
  const inRow = (e: CallEdge) => edgeRow(e, callSite(S, ix.refsOf, e.symbol, s, CALL_KINDS));
  const outRow = (e: CallEdge) => edgeRow(e, callSite(S, ix.refsOf, s, e.symbol));
  const her = heritage(S, s);
  const bases = callsThroughBases(S, s);
  const host = hostUsesOf(S, s);
  const parent = t.parent[s]!;
  const members = neighbors(ix.children, s);

  let references;
  if (opts.references !== false) {
    const rows = neighbors(ix.refsOf, s);
    const limit = Math.max(max * 5, 50);
    const byFile: { path: string; at: string[] }[] = [];
    for (const r of rows.slice(0, limit)) {
      const path = report.files[S.refs.file[r]!]!.path;
      const pos = `${S.refs.line[r]! + 1}:${S.refs.col[r]! + 1} ${REF_KINDS[S.refs.kind[r]!]}`;
      const last = byFile[byFile.length - 1];
      if (last?.path === path) last.at.push(pos);
      else byFile.push({ path, at: [pos] });
    }
    references = { total: t.refs[s]!, stored: rows.length, byFile, more: rows.length > limit ? rows.length - limit : undefined };
  }

  let blast;
  const depth = opts.impactDepth ?? 0;
  if (depth > 0) {
    const reach = impact(S, s, depth);
    const ids = [...reach.keys()].sort((a, b) => reach.get(a)! - reach.get(b)! || t.refs[b]! - t.refs[a]! || a - b);
    const filesHit = new Map<number, number>();
    for (const x of ids) {
      const f = t.file[x]!;
      filesHit.set(f, Math.min(filesHit.get(f) ?? Infinity, reach.get(x)!));
    }
    const byDepth = Array.from({ length: depth }, (_, i) => ids.filter((x) => reach.get(x) === i + 1).length);
    blast = {
      depth,
      symbols: ids.length,
      byDepth,
      files: filesHit.size,
      fileList: [...filesHit]
        .sort((a, b) => a[1] - b[1] || a[0] - b[0])
        .slice(0, 40)
        .map(([f, d]) => ({ path: report.files[f]!.path, depth: d })),
      moreFiles: filesHit.size > 40 ? filesHit.size - 40 : undefined,
      nearest: ids.slice(0, 30).map((x) => ({ id: x, name: symbolLabel(report, S, ix, x), depth: reach.get(x), at: symbolAt(report, S, x) })),
      moreSymbols: ids.length > 30 ? ids.length - 30 : undefined,
    };
  }

  const fnLike = FUNCTION_LIKE.has(t.kind[s]!);
  return {
    id: s,
    name: ix.qualified[s],
    kind: t.kind[s],
    at: symbolAt(report, S, s),
    endLine: t.endLine[s]! + 1,
    parent: parent >= 0 && t.kind[parent] !== "module" ? { id: parent, name: ix.qualified[parent], kind: t.kind[parent] } : undefined,
    signature: t.signature[s] || undefined,
    doc: t.doc[s] || undefined,
    flags: symbolFlags(t.flags[s]!),
    // The same class search_symbols gives an unused export: unreferenced, used-in-own-file,
    // entry-export or public-api.
    unusedExport: unusedKind(report, S, s),
    // As on seam's interface rows: the in-repo type it hands callers, and the member it forwards.
    exposes: exposedType(S, ix, typesByName(S), s),
    forwardsTo: forwarderOf(S, ix, s),
    complexity: t.complexity[s] || undefined,
    params: fnLike ? t.params[s] : undefined,
    counts: { refs: t.refs[s]!, callers: t.callers[s]!, files: t.files[s]! },
    // Functions are called; everything else is used. "Callers 435" on an interface whose 435
    // rows are type annotations claimed they ran it (see FUNCTION_LIKE).
    [fnLike ? "calledBy" : "usedBy"]: capped(fnLike ? calls.map(inRow) : [...calls, ...other].map(inRow)),
    alsoReferencedBy: fnLike && other.length ? capped(other.map(inRow)) : undefined,
    calledThroughBases: bases.length
      ? bases.map((g) => ({ base: ix.qualified[g.base], baseAt: symbolAt(report, S, g.base), callers: capped(g.edges.map((e) => edgeRow(e, callSite(S, ix.refsOf, e.symbol, g.base, CALL_KINDS)))) }))
      : undefined,
    calls: runs.length ? capped(runs.map(outRow)) : undefined,
    otherUses: touches.length ? capped(touches.map(outRow)) : undefined,
    typesUsed: types.length ? capped(types.map(outRow)) : undefined,
    recursion: selfCalls(S, s) || undefined,
    extends: her.bases.length ? her.bases.map((b) => ({ id: b.symbol, name: ix.qualified[b.symbol], how: REF_KINDS[b.kind], at: symbolAt(report, S, b.symbol) })) : undefined,
    extendedBy: her.derived.length ? her.derived.map((b) => ({ id: b.symbol, name: ix.qualified[b.symbol], how: REF_KINDS[b.kind], at: symbolAt(report, S, b.symbol) })) : undefined,
    members: members.length
      ? capped(members.map((m) => ({ id: m, name: t.name[m], kind: t.kind[m], line: t.line[m]! + 1, refs: t.refs[m], flags: symbolFlags(t.flags[m]!) })))
      : undefined,
    importedByHostFiles: host.length ? host.map((h) => at(report.files[h.file]!.path, h.line)) : undefined,
    references,
    impact: blast,
  };
}

/** Symbols declared on lines [from, to] (1-based, inclusive) of a file, for the source reader. */
export function symbolsInRange(report: Report, S: CodeSymbols | undefined, file: number, from: number, to: number) {
  if (!S) return undefined;
  const ix = symIndex(S, report.files.length);
  const t = S.symbols;
  const rows = neighbors(ix.inFile, file).filter((s) => t.kind[s] !== "module" && t.line[s]! + 1 >= from && t.line[s]! + 1 <= to);
  return rows.length ? rows.slice(0, 60).map((s) => `${t.line[s]! + 1}: ${t.kind[s]} ${ix.qualified[s]} #${s} (${t.refs[s]} refs)`) : undefined;
}

// ─── Import graph ────────────────────────────────────────────────────────────────────────────

export const GRAPH_VIEWS = ["dependents", "dependencies", "path", "cycles", "modules", "hubs"] as const;
export type GraphView = (typeof GRAPH_VIEWS)[number];

function walk(adj: Adjacency, start: Iterable<number>, depth: number, accept?: (from: number, to: number) => boolean): Map<number, number> {
  const seen = new Map<number, number>();
  let frontier = [...start];
  for (const s of frontier) seen.set(s, 0);
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: number[] = [];
    for (const s of frontier)
      for (const x of neighbors(adj, s)) {
        if (accept && !accept(s, x)) continue;
        if (seen.has(x)) continue;
        seen.set(x, d);
        next.push(x);
      }
    frontier = next;
  }
  return seen;
}

export function graph(report: Report, q: { view: GraphView; path?: string; to?: string; depth?: number; limit?: number; includeTypeOnly?: boolean; runtimeOnly?: boolean }) {
  const ix = index(report);
  const limit = q.limit ?? 40;
  const runtime = (from: number, to: number) => !ix.typeOnly.has(from * report.files.length + to);
  switch (q.view) {
    case "dependents":
    case "dependencies": {
      if (q.path === undefined) throw new QueryError(`${q.view} needs a path (a file, a directory or a glob)`);
      const start = filesMatching(report, q.path);
      const depth = q.depth ?? 3;
      const accept = q.runtimeOnly ? (q.view === "dependents" ? (from: number, to: number) => runtime(to, from) : runtime) : undefined;
      const reach = walk(q.view === "dependents" ? ix.importedBy : ix.imports, start, depth, accept);
      for (const s of start) reach.delete(s);
      const rows = [...reach].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      return {
        view: q.view,
        from: q.path,
        depth,
        runtimeOnly: q.runtimeOnly || undefined,
        total: rows.length,
        byDepth: Array.from({ length: depth }, (_, i) => rows.filter(([, d]) => d === i + 1).length),
        files: rows.slice(0, limit).map(([f, d]) => ({ path: report.files[f]!.path, depth: d })),
        more: rows.length > limit ? rows.length - limit : undefined,
      };
    }
    case "path": {
      if (q.path === undefined || q.to === undefined) throw new QueryError("path needs path (from) and to");
      const a = fileId(report, q.path);
      const b = fileId(report, q.to);
      const prev = new Map<number, number>([[a, -1]]);
      let frontier = [a];
      while (frontier.length && !prev.has(b)) {
        const next: number[] = [];
        for (const s of frontier)
          for (const x of neighbors(ix.imports, s)) {
            if (q.runtimeOnly && !runtime(s, x)) continue;
            if (prev.has(x)) continue;
            prev.set(x, s);
            next.push(x);
          }
        frontier = next;
      }
      if (!prev.has(b)) {
        const back = walk(ix.imports, [b], Infinity, q.runtimeOnly ? runtime : undefined).has(a);
        return { view: "path", from: report.files[a]!.path, to: report.files[b]!.path, found: false, runtimeOnly: q.runtimeOnly || undefined, note: back ? "no import path this way, but the reverse exists: swap path and to" : "neither file reaches the other through the selected imports" };
      }
      const ids: number[] = [];
      for (let x = b; x !== -1; x = prev.get(x)!) ids.unshift(x);
      const typeHops = ids.slice(1).flatMap((x, i) => (isTypeOnly(report, ids[i]!, x) ? [`${report.files[ids[i]!]!.path} → ${report.files[x]!.path}`] : []));
      return {
        view: "path",
        found: true,
        runtimeOnly: q.runtimeOnly || undefined,
        hops: ids.length - 1,
        chain: ids.map((x) => report.files[x]!.path),
        // A chain through an `import type` couples the files but never runs end to end.
        typeOnlyHops: typeHops.length ? typeHops : undefined,
      };
    }
    case "cycles": {
      const cycles = [...report.graph.cycles].sort((x, y) => y.files.length - x.files.length || x.id - y.id);
      const only = q.path !== undefined ? filesMatching(report, q.path) : null;
      const rows = only ? cycles.filter((c) => c.files.some((f) => only.has(f))) : cycles;
      // Loops the type-only edges close: components over every code edge that are not one of
      // the runtime cycles above. Breaking one means moving a type, not reordering a module.
      const typed = typeLoops(report).filter((comp) => !only || comp.some((f) => only.has(f)));
      return {
        view: "cycles",
        // Runtime cycles: what breaks evaluation order. Type-only imports close none of these.
        total: rows.length,
        cycles: rows.slice(0, limit).map((c) => ({ size: c.files.length, files: c.files.slice(0, 15).map((f) => report.files[f]!.path), more: c.files.length > 15 ? c.files.length - 15 : undefined })),
        typeOnlyLoops: typed.length || undefined,
        typeOnly: q.includeTypeOnly && typed.length
          ? typed.slice(0, limit).map((comp) => {
              const inside = new Set(comp);
              const closers = comp.flatMap((a) => neighbors(ix.imports, a).filter((b) => inside.has(b) && isTypeOnly(report, a, b)).map((b) => `${report.files[a]!.path} → ${report.files[b]!.path}`));
              const core = comp.filter((f) => report.files[f]!.cycle >= 0).length;
              return {
                size: comp.length,
                files: comp.slice(0, 15).map((f) => report.files[f]!.path),
                more: comp.length > 15 ? comp.length - 15 : undefined,
                // Every type-only import inside the loop. Removing all of them ends it; which
                // subset suffices is not computed (a minimum feedback set), so read the edges
                // into the loop's most-imported file first.
                closedBy: closers.slice(0, 30),
                closedByMore: closers.length > 30 ? closers.length - 30 : undefined,
                // Files of this loop that are also in a runtime cycle; 0 means the loop does not survive without types.
                inRuntimeCycle: core || undefined,
              };
            })
          : undefined,
        note: typed.length && !q.includeTypeOnly ? `${typed.length} more loop(s) exist only through type-only imports; pass include_type_only to list them with the edges that close them` : undefined,
      };
    }
    case "modules": {
      const mods = report.graph.modules;
      const pairs: { from: string; to: string; edges: number }[] = [];
      report.graph.moduleMatrix.forEach((row, i) =>
        row.forEach((n, j) => {
          if (n > 0 && i !== j) pairs.push({ from: report.dirs[mods[i]!.dir]!.path || "(root)", to: report.dirs[mods[j]!.dir]!.path || "(root)", edges: n });
        }),
      );
      pairs.sort((x, y) => y.edges - x.edges || x.from.localeCompare(y.from));
      return {
        view: "modules",
        depth: report.graph.moduleDepth,
        // Robert C. Martin's metrics: afferent = modules depending on it, efferent = modules it
        // depends on, instability = efferent / (afferent + efferent).
        modules: mods
          .map((m) => ({ dir: report.dirs[m.dir]!.path || "(root)", afferent: m.ca, efferent: m.ce, instability: round(m.instability) }))
          .sort((x, y) => y.afferent + y.efferent - (x.afferent + x.efferent) || x.dir.localeCompare(y.dir))
          .slice(0, limit),
        heaviestDependencies: pairs.slice(0, 20),
      };
    }
    case "hubs": {
      const only = q.path !== undefined ? filesMatching(report, q.path) : null;
      const rows = report.files
        .filter((f) => f.fanIn > 0 && (!only || only.has(f.id)))
        .sort((x, y) => y.rank - x.rank || y.fanIn - x.fanIn || x.id - y.id)
        .slice(0, limit);
      return { view: "hubs", files: rows.map((f) => ({ path: f.path, rank: round(f.rank), fanIn: f.fanIn, fanOut: f.fanOut })) };
    }
  }
}

// ─── History ─────────────────────────────────────────────────────────────────────────────────

export const HISTORY_VIEWS = ["summary", "authors", "commits", "coupling", "activity", "ownership"] as const;
export type HistoryView = (typeof HISTORY_VIEWS)[number];

/** "2026-01-31", or "30d" / "12w" / "6m" / "1y" back from now → unix seconds. */
export function parseSince(text: string, now = Date.now() / 1000): number {
  const rel = /^(\d+)\s*([dwmy])$/i.exec(text.trim());
  if (rel) {
    const n = Number(rel[1]);
    const unit = { d: 1, w: 7, m: 30.44, y: 365.25 }[rel[2]!.toLowerCase() as "d" | "w" | "m" | "y"];
    return Math.round(now - n * unit * DAY);
  }
  const t = Date.parse(text.trim());
  if (Number.isNaN(t)) throw new QueryError(`"${text}" is not a date: use YYYY-MM-DD, or 30d, 12w, 6m, 1y`);
  return Math.round(t / 1000);
}

export interface HistoryQuery {
  view: HistoryView;
  path?: string;
  author?: string;
  since?: string;
  until?: string;
  query?: string;
  type?: string;
  weeks?: number;
  limit?: number;
}

export function history(report: Report, q: HistoryQuery) {
  const git = needGit(report);
  const ix = index(report);
  const limit = q.limit ?? 30;
  const inPath = q.path !== undefined ? filesMatching(report, q.path) : null;
  const authorIds = q.author
    ? new Set(git.authors.filter((a) => a.name.toLowerCase().includes(q.author!.toLowerCase()) || a.email.includes(q.author!.toLowerCase())).map((a) => a.id))
    : null;
  if (authorIds && authorIds.size === 0) throw new QueryError(`no author matching "${q.author}"`);

  switch (q.view) {
    case "summary": {
      const types = new Map<string, number>();
      for (const t of git.commits.type) if (t) types.set(t, (types.get(t) ?? 0) + 1);
      const recent = git.weekly.slice(-12);
      return {
        view: "summary",
        branch: git.branch,
        head: git.head,
        remote: git.remote,
        commits: git.analyzedCommits,
        totalCommits: git.totalCommits,
        truncated: git.truncated || undefined,
        shallow: git.shallow || undefined,
        first: day(git.first),
        last: day(git.last),
        authors: git.authors.filter((a) => !a.bot).length,
        bots: git.authors.some((a) => a.bot) ? git.authors.filter((a) => a.bot).map((a) => a.name) : undefined,
        truckFactor: { value: git.truckFactor.value, authors: git.truckFactor.authors.map((a) => authorName(report, a)) },
        commitsPerAuthorGini: report.stats.commitsPerAuthor ? round(report.stats.commitsPerAuthor.gini) : undefined,
        conventionalTypes: types.size ? Object.fromEntries([...types].sort((a, b) => b[1] - a[1])) : undefined,
        last12Weeks: recent.map((w) => ({ week: day(w.start), commits: w.commits, authors: w.authors })),
      };
    }
    case "authors": {
      const rows = git.authors
        .filter((a) => !authorIds || authorIds.has(a.id))
        .sort((a, b) => b.commits - a.commits || a.id - b.id)
        .map((a) => ({ name: a.name, email: a.email, commits: a.commits, added: a.added, deleted: a.deleted, owns: a.owned, first: day(a.first), last: day(a.last), bot: a.bot || undefined }));
      return { view: "authors", total: rows.length, authors: rows.slice(0, limit), more: rows.length > limit ? rows.length - limit : undefined };
    }
    case "commits": {
      const since = q.since ? parseSince(q.since) : -Infinity;
      const until = q.until ? parseSince(q.until) : Infinity;
      const needle = q.query?.toLowerCase();
      const c = git.commits;
      const rows: number[] = [];
      for (let r = 0; r < c.hash.length; r++) {
        if (c.time[r]! < since || c.time[r]! > until) continue;
        if (authorIds && !authorIds.has(c.author[r]!)) continue;
        if (q.type && c.type[r] !== q.type) continue;
        if (needle && !c.subject[r]!.toLowerCase().includes(needle)) continue;
        if (inPath && !c.files[r]!.some((f) => inPath.has(f))) continue;
        rows.push(r);
      }
      return {
        view: "commits",
        total: rows.length,
        commits: rows.slice(0, limit).map((r) => {
          const row = commitRow(report, r);
          return inPath ? { ...row, touched: c.files[r]!.filter((f) => inPath.has(f)).slice(0, 5).map((f) => report.files[f]!.path) } : row;
        }),
        more: rows.length > limit ? rows.length - limit : undefined,
      };
    }
    case "coupling": {
      let pairs: CouplingPair[] = git.coupling;
      if (inPath) pairs = pairs.filter((p) => inPath.has(p.a) || inPath.has(p.b));
      pairs = [...pairs].sort((a, b) => b.degree - a.degree || b.shared - a.shared);
      return {
        view: "coupling",
        // degree = commits touching both / commits of the less-changed file.
        total: pairs.length,
        pairs: pairs.slice(0, limit).map((p) => ({ a: report.files[p.a]!.path, b: report.files[p.b]!.path, shared: p.shared, degree: round(p.degree) })),
        more: pairs.length > limit ? pairs.length - limit : undefined,
      };
    }
    case "activity": {
      const weeks = q.weeks ?? 26;
      const growth = new Map(git.growth.map((g) => [g.start, g]));
      const months = git.languageChurn.months.slice(-6);
      const series = Object.entries(git.languageChurn.series)
        .map(([lang, s]) => ({ language: languageName(report, lang), added: s.slice(-6).reduce((a, b) => a + b, 0), byMonth: s.slice(-6) }))
        .filter((r) => r.added > 0)
        .sort((a, b) => b.added - a.added)
        .slice(0, 6);
      return {
        view: "activity",
        weeks: git.weekly.slice(-weeks).map((w) => ({ week: day(w.start), commits: w.commits, added: w.added, deleted: w.deleted, authors: w.authors, lines: growth.get(w.start)?.lines })),
        linesAddedByLanguage: { months: months.map(day), languages: series },
      };
    }
    case "ownership": {
      const pool = (inPath ? [...inPath] : report.files.map((f) => f.id)).map((i) => report.files[i]!).filter((f) => isOwnCode(f) && f.git);
      const owners = new Map<number, { files: number; code: number; sole: number }>();
      for (const f of pool) {
        if (f.git!.owner < 0 || git.authors[f.git!.owner]?.bot) continue;
        const o = owners.get(f.git!.owner) ?? { files: 0, code: 0, sole: 0 };
        o.files++;
        o.code += f.code;
        if (f.git!.ownership >= 0.9) o.sole++;
        owners.set(f.git!.owner, o);
      }
      const touched = new Map<number, number>();
      if (ix.commits) {
        const rows = new Set<number>();
        for (const f of pool) for (const r of neighbors(ix.commits, f.id)) rows.add(r);
        for (const r of rows) touched.set(git.commits.author[r]!, (touched.get(git.commits.author[r]!) ?? 0) + 1);
      }
      const code = pool.reduce((a, f) => a + f.code, 0);
      return {
        view: "ownership",
        scope: q.path ?? "(whole project)",
        files: pool.length,
        code,
        // FileGit.ownership ≥ 0.9: one person wrote nearly all of it (the findings' threshold).
        singleOwnerFiles: pool.filter((f) => f.git!.ownership >= 0.9).length,
        owners: [...owners]
          .sort((a, b) => b[1].code - a[1].code || a[0] - b[0])
          .slice(0, limit)
          .map(([a, o]) => ({ author: authorName(report, a), files: o.files, code: o.code, codeShare: share(o.code, code), soleOwner: o.sole, active: day(git.authors[a]!.last) })),
        committers: [...touched]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, 10)
          .map(([a, n]) => ({ author: authorName(report, a), commits: n })),
      };
    }
  }
}

// ─── Seams ───────────────────────────────────────────────────────────────────────────────────
//
// A module measured where its interface lives. The vocabulary is codebase design's (module,
// interface, implementation, depth, seam, adapter, leverage, locality; Ousterhout and Feathers,
// as the skyplate-deepen skill uses it), and each term gets the nearest thing the tables can
// count:
//
//   interface        symbols declared inside that code outside uses (the interface as used,
//                    not as exported: an export nothing outside reads is not interface)
//   implementation   code, complexity and functions behind it
//   leverage         outside call sites, callers and files each interface symbol serves
//   locality         how often a commit that touches the module stays inside it, and which
//                    outside files change with it when no import connects them
//   adapters         implementations of an interface the module declares (one adapter is a
//                    hypothetical seam, two a real one)
//   deletion test    relays: functions whose whole body is one call, which a caller could make
//
// No depth score is computed. A ratio of implementation to interface rewards padding the
// implementation (the framing codebase design rejects), so the numbers go out side by side for
// a reader to judge.

const WIRING = new Set([REF_KINDS.indexOf("import"), REF_KINDS.indexOf("export")]);
const JSX = REF_KINDS.indexOf("jsx");
const READ = REF_KINDS.indexOf("read");
const INTERFACE_KINDS = new Set<SymbolKind>(["interface", "class"]);

const isTestFile = (report: Report, f: number) => report.files[f]!.category === "test";

/** Each file's module: its nearest ancestor among `dirs`, or -1. */
function moduleMap(report: Report, dirs: Set<number>): Int32Array {
  const ofDir = new Int32Array(report.dirs.length).fill(-1);
  for (const d of report.dirs) {
    // buildDirs numbers directories depth-first, so a parent's id is lower than its children's
    ofDir[d.id] = dirs.has(d.id) ? d.id : d.parent >= 0 ? ofDir[d.parent]! : -1;
  }
  return Int32Array.from(report.files, (f) => ofDir[f.dir]!);
}

/** A review module holding more than this share of the project's own code is split one level down. */
const REVIEW_SPLIT_SHARE = 0.25;

/**
 * The modules a design review measures: the analyzer's (package roots kept whole), then any
 * module holding over a quarter of the project's own code split into its subdirectories, again
 * until none is. The analyzer stops at 24 modules so the viewer's matrix stays legible; a
 * review lists rows, and one 682-file `apps/game/src` module with 1,611 exports it could hide
 * said nothing about where inside it the seams are. graph's modules view keeps the analyzer's
 * partition, so it agrees with the viewer.
 */
function reviewModules(report: Report): Set<number> {
  const dirs = new Set(report.graph.modules.map((m) => m.dir));
  const subtree = new Float64Array(report.dirs.length);
  for (const f of report.files) {
    if (!isOwnCode(f)) continue;
    for (let d = f.dir; d >= 0; d = report.dirs[d]!.parent) subtree[d]! += f.code;
  }
  const total = subtree[0] ?? 0;
  if (total === 0) return dirs;
  for (let changed = true; changed; ) {
    changed = false;
    const moduleOf = moduleMap(report, dirs);
    const held = new Map<number, number>();
    for (const f of report.files) {
      const m = moduleOf[f.id]!;
      if (m >= 0 && isOwnCode(f)) held.set(m, (held.get(m) ?? 0) + f.code);
    }
    for (const [m, code] of held) {
      if (code <= total * REVIEW_SPLIT_SHARE) continue;
      const kids = report.dirs[m]!.dirs.filter((k) => subtree[k]! > 0 && !dirs.has(k));
      for (const k of kids) dirs.add(k);
      if (kids.length) changed = true;
    }
  }
  return dirs;
}

/** Ranking and drilldown must use the same partition, including residual parent modules. */
function seamModules(report: Report, depth?: number): Set<number> {
  return depth === undefined
    ? reviewModules(report)
    : new Set(report.dirs.filter((d) => d.depth === depth || (d.depth < depth && d.dirs.length === 0)).map((d) => d.id));
}

interface SymbolUse {
  /** References from outside the module, and from every test file, wiring excluded. */
  uses: number;
  /** ...of which from test files. */
  testUses: number;
  files: Set<number>;
  testFiles: Set<number>;
  callers: Set<number>;
  /** References from production files inside the module, wiring excluded. */
  inside: number;
  /** ...and the files they come from, to tell "used only in its own file" from "used by siblings". */
  insideFiles: Set<number>;
}

/**
 * Who uses each symbol from where, relative to a module membership: `group(file)` names the
 * module a file belongs to. One pass over the reference table, plus host-file imports (Vue,
 * Svelte, MDX…), which count as outside uses since something outside the compiler's reach
 * depends on the name.
 *
 * Test files are always clients, inside the module or not: a test exercises the interface
 * from outside, wherever it sits. Counting co-located tests as "inside" hid them, so a module
 * whose tests live beside it (21 of one engine directory's 44 files) read as untested through
 * its interface while the same symbol had 108 test uses one level down.
 */
function symbolUses(report: Report, S: CodeSymbols, group: (file: number) => number): Map<number, SymbolUse> {
  const out = new Map<number, SymbolUse>();
  const at = (s: number) => {
    let u = out.get(s);
    if (!u) out.set(s, (u = { uses: 0, testUses: 0, files: new Set(), testFiles: new Set(), callers: new Set(), inside: 0, insideFiles: new Set() }));
    return u;
  };
  const r = S.refs;
  const declFile = S.symbols.file;
  for (let i = 0; i < r.symbol.length; i++) {
    if (WIRING.has(r.kind[i]!)) continue;
    const s = r.symbol[i]!;
    const home = group(declFile[s]!);
    const file = r.file[i]!;
    if (group(file) === home && home !== -1 && !isTestFile(report, file)) {
      const u = at(s);
      u.inside++;
      u.insideFiles.add(file);
      continue;
    }
    const u = at(s);
    u.uses++;
    u.files.add(file);
    if (isTestFile(report, file)) {
      u.testUses++;
      u.testFiles.add(file);
    } else if (r.from[i]! >= 0) u.callers.add(r.from[i]!);
  }
  const host = S.hostUses;
  if (host) {
    for (let i = 0; i < host.symbol.length; i++) {
      const s = host.symbol[i]!;
      const file = host.file[i]!;
      const u = at(s);
      if (group(file) === group(declFile[s]!) && !isTestFile(report, file)) {
        u.inside++;
        u.insideFiles.add(file);
        continue;
      }
      u.uses++;
      u.files.add(file);
      if (isTestFile(report, file)) {
        u.testUses++;
        u.testFiles.add(file);
      }
    }
  }
  return out;
}

type UseClass = "interface" | "external" | "could-hide" | "internal" | "unused";

/**
 * Where a module's symbol stands, from its production uses:
 *   interface    code outside uses it, or uses its members (a type nothing outside names,
 *                whose fields and methods are read outside, is interface all the same)
 *   internal     exported for sibling files of the module only; TypeScript needs the
 *                `export`, but it is implementation
 *   could-hide   exported, used only in its own file: it can lose `export`
 *   unused       no production code uses it
 * Whether tests reach it is a separate question (testsPast): an internal helper a test calls
 * directly is both internal and tested past the interface. Asking it first, as one class,
 * moved 117 of an engine's internal and could-hide symbols into "tests past" and hid them.
 */
function useClasses(report: Report, S: CodeSymbols, uses: Map<number, SymbolUse>, symbols: number[]): Map<number, UseClass> {
  const t = S.symbols;
  const memberUse = new Map<number, number>();
  for (const s of symbols) {
    const u = uses.get(s);
    const prod = u ? u.uses - u.testUses : 0;
    const p = t.parent[s]!;
    if (prod > 0 && p >= 0 && t.kind[p] !== "module") memberUse.set(p, (memberUse.get(p) ?? 0) + prod);
  }
  const out = new Map<number, UseClass>();
  for (const s of symbols) {
    const u = uses.get(s);
    const prod = u ? u.uses - u.testUses : 0;
    const exported = (t.flags[s]! & SymbolFlag.exported) !== 0;
    const file = report.files[t.file[s]!]!;
    if (prod > 0 || (memberUse.get(s) ?? 0) > 0) out.set(s, "interface");
    // The measured interface counts in-repo clients. Declared consumers outside that graph
    // stay separate, but must never become suggestions to hide or delete an export.
    else if (exported && (file.entry || file.publicApi)) out.set(s, "external");
    else if (exported && u && [...u.insideFiles].some((f) => f !== t.file[s])) out.set(s, "internal");
    // Free to lose `export` only if no test imports it either: seven of an engine's nineteen
    // could-hide symbols were imported by tests, which `export` is there for.
    else if (exported && u && u.inside > 0 && u.testUses === 0) out.set(s, "could-hide");
    else out.set(s, "unused");
  }
  return out;
}

/** Outside production uses of a symbol's members (methods, fields), for a type used that way. */
function memberUses(S: CodeSymbols, uses: Map<number, SymbolUse>, children: Adjacency, s: number): number {
  let n = 0;
  for (const c of neighbors(children, s)) {
    const u = uses.get(c);
    if (u) n += u.uses - u.testUses;
  }
  return n;
}

const typeNameCache = new WeakMap<CodeSymbols, Map<string, number[]>>();

/** Class, interface and type-alias symbols by name, for exposedType. */
function typesByName(S: CodeSymbols): Map<string, number[]> {
  let map = typeNameCache.get(S);
  if (map) return map;
  map = new Map();
  const t = S.symbols;
  for (let x = 0; x < t.name.length; x++) {
    if (t.kind[x] === "class" || t.kind[x] === "interface" || t.kind[x] === "type") map.set(t.name[x]!, [...(map.get(t.name[x]!) ?? []), x]);
  }
  typeNameCache.set(S, map);
  return map;
}

/**
 * The in-repo class, interface or type a property, getter or variable is typed as, with its
 * member count: one interface row can hand callers a whole other interface. `harness`, typed
 * GameHarness, counted as one symbol of an engine's interface while every caller reading it
 * learned GameHarness's 110 members. Read from the printed type; only a bare name (or one
 * `| undefined` / `| null` away) that names exactly one type in the repository counts.
 */
function exposedType(S: CodeSymbols, sx: SymIndex, typeByName: Map<string, number[]>, s: number): string | undefined {
  const t = S.symbols;
  if (!["property", "getter", "variable"].includes(t.kind[s]!)) return undefined;
  const printed = t.signature[s]!.replace(/^readonly\s+/, "").replace(/\s*\|\s*(?:undefined|null)\b/g, "").replace(/<.*>$/, "").trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(printed)) return undefined;
  const hits = typeByName.get(printed) ?? [];
  if (hits.length !== 1) return undefined;
  // Public members only: a `#private` field or a constructor is not something a caller learns.
  const members = neighbors(sx.children, hits[0]!).filter((m) => t.kind[m] !== "constructor" && !(t.flags[m]! & SymbolFlag.private)).length;
  return members > 1 ? `${printed} #${hits[0]} (${members} public members)` : undefined;
}

/**
 * A one-line getter or property initializer that only reads another type's member
 * (`get world() { return this.session.world }`): a forward the relay check misses, because it
 * is a read, not a call. Assigned forwards (`this.harness = this.session.harness` in a
 * constructor) leave no trace in the reference table and are not found.
 */
function forwarderOf(S: CodeSymbols, sx: SymIndex, s: number): string | undefined {
  const t = S.symbols;
  if ((t.kind[s] !== "getter" && t.kind[s] !== "property") || t.endLine[s]! - t.line[s]! > 2) return undefined;
  const { uses } = partitionTypeRefs(callEdges(S, s, "outgoing"));
  if (!uses.length || uses.some((e) => e.kinds.some((k) => k !== READ))) return undefined;
  const owner = t.parent[s];
  const target = uses.find((e) => {
    const p = t.parent[e.symbol]!;
    return p >= 0 && p !== owner && t.kind[p] !== "module" && ["property", "getter", "method"].includes(t.kind[e.symbol]!);
  });
  return target ? sx.qualified[target.symbol] : undefined;
}

/**
 * A function whose body is one call: deleting it moves that call into each caller. Calls into
 * packages and builtins are not in the reference table, so a relay may also call outside code;
 * the result is a candidate to read, not a verdict. A component counts only when its one call
 * renders another in-repo component: JSX of an intrinsic element (<div>) or a package's
 * component leaves no row, so a component that renders a <div> and calls cn() once read as a
 * relay, and every wrapper in a shadcn-style UI kit with it.
 */
function relayOf(S: CodeSymbols, s: number): { to: number; callers: number } | undefined {
  const t = S.symbols;
  // One statement: the declaration line, the body, the close. Complexity alone let a
  // shapes.reduce((sum, s) => sum + s.area(), 0) through, which is a loop, not a forward.
  if (!FUNCTION_LIKE.has(t.kind[s]!) || t.complexity[s]! > 2 || t.endLine[s]! - t.line[s]! > 2) return undefined;
  const out = callEdges(S, s, "outgoing");
  const { calls, other } = partitionByCall(partitionTypeRefs(out).uses);
  if (calls.length !== 1 || other.length > 0) return undefined;
  if (t.kind[s] === "component" && !calls[0]!.kinds.includes(JSX)) return undefined;
  const callers = partitionByCall(callEdges(S, s, "incoming")).calls.length;
  return callers > 0 ? { to: calls[0]!.symbol, callers } : undefined;
}

/**
 * Both files are the project's own production code. Code changing with DESIGN.md or a README
 * every time is a documentation habit, not a dependency hiding from the import graph, and it
 * made up most of the "hidden coupling" in a repository whose docs are kept current.
 */
const codePair = (report: Report, p: CouplingPair) => isProdCode(report.files[p.a]!) && isProdCode(report.files[p.b]!);
/** Own code that is not a test. A test changing with the code it covers, through no direct import, is the test's job, not a hidden dependency. */
const isProdCode = (f: FileRecord) => isOwnCode(f) && f.category !== "test";

/** One definition for ranking and drilldown: a transitive import can explain co-change too. */
function couplingImports(imports: Adjacency, a: number, b: number): "direct" | "indirect" | "none" {
  if (neighbors(imports, a).includes(b) || neighbors(imports, b).includes(a)) return "direct";
  if (walk(imports, [a], 4).has(b) || walk(imports, [b], 4).has(a)) return "indirect";
  return "none";
}

/**
 * Commits wider than this are sweeps: the cutoff the analyzer chose for this history and used
 * for its coupling (GitSummary.sweepFiles, src/core/git/derive.ts sweepWidth), so a module's
 * co-change pairs and its spread rest on the same commits. Reports from before it was recorded
 * used a fixed 30.
 */
const sweepOf = (report: Report) => report.git?.sweepFiles ?? SWEEP_MIN_FILES;
const LEGACY_WIDTH_NOTE = "original commit widths were not recorded: spread and locality use surviving files, so deleted or excluded paths may hide sweeps";

export const SEAM_SORTS = ["hotspot", "interface", "spread", "hidden", "relays", "tests_past", "code"] as const;
export type SeamSort = (typeof SEAM_SORTS)[number];

/**
 * Every module of the report (the analyzer's adaptive modules, or directories at `depth`),
 * with the signals a deepening review starts from, sorted by one of them. A ranking for where
 * to look, not a verdict: the skill reads the numbers, then the code.
 */
export function seams(report: Report, S: CodeSymbols | undefined, q: { depth?: number; sort?: SeamSort; limit?: number; offset?: number }) {
  const limit = q.limit ?? 25;
  const offset = q.offset ?? 0;
  const dirs = seamModules(report, q.depth);
  if (dirs.size === 0) throw new QueryError("this report has no modules (no resolved imports); pass depth to measure directories at a fixed depth");
  const moduleOf = moduleMap(report, dirs);
  const ix = index(report);
  const rows = new Map<number, ReturnType<typeof blank>>();
  function blank() {
    return { files: 0, testFiles: 0, code: 0, complexity: 0, hotspot: 0, hottest: -1, commits: 0, basis: 0, leaving: 0, others: 0, interface: 0, couldHide: 0, internal: 0, testsPast: 0, relays: 0, hidden: 0, cycles: new Set<number>(), inbound: new Set<number>(), outbound: new Set<number>() };
  }
  for (const d of dirs) rows.set(d, blank());
  for (const f of report.files) {
    const m = moduleOf[f.id]!;
    const row = rows.get(m);
    if (!row) continue;
    // Match seam's implementation and tests: config, data, generated and vendored files
    // cannot inflate the file count while contributing nothing to its code or complexity.
    const own = isOwnCode(f);
    if (f.category === "test") {
      if (own) row.testFiles++;
      continue;
    }
    if (own) {
      row.files++;
      row.code += f.code;
      row.complexity += f.complexity;
    }
    row.hotspot += f.hotspot;
    if (f.hotspot > 0 && (row.hottest < 0 || f.hotspot > report.files[row.hottest]!.hotspot)) row.hottest = f.id;
    for (const x of neighbors(ix.importedBy, f.id)) if (moduleOf[x] !== m && report.files[x]!.category !== "test") row.inbound.add(x);
    for (const x of neighbors(ix.imports, f.id)) if (moduleOf[x] !== m) row.outbound.add(x);
  }
  for (const c of report.graph.cycles) {
    const touched = new Set(c.files.map((f) => moduleOf[f]!));
    if (touched.size > 1) for (const m of touched) rows.get(m)?.cycles.add(c.id);
  }
  const git = report.git;
  const sweep = sweepOf(report);
  if (git) {
    git.commits.files.forEach((files, i) => {
      if (files.length === 0) return;
      const touched = new Set(files.map((f) => moduleOf[f]!));
      // Every commit counts toward `commits`; only commits narrower than the sweep width say
      // anything about where a change travels, so spread and leaving rest on those.
      const wide = (git.commits.width?.[i] ?? files.length) > sweep;
      const codeModules = wide ? undefined : new Set(files.filter((f) => isOwnCode(report.files[f]!)).map((f) => moduleOf[f]!));
      for (const m of touched) {
        const row = rows.get(m);
        if (!row) continue;
        row.commits++;
        if (!codeModules) continue;
        row.basis++;
        if (touched.size > 1) row.leaving++;
        row.others += codeModules.size - (codeModules.has(m) ? 1 : 0);
      }
    });
    for (const p of git.coupling) {
      const ma = moduleOf[p.a]!;
      const mb = moduleOf[p.b]!;
      if (ma === mb || !codePair(report, p)) continue;
      if (couplingImports(ix.imports, p.a, p.b) !== "none") continue;
      for (const m of [ma, mb]) {
        const row = rows.get(m);
        if (row) row.hidden++;
      }
    }
  }
  if (S) {
    const uses = symbolUses(report, S, (f) => moduleOf[f]!);
    const t = S.symbols;
    const mine: number[] = [];
    for (let s = 0; s < t.name.length; s++) {
      if (t.kind[s] !== "module" && !isTestFile(report, t.file[s]!) && rows.has(moduleOf[t.file[s]!]!)) mine.push(s);
    }
    const classes = useClasses(report, S, uses, mine);
    for (const s of mine) {
      const row = rows.get(moduleOf[t.file[s]!]!)!;
      const c = classes.get(s);
      const p = t.parent[s]!;
      const dataField = t.kind[s] === "property" && p >= 0 && (t.kind[p] === "interface" || t.kind[p] === "type");
      if (c === "interface") row.interface++;
      else if (uses.get(s)?.testUses && !dataField) row.testsPast++;
      if (c === "internal") row.internal++;
      else if (c === "could-hide") row.couldHide++;
      if (relayOf(S, s)) row.relays++;
    }
  }
  const key: Record<SeamSort, (r: ReturnType<typeof blank>) => number> = {
    hotspot: (r) => r.hotspot,
    interface: (r) => r.interface,
    spread: (r) => (r.basis ? r.others / r.basis : 0),
    hidden: (r) => r.hidden,
    relays: (r) => r.relays,
    tests_past: (r) => r.testsPast,
    code: (r) => r.code,
  };
  const sort = q.sort ?? (git ? "hotspot" : "code");
  // A directory split for review keeps its slot for its own files; with none, it is not a module.
  const ordered = [...rows].filter(([, r]) => r.files + r.testFiles > 0).sort((a, b) => key[sort](b[1]) - key[sort](a[1]) || a[0] - b[0]);
  return {
    modules: ordered.length,
    partition:
      q.depth !== undefined
        ? `directories at depth ${q.depth}`
        : "the analyzer's modules (package roots kept whole), with any module over a quarter of the code split into its subdirectories",
    sortedBy: sort,
    offset: offset || undefined,
    rows: ordered.slice(offset, offset + limit).map(([d, r]) => ({
      module: report.dirs[d]!.path || "(root)",
      selector: { path: report.dirs[d]!.path || ".", scope: "module" as const, depth: q.depth },
      files: r.files,
      testFiles: r.testFiles || undefined,
      code: r.code,
      complexity: r.complexity,
      // A sum over the module's files (each 0-1), so a large hot module outranks a small one;
      // `hottest` names the file with the highest score.
      hotspotMass: round(r.hotspot, 2),
      hottest: r.hottest >= 0 ? report.files[r.hottest]!.path : undefined,
      interface: S ? r.interface : undefined,
      couldHide: S ? r.couldHide : undefined,
      internalExports: S ? r.internal : undefined,
      testsPastInterface: S ? r.testsPast : undefined,
      relays: S ? r.relays : undefined,
      inbound: r.inbound.size,
      outbound: r.outbound.size,
      commits: git ? r.commits : undefined,
      spread: git && r.basis ? round(r.others / r.basis, 1) : undefined,
      leaving: git && r.basis ? share(r.leaving, r.basis) : undefined,
      spreadBasis: git && r.basis ? r.basis : undefined,
      sweeps: git && r.commits > r.basis ? r.commits - r.basis : undefined,
      hiddenCoupling: git ? r.hidden : undefined,
      cyclesAcross: r.cycles.size || undefined,
      // Why a figure this module should have is missing; report-wide reasons are in `unmeasured`.
      unmeasured: git && !r.basis ? { spread: r.commits ? `all ${r.commits} of its commits are sweeps (wider than ${sweep} files)` : "no analyzed commit touched it" } : undefined,
    })),
    unmeasured:
      S && git
        ? undefined
        : {
            ...(S ? {} : { interface: "no code intelligence: only TypeScript and JavaScript are analyzed by the compiler, and none was here (or the pass was skipped)" }),
            ...(git ? {} : { commits: "no git history (not a repository, or analyzed with --no-git)" }),
          },
    more: ordered.length > offset + limit ? ordered.length - offset - limit : undefined,
    legend: {
      hotspotMass: "sum of the module's file hotspot scores (each 0-1); the sort key for hotspot",
      interface: "symbols declared here that code outside uses, directly or through their members",
      couldHide: "exported, used only in its own file: it can lose `export`",
      internalExports: "exported for sibling files of the module only: implementation, though TypeScript needs the `export`",
      testsPastInterface: "symbols that are not interface but that tests use (the module's own tests included): tests reaching past the interface; overlaps couldHide and internalExports",
      relays: "functions whose body is one in-repo call (deletion-test candidates; package calls are invisible, so read before deleting)",
      commits: "every analyzed commit that touched a file here",
      spread: `other modules (with code) the module's commits also touch, on average: how far a change here travels. Over commits of ${sweep} files or fewer, spreadBasis of them; wider ones are sweeps`,
      leaving: "share of those commits that touch any other module at all (the old spread; near 1 in a squash-merge history)",
      files: "own production code files; tests counted separately; config, data, generated and vendored files excluded",
      hiddenCoupling: "cross-module production-code pairs that change together with no import path within four hops in either direction",
    },
    notes: [
      ...(S ? [] : ["no code intelligence: interface, relays and tests are not measured (TypeScript/JavaScript only)"]),
      ...(git && !git.commits.width ? [LEGACY_WIDTH_NOTE] : []),
      ...(git && git.analyzedCommits < MIN_HISTORY ? [`only ${git.analyzedCommits} commits: spread and coupling say little yet`] : []),
      ...(report.symbols?.stats.uninstalledManifests ? ["dependencies are not installed: uses through package names did not resolve, so interface counts are low"] : []),
    ],
  };
}

/** One ranked module or a recursive directory, file or glob, measured at its seam. */
export function seam(report: Report, S: CodeSymbols | undefined, raw: string, opts: { scope?: "path" | "module"; depth?: number; limit?: number; offset?: number } = {}) {
  const max = opts.limit ?? 20;
  if (opts.depth !== undefined && opts.scope !== "module") throw new QueryError('depth requires scope "module"; use the selector returned by seams');
  let moduleOf: Int32Array | undefined;
  let M: Set<number>;
  if (opts.scope === "module") {
    const dirs = seamModules(report, opts.depth);
    const dir = dirId(report, raw);
    if (!dirs.has(dir)) throw new QueryError(`"${raw}" is not in this module partition; use a selector returned by seams`);
    moduleOf = moduleMap(report, dirs);
    M = new Set(report.files.filter((f) => moduleOf![f.id] === dir).map((f) => f.id));
  } else M = filesMatching(report, raw);
  if (M.size === 0) throw new QueryError(`"${raw}" matches no files`);
  const ix = index(report);
  const group = (f: number) => (M.has(f) ? 1 : 0);
  const files = [...M].map((i) => report.files[i]!);
  const own = files.filter(isOwnCode);
  const prod = own.filter((f) => f.category !== "test");
  const tests = own.filter((f) => f.category === "test");
  const dirOf = (f: number) => report.dirs[report.files[f]!.dir]!.path || "(root)";
  const tally = (ids: Iterable<number>) => {
    const by = new Map<string, number>();
    for (const f of ids) by.set(dirOf(f), (by.get(dirOf(f)) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([dir, n]) => ({ dir, files: n }));
  };
  // Production edges only, with tests counted apart: a package whose 105 test files import it
  // read as having 217 importers against the 116 files that use its interface.
  const inbound = new Set<number>();
  const inboundTests = new Set<number>();
  const outbound = new Set<number>();
  for (const f of M) {
    for (const x of neighbors(ix.importedBy, f)) if (!M.has(x)) (report.files[x]!.category === "test" ? inboundTests : inbound).add(x);
    if (report.files[f]!.category === "test") continue;
    for (const x of neighbors(ix.imports, f)) if (!M.has(x)) outbound.add(x);
  }

  let symbolsPart;
  if (S) {
    const sx = symIndex(S, report.files.length);
    const t = S.symbols;
    const uses = symbolUses(report, S, group);
    const declared = [...M].flatMap((f) => neighbors(sx.inFile, f)).filter((s) => t.kind[s] !== "module" && !isTestFile(report, t.file[s]!));
    const classes = useClasses(report, S, uses, declared);
    const of = (c: UseClass) => declared.filter((s) => classes.get(s) === c);
    const viaMembers = (s: number) => memberUses(S, uses, sx.children, s);
    const weight = (s: number) => (uses.get(s) ? uses.get(s)!.uses - uses.get(s)!.testUses : 0) + viaMembers(s);
    const iface = of("interface").sort((a, b) => weight(b) - weight(a) || a - b);
    // Tests reaching past the interface: anything not interface that a test uses, except the
    // fields of an interface or type alias. A test building an options object writes every
    // field it sets; those 100-odd rows buried the helpers a test really reaches past.
    const isDataField = (s: number) => {
      const p = t.parent[s]!;
      return t.kind[s] === "property" && p >= 0 && (t.kind[p] === "interface" || t.kind[p] === "type");
    };
    const testsPast = declared.filter((s) => classes.get(s) !== "interface" && (uses.get(s)?.testUses ?? 0) > 0 && !isDataField(s));
    const couldHide = of("could-hide");
    const internal = of("internal");
    const callers = new Set<number>();
    const outsideFiles = new Set<number>();
    let sites = 0;
    for (const s of iface) {
      const u = uses.get(s);
      if (!u) continue;
      sites += u.uses - u.testUses;
      for (const c of u.callers) callers.add(c);
      for (const f of u.files) if (!isTestFile(report, f)) outsideFiles.add(f);
    }
    const typeByName = typesByName(S);
    const relays = declared.flatMap((s) => {
      const r = relayOf(S, s);
      return r ? [{ id: s, name: sx.qualified[s], at: symbolAt(report, S, s), forwardsTo: sx.qualified[r.to], toAt: symbolAt(report, S, r.to), callers: r.callers }] : [];
    });
    // Only implementations a class declares (implements / extends) are rows in the call
    // table. An object literal that satisfies an interface structurally leaves none, so an
    // interface listed with one adapter may have more, and one not listed may still be a port.
    const ports = declared.filter((s) => INTERFACE_KINDS.has(t.kind[s]!) && (t.kind[s] === "interface" || (t.flags[s]! & SymbolFlag.abstract) !== 0));
    // An interface extending another is the type hierarchy, not an adapter; only classes count.
    const implementations = (s: number) => heritage(S, s).derived.filter((d) => t.kind[d.symbol] === "class");
    const adapters = ports
      .filter((s) => implementations(s).length > 0)
      .map((s) => {
        const impl = implementations(s);
        return {
          id: s,
          name: sx.qualified[s],
          at: symbolAt(report, S, s),
          implementations: impl.length,
          // A test double is an adapter too: production + in-memory is the classic real seam.
          rows: impl.slice(0, 8).map((d) => ({ name: sx.qualified[d.symbol], at: symbolAt(report, S, d.symbol), test: isTestFile(report, t.file[d.symbol]!) || undefined })),
        };
      })
      .sort((a, b) => b.implementations - a.implementations || a.id - b.id);
    const testFiles = new Set<number>();
    for (const s of declared) for (const f of uses.get(s)?.testFiles ?? []) testFiles.add(f);
    const capped = <T,>(rows: T[]) => ({ count: rows.length, rows: rows.slice(0, max), more: rows.length > max ? rows.length - max : undefined });
    const unusedExports = declared.filter((s) => (t.flags[s]! & SymbolFlag.unusedExport) !== 0);
    // Every list below is present whenever code intelligence ran, empty when nothing qualified,
    // so "none" and "not measured" read differently (an agent checking that cyclesAcross was
    // empty after a refactor could not tell the two apart when empty lists were left out).
    symbolsPart = {
      interface: {
        symbols: iface.length,
        declared: declared.length,
        uses: sites,
        callers: callers.size,
        files: outsideFiles.size,
        offset: opts.offset || undefined,
        rows: iface.slice(opts.offset ?? 0, (opts.offset ?? 0) + max).map((s) => {
          const u = uses.get(s);
          const members = viaMembers(s);
          return {
            id: s,
            name: sx.qualified[s],
            kind: t.kind[s],
            at: symbolAt(report, S, s),
            uses: u ? u.uses - u.testUses : 0,
            files: u ? [...u.files].filter((f) => !isTestFile(report, f)).length : 0,
            testUses: u?.testUses || undefined,
            viaMembers: members || undefined,
            exposes: exposedType(S, sx, typeByName, s),
            forwardsTo: forwarderOf(S, sx, s),
            complexity: t.complexity[s] || undefined,
          };
        }),
        more: iface.length > (opts.offset ?? 0) + max ? iface.length - (opts.offset ?? 0) - max : undefined,
      },
      couldHide: capped(couldHide.map((s) => ({ id: s, name: sx.qualified[s], at: symbolAt(report, S, s), insideUses: uses.get(s)!.inside }))),
      externalExports: capped(of("external").map((s) => ({ id: s, name: sx.qualified[s], at: symbolAt(report, S, s), reason: report.files[t.file[s]!]!.publicApi ? "public-api" : "entry-export" }))),
      internalExports: capped(internal.map((s) => ({ id: s, name: sx.qualified[s], at: symbolAt(report, S, s), siblingFiles: [...uses.get(s)!.insideFiles].filter((f) => f !== t.file[s]).length }))),
      testsPastInterface: capped(testsPast.map((s) => ({ id: s, name: sx.qualified[s], at: symbolAt(report, S, s), testFiles: [...uses.get(s)!.testFiles].map((f) => report.files[f]!.path) }))),
      testFiles: [...testFiles].map((f) => report.files[f]!.path).sort(),
      // The analyzer's flag: exported, and nothing outside its own file references it.
      unusedExports: capped(unusedExports.map((s) => `${sx.qualified[s]} (${symbolAt(report, S, s)})`)),
      relays: relays.slice(0, max),
      adapters: adapters.slice(0, max),
      interfacesWithoutDeclaredAdapters: ports.length - adapters.length,
    };
  }

  let locality;
  const git = report.git;
  if (git && ix.commits) {
    const rows = new Set<number>();
    for (const f of M) for (const r of neighbors(ix.commits, f)) rows.add(r);
    const sweep = sweepOf(report);
    // A ranked drilldown retains its partition for spread too. An arbitrary path uses the
    // review partition outside itself and counts its selected files as one module.
    const localityModules = moduleOf ?? moduleMap(report, reviewModules(report));
    let counted = 0;
    let leaving = 0;
    let others = 0;
    const outside = new Map<string, number>();
    for (const r of rows) {
      const cf = git.commits.files[r]!;
      if ((git.commits.width?.[r] ?? cf.length) > sweep) continue;
      counted++;
      const out = new Set(cf.filter((f) => !M.has(f) && isProdCode(report.files[f]!)).map(dirOf));
      if (cf.some((f) => !M.has(f))) leaving++;
      others += new Set(cf.filter((f) => !M.has(f) && isOwnCode(report.files[f]!)).map((f) => localityModules[f]!)).size;
      for (const d of out) outside.set(d, (outside.get(d) ?? 0) + 1);
    }
    const crossing = git.coupling.filter((p) => M.has(p.a) !== M.has(p.b) && codePair(report, p));
    const pairs = crossing
      .sort((a, b) => b.degree - a.degree || b.shared - a.shared)
      .slice(0, max)
      .map((p) => {
        const [inF, outF] = M.has(p.a) ? [p.a, p.b] : [p.b, p.a];
        return { inside: report.files[inF]!.path, outside: report.files[outF]!.path, shared: p.shared, degree: round(p.degree), imports: couplingImports(ix.imports, inF, outF) };
      });
    const sweeps = rows.size - counted;
    locality = {
      commits: rows.size,
      sweepWidth: sweep,
      sweeps: sweeps || undefined,
      // When most of a module's commits are sweeps, its spread rests on the few that are not.
      thin: sweeps > counted && counted > 0 ? `${sweeps} of ${rows.size} commits are wider than ${sweep} files, so spread and co-change rest on the other ${counted}` : undefined,
      // Other modules (with code) a commit here also touches, on average: how far a change travels.
      spread: counted ? round(others / counted, 1) : undefined,
      spreadBasis: counted || undefined,
      // Share of those commits touching anything outside at all; near 1 in a squash-merge history.
      leaving: counted ? share(leaving, counted) : undefined,
      alsoTouchOutside: leaving,
      unmeasured: counted
        ? undefined
        : { spread: rows.size ? `all ${rows.size} of its commits are sweeps (wider than ${sweep} files)` : "no analyzed commit touched it" },
      changesWith: [...outside].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([dir, commits]) => ({ dir, commits })),
      // Import paths can explain co-change; absent paths still need source inspection.
      coChange: pairs,
      coChangeMore: crossing.length > pairs.length ? crossing.length - pairs.length : undefined,
    };
  }

  const owners = new Map<number, number>();
  for (const f of own) if (f.git && f.git.owner >= 0 && !git?.authors[f.git.owner]?.bot) owners.set(f.git.owner, (owners.get(f.git.owner) ?? 0) + f.code);
  const cycles = report.graph.cycles.filter((c) => c.files.some((f) => M.has(f)) && c.files.some((f) => !M.has(f)));
  return {
    module: raw,
    selector: { path: raw, scope: opts.scope ?? "path", depth: opts.depth },
    // The module's own tests are clients of its interface, not part of its implementation;
    // counted together, an engine directory's 3,890 code lines read as 7,538.
    implementation: {
      files: prod.length,
      code: prod.reduce((a, f) => a + f.code, 0),
      complexity: prod.reduce((a, f) => a + f.complexity, 0),
      functions: prod.reduce((a, f) => a + f.functions, 0),
      hottest: prod.filter((f) => f.hotspot > 0).sort((a, b) => b.hotspot - a.hotspot).slice(0, 5).map((f) => ({ path: f.path, hotspot: round(f.hotspot) })),
    },
    tests: { files: tests.length, code: tests.reduce((a, f) => a + f.code, 0) },
    imports: {
      inbound: { files: inbound.size, testFiles: inboundTests.size, from: tally(inbound) },
      outbound: { files: outbound.size, to: tally(outbound) },
      cyclesAcross: cycles.map((c) => ({ size: c.files.length, inside: c.files.filter((f) => M.has(f)).map((f) => report.files[f]!.path), outside: c.files.filter((f) => !M.has(f)).slice(0, 8).map((f) => report.files[f]!.path) })),
      // Edges are file to file: behind a barrel (an index.ts that re-exports), importers import
      // the barrel, so a file's inbound count can be far below interface.files.
      viaBarrel: inbound.size < (symbolsPart?.interface.files ?? 0) ? "fewer importing files than interface.files: callers reach it through a re-exporting file" : undefined,
    },
    ...(symbolsPart ?? {}),
    locality,
    owners: [...owners].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([a, code]) => ({ author: authorName(report, a), code })),
    unmeasured:
      S && git
        ? undefined
        : {
            ...(S ? {} : { interface: "no code intelligence: only TypeScript and JavaScript go through the compiler, so interface, relays, adapters and tests are not measured" }),
            ...(git ? {} : { locality: "no git history (not a repository, or analyzed with --no-git)" }),
          },
    notes: [
      "interface = symbols code outside uses; external package imports are not in the report, so read the module's import statements for its dependency categories",
      ...(git && !git.commits.width ? [LEGACY_WIDTH_NOTE] : []),
      ...(git && git.analyzedCommits < MIN_HISTORY ? [`only ${git.analyzedCommits} commits: locality says little yet`] : []),
    ],
  };
}

// ─── Dependencies ────────────────────────────────────────────────────────────────────────────

/**
 * Ecosystems the runtime or toolchain provides (the resolver's names: node:fs and friends,
 * Bun's modules, C headers and frameworks, every language's standard library). They have no
 * manifest to be declared in, so an "undeclared" list that kept them was mostly fs and path.
 */
export const isBuiltin = (ecosystem: string): boolean => ecosystem === "node" || ecosystem === "bun" || ecosystem === "system" || ecosystem.endsWith("-stdlib");
/** References that name their own source (a Dockerfile's FROM image, a URL import): undeclared by definition. */
const SELF_DECLARED = new Set(["docker", "url"]);

export function dependencies(report: Report, q: { ecosystem?: string; scope?: string; filter?: "unused" | "undeclared" | "builtin"; query?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const needle = q.query?.toLowerCase();
  const rows = report.externals
    .filter(
      (d) =>
        (!q.ecosystem || d.ecosystem === q.ecosystem.toLowerCase()) &&
        (!q.scope || d.scope === q.scope) &&
        (!needle || d.name.toLowerCase().includes(needle)) &&
        (q.filter !== "unused" || (d.declaredIn.length > 0 && d.importers === 0)) &&
        (q.filter !== "undeclared" || (d.declaredIn.length === 0 && d.importers > 0 && !isBuiltin(d.ecosystem) && !SELF_DECLARED.has(d.ecosystem))) &&
        (q.filter !== "builtin" || isBuiltin(d.ecosystem)),
    )
    .sort((a, b) => b.importers - a.importers || a.name.localeCompare(b.name));
  const ecosystems = new Map<string, number>();
  for (const d of report.externals) ecosystems.set(d.ecosystem, (ecosystems.get(d.ecosystem) ?? 0) + 1);
  return {
    ecosystems: Object.fromEntries(ecosystems),
    builtins: report.externals.filter((d) => isBuiltin(d.ecosystem)).length || undefined,
    manifests: report.manifests.map((m) => ({ path: m.path, kind: m.kind, name: m.name, version: m.version, dependencies: m.dependencies })),
    matched: rows.length,
    dependencies: rows.slice(0, limit).map((d) => ({ name: d.name, ecosystem: d.ecosystem, version: d.version, scope: d.scope, importers: d.importers, declaredIn: d.declaredIn.length ? d.declaredIn : undefined })),
    more: rows.length > limit ? rows.length - limit : undefined,
  };
}

/** Category names a files query accepts: the 16 categories and the 7 color groups. */
export const CATEGORY_NAMES: string[] = [...new Set<string>([...(Object.keys(CATEGORY_GROUP) as Category[]), ...Object.values(CATEGORY_GROUP)])];
