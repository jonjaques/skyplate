/**
 * The Skyplate mark and wordmark: one source for every place they are drawn.
 *
 *   bun scripts/brand.ts        (needs woff2_decompress: brew install woff2)
 *
 * Writes
 *   src/viewer/brand/brand.generated.ts   path data the viewer draws (Brand.tsx)
 *   docs/brand/skyplate-lockup-light.svg  README header, for light pages
 *   docs/brand/skyplate-lockup-dark.svg   README header, for dark pages
 *   docs/brand/skyplate-mark.svg          the mark alone, following the color scheme
 *   the favicon <link> in src/viewer/index.html (between its brand markers)
 *
 * The mark is a photographic plate: a glass square with the identification notch cut into one
 * corner, one star on it marked with a measuring reticle (the four short ticks the viewer
 * draws around a star under the pointer), and two fainter stars. On light grounds it is a
 * positive (white stars on the plate's dark glass); on dark grounds it inverts to a negative,
 * which is what an astronomical plate actually is (dark stars on clear glass), and which keeps
 * the mark from disappearing into a dark rail.
 *
 * The wordmark is "skyplate" in Archivo, the viewer's own face, at its widest setting (wdth
 * 125, weight 600, tracking -0.02em), outlined to paths. Outlines rather than live text,
 * because GitHub renders the README's SVG as an image with no access to the font, and because
 * in the viewer the font loads with font-display: swap, which would flash the wordmark in a
 * fallback face. fontkit cannot instance a variable font straight from WOFF2 (it rebuilds the
 * instance from the still-compressed buffer and loses the cmap), so the WOFF2 the viewer ships
 * is decompressed to TrueType first.
 */

import * as fontkit from "fontkit";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FONT = join(ROOT, "node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2");

/** Wordmark setting: Archivo's widest width, a semibold weight, slightly tightened. */
const WIDTH = 125;
const WEIGHT = 600;
const TRACKING = -0.02; // em

// ─── The mark, on a 32-unit grid ─────────────────────────────────────────────────────────────

/** The plate: rounded corners of radius 5, and the notch, a 8-unit chamfer at the top right. */
const PLATE = "M7 2h15l8 8v15a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z";
/** The reticle's four ticks around the marked star at (14, 18). */
const TICKS = "M14 9.6v3.2M14 23.2v3.2M5.6 18h3.2M19.2 18h3.2";
const STARS: [number, number, number][] = [
  [14, 18, 2.8], // the marked star
  [23.2, 11.2, 1.6],
  [24.6, 24, 1.1],
];
/** Tick stroke; thicker at favicon size, where 1.7 units is under a device pixel. */
const TICK_WIDTH = 1.7;
const TICK_WIDTH_SMALL = 2.3;

/** Positive on light grounds, negative on dark: [plate, marks]. */
const ON_LIGHT = ["#0b1016", "#ffffff"] as const;
const ON_DARK = ["#e9eef2", "#0b1016"] as const;
/** Wordmark ink on each ground (the viewer's ink tokens). */
const INK_LIGHT = "#11171d";
const INK_DARK = "#e8edf1";

