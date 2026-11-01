/**
 * Risk: where change is dangerous. The hotspot scatter (commits against complexity, the two
 * inputs of the hotspot score), the complexity distribution, the largest and most complex
 * files, and the files carrying the most TODO markers.
 */

import * as d3 from "d3";
import { memo, useMemo, useState } from "react";
import type { FileRecord } from "../../../shared/schema";
import { baseName, formatInt, plural } from "../../lib/format";
import { useHover, useViewer, type Target } from "../../state/store";
import { hasHistory, isOwnCode, log2Dist, MIN_HISTORY } from "../data";
import { AxisTitle, XAxis, XGrid, YGrid } from "../kit/Axis";
import { BarList, type BarItem } from "../kit/BarList";
import { DataTable, type Column } from "../kit/DataTable";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { placeLabels } from "../kit/labels";
import { Legend } from "../kit/Legend";
import { Log2Histogram } from "../kit/Log2Histogram";
import { tickNumber, formatShare } from "../kit/marks";
import { emphasisColor, measureColor, mutedColor, surfaceColor } from "../kit/theme";
import { PathText } from "../kit/PathText";
import { ChartTooltip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, span } from "../Section";

export function RiskSection() {
  return (
    <Section id="risk" title="Risk">
      <HotspotScatter />
      <ComplexityDistribution />
      <LargestFiles />
      <TodoDense />
    </Section>
  );
}

// ─── Hotspot scatter ─────────────────────────────────────────────────────────────────────────

const SCATTER_H = 360;
const TOP_N = 10;
const M = { top: 12, right: 16, bottom: 34, left: 44 };

interface Pt {
  f: FileRecord;
  x: number;
  y: number;
  r: number;
  top: boolean;
}

/** Log ticks at 1, 10, 100…, plus 2 and 5 when the domain spans under two decades. */
function logTicks(scale: d3.ScaleLogarithmic<number, number>): number[] {
  const [lo, hi] = scale.domain() as [number, number];
  const decades = Math.log10(hi / lo);
  return scale.ticks().filter((t) => {
    const lead = t / 10 ** Math.floor(Math.log10(t) + 1e-9);
    return Math.abs(lead - 1) < 1e-6 || (decades < 2 && (Math.abs(lead - 2) < 1e-6 || Math.abs(lead - 5) < 1e-6));
  });
}

interface ScatterMode {
  xOf: (f: FileRecord) => number;
  xTitle: string;
  /** Higher is more important: picks the emphasized dots, the labels and the keyboard order. */
  score: (f: FileRecord) => number;
  tip: (f: FileRecord) => { value: string; label: string }[];
}

const HOTSPOT_MODE: ScatterMode = {
  xOf: (f) => f.git?.commits ?? 0,
  xTitle: "Commits (log scale)",
  score: (f) => f.hotspot,
  tip: (f) => [
    { value: formatInt(f.git!.commits), label: "commits" },
    { value: formatInt(f.complexity), label: "complexity" },
    { value: formatInt(f.lines), label: "lines" },
    { value: f.hotspot.toFixed(2), label: "hotspot score" },
  ],
};

/** Without history there is no churn axis; size is the other thing that makes a file risky to touch. */
const SIZE_MODE: ScatterMode = {
  xOf: (f) => f.code,
  xTitle: "Code lines (log scale)",
  score: (f) => f.complexity,
  tip: (f) => [
    { value: formatInt(f.complexity), label: "complexity" },
    { value: formatInt(f.code), label: "code lines" },
    { value: formatInt(f.functions), label: "functions" },
  ],
};

