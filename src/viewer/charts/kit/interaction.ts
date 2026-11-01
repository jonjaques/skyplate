/**
 * One active mark per chart, driven by pointer and keyboard alike, so a keyboard reader gets
 * the same tooltip as a pointer reader (tooltips enhance, never gate).
 *
 * A dense plot (300 weekly columns, 2,000 scatter points) is one tab stop, not hundreds: the
 * plot takes focus and the arrow keys walk its marks. Enter acts on the active mark (select a
 * file, set the history time); Escape lets go.
 */

import { useCallback, useState, type KeyboardEvent } from "react";
import * as d3 from "d3";

export function useActiveIndex(count: number, onActivate?: (index: number) => void) {
  const [active, setActive] = useState<number | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (count === 0) return;
      const step = e.shiftKey ? 10 : 1;
      let next: number | null = active;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = active === null ? 0 : Math.min(count - 1, active + step);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = active === null ? count - 1 : Math.max(0, active - step);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = count - 1;
          break;
        case "Enter":
        case " ":
          if (active !== null && onActivate) {
            e.preventDefault();
            onActivate(active);
          }
          return;
        case "Escape":
          next = null;
          break;
        default:
          return;
      }
      e.preventDefault();
      setActive(next);
    },
    [active, count, onActivate],
  );

  const focusProps = {
    tabIndex: 0,
    onKeyDown,
    // Only keyboard focus lands on the first mark. A click also focuses the plot, and
    // treating that as "the reader tabbed here" would pin a tooltip under the pointer.
    onFocus: (e: FocusEvent) => {
      if (e.currentTarget.matches(":focus-visible")) setActive((a) => (a === null ? 0 : a));
    },
    onBlur: () => setActive(null),
  };
  return { active, setActive, focusProps };
}

const fmtYear = d3.utcFormat("%Y");
const fmtMonthYear = d3.utcFormat("%b %Y");
const fmtMonth = d3.utcFormat("%b");
const fmtDay = d3.utcFormat("%b %-d");

/**
 * Time ticks sized to the plot: about one label per 90px, formatted for the span (years for
 * long histories, months for a season, days for a few weeks). Times are unix seconds.
 */
export function timeTicks(
  scale: d3.ScaleTime<number, number>,
  width: number,
  /** Monthly data never gets day ticks: a label of "Aug 2" would claim a precision it lacks. */
  unit: "auto" | "month" = "auto",
): { pos: number; label: string }[] {
  const [a, b] = scale.domain() as [Date, Date];
  const spanDays = Math.max(1, (b.getTime() - a.getTime()) / 86_400_000);
  // Steps are chosen so labels keep ~56px apart (a year or a short month name is ~28px), and
  // they land on calendar multiples, so "2022, 2024, 2026" rather than arbitrary years.
  const perDay = width / spanDays;
  let ticks: Date[];
  let fmt: (d: Date) => string;
  if (unit === "auto" && spanDays > 365 * 3) {
    const step = [1, 2, 5, 10, 20].find((s) => perDay * 365 * s >= 56) ?? 50;
    ticks = scale.ticks(d3.utcYear.every(step)!);
    fmt = fmtYear;
  } else if (unit === "month" || spanDays > 120) {
    const step = [1, 2, 3, 6, 12].find((s) => perDay * 30.4 * s >= 64) ?? 24;
    ticks = scale.ticks(d3.utcMonth.every(step)!);
    fmt = (d) => (d.getUTCMonth() === 0 || d === ticks[0] ? fmtMonthYear(d) : fmtMonth(d));
  } else {
    ticks = scale.ticks(Math.max(2, Math.min(6, Math.floor(width / 72))));
    fmt = fmtDay;
  }
  return ticks.map((d) => ({ pos: scale(d), label: fmt(d) }));
}

export const toDate = (unix: number) => new Date(unix * 1000);
