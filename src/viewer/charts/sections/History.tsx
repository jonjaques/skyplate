/**
 * History: how the project changed. Weekly commits, net growth, lines added by language, the
 * weekday × hour punchcard, and conventional-commit types.
 *
 * The time range narrows everything computed from the commit table. Growth, the language
 * series and the punchcard were aggregated by the analyzer over all files (the punchcard in
 * each author's own time zone, which the commit table does not keep), so a file filter cannot
 * narrow them; their subtitles say so rather than presenting unfiltered numbers as filtered.
 */

import { useMemo } from "react";
import { formatDate, formatInt, formatMonth, plural } from "../../lib/format";
import { commitTypes, monthBuckets, sum, weekly } from "../data";
import { BarList, type BarItem } from "../kit/BarList";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Legend } from "../kit/Legend";
import { rampColor, rampT, ScaleLegend } from "../kit/ScaleLegend";
import { COLUMNS_UP_TO, spanWord, StackedColumns, type StackSeries } from "../kit/StackedColumns";
import { measureColor, slotColor, surfaceColor } from "../kit/theme";
import { TimeSeries } from "../kit/TimeSeries";
import { ChartTooltip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, SectionNote, span } from "../Section";
import { formatShare } from "../kit/marks";

export function HistorySection() {
  const { report, history } = useScope();
  if (!history) {
    const n = report.git?.commits.time.length ?? 0;
    return (
      <Section id="history" title="History">
        <SectionNote>
          {!report.git
            ? "No history: this report was generated without git. Run starchart inside a git checkout to chart commits, growth and activity."
            : `Only ${plural(n, "commit")} in this history${report.git.shallow ? " (a shallow clone)" : ""}, so there is no change over time to chart. Re-run on a full clone to see it.`}
        </SectionNote>
      </Section>
    );
  }
  const git = report.git!;
  return (
    <Section
      id="history"
      title="History"
      note={`${formatMonth(git.first)} to ${formatMonth(git.last)} · ${plural(git.analyzedCommits, "commit")} analyzed${git.truncated ? ` of ${formatInt(git.totalCommits)}` : ""}${git.shallow ? " · shallow clone" : ""}`}
    >
      <WeeklyCommits />
      <LanguageChurn />
      <Growth />
      <Punchcard />
      <CommitTypes />
    </Section>
  );
}

function WeeklyCommits() {
  const { report, commits, from, surface, rangePhrase, files } = useScope();
  const git = report.git!;
  const weeks = useMemo(() => weekly(git, commits!, from), [git, commits, from]);
  const total = commits!.length;
  const busiest = weeks.reduce((best, w) => (w.commits > best.commits ? w : best), weeks[0]!);
  return (
    <Figure
      className={span(12)}
      title="Commits per week"
      subtitle={`${plural(total, "commit")} ${rangePhrase || "over the whole history"}${files.selective ? " that touch files in view" : ""}; the busiest week, ${formatDate(busiest.start)}, had ${formatInt(busiest.commits)}`}
      height={220}
      empty={total === 0 ? `No commits ${rangePhrase || "in this history"} touch the files in view. Widen the range or the filters.` : null}
      table={() => ({
        columns: [{ label: "Week of", mono: true }, { label: "Commits", align: "right", mono: true }, { label: "Authors", align: "right", mono: true }, { label: "Lines added", align: "right", mono: true }, { label: "Lines deleted", align: "right", mono: true }],
        rows: weeks.filter((w) => w.commits > 0).map((w) => [{ text: formatDate(w.start), sort: w.start }, w.commits, w.authors, w.added, w.deleted]),
      })}
    >
      {(width) => (
        <TimeSeries
          points={weeks.map((w) => ({ t: w.start, v: w.commits }))}
          width={width}
          height={220}
          color={measureColor(surface)}
          ring={surfaceColor(surface)}
          label="Commits per week"
          valueLabel="commits"
          titleFor={(i) => `Week of ${formatDate(weeks[i]!.start)}`}
          tipRows={(i) => [
            { value: formatInt(weeks[i]!.authors), label: weeks[i]!.authors === 1 ? "author" : "authors" },
            { value: `+${formatInt(weeks[i]!.added)} −${formatInt(weeks[i]!.deleted)}`, label: "lines" },
          ]}
        />
      )}
    </Figure>
  );
}

