/**
 * Indexes the record and the call hierarchy need that the shared model does not carry.
 *
 * Each is built lazily the first time a panel asks and cached against the table it came from
 * (WeakMap keyed by the report or symbol object), so a report swap drops them with the old data
 * and nothing is computed for a reader who never opens that panel. They are CSR arrays for the
 * same reason model/indices.ts gives: a 20k-commit history or a 60k-row call table scanned once
 * per click is what makes a big report feel slow.
 */

import { csr } from "../../shared/calls";
import type { FileRecord, Report } from "../../shared/schema";
import type { Adjacency, Model } from "../model/indices";
import type { Filters } from "../state/store";
import { filesUnder } from "../model/indices";

// ─── Git ─────────────────────────────────────────────────────────────────────────────────────

const commitsByFileCache = new WeakMap<Report, Adjacency>();

/** Commit indexes (newest first) that touched each file. */
export function commitsByFile(report: Report): Adjacency | null {
  const git = report.git;
  if (!git) return null;
  let cached = commitsByFileCache.get(report);
  if (!cached) {
    const keys: number[] = [];
    const values: number[] = [];
    git.commits.files.forEach((files, commit) => {
      for (const f of files) {
        keys.push(f);
        values.push(commit);
      }
    });
    cached = csr(report.files.length, keys, values);
    commitsByFileCache.set(report, cached);
  }
  return cached;
}

const commitsByAuthorCache = new WeakMap<Report, Adjacency>();

/** Commit indexes (newest first) by author. */
export function commitsByAuthor(report: Report): Adjacency | null {
  const git = report.git;
  if (!git) return null;
  let cached = commitsByAuthorCache.get(report);
  if (!cached) {
    const ids = Array.from({ length: git.commits.author.length }, (_, i) => i);
    cached = csr(git.authors.length, git.commits.author, ids);
    commitsByAuthorCache.set(report, cached);
  }
  return cached;
}

/** Authors ranked by commits to one file: the specimen's collectors. */
export function collectorsOf(report: Report, file: number): { author: number; commits: number }[] {
  const byFile = commitsByFile(report);
  const git = report.git;
  if (!byFile || !git) return [];
  const counts = new Map<number, number>();
  for (let i = byFile.offsets[file]!; i < byFile.offsets[file + 1]!; i++) {
    const a = git.commits.author[byFile.targets[i]!]!;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts].map(([author, commits]) => ({ author, commits })).sort((a, b) => b.commits - a.commits);
}

// ─── File edges ──────────────────────────────────────────────────────────────────────────────

export interface EdgeSplit {
  /** Code dependencies (import, include, require, reference), the edges fanIn/fanOut count. */
  imports: Adjacency;
  importedBy: Adjacency;
  /** Document links (a Markdown file linking another file in the repo). */
  linksTo: Adjacency;
  linkedFrom: Adjacency;
}

const edgeSplitCache = new WeakMap<Report, EdgeSplit>();

/**
 * The report's file edges, split the way the analyzer splits them. Its fan-in, fan-out and
 * PageRank use code edges only (docs linking each other would top PageRank and form "cycles"
 * that say nothing about the code), but report.edges carries the links too. The record read its
 * figures from one and its lists from the other, so README.md said "Imports 0" above a list of
 * 27 imports. Splitting here lets every count and list name one edge set.
 */
export function edgeSplit(report: Report): EdgeSplit {
  let cached = edgeSplitCache.get(report);
  if (!cached) {
    const n = report.files.length;
    const { from, to, kind } = report.edges;
    const code: [number[], number[]] = [[], []];
    const link: [number[], number[]] = [[], []];
    for (let i = 0; i < from.length; i++) {
      const bucket = kind[i] === "link" ? link : code;
      bucket[0].push(from[i]!);
      bucket[1].push(to[i]!);
    }
    cached = {
      imports: csr(n, code[0], code[1]),
      importedBy: csr(n, code[1], code[0]),
      linksTo: csr(n, link[0], link[1]),
      linkedFrom: csr(n, link[1], link[0]),
    };
    edgeSplitCache.set(report, cached);
  }
  return cached;
}

