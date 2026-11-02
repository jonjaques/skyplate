/**
 * Groups at every level: the envelope hull and its padded outline, picking the deepest group
 * under the pointer, and the levels Escape and the breadcrumb walk through.
 *
 *   bun test src/viewer/galaxy/groups.test.ts
 */

import { describe, expect, test } from "bun:test";
import type { CodeSymbols, Report } from "../../shared/schema";
import {
  deepestGroup,
  envelopeHull,
  envelopePath,
  groupLabel,
  HULL_CAP,
  HULL_FLOATS,
  HullScratch,
  hullContains,
  hullExtent,
  parentGroup,
  selectionTrail,
  walkUp,
} from "./groups";

/** A seeded LCG so the point clouds are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function hullOf(xs: number[], ys: number[]) {
  const out = new Float32Array(HULL_FLOATS);
  const count = envelopeHull(Float32Array.from(xs), Float32Array.from(ys), xs.length, out, new HullScratch());
  return { out, count };
}

describe("envelope hull", () => {
  test("a square's hull is its four corners, and the interior is inside", () => {
    const { out, count } = hullOf([0, 10, 10, 0, 5, 3], [0, 0, 10, 10, 5, 7]);
    expect(count).toBe(4);
    expect(hullContains(out, count, 5, 5, 0)).toBe(true);
    expect(hullContains(out, count, 11, 5, 0)).toBe(false);
    expect(hullContains(out, count, 11, 5, 2)).toBe(true); // within the pad
    expect(hullContains(out, count, 13, 5, 2)).toBe(false);
  });

  test("every point of a large Plummer-like cloud is inside the hull", () => {
    const r = rng(7);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 20000; i++) {
      // Heavy-tailed radius: a dense core with sparse outliers, the case sampling would miss.
      const a = r() * Math.PI * 2;
      const d = 40 / Math.sqrt(Math.max(1e-4, r() ** (-2 / 3) - 1));
      xs.push(500 + Math.cos(a) * d);
      ys.push(300 + Math.sin(a) * d * 0.6);
    }
    const { out, count } = hullOf(xs, ys);
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThanOrEqual(HULL_CAP + 16);
    let outside = 0;
    for (let i = 0; i < xs.length; i++) if (!hullContains(out, count, xs[i]!, ys[i]!, 0.01)) outside++;
    expect(outside).toBe(0);
  });

  test("collinear and coincident points collapse to a segment or a point", () => {
    const line = hullOf([0, 5, 10, 2], [0, 0, 0, 0]);
    expect(line.count).toBe(2);
    expect(hullContains(line.out, line.count, 5, 3, 4)).toBe(true);
    expect(hullContains(line.out, line.count, 5, 5, 4)).toBe(false);
    const dot = hullOf([3, 3, 3], [4, 4, 4]);
    expect(dot.count).toBe(1);
    expect(hullContains(dot.out, dot.count, 3, 9, 6)).toBe(true);
  });

  test("the padded outline stays one pad clear of the hull, corners rounded outward", () => {
    const { out, count } = hullOf([0, 100, 100, 0], [0, 0, 60, 60]);
    const d = envelopePath(out, count, 10);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // Four straight runs and four corner arcs, each swept clockwise on the y-down plate.
    expect(d.match(/L/g)!.length).toBe(4);
    expect(d.match(/A10 10 0 0 1/g)!.length).toBe(4);
    // Every endpoint sits exactly a pad outside the rectangle.
    const nums = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)(?=[ALZ]|$)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    for (const [x, y] of nums) {
      const dx = Math.max(0 - x, 0, x - 100);
      const dy = Math.max(0 - y, 0, y - 60);
      expect(Math.hypot(dx, dy)).toBeCloseTo(10, 0);
    }
  });

  test("a lone star's outline is a circle, a pair's a capsule", () => {
    const one = hullOf([5], [5]);
    expect(envelopePath(one.out, one.count, 6)).toBe("M11 5A6 6 0 0 1 -1 5A6 6 0 0 1 11 5Z");
    const two = hullOf([0, 20], [0, 0]);
    const d = envelopePath(two.out, two.count, 4);
    expect(d.match(/L/g)!.length).toBe(2);
    expect(d.match(/A4 4 0 0 1/g)!.length).toBe(2); // two half turns, outward at each end
  });

  test("extent: center and half the larger side", () => {
    const { out, count } = hullOf([0, 40, 40, 0], [0, 0, 10, 10]);
    expect(hullExtent(out, count)).toEqual({ cx: 20, cy: 5, radius: 20 });
  });
});

describe("deepest group", () => {
  // 1 contains 2 and 3; 2 contains 4. Circles stand in for envelopes.
  const circles: Record<number, [number, number, number]> = {
    1: [100, 100, 80],
    2: [80, 100, 40],
    3: [150, 100, 25],
    4: [80, 100, 10], // too small to pick
    5: [400, 100, 50],
  };
  const kids: Record<number, number[]> = { 1: [2, 3], 2: [4], 3: [], 4: [], 5: [] };
  const pick = (x: number, y: number) =>
    deepestGroup(
      [1, 5],
      (d) => kids[d] ?? [],
      (d) => {
        const [cx, cy, r] = circles[d]!;
        const dist = Math.hypot(x - cx, y - cy);
        return r >= 24 && dist <= r ? dist / r : Infinity;
      },
    );

  test("descends to the deepest group that holds the pointer and is big enough", () => {
    expect(pick(80, 100)).toBe(2); // inside 4 too, but 4 is under the size floor
    expect(pick(155, 100)).toBe(3);
    expect(pick(100, 160)).toBe(1); // inside 1 only
    expect(pick(400, 120)).toBe(5);
  });

  test("the void picks nothing", () => {
    expect(pick(260, 30)).toBe(-1);
  });
});

// ─── A small tree ────────────────────────────────────────────────────────────────────────────
//
//   (root) ── README.md
//    ├─ packages ── universe ── src ── a.ts, b.ts      (universe holds only src)
//    │           └─ game ── c.ts
//    └─ tools ── x.ts

function dir(id: number, name: string, path: string, parent: number, dirs: number[], files: number[], totalFiles: number) {
  return { id, name, path, parent, depth: path ? path.split("/").length : 0, dirs, files, totalFiles, totalBytes: 0, totalLines: 0, totalCode: 0, dominantLanguage: "" };
}
const report = {
  project: { name: "demo" },
  dirs: [
    dir(0, "demo", "", -1, [1, 5], [0], 5),
    dir(1, "packages", "packages", 0, [2, 4], [], 3),
    dir(2, "universe", "packages/universe", 1, [3], [], 2),
    dir(3, "src", "packages/universe/src", 2, [], [1, 2], 2),
    dir(4, "game", "packages/game", 1, [], [3], 1),
    dir(5, "tools", "tools", 0, [], [4], 1),
  ],
  files: [
    { id: 0, name: "README.md", path: "README.md", dir: 0 },
    { id: 1, name: "a.ts", path: "packages/universe/src/a.ts", dir: 3 },
    { id: 2, name: "b.ts", path: "packages/universe/src/b.ts", dir: 3 },
    { id: 3, name: "c.ts", path: "packages/game/c.ts", dir: 4 },
    { id: 4, name: "x.ts", path: "tools/x.ts", dir: 5 },
  ],
} as unknown as Report;
const symbols = { symbols: { name: ["vec3"], file: [1] } } as unknown as CodeSymbols;

describe("levels", () => {
  test("Escape walks symbol → file → directory → … → nothing, skipping look-alike parents", () => {
    let t = walkUp(report, symbols, { kind: "symbol", id: 0 });
    expect(t).toEqual({ kind: "file", id: 1 });
    t = walkUp(report, symbols, t);
    expect(t).toEqual({ kind: "dir", id: 3 });
    // universe holds only src: same stars, same envelope, so the step goes on to packages.
    t = walkUp(report, symbols, t);
    expect(t).toEqual({ kind: "dir", id: 1 });
    t = walkUp(report, symbols, t);
    expect(t).toBeNull();
    expect(walkUp(report, symbols, { kind: "file", id: 0 })).toBeNull(); // a root file
    expect(walkUp(report, symbols, { kind: "author", id: 0 })).toBeNull();
  });

  test("parentGroup stops at the first ancestor that holds more", () => {
    expect(parentGroup(report.dirs, 3)).toBe(1);
    expect(parentGroup(report.dirs, 4)).toBe(1);
    expect(parentGroup(report.dirs, 1)).toBe(0);
  });

  test("the breadcrumb runs from the project to the selection", () => {
    const trail = selectionTrail(report, symbols, { kind: "symbol", id: 0 });
    expect(trail.map((c) => c.label)).toEqual(["demo", "packages", "universe", "src", "a.ts", "vec3"]);
    expect(trail[0]!.target).toBeNull();
    expect(trail[2]!.target).toEqual({ kind: "dir", id: 2 });
    expect(trail.at(-1)!.target).toEqual({ kind: "symbol", id: 0 });
    expect(selectionTrail(report, symbols, { kind: "dir", id: 4 }).map((c) => c.label)).toEqual(["demo", "packages", "game"]);
    expect(selectionTrail(report, symbols, null)).toEqual([]);
  });

  test("a group that is its parent's only content is named with the chain", () => {
    expect(groupLabel(report.dirs, 3)).toBe("universe/src");
    expect(groupLabel(report.dirs, 4)).toBe("game");
    expect(groupLabel(report.dirs, 1)).toBe("packages");
  });
});