function HotspotScatter() {
  const { report, files, surface } = useScope();
  const history = hasHistory(report) && (report.git?.analyzedCommits ?? 0) >= MIN_HISTORY;
  const mode = history ? HOTSPOT_MODE : SIZE_MODE;
  const candidates = useMemo(
    () =>
      files.ids
        .map((id) => report.files[id]!)
        .filter((f) => (history ? (f.git?.commits ?? 0) >= 1 : isOwnCode(f) && f.code >= 1) && f.complexity >= 1),
    [report, files, history],
  );
  const topIds = useMemo(
    () =>
      new Set(
        [...candidates]
          .filter((f) => mode.score(f) > 0)
          .sort((a, b) => mode.score(b) - mode.score(a) || a.id - b.id)
          .slice(0, TOP_N)
          .map((f) => f.id),
      ),
    [candidates, mode],
  );
  const why = !report.git
    ? "No history in this report, so no hotspots (they need churn × complexity)."
    : `Under ${MIN_HISTORY} commits of history, too few for hotspots.`;
  const n = Math.min(TOP_N, topIds.size);

  return (
    <Figure
      className={span(8)}
      title={history ? "Hotspots: change against complexity" : "Complexity against size"}
      subtitle={
        history
          ? `Each dot is a file; up and to the right is both complex and often changed. The ${n} highest hotspot scores are in ink.`
          : `${why} Instead, each source file's complexity against its size; the ${n} most complex are in ink.`
      }
      height={SCATTER_H}
      empty={candidates.length === 0 ? (history ? "No files in view have both commits and measurable complexity. Widen the filters." : `${why} No source files in view have measurable complexity either.`) : null}
      legend={
        <Legend
          items={[
            { label: history ? `Top ${n} hotspots` : `${n} most complex`, color: emphasisColor(surface), key: "dot" },
            { label: "Other files", color: mutedColor(surface), key: "dot" },
            { label: "Dot area is lines", color: mutedColor(surface), key: "ring" },
          ]}
        />
      }
      table={() => ({
        columns: history
          ? [{ label: "File", mono: true, width: "46%" }, { label: "Commits", align: "right", mono: true }, { label: "Complexity", align: "right", mono: true }, { label: "Lines", align: "right", mono: true }, { label: "Hotspot", align: "right", mono: true }]
          : [{ label: "File", mono: true, width: "52%" }, { label: "Code lines", align: "right", mono: true }, { label: "Complexity", align: "right", mono: true }, { label: "Functions", align: "right", mono: true }],
        rows: [...candidates]
          .sort((a, b) => mode.score(b) - mode.score(a))
          .map((f) =>
            history
              ? [f.path, f.git!.commits, f.complexity, f.lines, { text: f.hotspot.toFixed(2), sort: f.hotspot }]
              : [f.path, f.code, f.complexity, f.functions],
          ),
      })}
    >
      {(width) => <Scatter files={candidates} topIds={topIds} width={width} surface={surface} mode={mode} />}
    </Figure>
  );
}

