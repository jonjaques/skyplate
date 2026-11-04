/**
 * Commit activity tray: total commits with the period, then columns over the whole history
 * with a time axis. Weeks fold into wider columns (2, 4, 13 weeks…) when a long history would
 * make them thinner than 3px, so every column stays a readable mark with its 2px gap.
 *
 * The tray is also a handle on the history scrubber: store.time draws as a cursor, columns
 * after it fade to gray (the galaxy hides those files), and clicking a column moves the
 * scrubber to the end of that span. Enter does the same from the keyboard; Escape returns
 * to HEAD.
 */

import * as d3 from "d3";
import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui/button";
import { formatDate, formatInt, formatMonth, plural } from "../../lib/format";
import { useViewer } from "../../state/store";
import { columns, hasHistory, noCommitsReason, scopeCommits, weekly, weeksLabel } from "../data";
import { XAxis } from "../kit/Axis";
import { timeTicks, toDate, useActiveIndex } from "../kit/interaction";
import { columnPath } from "../kit/marks";
import { measureColor, mutedColor, useSurface } from "../kit/theme";
import { ChartTooltip } from "../kit/Tooltip";
import { useMeasure } from "../kit/useMeasure";
import { Headline, TrayEmpty, TrayShell, useTrayScope } from "./shared";

const AXIS = 18;

