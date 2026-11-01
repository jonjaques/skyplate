/**
 * Stacked series over time for part-of-a-flow data (lines added by language per month).
 *
 * Two forms, chosen by how many samples there are:
 * - Many samples: stacked areas. Each band is a pale wash of its series hue with its upper
 *   edge drawn as the 2px line, so identity rides the edge rather than a saturated block.
 * - Few samples (COLUMNS_UP_TO or fewer): stacked columns. Each sample is a monthly total, and
 *   an area drawn through three or four totals interpolates a smooth trend between them that
 *   the data does not have (a project's first big import month turned into a long glide).
 *
 * Either way the readout lists every series at the snapped sample, top of the stack first,
 * so the pointer never has to land inside a thin band.
 */

import * as d3 from "d3";
import { useMemo } from "react";
import { formatInt } from "../../lib/format";
import { XAxis, YGrid, type Tick } from "./Axis";
import { timeTicks, toDate, useActiveIndex } from "./interaction";
import { BAR_MAX, columnPath, GAP, tickNumber } from "./marks";
import { ChartTooltip } from "./Tooltip";

const M = { top: 10, right: 12, bottom: 22, left: 44 };
/** Up to two years of months reads better as columns than as a curve through them. */
const COLUMNS_UP_TO = 24;

export interface StackSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const fmtMonth = d3.utcFormat("%b");
const fmtMonthYear = d3.utcFormat("%b %Y");

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
  const asColumns = times.length <= COLUMNS_UP_TO;

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

  // Column geometry: one band per sample, the column capped at 24px with the rest as air.
  const band = times.length ? (x1 - x0) / times.length : 0;
  const colW = Math.min(BAR_MAX, Math.max(2, band - GAP * 4));
  const centerOf = (i: number) => (asColumns ? x0 + band * (i + 0.5) : x(toDate(times[i]!)));

  const columnTicks = useMemo((): Tick[] => {
    if (!asColumns || band <= 0) return [];
    // A label every k columns so labels keep ~64px apart; months, with the year on the
    // first label and on every January.
    const every = Math.max(1, Math.ceil(64 / band));
    return times
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => i % every === 0)
      .map(({ t, i }) => {
        const d = toDate(t);
        return { pos: x0 + band * (i + 0.5), label: i === 0 || d.getUTCMonth() === 0 ? fmtMonthYear(d) : fmtMonth(d) };
      });
  }, [asColumns, band, times, x0]);

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
  const px = active !== null ? centerOf(active) : 0;

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
          if (!times.length) return setActive(null);
          if (asColumns) {
            const i = Math.floor((mx - x0) / band);
            setActive(i >= 0 && i < times.length ? i : null);
          } else {
            setActive(bisect(times, x.invert(mx).getTime() / 1000));
          }
        }}
        onPointerLeave={() => setActive(null)}
      >
        <YGrid ticks={y.ticks(4).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        {asColumns ? (
          <g>
            {times.map((_, i) => {
              const cx = x0 + band * (i + 0.5) - colW / 2;
              // The topmost non-empty segment carries the rounded data end; the 2px surface
              // gap separates each segment from the one below it.
              let top = -1;
              for (let s = layers.length - 1; s >= 0; s--) {
                const d = layers[s]![i]!;
                if (d[1] > d[0]) {
                  top = s;
                  break;
                }
              }
              return (
                <g key={i} opacity={active === null || active === i ? 1 : 0.55}>
                  {layers.map((layer, s) => {
                    const d = layer[i]!;
                    if (d[1] <= d[0]) return null;
                    const yTop = y(d[1]);
                    const yBottom = y(d[0]) - (d[0] > 0 ? GAP : 0);
                    if (yBottom - yTop < 0.5) return null;
                    return s === top ? (
                      <path key={layer.key} d={columnPath(cx, colW, yBottom, yTop)} fill={series[s]!.color} />
                    ) : (
                      <rect key={layer.key} x={cx} y={yTop} width={colW} height={yBottom - yTop} fill={series[s]!.color} />
                    );
                  })}
                </g>
              );
            })}
          </g>
        ) : (
          <>
            {layers.map((layer, i) => (
              <path key={layer.key} d={area(layer) ?? ""} fill={series[i]!.color} fillOpacity={0.1} />
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
          </>
        )}
        <XAxis ticks={asColumns ? columnTicks : timeTicks(x, x1 - x0, "month")} y={y0} x0={x0} x1={x1} anchorEnds={!asColumns} />
        {active !== null && !asColumns && (
          <line aria-hidden x1={px} x2={px} y1={y1} y2={y0} className="stroke-ink-3" strokeWidth={1} pointerEvents="none" />
        )}
      </svg>
      <ChartTooltip
        width={width}
        height={height}
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
