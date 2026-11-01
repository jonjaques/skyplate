/**
 * Structure: how the code holds together. The module dependency matrix, instability per module
 * (Martin), import cycles, the most-imported files, and external dependencies.
 *
 * Modules, the matrix and instability are computed by the analyzer over the whole import
 * graph; the drawer and filters narrow the file-level views (cycles, most-imported) only.
 */

import { useMemo } from "react";
import type { Cycle, ExternalDependency } from "../../../shared/schema";
import { sequentialColor } from "../../lib/colors";
import { baseName, formatInt, plural, shortenPath } from "../../lib/format";
import { useHover, useViewer } from "../../state/store";
import { BarList, type BarItem } from "../kit/BarList";
import { DataTable, type Column } from "../kit/DataTable";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Legend } from "../kit/Legend";
import { ScaleLegend } from "../kit/ScaleLegend";
import { measureColor } from "../kit/theme";
import { ChartTooltip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, span } from "../Section";
import { PathText } from "../kit/PathText";

export function StructureSection() {
  const { report } = useScope();
  const g = report.graph;
  return (
    <Section
      id="structure"
      title="Structure"
      note={`${formatInt(g.edges)} internal import edges · ${formatInt(g.external)} external and ${formatInt(g.unresolved)} unresolved imports`}
    >
      <ModuleMatrix />
      <Instability />
      <MostImported />
      <Cycles />
      <Externals />
    </Section>
  );
}

function moduleName(path: string, project: string): string {
  return path === "" ? `${project} (root files)` : path;
}

// ─── Module dependency matrix ────────────────────────────────────────────────────────────────

