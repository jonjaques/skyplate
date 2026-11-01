/**
 * Fuzzy ranking for the command palette.
 *
 * cmdk's built-in filter re-scores and re-sorts every item it is given, which means handing it
 * all 50k paths of a large report on each keystroke. Ranking here and passing it only the top
 * hits keeps the palette instant; the dialog runs cmdk with filtering off.
 *
 * Scoring favors what a reader types for a path: the file name over the directories, a run of
 * consecutive characters over scattered ones, and matches that start a word (after "/", ".",
 * "_", "-", or a camelCase hump). Every space-separated term must match.
 */

const BOUNDARY = new Set(["/", ".", "_", "-", " ", "@", ":"]);

/**
 * Score one term against one target, or -1 when the term is not a subsequence of it.
 * `lower` is the target lowercased (precomputed by the caller); `original` keeps its case
 * for camelCase boundaries. `nameStart` is where the final path segment begins.
 */
function scoreTerm(term: string, lower: string, original: string, nameStart: number): number {
  // Substring hits first: they are what people mean most of the time and cost one indexOf.
  const at = lower.lastIndexOf(term);
  if (at >= 0) {
    let s = 100 + term.length * 12;
    if (at >= nameStart) s += 60; //                                     in the file name
    if (at === nameStart) s += 40; //                                    at its start
    if (at === 0 || BOUNDARY.has(lower[at - 1]!)) s += 25;
    if (at === nameStart && term.length === lower.length - nameStart) s += 80; // the whole name
    return s;
  }

  // Subsequence, scanned right to left so letters land in the file name when they can.
  let s = 0;
  let ti = term.length - 1;
  let prev = -2;
  for (let i = lower.length - 1; i >= 0 && ti >= 0; i--) {
    if (lower[i] !== term[ti]) continue;
    s += 8;
    if (prev === i + 1) s += 10;
    const before = i > 0 ? original[i - 1]! : "/";
    if (BOUNDARY.has(before) || (original[i] !== lower[i] && before === before.toLowerCase())) s += 12;
    if (i >= nameStart) s += 4;
    prev = i;
    ti--;
  }
  return ti < 0 ? s : -1;
}

export interface Searchable {
  lower: string[];
  original: string[];
  nameStart: Int32Array;
}

/** Precompute what scoring needs for a list of strings (paths or names). */
export function searchable(items: string[]): Searchable {
  const nameStart = new Int32Array(items.length);
  items.forEach((s, i) => {
    nameStart[i] = s.lastIndexOf("/") + 1;
  });
  return { lower: items.map((s) => s.toLowerCase()), original: items, nameStart };
}

/**
 * Top `limit` indexes for a query, best first. `include` filters candidates (e.g. skip the
 * synthetic module symbols); `tieBreak` orders equal scores (higher wins, e.g. reference count).
 */
export function rank(
  index: Searchable,
  query: string,
  limit: number,
  include?: (i: number) => boolean,
  tieBreak?: (i: number) => number,
): number[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: { i: number; s: number }[] = [];
  const n = index.lower.length;
  for (let i = 0; i < n; i++) {
    if (include && !include(i)) continue;
    const lower = index.lower[i]!;
    let total = 0;
    for (const t of terms) {
      const s = scoreTerm(t, lower, index.original[i]!, index.nameStart[i]!);
      if (s < 0) {
        total = -1;
        break;
      }
      total += s;
    }
    // Shorter targets win ties of quality: "index.ts" over "packages/x/src/legacy/index.ts".
    if (total >= 0) hits.push({ i, s: total - lower.length * 0.15 });
  }
  hits.sort((a, b) => b.s - a.s || (tieBreak ? tieBreak(b.i) - tieBreak(a.i) : 0));
  return hits.slice(0, limit).map((h) => h.i);
}
