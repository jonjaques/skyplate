/**
 * The one chart tooltip. Values lead in strong ink and labels follow (the legend's hierarchy
 * inverted: the reader already knows the series and wants the number). Rows key their series
 * with a short line stroke, not a box.
 *
 * Everything renders as React text nodes, which is textContent: file paths, author names and
 * commit types come straight out of a repository and are never parsed as markup.
 *
 * Coordinates are relative to the figure body, which is the positioning parent. The tooltip
 * flips to the left of the pointer past the body's midpoint instead of measuring itself, so
 * it never needs a second layout pass to avoid the right edge.
 */

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

export function ChartTooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width / 2;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute z-30 max-w-[280px] min-w-[120px] rounded-md border border-rule bg-paper px-2.5 py-2 text-xs shadow-md",
      )}
      style={{
        top: Math.max(0, tip.y - 8),
        ...(flip ? { right: Math.max(0, width - tip.x + 14) } : { left: tip.x + 14 }),
      }}
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
