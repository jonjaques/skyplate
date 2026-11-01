/**
 * Coupling: files that change together. A sortable table of the strongest co-change pairs,
 * and an arc view of the same pairs.
 *
 * The arc view orders files by their place in the directory tree, so a short arc is coupling
 * inside one region and a long arc is coupling across regions: the kind that surprises
 * people. Arcs are capped at the 40 strongest pairs; past that the view turns into a hairball
 * and the table is the honest form.
 */

import * as d3 from "d3";
import { useMemo, useState } from "react";
import type { CouplingPair } from "../../../shared/schema";
import { baseName, formatInt, plural } from "../../lib/format";
import { useHover, useViewer } from "../../state/store";
import { DataTable, type Column } from "../kit/DataTable";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Legend } from "../kit/Legend";
import { emphasisColor, measureColor, surfaceColor } from "../kit/theme";
import { ChartTooltip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, span } from "../Section";
import { PathText } from "../kit/PathText";
import { formatShare } from "../kit/marks";

export function CouplingSection() {
  const { report, history } = useScope();
  if (!report.git || !history) return null;
  return (
    <Section id="coupling" title="Coupling" note="Files that keep changing in the same commits, whether or not they import each other">
      <PairsTable />
      <Arcs />
    </Section>
  );
}

function useScopedPairs() {
  const { report, files } = useScope();
  return useMemo(
    () => report.git!.coupling.filter((p) => files.mask[p.a] || files.mask[p.b]).sort((x, y) => y.shared - x.shared || y.degree - x.degree),
    [report, files],
  );
}

function PairsTable() {
  const { report } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const pairs = useScopedPairs();
  const fileCell = (id: number) => (
    <button
      type="button"
      className="block w-full min-w-0 rounded-sm text-left hover:underline"
      onClick={() => select({ kind: "file", id })}
      onPointerEnter={() => setHover({ kind: "file", id })}
      onFocus={() => setHover({ kind: "file", id })}
    >
      <PathText path={report.files[id]!.path} />
    </button>
  );
  const columns: Column<CouplingPair>[] = [
    { key: "a", label: "File", mono: true, width: "34%", sort: (p) => report.files[p.a]!.path, render: (p) => fileCell(p.a) },
    { key: "b", label: "Changes with", mono: true, width: "34%", sort: (p) => report.files[p.b]!.path, render: (p) => fileCell(p.b) },
    { key: "shared", label: "Shared commits", align: "right", mono: true, sort: (p) => p.shared, render: (p) => formatInt(p.shared) },
    { key: "degree", label: "Degree", align: "right", mono: true, sort: (p) => p.degree, render: (p) => formatShare(p.degree) },
  ];
  return (
    <Figure
      className={span(7)}
      title="Strongest co-change pairs"
      subtitle="Degree is shared commits ÷ the commits of the less-changed file: 100% means one never changes without the other"
      height={260}
      empty={pairs.length === 0 ? "No co-change pairs among the files in view." : null}
    >
      {() => (
        <div onPointerLeave={() => setHover(null)}>
          <DataTable columns={columns} rows={pairs} rowKey={(p) => `${p.a}-${p.b}`} initialSort={{ key: "shared", dir: "desc" }} pageSize={10} caption="Co-change pairs" />
        </div>
      )}
    </Figure>
  );
}

const ARC_H = 300;
const BASE = ARC_H - 44;

