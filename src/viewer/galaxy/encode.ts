/**
 * What each star wears: color, size and emphasis, computed per file from the store.
 *
 * Pure functions over the model, writing into the typed arrays the star shader reads. They run
 * on encoding or selection changes (never per frame), touch every file once, and allocate
 * nothing per file, so a 50k-file report re-encodes in a few milliseconds.
 *
 * Product principle 1 governs everything here: a star's color, size and brightness each come
 * from one measured number about its file. Nothing is varied for looks.
 */

import { CATEGORY_GROUP, type Category } from "../../shared/schema";
import { CATEGORY_GROUPS, categoryGroupColor, sequentialColor, seriesColor } from "../lib/colors";
import { colorMetric, isFileUnder, percentileRanks, sizeMetric, type Model } from "../model/indices";
import type { ColorBy, Filters, SizeBy, Target } from "../state/store";

/** "#rrggbb" → linear-ish 0-1 RGB. The plate is drawn without tone mapping, so sRGB is kept. */
function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgbCache = new Map<string, [number, number, number]>();
/**
 * The folded "Other" gray, scaled down on the plate only. Stars blend additively, and a
 * low-chroma gray adds to all three channels at once, so where Other files crowd (docs, config,
 * dotfolders) their halos summed to near-white: the brightest marks on the plate, louder than
 * any named language and easy to mistake for the white selection and definition rings. At this
 * scale a lone Other star still reads as the legend swatch's gray, and a crowd as a gray haze.
 */
const OTHER_ON_PLATE = 0.5;
function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) rgbCache.set(hex, (c = hexRgb(hex)));
  return c;
}

/** The moment "age" is measured from: the last commit, else when the report was written. */
export function reportNow(model: Model): number {
  return model.report.git?.last ?? Math.floor(Date.parse(model.report.generatedAt) / 1000);
}

/**
 * Fill `out` (stride 3) with each file's color on the plate. The plate is dark in both themes,
 * so marks always use the dark steps; sequential modes run through percentile ranks because
 * code metrics are heavy-tailed (see percentileRanks).
 */
export function encodeColors(model: Model, mode: ColorBy, out: Float32Array): void {
  const files = model.report.files;
  if (mode === "language" || mode === "category") {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const slot = mode === "language" ? (model.languageSlot.get(f.language) ?? -1) : CATEGORY_GROUPS.indexOf(CATEGORY_GROUP[f.category as Category]);
      const [r, g, b] = rgb(mode === "language" ? seriesColor(slot, "dark") : categoryGroupColor(CATEGORY_GROUP[f.category as Category], "dark"));
      const k = slot < 0 || slot > 6 ? OTHER_ON_PLATE : 1;
      out[i * 3] = r * k;
      out[i * 3 + 1] = g * k;
      out[i * 3 + 2] = b * k;
    }
    return;
  }
  const now = reportNow(model);
  const values = new Float64Array(files.length);
  for (let i = 0; i < files.length; i++) values[i] = colorMetric(files[i]!, mode, now);
  const ranks = percentileRanks(values);
  for (let i = 0; i < files.length; i++) {
    const [r, g, b] = rgb(sequentialColor(ranks[i]!, "dark"));
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}

/**
 * Fill `out` with each file's size in [0, 1]: √metric over the 99th percentile of √metric,
 * clamped. Square root because the star's area should track the metric; the percentile cap
 * so one 30k-line generated file does not shrink every other star to a dot.
 */
export function encodeSizes(model: Model, mode: SizeBy, out: Float32Array): void {
  const files = model.report.files;
  const roots = new Float64Array(files.length);
  for (let i = 0; i < files.length; i++) roots[i] = Math.sqrt(Math.max(0, sizeMetric(files[i]!, mode)));
  const sorted = Float64Array.from(roots).sort();
  const cap = sorted[Math.floor((sorted.length - 1) * 0.99)] || sorted[sorted.length - 1] || 1;
  for (let i = 0; i < files.length; i++) out[i] = Math.min(1, roots[i]! / (cap || 1));
}

/**
 * Filters that narrow what the reader sees. Hiding vendored files is the default, so it is not
 * a narrowing a reader chose and gets no chip; the other three are.
 */
export function isNarrowed(filters: Filters): boolean {
  return filters.languages !== null || filters.categories !== null || filters.hideGenerated;
}

