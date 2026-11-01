/**
 * Distribution on log2 bins: bins[i] counts values in [2^i, 2^(i+1)), bins[0] also holds 0-1
 * (the analyzer's Distribution.log2Bins shape). Code metrics are heavy-tailed; on linear bins
 * every file would sit in the first column. Median and p90 are marked as hairlines with their
 * values, because "where is the middle, where is the tail" is the question this chart answers.
 *
 * Ticks sit on bin boundaries (0, 2, 4, 8…), the same positions the markers use: bin i spans
 * [i, i + 1) bands, so a value v sits at log2(v) bands, and the first bin, which holds 0 and
 * 1, runs linearly from 0 to 2. Ticks used to be centered in their bins, half a band right of
 * where a marker of the same value drew, so "median 2" stood beside the "2" tick, not on it.
 * Bin ranges stay in the tooltip and the table.
 */

import * as d3 from "d3";
import { formatCompact, formatInt } from "../../lib/format";
import { XAxis, YGrid } from "./Axis";
import { useActiveIndex } from "./interaction";
import { columnPath, GAP, tickNumber } from "./marks";
import { ChartTooltip } from "./Tooltip";

const M = { right: 14, bottom: 22, left: 36 };

/** Position of a value in bands from the plot's left edge (see the header). */
export function binPosition(v: number): number {
  if (!(v > 0)) return 0;
  return v < 2 ? v / 2 : Math.log2(v);
}

/** Label for the boundary at band i: 0, 2, 4, 8, … 1K. */
export function boundaryLabel(i: number): string {
  return i === 0 ? "0" : formatCompact(2 ** i);
}

export function binRange(i: number): string {
  if (i === 0) return "0–1";
  const lo = 2 ** i;
  return `${formatCompact(lo)}–${formatCompact(2 ** (i + 1) - 1)}`;
}

export function Log2Histogram({
  bins,
  width,
  height = 180,
  color,
  unit,
  measure,
  markers = [],
}: {
  bins: number[];
  width: number;
  height?: number;
  color: string;
  /** What is counted, plural: "files", "functions". */
  unit: string;
  /** What is binned: "lines", "complexity". */
  measure: string;
  markers?: { value: number; label: string }[];
}) {
  const n = Math.max(1, bins.length);
  const { active, setActive, focusProps } = useActiveIndex(n);
  const x0 = M.left;
  const x1 = width - M.right;
  const band = (x1 - x0) / n;
  const posOf = (v: number) => x0 + Math.min(n, binPosition(v)) * band;

  // Marker labels sit in one line above the plot. With two markers (median, p90) the first
  // reads leftward from its line and the second rightward, so close markers never stack
  // their text on each other's hairline; a label that would leave the plot flips sides.
  const placed = markers.map((m, i) => {
    const x = posOf(m.value);
    const w = m.label.length * 5.4 + 4;
    let anchor: "start" | "end" = markers.length > 1 && i === 0 ? "end" : "start";
    if (anchor === "end" && x - w < x0) anchor = "start";
    if (anchor === "start" && x + w > x1 && x - w >= x0) anchor = "end";
    return { ...m, x, anchor };
  });
  const y0 = height - M.bottom;
  const y1 = placed.length ? 20 : 8;
  const max = Math.max(1, ...bins);
  const y = d3.scaleLinear().domain([0, max]).nice(4).range([y0, y1]);
  const colW = Math.min(24, Math.max(2, band - GAP));

  // Every boundary when the labels fit (~34px each), otherwise every second or fourth.
  const every = band >= 34 ? 1 : band >= 17 ? 2 : 4;
  const xTicks = Array.from({ length: n + 1 }, (_, i) => ({ pos: x0 + i * band, label: boundaryLabel(i) })).filter((_, i) => i % every === 0);

  const tip =
    active !== null && bins[active] !== undefined
      ? {
          x: x0 + active * band + band / 2,
          y: y(bins[active]!) - 6,
          title: `${binRange(active)} ${measure}`,
          rows: [{ value: formatInt(bins[active]!), label: unit }],
        }
      : null;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Histogram of ${unit} by ${measure}`}
        className="block overflow-visible outline-offset-4"
        {...focusProps}
        onPointerMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const i = Math.floor((px - x0) / band);
          setActive(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <YGrid ticks={y.ticks(4).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        {bins.map((count, i) => (
          <path
            key={i}
            d={columnPath(x0 + i * band + (band - colW) / 2, colW, y0, y(count))}
            fill={color}
            opacity={active === null || active === i ? 1 : 0.55}
          />
        ))}
        {placed.map((m) => (
          <g key={m.label} aria-hidden>
            <line x1={m.x + 0.5} x2={m.x + 0.5} y1={y0} y2={y1 - 14} className="stroke-ink" strokeWidth={1} />
            <text x={m.anchor === "end" ? m.x - 4 : m.x + 5} y={y1 - 6} textAnchor={m.anchor} className="fill-ink-2 text-[10px]">
              {m.label}
            </text>
          </g>
        ))}
        <XAxis ticks={xTicks} y={y0} x0={x0} x1={x1} anchorEnds={false} />
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