function Arcs() {
  const { report, model, surface } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const hoverId = useHover((s) => (s.hover?.kind === "file" ? s.hover.id : -1));
  const pairs = useScopedPairs().slice(0, 40);
  const nodes = useMemo(() => {
    const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
    return ids.sort((a, b) => model.fileOrderIndex[a]! - model.fileOrderIndex[b]!);
  }, [pairs, model]);
  const degreeOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pairs) {
      m.set(p.a, (m.get(p.a) ?? 0) + 1);
      m.set(p.b, (m.get(p.b) ?? 0) + 1);
    }
    return m;
  }, [pairs]);
  const { active, setActive, focusProps } = useActiveIndex(nodes.length, (i) => nodes[i] !== undefined && select({ kind: "file", id: nodes[i]! }));
  const [pointer, setPointer] = useState<number | null>(null);
  const focusNode = active !== null ? nodes[active]! : pointer ?? (nodes.includes(hoverId) ? hoverId : null);

  return (
    <Figure
      className={span(5)}
      title="Co-change arcs"
      subtitle={`The ${plural(pairs.length, "strongest pair")}, files in directory order; long arcs couple distant regions`}
      height={ARC_H}
      empty={pairs.length < 2 ? "Too few co-change pairs in view to draw." : null}
      legend={
        <Legend
          items={[
            { label: "Arc weight is shared commits", color: measureColor(surface), key: "line" },
            { label: "Hovered file's pairs", color: emphasisColor(surface), key: "line" },
          ]}
        />
      }
    >
      {(width) => {
        const x = d3.scalePoint<number>().domain(nodes).range([12, width - 12]);
        const maxShared = Math.max(1, ...pairs.map((p) => p.shared));
        const maxSpan = Math.max(1, ...pairs.map((p) => Math.abs(x(p.b)! - x(p.a)!)));
        // Arcs are flattened ellipses so the widest one still fits under the legend.
        const k = Math.min(1, (BASE - 8) / (maxSpan / 2));
        // Directory runs under the baseline: which top-level region each stretch belongs to.
        const runs: { dir: number; from: number; to: number }[] = [];
        for (const id of nodes) {
          const d = model.topDir[id]!;
          const last = runs[runs.length - 1];
          if (last && last.dir === d) last.to = x(id)!;
          else runs.push({ dir: d, from: x(id)!, to: x(id)! });
        }
        const linked = new Set<number>();
        if (focusNode !== null) for (const p of pairs) if (p.a === focusNode || p.b === focusNode) linked.add(p.a).add(p.b);
        const f = focusNode !== null ? report.files[focusNode] : undefined;
        return (
          <div className="relative">
            <svg
              width={width}
              height={ARC_H}
              role="img"
              aria-label="Co-change arcs between files. Arrow keys step through files in directory order; Enter selects."
              className="block outline-offset-4"
              {...focusProps}
              onPointerMove={(e) => {
                const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
                let best: number | null = null;
                let dist = 14;
                for (const id of nodes) {
                  const dx = Math.abs(x(id)! - mx);
                  if (dx < dist) {
                    dist = dx;
                    best = id;
                  }
                }
                setPointer(best);
                setHover(best !== null ? { kind: "file", id: best } : null);
              }}
              onPointerLeave={() => {
                setPointer(null);
                setHover(null);
              }}
              onClick={() => pointer !== null && select({ kind: "file", id: pointer })}
              style={{ cursor: pointer !== null ? "pointer" : "default" }}
            >
              <line x1={8} x2={width - 8} y1={BASE + 0.5} y2={BASE + 0.5} className="stroke-rule-strong" strokeWidth={1} />
              {pairs.map((p) => {
                const xa = x(p.a)!;
                const xb = x(p.b)!;
                const rx = Math.abs(xb - xa) / 2;
                const on = focusNode !== null && (p.a === focusNode || p.b === focusNode);
                return (
                  <path
                    key={`${p.a}-${p.b}`}
                    d={`M${Math.min(xa, xb)},${BASE}A${rx},${rx * k} 0 0 1 ${Math.max(xa, xb)},${BASE}`}
                    fill="none"
                    stroke={on ? emphasisColor(surface) : measureColor(surface)}
                    strokeWidth={1 + 3 * (p.shared / maxShared)}
                    strokeOpacity={focusNode === null ? 0.25 + 0.55 * p.degree : on ? 0.95 : 0.12}
                    pointerEvents="none"
                  />
                );
              })}
              {nodes.map((id) => (
                <circle
                  key={id}
                  cx={x(id)}
                  cy={BASE}
                  r={id === focusNode ? 5 : 4}
                  style={{ fill: model.holotypes.has(id) ? "var(--color-holotype)" : linked.has(id) || focusNode === null ? emphasisColor(surface) : measureColor(surface) }}
                  stroke={surfaceColor(surface)}
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
              {runs.map((r, i) => {
                const w = Math.max(r.to - r.from, 2);
                const name = r.dir === 0 ? "root" : report.dirs[r.dir]!.name;
                const room = Math.max(w + 12, 0);
                const fits = name.length * 6 <= room;
                return (
                  <g key={i} aria-hidden>
                    <line x1={r.from} x2={r.from + w} y1={BASE + 12.5} y2={BASE + 12.5} className="stroke-ink-3" strokeWidth={1} />
                    {fits && (
                      <text x={r.from + w / 2} y={BASE + 26} textAnchor="middle" className="fill-ink-3 font-mono text-[10px]">
                        {name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <ChartTooltip
              width={width}
              tip={
                f
                  ? {
                      x: x(f.id)!,
                      y: BASE - 60,
                      title: f.path,
                      rows: [
                        { value: formatInt(degreeOf.get(f.id) ?? 0), label: "strong co-change partners shown" },
                        ...pairs
                          .filter((p) => p.a === f.id || p.b === f.id)
                          .slice(0, 3)
                          .map((p) => ({ value: formatInt(p.shared), label: baseName(report.files[p.a === f.id ? p.b : p.a]!.path) })),
                      ],
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
