/**
 * Stacked areas over time for part-of-a-flow series (lines added by language). Each band is a
 * pale wash of its series hue with its upper edge drawn as the 2px line, so identity rides the
 * edge rather than a saturated block. The crosshair readout lists every series at the snapped
 * x, top of the stack first, so the pointer never has to land inside a thin band.
 */

import * as d3 from "d3";
import { useMemo } from "react";
import { formatInt } from "../../lib/format";
import { XAxis, YGrid } from "./Axis";
import { timeTicks, toDate, useActiveIndex } from "./interaction";
import { tickNumber } from "./marks";
import { ChartTooltip } from "./Tooltip";

const M = { top: 10, right: 12, bottom: 22, left: 44 };

export interface StackSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function StackedArea({
  times,
  series,
  width,
  height = 220,
  label,
  titleFor,
  unit,
}: {
  times: number[];
  series: StackSeries[];
  width: number;
  height?: number;
  label: string;
  titleFor: (i: number) => string;
  unit: string;
}) {
  const { active, setActive, focusProps } = useActiveIndex(times.length);
  const x0 = M.left;
  const x1 = width - M.right;
  const y0 = height - M.bottom;
  const y1 = M.top;

  const { x, y, layers, totals } = useMemo(() => {
    const rows = times.map((_, i) => Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? 0])));
    const stack = d3
      .stack<Record<string, number>>()
      .keys(series.map((s) => s.key))
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);
    const layers = stack(rows);
    const totals = rows.map((r) => series.reduce((sum, s) => sum + (r[s.key] ?? 0), 0));
    const x = d3
      .scaleUtc()
      .domain([toDate(times[0] ?? 0), toDate(times[times.length - 1] ?? 1)])
      .range([x0, x1]);
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(1, d3.max(totals) ?? 1)])
      .nice(4)
      .range([y0, y1]);
    return { x, y, layers, totals };
  }, [times, series, x0, x1, y0, y1]);

  const area = d3
    .area<d3.SeriesPoint<Record<string, number>>>()
    .x((_, i) => x(toDate(times[i]!)))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]))
    .curve(d3.curveMonotoneX);
  const edge = d3
    .line<d3.SeriesPoint<Record<string, number>>>()
    .x((_, i) => x(toDate(times[i]!)))
    .y((d) => y(d[1]))
    .curve(d3.curveMonotoneX);

  const bisect = d3.bisector((t: number) => t).center;
  const px = active !== null ? x(toDate(times[active]!)) : 0;

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
          setActive(times.length ? bisect(times, x.invert(mx).getTime() / 1000) : null);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <YGrid ticks={y.ticks(4).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        {layers.map((layer, i) => (
          <path key={layer.key} d={area(layer) ?? ""} fill={series[i]!.color} fillOpacity={0.16} />
        ))}
        {layers.map((layer, i) => (
          <path
            key={layer.key}
            d={edge(layer) ?? ""}
            fill="none"
            stroke={series[i]!.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        <XAxis ticks={timeTicks(x, x1 - x0, "month")} y={y0} x0={x0} x1={x1} />
        {active !== null && (
          <line aria-hidden x1={px} x2={px} y1={y1} y2={y0} className="stroke-ink-3" strokeWidth={1} pointerEvents="none" />
        )}
      </svg>
      <ChartTooltip
        width={width}
        tip={
          active !== null
            ? {
                x: px,
                y: y1 + 8,
                title: `${titleFor(active)} · ${formatInt(totals[active] ?? 0)} ${unit}`,
                rows: [...series]
                  .map((s) => ({ s, v: s.values[active] ?? 0 }))
                  .reverse()
                  .filter((r) => r.v > 0)
                  .map((r) => ({ value: formatInt(r.v), label: r.s.label, color: r.s.color })),
              }
            : null
        }
      />
    </div>
  );
}
