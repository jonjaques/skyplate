/**
 * Mark geometry shared by every chart, so the specs hold everywhere: bars at most 24px thick,
 * a 4px rounded data end that stays square at the baseline, and a 2px surface gap between
 * marks that touch.
 */

import { formatInt } from "../../lib/format";

export const BAR_MAX = 24;
export const GAP = 2;
export const RADIUS = 4;

/** Column from a baseline at y0 up to y1 (y1 < y0), rounded only at the top. */
export function columnPath(x: number, width: number, y0: number, y1: number, r = RADIUS): string {
  const h = y0 - y1;
  if (h <= 0 || width <= 0) return "";
  const rr = Math.max(0, Math.min(r, width / 2, h));
  return `M${x},${y0}V${y1 + rr}A${rr},${rr} 0 0 1 ${x + rr},${y1}H${x + width - rr}A${rr},${rr} 0 0 1 ${x + width},${y1 + rr}V${y0}Z`;
}

/** Horizontal bar from a baseline at x0 out to x1 (x1 > x0), rounded only at the right end. */
export function barPath(x0: number, x1: number, y: number, height: number, r = RADIUS): string {
  const w = x1 - x0;
  if (w <= 0 || height <= 0) return "";
  const rr = Math.max(0, Math.min(r, height / 2, w));
  return `M${x0},${y}H${x1 - rr}A${rr},${rr} 0 0 1 ${x1},${y + rr}V${y + height - rr}A${rr},${rr} 0 0 1 ${x1 - rr},${y + height}H${x0}Z`;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Axis ticks: compact from 1,000 up (0 / 1K / 2K). lib/format's formatCompact only compacts
 * from 10,000, which suits labels but crowds an axis.
 */
export function tickNumber(n: number): string {
  if (Math.abs(n) >= 1000) return compact.format(n);
  if (Number.isInteger(n)) return formatInt(n);
  return n.toFixed(Math.abs(n) < 1 ? 2 : 1);
}

const pct0 = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/**
 * A share of a whole: "59%", "0.4%", and "<0.1%" for anything smaller but present. A real
 * file rounding to "0%" beside its own swatch reads as an error in the data.
 */
export function formatShare(ratio: number): string {
  if (ratio <= 0) return "0%";
  if (ratio < 0.001) return "<0.1%";
  return (ratio < 0.01 ? pct1 : pct0).format(ratio);
}

/** Bar thickness for a band: capped at 24px, leaving the rest of the band as air. */
export function barThickness(band: number, ratio = 0.62): number {
  return Math.max(2, Math.min(BAR_MAX, band * ratio));
}
