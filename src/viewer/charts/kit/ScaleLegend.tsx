/**
 * Legend for a sequential encoding: the ramp as discrete steps with the end values named.
 * Steps, not a smooth gradient, because the heatmaps quantize to exactly these steps (through
 * rampColor below) and a smooth bar would promise precision the cells do not have.
 *
 * Empty cells are not the ramp's lightest step: they wear the wash. So the legend shows that
 * wash as its own swatch labeled "0", and the ramp's low label is the smallest nonzero value.
 * Labeling the ramp "0 … 1,798" said a one-import cell and an empty one looked alike, and in
 * light mode they nearly do (wash and the first step are ΔE 6.4 apart).
 */

import { SEQUENTIAL, type Surface } from "../../lib/colors";

export const RAMP_STEPS = 7;

/** The ramp's steps, least first. On a dark surface the anchor flips: least is darkest. */
export function rampColors(surface: Surface, steps = RAMP_STEPS): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 1 : i / (steps - 1);
    const u = surface === "light" ? t : 1 - t;
    return SEQUENTIAL[Math.round(u * (SEQUENTIAL.length - 1))]!;
  });
}

/** Step index for t ∈ [0, 1]: equal-width bins, t = 1 in the top one. */
export function rampStep(t: number, steps = RAMP_STEPS): number {
  return Math.max(0, Math.min(steps - 1, Math.floor(Math.max(0, Math.min(1, t)) * steps)));
}

export function rampColor(t: number, surface: Surface, steps = RAMP_STEPS): string {
  return rampColors(surface, steps)[rampStep(t, steps)]!;
}

/**
 * Position on the ramp for a nonzero value between the smallest (lo) and largest (hi) nonzero
 * values, linear or square-root. The lowest nonzero value lands in the first step and the
 * largest in the last, so the legend's end labels are exactly true.
 */
export function rampT(v: number, lo: number, hi: number, scale: "linear" | "sqrt" = "linear"): number {
  if (hi <= lo) return 1;
  const f = scale === "sqrt" ? Math.sqrt : (x: number) => x;
  return (f(v) - f(lo)) / (f(hi) - f(lo));
}

export function ScaleLegend({
  low,
  high,
  label,
  surface,
  steps = RAMP_STEPS,
  zero = true,
  note,
}: {
  low: string;
  high: string;
  label?: string;
  surface: Surface;
  steps?: number;
  /** Show the wash swatch for empty cells, labeled "0". */
  zero?: boolean;
  /** How values map onto the steps, when not linear ("square-root scale"). */
  note?: string;
}) {
  const colors = rampColors(surface, steps);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
      {label && <span>{label}</span>}
      {zero && (
        <span className="mr-1.5 flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-4 rounded-[2px] border border-rule bg-wash" />
          <span className="figures font-mono text-[11px] text-ink-3">0</span>
        </span>
      )}
      <span className="figures font-mono text-[11px] text-ink-3">{low}</span>
      <span aria-hidden className="flex gap-[2px]">
        {colors.map((c, i) => (
          <span key={i} className="h-2.5 w-4 rounded-[2px]" style={{ background: c }} />
        ))}
      </span>
      <span className="figures font-mono text-[11px] text-ink-3">{high}</span>
      {note && <span className="text-ink-3">{note}</span>}
    </div>
  );
}
