/**
 * Report statistics: distributions (with Gini and log2 histograms), comment and test ratios,
 * duplicate files.
 *
 *   distribution(values) → Distribution
 *   computeStats(files, authors?) → Stats
 *
 * "Code files" throughout means category code or test, not generated and not vendored: a
 * vendored copy of SQLite or a generated protobuf stub says nothing about how the project's
 * own code is written, and either one can outweigh the rest of a small repository.
 */

import type { Author, Distribution, FileRecord, Stats } from "../shared/schema";

/** Duplicate groups kept. Past a few hundred nobody reads the list, and each costs bytes. */
const DUPLICATE_GROUPS = 200;

/**
 * Commits of history below which churn says nothing, shared by the pipeline (hotspot scores)
 * and the findings (churn and hotspot findings) so the two can never disagree. In a depth-1
 * clone every line arrives in one commit, so "churn × complexity" is the complexity ranking
 * renamed, and the viewer's hotspot chart would present it as change risk.
 */
export const MIN_HISTORY = 10;

export const isOwnCode = (f: FileRecord): boolean =>
  (f.category === "code" || f.category === "test") && !f.generated && !f.vendored;

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Linear-interpolated quantile (type 7, what numpy and R default to) of sorted values. */
function quantile(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Gini over non-negative values: 0 when every item is equal, approaching 1 when one item has
 * everything. Uses the sorted closed form G = 2·Σ i·x_i / (n·Σx) − (n + 1)/n, O(n log n).
 */
function gini(sorted: Float64Array, sum: number): number {
  const n = sorted.length;
  if (n < 2 || sum <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i]!;
  return Math.max(0, (2 * weighted) / (n * sum) - (n + 1) / n);
}

export function distribution(values: ArrayLike<number>): Distribution {
  const n = values.length;
  if (n === 0) return { count: 0, sum: 0, min: 0, max: 0, mean: 0, median: 0, p90: 0, p99: 0, gini: 0, log2Bins: [] };
  const sorted = Float64Array.from(values, (v) => (Number.isFinite(v) && v > 0 ? v : 0)).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i]!;
  // bins[0] is [0, 2): zero and one share it so a file of 0 or 1 lines is not its own bar.
  const bins: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = sorted[i]!;
    const b = v < 2 ? 0 : Math.floor(Math.log2(v));
    while (bins.length <= b) bins.push(0);
    bins[b]!++;
  }
  return {
    count: n,
    sum,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean: round4(sum / n),
    median: round4(quantile(sorted, 0.5)),
    p90: round4(quantile(sorted, 0.9)),
    p99: round4(quantile(sorted, 0.99)),
    gini: round4(gini(sorted, sum)),
    log2Bins: bins,
  };
}

/** Bytes a duplicate group repeats: every copy past the first. */
export const wastedBytes = (d: Stats["duplicates"][number]): number => (d.files.length - 1) * d.bytes;

/**
 * Every group of identical, non-empty files, costliest first (bytes repeated, then copies,
 * then hash, so the order and any cut of it are stable). Secret files carry no hash (see
 * src/core/worker.ts), so they can never appear here.
 *
 * Ranked by bytes repeated, not by copy count: a test suite with 200 identical 8-byte fixtures
 * would otherwise fill the whole capped list and push out the pair of 48 KB files that is the
 * duplication worth reporting. The findings call this too, uncapped, so their totals count
 * every group rather than the ones that survived the cut.
 */
export function duplicateGroups(files: FileRecord[]): Stats["duplicates"] {
  const groups = new Map<string, number[]>();
  for (const f of files) {
    if (f.bytes === 0 || !f.hash) continue;
    const g = groups.get(f.hash);
    if (g) g.push(f.id);
    else groups.set(f.hash, [f.id]);
  }
  return [...groups]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, bytes: files[ids[0]!]!.bytes, files: ids }))
    .sort((a, b) => wastedBytes(b) - wastedBytes(a) || b.files.length - a.files.length || (a.hash < b.hash ? -1 : 1));
}

export function computeStats(files: FileRecord[], authors?: Author[]): Stats {
  const own = files.filter(isOwnCode);
  let code = 0;
  let comment = 0;
  let tests = 0;
  for (const f of own) {
    code += f.code;
    comment += f.comment;
    if (f.category === "test") tests++;
  }
  const sources = own.length - tests;
  const duplicates = duplicateGroups(files).slice(0, DUPLICATE_GROUPS);

  const withGit = files.filter((f) => f.git);
  const stats: Stats = {
    linesPerFile: distribution(own.map((f) => f.lines)),
    complexityPerFile: distribution(own.map((f) => f.complexity)),
    commentRatio: code + comment > 0 ? round4(comment / (code + comment)) : 0,
    testRatio: sources > 0 ? round4(tests / sources) : 0,
    duplicates,
  };
  if (withGit.length) stats.commitsPerFile = distribution(withGit.map((f) => f.git!.commits));
  // Bots are left out: a dependabot with 3,000 lockfile bumps would make any human team look
  // like a one-person project.
  const humans = authors?.filter((a) => !a.bot);
  if (humans?.length) stats.commitsPerAuthor = distribution(humans.map((a) => a.commits));
  return stats;
}