function Growth() {
  const { report, from, surface, files } = useScope();
  const points = useMemo(() => report.git!.growth.filter((g) => from === null || g.start >= from - 7 * 86_400), [report, from]);
  const last = points[points.length - 1];
  return (
    <Figure
      className={span(4)}
      title="Growth"
      subtitle={`Net lines (added minus deleted) over time, all files${files.selective ? "; not narrowed by the filters" : ""}`}
      height={220}
      empty={points.length < 2 ? "Too few weeks in this range to draw growth. Widen the range." : null}
      table={() => ({
        columns: [{ label: "Week of", mono: true }, { label: "Net lines", align: "right", mono: true }, { label: "Files", align: "right", mono: true }],
        rows: points.map((p) => [{ text: formatDate(p.start), sort: p.start }, p.lines, p.files]),
      })}
    >
      {(width) => (
        <>
          <TimeSeries
            points={points.map((p) => ({ t: p.start, v: p.lines }))}
            width={width}
            height={196}
            color={measureColor(surface)}
            ring={surfaceColor(surface)}
            label="Net lines over time"
            valueLabel="net lines"
            titleFor={(i) => `Week of ${formatDate(points[i]!.start)}`}
            tipRows={(i) => [{ value: formatInt(points[i]!.files), label: "files" }]}
          />
          {last && (
            <p className="mt-1 text-xs text-ink-2">
              Now <span className="figures font-mono text-ink">{formatInt(last.lines)}</span> net lines in{" "}
              <span className="figures font-mono text-ink">{formatInt(last.files)}</span> files
            </p>
          )}
        </>
      )}
    </Figure>
  );
}

