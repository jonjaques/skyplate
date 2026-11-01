/**
 * Import-graph analysis: fan-in/out, PageRank, cycles (strongly connected components) and
 * Robert C. Martin's module coupling (Ca, Ce, instability) with a module-to-module matrix.
 *
 * The graph is the set of distinct (from, to) file pairs; repeated imports between the same two
 * files are one edge, and self-imports are dropped, since neither says anything about how the
 * codebase is coupled. Everything is linear or near-linear in files + edges and iterative, so
 * a 50k-file monorepo neither stalls nor overflows the stack.
 */

import type { AnalyzeGraph, GraphInput, GraphResult } from "./contracts";
import type { Cycle } from "../shared/schema";

const DAMPING = 0.85;
const MAX_ITERATIONS = 60;
/** L1 change per node below which PageRank counts as converged. */
const TOLERANCE = 1e-10;

/**
 * Readable module-matrix bounds: splitting continues below the target, never past MAX. The
 * target grows with the graph (√connected / 1.5, clamped to 4–12) so a 60-file project is not
 * chopped into a dozen two-file modules to fill a quota.
 */
const MIN_TARGET = 4;
const MAX_TARGET = 12;
const MAX_MODULES = 24;
/** A module holding more than this share of connected files is split whenever the cap allows. */
const SPLIT_SHARE = 1 / 3;
/** Modules below this share are never split just to reach the target; they are detail. */
const MIN_SPLIT_SHARE = 0.05;
/** Subdirectories below this share fold into their parent's "rest" module instead of standing alone. */
const MINOR_SHARE = 0.02;

// ─── Adjacency ───────────────────────────────────────────────────────────────────────────────

interface Csr {
  /** out[outStart[v] .. outStart[v + 1]) are v's distinct successors. */
  outStart: Int32Array;
  out: Int32Array;
  inDegree: Int32Array;
}

/** Compressed sparse rows of the distinct, non-self edges. */
function buildCsr(n: number, from: number[], to: number[]): Csr {
  const m = Math.min(from.length, to.length);
  const keys = new Float64Array(m);
  let count = 0;
  for (let k = 0; k < m; k++) {
    const a = from[k]!;
    const b = to[k]!;
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    keys[count++] = a * n + b;
  }
  // Sorting the packed keys groups each source's targets and exposes duplicates in one pass.
  // a * n + b stays exact for n up to ~9.4e7 (2^53), far past any repository.
  const sorted = keys.subarray(0, count).sort();
  const outStart = new Int32Array(n + 1);
  const out: number[] = [];
  const inDegree = new Int32Array(n);
  let prev = -1;
  for (const key of sorted) {
    if (key === prev) continue;
    prev = key;
    const a = Math.floor(key / n);
    const b = key - a * n;
    outStart[a + 1]!++;
    out.push(b);
    inDegree[b]!++;
  }
  for (let v = 0; v < n; v++) outStart[v + 1]! += outStart[v]!;
  return { outStart, out: Int32Array.from(out), inDegree };
}

// ─── PageRank ────────────────────────────────────────────────────────────────────────────────

/**
 * Power iteration with uniform teleport. Rank mass on dangling nodes (files that import
 * nothing — most leaves of an import graph) is spread uniformly each step instead of leaking,
 * so the vector stays a distribution and converges. Edges point importer → imported, so the
 * most depended-upon files rank highest. Max-normalized to 1; all zeros for an empty graph.
 */
function pageRank(n: number, g: Csr): number[] {
  if (n === 0) return [];
  if (g.out.length === 0) return new Array<number>(n).fill(0);
  let rank = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  const outDeg = new Int32Array(n);
  for (let v = 0; v < n; v++) outDeg[v] = g.outStart[v + 1]! - g.outStart[v]!;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let dangling = 0;
    for (let v = 0; v < n; v++) if (outDeg[v] === 0) dangling += rank[v]!;
    const base = (1 - DAMPING) / n + (DAMPING * dangling) / n;
    next.fill(base);
    for (let v = 0; v < n; v++) {
      const d = outDeg[v]!;
      if (d === 0) continue;
      const share = (DAMPING * rank[v]!) / d;
      for (let k = g.outStart[v]!; k < g.outStart[v + 1]!; k++) next[g.out[k]!]! += share;
    }
    let delta = 0;
    for (let v = 0; v < n; v++) delta += Math.abs(next[v]! - rank[v]!);
    [rank, next] = [next, rank];
    if (delta < TOLERANCE * n) break;
  }
  let max = 0;
  for (let v = 0; v < n; v++) if (rank[v]! > max) max = rank[v]!;
  const result = new Array<number>(n);
  for (let v = 0; v < n; v++) result[v] = max > 0 ? rank[v]! / max : 0;
  return result;
}

