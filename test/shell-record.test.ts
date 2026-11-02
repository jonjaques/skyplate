/**
 * The shell's round-two record and explorer logic: imports from files outside the TypeScript
 * analysis, caller labels by what the rows are, the shared filters in the explorer and the URL,
 * and the one written form of the report's generation time.
 */

import { describe, expect, test } from "bun:test";
import { REF_KINDS, type CodeSymbols, type FileRecord } from "../src/shared/schema";
import { hostUsesOf } from "../src/viewer/model/symbols";
import { callEdges, describeFilters, filtering, NO_FILTERS, partitionByCall, partitionTypeRefs, passes } from "../src/viewer/shell/derived";
import { formatGenerated, generatedParts } from "../src/viewer/shell/labels";
import { DEFAULT_FILTERS, filterParams, parseHash, readFilters, readGravity, readLayout } from "../src/viewer/state/url";
import type { Filters } from "../src/viewer/state/store";

const K = Object.fromEntries(REF_KINDS.map((k, i) => [k, i])) as Record<(typeof REF_KINDS)[number], number>;

function symbols(
  names: string[],
  calls: [from: number, to: number, kind: number, count: number][] = [],
  hostUses?: CodeSymbols["hostUses"],
): CodeSymbols {
  return {
    symbols: { name: names },
    calls: {
      from: calls.map((c) => c[0]),
      to: calls.map((c) => c[1]),
      kind: calls.map((c) => c[2]),
      count: calls.map((c) => c[3]),
    },
    hostUses,
  } as unknown as CodeSymbols;
}

describe("imports from outside the TypeScript analysis", () => {
  test("rows are grouped per symbol, in file order, and absent tables give none", () => {
    // 0 useSponsor imported by AsideSponsors.vue (file 7, line 6) and Layout.vue (file 9,
    // line 8); 2 useYoutubePlayer by one page. Deliberately out of order.
    const s = symbols(["useSponsor", "data", "useYoutubePlayer"], [], {
      symbol: [2, 0, 0],
      file: [11, 7, 9],
      line: [3, 6, 8],
    });
    expect(hostUsesOf(s, 0)).toEqual([
      { file: 7, line: 6 },
      { file: 9, line: 8 },
    ]);
    expect(hostUsesOf(s, 1)).toEqual([]);
    expect(hostUsesOf(s, 2)).toEqual([{ file: 11, line: 3 }]);
    expect(hostUsesOf(symbols(["a"]), 0)).toEqual([]);
  });
});

describe("caller labels", () => {
  test("incoming splits into symbols that invoke it and symbols that only name it", () => {
    // 0 vec3; 1 calls it; 2 passes it as a callback (read); 3 both reads and calls it;
    // 4 constructs it with new; 5 uses it as a type.
    const s = symbols(["vec3", "a", "b", "c", "d", "e"], [
      [1, 0, K.call, 4],
      [2, 0, K.read, 1],
      [3, 0, K.read, 2],
      [3, 0, K.call, 1],
      [4, 0, K.new, 1],
      [5, 0, K.type, 3],
    ]);
    const { calls, other } = partitionByCall(callEdges(s, 0, "incoming"));
    expect(calls.map((e) => e.symbol).sort()).toEqual([1, 3, 4]);
    expect(other.map((e) => e.symbol).sort()).toEqual([2, 5]);
  });

  test("outgoing sets type-only references apart; an edge that also calls stays a use", () => {
    // 0 makeOrbit calls 1, annotates with 2 only, and both annotates with and constructs 3.
    const s = symbols(["makeOrbit", "kepler", "Orbit", "Vector"], [
      [0, 1, K.call, 1],
      [0, 2, K.type, 2],
      [0, 3, K.type, 1],
      [0, 3, K.new, 1],
    ]);
    const { uses, types } = partitionTypeRefs(callEdges(s, 0, "outgoing"));
    expect(uses.map((e) => e.symbol).sort()).toEqual([1, 3]);
    expect(types.map((e) => e.symbol)).toEqual([2]);
  });
});