export function ActivityTray() {
  const { report, scope, dirPath } = useTrayScope();
  const time = useViewer((s) => s.time);
  const setTime = useViewer((s) => s.setTime);
  const narrowedByFilters = useViewer((s) => !!s.filters.languages || !!s.filters.categories);
  const surface = useSurface();
  const [ref, width, height] = useMeasure<HTMLDivElement>();
  const git = report?.git;

  const weeks = useMemo(() => {
    if (!git || !scope || !report || !hasHistory(report)) return null;
    const commits = scopeCommits(git, scope, null);
    return { list: weekly(git, commits, null), total: commits.length };
  }, [git, scope, report]);

  const layout = useMemo(() => (weeks && width > 0 ? columns(weeks.list, width) : null), [weeks, width]);
  const cols = layout?.cols ?? [];
  const { active, setActive, focusProps } = useActiveIndex(cols.length, (i) => pick(i));

  if (!report) return <TrayShell title="Commit activity" />;
  if (!git) {
    return (
      <TrayShell title="Commit activity">
        <TrayEmpty>No history: this report was generated without git, so there is no activity to chart.</TrayEmpty>
      </TrayShell>
    );
  }
  if (!weeks) {
    const n = git.commits.time.length;
    return (
      <TrayShell title="Commit activity" aside={plural(n, "commit")}>
        <TrayEmpty>
          {n === 1 ? "One commit" : `${formatInt(n)} commits`} in this history{git.shallow ? ", a shallow clone" : ""}, on{" "}
          {formatDate(git.last)}. Activity needs a longer history; re-run on a full clone to see it.
        </TrayEmpty>
      </TrayShell>
    );
  }

  // A drawer no commit touches drew a row of zero-height columns under "0 commits": say why.
  if (weeks.total === 0) {
    return (
      <TrayShell title="Commit activity" label={dirPath ? `Commit activity in ${dirPath}` : undefined}>
        <TrayEmpty>
          {noCommitsReason(git, null, "", dirPath && !narrowedByFilters ? `the files in ${dirPath}` : "the files in view", narrowedByFilters ? "widen the filters" : "close the drawer")}
        </TrayEmpty>
      </TrayShell>
    );
  }

  function pick(i: number) {
    const col = cols[i];
    if (!col || !git) return;
    // The last column ends at HEAD, which is what "no scrubber" already means.
    setTime(col.end > git.last ? null : col.end);
  }

  function columnAt(e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): number | null {
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.floor(mx / band);
    return i >= 0 && i < cols.length ? i : null;
  }

  const plotH = Math.max(40, height - AXIS);
  const band = cols.length ? width / cols.length : 0;
  const colW = Math.min(24, Math.max(1, band - 2));
  const max = Math.max(1, ...cols.map((c) => c.commits));
  // The busiest column carries its value on its cap ("label the extreme"), so the one
  // magnitude a reader asks of this tray is readable without hovering. The plot keeps 14px
  // of headroom for it.
  const peak = cols.findIndex((c) => c.commits === max);
  const y = d3.scaleLinear().domain([0, max]).range([plotH, 14]);
  const t0 = cols[0]?.start ?? git.first;
  const t1 = cols[cols.length - 1]?.end ?? git.last;
  const x = d3.scaleUtc().domain([toDate(t0), toDate(t1)]).range([0, width]);
  const cursor = time !== null ? x(toDate(Math.min(t1, Math.max(t0, time)))) : null;
  const span = layout?.weeksPer ?? 1;
  const label = dirPath ? `Commit activity in ${dirPath}` : "Commit activity";

  const activeCol = active !== null ? cols[active] : undefined;
  const tip = activeCol
    ? {
        x: (active! + 0.5) * band,
        y: Math.max(0, y(activeCol.commits) - 30),
        title: span === 1 ? `Week of ${formatDate(activeCol.start)}` : `${formatDate(activeCol.start)} – ${formatDate(activeCol.end - 86_400)}`,
        rows: [{ value: formatInt(activeCol.commits), label: activeCol.commits === 1 ? "commit" : "commits" }],
      }
    : null;

  return (
    <TrayShell
      title="Commit activity"
      label={label}
      open={{ section: "history", label: "Open Commits per week in Charts, with a table of every week" }}
      aside={
        time !== null ? (
          <Button variant="ghost" size="xs" className="-my-1 font-sans text-ink-2" onClick={() => setTime(null)}>
            <RotateCcw aria-hidden />
            Back to HEAD
          </Button>
        ) : (
          `per ${weeksLabel(span)}`
        )
      }
    >
      <Headline
        value={formatInt(weeks.total)}
        caption={`${weeks.total === 1 ? "commit" : "commits"} since ${formatMonth(git.first)}${git.truncated ? " (capped)" : ""}`}
        scope={dirPath ? `in ${dirPath}` : undefined}
      />
      <div ref={ref} className="relative mt-2 min-h-0 flex-1">
        {width > 0 && height > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}, ${formatInt(weeks.total)} commits, one column per ${weeksLabel(span)}. Arrow keys step through columns, Enter moves the history scrubber there.`}
            className="absolute inset-0 block cursor-pointer overflow-visible outline-offset-2"
            {...focusProps}
            onKeyDown={(e) => {
              // Escape lets go of the active column and also returns the scrubber to HEAD,
              // the keyboard twin of the "Back to HEAD" button.
              if (e.key === "Escape" && time !== null) setTime(null);
              focusProps.onKeyDown(e);
            }}
            onPointerMove={(e) => setActive(columnAt(e))}
            onPointerLeave={() => setActive(null)}
            // Hit-test the click itself rather than trusting the last pointermove: a click
            // can arrive before the render that recorded the hover (touch has no hover at all).
            onClick={(e) => {
              const i = columnAt(e);
              if (i !== null) pick(i);
            }}
          >
            {cols.map((c, i) => {
              const after = time !== null && c.start >= time;
              return (
                <path
                  key={c.start}
                  d={columnPath(i * band + (band - colW) / 2, colW, plotH, y(c.commits), Math.min(4, colW / 2))}
                  fill={after ? mutedColor(surface) : measureColor(surface)}
                  opacity={active === null || active === i ? 1 : 0.6}
                />
              );
            })}
            {peak >= 0 && cols[peak]!.commits > 0 && (
              <text
                aria-hidden
                x={Math.min(width - 2, Math.max(2, (peak + 0.5) * band))}
                y={y(max) - 4}
                textAnchor={(peak + 0.5) * band < 12 ? "start" : (peak + 0.5) * band > width - 12 ? "end" : "middle"}
                className="figures pointer-events-none fill-ink-2 font-mono text-[10px]"
              >
                {formatInt(max)}
              </text>
            )}
            {cursor !== null && (
              <line aria-hidden x1={cursor} x2={cursor} y1={0} y2={plotH} className="stroke-ink" strokeWidth={1.5} />
            )}
            {/* The domain runs to the end of the last column's week, which is after HEAD on a fresh
                report; a tick out there labeled a date (Nov 9) after the newest commit (Nov 4). */}
            <XAxis ticks={timeTicks(x, width).filter((t) => t.pos <= x(toDate(git.last)) + 0.5)} y={plotH} x0={0} x1={width} />
          </svg>
        )}
        <ChartTooltip tip={tip} width={width} height={height} />
      </div>
    </TrayShell>
  );
}

