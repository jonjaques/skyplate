/**
 * Axes and gridlines, drawn by React from d3 scales. Hairline, solid, recessive: the data is
 * the only loud thing. Tick text is compact (0 / 1K / 2K) in tabular mono so a column of
 * ticks aligns.
 */

import type { ReactNode } from "react";

export interface Tick {
  pos: number;
  label: string;
}

/** Bottom axis: a baseline at `y` from x0 to x1 and labels under it. */
export function XAxis({
  ticks,
  y,
  x0,
  x1,
  anchorEnds = true,
}: {
  ticks: Tick[];
  y: number;
  x0: number;
  x1: number;
  /** Pin the first and last labels inside the plot so they never clip at the tray edge. */
  anchorEnds?: boolean;
}) {
  return (
    <g aria-hidden>
      <line x1={x0} x2={x1} y1={y + 0.5} y2={y + 0.5} className="stroke-rule-strong" strokeWidth={1} />
      {ticks.map((t, i) => {
        let anchor: "start" | "middle" | "end" = "middle";
        if (anchorEnds && t.pos - x0 < 18) anchor = "start";
        else if (anchorEnds && x1 - t.pos < 18) anchor = "end";
        return (
          <text
            key={`${t.label}-${i}`}
            x={t.pos}
            y={y + 14}
            textAnchor={anchor}
            className="figures fill-ink-3 font-mono text-[10px]"
          >
            {t.label}
          </text>
        );
      })}
    </g>
  );
}

/** Horizontal gridlines across the plot with their labels left of x0. */
export function YGrid({ ticks, x0, x1, labels = true }: { ticks: Tick[]; x0: number; x1: number; labels?: boolean }) {
  return (
    <g aria-hidden>
      {ticks.map((t, i) => (
        <g key={`${t.label}-${i}`}>
          <line x1={x0} x2={x1} y1={Math.round(t.pos) + 0.5} y2={Math.round(t.pos) + 0.5} className="stroke-rule/70" strokeWidth={1} />
          {labels && (
            <text x={x0 - 6} y={t.pos} dy="0.32em" textAnchor="end" className="figures fill-ink-3 font-mono text-[10px]">
              {t.label}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/** Vertical gridlines (for horizontal-bar and scatter plots). */
export function XGrid({ ticks, y0, y1 }: { ticks: Tick[]; y0: number; y1: number }) {
  return (
    <g aria-hidden>
      {ticks.map((t, i) => (
        <line
          key={`${t.label}-${i}`}
          x1={Math.round(t.pos) + 0.5}
          x2={Math.round(t.pos) + 0.5}
          y1={y0}
          y2={y1}
          className="stroke-rule/70"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/** A small axis title, set in the label face rather than mono. */
export function AxisTitle({ x, y, children, anchor = "start", rotate }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; rotate?: boolean }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
      className="fill-ink-3 text-[11px]"
    >
      {children}
    </text>
  );
}