function Scatter({
  files,
  topIds,
  width,
  surface,
  mode,
}: {
  files: FileRecord[];
  topIds: Set<number>;
  width: number;
  surface: "light" | "dark";
  mode: ScatterMode;
}) {
  const setHover = useHover((s) => s.setHover);
  const hover = useHover((s) => s.hover);
  const selection = useViewer((s) => s.selection);
  const select = useViewer((s) => s.select);
  const x0 = M.left;
  const x1 = width - M.right;
  const y0 = SCATTER_H - M.bottom;
  const y1 = M.top;

  const { x, y, pts, delaunay, byScore, leaders, emphasized } = useMemo(() => {
    const maxC = Math.max(10, d3.max(files, mode.xOf) ?? 10);
    const maxX = Math.max(10, d3.max(files, (f) => f.complexity) ?? 10);
    const x = d3.scaleLog().domain([1, maxC]).nice().range([x0, x1]).clamp(true);
    const y = d3.scaleLog().domain([1, maxX]).nice().range([y0, y1]).clamp(true);
    const r = d3.scaleSqrt().domain([0, Math.max(1, d3.max(files, (f) => f.lines) ?? 1)]).range([4, 14]);
    const pts: Pt[] = files.map((f) => ({ f, x: x(Math.max(1, mode.xOf(f))), y: y(f.complexity), r: r(f.lines), top: topIds.has(f.id) }));
    // Gray first so the emphasized dots draw on top of the crowd.
    pts.sort((a, b) => Number(a.top) - Number(b.top) || b.r - a.r);
    const delaunay = d3.Delaunay.from(pts, (p) => p.x, (p) => p.y);
    const byScore = [...pts].sort((a, b) => mode.score(b.f) - mode.score(a.f));
    return { x, y, pts, delaunay, byScore, leaders: byScore.slice(0, 5), emphasized: pts.filter((p) => p.top) };
  }, [files, topIds, x0, x1, y0, y1, mode]);

  const { active, setActive, focusProps } = useActiveIndex(byScore.length, (i) => {
    const p = byScore[i];
    if (p) select({ kind: "file", id: p.f.id });
  });
  const [pointer, setPointer] = useState<Pt | null>(null);
  const current = active !== null ? byScore[active] ?? null : pointer;

  const lit = (t: Target | null) => (t?.kind === "file" ? pts.find((p) => p.f.id === t.id) : undefined);
  const hovered = lit(hover);
  const selected = lit(selection);

  return (
    <div className="relative">
      <svg
        width={width}
        height={SCATTER_H}
        role="img"
        aria-label={`Scatter of files: ${mode.xTitle.toLowerCase()} against complexity. Arrow keys step through files from the highest score; Enter selects.`}
        className="block outline-offset-4"
        {...focusProps}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const i = delaunay.find(mx, my);
          const p = pts[i];
          // Nearest point within reach: the pointer only has to be closest, not dead-center.
          if (p && Math.hypot(p.x - mx, p.y - my) < 32) {
            setPointer(p);
            setHover({ kind: "file", id: p.f.id });
          } else {
            setPointer(null);
            setHover(null);
          }
        }}
        onPointerLeave={() => {
          setPointer(null);
          setHover(null);
        }}
        onClick={() => pointer && select({ kind: "file", id: pointer.f.id })}
        style={{ cursor: pointer ? "pointer" : "default" }}
      >
        <XGrid ticks={logTicks(x).map((t) => ({ pos: x(t), label: tickNumber(t) }))} y0={y1} y1={y0} />
        <YGrid ticks={logTicks(y).map((t) => ({ pos: y(t), label: tickNumber(t) }))} x0={x0} x1={x1} />
        <XAxis ticks={logTicks(x).map((t) => ({ pos: x(t), label: tickNumber(t) }))} y={y0} x0={x0} x1={x1} anchorEnds={false} />
        <AxisTitle x={x1} y={SCATTER_H - 2} anchor="end">
          {mode.xTitle}
        </AxisTitle>
        <AxisTitle x={x0 - 34} y={y1 + 2} anchor="end" rotate>
          Complexity (log)
        </AxisTitle>
        <Points pts={pts} surface={surface} />
        <Labels pts={leaders} avoid={emphasized} bounds={{ x0, y0: y1, x1, y1: y0 }} />
        {[hovered, selected, current].map(
          (p, i) =>
            p && (
              <circle key={i} cx={p.x} cy={p.y} r={p.r + 3.5} fill="none" className="stroke-ink" strokeWidth={i === 1 ? 2 : 1.5} pointerEvents="none" />
            ),
        )}
      </svg>
      <ChartTooltip
        width={width}
        tip={current ? { x: current.x, y: Math.max(0, current.y - 24), title: current.f.path, path: true, rows: mode.tip(current.f) } : null}
      />
    </div>
  );
}

/**
 * The dots, memoized apart from hover so a pointer sweep never redraws them.
 *
 * The gray crowd is one <path> of circular subpaths rather than a <circle> per file: a large
 * report puts tens of thousands of files here, and that many DOM nodes makes the whole tab
 * stutter, while one path costs the same to the browser whatever the count. Every file still
 * gets its dot; hover and selection come from the Delaunay layer, not from the marks. The few
 * emphasized dots stay separate circles so their 2px surface ring sits above the crowd.
 */
