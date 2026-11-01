import { describe, expect, test } from "bun:test";
import { analyzeGraph } from "../src/core/graph";
import type { GraphInput } from "../src/core/contracts";

/** A graph with every file in the root directory. */
function flat(fileCount: number, edges: [number, number][]): GraphInput {
  return {
    fileCount,
    from: edges.map((e) => e[0]),
    to: edges.map((e) => e[1]),
    fileDir: new Array<number>(fileCount).fill(0),
    dirParent: [-1],
    dirDepth: [0],
  };
}

describe("analyzeGraph", () => {
  test("fan-in / fan-out count distinct files; duplicates and self-imports are dropped", () => {
    const g = analyzeGraph(flat(4, [[0, 1], [0, 1], [0, 2], [1, 2], [3, 3]]));
    expect(g.fanOut).toEqual([2, 1, 0, 0]);
    expect(g.fanIn).toEqual([0, 1, 2, 0]);
    expect(g.summary.edges).toBe(3);
    expect(g.summary.connected).toBe(3); // file 3 only imports itself
  });

  test("PageRank favors depended-upon files, handles dangling nodes, max-normalizes", () => {
    // 0,1,2 all import 3; 3 imports nothing (dangling); 4 is isolated.
    const g = analyzeGraph(flat(5, [[0, 3], [1, 3], [2, 3]]));
    expect(g.rank[3]).toBe(1);
    expect(g.rank[0]).toBeCloseTo(g.rank[1]!, 12);
    expect(g.rank[0]!).toBeLessThan(1);
    expect(g.rank[4]!).toBeGreaterThan(0); // teleport mass, not NaN or 0
    for (const r of g.rank) expect(Number.isFinite(r)).toBe(true);
  });

  test("PageRank on an empty graph is all zeros", () => {
    expect(analyzeGraph(flat(3, [])).rank).toEqual([0, 0, 0]);
    expect(analyzeGraph(flat(0, [])).rank).toEqual([]);
  });

  test("cycles: components of two or more files, largest first, members by rank", () => {
    // A 3-cycle (0→1→2→0), a 2-cycle (3↔4), a self-loop (5), and 6 → 0.
    const g = analyzeGraph(flat(7, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 3], [5, 5], [6, 0]]));
    expect(g.summary.cycles.map((c) => c.files.length)).toEqual([3, 2]);
    expect(g.summary.cycles.map((c) => c.id)).toEqual([0, 1]);
    expect(g.cycle).toEqual([0, 0, 0, 1, 1, -1, -1]);
    const ranks = g.summary.cycles[0]!.files.map((f) => g.rank[f]!);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  test("a loop closed only by type-only imports is not a cycle; the edges still count", () => {
    // An engine imports its controller, which answers with `import type { Engine }`.
    // 2 ↔ 3 is runtime both ways; 3 → 2 also has a type-only duplicate, which must not erase it.
    const edges: [number, number, boolean][] = [[0, 1, false], [1, 0, true], [2, 3, false], [3, 2, true], [3, 2, false]];
    const input = { ...flat(4, edges.map(([a, b]) => [a, b])), typeOnly: edges.map((e) => e[2]) };
    const g = analyzeGraph(input);
    expect(g.summary.cycles.map((c) => c.files)).toEqual([[2, 3]]);
    expect(g.cycle).toEqual([-1, -1, 0, 0]);
    expect(g.fanOut).toEqual([1, 1, 1, 1]);
    expect(g.summary.edges).toBe(4);
    // Without the flags every loop is a cycle, as before.
    expect(analyzeGraph(flat(4, edges.map(([a, b]) => [a, b]))).summary.cycles.length).toBe(2);
  });

  test("deep chains and one huge cycle do not overflow the stack", () => {
    const n = 100_000;
    const edges: [number, number][] = [];
    for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
    edges.push([n - 1, 0]);
    const t = performance.now();
    const g = analyzeGraph(flat(n, edges));
    expect(g.summary.cycles.length).toBe(1);
    expect(g.summary.cycles[0]!.files.length).toBe(n);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  test("modules: a monorepo splits into one module per package, Ca/Ce/instability per Martin", () => {
    // dirs: 0 "" · 1 packages · 2 packages/core · 3 packages/ui · 4 apps · 5 apps/web · 6 docs
    const dirParent = [-1, 0, 1, 1, 0, 4, 0];
    const dirDepth = [0, 1, 2, 2, 1, 2, 1];
    // files: 0-3 core, 4-7 ui, 8-11 web, 12 docs
    const fileDir = [2, 2, 2, 2, 3, 3, 3, 3, 5, 5, 5, 5, 6];
    const edges: [number, number][] = [
      [1, 0], [2, 0], [3, 0], //       core internal
      [4, 0], [5, 1], [6, 4], [7, 4], // ui → core, ui internal
      [8, 4], [9, 0], [10, 8], [11, 8], // web → ui, web → core, web internal
      [12, 8], //                      docs → web (a link)
    ];
    const g = analyzeGraph({ fileCount: 13, from: edges.map((e) => e[0]), to: edges.map((e) => e[1]), fileDir, dirParent, dirDepth });
    const mods = g.summary.modules;
    expect(mods.map((m) => m.dir)).toEqual([2, 3, 5, 6]); // core, ui, web, docs
    expect(g.summary.moduleDepth).toBe(2);
    const core = mods[0]!;
    const ui = mods[1]!;
    // core: depended on by ui files 4, 5 and web file 9 → Ca 3; depends on nothing outside → Ce 0.
    expect([core.ca, core.ce, core.instability]).toEqual([3, 0, 0]);
    // ui: web file 8 depends on it (Ca 1); ui files 4, 5 depend on core (Ce 2).
    expect([ui.ca, ui.ce]).toEqual([1, 2]);
    expect(ui.instability).toBeCloseTo(2 / 3, 12);
    // Matrix rows are `from`: ui → core has 2 edges, core → core 3, web → ui 1.
    expect(g.summary.moduleMatrix[1]![0]).toBe(2);
    expect(g.summary.moduleMatrix[0]![0]).toBe(3);
    expect(g.summary.moduleMatrix[2]![1]).toBe(1);
  });

  test("modules ignore files without edges", () => {
    // Root holds 2 connected files; `assets` holds only unconnected ones and never becomes a module.
    const g = analyzeGraph({ fileCount: 4, from: [0], to: [1], fileDir: [0, 0, 1, 1], dirParent: [-1, 0], dirDepth: [0, 1] });
    expect(g.summary.modules.map((m) => m.dir)).toEqual([0]);
  });
});
