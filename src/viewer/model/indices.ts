/**
 * Derived indexes over a loaded report, computed once when it loads.
 *
 * The report is shaped for size on disk (flat tables, integer references). Views need the
 * opposite: "which files are under this drawer", "who imports this file", "how dark should
 * this star be". Answering those per frame or per render from the raw tables is what makes a
 * 40k-file report stutter, so they are precomputed here into typed arrays and CSR adjacency.
 */

import type { FileRecord, LanguageSummary, Report } from "../../shared/schema";
import type { ColorBy, SizeBy } from "../state/store";

/** Compressed sparse rows: neighbors of node i are targets[offsets[i] .. offsets[i + 1]). */
export interface Adjacency {
  offsets: Int32Array;
  targets: Int32Array;
}

export interface Model {
  report: Report;
  fileCount: number;
  languages: Map<string, LanguageSummary>;
  /** Categorical slot (0-6) per language id; -1 folds into "Other". */
  languageSlot: Map<string, number>;
  pathIndex: Map<string, number>;

  /** Files in depth-first directory order; each directory's files form one contiguous run. */
  fileOrder: Int32Array;
  /** Position of each file id in fileOrder. */
  fileOrderIndex: Int32Array;
  /** Per directory id, its descendant files are fileOrder[dirStart[d] .. dirEnd[d]). */
  dirStart: Int32Array;
  dirEnd: Int32Array;
  /** Top-level directory (a child of the root) for each file, or 0 (the root) for root files. */
  topDir: Int32Array;

  imports: Adjacency; // file → files it imports
  importedBy: Adjacency; // file → files importing it

  /**
   * Holotype per top-level region: its most depended-on file, the one with the most direct
   * importers (PageRank breaks ties). Holotype red is reserved for exactly these files.
   */
  holotypeOfDir: Map<number, number>;
  holotypes: Set<number>;

  /** Files each author owns (FileGit.owner), by author id. */
  authorFiles: number[][];

  /** Git creation time per file (unix seconds), NaN when unknown. Drives the history scrubber. */
  created: Float64Array;
}

export function buildModel(report: Report): Model {
  const files = report.files;
  const n = files.length;

  const languages = new Map(report.languages.map((l) => [l.id, l]));
  const languageSlot = new Map(report.languages.map((l) => [l.id, l.slot]));
  const pathIndex = new Map(files.map((f) => [f.path, f.id]));

  // Depth-first order over the directory tree. Iterative: deep trees must not overflow.
  const fileOrder = new Int32Array(n);
  const fileOrderIndex = new Int32Array(n);
  const dirStart = new Int32Array(report.dirs.length);
  const dirEnd = new Int32Array(report.dirs.length);
  let cursor = 0;
  const stack: { dir: number; childIndex: number }[] = [];
  if (report.dirs.length > 0) stack.push({ dir: 0, childIndex: -1 });
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const dir = report.dirs[top.dir]!;
    if (top.childIndex === -1) {
      dirStart[top.dir] = cursor;
      for (const f of dir.files) {
        fileOrder[cursor] = f;
        fileOrderIndex[f] = cursor;
        cursor++;
      }
      top.childIndex = 0;
    }
    if (top.childIndex < dir.dirs.length) {
      stack.push({ dir: dir.dirs[top.childIndex++]!, childIndex: -1 });
    } else {
      dirEnd[top.dir] = cursor;
      stack.pop();
    }
  }

  const topDir = new Int32Array(n);
  for (const childId of report.dirs[0]?.dirs ?? []) {
    for (let i = dirStart[childId]!; i < dirEnd[childId]!; i++) topDir[fileOrder[i]!] = childId;
  }

  const imports = toAdjacency(n, report.edges.from, report.edges.to);
  const importedBy = toAdjacency(n, report.edges.to, report.edges.from);

  const holotypeOfDir = new Map<number, number>();
  const best = new Map<number, number>();
  // Chosen by direct importers, not PageRank. Every surface says "most depended on" and shows
  // the importer count beside it; picked by PageRank, the label read false wherever a sibling
  // had more importers (inertialref: spatial/index.ts 256 beside the shared/index.ts holotype
  // at 251). PageRank still settles ties, so the more central of two equals wins.
  for (const f of files) {
    if (f.fanIn === 0) continue;
    const region = topDir[f.id]!;
    const current = best.get(region);
    const c = current === undefined ? undefined : files[current]!;
    if (!c || f.fanIn > c.fanIn || (f.fanIn === c.fanIn && f.rank > c.rank)) best.set(region, f.id);
  }
  for (const [dir, file] of best) holotypeOfDir.set(dir, file);
  const holotypes = new Set(holotypeOfDir.values());

  const authorFiles: number[][] = (report.git?.authors ?? []).map(() => []);
  const created = new Float64Array(n).fill(Number.NaN);
  for (const f of files) {
    if (!f.git) continue;
    authorFiles[f.git.owner]?.push(f.id);
    created[f.id] = f.git.created;
  }

  return {
    report,
    fileCount: n,
    languages,
    languageSlot,
    pathIndex,
    fileOrder,
    fileOrderIndex,
    dirStart,
    dirEnd,
    topDir,
    imports,
    importedBy,
    holotypeOfDir,
    holotypes,
    authorFiles,
    created,
  };
}

