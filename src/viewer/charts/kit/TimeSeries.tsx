/**
 * One series over time: a 2px line over a 10% area wash, with a crosshair that snaps to the
 * nearest sample. Readers aim at a date, never at a 2px line, so the whole plot is the hit
 * target and the tooltip follows the snapped point.
 *
 * Samples are joined by straight segments. A smoothing curve through five weekly totals (a
 * "last 30 days" range) draws a confident wave between them that no week actually had.
 */

import * as d3 from "d3";
import { useMemo } from "react";
import { formatDate } from "../../lib/format";
import { XAxis, YGrid } from "./Axis";
import { timeTicks, toDate, useActiveIndex } from "./interaction";
import { tickNumber } from "./marks";
import { ChartTooltip, type TipRow } from "./Tooltip";

const M = { top: 10, right: 12, bottom: 22, left: 40 };

export interface TimePoint {
  t: number; // unix seconds
  v: number;
}

export function TimeSeries({
  points,
  width,
  height = 200,
  color,
  ring,
  label,
  valueLabel,
  tipRows,
  titleFor,
  area = true,
  zeroBased = true,
}: {
  points: TimePoint[];
  width: number;
  height?: number;
  color: string;
  /** Surface color, for the 2px ring around the snapped marker. */
  ring: string;
  label: string;
  /** Tooltip label after the value, e.g. "commits". */
  valueLabel: string;
  /** Extra tooltip rows for sample i. */
  tipRows?: (i: number) => TipRow[];
  titleFor?: (i: number) => string;
  area?: boolean;
  zeroBased?: boolean;
}) {
  const { active, setActive, focusProps } = useActiveIndex(points.length);
  const x0 = M.left;
  const x1 = width - M.right;
  const y0 = height - M.bottom;
  const y1 = M.top;

  const { x, y, line, areaPath } = useMemo(() => {
    const ext = d3.extent(points, (p) => p.t) as [number, number];
    const x = d3
      .scaleUtc()
      .domain([toDate(ext[0] ?? 0), toDate(ext[1] ?? 1)])
      .range([x0, x1]);
    const lo = zeroBased ? 0 : (d3.min(points, (p) => p.v) ?? 0);
    const y = d3
      .scaleLinear()
      .domain([lo, Math.max(lo + 1, d3.max(points, (p) => p.v) ?? 1)])
      .nice(4)
      .range([y0, y1]);
    const gen = d3
      .line<TimePoint>()
      .x((p) => x(toDate(p.t)))
      .y((p) => y(p.v))
      .curve(d3.curveLinear);
    const areaGen = d3
      .area<TimePoint>()
      .x((p) => x(toDate(p.t)))
      .y0(y0)
      .y1((p) => y(p.v))
      .curve(d3.curveLinear);
    return { x, y, line: gen(points) ?? "", areaPath: areaGen(points) ?? "" };
  }, [points, x0, x1, y0, y1, zeroBased]);

  const bisect = useMemo(() => d3.bisector((p: TimePoint) => p.t).center, []);
  const p = active !== null ? points[active] : undefined;
  const px = p ? x(toDate(p.t)) : 0;
  const py = p ? y(p.v) : 0;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className="block overflow-visible outline-offset-4"
        {...focusProps}
        onPointerMove={(e) => {
          const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const t = x.invert(mx).getTime() / 1000;
          setActive(points.length ? bisect(points, t) : null);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <YGrid ticks={y.ticks(4).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        {area && <path d={areaPath} fill={color} fillOpacity={0.1} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <XAxis ticks={timeTicks(x, x1 - x0)} y={y0} x0={x0} x1={x1} />
        {p && (
          <g aria-hidden pointerEvents="none">
            <line x1={px} x2={px} y1={y1} y2={y0} className="stroke-ink-3" strokeWidth={1} />
            <circle cx={px} cy={py} r={4} fill={color} stroke={ring} strokeWidth={2} />
          </g>
        )}
      </svg>
      <ChartTooltip
        width={width}
        tip={
          p && active !== null
            ? {
                x: px,
                y: Math.max(0, py - 20),
                title: titleFor ? titleFor(active) : formatDate(p.t),
                rows: [{ value: tickNumberExact(p.v), label: valueLabel, color }, ...(tipRows?.(active) ?? [])],
              }
            : null
        }
      />
    </div>
  );
}

const exact = new Intl.NumberFormat("en-US");
function tickNumberExact(v: number): string {
  return exact.format(Math.round(v));
}
