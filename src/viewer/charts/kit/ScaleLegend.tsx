/**
 * Legend for a sequential encoding: the ramp as discrete steps with the end values named.
 * Steps, not a smooth gradient, because the heatmaps quantize to the same steps and a smooth
 * bar would promise precision the cells do not have.
 */

import { SEQUENTIAL, type Surface } from "../../lib/colors";

export function ScaleLegend({
  low,
  high,
  label,
  surface,
  steps = 7,
}: {
  low: string;
  high: string;
  label?: string;
  surface: Surface;
  steps?: number;
}) {
  const colors = Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    const u = surface === "light" ? t : 1 - t;
    return SEQUENTIAL[Math.round(u * (SEQUENTIAL.length - 1))]!;
  });
  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      {label && <span>{label}</span>}
      <span className="figures font-mono text-[11px] text-ink-3">{low}</span>
      <span aria-hidden className="flex gap-[2px]">
        {colors.map((c, i) => (
          <span key={i} className="h-2.5 w-4 rounded-[2px]" style={{ background: c }} />
        ))}
      </span>
      <span className="figures font-mono text-[11px] text-ink-3">{high}</span>
    </div>
  );
}