function toAdjacency(n: number, from: number[], to: number[]): Adjacency {
  const offsets = new Int32Array(n + 1);
  for (const f of from) offsets[f + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const targets = new Int32Array(from.length);
  for (let e = 0; e < from.length; e++) targets[fill[from[e]!]!++] = to[e]!;
  return { offsets, targets };
}

export function neighbors(adj: Adjacency, node: number): Int32Array {
  return adj.targets.subarray(adj.offsets[node]!, adj.offsets[node + 1]!);
}

/** Every file id under a directory (recursive), as a view into fileOrder. */
export function filesUnder(model: Model, dir: number): Int32Array {
  return model.fileOrder.subarray(model.dirStart[dir]!, model.dirEnd[dir]!);
}

export function isFileUnder(model: Model, file: number, dir: number): boolean {
  const i = model.fileOrderIndex[file]!;
  return i >= model.dirStart[dir]! && i < model.dirEnd[dir]!;
}

/** Directory ids from the root down to `dir`, inclusive. */
export function dirAncestry(report: Report, dir: number): number[] {
  const chain: number[] = [];
  for (let d = dir; d >= 0; d = report.dirs[d]!.parent) chain.push(d);
  return chain.reverse();
}

// ─── Metrics for encodings ───────────────────────────────────────────────────────────────────

/** Raw value behind a sequential color mode. Larger always means "more" of the named thing. */
export function colorMetric(file: FileRecord, mode: Exclude<ColorBy, "language" | "category">, now: number): number {
  switch (mode) {
    case "churn":
      return file.git?.commits ?? 0;
    case "age":
      return file.git ? Math.max(0, now - file.git.modified) : 0;
    case "complexity":
      return file.complexity;
    case "ownership":
      return file.git?.ownership ?? 0;
    case "hotspot":
      return file.hotspot;
    case "rank":
      return file.rank;
  }
}

export function sizeMetric(file: FileRecord, mode: SizeBy): number {
  switch (mode) {
    case "lines":
      return file.lines;
    case "bytes":
      return file.bytes;
    case "complexity":
      return file.complexity;
    case "commits":
      return file.git?.commits ?? 0;
    case "rank":
      return file.rank;
  }
}

/**
 * Percentile rank (0-1) of every value. Code metrics are heavy-tailed: on a linear scale one
 * 20k-line file paints everything else the palest step. Percentiles spread the ramp evenly,
 * and ties share a rank so equal values always get equal color.
 */
export function percentileRanks(values: ArrayLike<number>): Float32Array {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const out = new Float32Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j++;
    const rank = n > 1 ? (i + j) / 2 / (n - 1) : 1;
    for (let k = i; k <= j; k++) out[order[k]!] = rank;
    i = j + 1;
  }
  return out;
}
