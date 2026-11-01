/**
 * People: who knows what. Contributors, the truck factor, ownership by top-level directory,
 * how concentrated the work is (Lorenz curve and Gini), and knowledge islands.
 *
 * Ownership-based views are left out of shallow clones, as the analyzer's findings are: the
 * boundary commit "adds" every file, so ownership would describe whoever made that commit.
 */

import { Bot } from "lucide-react";
import * as d3 from "d3";
import { useMemo, useRef, useState } from "react";
import type { Author, FileRecord } from "../../../shared/schema";
import { formatDate, formatInt, plural } from "../../lib/format";
import { useHover, useViewer } from "../../state/store";
import { authorSlots, commitsByAuthor, gini, inactiveAuthors, isOwnCode, lorenz, sum } from "../data";
import { XAxis, YGrid } from "../kit/Axis";
import { BarList, type BarItem } from "../kit/BarList";
import { DataTable, type Column } from "../kit/DataTable";
import { Figure } from "../kit/Figure";
import { useActiveIndex } from "../kit/interaction";
import { Legend } from "../kit/Legend";
import { StatTile, type StatusLevel } from "../kit/StatTile";
import { measureColor, slotColor, surfaceColor } from "../kit/theme";
import { PathText } from "../kit/PathText";
import { ChartTooltip, type Tip } from "../kit/Tooltip";
import { useScope } from "../scope";
import { Section, span } from "../Section";
import { formatShare } from "../kit/marks";

export function PeopleSection() {
  const { report, history } = useScope();
  if (!report.git || !history) {
    return (
      <Section id="people" title="People">
        <p className="col-span-12 bg-tray px-5 py-5 text-sm text-ink-2">
          {!report.git
            ? "No authorship: this report was generated without git, so there is no record of who wrote what."
            : "One commit is not enough history to say who knows which parts. Re-run on a full clone to see contributors and ownership."}
        </p>
      </Section>
    );
  }
  const people = report.git.authors.filter((a) => !a.bot).length;
  const bots = report.git.authors.length - people;
  return (
    <Section id="people" title="People" note={`${plural(people, "person", "people")}${bots ? ` and ${plural(bots, "automation account")}` : ""} in the analyzed history`}>
      <TruckFactor />
      <Contributors />
      <Ownership />
      <Concentration />
      <KnowledgeIslands />
    </Section>
  );
}

function authorName(a: Author | undefined): string {
  return a?.name || a?.email || "Unknown author";
}

// ─── Truck factor ────────────────────────────────────────────────────────────────────────────

function TruckFactor() {
  const { report } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const git = report.git!;
  const tf = git.truckFactor;
  const level: StatusLevel | undefined = tf.value === 1 ? "critical" : tf.value === 2 ? "warning" : undefined;
  const names = tf.authors.map((id) => ({ id, name: authorName(git.authors[id]) }));

  return (
    <Figure
      className={span(4)}
      title="Truck factor"
      subtitle="The fewest people whose departure leaves more than half the files without an active author who knows them (Avelino et al. 2016)"
      height={160}
      empty={
        git.shallow
          ? "Left out of shallow clones: the boundary commit appears to write every file, so ownership would name whoever made it."
          : tf.value < 1
            ? "Not enough authored files to compute a truck factor."
            : null
      }
    >
      {() => (
        <StatTile
          label="People"
          value={formatInt(tf.value)}
          status={level ? { level, label: level === "critical" ? "Critical: one person holds most of the code" : "Warning: two people hold most of the code" } : undefined}
          detail={
            <span>
              {names.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && (i === names.length - 1 ? " and " : ", ")}
                  <button
                    type="button"
                    className="rounded-sm font-semibold text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
                    onClick={() => select({ kind: "author", id: n.id })}
                    onPointerEnter={() => setHover({ kind: "author", id: n.id })}
                    onPointerLeave={() => setHover(null)}
                  >
                    {n.name}
                  </button>
                </span>
              ))}
              {names.length > 0 && (names.length === 1 ? " is the one person" : " are the people")} whose departure would leave more than half the files without a remaining author.
            </span>
          }
        />
      )}
    </Figure>
  );
}