const Points = memo(function Points({ pts, surface }: { pts: Pt[]; surface: "light" | "dark" }) {
  const ring = surfaceColor(surface);
  const ink = emphasisColor(surface);
  const gray = mutedColor(surface);
  const crowd = useMemo(() => {
    let d = "";
    for (const p of pts) {
      if (p.top) continue;
      const r = p.r;
      d += `M${(p.x - r).toFixed(1)},${p.y.toFixed(1)}a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(2 * r).toFixed(1)},0a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(-2 * r).toFixed(1)},0`;
    }
    return d;
  }, [pts]);
  return (
    <g aria-hidden>
      <path d={crowd} fill={gray} fillOpacity={0.7} stroke={ring} strokeWidth={1} />
      {pts
        .filter((p) => p.top)
        .map((p) => (
          <circle key={p.f.id} cx={p.x} cy={p.y} r={p.r} fill={ink} stroke={ring} strokeWidth={2} />
        ))}
    </g>
  );
});

/**
 * Direct labels for the five leading dots, placed clear of every emphasized dot and of each
 * other (kit/labels.ts); a label set away from its dot gets a hairline leader back to it.
 */
function Labels({ pts, avoid, bounds }: { pts: Pt[]; avoid: Pt[]; bounds: { x0: number; y0: number; x1: number; y1: number } }) {
  const placed = useMemo(
    () =>
      placeLabels(
        // 11px JetBrains Mono advances 0.6em per character.
        pts.map((p) => ({ key: p, x: p.x, y: p.y, r: p.r, w: baseName(p.f.path).length * 6.6 + 2, h: 13 })),
        avoid.map((p) => ({ x: p.x, y: p.y, r: p.r + 1 })),
        bounds,
      ),
    [pts, avoid, bounds.x0, bounds.y0, bounds.x1, bounds.y1],
  );
  return (
    <g aria-hidden pointerEvents="none">
      {placed.map(({ key: p, x, y, leader }) => (
        <g key={p.f.id}>
          {leader && <line x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} className="stroke-ink-3" strokeWidth={1} />}
          <text x={x + 1} y={y} dy="0.32em" className="fill-ink font-mono text-[11px]" style={{ paintOrder: "stroke", stroke: "var(--color-tray)", strokeWidth: 3 }}>
            {baseName(p.f.path)}
          </text>
        </g>
      ))}
    </g>
  );
}

// ─── Complexity distribution ─────────────────────────────────────────────────────────────────

function ComplexityDistribution() {
  const { report, files, surface } = useScope();
  const dist = useMemo(() => {
    if (!files.selective) {
      const s = report.stats.complexityPerFile;
      return { bins: s.log2Bins, median: s.median, p90: s.p90, count: s.count };
    }
    return log2Dist(files.ids.map((id) => report.files[id]!).filter(isOwnCode).map((f) => f.complexity));
  }, [report, files]);
  return (
    <Figure
      className={span(4)}
      title="Complexity per file"
      subtitle={`Decision points per source and test file, ${plural(dist.count, "file")}, on doubling bins`}
      height={SCATTER_H - 60}
      empty={dist.count === 0 ? "No source or test files in view, so there is no complexity to compare." : null}
      table={() => ({
        columns: [{ label: "Complexity", mono: true }, { label: "Files", align: "right", mono: true }],
        rows: dist.bins.map((c, i) => [{ text: i === 0 ? "0–1" : `${formatInt(2 ** i)}–${formatInt(2 ** (i + 1) - 1)}`, sort: i }, c]),
      })}
    >
      {(width) => (
        <Log2Histogram
          bins={dist.bins}
          width={width}
          height={SCATTER_H - 60}
          color={measureColor(surface)}
          unit="files"
          measure="complexity"
          markers={[
            { value: dist.median, label: `median ${formatInt(dist.median)}` },
            { value: dist.p90, label: `p90 ${formatInt(dist.p90)}` },
          ]}
        />
      )}
    </Figure>
  );
}

// ─── Largest and most complex files ──────────────────────────────────────────────────────────

