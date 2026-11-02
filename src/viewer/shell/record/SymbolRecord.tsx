/**
 * The record for a symbol: the code-intelligence panel.
 *
 * Signature, docs and flags first; then the figures (references, callers, files); then the call
 * hierarchy, the type hierarchy and every reference grouped by file with a one-line snippet.
 *
 * Every row that names a place opens the source reader there with the name marked, and keeps
 * this symbol selected, so the galaxy's lighting for it stays on while the reader follows a
 * call site. The crosshair at the end of a row is the other move: make that symbol the subject
 * of the record instead. The trail at the top walks those moves back (shell/trail.ts).
 *
 * Tests are grouped last everywhere. For a hub like a vector constructor most callers are test
 * files' top level (171 of 283 for vec3), and listed by count they filled the first screen, so
 * the production callers a reader came for started below the fold.
 */

import { ArrowUpRight, ChevronLeft, ChevronRight, Crosshair, Repeat } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { REF_KINDS, SymbolFlag, type CodeSymbols, type Report, type SymbolKind } from "../../../shared/schema";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { formatInt, plural } from "../../lib/format";
import { cn } from "../../lib/utils";
import { hostUsesOf, type HostUse, type SymbolModel } from "../../model/symbols";
import { useViewer } from "../../state/store";
import { linesOf, useSourceText } from "../../source/useSource";
import {
  callEdges,
  callSite,
  callsThroughBases,
  FUNCTION_LIKE,
  heritage,
  HERITAGE_KINDS,
  partitionByCall,
  partitionTypeRefs,
  selfCalls,
  type CallEdge,
} from "../derived";
import { InlineDoc } from "../inline-doc";
import { SYMBOL_KIND_LABEL, symbolFlagLabels } from "../labels";
import { dig, openSourceKeepingSymbol, openSymbolDefinition } from "../navigate";
import { LanguageSwatch, MetricGrid, MoreButton, PathText, Quiet, Section, Tag, type Metric } from "../parts";
import { step, stepTo, useTrail } from "../trail";
import { RecordHeading, ShowInGalaxy } from "./common";

interface Ctx {
  report: Report;
  symbols: CodeSymbols;
  sm: SymbolModel;
}

/** Declared in a test file: by the checker's flag, or by the file's category. */
function inTest(ctx: Ctx, s: number): boolean {
  const t = ctx.symbols.symbols;
  return (t.flags[s]! & SymbolFlag.test) !== 0 || ctx.report.files[t.file[s]!]?.category === "test";
}

/** "SaveStore.read" for a member, "vec3" for anything else. */
function qualified(symbols: CodeSymbols, s: number): string {
  const t = symbols.symbols;
  return t.parent[s]! >= 0 ? `${t.name[t.parent[s]!]}.${t.name[s]}` : t.name[s]!;
}

/**
 * How the record names a symbol's dependents. The analyzer's `callers` counts every symbol that
 * names it, so an interface read "Callers 435" over 435 type annotations, and a function passed
 * as a callback 28 times and called 12 read "Callers 40". Functions and classes split the figure
 * into the symbols that invoke it and the ones that only name it; every other kind's dependents
 * are "Used by", with the callers among them in the note (a variable holding a logger is called,
 * an interface never is).
 */
function usageWords(kind: SymbolKind) {
  const functionLike = FUNCTION_LIKE.has(kind);
  return {
    split: functionLike || kind === "class",
    callers: kind === "class" ? "Constructed by" : "Callers",
    section: functionLike ? "Call hierarchy" : "Usage",
    incoming: functionLike ? "Incoming" : "Used by",
    outgoing: functionLike ? "Outgoing" : "Uses",
    /** What a dependent is called in sentences: "No TypeScript callers". */
    dependents: functionLike ? "callers" : "users",
  };
}

