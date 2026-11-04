/**
 * Linguist's content heuristics for shared extensions (.h, .m, .pl, .ts, .md, .v ...), run over
 * the generated rule table.
 *
 * Semantics follow lib/linguist/heuristics.rb: the first heuristic whose extension list the
 * filename ends with is the only one consulted, its rules are tried in order, and the first
 * rule that matches decides. Linguist reads the first 50 KiB; Skyplate only ever has the first
 * 8 KiB (the walker's head), which settles every rule that looks for declarations near the top
 * and loses only the rare one that needs a marker deep in a file.
 *
 * Patterns compile lazily and are cached: a repository typically meets a dozen of the ~400,
 * and compiling all of them up front would cost more than every match in a 50k-file run.
 */

import { HEURISTICS, PATTERNS, type Matcher } from "./linguist.generated";

const compiled: (RegExp | undefined)[] = new Array(PATTERNS.length);

function pattern(i: number): RegExp {
  let re = compiled[i];
  if (!re) {
    re = new RegExp(PATTERNS[i]!, "m");
    compiled[i] = re;
  }
  return re;
}

function matches(m: Matcher, text: string): boolean {
  if (m === null) return true;
  switch (m[0]) {
    case "p":
      for (let k = 1; k < m.length; k++) if (pattern(m[k] as number).test(text)) return true;
      return false;
    case "n":
      for (let k = 1; k < m.length; k++) if (pattern(m[k] as number).test(text)) return false;
      return true;
    case "&":
      for (let k = 1; k < m.length; k++) if (!matches(m[k] as Matcher, text)) return false;
      return true;
  }
}

// Extension → index of the first heuristic listing it. Lookups try every dotted suffix of the
// name and keep the lowest index, which reproduces linguist's "first heuristic whose extension
// the filename ends with" without scanning all 145 for every file.
let byExt: Map<string, number> | undefined;

function heuristicFor(lowerName: string): number {
  if (!byExt) {
    byExt = new Map();
    HEURISTICS.forEach(([exts], i) => {
      for (const e of exts) if (!byExt!.has(e)) byExt!.set(e, i);
    });
  }
  let best = -1;
  for (let dot = lowerName.indexOf("."); dot >= 0; dot = lowerName.indexOf(".", dot + 1)) {
    const i = byExt.get(lowerName.slice(dot));
    if (i !== undefined && (best < 0 || i < best)) best = i;
  }
  return best;
}

/** True when some heuristic covers this filename's extension. */
export function hasHeuristic(lowerName: string): boolean {
  return heuristicFor(lowerName) >= 0;
}

/**
 * Language ids the heuristics settle on for this file, best first, or undefined when no
 * heuristic applies or none of its rules matched. `lowerName` is the lowercased basename.
 */
export function runHeuristics(lowerName: string, text: string): readonly string[] | undefined {
  const h = heuristicFor(lowerName);
  if (h < 0) return undefined;
  for (const [langs, m] of HEURISTICS[h]![1]) if (matches(m, text)) return langs;
  return undefined;
}