// ─── Strongly connected components ───────────────────────────────────────────────────────────

/**
 * Tarjan's algorithm with an explicit call stack. The recursive form overflows on long import
 * chains (a 50k-file graph can nest that deep), so each frame is (node, next-edge cursor) and
 * "returning" means popping a frame and folding its lowlink into the parent's.
 * Returns the component index of every node, components numbered in completion order.
 */
function stronglyConnected(n: number, g: Csr): { comp: Int32Array; sizes: number[] } {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let sp = 0;
  const callNode = new Int32Array(n);
  const callEdge = new Int32Array(n);
  let depth = 0;
  let counter = 0;
  const sizes: number[] = [];

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    callNode[0] = root;
    callEdge[0] = g.outStart[root]!;
    index[root] = low[root] = counter++;
    stack[sp++] = root;
    onStack[root] = 1;
    depth = 1;
    while (depth > 0) {
      const v = callNode[depth - 1]!;
      const e = callEdge[depth - 1]!;
      if (e < g.outStart[v + 1]!) {
        callEdge[depth - 1] = e + 1;
        const w = g.out[e]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack[sp++] = w;
          onStack[w] = 1;
          callNode[depth] = w;
          callEdge[depth] = g.outStart[w]!;
          depth++;
        } else if (onStack[w]) {
          if (index[w]! < low[v]!) low[v] = index[w]!;
        }
        continue;
      }
      // All edges of v explored.
      if (low[v] === index[v]) {
        const id = sizes.length;
        let size = 0;
        let w: number;
        do {
          w = stack[--sp]!;
          onStack[w] = 0;
          comp[w] = id;
          size++;
        } while (w !== v);
        sizes.push(size);
      }
      depth--;
      if (depth > 0) {
        const parent = callNode[depth - 1]!;
        if (low[v]! < low[parent]!) low[parent] = low[v]!;
      }
    }
  }
  return { comp, sizes };
}

// ─── Modules ─────────────────────────────────────────────────────────────────────────────────

/**
 * Which directories count as modules for the coupling matrix.
 *
 * A single fixed depth reads badly on real trees: depth 1 of a monorepo is one giant
 * `packages/` box, and depth 2 of Vite turns `playground/` into eighty modules. So modules are
 * chosen by splitting, over connected files only (a directory of images adds nothing to a
 * coupling matrix):
 *   1. start from the root's children (and the root itself for files directly in it);
 *   2. a module qualifies for splitting when its children keep the total within MAX_MODULES
 *      and it holds more than SPLIT_SHARE of the connected files, or there are fewer than
 *      the target count and it holds at least MIN_SPLIT_SHARE; split the shallowest
 *      qualifying module (ties: most files gained per added module) and repeat.
 * A single-child chain (`src/` wrapping everything) splits into that child, so wrappers are
 * descended through. Breadth first is what makes a monorepo come out as one module per package
 * under `packages/` and `apps/` — the depth-2 view people expect — before any one package is
 * opened up, while a fixture directory too wide for the cap stays whole. `moduleDepth` reports the deepest directory chosen; with mixed
 * depths it is a maximum, not a uniform level.
 */
