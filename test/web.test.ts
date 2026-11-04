/**
 * The cosmic web (src/shared/web.ts): deterministic, finite, never stacks two files on one
 * point, keeps every directory one neighborhood (the truth rule), bounds the bridge-file lean,
 * orders by gravity at every level, builds an honest filament skeleton, survives the shapes
 * real repositories throw at it, and fits the viewer's main-thread budget.
 *
 * Inputs are synthetic trees from a seeded generator, so each case is reproducible.
 */

import { describe, expect, test } from "bun:test";
import { computeWeb, GRAVITIES, gravityMass, type Web, type WebInput } from "../src/shared/web";

/**
 * The time budgets below are the viewer's main-thread budgets on the machine they were set on
 * (Apple M5). GitHub's hosted runners run the same code 2-3x slower and failed them by 10-20%
 * (357 ms against 300, 434 against 400), so CI gets the same 2.5x layout.test.ts gives
 * computeLayout. A layout that went quadratic still fails there: the sibling sweep the 10,000-
 * sibling test guards against took 780 ms locally, so at a runner's 2-3x it is far past 750.
 */
const CI_SLOWDOWN = process.env.CI ? 2.5 : 1;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shape {
  files: number;
  dirs: number;
  /** Extra weight on the first directories, so a few dominate. */
  skew?: number;
  /** Code edges per file. */
  edgeRate?: number;
  rootShare?: number;
  seed?: number;
}

/** A random tree: a broad top level with a few deep chains under it, hub-heavy imports. */
function synthetic({ files, dirs, skew = 2, edgeRate = 1.5, rootShare = 0.01, seed = 1 }: Shape): WebInput {
  const rand = prng(seed);
  const dirParent = [-1];
  const dirDirs: number[][] = [[]];
  const dirFiles: number[][] = [[]];
  for (let d = 1; d < dirs; d++) {
    const parent = d < Math.min(12, dirs) ? 0 : Math.floor(Math.pow(rand(), 0.7) * d);
    dirParent.push(parent);
    dirDirs.push([]);
    dirFiles.push([]);
    dirDirs[parent]!.push(d);
  }
  const fileDir: number[] = [];
  for (let f = 0; f < files; f++) {
    const d = rand() < rootShare || dirs === 1 ? 0 : 1 + Math.floor(Math.pow(rand(), skew) * (dirs - 1));
    fileDir.push(d);
    dirFiles[d]!.push(f);
  }
  const seen = new Set<number>();
  const from: number[] = [];
  const to: number[] = [];
  for (let e = 0; e < Math.floor(files * edgeRate) && files > 1; e++) {
    const a = Math.floor(rand() * files);
    const b = Math.floor(Math.pow(rand(), 3) * files);
    if (a === b || seen.has(a * files + b)) continue;
    seen.add(a * files + b);
    from.push(a);
    to.push(b);
  }
  return withMetrics({ fileCount: files, fileDir, dirParent, dirDirs, dirFiles, from, to }, seed);
}

/** Fan-in from the edges, PageRank-ish rank, and seeded complexity / size / git measures. */
function withMetrics(input: Omit<WebInput, "metrics">, seed = 1): WebInput {
  const rand = prng(seed * 31 + 5);
  const n = input.fileCount;
  const fanIn = new Float64Array(n);
  for (let k = 0; k < input.to.length; k++) fanIn[input.to[k]!]!++;
  const maxFan = Math.max(1, ...fanIn);
  return {
    ...input,
    metrics: {
      fanIn,
      rank: Float64Array.from(fanIn, (x) => x / maxFan),
      complexity: Float64Array.from({ length: n }, () => Math.floor(rand() * 60)),
      code: Float64Array.from({ length: n }, () => Math.floor(Math.exp(rand() * 7))),
      commits: Float64Array.from({ length: n }, () => Math.floor(rand() * 30)),
      modified: Float64Array.from({ length: n }, () => 1_600_000_000 + Math.floor(rand() * 1e8)),
      hotspot: Float64Array.from({ length: n }, () => rand()),
    },
  };
}

