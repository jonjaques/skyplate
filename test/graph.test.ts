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
    // The loop only the type edge closes is listed apart; the runtime cycle is not repeated there.
    expect(g.summary.typeLoops?.map((l) => [...l].sort())).toEqual([[0, 1]]);
    expect(analyzeGraph(flat(4, edges.map(([a, b]) => [a, b]))).summary.typeLoops).toBeUndefined();
  });

  test("a type edge that grows a runtime cycle into a larger loop lists the larger loop", () => {
    // 0 ↔ 1 runs; 1 → 2 runs and 2 → 0 is `import type`: the cycle is {0, 1}, the loop {0, 1, 2}.
    const edges: [number, number, boolean][] = [[0, 1, false], [1, 0, false], [1, 2, false], [2, 0, true]];
    const g = analyzeGraph({ ...flat(3, edges.map(([a, b]) => [a, b])), typeOnly: edges.map((e) => e[2]) });
    expect(g.summary.cycles.map((c) => [...c.files].sort())).toEqual([[0, 1]]);
    expect(g.summary.typeLoops?.map((l) => [...l].sort())).toEqual([[0, 1, 2]]);
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

  test("modules keep every package whole, however small, until the cap forbids it", () => {
    // dirs: 0 "" · 1 packages · 2 packages/core · 3 packages/tiny-a · 4 packages/tiny-b · 5 apps
    const dirParent = [-1, 0, 1, 1, 1, 0];
    const dirDepth = [0, 1, 2, 2, 2, 1];
    // 100 core files in a chain, one file each in the two tiny packages (under 2% apiece), and
    // 60 app files that import core: the tiny packages fold into "packages" by size alone.
    const fileDir = [...Array<number>(100).fill(2), 3, 4, ...Array<number>(60).fill(5)];
    const edges: [number, number][] = [];
    for (let i = 1; i < 100; i++) edges.push([i, i - 1]);
    edges.push([100, 0], [101, 100]);
    for (let i = 102; i < 162; i++) edges.push([i, i % 100]);
    const base = { fileCount: 162, from: edges.map((e) => e[0]), to: edges.map((e) => e[1]), fileDir, dirParent, dirDepth };
    const bySize = analyzeGraph(base).summary.modules.map((m) => m.dir);
    expect(bySize).not.toContain(3);
    expect(bySize).not.toContain(4);
    const byPackage = analyzeGraph({ ...base, packageDirs: [2, 3, 4, 5] }).summary.modules.map((m) => m.dir);
    expect(byPackage).toEqual(expect.arrayContaining([2, 3, 4, 5]));
    expect(byPackage).not.toContain(1); // nothing left for a "packages" rest module
  });

  test("a directory of more packages than the module cap splits the old way", () => {
    // playground/ holds 40 packages: 5 of 30 files and 35 one-file fixtures that import them.
    // Keeping all 40 whole would pass MAX_MODULES (24), so the split falls back to size: the
    // five large packages stand alone and the fixtures fold into playground's rest module.
    // Without the fallback playground/ would not be split at all.
    const big = 5;
    const tiny = 35;
    const dirParent = [-1, 0, ...Array<number>(big + tiny).fill(1)];
    const dirDepth = [0, 1, ...Array<number>(big + tiny).fill(2)];
    const fileDir: number[] = [];
    const edges: [number, number][] = [];
    for (let p = 0; p < big; p++)
      for (let k = 0; k < 30; k++) {
        const f = fileDir.length;
        fileDir.push(2 + p);
        if (k > 0) edges.push([f, f - 1]);
      }
    for (let t = 0; t < tiny; t++) {
      edges.push([fileDir.length, (t % big) * 30]);
      fileDir.push(2 + big + t);
    }
    const g = analyzeGraph({
      fileCount: fileDir.length,
      from: edges.map((e) => e[0]),
      to: edges.map((e) => e[1]),
      fileDir,
      dirParent,
      dirDepth,
      packageDirs: Array.from({ length: big + tiny }, (_, i) => 2 + i),
    });
    expect(g.summary.modules.map((m) => m.dir)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("modules ignore files without edges", () => {
    // Root holds 2 connected files; `assets` holds only unconnected ones and never becomes a module.
    const g = analyzeGraph({ fileCount: 4, from: [0], to: [1], fileDir: [0, 0, 1, 1], dirParent: [-1, 0], dirDepth: [0, 1] });
    expect(g.summary.modules.map((m) => m.dir)).toEqual([0]);
  });
});