function chooseModules(input: GraphInput, connected: Uint8Array, rank: number[]): { moduleOf: Int32Array; modules: number[]; depth: number } {
  const { fileDir, dirParent, dirDepth } = input;
  const dirCount = dirParent.length;
  const n = input.fileCount;
  // Connected files per directory, recursively, and direct children per directory.
  const weight = new Float64Array(dirCount);
  const direct = new Float64Array(dirCount);
  const rankMass = new Float64Array(dirCount);
  const children: number[][] = Array.from({ length: dirCount }, () => []);
  let root = -1;
  for (let d = 0; d < dirCount; d++) {
    const p = dirParent[d]!;
    if (p >= 0 && p < dirCount) children[p]!.push(d);
    else if (root < 0) root = d;
  }
  if (root < 0) return { moduleOf: new Int32Array(n).fill(-1), modules: [], depth: 0 };
  let total = 0;
  let totalRank = 0;
  for (let f = 0; f < n; f++) {
    if (!connected[f]) continue;
    const d = fileDir[f]!;
    if (d < 0 || d >= dirCount) continue;
    direct[d]!++;
    total++;
    totalRank += rank[f]!;
    for (let a = d; a >= 0 && a < dirCount; a = dirParent[a]!) {
      weight[a]!++;
      rankMass[a]! += rank[f]!;
    }
  }

  // A module is a directory. When a directory is split, its own files and its minor
  // subdirectories stay together as its "rest" module (`self`), labeled with the directory.
  // Minor means under MINOR_SHARE of the connected files *and* of the PageRank mass: `.vscode/`
  // folds away, but a 13-file `packages/shared` that everything imports stands alone. Without
  // the fold, a dozen two-file dot-directories at the root eat the module budget and the cap
  // then forbids splitting `packages/`, which is the split that matters.
  interface Mod {
    dir: number;
    self: boolean;
    minors: number[];
  }
  const size = (m: Mod) => (m.self ? m.minors.reduce((sum, c) => sum + weight[c]!, direct[m.dir]!) : weight[m.dir]!);
  const expand = (dir: number, isRoot = false): Mod[] => {
    const kids = children[dir]!.filter((c) => weight[c]! > 0);
    const isMajor = (c: number) => weight[c]! / total >= MINOR_SHARE || (totalRank > 0 && rankMass[c]! / totalRank >= MINOR_SHARE);
    const major = kids.filter(isMajor);
    if (major.length === 0 && !isRoot) return []; // only crumbs below: not worth splitting
    const keep = major.length === 0 ? kids : major;
    const minors = major.length === 0 ? [] : kids.filter((c) => !isMajor(c));
    const parts: Mod[] = keep.map((c) => ({ dir: c, self: false, minors: [] }));
    if (direct[dir]! > 0 || minors.length) parts.push({ dir, self: true, minors });
    return parts;
  };
  const target = Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(Math.sqrt(total) / 1.5)));
  let mods: Mod[] = total > 0 ? expand(root, true) : [];
  for (;;) {
    // Breadth first: every qualifying module at depth d is split before anything at d + 1, so
    // the budget goes to `packages/*` before `apps/game/src/*`. Within a depth, the split that
    // buys the most files per added module goes first: `packages/` → 3 modules before an
    // 80-fixture `playground/` → 11.
    let best = -1;
    let bestParts: Mod[] = [];
    let bestDepth = Infinity;
    let bestValue = -Infinity;
    for (let k = 0; k < mods.length; k++) {
      const m = mods[k]!;
      if (m.self) continue;
      const share = size(m) / total;
      if (share <= SPLIT_SHARE && (mods.length >= target || share < MIN_SPLIT_SHARE)) continue;
      const parts = expand(m.dir);
      if (parts.length < 2 && !(parts.length === 1 && !parts[0]!.self)) continue;
      if (mods.length - 1 + parts.length > MAX_MODULES) continue;
      const depth = dirDepth[m.dir] ?? 0;
      const value = size(m) / Math.max(1, parts.length - 1);
      if (depth < bestDepth || (depth === bestDepth && value > bestValue)) {
        best = k;
        bestParts = parts;
        bestDepth = depth;
        bestValue = value;
      }
    }
    if (best < 0) break;
    mods = [...mods.slice(0, best), ...bestParts, ...mods.slice(best + 1)];
  }
  // A top-level container whose files all sit in one subdirectory is better named by it
  // (`apps/web`, not `apps`); descending costs no budget. Deeper down it stops, or every
  // package would be labeled by its `src/` wrapper (`packages/shared/src`).
  mods = mods.map((m) => {
    let cur = m;
    for (;;) {
      if (cur.self || (dirDepth[cur.dir] ?? 0) >= 2) return cur;
      const parts = expand(cur.dir);
      if (parts.length !== 1 || parts[0]!.self) return cur;
      cur = parts[0]!;
    }
  });

  // Assign files: a file belongs to the module whose directory is its nearest chosen ancestor
  // (a `self` module only takes files directly inside its directory).
  const subtreeModule = new Int32Array(dirCount).fill(-1);
  const selfModule = new Int32Array(dirCount).fill(-1);
  mods.sort((a, b) => a.dir - b.dir || Number(a.self) - Number(b.self));
  const modules: number[] = [];
  mods.forEach((m, i) => {
    modules.push(m.dir);
    if (m.self) {
      selfModule[m.dir] = i;
      for (const c of m.minors) subtreeModule[c] = i;
    } else subtreeModule[m.dir] = i;
  });
  const moduleOfDir = new Int32Array(dirCount).fill(-2); // -2 = not computed
  const resolveDir = (d: number): number => {
    const chain: number[] = [];
    let a = d;
    let found = -1;
    while (a >= 0 && a < dirCount) {
      if (moduleOfDir[a] !== -2) {
        found = moduleOfDir[a]!;
        break;
      }
      chain.push(a);
      if (subtreeModule[a]! >= 0) {
        found = subtreeModule[a]!;
        break;
      }
      a = dirParent[a]!;
    }
    for (const c of chain) moduleOfDir[c] = found;
    return found;
  };
  const moduleOf = new Int32Array(n).fill(-1);
  for (let f = 0; f < n; f++) {
    const d = fileDir[f]!;
    if (d < 0 || d >= dirCount) continue;
    moduleOf[f] = selfModule[d]! >= 0 ? selfModule[d]! : resolveDir(d);
  }
  let depth = 0;
  for (const d of modules) depth = Math.max(depth, dirDepth[d] ?? 0);
  return { moduleOf, modules, depth };
}