/** Does a file pass the filters? Hidden files dim; they are never removed (scale principle). */
export function passesFilters(model: Model, file: number, filters: Filters): boolean {
  const f = model.report.files[file]!;
  if (filters.hideGenerated && f.generated) return false;
  if (filters.hideVendored && f.vendored) return false;
  if (filters.languages && !filters.languages.has(f.language)) return false;
  if (filters.categories && !filters.categories.has(f.category)) return false;
  return true;
}

/** Emphasis levels, shared with the shader's reading of aEmph. */
export const DIM = 0.13;
export const QUIET = 0.42;
export const LIT = 1.35;

export interface EmphasisInput {
  focusDir: number | null;
  filters: Filters;
  selection: Target | null;
  /** Per-file emphasis for a selected symbol's neighborhood, or null. */
  symbolLight: Float32Array | null;
  /**
   * A legend key under the pointer or keyboard focus: only its files stay lit, a preview of
   * what clicking it would filter to. Null when no key is being previewed.
   */
  preview?: ((file: number) => boolean) | null;
}

/**
 * Fill `out` with each file's emphasis: 1 is normal, below 1 recedes, above 1 is lit. Filters
 * and the open drawer dim what they exclude (the contract's "focus that dims the rest"); a
 * selection quiets everything it does not involve so its lanes and labels read.
 */
export function encodeEmphasis(model: Model, input: EmphasisInput, out: Float32Array): void {
  const n = model.fileCount;
  const { focusDir, filters, selection, symbolLight, preview } = input;
  const filtering = filters.languages !== null || filters.categories !== null || filters.hideGenerated || filters.hideVendored;
  // Filters are a ceiling every later step respects. The selection branches below lift files
  // with Math.max, and before this they lifted filtered-out files too: with the EJS filter on,
  // opening the lib drawer lit lib's JavaScript stars at full strength while the trays beside
  // the plate said there was nothing in view.
  const pass = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    pass[i] = !filtering || passesFilters(model, i, filters) ? 1 : 0;
    let e = 1;
    if (!pass[i]) e = DIM;
    else if (focusDir !== null && focusDir !== 0 && !isFileUnder(model, i, focusDir)) e = DIM;
    out[i] = e;
  }
  const finish = () => {
    // The selected file itself stays as lit as the selection made it: the reader asked for it.
    const keep = selection?.kind === "file" ? selection.id : -1;
    for (let i = 0; i < n; i++) {
      if (!pass[i] && i !== keep) out[i] = Math.min(out[i]!, DIM);
      if (preview && !preview(i)) out[i] = Math.min(out[i]!, DIM);
    }
  };

  if (symbolLight) {
    // A symbol's neighborhood lights across the whole project, open drawer or not: the point
    // is to see every place that uses it, and a caller in another drawer is exactly the
    // surprise worth seeing. Filters still dim what they exclude.
    for (let i = 0; i < n; i++) out[i] = (pass[i] ? 1 : DIM) * symbolLight[i]!;
    return finish();
  }
  if (!selection) return finish();
  switch (selection.kind) {
    case "file": {
      for (let i = 0; i < n; i++) out[i] = out[i]! * 0.62;
      const lift = (adj: { offsets: Int32Array; targets: Int32Array }) => {
        for (let k = adj.offsets[selection.id]!; k < adj.offsets[selection.id + 1]!; k++) {
          const t = adj.targets[k]!;
          out[t] = Math.max(out[t]!, 1.15);
        }
      };
      lift(model.imports);
      lift(model.importedBy);
      out[selection.id] = Math.max(out[selection.id]!, LIT);
      break;
    }
    case "dir": {
      if (selection.id === 0) break;
      for (let i = 0; i < n; i++) out[i] = isFileUnder(model, i, selection.id) ? Math.max(out[i]!, 1.1) : out[i]! * QUIET;
      break;
    }
    case "author": {
      const owned = new Uint8Array(n);
      for (const f of model.authorFiles[selection.id] ?? []) owned[f] = 1;
      for (let i = 0; i < n; i++) out[i] = owned[i] ? Math.max(out[i]!, LIT) : out[i]! * 0.22;
      break;
    }
    case "symbol":
      // Lit by symbolLight once the tables load; until then, everything quiets a little so the
      // plate visibly acknowledges the pick.
      for (let i = 0; i < n; i++) out[i] = out[i]! * 0.55;
      break;
  }
  finish();
}