export function SymbolRecordView({ report, symbols, sm, id }: Ctx & { id: number }) {
  const t = symbols.symbols;
  const kind = t.kind[id]!;
  const file = report.files[t.file[id]!];
  const parent = t.parent[id]!;
  const flags = symbolFlagLabels(t.flags[id]!, kind);
  const callable = ["function", "method", "constructor", "getter", "setter", "component", "hook"].includes(kind);
  const lines = t.endLine[id]! - t.line[id]! + 1;
  const through = useMemo(() => callsThroughBases(symbols, id), [symbols, id]);
  const self = useMemo(() => selfCalls(symbols, id), [symbols, id]);
  const incoming = useMemo(() => callEdges(symbols, id, "incoming"), [symbols, id]);
  const byCall = useMemo(() => partitionByCall(incoming), [incoming]);
  const hosts = useMemo(() => hostUsesOf(symbols, id), [symbols, id]);
  const members = useMemo(() => (kind === "class" ? t.parent.reduce((n, p) => (p === id ? n + 1 : n), 0) : 0), [kind, t, id]);
  const words = usageWords(kind);
  if (self > 0) flags.push("recursive");

  // Pairs fill the two-column grid row by row: what references it, who depends on it, then its
  // own shape. Lines takes a cell only when the count is odd and otherwise rides as the
  // complexity note, so no kind ends the grid on a half-empty row.
  const metrics: Metric[] = [
    {
      label: "References",
      value: formatInt(t.refs[id]!),
      note: hosts.length > 0 ? `+${formatInt(hosts.length)} outside TypeScript` : undefined,
    },
    { label: "Files", value: formatInt(t.files[id]!), note: "that reference it" },
  ];
  if (words.split) {
    metrics.push({ label: words.callers, value: formatInt(byCall.calls.length), note: kind === "class" ? "symbols using new" : "symbols calling it" });
    metrics.push({ label: "Other uses", value: formatInt(byCall.other.length), note: kind === "class" ? "as a type or value" : "name it, no call" });
  } else {
    const calls = byCall.calls.length;
    metrics.push({ label: "Used by", value: formatInt(t.callers[id]!), note: calls > 0 ? `${formatInt(calls)} of them call it` : "distinct symbols" });
  }
  // The Incoming tab counts callers that reach this through the interface or base method it
  // implements; without this cell, Callers + Other uses fell short of Incoming by exactly them.
  const throughCount = through.reduce((n, g) => n + g.edges.length, 0);
  if (throughCount > 0) {
    // Same rule the galaxy legend uses: a base whose parent is a class is overridden, not implemented.
    const viaClass = through.every((g) => t.parent[g.base]! >= 0 && t.kind[t.parent[g.base]!] === "class");
    metrics.push({
      label: viaClass ? "Through the base method" : "Through the interface",
      value: formatInt(throughCount),
      note: viaClass ? "callers of what it overrides" : "callers of what it implements",
    });
  }
  if (callable) {
    metrics.push({ label: "Complexity", value: formatInt(t.complexity[id]!) });
    metrics.push({ label: "Parameters", value: formatInt(t.params[id]!) });
  } else if (kind === "class") {
    metrics.push({ label: "Members", value: formatInt(members) });
  }
  if (metrics.length % 2 === 1) metrics.push({ label: "Lines", value: formatInt(lines) });
  else if (callable) metrics[metrics.length - 2]!.note = plural(lines, "line");

  return (
    <div className="flex flex-col gap-5">
      <TrailBar symbols={symbols} id={id} />
      <RecordHeading
        above={parent >= 0 ? `${t.name[parent]}.` : undefined}
        title={t.name[id]}
        titleClass="font-mono text-[19px] font-semibold [font-stretch:100%]"
        action={<ShowInGalaxy />}
      >
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-ink-2">{SYMBOL_KIND_LABEL[kind]}</span>
          {flags.map((f) => (
            <Tag key={f}>{f}</Tag>
          ))}
        </div>
      </RecordHeading>

      {t.signature[id] && (
        <pre className="border-y border-rule bg-tray px-2.5 py-2 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink [font-variant-ligatures:none]">
          {t.signature[id]}
        </pre>
      )}
      {t.doc[id] && (
        <p className="-mt-2 text-[13px] text-ink-2 italic">
          <InlineDoc text={t.doc[id]} italic />
        </p>
      )}

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

      {/* The figures count only callers that name this symbol; say so when the real ones
          reach it through an interface, or "Callers 0" reads as dead code. */}
      {t.callers[id] === 0 && through.length > 0 && (
        <Quiet className="-mt-3">
          Called through {through.map((g) => qualified(symbols, g.base)).join(" and ")}: nothing names it directly.
        </Quiet>
      )}
      {t.flags[id]! & SymbolFlag.unusedExport ? (
        <Quiet className="-mt-3">Exported, but nothing outside {file?.name ?? "its file"} uses it.</Quiet>
      ) : null}
      {parent >= 0 && (
        <Quiet className="-mt-3">
          Member of{" "}
          <button type="button" className="font-mono text-xs text-ink underline underline-offset-2" onClick={() => dig({ kind: "symbol", id: parent })}>
            {t.name[parent]}
          </button>
          .
        </Quiet>
      )}

      <CallHierarchy
        report={report}
        symbols={symbols}
        sm={sm}
        id={id}
        incoming={incoming}
        through={through}
        self={self}
        hosts={hosts}
        words={words}
      />
      <TypeHierarchy report={report} symbols={symbols} sm={sm} id={id} />
      <References key={id} report={report} symbols={symbols} sm={sm} id={id} hosts={hosts} />
    </div>
  );
}

