/**
 * Chart colors that depend on the theme, and the hook that tracks it.
 *
 * Marks need literal hex (they are validated per surface and some feed SVG attributes that
 * cannot read CSS variables in every engine), so the current surface is read from
 * `data-theme` on <html> and watched: the shell flips that attribute, and every chart repaints
 * with the dark steps instead of inverting the light ones.
 *
 * Chrome (gridlines, axes, tick text) stays on CSS variables through Tailwind classes, because
 * those tokens already flip with the theme and never need per-surface validation.
 */

import { OTHER_DARK, OTHER_LIGHT, seriesColor, type Surface } from "../../lib/colors";

/** "light" or "dark", following the shell's theme attribute (one implementation, in the shell). */
export { useSurface } from "../../shell/theme";

/**
 * The single-series "measure" color. Blue is language slot 0 (usually TypeScript) in the
 * galaxy legend, so a blue commit column would read as "TypeScript commits". Single-series
 * magnitude marks wear the archival rail slate instead (as the chosen sketch does), which no
 * categorical slot uses. Contrast checked with the dataviz validator: 5.98:1 on the light
 * tray, 6.51:1 on the dark tray.
 */
export function measureColor(surface: Surface): string {
  return surface === "light" ? "#4e6170" : "#8da2b2";
}

/** De-emphasis gray for "the rest" in emphasis forms and the folded Other bucket. */
export function mutedColor(surface: Surface): string {
  return surface === "light" ? OTHER_LIGHT : OTHER_DARK;
}

/** Emphasis by value contrast, not hue: ink marks pop against gray without claiming a slot. */
export function emphasisColor(surface: Surface): string {
  return surface === "light" ? "#15191c" : "#e8ecee";
}

/** The tray color, for 2px surface rings drawn around overlapping marks. */
export function surfaceColor(surface: Surface): string {
  return surface === "light" ? "#f6f7f5" : "#161c20";
}

export function slotColor(slot: number, surface: Surface): string {
  return seriesColor(slot, surface);
}