function markBody(plate: string, ink: string, tickWidth: number): string {
  const stars = STARS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`).join("");
  return `<path d="${PLATE}" fill="${plate}"/><path d="${TICKS}" stroke="${ink}" stroke-width="${tickWidth}" stroke-linecap="round" fill="none"/>${stars}`;
}

// ─── The wordmark ────────────────────────────────────────────────────────────────────────────

function decompress(woff2: string): { ttf: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "skyplate-brand-"));
  const copy = join(dir, "font.woff2");
  Bun.spawnSync(["cp", woff2, copy]);
  const r = Bun.spawnSync(["woff2_decompress", copy], { stderr: "pipe" });
  if (r.exitCode !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`woff2_decompress failed (brew install woff2): ${r.stderr.toString().trim()}`);
  }
  return { ttf: join(dir, "font.ttf"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

interface Outline {
  /** Path data in font units, y flipped to SVG's downward axis, baseline at y = ascent. */
  d: string;
  width: number;
  /** Ascender-to-descender box the path sits in. */
  height: number;
  ascent: number;
  xHeight: number;
}

function outline(text: string): Outline {
  const { ttf, cleanup } = decompress(FONT);
  try {
    const font = fontkit.openSync(ttf) as unknown as fontkit.Font & { getVariation(s: Record<string, number>): fontkit.Font };
    const v = font.getVariation({ wdth: WIDTH, wght: WEIGHT });
    const run = v.layout(text);
    const track = TRACKING * v.unitsPerEm;
    const ascent = v.ascent;
    const parts: string[] = [];
    let x = 0;
    let right = 0;
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i]!;
      // Font outlines are y-up from the baseline; SVG is y-down from the top.
      const p = g.path.scale(1, -1).translate(x + pos.xOffset, ascent - pos.yOffset);
      parts.push(p.toSVG());
      right = x + pos.xOffset + g.bbox.maxX;
      x += pos.xAdvance + (i < run.glyphs.length - 1 ? track : 0);
    });
    // Two decimals: sub-unit precision at 1000 units per em is invisible at any size.
    const d = parts.join("").replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100));
    return { d, width: Math.ceil(right), height: ascent - v.descent, ascent, xHeight: v.xHeight };
  } finally {
    cleanup();
  }
}

// ─── Writing ─────────────────────────────────────────────────────────────────────────────────

const word = outline("skyplate");

/**
 * The lockup: the mark at the wordmark's cap-to-descender height, beside it. Laid out in font
 * units so the SVG scales as one piece; the mark's 32 units are scaled to MARK_UNITS.
 */
const MARK_UNITS = 900;
const GAP = 300;
const lockupWidth = MARK_UNITS + GAP + word.width;
const lockupHeight = Math.max(MARK_UNITS, word.height);
const markScale = MARK_UNITS / 32;
// The mark sits centered on the x-height band, which is where the eye reads a lowercase word.
const wordTop = (lockupHeight - word.height) / 2;
const xMid = wordTop + word.ascent - word.xHeight / 2;
const markTop = Math.min(Math.max(0, xMid - MARK_UNITS / 2), lockupHeight - MARK_UNITS);

function lockup(theme: "light" | "dark"): string {
  const [plate, ink] = theme === "light" ? ON_LIGHT : ON_DARK;
  const wordInk = theme === "light" ? INK_LIGHT : INK_DARK;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockupWidth} ${lockupHeight}" width="${Math.round(lockupWidth / 20)}" height="${Math.round(lockupHeight / 20)}" role="img" aria-label="Skyplate">`,
    `<!-- Generated by scripts/brand.ts from Archivo (SIL OFL 1.1), wdth ${WIDTH} wght ${WEIGHT}. Do not edit by hand. -->`,
    `<g transform="translate(0 ${markTop.toFixed(1)}) scale(${markScale.toFixed(4)})">${markBody(plate, ink, TICK_WIDTH)}</g>`,
    `<path transform="translate(${MARK_UNITS + GAP} ${wordTop.toFixed(1)})" fill="${wordInk}" d="${word.d}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

/** The mark alone, inverting with the color scheme of whatever shows it (a tab bar, a page). */
function adaptiveMark(tickWidth: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<style>.p{fill:${ON_LIGHT[0]}}.i{fill:${ON_LIGHT[1]};stroke:${ON_LIGHT[1]}}@media (prefers-color-scheme:dark){.p{fill:${ON_DARK[0]}}.i{fill:${ON_DARK[1]};stroke:${ON_DARK[1]}}}</style>`,
    `<path class="p" d="${PLATE}"/>`,
    `<path class="i" d="${TICKS}" stroke-width="${tickWidth}" stroke-linecap="round" fill="none" style="fill:none"/>`,
    ...STARS.map(([x, y, r]) => `<circle class="i" cx="${x}" cy="${y}" r="${r}" stroke="none" style="stroke:none"/>`),
    `</svg>`,
  ].join("");
}

const generated = `/**
 * GENERATED by scripts/brand.ts; do not edit. Run \`bun scripts/brand.ts\` after changing the
 * mark's geometry or the wordmark's setting there.
 *
 * The wordmark is "skyplate" in Archivo (SIL OFL 1.1) at wdth ${WIDTH}, weight ${WEIGHT}, tracking
 * ${TRACKING}em, outlined to paths in font units (1000 per em), y-down, baseline at y = ascent.
 */

export const MARK = {
  viewBox: "0 0 32 32",
  plate: ${JSON.stringify(PLATE)},
  ticks: ${JSON.stringify(TICKS)},
  stars: ${JSON.stringify(STARS)} as [number, number, number][],
  tickWidth: ${TICK_WIDTH},
  tickWidthSmall: ${TICK_WIDTH_SMALL},
} as const;

export const WORDMARK = {
  d: ${JSON.stringify(word.d)},
  width: ${word.width},
  height: ${word.height},
  ascent: ${word.ascent},
  xHeight: ${word.xHeight},
} as const;
`;

await Bun.write(join(ROOT, "src/viewer/brand/brand.generated.ts"), generated);
await Bun.write(join(ROOT, "docs/brand/skyplate-lockup-light.svg"), lockup("light"));
await Bun.write(join(ROOT, "docs/brand/skyplate-lockup-dark.svg"), lockup("dark"));
await Bun.write(join(ROOT, "docs/brand/skyplate-mark.svg"), `${adaptiveMark(TICK_WIDTH)}\n`);

// The favicon is a data: URI so it loads over file:// with nothing beside index.html to find.
const indexPath = join(ROOT, "src/viewer/index.html");
const index = await Bun.file(indexPath).text();
const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(adaptiveMark(TICK_WIDTH_SMALL))}" />`;
const marked = /(<!-- brand:favicon -->)[\s\S]*?(<!-- \/brand:favicon -->)/;
if (!marked.test(index)) throw new Error("src/viewer/index.html has no <!-- brand:favicon --> … <!-- /brand:favicon --> markers");
await Bun.write(indexPath, index.replace(marked, `$1\n    ${favicon}\n    $2`));

console.log(` wordmark ${word.width}×${word.height} units, ${word.d.length} chars of path data`);
console.log(" wrote src/viewer/brand/brand.generated.ts, docs/brand/*.svg, the favicon in src/viewer/index.html");
