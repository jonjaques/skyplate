/**
 * Composition: what the project is made of. Lines by language, files and lines by category
 * group, the directory treemap, and the file size distribution.
 */

import * as d3 from "d3";
import { ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { CategoryGroup } from "../../../shared/schema";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { CATEGORY_GROUP_LABEL, categoryGroupColor, type Surface } from "../../lib/colors";
import { formatBytes, formatCompact, formatInt, plural } from "../../lib/format";
import { dirAncestry } from "../../model/indices";
import { useHover, useViewer, type Target } from "../../state/store";
import { aggregateDir, categoryGroups, isOwnCode, languageShares, log2Dist, sum } from "../data";
import { BarList, type BarItem } from "../kit/BarList";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Swatch } from "../kit/Legend";
import { Log2Histogram } from "../kit/Log2Histogram";
import { measureColor, slotColor } from "../kit/theme";
import { ChartTooltip, type Tip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, span } from "../Section";
import { formatShare } from "../kit/marks";

export function CompositionSection() {
  return (
    <Section id="composition" title="Composition">
      <LinesByLanguage />
      <CategoryGroups />
      <DirTreemap />
      <SizeDistribution />
    </Section>
  );
}

// ─── Lines by language ───────────────────────────────────────────────────────────────────────

function LinesByLanguage() {
  const { report, model, files, surface } = useScope();
  const shares = useMemo(() => languageShares(report, model, files.ids).filter((s) => s.code > 0), [report, model, files]);
  const total = sum(shares.map((s) => s.code));
  const shown = shares.slice(0, 12);
  const rest = shares.slice(12);
  const items: BarItem[] = shown.map((s) => ({
    key: s.id,
    label: s.name,
    value: s.code,
    valueText: formatInt(s.code),
    color: slotColor(s.slot, surface),
    tip: [
      { value: formatShare(s.code / total), label: "of code lines" },
      { value: formatInt(s.files), label: s.files === 1 ? "file" : "files" },
    ],
  }));
  if (rest.length) {
    const restCode = sum(rest.map((s) => s.code));
    items.push({
      key: "rest",
      label: `${rest.length} more ${rest.length === 1 ? "language" : "languages"}`,
      value: restCode,
      valueText: formatInt(restCode),
      color: slotColor(-1, surface),
      rest: true,
      tip: rest.slice(0, 5).map((s) => ({ value: formatInt(s.code), label: s.name })),
    });
  }
  return (
    <Figure
      className={span(6)}
      title="Code lines by language"
      subtitle={`${formatInt(total)} code lines across ${plural(shares.length, "language")}, comments and blanks excluded`}
      height={items.length * 28}
      empty={shares.length === 0 ? "No code lines in view. Widen the filters to see languages." : null}
      table={() => ({
        columns: [{ label: "Language" }, { label: "Code lines", align: "right", mono: true }, { label: "Files", align: "right", mono: true }, { label: "Share", align: "right", mono: true }],
        rows: shares.map((s) => [s.name, s.code, s.files, { text: formatShare(s.code / total), sort: s.code }]),
      })}
    >
      {() => <BarList items={items} label="Code lines by language" labelWidth="30%" />}
    </Figure>
  );
}

// ─── Category groups ─────────────────────────────────────────────────────────────────────────