function ModuleMatrix() {
  const { report, surface } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const modules = report.graph.modules;
  const matrix = report.graph.moduleMatrix;
  const names = modules.map((m) => moduleName(report.dirs[m.dir]?.path ?? "", report.project.name));
  const n = modules.length;
  const max = Math.max(1, ...matrix.flat());
  const { active, setActive, focusProps } = useActiveIndex(n * n, (i) => select({ kind: "dir", id: modules[Math.floor(i / n)]!.dir }));
  const total = matrix.flat().reduce((s, v) => s + v, 0);

  return (
    <Figure
      className={span(7)}
      title="Module dependencies"
      subtitle="Rows import columns; darker cells carry more import edges. Modules are directories chosen by the analyzer."
      height={Math.min(560, 140 + n * 26)}
      empty={n < 2 ? "Fewer than two modules, so there are no dependencies between them to show." : total === 0 ? "No imports cross module boundaries." : null}
      legend={<ScaleLegend low="0" high={formatInt(max)} label="Imports" surface={surface} />}
      table={() => ({
        columns: [{ label: "From", mono: true }, { label: "To", mono: true }, { label: "Imports", align: "right", mono: true }],
        rows: matrix.flatMap((row, i) => row.map((v, j) => ({ v, i, j }))).filter((c) => c.v > 0).map((c) => [names[c.i]!, names[c.j]!, c.v]),
      })}
    >
      {(width) => {
        const LABEL = Math.min(190, Math.max(110, width * 0.3));
        const maxChars = Math.floor(LABEL / 6.4);
        const cell = Math.max(10, Math.min(30, (width - LABEL - 8) / n));
        // Column labels run up at 50°; the band above the grid is as tall as the longest
        // label's rise, so none is clipped at the tray's top edge.
        const colChars = Math.min(maxChars, 22, Math.max(...names.map((s) => s.length)));
        const TOP = Math.ceil(colChars * 6.3 * Math.sin((50 * Math.PI) / 180)) + 16;
        const height = TOP + n * cell + 4;
        const ai = active !== null ? Math.floor(active / n) : -1;
        const aj = active !== null ? active % n : -1;
        const label = (s: string) => shortenPath(s, maxChars);
        return (
          <div className="relative">
            <svg
              width={width}
              height={height}
              role="img"
              aria-label="Module dependency matrix. Arrow keys step through cells; Enter selects the importing module."
              className="block outline-offset-4"
              {...focusProps}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const j = Math.floor((e.clientX - r.left - LABEL) / cell);
                const i = Math.floor((e.clientY - r.top - TOP) / cell);
                const inside = i >= 0 && i < n && j >= 0 && j < n;
                setActive(inside ? i * n + j : null);
                // A cell is a row's imports, so it lights the importing module in the galaxy,
                // the same module a click selects.
                setHover(inside ? { kind: "dir", id: modules[i]!.dir } : null);
              }}
              onPointerLeave={() => {
                setActive(null);
                setHover(null);
              }}
              onClick={() => ai >= 0 && select({ kind: "dir", id: modules[ai]!.dir })}
            >
              {names.map((name, i) => (
                <g key={i}>
                  <text
                    x={LABEL - 6}
                    y={TOP + i * cell + cell / 2}
                    dy="0.32em"
                    textAnchor="end"
                    className={`font-mono text-[10.5px] ${i === ai ? "fill-ink font-semibold" : "fill-ink-2"}`}
                    onPointerEnter={() => setHover({ kind: "dir", id: modules[i]!.dir })}
                  >
                    <title>{name}</title>
                    {label(name)}
                  </text>
                  <text
                    transform={`translate(${LABEL + i * cell + cell / 2 + 3}, ${TOP - 6}) rotate(-50)`}
                    className={`font-mono text-[10.5px] ${i === aj ? "fill-ink font-semibold" : "fill-ink-2"}`}
                  >
                    <title>{name}</title>
                    {shortenPath(name, colChars)}
                  </text>
                </g>
              ))}
              {matrix.map((row, i) =>
                row.map((v, j) => (
                  <rect
                    key={`${i}-${j}`}
                    x={LABEL + j * cell + 1}
                    y={TOP + i * cell + 1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={2}
                    fill={v > 0 ? sequentialColor(Math.sqrt(v / max), surface) : undefined}
                    className={v > 0 ? undefined : i === j ? "fill-rule/60" : "fill-wash"}
                    style={i === ai && j === aj ? { stroke: "var(--color-ink)", strokeWidth: 1.5 } : undefined}
                  />
                )),
              )}
            </svg>
            <ChartTooltip
              width={width}
              tip={
                ai >= 0
                  ? {
                      x: LABEL + aj * cell + cell / 2,
                      y: TOP + ai * cell - 6,
                      title: `${names[ai]} → ${names[aj]}`,
                      rows: [{ value: formatInt(matrix[ai]![aj]!), label: matrix[ai]![aj] === 1 ? "import" : "imports" }],
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

// ─── Instability ─────────────────────────────────────────────────────────────────────────────

function Instability() {
  const { report, surface } = useScope();
  const modules = useMemo(
    () => [...report.graph.modules].filter((m) => m.ca + m.ce > 0).sort((a, b) => b.instability - a.instability || b.ce - a.ce),
    [report],
  );
  const items: BarItem[] = modules.map((m) => {
    const name = moduleName(report.dirs[m.dir]?.path ?? "", report.project.name);
    return {
      key: m.dir,
      label: name,
      mono: true,
      value: m.instability,
      valueText: m.instability.toFixed(2),
      color: measureColor(surface),
      target: { kind: "dir", id: m.dir },
      tip: [
        { value: formatInt(m.ca), label: "modules depend on it (Ca)" },
        { value: formatInt(m.ce), label: "modules it depends on (Ce)" },
      ],
    };
  });
  return (
    <Figure
      className={span(5)}
      title="Instability per module"
      subtitle="Ce ÷ (Ca + Ce), after Martin: 0 is depended on and depends on nothing (stable), 1 the reverse"
      height={items.length * 28}
      empty={items.length === 0 ? "No module has imports in or out, so instability is undefined." : null}
      table={() => ({
        columns: [{ label: "Module", mono: true, width: "50%" }, { label: "Ca", align: "right", mono: true }, { label: "Ce", align: "right", mono: true }, { label: "Instability", align: "right", mono: true }],
        rows: modules.map((m) => [moduleName(report.dirs[m.dir]?.path ?? "", report.project.name), m.ca, m.ce, { text: m.instability.toFixed(2), sort: m.instability }]),
      })}
    >
      {() => <BarList items={items} max={1} label="Instability per module" labelWidth="44%" />}
    </Figure>
  );
}

// ─── Most-imported files ─────────────────────────────────────────────────────────────────────

function MostImported() {
  const { report, model, files, surface } = useScope();
  const top = useMemo(
    () => files.ids.map((id) => report.files[id]!).filter((f) => f.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn || b.rank - a.rank).slice(0, 12),
    [report, files],
  );
  const holo = top.some((f) => model.holotypes.has(f.id));
  const items: BarItem[] = top.map((f) => ({
    key: f.id,
    label: f.path,
    mono: true,
    path: true,
    value: f.fanIn,
    valueText: formatInt(f.fanIn),
    // Holotype red marks exactly the files the galaxy pins as holotypes, nothing else.
    color: model.holotypes.has(f.id) ? "var(--color-holotype)" : measureColor(surface),
    target: { kind: "file", id: f.id },
    tip: [
      { value: formatInt(f.fanOut), label: "files it imports" },
      { value: f.rank.toFixed(2), label: "PageRank (max 1)" },
    ],
  }));
  return (
    <Figure
      className={span(6)}
      title="Most-imported files"
      subtitle="Distinct files importing each one"
      height={items.length * 28}
      empty={top.length === 0 ? "No resolved internal imports among the files in view." : null}
      legend={
        holo ? (
          <Legend
            items={[
              { label: "Holotype: its region's most depended-on file", color: "var(--color-holotype)" },
              { label: "Other files", color: measureColor(surface) },
            ]}
          />
        ) : undefined
      }
      table={() => ({
        columns: [{ label: "File", mono: true, width: "55%" }, { label: "Imported by", align: "right", mono: true }, { label: "Imports", align: "right", mono: true }, { label: "Holotype" }],
        rows: top.map((f) => [f.path, f.fanIn, f.fanOut, model.holotypes.has(f.id) ? "Yes" : ""]),
      })}
    >
      {() => <BarList items={items} label="Most-imported files" labelWidth="52%" />}
    </Figure>
  );
}

// ─── Import cycles ───────────────────────────────────────────────────────────────────────────

function Cycles() {
  const { report, files } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const cycles = useMemo(
    () => report.graph.cycles.filter((c) => c.files.some((id) => files.mask[id])).sort((a, b) => b.files.length - a.files.length),
    [report, files],
  );
  const columns: Column<Cycle>[] = [
    { key: "size", label: "Files", align: "right", mono: true, width: "56px", sort: (c) => c.files.length, render: (c) => formatInt(c.files.length) },
    {
      key: "central",
      label: "Most central",
      mono: true,
      width: "42%",
      sort: (c) => report.files[c.files[0]!]!.path,
      render: (c) => <PathText path={report.files[c.files[0]!]!.path} />,
    },
    {
      key: "members",
      label: "Also in the cycle",
      render: (c) => (
        <span className="text-ink-2" title={c.files.map((id) => report.files[id]!.path).join("\n")}>
          {c.files
            .slice(1, 5)
            .map((id) => baseName(report.files[id]!.path))
            .join(", ")}
          {c.files.length > 5 ? `, and ${c.files.length - 5} more` : ""}
        </span>
      ),
    },
  ];
  return (
    <Figure
      className={span(6)}
      title="Import cycles"
      subtitle={cycles.length ? `${plural(cycles.length, "cycle")}; click one to select its most central file (highest PageRank)` : "Files that import each other, directly or around a loop"}
      height={200}
      empty={cycles.length === 0 ? "No import cycles among the files in view: the internal import graph is acyclic here." : null}
    >
      {() => (
        <DataTable
          columns={columns}
          rows={cycles}
          rowKey={(c) => c.id}
          initialSort={{ key: "size", dir: "desc" }}
          pageSize={8}
          caption="Import cycles"
          onRowClick={(c) => select({ kind: "file", id: c.files[0]! })}
          onRowHover={(c) => setHover(c ? { kind: "file", id: c.files[0]! } : null)}
        />
      )}
    </Figure>
  );
}

// ─── External dependencies ───────────────────────────────────────────────────────────────────

function Externals() {
  const { report } = useScope();
  const deps = report.externals;
  const declared = deps.filter((d) => d.declaredIn.length > 0).length;
  const unused = deps.filter((d) => d.declaredIn.length > 0 && d.importers === 0).length;
  const columns: Column<ExternalDependency>[] = [
    { key: "name", label: "Package", mono: true, width: "34%", sort: (d) => d.name, render: (d) => <span title={d.name}>{d.name}</span> },
    { key: "eco", label: "Ecosystem", sort: (d) => d.ecosystem, render: (d) => d.ecosystem },
    { key: "scope", label: "Scope", sort: (d) => d.scope, render: (d) => (d.scope === "unknown" ? <span className="text-ink-3">undeclared</span> : d.scope) },
    { key: "version", label: "Version", mono: true, sort: (d) => d.version ?? "", render: (d) => d.version ?? <span className="text-ink-3">–</span> },
    { key: "importers", label: "Importing files", align: "right", mono: true, sort: (d) => d.importers, render: (d) => formatInt(d.importers) },
  ];
  return (
    <Figure
      className={span(12)}
      title="External dependencies"
      subtitle={`${plural(deps.length, "package")}: ${formatInt(declared)} declared in manifests${unused ? `, ${formatInt(unused)} of them never imported` : ""}, the rest seen only in imports (standard libraries and undeclared packages)`}
      height={200}
      empty={deps.length === 0 ? "No external dependencies: no manifests declare any and no imports reach outside the repository." : null}
    >
      {() => <DataTable columns={columns} rows={deps} rowKey={(d) => `${d.ecosystem}:${d.name}`} initialSort={{ key: "importers", dir: "desc" }} pageSize={10} caption="External dependencies" />}
    </Figure>
  );
}

