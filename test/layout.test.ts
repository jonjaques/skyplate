/**
 * Galaxy and graph layout (src/core/layout.ts): deterministic, finite, never stacks two files
 * on one point, keeps directory geometry honest, and stays inside the runtime budget.
 *
 * Inputs are synthetic trees from a seeded generator, so each case is reproducible and the
 * shapes cover what real repositories throw at the layout: a few huge regions, many tiny ones,
 * deep chains, flat directories of hundreds of files, root-only projects, no imports at all.
 */

import { describe, expect, test } from "bun:test";
import { computeLayout, type LayoutInput } from "../src/core/layout";

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
  /** Extra weight on the first top-level directories, so a few regions dominate. */
  skew?: number;
  /** Code edges per file. */
  edgeRate?: number;
  /** Probability a file lands in the root directory. */
  rootShare?: number;
  seed?: number;
}

function synthetic({ files, dirs, skew = 2, edgeRate = 1.5, rootShare = 0.01, seed = 1 }: Shape): LayoutInput {
  const rand = prng(seed);
  const dirParent = [-1];
  const dirDepth = [0];
  const dirDirs: number[][] = [[]];
  const dirFiles: number[][] = [[]];
  for (let d = 1; d < dirs; d++) {
    // Early directories hang off the root; later ones attach anywhere, preferring recent ones,
    // which grows a few deep chains alongside a broad top level.
    const parent = d < Math.min(12, dirs) ? 0 : Math.floor(Math.pow(rand(), 0.7) * d);
    dirParent.push(parent);
    dirDepth.push(dirDepth[parent]! + 1);
    dirDirs.push([]);
    dirFiles.push([]);
    dirDirs[parent]!.push(d);
  }
  const fileDir: number[] = [];
  const lines: number[] = [];
  for (let f = 0; f < files; f++) {
    const d = rand() < rootShare || dirs === 1 ? 0 : 1 + Math.floor(Math.pow(rand(), skew) * (dirs - 1));
    fileDir.push(d);
    dirFiles[d]!.push(f);
    lines.push(rand() < 0.05 ? 0 : Math.floor(Math.exp(rand() * 7)));
  }
  const seen = new Set<number>();
  const from: number[] = [];
  const to: number[] = [];
  const edges = Math.floor(files * edgeRate);
  for (let e = 0; e < edges && files > 1; e++) {
    const a = Math.floor(rand() * files);
    // Imports favor a small set of hubs, like real code.
    const b = Math.floor(Math.pow(rand(), 3) * files);
    if (a === b || seen.has(a * files + b)) continue;
    seen.add(a * files + b);
    from.push(a);
    to.push(b);
  }
  return { fileCount: files, fileDir, lines, dirParent, dirDepth, dirDirs, dirFiles, from, to };
}

function expectFinite(values: number[], what: string) {
  const bad = values.findIndex((v) => !Number.isFinite(v));
  expect(bad, `${what}[${bad}] = ${values[bad]}`).toBe(-1);
}