// ─── Contributors ────────────────────────────────────────────────────────────────────────────

function Contributors() {
  const { report, commits, surface, rangePhrase, files } = useScope();
  const git = report.git!;
  const counts = useMemo(() => [...commitsByAuthor(git, commits!).entries()].sort((a, b) => b[1] - a[1]), [git, commits]);
  const total = commits!.length;
  const top = counts.slice(0, 15);
  const rest = counts.slice(15);
  const items: BarItem[] = top.map(([id, n]) => {
    const a = git.authors[id]!;
    return {
      key: id,
      label: authorName(a),
      value: n,
      valueText: formatInt(n),
      color: measureColor(surface),
      target: { kind: "author", id },
      badge: a.bot ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-ink-3">
          <Bot aria-hidden className="size-3" />
          bot
        </span>
      ) : undefined,
      tip: [
        { value: formatShare(n / total), label: `of commits ${rangePhrase}`.trim() },
        { value: formatDate(a.last), label: "last commit" },
        { value: formatInt(a.owned), label: "files owned" },
      ],
    };
  });
  if (rest.length) {
    const n = sum(rest.map(([, c]) => c));
    items.push({ key: "rest", label: `${formatInt(rest.length)} more ${rest.length === 1 ? "person" : "people"}`, value: n, valueText: formatInt(n), color: slotColor(-1, surface), rest: true, tip: [{ value: formatShare(n / total), label: "of commits" }] });
  }
  return (
    <Figure
      className={span(8)}
      title="Contributors"
      subtitle={`Commits ${rangePhrase || "over the whole history"}${files.selective ? " touching files in view" : ""}, top 15 and everyone else`}
      height={items.length * 28}
      empty={total === 0 ? `No commits ${rangePhrase || "here"} touch the files in view.` : null}
      table={() => ({
        columns: [{ label: "Author" }, { label: "Commits", align: "right", mono: true }, { label: "Share", align: "right", mono: true }, { label: "Last commit", mono: true }, { label: "Automation" }],
        rows: counts.map(([id, n]) => [authorName(git.authors[id]), n, { text: formatShare(n / total), sort: n }, { text: formatDate(git.authors[id]!.last), sort: git.authors[id]!.last }, git.authors[id]!.bot ? "Bot" : ""]),
      })}
    >
      {() => <BarList items={items} label="Contributors by commits" labelWidth="30%" />}
    </Figure>
  );
}

// ─── Ownership by top-level directory ────────────────────────────────────────────────────────

interface OwnRow {
  dir: number;
  name: string;
  total: number;
  parts: { slot: number; files: number; authors: number[] }[];
}