// ─── analyzeGraph ────────────────────────────────────────────────────────────────────────────

export const analyzeGraph: AnalyzeGraph = (input) => {
  const n = input.fileCount;
  const g = buildCsr(n, input.from, input.to);
  const fanOut = new Array<number>(n);
  const fanIn = new Array<number>(n);
  const connected = new Uint8Array(n);
  let connectedCount = 0;
  for (let v = 0; v < n; v++) {
    fanOut[v] = g.outStart[v + 1]! - g.outStart[v]!;
    fanIn[v] = g.inDegree[v]!;
    if (fanOut[v]! > 0 || fanIn[v]! > 0) {
      connected[v] = 1;
      connectedCount++;
    }
  }
  const rank = pageRank(n, g);

  // Cycles: components of two or more files, largest first, ids in that order.
  const { comp, sizes } = stronglyConnected(n, g);
  const members = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    const c = comp[v]!;
    if (sizes[c]! < 2) continue;
    const list = members.get(c);
    if (list) list.push(v);
    else members.set(c, [v]);
  }
  const groups = [...members.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  const cycle = new Array<number>(n).fill(-1);
  const cycles: Cycle[] = groups.map((files, id) => {
    for (const f of files) cycle[f] = id;
    return { id, files: files.sort((a, b) => rank[b]! - rank[a]! || a - b) };
  });

  // Module coupling over the chosen modules.
  const { moduleOf, modules, depth } = chooseModules(input, connected, rank);
  const mCount = modules.length;
  const matrix: number[][] = Array.from({ length: mCount }, () => new Array<number>(mCount).fill(0));
  // Martin: Ca = files outside that depend on the module; Ce = files inside that depend outward.
  const caFiles: Set<number>[] = Array.from({ length: mCount }, () => new Set());
  const ceFiles: Set<number>[] = Array.from({ length: mCount }, () => new Set());
  for (let v = 0; v < n; v++) {
    const mv = moduleOf[v]!;
    for (let k = g.outStart[v]!; k < g.outStart[v + 1]!; k++) {
      const w = g.out[k]!;
      const mw = moduleOf[w]!;
      if (mv < 0 || mw < 0) continue;
      matrix[mv]![mw]!++;
      if (mv !== mw) {
        ceFiles[mv]!.add(v);
        caFiles[mw]!.add(v);
      }
    }
  }
  const moduleSummary = modules.map((dir, i) => {
    const ca = caFiles[i]!.size;
    const ce = ceFiles[i]!.size;
    return { dir, ca, ce, instability: ca + ce === 0 ? 0 : ce / (ca + ce) };
  });

  const result: GraphResult = {
    fanIn,
    fanOut,
    rank,
    cycle,
    summary: {
      edges: g.out.length,
      connected: connectedCount,
      cycles,
      modules: moduleSummary,
      moduleMatrix: matrix,
      moduleDepth: depth,
    },
  };
  return result;
};