function CategoryGroups() {
  const { report, files, surface } = useScope();
  const groups = useMemo(() => categoryGroups(report, files.ids), [report, files]);
  const totals = { files: sum(groups.map((g) => g.files)), lines: sum(groups.map((g) => g.lines)) };
  const present = groups.filter((g) => g.files > 0);
  return (
    <Figure
      className={span(6)}
      title="Files and lines by category"
      subtitle="Share of each category group, by file count and by line count"
      height={150}
      empty={totals.files === 0 ? "No files in view. Widen the filters to see categories." : null}
    >
      {(width) => (
        <div className="flex flex-col gap-4 pt-1">
          <StackRow label="Files" total={totals.files} unit="files" groups={present.map((g) => ({ group: g.group, value: g.files }))} width={width} surface={surface} />
          <StackRow label="Lines" total={totals.lines} unit="lines" groups={present.map((g) => ({ group: g.group, value: g.lines }))} width={width} surface={surface} />
          {/* The key doubles as the legend and the table view: every swatch with its exact
              figures, so no value is reachable only by hovering a thin segment. */}
          <table className="mt-1 w-full table-fixed text-xs">
            <caption className="sr-only">Files and lines by category group</caption>
            <thead>
              <tr className="border-b border-rule text-ink-3">
                <th className="py-1 text-left font-normal">Category group</th>
                <th className="w-[18%] py-1 text-right font-normal">Files</th>
                <th className="w-[12%] py-1 text-right font-normal">Share</th>
                <th className="w-[20%] py-1 text-right font-normal">Lines</th>
                <th className="w-[12%] py-1 text-right font-normal">Share</th>
              </tr>
            </thead>
            <tbody>
              {present.map((g) => (
                <tr key={g.group} className="border-b border-rule last:border-b-0">
                  <td className="py-1">
                    <span className="flex min-w-0 items-center gap-1.5 text-ink">
                      <Swatch color={categoryGroupColor(g.group, surface)} />
                      <span className="truncate">{CATEGORY_GROUP_LABEL[g.group]}</span>
                    </span>
                  </td>
                  <td className="figures py-1 text-right font-mono text-[11px] text-ink">{formatInt(g.files)}</td>
                  <td className="figures py-1 text-right font-mono text-[11px] text-ink-3">{formatShare(g.files / totals.files)}</td>
                  <td className="figures py-1 text-right font-mono text-[11px] text-ink">{formatInt(g.lines)}</td>
                  <td className="figures py-1 text-right font-mono text-[11px] text-ink-3">{formatShare(totals.lines ? g.lines / totals.lines : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Figure>
  );
}

/** Labels inside a fill: white, except on the light yellow slot and the light gray, which take ink. */
function inkOn(slot: number, surface: Surface): string {
  if (surface === "dark") return "#ffffff";
  return slot === 3 || slot < 0 || slot > 6 ? "#15191c" : "#ffffff";
}

function StackRow({
  label,
  total,
  unit,
  groups,
  width,
  surface,
}: {
  label: string;
  total: number;
  unit: string;
  groups: { group: CategoryGroup; value: number }[];
  width: number;
  surface: Surface;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const LABEL_W = 44;
  const barW = width - LABEL_W;
  const drawn = groups.filter((g) => total > 0 && g.value / total >= 0.003);
  const gaps = Math.max(0, drawn.length - 1) * 2;
  return (
    <div ref={ref} className="relative flex items-center" onPointerLeave={() => setTip(null)}>
      <span className="w-11 shrink-0 text-xs text-ink-2">{label}</span>
      <div className="flex h-6 min-w-0 flex-1 gap-[2px]" role="img" aria-label={`${label}: ${drawn.map((g) => `${CATEGORY_GROUP_LABEL[g.group]} ${formatShare(g.value / total)}`).join(", ")}`}>
        {drawn.map((g) => {
          const share = g.value / total;
          const px = (barW - gaps) * share;
          const text = formatShare(share);
          const slot = ["code", "test", "docs", "config", "data", "markup", "asset"].indexOf(g.group);
          return (
            <div
              key={g.group}
              className="flex h-full min-w-px items-center justify-center overflow-visible last:rounded-r-[4px] hover:brightness-110"
              style={{ flex: `${g.value} 0 0`, background: categoryGroupColor(g.group, surface) }}
              onPointerEnter={(e) => {
                const box = ref.current!.getBoundingClientRect();
                const r = e.currentTarget.getBoundingClientRect();
                setTip({
                  x: r.left - box.left + r.width / 2,
                  y: r.bottom - box.top + 4,
                  title: CATEGORY_GROUP_LABEL[g.group],
                  rows: [{ value: formatInt(g.value), label: unit }, { value: text, label: `of ${unit}` }],
                });
              }}
            >
              {/* A share label only when it fits with room on both sides; never clipped. */}
              {px >= text.length * 7 + 12 && (
                <span className="figures font-mono text-[10px] font-medium" style={{ color: inkOn(slot, surface) }}>
                  {text}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}

// ─── Directory treemap ───────────────────────────────────────────────────────────────────────

type Measure = "lines" | "bytes" | "files";

interface TNode {
  key: string;
  target: Target;
  name: string;
  path: string;
  value: number;
  files: number;
  lang: string;
  children?: TNode[];
}

const TREEMAP_H = 380;

function DirTreemap() {
  const { report, model, files, surface } = useScope();
  const focusDir = useViewer((s) => s.focusDir);
  const focus = useViewer((s) => s.focus);
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const hover = useHover((s) => s.hover);
  const selection = useViewer((s) => s.selection);
  const [measure, setMeasure] = useState<Measure>("lines");
  const root = focusDir !== null && focusDir > 0 ? focusDir : 0;

  const tree = useMemo(() => {
    const valueOfFile = (id: number) => {
      const f = report.files[id]!;
      return measure === "lines" ? f.lines : measure === "bytes" ? f.bytes : 1;
    };
    const fileLeaf = (id: number): TNode => {
      const f = report.files[id]!;
      return { key: `f${id}`, target: { kind: "file", id }, name: f.name, path: f.path, value: valueOfFile(id), files: 1, lang: f.language };
    };
    const dirLeaf = (d: number): TNode | null => {
      const agg = aggregateDir(report, model, files.mask, d);
      const value = measure === "lines" ? agg.lines : measure === "bytes" ? agg.bytes : agg.files;
      if (value <= 0) return null;
      const dir = report.dirs[d]!;
      return { key: `d${d}`, target: { kind: "dir", id: d }, name: dir.name, path: dir.path, value, files: agg.files, lang: agg.dominant };
    };
    const directFiles = (d: number) => report.dirs[d]!.files.filter((id) => files.mask[id] && valueOfFile(id) > 0).map(fileLeaf);
    const top = report.dirs[root]!;
    const children: TNode[] = [];
    for (const d of top.dirs) {
      const dir = report.dirs[d]!;
      const kids = [...dir.dirs.map(dirLeaf).filter((n): n is TNode => !!n), ...directFiles(d)];
      if (kids.length === 0) continue;
      children.push({ key: `g${d}`, target: { kind: "dir", id: d }, name: dir.name, path: dir.path, value: 0, files: 0, lang: "", children: kids });
    }
    children.push(...directFiles(root));
    return { key: "root", target: { kind: "dir" as const, id: root }, name: top.name, path: top.path, value: 0, files: 0, lang: "", children };
  }, [report, model, files, measure, root]);

  const crumbs = dirAncestry(report, root);
  const unit = measure === "lines" ? "lines" : measure === "bytes" ? "" : "files";
  const fmt = (v: number) => (measure === "bytes" ? formatBytes(v) : `${formatInt(v)} ${unit}`);
  const empty = (tree.children?.length ?? 0) === 0;

  return (
    <Figure
      className={span(8)}
      title="Directory map"
      subtitle="Area is size, color is each directory's dominant language. Click a directory to open it as the drawer."
      height={TREEMAP_H}
      empty={empty ? "Nothing to map in view. Widen the filters or close the drawer." : null}
      actions={
        <ToggleGroup type="single" variant="outline" size="sm" value={measure} onValueChange={(v) => v && setMeasure(v as Measure)} aria-label="Size cells by">
          {(["lines", "bytes", "files"] as const).map((m) => (
            <ToggleGroupItem key={m} value={m} className="h-7 px-2 text-xs capitalize data-[state=on]:bg-paper data-[state=on]:font-semibold">
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
      table={() => ({
        columns: [{ label: "Path", mono: true, width: "60%" }, { label: measure === "bytes" ? "Bytes" : measure === "files" ? "Files" : "Lines", align: "right", mono: true }, { label: "Files", align: "right", mono: true }],
        rows: (tree.children ?? []).flatMap((n) => (n.children ? n.children : [n])).map((n) => [n.path || n.name, measure === "bytes" ? { text: formatBytes(n.value), sort: n.value } : n.value, n.files]),
      })}
    >
      {(width) => (
        <div>
          <nav aria-label="Directory map location" className="mb-2 flex flex-wrap items-center gap-0.5 text-xs">
            {crumbs.map((d, i) => {
              const last = i === crumbs.length - 1;
              const name = d === 0 ? report.project.name : report.dirs[d]!.name;
              return (
                <span key={d} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight aria-hidden className="size-3 text-ink-3" />}
                  {last ? (
                    <span aria-current="location" className="font-mono text-[11px] font-semibold text-ink">
                      {name}
                    </span>
                  ) : (
                    <button type="button" onClick={() => focus(d === 0 ? null : d)} className="rounded-sm px-1 font-mono text-[11px] text-ink-2 underline-offset-2 hover:bg-wash hover:text-ink hover:underline">
                      {name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          <Treemap
            tree={tree}
            width={width}
            height={TREEMAP_H - 26}
            surface={surface}
            languageSlot={(id) => model.languageSlot.get(id) ?? -1}
            languageName={(id) => model.languages.get(id)?.name ?? (id || "No code")}
            format={fmt}
            hover={hover}
            selection={selection}
            onHover={setHover}
            onPick={(n) => {
              if (n.target.kind === "dir") {
                select(n.target);
                focus(n.target.id === 0 ? null : n.target.id);
              } else select(n.target);
            }}
          />
        </div>
      )}
    </Figure>
  );
}

function Treemap({
  tree,
  width,
  height,
  surface,
  languageSlot,
  languageName,
  format,
  hover,
  selection,
  onHover,
  onPick,
}: {
  tree: TNode;
  width: number;
  height: number;
  surface: Surface;
  languageSlot: (id: string) => number;
  languageName: (id: string) => string;
  format: (v: number) => string;
  hover: Target | null;
  selection: Target | null;
  onHover: (t: Target | null) => void;
  onPick: (n: TNode) => void;
}) {
  const layout = useMemo(() => {
    const h = d3
      .hierarchy<TNode>(tree, (n) => n.children)
      .sum((n) => (n.children ? 0 : n.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return d3
      .treemap<TNode>()
      .size([width, height])
      .paddingInner(2)
      .paddingTop((n) => (n.depth === 1 ? 18 : 0))
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.4))(h);
  }, [tree, width, height]);

  const { groups, leaves, ordered } = useMemo(() => {
    const leaves = layout.leaves().filter((l) => l.depth > 0);
    return {
      groups: layout.children?.filter((n) => n.children) ?? [],
      leaves,
      // Keyboard order: largest first, the order a reader scans a treemap in.
      ordered: [...leaves].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    };
  }, [layout]);
  const { active, setActive, focusProps } = useActiveIndex(ordered.length, (i) => ordered[i] && onPick(ordered[i]!.data));
  const activeLeaf = active !== null ? ordered[active] : undefined;
  const same = (t: Target, u: Target | null) => !!u && t.kind === u.kind && t.id === u.id;

  const tipFor = (l: d3.HierarchyRectangularNode<TNode>): Tip => ({
    x: (l.x0 + l.x1) / 2,
    y: l.y0 + 8,
    title: l.data.path || l.data.name,
    rows: [
      { value: format(l.value ?? 0) },
      ...(l.data.target.kind === "dir" ? [{ value: formatInt(l.data.files), label: l.data.files === 1 ? "file" : "files" }] : []),
      { value: languageName(l.data.lang), label: l.data.target.kind === "dir" ? "mostly" : "" },
    ],
  });
  const [pointerTip, setPointerTip] = useState<Tip | null>(null);
  const tip = activeLeaf ? tipFor(activeLeaf) : pointerTip;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Directory map. Arrow keys step through cells, largest first; Enter opens a directory or selects a file."
        className="block outline-offset-4"
        {...focusProps}
        onPointerLeave={() => {
          setPointerTip(null);
          onHover(null);
        }}
      >
        {groups.map((g) => {
          const w = g.x1 - g.x0;
          const maxChars = Math.floor((w - 8) / 6);
          const name = g.data.name.length > maxChars ? `${g.data.name.slice(0, Math.max(0, maxChars - 1))}…` : g.data.name;
          return (
            <g key={g.data.key}>
              <rect x={g.x0} y={g.y0} width={w} height={g.y1 - g.y0} className="fill-wash" />
              {maxChars >= 3 && (
                <text
                  x={g.x0 + 4}
                  y={g.y0 + 13}
                  className="cursor-pointer fill-ink font-mono text-[11px] font-medium hover:underline"
                  onClick={() => onPick(g.data)}
                  onPointerEnter={() => onHover(g.data.target)}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
        {leaves.map((l) => {
          const w = l.x1 - l.x0;
          const h = l.y1 - l.y0;
          if (w < 1 || h < 1) return null;
          const slot = l.data.lang ? languageSlot(l.data.lang) : -1;
          const label = l.data.name;
          const fits = w >= label.length * 6 + 10 && h >= 18;
          const lit = same(l.data.target, hover) || same(l.data.target, selection) || activeLeaf === l;
          return (
            <g
              key={l.data.key}
              className="cursor-pointer"
              onPointerEnter={() => {
                onHover(l.data.target);
                setPointerTip(tipFor(l));
              }}
              onClick={() => onPick(l.data)}
            >
              {/* A tint, not the full hue: a treemap is mostly large blocks, and saturated
                  blocks that size shout over everything else on the page. */}
              <rect
                x={l.x0}
                y={l.y0}
                width={w}
                height={h}
                rx={Math.min(2, w / 2, h / 2)}
                style={{ fill: `color-mix(in oklab, ${slotColor(slot, surface)} ${lit ? 78 : 60}%, var(--color-tray))` }}
              />
              {lit && <rect x={l.x0 + 1} y={l.y0 + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} fill="none" className="stroke-ink" strokeWidth={2} pointerEvents="none" />}
              {fits && (
                <text x={l.x0 + 5} y={l.y0 + 13} className="pointer-events-none fill-ink text-[11px] font-medium">
                  {label}
                </text>
              )}
              {fits && h >= 32 && (
                <text x={l.x0 + 5} y={l.y0 + 26} className="figures pointer-events-none fill-ink-2 font-mono text-[10px]">
                  {formatCompact(l.value ?? 0)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}

// ─── File size distribution ──────────────────────────────────────────────────────────────────

function SizeDistribution() {
  const { report, files, surface } = useScope();
  const dist = useMemo(() => {
    if (!files.selective) {
      const s = report.stats.linesPerFile;
      return { bins: s.log2Bins, median: s.median, p90: s.p90, count: s.count };
    }
    return log2Dist(files.ids.map((id) => report.files[id]!).filter(isOwnCode).map((f) => f.lines));
  }, [report, files]);
  return (
    <Figure
      className={span(4)}
      title="File size"
      subtitle={`Lines per source and test file, ${plural(dist.count, "file")}, on doubling bins`}
      height={220}
      empty={dist.count === 0 ? "No source or test files in view, so there are no sizes to compare." : null}
      table={() => ({
        columns: [{ label: "Lines", mono: true }, { label: "Files", align: "right", mono: true }],
        rows: dist.bins.map((c, i) => [{ text: i === 0 ? "0–1" : `${formatInt(2 ** i)}–${formatInt(2 ** (i + 1) - 1)}`, sort: i }, c]),
      })}
    >
      {(width) => (
        <Log2Histogram
          bins={dist.bins}
          width={width}
          height={220}
          color={measureColor(surface)}
          unit="files"
          measure="lines"
          markers={[
            { value: dist.median, label: `median ${formatInt(dist.median)}` },
            { value: dist.p90, label: `p90 ${formatInt(dist.p90)}` },
          ]}
        />
      )}
    </Figure>
  );
}
