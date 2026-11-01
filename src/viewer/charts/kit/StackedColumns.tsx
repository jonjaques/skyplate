/**
 * Stacked columns over calendar spans, for part-of-a-flow data (lines added by language).
 *
 * Always columns, never stacked areas. The area form drew each band as a 10% wash with a
 * 2px colored edge, and on a long history (fd: eight years of months) every upper band was
 * one or two pixels thick, so the edges of the bands above were drawn over the bottom band's
 * edge: Rust, 64% of fd's code, vanished under a gray-blue wash with eight edges converging
 * at every peak. It also smoothed with curveMonotoneX, the wave TimeSeries already rejects
 * for totals. Columns keep each segment a solid fill with a 2px surface gap and a rounded
 * top; a long history folds months into quarters, halves or years (data.ts monthBuckets) so
 * it stays at or under COLUMNS_UP_TO columns instead.
 *
 * The readout lists every series in the hovered column, top of the stack first, so the
 * pointer never has to land inside a thin segment.
 */

import * as d3 from "d3";
import { useMemo } from "react";
import { formatInt } from "../../lib/format";
import { XAxis, YGrid, type Tick } from "./Axis";
import { toDate, useActiveIndex } from "./interaction";
import { BAR_MAX, columnPath, GAP, tickNumber } from "./marks";
import { ChartTooltip } from "./Tooltip";

const M = { top: 10, right: 12, bottom: 22, left: 44 };

/** Columns stay readable up to about two dozen; past that, a wider calendar span. */
export const COLUMNS_UP_TO = 24;

export interface StackSeries {
  key: string;
  label: string;
  color: string;
  /** One value per column. */
  values: number[];
}

const fmtMonth = d3.utcFormat("%b");
const fmtMonthYear = d3.utcFormat("%b %Y");
const fmtYear = d3.utcFormat("%Y");

/** "Mar 2024", "Jan–Mar 2024", "Jul–Dec 2024", "2024", "2020–2024". */
export function spanTitle(start: number, months: number): string {
  const a = toDate(start);
  if (months === 1) return fmtMonthYear(a);
  const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months - 1, 1));
  if (months % 12 === 0) return months === 12 ? fmtYear(a) : `${fmtYear(a)}–${fmtYear(b)}`;
  return `${fmtMonth(a)}–${fmtMonth(b)} ${fmtYear(b)}`;
}

/** The column span in words, for subtitles: "month", "quarter", "half year", "year". */
export function spanWord(months: number): string {
  if (months === 1) return "month";
  if (months === 3) return "quarter";
  if (months === 6) return "half year";
  if (months === 12) return "year";
  return `${months / 12} years`;
}

export function StackedColumns({
  starts,
  months,
  series,
  width,
  height = 220,
  label,
  unit,
}: {
  /** Start of each column (unix seconds, a month start). */
  starts: number[];
  /** Months per column: 1, 3, 6, 12… */
  months: number;
  series: StackSeries[];
  width: number;
  height?: number;
  label: string;
  unit: string;
}) {
  const { active, setActive, focusProps } = useActiveIndex(starts.length);
  const x0 = M.left;
  const x1 = width - M.right;
  const y0 = height - M.bottom;
  const y1 = M.top;

  const { y, layers, totals } = useMemo(() => {
    const rows = starts.map((_, i) => Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? 0])));
    const stack = d3
      .stack<Record<string, number>>()
      .keys(series.map((s) => s.key))
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);
    const layers = stack(rows);
    const totals = rows.map((r) => series.reduce((sum, s) => sum + (r[s.key] ?? 0), 0));
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(1, d3.max(totals) ?? 1)])
      .nice(4)
      .range([y0, y1]);
    return { y, layers, totals };
  }, [starts, series, y0, y1]);

  // One band per column, the column capped at 24px with the rest as air.
  const band = starts.length ? (x1 - x0) / starts.length : 0;
  const colW = Math.min(BAR_MAX, Math.max(2, band - GAP * 4));
  const centerOf = (i: number) => x0 + band * (i + 0.5);

  const ticks = useMemo((): Tick[] => {
    if (band <= 0) return [];
    const centerOf = (i: number) => x0 + band * (i + 0.5);
    if (months === 1) {
      // A label every k columns so labels keep ~64px apart; months, with the year on the
      // first label and on every January.
      const every = Math.max(1, Math.ceil(64 / band));
      return starts
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => i % every === 0)
        .map(({ t, i }) => {
          const d = toDate(t);
          return { pos: centerOf(i), label: i === 0 || d.getUTCMonth() === 0 ? fmtMonthYear(d) : fmtMonth(d) };
        });
    }
    // Quarters and halves: a year label on each January column, thinned to keep 48px apart.
    // The first column gets its own "Jul 2017" only when it clears the first year label, so
    // the years (the labels a reader orients by) are never the ones dropped.
    const out: Tick[] = [];
    starts.forEach((t, i) => {
      if (months < 12 && toDate(t).getUTCMonth() !== 0) return;
      if (!out.length || centerOf(i) - out[out.length - 1]!.pos >= 48) out.push({ pos: centerOf(i), label: fmtYear(toDate(t)) });
    });
    const first = toDate(starts[0]!);
    if (months < 12 && first.getUTCMonth() !== 0 && (!out.length || out[0]!.pos - centerOf(0) >= 64)) {
      out.unshift({ pos: centerOf(0), label: fmtMonthYear(first) });
    }
    return out;
  }, [band, months, starts, x0]);

  const px = active !== null ? centerOf(active) : 0;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}, one column per ${spanWord(months)}. Arrow keys step through columns.`}
        className="block overflow-visible outline-offset-4"
        {...focusProps}
        onPointerMove={(e) => {
          const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const i = Math.floor((mx - x0) / band);
          setActive(i >= 0 && i < starts.length ? i : null);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <YGrid ticks={y.ticks(4).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        <g>
          {starts.map((_, i) => {
            const cx = centerOf(i) - colW / 2;
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
        <XAxis ticks={ticks} y={y0} x0={x0} x1={x1} anchorEnds={false} />
      </svg>
      <ChartTooltip
        width={width}
        height={height}
        tip={
          active !== null
            ? {
                x: px,
                y: y1 + 8,
                title: `${spanTitle(starts[active]!, months)} · ${formatInt(totals[active] ?? 0)} ${unit}`,
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
