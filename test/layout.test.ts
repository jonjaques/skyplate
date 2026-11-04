/**
 * The import-graph layout (src/core/layout.ts): deterministic, finite, fitted to the default
 * web's radius, anchored to each region's side of the web so the Web ↔ Imports morph stays
 * legible, and inside the analyzer's runtime budget.
 *
 * Inputs are synthetic trees from a seeded generator, so each case is reproducible.
 */

import { describe, expect, test } from "bun:test";
import { computeLayout, webInputOf, type LayoutInput } from "../src/core/layout";
import { computeWeb } from "../src/shared/web";

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

function synthetic({ files, dirs, edgeRate = 1.5, seed = 1 }: { files: number; dirs: number; edgeRate?: number; seed?: number }): LayoutInput {
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
    const d = rand() < 0.01 || dirs === 1 ? 0 : 1 + Math.floor(Math.pow(rand(), 2) * (dirs - 1));
    fileDir.push(d);
    dirFiles[d]!.push(f);
  }
  const seen = new Set<number>();
  const from: number[] = [];
  const to: number[] = [];
  for (let e = 0; e < Math.floor(files * edgeRate) && files > 1; e++) {
    // Imports mostly stay inside their region, like real code, with hubs anywhere.
    const a = Math.floor(rand() * files);
    const b = rand() < 0.7 ? dirFiles[fileDir[a]!]![Math.floor(rand() * dirFiles[fileDir[a]!]!.length)]! : Math.floor(Math.pow(rand(), 3) * files);
    if (a === b || seen.has(a * files + b)) continue;
    seen.add(a * files + b);
    from.push(a);
    to.push(b);
  }
  const fanIn = new Array<number>(files).fill(0);
  for (const t of to) fanIn[t]!++;
  const max = Math.max(1, ...fanIn);
  return { fileCount: files, fileDir, dirParent, dirDirs, dirFiles, from, to, fanIn, rank: fanIn.map((x) => x / max) };
}

function expectFinite(values: number[], what: string) {
  const bad = values.findIndex((v) => !Number.isFinite(v));
  expect(bad, `${what}[${bad}] = ${values[bad]}`).toBe(-1);
}

describe("computeLayout", () => {
  const medium = synthetic({ files: 3000, dirs: 400, seed: 7 });
  const layout = computeLayout(medium);

  test("is deterministic across runs", () => {
    expect(computeLayout(synthetic({ files: 3000, dirs: 400, seed: 7 }))).toEqual(layout);
  });

  test("every number is finite and the array matches the file count", () => {
    expect(layout.graph.length).toBe(medium.fileCount * 3);
    expectFinite(layout.graph, "graph");
    expect(layout.radius).toBeGreaterThan(0);
  });

  test("the graph shares the default web's radius, so framing holds across the morph", () => {
    const web = computeWeb(webInputOf(medium));
    expect(Math.abs(layout.radius - web.radius)).toBeLessThan(web.radius * 0.01);
  });

  test("each region's import cluster lands on its own side of the web", () => {
    // The anchor is weak, but it should orient every sizeable region: the direction from the
    // center to its files' centroid agrees between the web and the graph.
    const web = computeWeb(webInputOf(medium));
    const regionOf = (f: number) => {
      let d = medium.fileDir[f]!;
      while (d > 0 && medium.dirParent[d]! > 0) d = medium.dirParent[d]!;
      return d;
    };
    const sums = new Map<number, { w: number[]; g: number[]; n: number }>();
    for (let f = 0; f < medium.fileCount; f++) {
      const r = regionOf(f);
      if (r === 0) continue;
      const s = sums.get(r) ?? { w: [0, 0, 0], g: [0, 0, 0], n: 0 };
      for (let j = 0; j < 3; j++) {
        s.w[j]! += web.positions[f * 3 + j]!;
        s.g[j]! += layout.graph[f * 3 + j]!;
      }
      s.n++;
      sums.set(r, s);
    }
    let agree = 0;
    let total = 0;
    for (const s of sums.values()) {
      if (s.n < 100) continue;
      const dot = s.w[0]! * s.g[0]! + s.w[1]! * s.g[1]! + s.w[2]! * s.g[2]!;
      total++;
      if (dot > 0) agree++;
    }
    expect(total).toBeGreaterThan(2);
    expect(agree / total).toBeGreaterThan(0.7);
  });

  test("handles empty, single-file and edgeless projects", () => {
    const empty = computeLayout({ fileCount: 0, fileDir: [], dirParent: [-1], dirDirs: [[]], dirFiles: [[]], from: [], to: [], fanIn: [], rank: [] });
    expect(empty.graph).toEqual([]);
    expect(empty.radius).toBe(0);

    const one = computeLayout({ fileCount: 1, fileDir: [0], dirParent: [-1], dirDirs: [[]], dirFiles: [[0]], from: [], to: [], fanIn: [0], rank: [0] });
    expectFinite(one.graph, "graph");

    // With no imports there is nothing to lay out by: the graph view is the web view.
    const edgeless = synthetic({ files: 500, dirs: 60, edgeRate: 0, seed: 5 });
    const e = computeLayout(edgeless);
    const web = computeWeb(webInputOf(edgeless));
    expectFinite(e.graph, "graph");
    for (let i = 0; i < e.graph.length; i++) expect(Math.abs(e.graph[i]! - web.positions[i]!)).toBeLessThan(0.006);
  });

  test("stays inside the runtime budget at 20k files", () => {
    const big = synthetic({ files: 20_000, dirs: 2500, seed: 13 });
    const t0 = performance.now();
    const out = computeLayout(big);
    const ms = performance.now() - t0;
    expectFinite(out.graph, "graph");
    // The budget the analyzer's layout worker is designed around (the web is ~50 ms of it),
    // measured on an Apple M5 at ~4.1 s. GitHub's hosted runners run this same code 2-3x slower
    // (11.7 s on the first CI run), so CI gets 2.5x the budget: still enough to catch a layout
    // that went quadratic, without failing every PR on the machine's speed alone.
    const budget = process.env.CI ? 15_000 : 6000;
    expect(ms).toBeLessThan(budget);
  }, 30_000);
});