// ─── Trail ───────────────────────────────────────────────────────────────────────────────────

/** Crumbs shown before the oldest fold into "…"; the record is 340px wide. */
const CRUMBS = 3;

/** Back, Forward and the symbols dug through to get here. Hidden until there is a trail. */
function TrailBar({ symbols, id }: { symbols: CodeSymbols; id: number }) {
  const trail = useTrail((s) => s.trail);
  const at = useTrail((s) => s.at);
  if (trail.length < 2) return null;
  const t = symbols.symbols;
  // The record can show a symbol that is not the trail's current one only for a moment (the
  // selection lands before the subscription records it); treat it as the newest step.
  const here = trail[at] === id ? at : trail.indexOf(id);
  const canBack = here > 0 || here === -1;
  const canForward = here >= 0 && here < trail.length - 1;
  const first = Math.max(0, trail.length - CRUMBS);
  const name = (i: number) => t.name[trail[i]!] ?? "";
  return (
    <nav aria-label="Symbols you dug through" className="-mt-1 -mb-2 flex min-w-0 items-center gap-0.5 text-xs text-ink-3">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!canBack}
        onClick={() => step(-1)}
        aria-label={canBack ? `Back to ${name(here === -1 ? at : here - 1)}` : "Back"}
        aria-keyshortcuts="["
        title="Back (press [)"
        className="text-ink-3"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!canForward}
        onClick={() => step(1)}
        aria-label={canForward ? `Forward to ${name(here + 1)}` : "Forward"}
        aria-keyshortcuts="]"
        title="Forward (press ])"
        className="mr-1 text-ink-3"
      >
        <ChevronRight />
      </Button>
      <ol className="flex min-w-0 items-center gap-1">
        {first > 0 && (
          <li className="shrink-0" aria-hidden>
            …
          </li>
        )}
        {trail.slice(first).map((s, k) => {
          const i = first + k;
          const current = i === here;
          return (
            <li key={`${i}:${s}`} className="flex min-w-0 items-center gap-1">
              {k > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" />}
              <button
                type="button"
                onClick={() => stepTo(i)}
                aria-current={current ? "step" : undefined}
                title={qualified(symbols, s)}
                className={cn(
                  "min-w-0 truncate font-mono underline-offset-2 hover:text-ink hover:underline",
                  current ? "font-semibold text-ink" : "text-ink-3",
                )}
              >
                {t.name[s]}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Call hierarchy ──────────────────────────────────────────────────────────────────────────

type Words = ReturnType<typeof usageWords>;

/**
 * The record's own tab panels are tab stops (Radix gives each tabIndex 0) and the shared
 * TabsContent turns the outline off, so a keyboard reader landed on the list with no ring.
 * Inset, because the record's scroller clips anything drawn outside the panel.
 */
const PANEL_FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

function CallHierarchy({
  id,
  incoming,
  through,
  self,
  hosts,
  words,
  ...ctx
}: Ctx & { id: number; incoming: CallEdge[]; through: { base: number; edges: CallEdge[] }[]; self: number; hosts: HostUse[]; words: Words }) {
  const outgoing = useMemo(() => callEdges(ctx.symbols, id, "outgoing"), [ctx.symbols, id]);
  const throughCount = through.reduce((n, g) => n + g.edges.length, 0);
  const incomingCount = incoming.length + throughCount;
  // A symbol imported only from .vue or Markdown files opens on its incoming side, where the
  // empty state names those files; opening on Outgoing hid the one fact that says it is used.
  const startIncoming = incomingCount > 0 || hosts.length > 0 || outgoing.length === 0;
  return (
    <Section title={words.section}>
      <Tabs defaultValue={startIncoming ? "incoming" : "outgoing"} className="gap-0">
        <TabsList variant="line" className="h-8 w-full justify-start gap-0 rounded-none border-b border-rule p-0">
          {(
            [
              ["incoming", words.incoming, incomingCount],
              ["outgoing", words.outgoing, outgoing.length],
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
        <TabsContent value="incoming" className={PANEL_FOCUS}>
          <TopEdges {...ctx} root={id} edges={incoming} direction="incoming" through={through} self={self} hosts={hosts} words={words} />
        </TabsContent>
        <TabsContent value="outgoing" className={PANEL_FOCUS}>
          <TopEdges {...ctx} root={id} edges={outgoing} direction="outgoing" through={[]} self={self} hosts={[]} words={words} />
        </TabsContent>
      </Tabs>
    </Section>
  );
}

/** "AsideSponsors.vue, Layout.vue and 2 more": the distinct importing files, by name. */
function hostFileNames(report: Report, hosts: HostUse[], max = 3): string {
  const names = [...new Set(hosts.map((h) => report.files[h.file]?.name ?? ""))].filter(Boolean);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${formatInt(names.length - max)} more`;
}

type Direction = "incoming" | "outgoing";
/**
 * Rows shown before "Show more". It was 25: for a hub like a vector constructor that is a
 * thousand pixels of callers in a 340px column, and the References section under it (the
 * actual call sites, with code) started two screens down. Ten matches References' own cap.
 */
const EDGE_CAP = 10;

/**
 * One direction's first level: recursion, then production callers, then callers that go
 * through an interface or base method, then tests in a group of their own (open only when
 * nothing else calls it, so the reader never meets an empty list hiding its only callers).
 */
function TopEdges({
  root,
  edges,
  direction,
  through,
  self,
  hosts,
  words,
  ...ctx
}: Ctx & {
  root: number;
  edges: CallEdge[];
  direction: Direction;
  through: { base: number; edges: CallEdge[] }[];
  self: number;
  hosts: HostUse[];
  words: Words;
}) {
  const { production, types, tests } = useMemo(() => {
    const own: CallEdge[] = [];
    const tests: CallEdge[] = [];
    for (const e of edges) (inTest(ctx, e.symbol) ? tests : own).push(e);
    // Outgoing only: the types a function merely annotates with go in a group of their own,
    // so the list leads with what it actually calls and reads. Incoming stays one list, its
    // rows already badged by kind.
    if (direction === "incoming") return { production: own, types: [] as CallEdge[], tests };
    const { uses, types } = partitionTypeRefs(own);
    return { production: uses, types, tests };
  }, [edges, direction, ctx.symbols, ctx.report]);
  const top = useMemo(() => new Set([root]), [root]);

  const runs = words.dependents === "callers";
  let empty: string | null = null;
  if (edges.length === 0) {
    if (direction === "outgoing") {
      empty = !runs ? "It refers to nothing else in the project." : self > 0 ? "It calls nothing else in the project." : "It calls or uses nothing in the project.";
    } else if (through.length > 0) empty = "Nothing calls it by name; the project reaches it through what it implements.";
    // The compiler never reads a .vue or Markdown file, so "nothing uses it" would be false
    // for a composable that only components import.
    else if (hosts.length > 0) empty = `No TypeScript ${words.dependents}; imported by ${hostFileNames(ctx.report, hosts)}.`;
    else if (!runs) empty = "Nothing in the project uses it.";
    else empty = self > 0 ? "Nothing else in the project calls it." : "Nothing in the project calls or uses it.";
  }

  return (
    <>
      {self > 0 && (
        <div className="flex items-center gap-1.5 border-b border-rule py-1.5 pl-1.5 text-xs text-ink-2">
          <Repeat aria-hidden className="size-3.5 text-ink-3" />
          Calls itself
          <span className="figures font-mono text-[11px] text-ink-3">×{formatInt(self)}</span>
        </div>
      )}
      {empty && <Quiet>{empty}</Quiet>}
      {production.length > 0 && <EdgeList {...ctx} root={root} edges={production} direction={direction} />}
      {through.map((g) => (
        <EdgeGroup key={g.base} title={`Through ${qualified(ctx.symbols, g.base)}`} count={g.edges.length} defaultOpen>
          <EdgeList {...ctx} root={g.base} edges={g.edges} direction={direction} ancestors={top} />
        </EdgeGroup>
      ))}
      {types.length > 0 && (
        <EdgeGroup title="Type references" count={types.length} defaultOpen={production.length === 0}>
          <EdgeList {...ctx} root={root} edges={types} direction={direction} />
        </EdgeGroup>
      )}
      {tests.length > 0 && (
        <EdgeGroup title="In tests" count={tests.length} defaultOpen={production.length === 0 && through.length === 0 && types.length === 0}>
          <EdgeList {...ctx} root={root} edges={tests} direction={direction} />
        </EdgeGroup>
      )}
    </>
  );
}

/** A collapsible run of hierarchy rows under a ruled heading row. */
function EdgeGroup({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 border-b border-rule py-1.5 text-left text-xs font-medium text-ink-2 transition-colors duration-150 hover:bg-wash"
      >
        <span className="grid size-6 shrink-0 place-items-center text-ink-3">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-damped", open && "rotate-90")} />
        </span>
        <span className="min-w-0 truncate">{title}</span>
        {count !== undefined && <span className="figures shrink-0 font-mono text-[11px] font-normal text-ink-3">{formatInt(count)}</span>}
      </button>
      {open && children}
    </div>
  );
}

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
  const test = inTest(ctx, s);

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
            {test && <Tag className="shrink-0 self-center">test</Tag>}
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
                onClick={() => dig({ kind: "symbol", id: s })}
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
      {open && children && children.length > 0 && (
        <EdgeList {...ctx} root={s} edges={children} direction={direction} ancestors={ancestors} depth={depth + 1} />
      )}
      {open && children?.length === 0 && (
        <Quiet className="border-b border-rule text-xs">
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
  const row = (s: number, kind: number, side: "base" | "derived") => {
    const file = ctx.report.files[t.file[s]!];
    // A class the index does not record (declared inside a function body, like the test-local
    // `class WatcherErrorEnvironment extends DevEnvironment` in vite's dev.spec.ts, or an
    // anonymous class expression) has no symbol of its own, so the heritage row names its
    // file's module symbol. Its "declaration" is line 1, and marking the module name's length
    // there highlighted "import path". The `extends` clause is the place that means something,
    // so the row opens that, and offers no record to dig into.
    const anonymous = t.kind[s] === "module";
    const clause = anonymous && side === "derived" ? callSite(ctx.symbols, ctx.sm.refsOf, s, id, HERITAGE_KINDS) : null;
    const open = () => {
      if (clause) {
        openSourceKeepingSymbol({ file: clause.file, line: clause.line, marks: [clause] });
        return;
      }
      const line = t.line[s]!;
      openSourceKeepingSymbol({ file: t.file[s]!, line, marks: [{ line, col: t.col[s]!, len: t.name[s]!.length }] });
    };
    return (
      <div key={s} className="group flex min-w-0 items-center border-b border-rule">
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-wash"
        >
          <Tag className="w-[68px] justify-center">{REF_KINDS[kind]}</Tag>
          {anonymous ? (
            <span className="min-w-0 truncate text-xs text-ink-2">
              local class ·{" "}
              <span className="font-mono text-ink">
                {file?.name ?? "module"}
                {clause ? `:${clause.line + 1}` : ""}
              </span>
            </span>
          ) : (
            <>
              <span className="truncate font-mono text-xs text-ink">{qualified(ctx.symbols, s)}</span>
              {file && <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{file.name}</span>}
            </>
          )}
        </button>
        {anonymous ? (
          // Keeps the row's right edge aligned with its neighbors that do have a crosshair.
          <span aria-hidden className="size-6 shrink-0" />
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => dig({ kind: "symbol", id: s })}
            aria-label={`Show the record for ${t.name[s]}`}
            className="shrink-0 text-ink-3 opacity-60 group-hover:opacity-100"
          >
            <Crosshair />
          </Button>
        )}
      </div>
    );
  };
  return (
    <>
      {bases.length > 0 && (
        <Section title="Extends and implements" count={bases.length}>
          <div className="border-t border-rule">{bases.map((b) => row(b.symbol, b.kind, "base"))}</div>
        </Section>
      )}
      {derived.length > 0 && (
        <Section title="Implementations" count={derived.length}>
          <div className="border-t border-rule">{derived.map((d) => row(d.symbol, d.kind, "derived"))}</div>
        </Section>
      )}
    </>
  );
}

// ─── References ──────────────────────────────────────────────────────────────────────────────

const GROUP_CAP = 8;
const ROW_CAP = 10;
const OPEN_BY_DEFAULT = 4;

function References({ id, hosts, ...ctx }: Ctx & { id: number; hosts: HostUse[] }) {
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
    const sorted = [...byFile]
      .map(([file, rows]) => ({ file, rows }))
      .sort((a, b) => b.rows.length - a.rows.length || report.files[a.file]!.path.localeCompare(report.files[b.file]!.path));
    return {
      production: sorted.filter((g) => report.files[g.file]?.category !== "test"),
      tests: sorted.filter((g) => report.files[g.file]?.category === "test"),
    };
  }, [all, kind, r, report]);
  const testRefs = useMemo(() => groups.tests.reduce((n, g) => n + g.rows.length, 0), [groups]);

  const total = symbols.symbols.refs[id]!;
  const dropped = total - all.length;

  return (
    <Section title="References" count={all.length}>
      {all.length === 0 ? (
        <Quiet>{hosts.length > 0 ? "No TypeScript references." : "No resolved references in the project."}</Quiet>
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
            {groups.production.slice(0, groupLimit).map((g, i) => (
              <RefGroup key={`${kind}:${g.file}`} {...ctx} file={g.file} rows={g.rows} defaultOpen={i < OPEN_BY_DEFAULT} />
            ))}
          </div>
          <MoreButton
            hidden={groups.production.length - groupLimit}
            noun={groups.production.length - groupLimit === 1 ? "more file" : "more files"}
            onClick={() => setGroupLimit((l) => l + 20)}
          />
          {groups.tests.length > 0 && (
            <EdgeGroup
              key={kind}
              title={`In tests: ${plural(testRefs, "reference")} in ${plural(groups.tests.length, "file")}`}
              defaultOpen={groups.production.length === 0}
            >
              <TestRefGroups {...ctx} groups={groups.tests} kind={kind} />
            </EdgeGroup>
          )}
          {dropped > 0 && (
            <Quiet className="text-xs">
              {plural(dropped, "reference")} beyond these were left out by the report's size cap; the totals above still count them.
            </Quiet>
          )}
        </>
      )}
      {hosts.length > 0 && <HostUses report={report} hosts={hosts} />}
    </Section>
  );
}

/**
 * Imports from files the compiler does not read (a Vue component's <script>, a VitePress page).
 * They are matched by exported name, not resolved, so they carry no column and no kind: each
 * row opens the importing file at its import line, and they stay out of the counts above.
 */
function HostUses({ report, hosts }: { report: Report; hosts: HostUse[] }) {
  const [limit, setLimit] = useState(ROW_CAP);
  const activeSource = useViewer((s) => s.source);
  return (
    <div className="mt-3">
      <h4 className="mb-1 text-xs font-medium text-ink-2">
        Used from files outside the TypeScript analysis
        <span className="figures ml-1.5 font-mono text-[11px] font-normal text-ink-3">{formatInt(hosts.length)}</span>
      </h4>
      <ul className="border-t border-rule">
        {hosts.slice(0, limit).map((h) => {
          const f = report.files[h.file];
          if (!f) return null;
          const current = activeSource?.file === h.file && activeSource.line === h.line;
          return (
            <li key={`${h.file}:${h.line}`}>
              <button
                type="button"
                onClick={() => openSourceKeepingSymbol({ file: h.file, line: h.line })}
                aria-current={current || undefined}
                title={`${f.path}:${h.line + 1}`}
                className={cn(
                  "flex w-full min-w-0 items-center gap-1.5 border-b border-rule py-1.5 pl-1 text-left transition-colors duration-150 hover:bg-wash",
                  current && "bg-wash",
                )}
              >
                <LanguageSwatch languageId={f.language} />
                <PathText path={f.path} line={h.line + 1} className="flex-1 text-xs text-ink" dirClass="text-ink-3" />
                <Tag className="shrink-0">import</Tag>
              </button>
            </li>
          );
        })}
      </ul>
      <MoreButton hidden={hosts.length - limit} onClick={() => setLimit((l) => l + 40)} />
    </div>
  );
}

function TestRefGroups({ groups, kind, ...ctx }: Ctx & { groups: { file: number; rows: number[] }[]; kind: string }) {
  const [limit, setLimit] = useState(GROUP_CAP);
  return (
    <div className="pl-3">
      {groups.slice(0, limit).map((g) => (
        <RefGroup key={`${kind}:${g.file}`} {...ctx} file={g.file} rows={g.rows} defaultOpen={false} />
      ))}
      <MoreButton hidden={groups.length - limit} noun={groups.length - limit === 1 ? "more file" : "more files"} onClick={() => setLimit((l) => l + 20)} />
    </div>
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
    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] whitespace-pre text-ink-2 [font-variant-ligatures:none]">
      {start > indent && <span className="text-ink-3">…</span>}
      {clean.slice(start, col)}
      <mark className="rounded-[2px] bg-[#d6e6fa] font-semibold text-ink dark:bg-[#1f3550]">{clean.slice(col, col + len)}</mark>
      {clean.slice(col + len, end)}
      {end < clean.length && <span className="text-ink-3">…</span>}
    </span>
  );
}