function Ownership() {
  const { report, model, files, surface } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const git = report.git!;
  const slots = useMemo(() => authorSlots(git), [git]);
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const rows = useMemo(() => {
    const by = new Map<number, Map<number, number>>();
    for (const id of files.ids) {
      const f = report.files[id]!;
      if (!f.git) continue;
      const d = model.topDir[id]!;
      const m = by.get(d) ?? new Map<number, number>();
      m.set(f.git.owner, (m.get(f.git.owner) ?? 0) + 1);
      by.set(d, m);
    }
    const out: OwnRow[] = [];
    for (const [dir, owners] of by) {
      const parts = new Map<number, { files: number; authors: number[] }>();
      for (const [author, n] of owners) {
        const slot = slots.get(author) ?? -1;
        const p = parts.get(slot) ?? { files: 0, authors: [] };
        p.files += n;
        p.authors.push(author);
        parts.set(slot, p);
      }
      const ordered = [...parts.entries()].sort((a, b) => (a[0] < 0 ? 99 : a[0]) - (b[0] < 0 ? 99 : b[0])).map(([slot, p]) => ({ slot, ...p }));
      out.push({ dir, name: dir === 0 ? "Root files" : report.dirs[dir]!.name, total: sum(ordered.map((p) => p.files)), parts: ordered });
    }
    return out.sort((a, b) => b.total - a.total).slice(0, 12);
  }, [report, model, files, slots]);

  const legendAuthors = [...slots.entries()].sort((a, b) => a[1] - b[1]);
  const anyOther = rows.some((r) => r.parts.some((p) => p.slot === -1));

  return (
    <Figure
      className={span(8)}
      title="Ownership by top-level directory"
      subtitle="Share of each directory's files whose largest author is each person (most lines added); seven people own the most files overall"
      height={rows.length * 30}
      empty={git.shallow ? "Left out of shallow clones: the boundary commit appears to write every file." : rows.length === 0 ? "No files in view have authorship." : null}
      legend={
        <Legend
          items={[
            ...legendAuthors.map(([id, slot]) => ({ label: authorName(git.authors[id]), color: slotColor(slot, surface) })),
            ...(anyOther ? [{ label: "Everyone else", color: slotColor(-1, surface) }] : []),
          ]}
        />
      }
      table={() => ({
        columns: [{ label: "Directory", mono: true }, { label: "Files", align: "right", mono: true }, ...legendAuthors.map(([id]) => ({ label: authorName(git.authors[id]), align: "right" as const, mono: true })), { label: "Everyone else", align: "right", mono: true }],
        rows: rows.map((r) => [r.name, r.total, ...legendAuthors.map(([, slot]) => r.parts.find((p) => p.slot === slot)?.files ?? 0), r.parts.find((p) => p.slot === -1)?.files ?? 0]),
      })}
    >
      {(width) => (
        <div ref={ref} className="relative flex flex-col" onPointerLeave={() => { setTip(null); setHover(null); }}>
          {rows.map((r) => (
            <div key={r.dir} className="grid h-[30px] items-center gap-3" style={{ gridTemplateColumns: "minmax(0, 24%) minmax(0, 1fr) 52px" }}>
              <button
                type="button"
                className="min-w-0 truncate rounded-sm text-left font-mono text-[11px] text-ink hover:underline"
                onClick={() => select({ kind: "dir", id: r.dir })}
                onPointerEnter={() => { setHover({ kind: "dir", id: r.dir }); setTip(null); }}
                title={r.name}
              >
                {r.name}
              </button>
              <div className="flex h-3.5 gap-[2px]">
                {r.parts.map((p) => (
                  <button
                    key={p.slot}
                    type="button"
                    aria-label={`${r.name}: ${p.slot >= 0 ? authorName(git.authors[p.authors[0]!]) : `${p.authors.length} other people`}, ${plural(p.files, "file")}`}
                    className="h-full min-w-px last:rounded-r-[4px] hover:brightness-110 focus-visible:outline-offset-1"
                    style={{ flex: `${p.files} 0 0`, background: slotColor(p.slot, surface) }}
                    onClick={() => p.slot >= 0 && select({ kind: "author", id: p.authors[0]! })}
                    onPointerEnter={(e) => {
                      if (p.slot >= 0) setHover({ kind: "author", id: p.authors[0]! });
                      const box = ref.current!.getBoundingClientRect();
                      const rr = e.currentTarget.getBoundingClientRect();
                      setTip({
                        x: rr.left - box.left + rr.width / 2,
                        y: rr.bottom - box.top + 4,
                        title: `${r.name}: ${p.slot >= 0 ? authorName(git.authors[p.authors[0]!]) : `${formatInt(p.authors.length)} other ${p.authors.length === 1 ? "person" : "people"}`}`,
                        rows: [{ value: formatInt(p.files), label: p.files === 1 ? "file owned" : "files owned" }, { value: formatShare(p.files / r.total), label: "of the directory" }],
                      });
                    }}
                  />
                ))}
              </div>
              <span className="figures text-right font-mono text-[11px] text-ink-2">{formatInt(r.total)}</span>
            </div>
          ))}
          <ChartTooltip tip={tip} width={width} />
        </div>
      )}
    </Figure>
  );
}