function LanguageChurn() {
  const { report, model, from, surface, filters } = useScope();
  const churn = report.git!.languageChurn;
  const { times, series } = useMemo(() => {
    // Keep a month when any of it falls inside the range: it ends (the next month starts)
    // after `from`. Keeping months that merely start near `from` let a whole month from before
    // the range into "the last 30 days".
    const idx = churn.months
      .map((m, i) => [m, i] as const)
      .filter(([, i]) => from === null || (churn.months[i + 1] ?? Infinity) > from);
    const times = idx.map(([m]) => m);
    const slots: StackSeries[] = [];
    const other = new Array<number>(idx.length).fill(0);
    let otherCount = 0;
    const bySlot = new Map<number, { names: string[]; values: number[] }>();
    for (const [lang, values] of Object.entries(churn.series)) {
      if (filters.languages && !filters.languages.has(lang)) continue;
      const slot = model.languageSlot.get(lang) ?? -1;
      const picked = idx.map(([, i]) => values[i] ?? 0);
      if (sum(picked) === 0) continue;
      if (slot < 0 || slot > 6) {
        otherCount++;
        for (let k = 0; k < picked.length; k++) other[k]! += picked[k]!;
        continue;
      }
      const entry = bySlot.get(slot) ?? { names: [], values: new Array<number>(idx.length).fill(0) };
      entry.names.push(model.languages.get(lang)?.name ?? lang);
      for (let k = 0; k < picked.length; k++) entry.values[k]! += picked[k]!;
      bySlot.set(slot, entry);
    }
    for (let slot = 0; slot < 7; slot++) {
      const e = bySlot.get(slot);
      if (e) slots.push({ key: `s${slot}`, label: e.names.join(", "), color: slotColor(slot, surface), values: e.values });
    }
    if (otherCount) slots.push({ key: "other", label: `${otherCount} other${otherCount === 1 ? "" : "s"}`, color: slotColor(-1, surface), values: other });
    return { times, series: slots };
  }, [churn, from, filters.languages, model, surface]);

  // Columns over calendar spans: months up to two years, then quarters, halves or years.
  // The table view keeps the monthly figures.
  const columns = useMemo(() => {
    const { step, buckets } = monthBuckets(times, COLUMNS_UP_TO);
    return {
      step,
      starts: buckets.map((b) => b.start),
      series: series.map((s) => ({ ...s, values: buckets.map((b) => sum(s.values.slice(b.from, b.to))) })),
    };
  }, [times, series]);

  return (
    <Figure
      className={span(8)}
      title="Lines added by language"
      subtitle={`Per ${spanWord(columns.step)}, stacked; the seven palette languages and the rest as Other${filters.languages ? ", only the chosen languages" : ""}`}
      height={240}
      empty={times.length < 2 || series.length === 0 ? "Fewer than two months of history in this range, so there is no trend to stack. Widen the range." : null}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      table={() => ({
        columns: [{ label: "Month", mono: true }, ...series.map((s) => ({ label: s.label, align: "right" as const, mono: true }))],
        rows: times.map((t, i) => [{ text: formatMonth(t), sort: t }, ...series.map((s) => s.values[i] ?? 0)]),
      })}
    >
      {(width) => (
        <StackedColumns starts={columns.starts} months={columns.step} series={columns.series} width={width} height={240} label="Lines added by language" unit="lines added" />
      )}
    </Figure>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Punchcard() {
  const { report, surface, files, from } = useScope();
  const grid = report.git!.punchcard;
  const cells = useMemo(() => grid.flatMap((row, d) => row.map((n, h) => ({ d, h, n }))), [grid]);
  const max = Math.max(1, ...cells.map((c) => c.n));
  const lo = Math.min(max, ...cells.filter((c) => c.n > 0).map((c) => c.n));
  const total = sum(cells.map((c) => c.n));
  const peak = cells.reduce((a, b) => (b.n > a.n ? b : a), cells[0]!);
  const narrowedNote = files.selective || from !== null ? "; covers all history and files" : "";
  const { active, setActive, focusProps } = useActiveIndex(cells.length);

  return (
    <Figure
      className={span(6)}
      title="When commits happen"
      subtitle={`Weekday and hour in each author's own time zone${narrowedNote}; busiest: ${WEEKDAYS[peak.d]}s at ${String(peak.h).padStart(2, "0")}:00`}
      height={220}
      empty={total === 0 ? "No commit times recorded." : null}
      legend={<ScaleLegend low={formatInt(lo)} high={formatInt(max)} label="Commits" surface={surface} />}
      // Transposed from the chart: hours down, weekdays across. Twenty-four hour columns would
      // leave every cell a truncated "2…" in a half-width tray; seven weekday columns fit.
      table={() => ({
        columns: [{ label: "Hour", mono: true }, ...WEEKDAYS.map((d) => ({ label: d.slice(0, 3), align: "right" as const, mono: true })), { label: "All days", align: "right", mono: true }],
        rows: Array.from({ length: 24 }, (_, h) => [
          { text: `${String(h).padStart(2, "0")}:00`, sort: h },
          ...grid.map((row) => row[h] ?? 0),
          sum(grid.map((row) => row[h] ?? 0)),
        ]),
      })}
    >
      {(width) => {
        const LABEL = 34;
        const cw = Math.max(6, (width - LABEL) / 24);
        const ch = Math.min(24, Math.max(10, cw));
        const height = 7 * ch + 18;
        const cell = active !== null ? cells[active] : undefined;
        return (
          <div className="relative">
            <svg
              width={width}
              height={height}
              role="img"
              aria-label="Commits by weekday and hour"
              className="block outline-offset-4"
              {...focusProps}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const h = Math.floor((e.clientX - r.left - LABEL) / cw);
                const d = Math.floor((e.clientY - r.top) / ch);
                setActive(h >= 0 && h < 24 && d >= 0 && d < 7 ? d * 24 + h : null);
              }}
              onPointerLeave={() => setActive(null)}
            >
              {WEEKDAYS.map((name, d) => (
                <text key={name} x={0} y={d * ch + ch / 2} dy="0.32em" className="fill-ink-3 text-[10px]">
                  {name.slice(0, 3)}
                </text>
              ))}
              {cells.map((c, i) => (
                <rect
                  key={i}
                  x={LABEL + c.h * cw + 1}
                  y={c.d * ch + 1}
                  width={cw - 2}
                  height={ch - 2}
                  rx={2}
                  fill={c.n > 0 ? rampColor(rampT(c.n, lo, max), surface) : undefined}
                  className={c.n > 0 ? undefined : "fill-wash"}
                  style={active === i ? { stroke: "var(--color-ink)", strokeWidth: 1.5 } : undefined}
                />
              ))}
              {[0, 6, 12, 18, 23].map((h) => (
                <text key={h} x={LABEL + h * cw + cw / 2} y={7 * ch + 13} textAnchor="middle" className="figures fill-ink-3 font-mono text-[10px]">
                  {String(h).padStart(2, "0")}
                </text>
              ))}
            </svg>
            <ChartTooltip
              width={width}
              tip={
                cell
                  ? {
                      x: LABEL + cell.h * cw + cw / 2,
                      y: cell.d * ch - 4,
                      title: `${WEEKDAYS[cell.d]}s, ${String(cell.h).padStart(2, "0")}:00–${String(cell.h).padStart(2, "0")}:59`,
                      rows: [{ value: formatInt(cell.n), label: cell.n === 1 ? "commit" : "commits" }, { value: formatShare(cell.n / total), label: "of all commits" }],
                    }
                  : null
              }
            />
          </div>
        );
      }}
    </Figure>
  );
}

