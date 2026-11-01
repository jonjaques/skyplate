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
import { categoryGroupColor, sequentialColor, seriesColor } from "../lib/colors";
import { colorMetric, isFileUnder, percentileRanks, sizeMetric, type Model } from "../model/indices";
import type { ColorBy, Filters, SizeBy, Target } from "../state/store";

/** "#rrggbb" → linear-ish 0-1 RGB. The plate is drawn without tone mapping, so sRGB is kept. */
function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgbCache = new Map<string, [number, number, number]>();
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
      const hex =
        mode === "language"
          ? seriesColor(model.languageSlot.get(f.language) ?? -1, "dark")
          : categoryGroupColor(CATEGORY_GROUP[f.category as Category], "dark");
      const [r, g, b] = rgb(hex);
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
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
}

/**
 * Fill `out` with each file's emphasis: 1 is normal, below 1 recedes, above 1 is lit. Filters
 * and the open drawer dim what they exclude (the contract's "focus that dims the rest"); a
 * selection quiets everything it does not involve so its lanes and labels read.
 */
export function encodeEmphasis(model: Model, input: EmphasisInput, out: Float32Array): void {
  const n = model.fileCount;
  const { focusDir, filters, selection, symbolLight } = input;
  const filtering = filters.languages !== null || filters.categories !== null || filters.hideGenerated || filters.hideVendored;
  for (let i = 0; i < n; i++) {
    let e = 1;
    if (filtering && !passesFilters(model, i, filters)) e = DIM;
    else if (focusDir !== null && focusDir !== 0 && !isFileUnder(model, i, focusDir)) e = DIM;
    out[i] = e;
  }

  if (symbolLight) {
    for (let i = 0; i < n; i++) out[i] = Math.min(out[i]!, 1) * symbolLight[i]!;
    return;
  }
  if (!selection) return;
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
}
