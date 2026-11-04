/**
 * Composition: what the project is made of. Lines by language, files and lines by category
 * group, the directory treemap, and the file size distribution.
 */

import * as d3 from "d3";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { CATEGORY_GROUP_LABEL, type Surface } from "../../lib/colors";
import { formatBytes, formatCompact, formatInt, plural } from "../../lib/format";
import { dirAncestry } from "../../model/indices";
import { useHover, useViewer, type Target } from "../../state/store";
import { aggregateDir, categoryGroups, hasSlot, isOwnCode, languageShares, log2Dist, sum } from "../data";
import { BarList, type BarItem } from "../kit/BarList";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Legend, type LegendItem } from "../kit/Legend";
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
  // A "1 more language" row takes the room naming that language would (fd's fish, 1 line).
  const cut = shares.length <= 13 ? shares.length : 12;
  const shown = shares.slice(0, cut);
  const rest = shares.slice(cut);
  // A bar wears exactly the color its language's stars have on the plate: its slot hue, or the
  // Other gray, which is also what the language tray and the galaxy key show for it. Unslotted
  // languages used to wear the measure slate, so as not to read as part of the folded
  // remainder when Markdown and JSON ranked second and fourth without a slot; now that slots go
  // to the seven largest languages, an unslotted one is the galaxy's Other, and a fourth color
  // for it ("slate here means gray there") only made the three surfaces disagree.
  const unslotted = shown.some((s) => !hasSlot(s.slot));
  const items: BarItem[] = shown.map((s) => ({
    key: s.id,
    label: s.name,
    value: s.code,
    valueText: formatInt(s.code),
    color: slotColor(hasSlot(s.slot) ? s.slot : -1, surface),
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
      tip: [
        ...rest.slice(0, 5).map((s) => ({ value: formatInt(s.code), label: s.name })),
        ...(rest.length > 5 ? [{ value: formatInt(rest.length - 5), label: "more languages" }] : []),
      ],
    });
  }
  return (
    <Figure
      className={span(6)}
      title="Code lines by language"
      subtitle={`${formatInt(total)} code lines across ${plural(shares.length, "language")}, comments and blanks excluded${unslotted ? ". Gray bars are languages the plate groups as Other" : ""}`}
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

/**
 * Category groups as a paired share list: each group's share of the files and of the lines,
 * both on one scale so a group that is 10% of the files and 40% of the lines shows it.
 *
 * Not a stacked bar in the seven palette hues any more. Those hues are the language slots,
 * and this chart sits beside "Code lines by language": orange meant TSX there and Tests here,
 * blue TypeScript there and Code here. Groups are nominal and every row is labeled, so they
 * need no hue of their own; the bars wear the measure slate. The list is its own table: every
 * share is printed, nothing waits behind a hover. Counts follow each share where the figure is
 * wide enough; in a narrow one they would leave the bars a few pixels long, so they drop out
 * and stay in the table view.
 */
function CategoryGroups() {
  const { report, files, surface } = useScope();
  const groups = useMemo(() => categoryGroups(report, files.ids), [report, files]);
  const totals = { files: sum(groups.map((g) => g.files)), lines: sum(groups.map((g) => g.lines)) };
  const present = groups.filter((g) => g.files > 0);
  const share = (n: number, d: number) => (d > 0 ? n / d : 0);
  const top = Math.max(1e-9, ...present.flatMap((g) => [share(g.files, totals.files), share(g.lines, totals.lines)]));
  const color = measureColor(surface);
  return (
    <Figure
      className={span(6)}
      title="Files and lines by category"
      subtitle="Each category group's share of the files and of the lines in view, on one scale"
      height={30 + present.length * 28}
      empty={totals.files === 0 ? "No files in view. Widen the filters to see categories." : null}
      table={() => ({
        columns: [{ label: "Category group" }, { label: "Files", align: "right", mono: true }, { label: "Share", align: "right", mono: true }, { label: "Lines", align: "right", mono: true }, { label: "Share", align: "right", mono: true }],
        rows: present.map((g) => [
          CATEGORY_GROUP_LABEL[g.group],
          g.files,
          { text: formatShare(share(g.files, totals.files)), sort: g.files },
          g.lines,
          { text: formatShare(share(g.lines, totals.lines)), sort: g.lines },
        ]),
      })}
    >
      {() => (
        <div className="@container [--share-reserve:44px] @min-[440px]:[--share-reserve:100px]">
          <table className="w-full table-fixed text-xs">
            <caption className="sr-only">Files and lines by category group</caption>
            <thead>
              <tr className="border-b border-rule text-ink-3">
                <th scope="col" className="w-[30%] py-1 text-left font-normal">
                  Category group
                </th>
                <th scope="col" className="py-1 pl-3 text-left font-normal">
                  Share of files
                </th>
                <th scope="col" className="py-1 pl-3 text-left font-normal">
                  Share of lines
                </th>
              </tr>
            </thead>
            <tbody>
              {present.map((g) => (
                <tr key={g.group} className="h-7 border-b border-rule last:border-b-0">
                  <th scope="row" className="truncate text-left font-normal text-ink">
                    {CATEGORY_GROUP_LABEL[g.group]}
                  </th>
                  <td className="pl-3">
                    <ShareBar share={share(g.files, totals.files)} count={g.files} top={top} color={color} />
                  </td>
                  <td className="pl-3">
                    <ShareBar share={share(g.lines, totals.lines)} count={g.lines} top={top} color={color} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Figure>
  );
}

/** One bar of the paired list: the share at the tip in ink, the count after it, quieter. */
function ShareBar({ share, count, top, color }: { share: number; count: number; top: number; color: string }) {
  return (
    <span className="flex min-w-0 items-center">
      <span
        aria-hidden
        className="h-3 shrink-0 rounded-r-[4px]"
        // The track keeps room for both figures, so the longest bar never pushes them out.
        style={{ width: `calc((100% - var(--share-reserve)) * ${Math.min(1, share / top)})`, minWidth: share > 0 ? 2 : 0, background: color }}
      />
      <span className="figures ml-1.5 shrink-0 font-mono text-[11px] text-ink">{formatShare(share)}</span>
      <span className="figures ml-1.5 hidden min-w-0 truncate font-mono text-[11px] text-ink-3 @min-[440px]:inline">{formatInt(count)}</span>
    </span>
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

/**
 * Treemap fills. A treemap is an all-pairs form (any cell can touch any other), and the
 * palette validates all-pairs only for its first three slots, so only those three languages
 * keep their galaxy hue here; every other language shares one neutral. The neutral is the
 * strong rule tone, not the Other gray: the validator put the mid gray within ΔE 14 of aqua
 * (slot 3) under normal vision, below the 15 floor, while rule-strong clears it (19.3) in
 * both modes. Hues are the documented slot values at full strength; the old 60% tints were
 * mixes the validator had never seen, and they failed it (protan ΔE 2.8).
 *
 * Labels follow the palette's rule for text inside a fill: white on the hues, ink on the
 * neutral.
 */
const TREEMAP_SLOTS = 3;

function treemapFill(slot: number, surface: Surface): { fill: string; ink: string; ink2: string } {
  if (slot >= 0 && slot < TREEMAP_SLOTS) return { fill: slotColor(slot, surface), ink: "#ffffff", ink2: "rgb(255 255 255 / 0.85)" };
  return { fill: "var(--color-rule-strong)", ink: "var(--color-ink)", ink2: "var(--color-ink-2)" };
}

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

  // The key: the hued languages that actually color a cell here, then the neutral.
  const legend = useMemo((): LegendItem[] => {
    const used = new Set<number>();
    let neutral = false;
    const visit = (n: TNode) => {
      if (n.children) return n.children.forEach(visit);
      const slot = n.lang ? (model.languageSlot.get(n.lang) ?? -1) : -1;
      if (slot >= 0 && slot < TREEMAP_SLOTS) used.add(slot);
      else neutral = true;
    };
    visit(tree);
    const items: LegendItem[] = [...used]
      .sort((a, b) => a - b)
      .map((slot) => ({ label: report.languages.find((l) => l.slot === slot)?.name ?? `Slot ${slot + 1}`, color: treemapFill(slot, surface).fill }));
    // With no hued language in view (a docs drawer, say) every cell is gray and the subtitle
    // already says what gray means; a key of one gray swatch would only repeat it.
    if (neutral && items.length) items.push({ label: "Every other language", color: treemapFill(-1, surface).fill });
    return items;
  }, [tree, model, report, surface]);

  const crumbs = dirAncestry(report, root);
  const unit = measure === "lines" ? "lines" : measure === "bytes" ? "" : "files";
  const fmt = (v: number) => (measure === "bytes" ? formatBytes(v) : `${formatInt(v)} ${unit}`);
  const empty = (tree.children?.length ?? 0) === 0;

  return (
    <Figure
      className={span(8)}
      title="Directory map"
      subtitle="Area is size, color the dominant language: the plate's first three language colors, every other language in gray. Click a directory to open it as the drawer."
      height={TREEMAP_H}
      legend={legend.length ? <Legend items={legend} /> : undefined}
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
    path: !!l.data.path,
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
          const paint = treemapFill(slot, surface);
          // Names that do not fit are shortened with an ellipsis while four characters still
          // fit ("creat…" says more than an unlabeled block); narrower cells stay unlabeled and
          // keep their name in the tooltip and the table view.
          const maxChars = Math.floor((w - 10) / 6);
          const whole = l.data.name.length <= maxChars;
          const label = whole ? l.data.name : maxChars >= 4 ? `${l.data.name.slice(0, maxChars - 1)}…` : "";
          const fits = label !== "" && h >= 18;
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
              <rect x={l.x0} y={l.y0} width={w} height={h} rx={Math.min(2, w / 2, h / 2)} style={{ fill: paint.fill }} />
              {lit && <rect x={l.x0 + 1} y={l.y0 + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} fill="none" className="stroke-ink" strokeWidth={2} pointerEvents="none" />}
              {fits && (
                <text x={l.x0 + 5} y={l.y0 + 13} className="pointer-events-none text-[11px] font-medium" style={{ fill: paint.ink }}>
                  {label}
                </text>
              )}
              {fits && whole && h >= 32 && (
                <text x={l.x0 + 5} y={l.y0 + 26} className="figures pointer-events-none font-mono text-[10px]" style={{ fill: paint.ink2 }}>
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