// ─── Commit concentration ────────────────────────────────────────────────────────────────────

function Concentration() {
  const { report, commits, surface, rangePhrase, files, from } = useScope();
  const git = report.git!;
  const values = useMemo(() => [...commitsByAuthor(git, commits!).values()], [git, commits]);
  const curve = useMemo(() => lorenz(values), [values]);
  // The analyzer's Gini covers every commit; a narrowed slice needs its own.
  const g = !files.selective && from === null && report.stats.commitsPerAuthor ? report.stats.commitsPerAuthor.gini : gini(values);
  const n = values.filter((v) => v > 0).length;
  const desc = [...values].sort((a, b) => b - a);
  const total = sum(desc);
  const k = n >= 20 ? Math.max(1, Math.round(n * 0.1)) : 1;
  const topShare = total ? sum(desc.slice(0, k)) / total : 0;
  const headline = n >= 20 ? `The top 10% of authors (${formatInt(k)}) made ${formatShare(topShare)} of commits` : `The most active author made ${formatShare(topShare)} of commits`;
  const { active, setActive, focusProps } = useActiveIndex(curve.length);

  return (
    <Figure
      className={span(4)}
      title="Commit concentration"
      subtitle={`${headline}${rangePhrase ? ` ${rangePhrase}` : ""}. The diagonal is perfectly even.`}
      height={260}
      empty={n < 2 ? "Fewer than two authors, so there is no concentration to measure." : null}
      table={() => ({
        columns: [{ label: "Share of authors (fewest commits first)", mono: true }, { label: "Share of commits", align: "right", mono: true }],
        rows: curve.filter((_, i) => i % Math.max(1, Math.floor(curve.length / 20)) === 0 || i === curve.length - 1).map((p) => [{ text: formatShare(p.x), sort: p.x }, { text: formatShare(p.y), sort: p.y }]),
      })}
    >
      {(width) => {
        const H = 260;
        const ML = 38;
        const MB = 22;
        const size = Math.min(width - ML - 8, H - MB - 8);
        const x = d3.scaleLinear().domain([0, 1]).range([ML, ML + size]);
        const y = d3.scaleLinear().domain([0, 1]).range([8 + size, 8]);
        const line = d3.line<{ x: number; y: number }>().x((p) => x(p.x)).y((p) => y(p.y))(curve) ?? "";
        const gap = `${line}L${x(1)},${y(1)}L${x(0)},${y(0)}Z`;
        const ticks = [0, 0.25, 0.5, 0.75, 1];
        const p = active !== null ? curve[active] : undefined;
        const bisect = d3.bisector((q: { x: number }) => q.x).center;
        return (
          <div className="relative">
            <svg
              width={width}
              height={H}
              role="img"
              aria-label={`Lorenz curve of commits per author, Gini ${g.toFixed(2)}`}
              className="block outline-offset-4"
              {...focusProps}
              onPointerMove={(e) => {
                const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
                const v = x.invert(mx);
                setActive(v >= 0 && v <= 1 ? bisect(curve, v) : null);
              }}
              onPointerLeave={() => setActive(null)}
            >
              <YGrid ticks={ticks.map((t) => ({ pos: y(t), label: formatShare(t) }))} x0={x(0)} x1={x(1)} />
              <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="stroke-rule-strong" strokeWidth={1} />
              <path d={gap} fill={measureColor(surface)} fillOpacity={0.1} />
              <path d={line} fill="none" stroke={measureColor(surface)} strokeWidth={2} strokeLinejoin="round" />
              <XAxis ticks={ticks.map((t) => ({ pos: x(t), label: formatShare(t) }))} y={y(0)} x0={x(0)} x1={x(1)} />
              <text x={x(0) + 8} y={y(1) + 18} className="fill-ink text-[22px] font-semibold [font-stretch:85%]">
                Gini {g.toFixed(2)}
              </text>
              <text x={x(0) + 8} y={y(1) + 34} className="fill-ink-3 text-[11px]">
                0 is even, 1 is one author
              </text>
              {p && (
                <g pointerEvents="none">
                  <line x1={x(p.x)} x2={x(p.x)} y1={y(1)} y2={y(0)} className="stroke-ink-3" strokeWidth={1} />
                  <circle cx={x(p.x)} cy={y(p.y)} r={4} fill={measureColor(surface)} stroke={surfaceColor(surface)} strokeWidth={2} />
                </g>
              )}
            </svg>
            <ChartTooltip
              width={width}
              tip={
                p
                  ? {
                      x: x(p.x),
                      y: Math.max(0, y(p.y) - 30),
                      title: `The top ${formatShare(1 - p.x)} of authors`,
                      rows: [{ value: formatShare(1 - p.y), label: "of commits" }],
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

// ─── Knowledge islands ───────────────────────────────────────────────────────────────────────

function KnowledgeIslands() {
  const { report, files } = useScope();
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const selectedId = useViewer((s) => (s.selection?.kind === "file" ? s.selection.id : -1));
  const git = report.git!;
  const islands = useMemo(() => {
    const inactive = inactiveAuthors(git);
    return files.ids
      .map((id) => report.files[id]!)
      .filter((f) => isOwnCode(f) && f.git && f.git.ownership >= 0.9 && inactive.has(f.git.owner))
      .sort((a, b) => b.code - a.code || a.id - b.id);
  }, [report, files, git]);
  const owners = new Set(islands.map((f) => f.git!.owner));
  const columns: Column<FileRecord>[] = [
    { key: "path", label: "File", mono: true, width: "40%", sort: (f) => f.path, render: (f) => <PathText path={f.path} /> },
    {
      key: "owner",
      label: "Written by",
      sort: (f) => authorName(git.authors[f.git!.owner]),
      render: (f) => (
        <button
          type="button"
          className="underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
          onClick={(e) => {
            e.stopPropagation();
            select({ kind: "author", id: f.git!.owner });
          }}
        >
          {authorName(git.authors[f.git!.owner])}
        </button>
      ),
    },
    { key: "share", label: "Their share", align: "right", mono: true, sort: (f) => f.git!.ownership, render: (f) => formatShare(f.git!.ownership) },
    { key: "last", label: "Their last commit", mono: true, sort: (f) => git.authors[f.git!.owner]!.last, render: (f) => formatDate(git.authors[f.git!.owner]!.last) },
    { key: "code", label: "Code lines", align: "right", mono: true, sort: (f) => f.code, render: (f) => formatInt(f.code) },
  ];
  return (
    <Figure
      className={span(12)}
      title="Knowledge islands"
      subtitle={
        islands.length
          ? `${plural(islands.length, "source file")} 90% or more written by ${plural(owners.size, "person", "people")} with no commits in the year before the newest one`
          : "Source files 90% or more written by someone with no commits in the year before the newest one"
      }
      height={160}
      empty={
        git.shallow
          ? "Left out of shallow clones: the boundary commit appears to write every file."
          : islands.length === 0
            ? "No knowledge islands in view: every source file that one person wrote is still in active hands."
            : null
      }
    >
      {() => (
        <DataTable
          columns={columns}
          rows={islands}
          rowKey={(f) => f.id}
          initialSort={{ key: "code", dir: "desc" }}
          pageSize={8}
          caption="Knowledge islands"
          onRowClick={(f) => select({ kind: "file", id: f.id })}
          onRowHover={(f) => setHover(f ? { kind: "file", id: f.id } : null)}
          isSelected={(f) => f.id === selectedId}
        />
      )}
    </Figure>
  );
}