/** A hand-built tree: dirs as [parent, own file count]. */
function tree(spec: [number, number][], edges: [number, number][] = []): WebInput {
  const dirParent: number[] = [];
  const dirDirs: number[][] = [];
  const dirFiles: number[][] = [];
  const fileDir: number[] = [];
  spec.forEach(([parent, count], d) => {
    dirParent.push(parent);
    dirDirs.push([]);
    dirFiles.push([]);
    if (parent >= 0) dirDirs[parent]!.push(d);
    for (let k = 0; k < count; k++) {
      dirFiles[d]!.push(fileDir.length);
      fileDir.push(d);
    }
  });
  return withMetrics({
    fileCount: fileDir.length,
    fileDir,
    dirParent,
    dirDirs,
    dirFiles,
    from: edges.map((e) => e[0]),
    to: edges.map((e) => e[1]),
  });
}

function expectFinite(values: ArrayLike<number>, what: string) {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i]!)) throw new Error(`${what}[${i}] = ${values[i]}`);
}

/** Pairs of files closer than `eps` (a spatial hash, so 50k files stay cheap). */
function stackedPairs(pos: Float32Array, eps = 0.05): number {
  const n = pos.length / 3;
  const grid = new Map<string, number[]>();
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(pos[i * 3]!);
    const cy = Math.floor(pos[i * 3 + 1]!);
    const cz = Math.floor(pos[i * 3 + 2]!);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = Math.hypot(pos[i * 3]! - pos[j * 3]!, pos[i * 3 + 1]! - pos[j * 3 + 1]!, pos[i * 3 + 2]! - pos[j * 3 + 2]!);
            if (d < eps) pairs++;
          }
        }
    const key = `${cx},${cy},${cz}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  }
  return pairs;
}

const dist = (p: Float32Array, i: number, c: ArrayLike<number>, j = 0) => Math.hypot(p[i * 3]! - c[j]!, p[i * 3 + 1]! - c[j + 1]!, p[i * 3 + 2]! - c[j + 2]!);

/** Ancestor of `dir` at `depth` (or the dir itself when shallower). */
function ancestorAt(input: WebInput, dir: number, depth: number): number {
  const chain: number[] = [];
  for (let d = dir; d >= 0; d = input.dirParent[d]!) chain.unshift(d);
  return chain[Math.min(depth, chain.length - 1)]!;
}

/** Share of sampled files whose nearest other file sits under a different ancestor at `depth`. */
function foreignNeighbors(input: WebInput, web: Web, depth: number, step = 5): number {
  const n = input.fileCount;
  const p = web.positions;
  let foreign = 0;
  let sampled = 0;
  for (let i = 0; i < n; i += step) {
    if (web.lean[i]! > 0) continue;
    let best = Infinity;
    let who = -1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = (p[i * 3]! - p[j * 3]!) ** 2 + (p[i * 3 + 1]! - p[j * 3 + 1]!) ** 2 + (p[i * 3 + 2]! - p[j * 3 + 2]!) ** 2;
      if (d < best) {
        best = d;
        who = j;
      }
    }
    sampled++;
    if (ancestorAt(input, input.fileDir[who]!, depth) !== ancestorAt(input, input.fileDir[i]!, depth)) foreign++;
  }
  return foreign / Math.max(1, sampled);
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const order = xs.map((_, i) => i).sort((i, j) => xs[i]! - xs[j]!);
    const r = new Array<number>(xs.length);
    order.forEach((i, k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i]! - rb[i]!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

// ─── Gravity mass ────────────────────────────────────────────────────────────────────────────

describe("gravityMass", () => {
  test("is the quantile rank among nonzero values, ties sharing a rank, zeros massless", () => {
    const m = gravityMass({ fanIn: [], rank: [], complexity: [0, 5, 10, 10, 20] }, "complexity", 5);
    expect(m[0]).toBe(0);
    expect(m[1]).toBeCloseTo(0.25, 5);
    expect(m[2]).toBeCloseTo(0.625, 5);
    expect(m[3]).toBeCloseTo(0.625, 5);
    expect(m[4]).toBeCloseTo(1, 5);
  });

  test("dependencies count direct importers, PageRank only breaking ties", () => {
    const m = gravityMass({ fanIn: [0, 3, 3, 1], rank: [0.9, 0.2, 0.8, 1] }, "dependencies", 4);
    expect(m[0]).toBe(0); // nothing imports it, whatever its rank
    expect(m[2]!).toBeGreaterThan(m[1]!);
    expect(m[1]!).toBeGreaterThan(m[3]!);
  });

  test("a missing measure weighs every file at zero", () => {
    expect([...gravityMass({ fanIn: [1, 2], rank: [0, 0] }, "churn", 2)]).toEqual([0, 0]);
  });
});

// ─── computeWeb ──────────────────────────────────────────────────────────────────────────────

describe("computeWeb", () => {
  const medium = synthetic({ files: 3000, dirs: 400, seed: 7 });
  const web = computeWeb(medium);

  test("is deterministic across runs and inputs", () => {
    const again = computeWeb(synthetic({ files: 3000, dirs: 400, seed: 7 }));
    expect(again.positions).toEqual(web.positions);
    expect(again.dirCenter).toEqual(web.dirCenter);
    expect(again.dirRadius).toEqual(web.dirRadius);
    expect(again.filaments.curve).toEqual(web.filaments.curve);
  });

  test("edge order does not matter", () => {
    const shuffled = { ...medium, from: Array.from(medium.from).reverse(), to: Array.from(medium.to).reverse() };
    expect(computeWeb(shuffled).positions).toEqual(web.positions);
  });

  test("every number is finite, the arrays match the counts, and no two files share a point", () => {
    expect(web.positions.length).toBe(medium.fileCount * 3);
    expect(web.dirCenter.length).toBe(medium.dirParent.length * 3);
    expect(web.dirRadius.length).toBe(medium.dirParent.length);
    expectFinite(web.positions, "positions");
    expectFinite(web.dirCenter, "dirCenter");
    expectFinite(web.dirRadius, "dirRadius");
    expectFinite(web.filaments.curve, "curve");
    expect(web.radius).toBeGreaterThan(0);
    expect(stackedPairs(web.positions)).toBe(0);
  });

  test("it is a 3D structure, not a disc or a line", () => {
    // Principal spreads: the smallest is a real fraction of the largest.
    const p = web.positions;
    const n = medium.fileCount;
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) mean[j]! += p[i * 3 + j]! / n;
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++)
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b]! += ((p[i * 3 + a]! - mean[a]!) * (p[i * 3 + b]! - mean[b]!)) / n;
    // Trace and determinant bound the eigenvalues: det / (trace/3)^3 is 1 for a ball, 0 for a plane.
    const tr = cov[0]! + cov[4]! + cov[8]!;
    const det =
      cov[0]! * (cov[4]! * cov[8]! - cov[5]! * cov[7]!) - cov[1]! * (cov[3]! * cov[8]! - cov[5]! * cov[6]!) + cov[2]! * (cov[3]! * cov[7]! - cov[4]! * cov[6]!);
    expect(det / (tr / 3) ** 3).toBeGreaterThan(0.1);
  });

  // Every gravity, not only the default: gravity moves files inward and outward, and the truth
  // rule says no choice of it may move a file out of its directory's neighborhood.
  const webs = new Map<string, Web>(GRAVITIES.map((g) => [g, g === "dependencies" ? web : computeWeb(medium, g)]));

  test("truth rule: a directory's files are one neighborhood, at every level, under every gravity", () => {
    // A file's nearest neighbor is almost always under the same supercluster, and under the
    // same cluster; interleaved or stacked regions fail this.
    for (const [g, w] of webs) {
      const at1 = foreignNeighbors(medium, w, 1);
      const at2 = foreignNeighbors(medium, w, 2);
      if (at1 >= 0.03 || at2 >= 0.06) throw new Error(`${g}: foreign nearest neighbors ${at1} at depth 1, ${at2} at depth 2`);
    }
  });

  test("truth rule: sibling directories' spheres stay apart, under every gravity", () => {
    for (const [g, w] of webs) {
      const share = nestedSiblings(w);
      if (share >= 0.02) throw new Error(`${g}: ${share} of sibling pairs nested`);
    }
  });

  /** Share of sibling pairs (four or more files each) where one's sphere sits inside the other's. */
  function nestedSiblings(web: Web): number {
    // Spheres from each child's non-bridge files (centroid, farthest file): siblings may touch
    // where their clumps' halos meet, but never sit inside one another.
    const n = medium.fileCount;
    const D = medium.dirParent.length;
    const sum = new Float64Array(D * 3);
    const count = new Float64Array(D);
    const under = (f: number, fn: (d: number) => void) => {
      for (let d = medium.fileDir[f]!; d >= 0; d = medium.dirParent[d]!) fn(d);
    };
    for (let f = 0; f < n; f++) {
      if (web.lean[f]! > 0) continue;
      under(f, (d) => {
        for (let j = 0; j < 3; j++) sum[d * 3 + j]! += web.positions[f * 3 + j]!;
        count[d]!++;
      });
    }
    for (let d = 0; d < D; d++) for (let j = 0; j < 3; j++) sum[d * 3 + j] = sum[d * 3 + j]! / Math.max(1, count[d]!);
    const r = new Float64Array(D);
    for (let f = 0; f < n; f++) if (web.lean[f] === 0) under(f, (d) => (r[d] = Math.max(r[d]!, dist(web.positions, f, sum, d * 3))));
    let pairs = 0;
    let nested = 0;
    for (let d = 0; d < D; d++) {
      const kids = medium.dirDirs[d]!.filter((c) => count[c]! >= 4);
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i]!;
          const b = kids[j]!;
          const between = Math.hypot(sum[a * 3]! - sum[b * 3]!, sum[a * 3 + 1]! - sum[b * 3 + 1]!, sum[a * 3 + 2]! - sum[b * 3 + 2]!);
          pairs++;
          if (between + Math.min(r[a]!, r[b]!) < Math.max(r[a]!, r[b]!)) nested++;
        }
    }
    expect(pairs).toBeGreaterThan(50);
    return nested / pairs;
  }

  test("a directory's sphere contains every file beneath it", () => {
    for (let f = 0; f < medium.fileCount; f++) {
      for (let d = medium.fileDir[f]!; d >= 0; d = medium.dirParent[d]!) {
        const r = dist(web.positions, f, web.dirCenter, d * 3);
        if (r > web.dirRadius[d]! + 1e-3) throw new Error(`file ${f} lies ${r} from dir ${d} (radius ${web.dirRadius[d]})`);
      }
    }
  });

  test("bridge files lean along their filament, boundedly, staying on their own cluster's side", () => {
    const c = web.clusters.center;
    const fil = web.filaments;
    let leaning = 0;
    // Each cluster's reach from its center over files that do not lean.
    const reach = new Float64Array(web.clusters.dir.length);
    for (let f = 0; f < medium.fileCount; f++) if (web.lean[f] === 0) reach[web.fileCluster[f]!] = Math.max(reach[web.fileCluster[f]!]!, dist(web.positions, f, c, web.fileCluster[f]! * 3));
    for (let f = 0; f < medium.fileCount; f++) {
      const t = web.lean[f]!;
      if (t === 0) continue;
      leaning++;
      expect(t).toBeLessThanOrEqual(0.4);
      const own = web.fileCluster[f]!;
      // Its filament: one of the strands from its cluster; the file must sit nearer its own end.
      let best = Infinity;
      for (let i = 0; i < fil.a.length; i++) {
        if (fil.a[i] !== own && fil.b[i] !== own) continue;
        const other = fil.a[i] === own ? fil.b[i]! : fil.a[i]!;
        const ax = c[own * 3]!;
        const ay = c[own * 3 + 1]!;
        const az = c[own * 3 + 2]!;
        const bx = c[other * 3]! - ax;
        const by = c[other * 3 + 1]! - ay;
        const bz = c[other * 3 + 2]! - az;
        const len = Math.hypot(bx, by, bz);
        const along = ((web.positions[f * 3]! - ax) * bx + (web.positions[f * 3 + 1]! - ay) * by + (web.positions[f * 3 + 2]! - az) * bz) / len;
        best = Math.min(best, along - 0.4 * len - reach[own]!);
      }
      expect(best).toBeLessThanOrEqual(1e-3);
    }
    expect(leaning).toBeGreaterThan(0);
  });

  test("a bridge file stays within a few of its own directory's radii of that directory's other stars", () => {
    // The lean's absolute bound. A share of the strand alone let vite's playground/legacy configs
    // lean 300 units into the void, and the bound above (projection along the strand) could not
    // catch it: the strand is long, so 0.4 of it is far. A directory here is its whole subtree,
    // the neighborhood the truth rule speaks of.
    const n = medium.fileCount;
    const D = medium.dirParent.length;
    for (const [g, w] of webs) {
      const p = w.positions;
      const members: number[][] = Array.from({ length: D }, () => []);
      for (let f = 0; f < n; f++) for (let d = medium.fileDir[f]!; d >= 0; d = medium.dirParent[d]!) members[d]!.push(f);
      let checked = 0;
      for (let d = 0; d < D; d++) {
        const still = members[d]!.filter((f) => w.lean[f] === 0);
        if (still.length === 0) continue;
        const c = [0, 0, 0];
        for (const f of still) for (let j = 0; j < 3; j++) c[j]! += p[f * 3 + j]! / still.length;
        const r = Math.max(10, ...still.map((f) => dist(p, f, c)));
        for (const f of medium.dirFiles[d]!) {
          if (w.lean[f] === 0) continue;
          const near = Math.min(...still.map((o) => Math.hypot(p[f * 3]! - p[o * 3]!, p[f * 3 + 1]! - p[o * 3 + 1]!, p[f * 3 + 2]! - p[o * 3 + 2]!)));
          if (near > 4 * r) throw new Error(`${g}: bridge file ${f} sits ${near.toFixed(1)} from its directory's nearest other star (radius ${r.toFixed(1)})`);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(50);
    }
  });

  test("files with fewer than two cross-cluster edges never lean", () => {
    // Two clusters; file 0 has one edge across, files 6 and 7 have three each, all across.
    const input = tree(
      [
        [-1, 0],
        [0, 0],
        [1, 5], // dir 2: files 0-4
        [1, 5], // dir 3: files 5-9
      ],
      [
        [0, 5],
        [6, 1],
        [6, 2],
        [6, 3],
        [7, 1],
        [7, 2],
        [7, 4],
      ],
    );
    const w = computeWeb(input);
    expect(w.lean[0]).toBe(0);
    expect(w.lean[6]).toBeGreaterThan(0);
    expect(w.lean[7]).toBeGreaterThan(0);
  });

  test("gravity (a): heavier files sit nearer their clump's core", () => {
    const input = tree([
      [-1, 0],
      [0, 400],
    ]);
    for (const g of ["complexity", "size", "churn"] as const) {
      const w = computeWeb(input, g);
      const files = input.dirFiles[1]!;
      const r = files.map((f) => dist(w.positions, f, w.dirCenter, 3));
      const m = files.map((f) => w.mass[f]!);
      expect(spearman(m, r)).toBeLessThan(-0.8);
    }
  });

  test("gravity (b): heavier siblings sit nearer their parent's center", () => {
    // Eight equal subdirectories of a directory with files of its own; their masses differ.
    const spec: [number, number][] = [
      [-1, 0],
      [0, 30],
    ];
    for (let k = 0; k < 8; k++) spec.push([1, 25]);
    const input = tree(spec);
    const complexity = new Float64Array(input.fileCount);
    for (let k = 0; k < 8; k++) for (const f of input.dirFiles[2 + k]!) complexity[f] = 1 + k * k * 10;
    input.metrics.complexity = complexity;
    const w = computeWeb(input, "complexity");
    // The parent's own clump: the centroid of its own files.
    const core = [0, 0, 0];
    for (const f of input.dirFiles[1]!) for (let j = 0; j < 3; j++) core[j]! += w.positions[f * 3 + j]! / input.dirFiles[1]!.length;
    const d = Array.from({ length: 8 }, (_, k) => dist(w.dirCenter, 2 + k, core));
    const mass = Array.from({ length: 8 }, (_, k) => k);
    expect(spearman(mass, d)).toBeLessThan(-0.5);
  });

  test("gravity (c): a heavy clump is denser than a light one of the same size", () => {
    const input = tree([
      [-1, 0],
      [0, 120],
      [0, 120],
    ]);
    const complexity = new Float64Array(input.fileCount);
    for (const f of input.dirFiles[1]!) complexity[f] = 100 + f;
    for (const f of input.dirFiles[2]!) complexity[f] = 1;
    input.metrics.complexity = complexity;
    const w = computeWeb(input, "complexity");
    expect(w.dirRadius[1]!).toBeLessThan(w.dirRadius[2]! * 0.9);
  });

  test("the filament skeleton spans every coupled component, keeps each node's strongest link, and leaves loners alone", () => {
    const fil = web.filaments;
    const C = web.clusters.dir.length;
    const F = fil.a.length;
    expect(F).toBeGreaterThan(0);
    // Coupling between clusters, from the edges.
    const coupling = new Map<number, number>();
    for (let k = 0; k < medium.from.length; k++) {
      const a = web.fileCluster[medium.from[k]!]!;
      const b = web.fileCluster[medium.to[k]!]!;
      if (a === b) continue;
      const key = Math.min(a, b) * C + Math.max(a, b);
      coupling.set(key, (coupling.get(key) ?? 0) + 1);
    }
    const seen = new Set<number>();
    for (let i = 0; i < F; i++) {
      const a = fil.a[i]!;
      const b = fil.b[i]!;
      expect(a).toBeLessThan(b);
      const key = a * C + b;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(fil.coupling[i]).toBe(coupling.get(key)!);
      expect(fil.weight[i]!).toBeGreaterThan(0);
      expect(fil.weight[i]!).toBeLessThanOrEqual(1);
    }
    // Same connected components as the full coupling graph.
    const comps = (pairs: Iterable<number>) => {
      const parent = Int32Array.from({ length: C }, (_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      for (const key of pairs) parent[find(Math.floor(key / C))] = find(key % C);
      return Array.from({ length: C }, (_, i) => find(i));
    };
    const all = comps(coupling.keys());
    const skel = comps(seen);
    for (let i = 0; i < C; i++) for (let j = i + 1; j < C; j++) expect(all[i] === all[j]).toBe(skel[i] === skel[j]);
    // Every node's strongest coupling is drawn (when it is unique).
    for (let c = 0; c < C; c++) {
      let best = -1;
      let bestW = 0;
      let tie = false;
      for (const [key, w] of coupling) {
        if (Math.floor(key / C) !== c && key % C !== c) continue;
        if (w > bestW) {
          bestW = w;
          best = key;
          tie = false;
        } else if (w === bestW) tie = true;
      }
      if (best >= 0 && !tie) expect(seen.has(best)).toBe(true);
    }
    // A forest plus at most two extra links per node.
    expect(F).toBeLessThanOrEqual(C - 1 + 2 * C);
    // A cluster with no coupling has no strand.
    const loner = tree([
      [-1, 0],
      [0, 0],
      [1, 6],
      [1, 6],
      [1, 6],
    ], [
      [0, 6],
      [1, 7],
    ]);
    const lw = computeWeb(loner);
    const lonerCluster = lw.fileCluster[12]!;
    for (let i = 0; i < lw.filaments.a.length; i++) {
      expect(lw.filaments.a[i]).not.toBe(lonerCluster);
      expect(lw.filaments.b[i]).not.toBe(lonerCluster);
    }
    expect(lw.filaments.a.length).toBe(1);
  });

  test("handles empty, single-file, root-only and edgeless projects", () => {
    const empty = computeWeb({ fileCount: 0, fileDir: [], dirParent: [-1], dirDirs: [[]], dirFiles: [[]], from: [], to: [], metrics: { fanIn: [], rank: [] } });
    expect(empty.positions.length).toBe(0);
    expect(empty.radius).toBe(0);

    const one = computeWeb(tree([[-1, 1]]));
    expectFinite(one.positions, "positions");
    expectFinite(one.dirCenter, "dirCenter");
    expect(one.filaments.a.length).toBe(0);

    const rootOnly = computeWeb(synthetic({ files: 300, dirs: 1, seed: 3 }));
    expectFinite(rootOnly.positions, "positions");
    expect(stackedPairs(rootOnly.positions)).toBe(0);

    const edgeless = computeWeb(synthetic({ files: 500, dirs: 60, edgeRate: 0, seed: 5 }));
    expectFinite(edgeless.positions, "positions");
    expect(stackedPairs(edgeless.positions)).toBe(0);
    expect(edgeless.filaments.a.length).toBe(0);
    expect(edgeless.lean.every((t) => t === 0)).toBe(true);
  });

  test("one directory of 10,000 files is a strand of knots, not one ball", () => {
    const input = tree([
      [-1, 2],
      [0, 10_000],
    ]);
    const w = computeWeb(input);
    expectFinite(w.positions, "positions");
    expect(stackedPairs(w.positions)).toBe(0);
    // Knots of ~220 files in name order: each is far tighter than the whole.
    const files = [...input.dirFiles[1]!];
    const spread = (ids: number[]) => {
      const c = [0, 0, 0];
      for (const f of ids) for (let j = 0; j < 3; j++) c[j]! += w.positions[f * 3 + j]! / ids.length;
      return Math.sqrt(ids.reduce((s, f) => s + dist(w.positions, f, c) ** 2, 0) / ids.length);
    };
    const whole = spread(files);
    const knots: number[] = [];
    const K = Math.ceil(files.length / 220);
    for (let k = 0; k < K; k++) knots.push(spread(files.slice(Math.floor((k * files.length) / K), Math.floor(((k + 1) * files.length) / K))));
    const mean = knots.reduce((a, b) => a + b, 0) / knots.length;
    expect(mean).toBeLessThan(whole * 0.35);
  });

  test("a 30-deep chain coils instead of running out as a needle, and stays bounded", () => {
    const spec: [number, number][] = [[-1, 3]];
    for (let d = 1; d <= 30; d++) spec.push([d - 1, 5]);
    const input = tree(spec);
    const w = computeWeb(input);
    expectFinite(w.positions, "positions");
    expect(stackedPairs(w.positions)).toBe(0);
    // Bounded: linear in depth, not compounding per level.
    expect(w.radius).toBeLessThan(30 * 40);
    // Not a needle: the cloud's second principal spread is a real share of its first.
    const n = input.fileCount;
    const p = w.positions;
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) mean[j]! += p[i * 3 + j]! / n;
    let sxx = 0;
    let syy = 0;
    let szz = 0;
    let sxy = 0;
    let sxz = 0;
    let syz = 0;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3]! - mean[0]!;
      const y = p[i * 3 + 1]! - mean[1]!;
      const z = p[i * 3 + 2]! - mean[2]!;
      sxx += x * x;
      syy += y * y;
      szz += z * z;
      sxy += x * y;
      sxz += x * z;
      syz += y * z;
    }
    // Largest eigenvalue by power iteration; the rest of the trace is what a needle lacks.
    let v = [1, 1, 1];
    let lambda = 0;
    for (let it = 0; it < 60; it++) {
      const nv = [sxx * v[0]! + sxy * v[1]! + sxz * v[2]!, sxy * v[0]! + syy * v[1]! + syz * v[2]!, sxz * v[0]! + syz * v[1]! + szz * v[2]!];
      lambda = Math.hypot(...nv);
      v = nv.map((x) => x / lambda);
    }
    const trace = sxx + syy + szz;
    expect((trace - lambda) / lambda).toBeGreaterThan(0.15);
  });

  test("wrapper directories with no files of their own cost no space", () => {
    // src/main/java/com/acme/app: five wrappers, then the files.
    const chain = tree([
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 50],
    ]);
    const w = computeWeb(chain);
    // Every wrapper shares the leaf's sphere: same center, same radius.
    for (let d = 1; d < 6; d++) {
      expect(w.dirRadius[d]).toBeCloseTo(w.dirRadius[6]!, 4);
      for (let j = 0; j < 3; j++) expect(w.dirCenter[d * 3 + j]).toBeCloseTo(w.dirCenter[18 + j]!, 4);
    }
  });

  test("thousands of sibling directories are laid out in linear time", () => {
    // One parent with 10,000 one-file children (a DefinitelyTyped-like fan-out). The collision
    // sweep this replaced was quadratic in siblings: 780 ms here, 2.7 s at 20,000 (measured).
    const spec: [number, number][] = [
      [-1, 3],
      [0, 0],
    ];
    for (let k = 0; k < 10_000; k++) spec.push([1, 1]);
    const input = tree(spec);
    let best = Infinity;
    let w: Web | null = null;
    for (let run = 0; run < 2; run++) {
      const t0 = performance.now();
      w = computeWeb(input);
      best = Math.min(best, performance.now() - t0);
    }
    expectFinite(w!.positions, "positions");
    expect(stackedPairs(w!.positions)).toBe(0);
    expect(best).toBeLessThan(300 * CI_SLOWDOWN);
  }, 30_000);

  test("stays inside the viewer's main-thread budget at 20k and 50k files", () => {
    for (const [files, dirs, budget] of [
      [20_000, 2500, 150],
      [50_000, 6000, 400],
    ] as const) {
      const input = synthetic({ files, dirs, seed: 13 });
      let best = Infinity;
      let w: Web | null = null;
      for (let run = 0; run < 2; run++) {
        const t0 = performance.now();
        w = computeWeb(input, run === 0 ? "dependencies" : "complexity");
        best = Math.min(best, performance.now() - t0);
      }
      expectFinite(w!.positions, "positions");
      expect(stackedPairs(w!.positions)).toBe(0);
      expect(best).toBeLessThan(budget * CI_SLOWDOWN);
    }
  }, 30_000);
});