function CommitTypes() {
  const { report, commits, surface, rangePhrase } = useScope();
  const types = useMemo(() => commitTypes(report.git!, commits!), [report, commits]);
  const total = commits!.length;
  const untyped = types.find((t) => t.type === "")?.commits ?? 0;
  const typed = types.filter((t) => t.type !== "");
  const typedTotal = total - untyped;
  const shown = typed.slice(0, 10);
  const rest = typed.slice(10);
  const items: BarItem[] = shown.map((t) => ({
    key: t.type,
    label: t.type,
    mono: true,
    value: t.commits,
    valueText: formatInt(t.commits),
    color: measureColor(surface),
    tip: [{ value: formatShare(t.commits / typedTotal), label: "of typed commits" }],
  }));
  if (rest.length) {
    const n = sum(rest.map((t) => t.commits));
    items.push({ key: "rest", label: `${rest.length} more types`, value: n, valueText: formatInt(n), color: slotColor(-1, surface), rest: true, tip: rest.slice(0, 5).map((t) => ({ value: formatInt(t.commits), label: t.type })) });
  }
  const sparse = typedTotal < 20 || typedTotal / Math.max(1, total) < 0.05;
  return (
    <Figure
      className={span(6)}
      title="Commit types"
      subtitle={
        untyped > 0
          ? `Conventional-commit prefixes (feat:, fix:…); ${formatInt(untyped)} of ${formatInt(total)} commits (${formatShare(untyped / Math.max(1, total))}) have none and are left out`
          : `Conventional-commit prefixes (feat:, fix:…) on ${plural(total, "commit")} ${rangePhrase}`
      }
      height={items.length * 28}
      empty={
        total === 0
          ? `No commits ${rangePhrase || "here"} touch the files in view.`
          : sparse
            ? `Few commits ${rangePhrase || "in this history"} use conventional prefixes (feat:, fix:…), so there is no breakdown to draw.`
            : null
      }
      table={() => ({
        columns: [{ label: "Type", mono: true }, { label: "Commits", align: "right", mono: true }, { label: "Share", align: "right", mono: true }],
        rows: types.map((t) => [t.type || "(no prefix)", t.commits, { text: formatShare(t.commits / Math.max(1, total)), sort: t.commits }]),
      })}
    >
      {() => <BarList items={items} label="Commits by conventional type" labelWidth="26%" />}
    </Figure>
  );
}
