/**
 * The one chart tooltip. Values lead in strong ink and labels follow (the legend's hierarchy
 * inverted: the reader already knows the series and wants the number). Rows key their series
 * with a short line stroke, not a box.
 *
 * Everything renders as React text nodes, which is textContent: file paths, author names and
 * commit types come straight out of a repository and are never parsed as markup.
 *
 * Coordinates are relative to the figure body, which is the positioning parent. The tooltip
 * measures itself before paint and stays inside [0, width] (and [0, height] when given):
 * right of the pointer when it fits, left of it when it does not, centered and clamped as a
 * last resort. Flipping at the midpoint was not enough, because a unit tray under the galaxy
 * is barely wider than the tooltip and clips anything that crosses its edge.
 */

import { useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/utils";

export interface TipRow {
  value: string;
  label?: string;
  /** Series color for the line key; omit for rows that are not a series. */
  color?: string;
}

export interface Tip {
  x: number;
  y: number;
  title?: string;
  rows: TipRow[];
}

const OFFSET = 14;

export function ChartTooltip({ tip, width, height }: { tip: Tip | null; width: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  // Runs after every render that shows a tip: the content (and so the size) changes with it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = tip.x + OFFSET;
    if (left + tw > width) left = tip.x - OFFSET - tw;
    if (left < 0) left = Math.max(0, Math.min(width - tw, tip.x - tw / 2));
    let top = Math.max(0, tip.y - 8);
    if (height !== undefined && top + th > height) top = Math.max(0, height - th);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = "visible";
  });

  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      // Hidden until measured, so the first frame never shows it in the wrong place.
      style={{ visibility: "hidden", left: 0, top: 0 }}
      className={cn(
        "pointer-events-none absolute z-30 max-w-[280px] min-w-[120px] rounded-md border border-rule bg-paper px-2.5 py-2 text-xs shadow-md",
      )}
    >
      {tip.title && <div className="mb-1 truncate text-ink-2">{tip.title}</div>}
      <div className="flex flex-col gap-0.5">
        {tip.rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2 whitespace-nowrap">
            {row.color && <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />}
            <span className="figures font-mono font-semibold text-ink">{row.value}</span>
            {row.label && <span className="min-w-0 truncate text-ink-3">{row.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