/** Number of neighbors a file has in one adjacency. */
export function degree(adj: Adjacency, node: number): number {
  return adj.offsets[node + 1]! - adj.offsets[node]!;
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

export interface DirSummary {
  languages: { id: string; lines: number }[];
  largest: number[];
  hottest: number[];
  owners: { author: number; files: number }[];
  codeLines: number;
  /** Files with code lines that the filters hide, so the language mix leaves them out. */
  filteredOut: number;
}

/** The shared filters' test, as the charts and trays apply it (charts/data.ts scopeFiles). */
export function passes(f: FileRecord, filters: Filters): boolean {
  if (filters.languages && !filters.languages.has(f.language)) return false;
  if (filters.categories && !filters.categories.has(f.category)) return false;
  if (filters.hideGenerated && f.generated) return false;
  if (filters.hideVendored && f.vendored) return false;
  return true;
}

/** Filters that hide nothing at all, vendored files included: what "Show all files" sets. */
export const NO_FILTERS: Filters = { languages: null, categories: null, hideGenerated: false, hideVendored: false };

/** Does any filter hide anything? Unlike the plate's chip, the default "hide vendored" counts. */
export function filtering(filters: Filters): boolean {
  return filters.languages !== null || filters.categories !== null || filters.hideGenerated || filters.hideVendored;
}

/**
 * The filters in a few words, for a note beside a count ("TypeScript only, vendored"). Language
 * names come from `languageName`; two or fewer are named, more are counted.
 */
export function describeFilters(filters: Filters, languageName: (id: string) => string): string {
  const parts: string[] = [];
  if (filters.languages) {
    const names = [...filters.languages].map(languageName);
    parts.push(names.length <= 2 ? `${names.join(" and ")} only` : `${names.length} languages only`);
  }
  if (filters.categories) parts.push(filters.categories.size === 1 ? `${[...filters.categories][0]} only` : `${filters.categories.size} categories only`);
  if (filters.hideGenerated) parts.push("generated");
  if (filters.hideVendored) parts.push("vendored");
  return parts.join(", ");
}

/** Language mix, largest and hottest files, and owners beneath one directory. */
export function summarizeDir(model: Model, dir: number, filters?: Filters): DirSummary {
  const report = model.report;
  const ids = filesUnder(model, dir);
  const langs = new Map<string, number>();
  const owners = new Map<number, number>();
  const bots = report.git?.authors.map((a) => a.bot) ?? [];
  let codeLines = 0;
  let filteredOut = 0;
  for (const id of ids) {
    const f = report.files[id]!;
    // Code lines only, and only files the filters let through: the measure the Language
    // composition tray uses. The record sits beside that tray for the same drawer; weighting
    // comments gave it different shares, and counting the vendored files the tray hides by
    // default gave it a different number of languages ("15 languages" over "Language mix 16").
    const weight = f.code;
    if (weight > 0 && filters && !passes(f, filters)) filteredOut++;
    else if (weight > 0) {
      langs.set(f.language, (langs.get(f.language) ?? 0) + weight);
      codeLines += weight;
    }
    if (f.git && !bots[f.git.owner]) owners.set(f.git.owner, (owners.get(f.git.owner) ?? 0) + 1);
  }
  const all = Array.from(ids);
  const largest = all
    .filter((id) => report.files[id]!.lines > 0)
    .sort((a, b) => report.files[b]!.lines - report.files[a]!.lines)
    .slice(0, 5);
  const hottest = all
    .filter((id) => report.files[id]!.hotspot > 0)
    .sort((a, b) => report.files[b]!.hotspot - report.files[a]!.hotspot)
    .slice(0, 5);
  return {
    languages: [...langs].map(([id, lines]) => ({ id, lines })).sort((a, b) => b.lines - a.lines),
    largest,
    hottest,
    owners: [...owners].map(([author, files]) => ({ author, files })).sort((a, b) => b.files - a.files),
    codeLines,
    filteredOut,
  };
}

// ─── Call table ──────────────────────────────────────────────────────────────────────────────

// The call table's rules (what counts as a caller, the type hierarchy, calls through bases) live
// in src/shared/calls.ts, because the MCP server answers the same questions and must agree.
export {
  callEdges,
  callSite,
  callsThroughBases,
  FUNCTION_LIKE,
  heritage,
  HERITAGE_KINDS,
  KIND_INDEX,
  partitionByCall,
  partitionTypeRefs,
  selfCalls,
  type CallEdge,
} from "../../shared/calls";
