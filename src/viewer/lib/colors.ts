/**
 * Color roles for marks (galaxy stars, chart marks). Text never wears these: labels, values
 * and legends stay in ink tokens, with a swatch beside them carrying identity.
 *
 * Values mirror the tokens in styles.css and were validated with the dataviz skill's
 * validate_palette.js on each surface: `light` on the tray (#f6f7f5), `dark` on the dark-theme
 * tray (#161c20) and on the galaxy plate (#0b1016), which is dark in both themes, so the 3D
 * view always uses the dark steps. Slot order is the CVD-safety mechanism; never reorder.
 */

import type { CategoryGroup } from "../../shared/schema";

export const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"] as const;
export const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"] as const;
export const OTHER_LIGHT = "#9aa4aa";
export const OTHER_DARK = "#6b767d";

export const HOLOTYPE = "#c23a2b";
export const PLATE = "#0b1016";

/** Category groups in fixed slot order (schema CategoryGroup has exactly seven). */
export const CATEGORY_GROUPS: readonly CategoryGroup[] = ["code", "test", "docs", "config", "data", "markup", "asset"];
export const CATEGORY_GROUP_LABEL: Record<CategoryGroup, string> = {
  code: "Code",
  test: "Tests",
  docs: "Docs and prose",
  config: "Config and build",
  data: "Data and notebooks",
  markup: "Markup and styles",
  asset: "Assets and binaries",
};

export type Surface = "light" | "dark";

/** Categorical color for a palette slot; -1 (or any slot past 6) is the "Other" gray. */
export function seriesColor(slot: number, surface: Surface): string {
  const set = surface === "light" ? SERIES_LIGHT : SERIES_DARK;
  return slot >= 0 && slot < set.length ? set[slot]! : surface === "light" ? OTHER_LIGHT : OTHER_DARK;
}

export function categoryGroupColor(group: CategoryGroup, surface: Surface): string {
  return seriesColor(CATEGORY_GROUPS.indexOf(group), surface);
}

/** Sequential blue ramp, steps 100 → 700. */
export const SEQUENTIAL = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"] as const;

/**
 * Sample the sequential ramp at t ∈ [0, 1]. On a light surface more is darker; on a dark
 * surface the anchor flips so more is lighter (the near-zero end recedes into the ground).
 */
export function sequentialColor(t: number, surface: Surface): string {
  const clamped = Math.min(1, Math.max(0, t));
  const u = surface === "light" ? clamped : 1 - clamped;
  const i = Math.round(u * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[i]!;
}

/** Status colors: reserved meaning, always shipped with an icon and a label. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;