describe("explorer filters", () => {
  const file = (over: Partial<FileRecord>) => ({ language: "typescript", category: "code", generated: false, vendored: false, ...over }) as FileRecord;

  test("the default hides vendored files, and counts as filtering", () => {
    expect(filtering(DEFAULT_FILTERS)).toBe(true);
    expect(passes(file({ vendored: true }), DEFAULT_FILTERS)).toBe(false);
    expect(passes(file({}), DEFAULT_FILTERS)).toBe(true);
    expect(filtering(NO_FILTERS)).toBe(false);
    expect(passes(file({ vendored: true, generated: true }), NO_FILTERS)).toBe(true);
  });

  test("the note names what hides files", () => {
    const name = (id: string) => ({ typescript: "TypeScript", vue: "Vue" })[id] ?? id;
    const f: Filters = { languages: new Set(["typescript", "vue"]), categories: null, hideGenerated: true, hideVendored: true };
    expect(describeFilters(f, name)).toBe("TypeScript and Vue only, generated, vendored");
    expect(describeFilters({ ...NO_FILTERS, languages: new Set(["a", "b", "c"]) }, name)).toBe("3 languages only");
    expect(describeFilters(NO_FILTERS, name)).toBe("");
  });
});

describe("filters in the URL", () => {
  const ids = new Set(["typescript", "vue", "c++"]);

  test("defaults write nothing; every departure writes a param that reads back the same", () => {
    expect(filterParams(DEFAULT_FILTERS)).toEqual([]);
    const f: Filters = { languages: new Set(["vue", "c++", "typescript"]), categories: new Set(["test", "code"]), hideGenerated: true, hideVendored: false };
    const params = filterParams(f);
    expect(params).toEqual(["lang=c%2B%2B,typescript,vue", "cat=code,test", "generated=hide", "vendored=show"]);
    const back = readFilters(parseHash(`#${params.join("&")}`), ids, true);
    expect(back).toEqual(f);
  });

  test("a history entry without filter params means the defaults; a pasted link changes only what it names", () => {
    expect(readFilters(parseHash("#tab=explorer"), ids, true)).toEqual(DEFAULT_FILTERS);
    expect(readFilters(parseHash("#tab=explorer"), ids, false)).toEqual({});
    expect(readFilters(parseHash("#generated=hide"), ids, false)).toEqual({ hideGenerated: true });
  });

  test("unknown languages and categories are dropped, and nothing valid left means no filter", () => {
    expect(readFilters(parseHash("#lang=typescript,cobol&cat=code,nonsense"), ids, false)).toEqual({
      languages: new Set(["typescript"]),
      categories: new Set(["code"]),
    });
    expect(readFilters(parseHash("#lang=cobol&cat=nonsense"), ids, false)).toEqual({ languages: null, categories: null });
  });
});

describe("layout and gravity in the URL", () => {
  test("a link written before the cosmic web (layout=tree) opens on the web", () => {
    expect(readLayout("tree")).toBe("web");
    expect(readLayout("web")).toBe("web");
    expect(readLayout("graph")).toBe("graph");
    expect(readLayout("spiral")).toBeUndefined();
    expect(readLayout(undefined)).toBeUndefined();
  });

  test("gravity reads back known modes, and refuses history modes on a report without git", () => {
    expect(readGravity("complexity", false)).toBe("complexity");
    expect(readGravity("churn", true)).toBe("churn");
    expect(readGravity("churn", false)).toBeUndefined();
    expect(readGravity("hotspots", false)).toBeUndefined();
    expect(readGravity("mass", true)).toBeUndefined();
  });
});

describe("generation time", () => {
  // 04:44 UTC on Nov 1 is still the evening of Oct 31 in Chicago: the case where the rail
  // (UTC) and About (local) used to disagree on the day.
  const iso = "2026-11-01T04:44:32.586Z";

  test("one local form, zone named, the same in every place that prints it", () => {
    expect(generatedParts(iso, "America/Chicago")).toEqual({ date: "Oct 31, 2026", time: "11:44 PM CDT" });
    expect(formatGenerated(iso, "America/Chicago")).toBe("Oct 31, 2026, 11:44 PM CDT");
    expect(formatGenerated(iso, "UTC")).toBe("Nov 1, 2026, 4:44 AM UTC");
  });

  test("an unreadable timestamp is shown as written rather than as Invalid Date", () => {
    expect(formatGenerated("yesterday")).toBe("yesterday");
  });
});