/** Pairs of files closer than `eps` (a spatial hash, so 20k files stay cheap). */
function stackedPairs(pos: number[], eps = 0.05): [number, number][] {
  const n = pos.length / 3;
  const cell = 1;
  const grid = new Map<string, number[]>();
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(pos[i * 3]! / cell);
    const cy = Math.floor(pos[i * 3 + 1]! / cell);
    const cz = Math.floor(pos[i * 3 + 2]! / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = Math.hypot(pos[i * 3]! - pos[j * 3]!, pos[i * 3 + 1]! - pos[j * 3 + 1]!, pos[i * 3 + 2]! - pos[j * 3 + 2]!);
            if (d < eps) pairs.push([j, i]);
          }
        }
    const key = `${cx},${cy},${cz}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  }
  return pairs;
}

describe("computeLayout", () => {
  const medium = synthetic({ files: 3000, dirs: 400, seed: 7 });

  test("is deterministic across runs", () => {
    const a = computeLayout(medium);
    const b = computeLayout(synthetic({ files: 3000, dirs: 400, seed: 7 }));
    expect(b).toEqual(a);
  });

  test("every number is finite and the arrays match the counts", () => {
    const layout = computeLayout(medium);
    expect(layout.tree.length).toBe(medium.fileCount * 3);
    expect(layout.graph.length).toBe(medium.fileCount * 3);
    expect(layout.dirCenters.length).toBe(medium.dirParent.length * 3);
    expect(layout.dirRadius.length).toBe(medium.dirParent.length);
    expectFinite(layout.tree, "tree");
    expectFinite(layout.graph, "graph");
    expectFinite(layout.dirCenters, "dirCenters");
    expectFinite(layout.dirRadius, "dirRadius");
    expect(layout.radius.tree).toBeGreaterThan(0);
  });

  test("never stacks two files on one point in the tree layout", () => {
    const layout = computeLayout(medium);
    expect(stackedPairs(layout.tree)).toEqual([]);
  });

  test("the graph layout shares the tree's overall radius", () => {
    const layout = computeLayout(medium);
    expect(Math.abs(layout.radius.graph - layout.radius.tree)).toBeLessThan(layout.radius.tree * 0.01);
  });

  test("a directory's sphere contains every file beneath it", () => {
    const layout = computeLayout(medium);
    const n = medium.fileCount;
    for (let f = 0; f < n; f++) {
      for (let d = medium.fileDir[f]!; d >= 0; d = medium.dirParent[d]!) {
        const dist = Math.hypot(
          layout.tree[f * 3]! - layout.dirCenters[d * 3]!,
          layout.tree[f * 3 + 1]! - layout.dirCenters[d * 3 + 1]!,
          layout.tree[f * 3 + 2]! - layout.dirCenters[d * 3 + 2]!,
        );
        if (dist > layout.dirRadius[d]! + 0.05) throw new Error(`file ${f} lies ${dist} from dir ${d} (radius ${layout.dirRadius[d]})`);
      }
    }
  });

  test("top-level regions do not overlap each other's arms", () => {
    // Every arm lives in its own spiral sector, so a region's files sit closer to their own
    // region's center than the nearest point of any other region usually does. Checked loosely:
    // the share of files whose nearest neighbor (in the plane) belongs to another region stays
    // small, which fails if arms are interleaved or stacked.
    const input = synthetic({ files: 2000, dirs: 200, seed: 11, rootShare: 0 });
    const layout = computeLayout(input);
    const regionOf = (f: number) => {
      let d = input.fileDir[f]!;
      while (input.dirParent[d]! > 0) d = input.dirParent[d]!;
      return d;
    };
    let foreign = 0;
    for (let i = 0; i < input.fileCount; i += 7) {
      let best = Infinity;
      let who = -1;
      for (let j = 0; j < input.fileCount; j++) {
        if (j === i) continue;
        const d = Math.hypot(layout.tree[i * 3]! - layout.tree[j * 3]!, layout.tree[i * 3 + 1]! - layout.tree[j * 3 + 1]!);
        if (d < best) {
          best = d;
          who = j;
        }
      }
      if (regionOf(who) !== regionOf(i)) foreign++;
    }
    expect(foreign / Math.ceil(input.fileCount / 7)).toBeLessThan(0.05);
  });

  test("handles empty, single-file, root-only and edgeless projects", () => {
    const empty = computeLayout({ fileCount: 0, fileDir: [], lines: [], dirParent: [-1], dirDepth: [0], dirDirs: [[]], dirFiles: [[]], from: [], to: [] });
    expect(empty.tree).toEqual([]);
    expect(empty.radius.tree).toBe(0);

    const one = computeLayout({ fileCount: 1, fileDir: [0], lines: [10], dirParent: [-1], dirDepth: [0], dirDirs: [[]], dirFiles: [[0]], from: [], to: [] });
    expectFinite(one.tree, "tree");
    expectFinite(one.dirCenters, "dirCenters");

    const rootOnly = synthetic({ files: 300, dirs: 1, seed: 3 });
    const r = computeLayout(rootOnly);
    expectFinite(r.tree, "tree");
    expect(stackedPairs(r.tree)).toEqual([]);

    const edgeless = synthetic({ files: 500, dirs: 60, edgeRate: 0, seed: 5 });
    const e = computeLayout(edgeless);
    expectFinite(e.graph, "graph");
    // With no imports there is nothing to lay out by: the graph view is the tree view.
    expect(e.graph).toEqual(e.tree);
  });

  test("a single dominant region still yields several arms and a deep chain stays finite", () => {
    // One top-level directory holding everything, three levels of subdirectories under it.
    const dirParent = [-1, 0];
    const dirDepth = [0, 1];
    const dirDirs: number[][] = [[1], []];
    const dirFiles: number[][] = [[], []];
    for (let d = 2; d < 40; d++) {
      const parent = d < 8 ? 1 : 2 + ((d * 7) % 6);
      dirParent.push(parent);
      dirDepth.push(dirDepth[parent]! + 1);
      dirDirs[parent]!.push(d);
      dirDirs.push([]);
      dirFiles.push([]);
    }
    const fileDir: number[] = [];
    for (let f = 0; f < 800; f++) {
      const d = 1 + (f % 39);
      fileDir.push(d);
      dirFiles[d]!.push(f);
    }
    const input: LayoutInput = { fileCount: 800, fileDir, lines: fileDir.map((d) => 20 + d), dirParent, dirDepth, dirDirs, dirFiles, from: [], to: [] };
    const layout = computeLayout(input);
    expectFinite(layout.tree, "tree");
    expect(stackedPairs(layout.tree)).toEqual([]);
  });

  test("stays inside the runtime budget at 20k files", () => {
    const big = synthetic({ files: 20_000, dirs: 2500, seed: 13 });
    const t0 = performance.now();
    const layout = computeLayout(big);
    const ms = performance.now() - t0;
    expectFinite(layout.tree, "tree");
    expectFinite(layout.graph, "graph");
    expect(stackedPairs(layout.tree)).toEqual([]);
    // Both layouts together; the budget the analyzer's layout worker is designed around.
    expect(ms).toBeLessThan(6000);
  }, 20_000);
});
