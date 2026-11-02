import { describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { Category, FileRecord, GitSummary, Report } from "../../shared/schema";
import type { Model } from "../model/indices";
import { composition, facets, gini, giniAdjusted, monthBuckets, noCommitsReason, type LanguageShare } from "./data";
import { timeTicks } from "./kit/interaction";
import { placeLabels } from "./kit/labels";
import { binPosition, boundaryLabel } from "./kit/Log2Histogram";
import { rampStep, rampT } from "./kit/ScaleLegend";
import { spanTitle } from "./kit/StackedColumns";

const lang = (id: string, code: number, slot = -1): LanguageShare => ({ id, name: id, slot, code, files: 1 });

// inertialref's shape: the analyzer gave slots to programming and markup languages first, so
// Markdown (2nd by size) and JSON (4th) have none while Shell (154 lines) has slot 6.
const INERTIALREF = [
  lang("TypeScript", 155_502, 0),
  lang("Markdown", 44_071),
  lang("TSX", 17_172, 1),
  lang("JSON", 15_216),
  lang("JavaScript", 11_368, 2),
  lang("YAML", 8_424),
  lang("Python", 1_120, 4),
  lang("CSS", 993, 3),
  lang("Text", 363),
  lang("HTML", 303, 5),
  lang("Shell", 154, 6),
  lang("Astro", 90),
];

describe("composition", () => {
  test("names the largest languages by share, whatever their slot, and folds only the tail", () => {
    const c = composition(INERTIALREF);
    const named = c.parts.filter((p) => !p.rest).map((p) => p.label);
    expect(named).toEqual(["TypeScript", "TSX", "JavaScript", "Python", "Markdown", "JSON", "YAML"]);
    const rest = c.parts.at(-1)!;
    expect(rest.rest).toBe(true);
    expect(rest.label).toBe("5 others");
    expect(rest.languages.map((l) => l.name)).toEqual(["CSS", "Text", "HTML", "Shell", "Astro"]);
    expect(rest.code).toBe(993 + 363 + 303 + 154 + 90);
    expect(c.total).toBe(INERTIALREF.reduce((s, l) => s + l.code, 0));
  });

  test("slotted parts keep their slot (slot order), unslotted named parts are gray", () => {
    const c = composition(INERTIALREF);
    expect(c.parts.map((p) => p.slot)).toEqual([0, 1, 2, 4, -1, -1, -1, -1]);
  });

  test("never folds a single language into '1 other'", () => {
    const eight = INERTIALREF.slice(0, 8);
    const c = composition(eight);
    expect(c.parts.some((p) => p.rest)).toBe(false);
    expect(c.parts).toHaveLength(8);
  });

  test("ignores languages with no code lines", () => {
    const c = composition([lang("A", 10, 0), lang("Binary", 0)]);
    expect(c.languageCount).toBe(1);
    expect(c.parts.map((p) => p.label)).toEqual(["A"]);
  });

  // fd's shape under the current analyzer: slots go to the seven largest languages that are not
  // fallbacks, and Text (186 lines) outgrows SVG (160), which holds slot 6.
  const FD = [
    lang("rust", 6951, 0),
    lang("markdown", 1317, 1),
    lang("toml", 885, 2),
    lang("roff", 551, 3),
    lang("shell", 432, 4),
    lang("yaml", 323, 5),
    lang("text", 186),
    lang("svg", 160, 6),
    lang("makefile", 51),
    lang("awk", 31),
  ];

  test("a fallback never folds a slotted language: the tray names the galaxy key's seven", () => {
    const c = composition(FD);
    expect(c.parts.filter((p) => !p.rest).map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const rest = c.parts.at(-1)!;
    expect(rest.languages.map((l) => l.id)).toEqual(["text", "makefile", "awk"]);
    expect(rest.languages.every((l) => l.slot < 0)).toBe(true);
  });

  test("a fallback keeps its named place when no slotted language needs it", () => {
    const c = composition([lang("text", 900), ...FD.filter((l) => l.id !== "text" && l.id !== "svg")]);
    expect(c.parts.some((p) => p.key === "text" && !p.rest)).toBe(true);
  });

  test("ties go to the slotted language (express: CSS slot 6 and HTML, 44 lines each)", () => {
    const tie = [
      lang("javascript", 16249, 0),
      lang("markdown", 3534, 1),
      lang("yaml", 336, 2),
      lang("ejs", 217, 3),
      lang("json", 99, 4),
      lang("handlebars", 71, 5),
      { ...lang("html", 44), files: 8 },
      { ...lang("css", 44, 6), files: 4 },
      lang("text", 34),
      lang("ignore-list", 12),
    ];
    const c = composition(tie);
    expect(c.parts.filter((p) => !p.rest).map((p) => p.key)).toContain("css");
    expect(c.parts.at(-1)!.languages.map((l) => l.id)).toContain("html");
  });
});

describe("facets", () => {
  const file = (id: number, language: string, category: string, extra: Partial<{ vendored: boolean; generated: boolean; code: number }> = {}) =>
    ({ id, language, category, vendored: false, generated: false, code: 10, ...extra }) as unknown as FileRecord;
  // Files 0-2 sit in drawer 1, files 3-5 outside it; fileOrder lists the drawer's run first.
  const report = {
    files: [
      file(0, "typescript", "code"),
      file(1, "typescript", "test"),
      file(2, "css", "style"),
      file(3, "ejs", "markup"),
      file(4, "typescript", "code", { vendored: true }),
      file(5, "json", "data"),
    ],
  } as unknown as Report;
  const model = { fileOrder: Int32Array.from([0, 1, 2, 3, 4, 5]), dirStart: [0, 0], dirEnd: [6, 3] } as unknown as Model;
  const none = { languages: null, categories: null, hideGenerated: false, hideVendored: true };

  test("a drawer lists only its own languages, counted inside it", () => {
    const f = facets(report, model, none, 1);
    expect([...f.languages.keys()].sort()).toEqual(["css", "typescript"]);
    expect(f.languages.get("typescript")!.files).toBe(2);
    expect(f.languages.has("ejs")).toBe(false);
  });

  test("counts leave out what the other filters hide, but not the menu's own choice", () => {
    const f = facets(report, model, { ...none, languages: new Set(["css"]), categories: new Set(["code"]) as Set<Category> }, null);
    // Languages count under the category choice (code), ignoring the language choice.
    expect(f.languages.get("typescript")!.files).toBe(1); // the vendored one is hidden
    expect(f.languages.has("css")).toBe(false);
    // Categories count under the language choice (css), ignoring the category choice.
    expect([...f.categories.entries()]).toEqual([["style", 1]]);
  });
});

describe("noCommitsReason", () => {
  const DAY_S = 86_400;
  const git = { last: 100 * DAY_S, truncated: false, commits: { time: [100, 95, 60, 10].map((d) => d * DAY_S) } } as unknown as GitSummary;

  test("a range with commits that all miss the scope says how many it holds and the way out", () => {
    const s = noCommitsReason(git, 70 * DAY_S, "in the last 30 days", "the files in .vscode", "close the drawer");
    expect(s).toBe("None of the 2 commits in the last 30 days touch the files in .vscode. Choose a longer range or close the drawer.");
  });

  test("over the whole history it says the files were never committed", () => {
    const s = noCommitsReason(git, null, "", "the files in view", "widen the filters");
    expect(s).toStartWith("None of the 4 analyzed commits touch the files in view");
    expect(s).toContain("untracked or not yet committed");
    expect(s).not.toContain("analyzed history begins");
  });
});

describe("giniAdjusted", () => {
  test("two people, one with nearly every commit, reads near 1", () => {
    const g = gini([220, 3]);
    expect(g).toBeCloseTo(0.4865, 3);
    expect(giniAdjusted(g, 2)).toBeCloseTo(0.973, 3);
  });

  test("one person with everything is exactly 1 at any group size", () => {
    for (const n of [2, 3, 10, 100]) {
      const values = Array.from({ length: n }, (_, i) => (i === 0 ? 50 : 0));
      expect(giniAdjusted(gini(values), n)).toBeCloseTo(1, 9);
    }
  });

  test("an even split stays 0, and fewer than two people is 0", () => {
    expect(giniAdjusted(gini([5, 5, 5]), 3)).toBe(0);
    expect(giniAdjusted(0.4, 1)).toBe(0);
  });
});

describe("monthBuckets", () => {
  const months = (y: number, m: number, count: number) => Array.from({ length: count }, (_, i) => Date.UTC(y, m + i, 1) / 1000);

  test("keeps months up to the column cap", () => {
    const { step, buckets } = monthBuckets(months(2024, 0, 24), 24);
    expect(step).toBe(1);
    expect(buckets).toHaveLength(24);
  });

  test("folds into calendar quarters, aligned to January, April, July and October", () => {
    const t = months(2023, 7, 30); // Aug 2023 … Jan 2026
    const { step, buckets } = monthBuckets(t, 24);
    expect(step).toBe(3);
    expect(spanTitle(buckets[0]!.start, 3)).toBe("Jul–Sep 2023");
    expect([buckets[0]!.from, buckets[0]!.to]).toEqual([0, 2]); // Aug and Sep only
    expect(spanTitle(buckets[1]!.start, 3)).toBe("Oct–Dec 2023");
    expect(buckets.at(-1)!.to).toBe(30);
  });

  test("an eight-year history (fd) becomes halves, a long one years", () => {
    expect(monthBuckets(months(2017, 4, 110), 24).step).toBe(6);
    expect(monthBuckets(months(2005, 0, 240), 24).step).toBe(12);
  });

  test("every month lands in exactly one bucket", () => {
    const t = months(2019, 10, 77);
    const { buckets } = monthBuckets(t, 24);
    expect(buckets[0]!.from).toBe(0);
    for (let i = 1; i < buckets.length; i++) expect(buckets[i]!.from).toBe(buckets[i - 1]!.to);
    expect(buckets.at(-1)!.to).toBe(t.length);
  });
});

describe("placeLabels", () => {
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };

  test("takes the right side when it is clear", () => {
    const [p] = placeLabels([{ key: "a", x: 100, y: 100, r: 6, w: 60, h: 13 }], [{ x: 100, y: 100, r: 6 }], bounds);
    expect(p!.x).toBeGreaterThan(106);
    expect(p!.leader).toBeUndefined();
  });

  test("never covers another emphasized dot", () => {
    // A dot sits exactly where the right-hand label would go.
    const items = [{ key: "a", x: 100, y: 100, r: 6, w: 60, h: 13 }];
    const obstacles = [
      { x: 100, y: 100, r: 6 },
      { x: 135, y: 100, r: 8 },
    ];
    const [p] = placeLabels(items, obstacles, bounds);
    expect(p).toBeDefined();
    const box = { x: p!.x, y: p!.y - p!.h / 2, w: p!.w, h: p!.h };
    for (const c of obstacles) {
      const cx = Math.max(box.x, Math.min(c.x, box.x + box.w));
      const cy = Math.max(box.y, Math.min(c.y, box.y + box.h));
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeGreaterThanOrEqual(c.r);
    }
  });

  test("falls back to a leader line when every near spot is taken", () => {
    const ring = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: 200 + dx * 22, y: 150 + dy * 18, r: 9 })));
    const [p] = placeLabels([{ key: "a", x: 200, y: 150, r: 9, w: 50, h: 13 }], ring, bounds);
    expect(p?.leader).toBeDefined();
  });

  test("labels never overlap each other, and stay inside the plot", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ key: i, x: 380, y: 100 + i * 4, r: 5, w: 80, h: 13 }));
    const placed = placeLabels(items, items, bounds);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(400);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h / 2 <= b.y - b.h / 2 || b.y + b.h / 2 <= a.y - a.h / 2;
        expect(apart).toBe(true);
      }
  });
});