function LargestFiles() {
  const { report, model, files } = useScope();
  const setHover = useHover((s) => s.setHover);
  const select = useViewer((s) => s.select);
  const selectedId = useViewer((s) => (s.selection?.kind === "file" ? s.selection.id : -1));
  const rows = useMemo(() => files.ids.map((id) => report.files[id]!).filter(isOwnCode), [report, files]);
  const git = !!report.git;
  const columns: Column<FileRecord>[] = [
    { key: "path", label: "File", mono: true, width: git ? "34%" : "42%", sort: (f) => f.path, render: (f) => <PathText path={f.path} /> },
    { key: "lang", label: "Language", sort: (f) => model.languages.get(f.language)?.name ?? f.language, render: (f) => model.languages.get(f.language)?.name ?? f.language },
    { key: "code", label: "Code lines", align: "right", mono: true, sort: (f) => f.code, render: (f) => formatInt(f.code) },
    { key: "cx", label: "Complexity", align: "right", mono: true, sort: (f) => f.complexity, render: (f) => formatInt(f.complexity) },
    { key: "fn", label: "Functions", align: "right", mono: true, sort: (f) => f.functions, render: (f) => formatInt(f.functions) },
    { key: "depth", label: "Depth", align: "right", mono: true, sort: (f) => f.maxDepth, render: (f) => formatInt(f.maxDepth) },
    ...(git ? [{ key: "commits", label: "Commits", align: "right" as const, mono: true, sort: (f: FileRecord) => f.git?.commits ?? 0, render: (f: FileRecord) => formatInt(f.git?.commits ?? 0) }] : []),
  ];
  return (
    <Figure
      className={span(8)}
      title="Largest and most complex files"
      subtitle="Source and test files; sort by any column. Click a row to select the file."
      height={320}
      empty={rows.length === 0 ? "No source or test files in view. Widen the filters." : null}
    >
      {() => (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id}
          initialSort={{ key: "code", dir: "desc" }}
          pageSize={10}
          caption="Largest and most complex files"
          onRowClick={(f) => select({ kind: "file", id: f.id })}
          onRowHover={(f) => setHover(f ? { kind: "file", id: f.id } : null)}
          isSelected={(f) => f.id === selectedId}
        />
      )}
    </Figure>
  );
}

// ─── TODO-dense files ────────────────────────────────────────────────────────────────────────

function TodoDense() {
  const { report, files, surface } = useScope();
  const todo = useMemo(
    () => files.ids.map((id) => report.files[id]!).filter((f) => isOwnCode(f) && f.todos > 0).sort((a, b) => b.todos - a.todos || a.id - b.id),
    [report, files],
  );
  const total = todo.reduce((s, f) => s + f.todos, 0);
  const items: BarItem[] = todo.slice(0, 10).map((f) => ({
    key: f.id,
    label: f.path,
    mono: true,
    path: true,
    value: f.todos,
    valueText: formatInt(f.todos),
    color: measureColor(surface),
    target: { kind: "file", id: f.id },
    tip: [
      { value: f.code > 0 ? (f.todos / (f.code / 1000)).toFixed(1) : "–", label: "per 1,000 code lines" },
      { value: formatShare(f.todos / total), label: "of all markers" },
    ],
  }));
  return (
    <Figure
      className={span(4)}
      title="TODO markers"
      subtitle={total ? `${plural(total, "TODO, FIXME, HACK or XXX marker")} in ${plural(todo.length, "file")}` : "TODO, FIXME, HACK and XXX in comments"}
      height={items.length * 28}
      empty={todo.length === 0 ? "No TODO, FIXME, HACK or XXX markers in the source files in view." : null}
      table={() => ({
        columns: [{ label: "File", mono: true, width: "60%" }, { label: "Markers", align: "right", mono: true }, { label: "Code lines", align: "right", mono: true }],
        rows: todo.map((f) => [f.path, f.todos, f.code]),
      })}
    >
      {() => <BarList items={items} label="Files with the most TODO markers" labelWidth="56%" />}
    </Figure>
  );
}
