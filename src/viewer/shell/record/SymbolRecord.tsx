/**
 * The record for a symbol: the code-intelligence panel.
 *
 * Signature, docs and flags first; then the figures (references, callers, files); then the call
 * hierarchy, the type hierarchy and every reference grouped by file with a one-line snippet.
 *
 * Every row that names a place opens the source reader there with the name marked, and keeps
 * this symbol selected, so the galaxy's lighting for it stays on while the reader follows a
 * call site. The crosshair at the end of a row is the other move: make that symbol the subject
 * of the record instead.
 */

import { ArrowUpRight, ChevronRight, Crosshair, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { REF_KINDS, SymbolFlag, type CodeSymbols, type Report } from "../../../shared/schema";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { formatInt, plural } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { SymbolModel } from "../../model/symbols";
import { useViewer } from "../../state/store";
import { linesOf, useSourceText } from "../../source/useSource";
import { callEdges, callSite, heritage, type CallEdge } from "../derived";
import { SYMBOL_KIND_LABEL, symbolFlagLabels } from "../labels";
import { openSourceKeepingSymbol, openSymbolDefinition, show } from "../navigate";
import { MetricGrid, MoreButton, PathText, Quiet, Section, Tag, type Metric } from "../parts";
import { RecordHeading } from "./common";

interface Ctx {
  report: Report;
  symbols: CodeSymbols;
  sm: SymbolModel;
}

export function SymbolRecordView({ report, symbols, sm, id }: Ctx & { id: number }) {
  const t = symbols.symbols;
  const kind = t.kind[id]!;
  const file = report.files[t.file[id]!];
  const parent = t.parent[id]!;
  const flags = symbolFlagLabels(t.flags[id]!, kind);
  const callable = ["function", "method", "constructor", "getter", "setter", "component", "hook"].includes(kind);
  const lines = t.endLine[id]! - t.line[id]! + 1;

  const metrics: Metric[] = [
    { label: "References", value: formatInt(t.refs[id]!) },
    { label: "Callers", value: formatInt(t.callers[id]!), note: "distinct symbols using it" },
    { label: "Files", value: formatInt(t.files[id]!), note: "that reference it" },
    { label: "Lines", value: formatInt(lines) },
  ];
  if (callable) {
    metrics.push({ label: "Complexity", value: formatInt(t.complexity[id]!) });
    metrics.push({ label: "Parameters", value: formatInt(t.params[id]!) });
  }

  return (
    <div className="flex flex-col gap-5">
      <RecordHeading
        above={parent >= 0 ? `${t.name[parent]}.` : undefined}
        title={t.name[id]}
        titleClass="font-mono text-[19px] font-semibold [font-stretch:100%]"
      >
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-ink-2">{SYMBOL_KIND_LABEL[kind]}</span>
          {flags.map((f) => (
            <Tag key={f}>{f}</Tag>
          ))}
        </div>
      </RecordHeading>

      {t.signature[id] && (
        <pre className="border-y border-rule bg-tray px-2.5 py-2 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {t.signature[id]}
        </pre>
      )}
      {t.doc[id] && <p className="-mt-2 text-[13px] text-ink-2 italic">{t.doc[id]}</p>}

      {file && (
        <button
          type="button"
          onClick={() => openSymbolDefinition(symbols, id)}
          className="group -mt-1 flex w-full min-w-0 items-baseline gap-1.5 text-left text-[13px] text-ink-2"
        >
          <span className="shrink-0">Defined in</span>
          <PathText
            path={file.path}
            line={t.line[id]! + 1}
            className="text-xs text-ink underline decoration-rule-strong underline-offset-[3px] group-hover:decoration-ink"
          />
          <ArrowUpRight aria-hidden className="size-3.5 shrink-0 self-center text-ink-3" />
        </button>
      )}

      <MetricGrid items={metrics} />

      {t.flags[id]! & SymbolFlag.unusedExport ? (
        <Quiet className="-mt-3">Exported, but nothing outside {file?.name ?? "its file"} uses it.</Quiet>
      ) : null}
      {parent >= 0 && (
        <Quiet className="-mt-3">
          Member of{" "}
          <button type="button" className="font-mono text-xs text-ink underline underline-offset-2" onClick={() => show({ kind: "symbol", id: parent })}>
            {t.name[parent]}
          </button>
          .
        </Quiet>
      )}

      <CallHierarchy report={report} symbols={symbols} sm={sm} id={id} />
      <TypeHierarchy report={report} symbols={symbols} sm={sm} id={id} />
      <References key={id} report={report} symbols={symbols} sm={sm} id={id} />
    </div>
  );
}

// ─── Call hierarchy ──────────────────────────────────────────────────────────────────────────

function CallHierarchy({ id, ...ctx }: Ctx & { id: number }) {
  const incoming = useMemo(() => callEdges(ctx.symbols, id, "incoming"), [ctx.symbols, id]);
  const outgoing = useMemo(() => callEdges(ctx.symbols, id, "outgoing"), [ctx.symbols, id]);
  return (
    <Section title="Call hierarchy">
      <Tabs defaultValue={incoming.length || !outgoing.length ? "incoming" : "outgoing"} className="gap-0">
        <TabsList variant="line" className="h-8 w-full justify-start gap-0 rounded-none border-b border-rule p-0">
          {(
            [
              ["incoming", "Incoming", incoming.length],
              ["outgoing", "Outgoing", outgoing.length],
            ] as const
          ).map(([value, label, n]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-full flex-none rounded-none border-0 border-b-2 border-transparent px-2.5 text-[13px] font-medium text-ink-3 after:hidden data-[state=active]:border-ink data-[state=active]:text-ink dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-ink"
            >
              {label}
              <span className="figures font-mono text-xs font-normal text-ink-3">{formatInt(n)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="incoming">
          <EdgeList {...ctx} root={id} edges={incoming} direction="incoming" />
        </TabsContent>
        <TabsContent value="outgoing">
          <EdgeList {...ctx} root={id} edges={outgoing} direction="outgoing" />
        </TabsContent>
      </Tabs>
    </Section>
  );
}

type Direction = "incoming" | "outgoing";
/**
 * Rows shown before "Show more". It was 25: for a hub like a vector constructor that is a
 * thousand pixels of callers in a 340px column, and the References section under it (the
 * actual call sites, with code) started two screens down. Ten matches References' own cap.
 */
const EDGE_CAP = 10;

function EdgeList({
  root,
  edges,
  direction,
  ancestors,
  depth = 0,
  ...ctx
}: Ctx & { root: number; edges: CallEdge[]; direction: Direction; ancestors?: ReadonlySet<number>; depth?: number }) {
  const [limit, setLimit] = useState(EDGE_CAP);
  const chain = useMemo(() => new Set([...(ancestors ?? []), root]), [ancestors, root]);
  if (edges.length === 0 && depth === 0) {
    return <Quiet>{direction === "incoming" ? "Nothing in the project calls or uses it." : "It calls or uses nothing in the project."}</Quiet>;
  }
  return (
    <ul>
      {edges.slice(0, limit).map((e) => (
        <EdgeRow key={e.symbol} {...ctx} edge={e} parent={root} direction={direction} ancestors={chain} depth={depth} />
      ))}
      {edges.length > limit && (
        <li style={{ paddingLeft: 22 + depth * 14 }}>
          <MoreButton hidden={edges.length - limit} onClick={() => setLimit((l) => l + 50)} />
        </li>
      )}
    </ul>
  );
}

function EdgeRow({
  edge,
  parent,
  direction,
  ancestors,
  depth,
  ...ctx
}: Ctx & { edge: CallEdge; parent: number; direction: Direction; ancestors: ReadonlySet<number>; depth: number }) {
  const [open, setOpen] = useState(false);
  const { symbols, sm, report } = ctx;
  const t = symbols.symbols;
  const s = edge.symbol;
  const cycle = ancestors.has(s);
  // Children are only computed for an open row: a hub function's full tree would be huge.
  const children = useMemo(() => (open && !cycle ? callEdges(symbols, s, direction) : null), [open, cycle, symbols, s, direction]);
  const expandable = !cycle && (direction === "incoming" ? sm.callersOf : sm.calleesOf).offsets[s + 1]! > (direction === "incoming" ? sm.callersOf : sm.calleesOf).offsets[s]!;
  const isModule = t.kind[s] === "module";
  const file = report.files[t.file[s]!];

  const site = () => {
    const from = direction === "incoming" ? s : parent;
    const to = direction === "incoming" ? parent : s;
    const hit = callSite(symbols, sm.refsOf, from, to);
    if (hit) openSourceKeepingSymbol({ file: hit.file, line: hit.line, marks: [hit] });
  };

  return (
    <li>
      <div className="group flex min-w-0 items-center border-b border-rule" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          aria-label={expandable ? `${open ? "Collapse" : "Expand"} ${direction === "incoming" ? "callers" : "callees"} of ${t.name[s]}` : undefined}
          className="grid size-6 shrink-0 place-items-center text-ink-3 hover:text-ink disabled:invisible"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-damped", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={site}
          title={direction === "incoming" ? "Open the source where it calls this" : "Open the source where this calls it"}
          className="flex min-w-0 flex-1 flex-col py-1 text-left transition-colors duration-150 hover:bg-wash"
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-mono text-xs text-ink">{isModule ? (file?.name ?? "module") : t.name[s]}</span>
            <span className="shrink-0 text-[11px] text-ink-3">{isModule ? "top level" : SYMBOL_KIND_LABEL[t.kind[s]!].toLowerCase()}</span>
          </span>
          {file && <PathText path={file.path} line={isModule ? undefined : t.line[s]! + 1} className="text-[11px] text-ink-3" />}
        </button>
        <span className="figures shrink-0 px-1.5 font-mono text-[11px] text-ink-3" title={edge.kinds.map((k) => REF_KINDS[k]).join(", ")}>
          {cycle ? (
            <span className="inline-flex items-center gap-1">
              <Repeat aria-hidden className="size-3" />
              recursive
            </span>
          ) : (
            `${REF_KINDS[edge.kinds[0]!]}${edge.count > 1 ? ` ×${formatInt(edge.count)}` : ""}`
          )}
        </span>
        {!isModule && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => show({ kind: "symbol", id: s })}
                aria-label={`Show the record for ${t.name[s]}`}
                className="shrink-0 text-ink-3 opacity-60 group-hover:opacity-100"
              >
                <Crosshair />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Show its record</TooltipContent>
          </Tooltip>
        )}
      </div>
      {open && children && (
        <EdgeList {...ctx} root={s} edges={children} direction={direction} ancestors={ancestors} depth={depth + 1} />
      )}
      {open && children?.length === 0 && (
        <Quiet className="border-b border-rule text-xs" >
          <span style={{ paddingLeft: 22 + (depth + 1) * 14 }}>{direction === "incoming" ? "No callers." : "No callees."}</span>
        </Quiet>
      )}
    </li>
  );
}

// ─── Type hierarchy ──────────────────────────────────────────────────────────────────────────

function TypeHierarchy({ id, ...ctx }: Ctx & { id: number }) {
  const { bases, derived } = useMemo(() => heritage(ctx.symbols, id), [ctx.symbols, id]);
  if (bases.length === 0 && derived.length === 0) return null;
  const t = ctx.symbols.symbols;
  const row = (s: number, kind: number) => {
    const file = ctx.report.files[t.file[s]!];
    return (
      <div key={s} className="group flex min-w-0 items-center border-b border-rule">
        <button
          type="button"
          onClick={() => {
            const line = t.line[s]!;
            openSourceKeepingSymbol({ file: t.file[s]!, line, marks: [{ line, col: t.col[s]!, len: t.name[s]!.length }] });
          }}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-wash"
        >
          <Tag className="w-[68px] justify-center">{REF_KINDS[kind]}</Tag>
          <span className="truncate font-mono text-xs text-ink">{t.parent[s]! >= 0 ? `${t.name[t.parent[s]!]}.${t.name[s]}` : t.name[s]}</span>
          {file && <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{file.name}</span>}
        </button>
        <Button variant="ghost" size="icon-xs" onClick={() => show({ kind: "symbol", id: s })} aria-label={`Show the record for ${t.name[s]}`} className="shrink-0 text-ink-3 opacity-60 group-hover:opacity-100">
          <Crosshair />
        </Button>
      </div>
    );
  };
  return (
    <>
      {bases.length > 0 && (
        <Section title="Extends and implements" count={bases.length}>
          <div className="border-t border-rule">{bases.map((b) => row(b.symbol, b.kind))}</div>
        </Section>
      )}
      {derived.length > 0 && (
        <Section title="Implementations" count={derived.length}>
          <div className="border-t border-rule">{derived.map((d) => row(d.symbol, d.kind))}</div>
        </Section>
      )}
    </>
  );
}

// ─── References ──────────────────────────────────────────────────────────────────────────────

const GROUP_CAP = 8;
const ROW_CAP = 10;
const OPEN_BY_DEFAULT = 4;

function References({ id, ...ctx }: Ctx & { id: number }) {
  const { symbols, sm, report } = ctx;
  const r = symbols.refs;
  const [kind, setKind] = useState<string>("all");
  const [groupLimit, setGroupLimit] = useState(GROUP_CAP);

  const all = useMemo(() => {
    const out: number[] = [];
    for (let i = sm.refsOf.offsets[id]!; i < sm.refsOf.offsets[id + 1]!; i++) out.push(sm.refsOf.targets[i]!);
    return out;
  }, [sm, id]);

  const kindCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of all) counts.set(r.kind[row]!, (counts.get(r.kind[row]!) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [all, r]);

  const groups = useMemo(() => {
    const k = kind === "all" ? -1 : Number(kind);
    const byFile = new Map<number, number[]>();
    for (const row of all) {
      if (k >= 0 && r.kind[row] !== k) continue;
      const f = r.file[row]!;
      const list = byFile.get(f);
      if (list) list.push(row);
      else byFile.set(f, [row]);
    }
    return [...byFile]
      .map(([file, rows]) => ({ file, rows }))
      .sort((a, b) => b.rows.length - a.rows.length || report.files[a.file]!.path.localeCompare(report.files[b.file]!.path));
  }, [all, kind, r, report]);

  const total = symbols.symbols.refs[id]!;
  const dropped = total - all.length;

  return (
    <Section title="References" count={all.length}>
      {all.length === 0 ? (
        <Quiet>No resolved references in the project.</Quiet>
      ) : (
        <>
          {kindCounts.length > 1 && (
            <ToggleGroup
              type="single"
              value={kind}
              onValueChange={(v) => v && setKind(v)}
              variant="outline"
              size="sm"
              className="mb-2 flex-wrap"
              aria-label="Filter references by kind"
            >
              <ToggleGroupItem value="all" className="h-7 px-2 text-xs text-ink-3 data-[state=on]:bg-wash data-[state=on]:font-semibold data-[state=on]:text-ink">
                All
              </ToggleGroupItem>
              {kindCounts.map(([k, n]) => (
                <ToggleGroupItem key={k} value={String(k)} className="h-7 gap-1 px-2 text-xs text-ink-3 data-[state=on]:bg-wash data-[state=on]:font-semibold data-[state=on]:text-ink">
                  {REF_KINDS[k]}
                  <span className="figures font-mono text-[11px] text-ink-3">{formatInt(n)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <div className="border-t border-rule">
            {groups.slice(0, groupLimit).map((g, i) => (
              <RefGroup key={`${kind}:${g.file}`} {...ctx} file={g.file} rows={g.rows} defaultOpen={i < OPEN_BY_DEFAULT} />
            ))}
          </div>
          <MoreButton hidden={groups.length - groupLimit} noun={groups.length - groupLimit === 1 ? "more file" : "more files"} onClick={() => setGroupLimit((l) => l + 20)} />
          {dropped > 0 && (
            <Quiet className="text-xs">
              {plural(dropped, "reference")} beyond these were left out by the report's size cap; the totals above still count them.
            </Quiet>
          )}
        </>
      )}
    </Section>
  );
}

function RefGroup({ file, rows, defaultOpen, ...ctx }: Ctx & { file: number; rows: number[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [limit, setLimit] = useState(ROW_CAP);
  const f = ctx.report.files[file]!;
  const source = useSourceText(open ? file : null);
  const r = ctx.symbols.refs;
  const lines = source.status === "ready" ? linesOf(file, source.text) : null;
  const activeSource = useViewer((s) => s.source);

  return (
    <div className="border-b border-rule">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={f.path}
        className="flex w-full min-w-0 items-center gap-1 py-1.5 text-left transition-colors duration-150 hover:bg-wash"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-200 ease-damped", open && "rotate-90")} />
        <PathText path={f.path} className="flex-1 text-xs text-ink" />
        <span className="figures shrink-0 font-mono text-[11px] text-ink-3">{formatInt(rows.length)}</span>
      </button>
      {open && (
        <ul className="pb-1">
          {rows.slice(0, limit).map((row) => {
            const line = r.line[row]!;
            const col = r.col[row]!;
            const len = r.len[row]!;
            const current =
              activeSource?.file === file && activeSource.line === line && activeSource.marks?.some((m) => m.col === col);
            return (
              <li key={row}>
                <button
                  type="button"
                  onClick={() => openSourceKeepingSymbol({ file, line, marks: [{ line, col, len }] })}
                  aria-current={current || undefined}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-1.5 py-[3px] pr-1 pl-3 text-left transition-colors duration-150 hover:bg-wash",
                    current && "bg-wash",
                  )}
                >
                  <span className="figures w-8 shrink-0 text-right font-mono text-[11px] text-ink-3">{line + 1}</span>
                  <Tag className="w-[46px] justify-center">{REF_KINDS[r.kind[row]!]}</Tag>
                  <Snippet text={lines ? (lines[line] ?? "") : null} col={col} len={len} loading={source.status === "loading"} />
                </button>
              </li>
            );
          })}
          {rows.length > limit && (
            <li className="pl-5">
              <MoreButton hidden={rows.length - limit} onClick={() => setLimit((l) => l + 40)} />
            </li>
          )}
          {source.status === "unavailable" && (
            <li className="pl-5">
              <Quiet className="text-xs">No embedded source for this file, so lines are shown by number only.</Quiet>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** One line of code around a reference, trimmed to the record's width, the name marked. */
function Snippet({ text, col, len, loading }: { text: string | null; col: number; len: number; loading: boolean }) {
  if (text === null) {
    return loading ? <span className="h-2.5 w-2/3 animate-pulse rounded-xs bg-wash" aria-hidden /> : <span className="flex-1" />;
  }
  const clean = text.replace(/\r$/, "");
  const indent = clean.length - clean.trimStart().length;
  // The record leaves room for ~24 characters. Lead with at most 8 before the name so the name
  // itself is what survives the truncation.
  const lead = Math.min(8, Math.max(2, 22 - len));
  const start = Math.max(Math.min(indent, col), col - lead);
  const end = Math.min(clean.length, col + len + 40);
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] whitespace-pre text-ink-2">
      {start > indent && <span className="text-ink-3">…</span>}
      {clean.slice(start, col)}
      <mark className="rounded-[2px] bg-[#d6e6fa] font-semibold text-ink dark:bg-[#1f3550]">{clean.slice(col, col + len)}</mark>
      {clean.slice(col + len, end)}
      {end < clean.length && <span className="text-ink-3">…</span>}
    </span>
  );
}