describe("log2 histogram positions", () => {
  test("markers and boundary ticks share one mapping", () => {
    // Boundary i is labeled 2^i and sits at i bands; a marker of value 2^i lands on it.
    for (let i = 1; i < 12; i++) expect(binPosition(2 ** i)).toBe(i);
    expect(boundaryLabel(0)).toBe("0");
    expect(boundaryLabel(1)).toBe("2");
    expect(boundaryLabel(3)).toBe("8");
  });

  test("the first bin (0 and 1) runs linearly from 0 to 2", () => {
    expect(binPosition(0)).toBe(0);
    expect(binPosition(1)).toBe(0.5);
    expect(binPosition(1.5)).toBe(0.75);
  });
});

describe("sequential ramp", () => {
  test("the smallest nonzero value takes the first step and the largest the last", () => {
    expect(rampStep(rampT(1, 1, 101, "sqrt"))).toBe(0);
    expect(rampStep(rampT(101, 1, 101, "sqrt"))).toBe(6);
    expect(rampStep(rampT(3, 3, 16))).toBe(0);
    expect(rampStep(rampT(16, 3, 16))).toBe(6);
  });

  test("square root spreads the low end", () => {
    expect(rampT(25, 1, 101, "sqrt")).toBeGreaterThan(rampT(25, 1, 101));
  });

  test("a single distinct value fills the top step", () => {
    expect(rampStep(rampT(7, 7, 7))).toBe(6);
  });
});

describe("timeTicks", () => {
  test("week-scale spans tick on Mondays, where weekly samples sit", () => {
    const scale = d3
      .scaleUtc()
      .domain([new Date(Date.UTC(2026, 7, 3)), new Date(Date.UTC(2026, 9, 26))])
      .range([0, 800]);
    const ticks = timeTicks(scale, 800);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(scale.invert(t.pos).getUTCDay()).toBe(1);
  });
});
