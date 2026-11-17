import { describe, expect, test } from "bun:test";
import { REF_KINDS, type CodeSymbols, type Report } from "../src/shared/schema";
import { callsThroughBases, degree, edgeSplit, selfCalls } from "../src/viewer/shell/derived";
import { visit } from "../src/viewer/shell/trail";

const K = Object.fromEntries(REF_KINDS.map((k, i) => [k, i])) as Record<(typeof REF_KINDS)[number], number>;

/** Just the call table and names, which is all the hierarchy helpers read. */
function symbols(names: string[], calls: [from: number, to: number, kind: number, count: number][]): CodeSymbols {
  return {
    symbols: { name: names },
    calls: {
      from: calls.map((c) => c[0]),
      to: calls.map((c) => c[1]),
      kind: calls.map((c) => c[2]),
      count: calls.map((c) => c[3]),
    },
  } as unknown as CodeSymbols;
}

describe("record edge counts", () => {
  test("code edges and document links are counted apart, so tiles and lists agree", () => {
    // 0 README.md links 1 and 2; 3 index.ts imports 2; 1 CONTEXT.md links back to 0.
    const report = {
      files: [{}, {}, {}, {}],
      edges: { from: [0, 0, 3, 1], to: [1, 2, 2, 0], kind: ["link", "link", "import", "link"] },
    } as unknown as Report;
    const split = edgeSplit(report);
    expect(degree(split.imports, 0)).toBe(0);
    expect(degree(split.linksTo, 0)).toBe(2);
    expect(degree(split.linkedFrom, 0)).toBe(1);
    expect(degree(split.importedBy, 2)).toBe(1); // index.ts only; README's link is not an import
    expect(degree(split.linkedFrom, 2)).toBe(1);
    expect(edgeSplit(report)).toBe(split); // cached per report
  });
});

describe("call hierarchy", () => {
  test("self-recursion is counted, and import/extends rows to itself are not", () => {
    const s = symbols(["flatten", "pictureLink"], [
      [1, 0, K.call, 1],
      [0, 0, K.call, 2],
      [0, 0, K.import, 1],
    ]);
    expect(selfCalls(s, 0)).toBe(2);
    expect(selfCalls(s, 1)).toBe(0);
  });

  test("a method reached only through its interface gets that interface member's callers", () => {
    // 0 SaveStore.read (interface member), 1 IndexedDbSaveStore.read implements it,
    // 2 GameEngine.load calls the interface member.
    const s = symbols(["read", "read", "load"], [
      [1, 0, K.implements, 1],
      [2, 0, K.call, 1],
    ]);
    const through = callsThroughBases(s, 1);
    expect(through).toHaveLength(1);
    expect(through[0]!.base).toBe(0);
    expect(through[0]!.edges.map((e) => e.symbol)).toEqual([2]);
    // The implementation itself is never listed as one of its own callers.
    expect(callsThroughBases(symbols(["read", "read"], [[1, 0, K.implements, 1], [1, 0, K.call, 1]]), 1)).toEqual([]);
  });

  test("callers of a base several links up reach the override at the bottom of the chain", () => {
    // 0 Root.run, 1 Middle.run extends it, 2 Base.run implements Middle's, 3 Leaf.run overrides
    // Base's, 4 dispatch calls Root.run. Each override link names only the nearest base.
    const s = symbols(["run", "run", "run", "run", "dispatch"], [
      [1, 0, K.extends, 1],
      [2, 1, K.implements, 1],
      [3, 2, K.extends, 1],
      [4, 0, K.call, 1],
    ]);
    const through = callsThroughBases(s, 3);
    expect(through.map((g) => g.base)).toEqual([0]); // the bases between have no callers of their own
    expect(through[0]!.edges.map((e) => e.symbol)).toEqual([4]);
    expect(callsThroughBases(s, 2).map((g) => g.base)).toEqual([0]);
    expect(callsThroughBases(s, 0)).toEqual([]); // the root has no base to be reached through
  });

  test("a hierarchy recorded as a loop ends, and a diamond lists its shared base once", () => {
    const loop = symbols(["a", "b", "caller"], [
      [0, 1, K.extends, 1],
      [1, 0, K.extends, 1],
      [2, 1, K.call, 1],
    ]);
    expect(callsThroughBases(loop, 0).map((g) => g.base)).toEqual([1]);
    // 3 implements 1 and 2, which both extend 0; 4 calls 0.
    const diamond = symbols(["top", "left", "right", "impl", "caller"], [
      [1, 0, K.extends, 1],
      [2, 0, K.extends, 1],
      [3, 1, K.implements, 1],
      [3, 2, K.implements, 1],
      [4, 0, K.call, 1],
    ]);
    expect(callsThroughBases(diamond, 3).map((g) => g.base)).toEqual([0]);
  });
});

describe("dig trail", () => {
  test("visits append, revisits move to the end, and a new visit after Back drops what was ahead", () => {
    let t = { trail: [] as number[], at: -1 };
    for (const id of [1, 2, 3]) t = visit(t, id);
    expect(t).toEqual({ trail: [1, 2, 3], at: 2 });
    expect(visit(t, 3)).toBe(t); // the current symbol again: no change
    expect(visit(t, 1)).toEqual({ trail: [2, 3, 1], at: 2 });
    t = { ...t, at: 0 }; // stepped back to 1
    expect(visit(t, 9)).toEqual({ trail: [1, 9], at: 1 });
  });

  test("the trail keeps the last ten symbols", () => {
    let t = { trail: [] as number[], at: -1 };
    for (let id = 0; id < 14; id++) t = visit(t, id);
    expect(t.trail).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(t.at).toBe(9);
  });
});
