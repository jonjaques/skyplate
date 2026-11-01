/**
 * The explorer: every file (or every symbol) as a sortable, filterable table.
 *
 * Tables are virtualized (see virtual.ts) so 50k rows scroll like 50. The open drawer applies
 * here too: with a drawer focused, the files table lists only what is inside it, with a chip to
 * widen back out, because the galaxy is dimming everything else at the same moment and the two
 * should agree. Click selects a row; double-click (or Enter) opens it in the source reader.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { useEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { SymbolFlag, type SymbolKind } from "../../shared/schema";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import { filesUnder } from "../model/indices";
import { ensureSymbols } from "../state/loaders";
import { useViewer } from "../state/store";
import { SYMBOL_KIND_LABEL } from "./labels";
import { focusDrawer, openFile, openSymbolDefinition, show } from "./navigate";
import { LanguageSwatch, PathText, Quiet } from "./parts";
import { useShell, type FileSortKey, type SortDir, type SymbolSortKey } from "./shell-state";
import { useVirtualRows } from "./virtual";

const ROW = 32;
const HEADER = 36;

export function Explorer() {
  const mode = useShell((s) => s.explorerMode);
  const setMode = useShell((s) => s.setExplorerMode);
  const hasSymbols = useViewer((s) => !!s.report?.symbols);

  useEffect(() => {
    if (mode === "symbols") void ensureSymbols();
  }, [mode]);

  const toggle = hasSymbols ? (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => v && setMode(v as "files" | "symbols")}
      variant="outline"
      size="sm"
      aria-label="Show files or symbols"
    >
      <ToggleGroupItem value="files" className="h-8 px-3 text-ink-3 data-[state=on]:bg-wash data-[state=on]:font-semibold data-[state=on]:text-ink">
        Files
      </ToggleGroupItem>
      <ToggleGroupItem value="symbols" className="h-8 px-3 text-ink-3 data-[state=on]:bg-wash data-[state=on]:font-semibold data-[state=on]:text-ink">
        Symbols
      </ToggleGroupItem>
    </ToggleGroup>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {mode === "symbols" && hasSymbols ? <SymbolView toggle={toggle} /> : <FileView toggle={toggle} />}
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2">{children}</div>
  );
}

function FilterInput({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return (
    <div className="relative w-full max-w-[320px] min-w-[180px] flex-1">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 bg-paper pr-8 pl-8 text-[13px]"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange("")}
          aria-label="Clear the filter"
          className="absolute top-1/2 right-1 -translate-y-1/2 text-ink-3"
        >
          <X />
        </Button>
      )}
    </div>
  );
}

// ─── Files ───────────────────────────────────────────────────────────────────────────────────

/** Columns that only exist with git history. */
const GIT_SORT_KEYS = new Set<FileSortKey>(["commits", "owner", "hotspot"]);
const NO_GIT_SORT = { key: "lines", dir: "desc" } as const satisfies { key: FileSortKey; dir: SortDir };

/**
 * The sort actually applied. The default is hotspot, which a report without git does not have
 * (every score is 0, and the column is not even drawn), so the table would come out in an order
 * no visible header explains; largest first is the next most useful reading order.
 */
function useFileSort(): { key: FileSortKey; dir: SortDir } {
  const sort = useShell((s) => s.fileSort);
  const git = useViewer((s) => !!s.report?.git);
  return !git && GIT_SORT_KEYS.has(sort.key) ? NO_GIT_SORT : sort;
}

function useFileRows(): number[] {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const focusDir = useViewer((s) => s.focusDir);
  const filter = useShell((s) => s.fileFilter);
  const sort = useFileSort();
  return useMemo(() => {
    if (!report || !model) return [];
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = focusDir === null ? report.files.map((f) => f.id) : Array.from(filesUnder(model, focusDir));
    const ids = terms.length
      ? pool.filter((id) => {
          const p = report.files[id]!.path.toLowerCase();
          return terms.every((t) => p.includes(t));
        })
      : pool;
    const files = report.files;
    const authors = report.git?.authors;
    const key: Record<FileSortKey, (id: number) => number | string> = {
      path: (id) => files[id]!.path,
      language: (id) => model.languages.get(files[id]!.language)?.name ?? files[id]!.language,
      lines: (id) => files[id]!.lines,
      complexity: (id) => files[id]!.complexity,
      commits: (id) => files[id]!.git?.commits ?? -1,
      owner: (id) => (files[id]!.git && authors ? (authors[files[id]!.git!.owner]?.name ?? "") : ""),
      fanIn: (id) => files[id]!.fanIn,
      hotspot: (id) => files[id]!.hotspot,
    };
    return sortIds(ids, key[sort.key], sort.dir, (id) => files[id]!.path);
  }, [report, model, focusDir, filter, sort]);
}

/** Sort ids by a key, ties broken by a stable secondary (the path), without localeCompare. */
function sortIds(ids: number[], key: (id: number) => number | string, dir: SortDir, tie: (id: number) => string): number[] {
  const values = new Map<number, number | string>();
  for (const id of ids) values.set(id, key(id));
  const sign = dir === "asc" ? 1 : -1;
  return [...ids].sort((a, b) => {
    const va = values.get(a)!;
    const vb = values.get(b)!;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    const ta = tie(a);
    const tb = tie(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

/**
 * The toolbar's count and the table read the same filtered, sorted rows. Each call of the row
 * hook owns its own memo, so calling it in both would sort a 50k-file list twice per keystroke;
 * it runs once here and both parts receive the result.
 */
function FileView({ toggle }: { toggle: ReactNode }) {
  const rows = useFileRows();
  return (
    <>
      <Toolbar>
        {toggle}
        <FileToolbar rows={rows} />
      </Toolbar>
      <div className="min-h-0 flex-1">
        <FileTable rows={rows} />
      </div>
    </>
  );
}

function SymbolView({ toggle }: { toggle: ReactNode }) {
  const rows = useSymbolRows();
  return (
    <>
      <Toolbar>
        {toggle}
        <SymbolToolbar rows={rows} />
      </Toolbar>
      <div className="min-h-0 flex-1">
        <SymbolTable rows={rows} />
      </div>
    </>
  );
}

function FileToolbar({ rows }: { rows: number[] }) {
  const filter = useShell((s) => s.fileFilter);
  const setFilter = useShell((s) => s.setFileFilter);
  const focusDir = useViewer((s) => s.focusDir);
  const report = useViewer((s) => s.report);
  return (
    <>
      <FilterInput value={filter} onChange={setFilter} placeholder="Filter by path" />
      {focusDir !== null && report && (
        <Button variant="outline" size="sm" className="h-8 max-w-[260px] gap-1.5 bg-paper" onClick={() => focusDrawer(null)}>
          <span className="truncate font-mono text-xs">In {report.dirs[focusDir]!.path}</span>
          <X aria-label="Show every drawer" />
        </Button>
      )}
      <span className="figures ml-auto font-mono text-xs text-ink-3">
        {rows.length === report?.files.length ? plural(rows.length, "file") : `${formatInt(rows.length)} of ${plural(report?.files.length ?? 0, "file")}`}
      </span>
    </>
  );
}

function SortHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: SortDir };
  onSort(sort: { key: K; dir: SortDir }): void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-9 bg-paper px-0 text-xs font-semibold text-ink-2", align === "right" && "text-right")}
    >
      <button
        type="button"
        onClick={() =>
          onSort({ key: sortKey, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : align === "right" ? "desc" : "asc" })
        }
        className={cn(
          "inline-flex h-full w-full items-center gap-1 px-2 transition-colors duration-150 hover:text-ink",
          align === "right" && "flex-row-reverse",
          active && "text-ink",
        )}
      >
        {label}
        <Icon aria-hidden className={cn("size-3", active ? "text-ink" : "text-ink-3 opacity-60")} />
      </button>
    </TableHead>
  );
}

function VirtualTable({
  count,
  colgroup,
  head,
  row,
  selectedIndex,
  onMove,
  onOpen,
  empty,
}: {
  count: number;
  colgroup: ReactNode;
  head: ReactNode;
  row(i: number): ReactNode;
  selectedIndex: number;
  onMove(i: number): void;
  onOpen(i: number): void;
  empty: ReactNode;
}) {
  const v = useVirtualRows(count, ROW, HEADER);

  // Keep the selected row on screen when the selection comes from elsewhere (the plate, ⌘K).
  useEffect(() => {
    if (selectedIndex >= 0) v.reveal(selectedIndex);
  }, [selectedIndex, v.reveal]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (count === 0) return;
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 20 : e.key === "PageUp" ? -20 : 0;
    if (step) {
      e.preventDefault();
      const next = Math.min(count - 1, Math.max(0, (selectedIndex < 0 ? -1 : selectedIndex) + step));
      onMove(next);
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      onOpen(selectedIndex);
    }
  };

  const rows = [];
  for (let i = v.start; i < v.end; i++) rows.push(row(i));

  return (
    <div ref={v.ref} onScroll={v.onScroll} onKeyDown={onKeyDown} tabIndex={0} className="h-full overflow-auto outline-none focus-visible:outline-none" aria-label="Table, use the arrow keys to move the selection">
      {/* Separate borders on the cells, not the rows: a collapsed table's header rule scrolls
          away with the body even when the header itself is sticky. */}
      <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 caption-bottom text-[13px] [&_td]:border-b [&_td]:border-rule [&_th]:border-b [&_th]:border-rule">
        {colgroup}
        <TableHeader className="sticky top-0 z-10 bg-paper [&_tr]:border-b-0">
          <TableRow className="hover:bg-transparent">{head}</TableRow>
        </TableHeader>
        <TableBody>
          {v.padTop > 0 && <tr style={{ height: v.padTop }} aria-hidden />}
          {rows}
          {v.padBottom > 0 && <tr style={{ height: v.padBottom }} aria-hidden />}
        </TableBody>
      </table>
      {count === 0 && <div className="px-4 py-6">{empty}</div>}
    </div>
  );
}

function FileTable({ rows }: { rows: number[] }) {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const selection = useViewer((s) => s.selection);
  const sort = useFileSort();
  const setSort = useShell((s) => s.setFileSort);
  const selectedId = selection?.kind === "file" ? selection.id : -1;
  const selectedIndex = useMemo(() => rows.indexOf(selectedId), [rows, selectedId]);
  if (!report || !model) return null;
  const git = !!report.git;
  const authors = report.git?.authors;

  return (
    <VirtualTable
      count={rows.length}
      selectedIndex={selectedIndex}
      onMove={(i) => show({ kind: "file", id: rows[i]! })}
      onOpen={(i) => openFile(rows[i]!)}
      empty={<Quiet>No file path matches the filter.</Quiet>}
      colgroup={
        <colgroup>
          <col />
          <col className="w-[124px]" />
          <col className="w-[72px]" />
          <col className="w-[96px]" />
          {git && <col className="w-[84px]" />}
          {git && <col className="w-[120px]" />}
          <col className="w-[72px]" />
          {git && <col className="w-[80px]" />}
        </colgroup>
      }
      head={
        <>
          <SortHead label="Path" sortKey="path" sort={sort} onSort={setSort} />
          <SortHead label="Language" sortKey="language" sort={sort} onSort={setSort} />
          <SortHead label="Lines" sortKey="lines" sort={sort} onSort={setSort} align="right" />
          <SortHead label="Complexity" sortKey="complexity" sort={sort} onSort={setSort} align="right" />
          {git && <SortHead label="Commits" sortKey="commits" sort={sort} onSort={setSort} align="right" />}
          {git && <SortHead label="Owner" sortKey="owner" sort={sort} onSort={setSort} />}
          <SortHead label="Fan-in" sortKey="fanIn" sort={sort} onSort={setSort} align="right" />
          {git && <SortHead label="Hotspot" sortKey="hotspot" sort={sort} onSort={setSort} align="right" />}
        </>
      }
      row={(i) => {
        const id = rows[i]!;
        const f = report.files[id]!;
        const holotype = model.holotypes.has(id);
        return (
          <TableRow
            key={id}
            data-state={id === selectedId ? "selected" : undefined}
            onClick={() => show({ kind: "file", id })}
            onDoubleClick={() => openFile(id)}
            className="cursor-default border-rule"
            style={{ height: ROW }}
          >
            <TableCell className="px-2 py-0 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                {holotype && (
                  <span className="size-1.5 shrink-0 rounded-full bg-holotype" title="Holotype: most depended on in its region" />
                )}
                <PathText path={f.path} className="text-ink" dirClass="text-ink-3" />
              </span>
            </TableCell>
            <TableCell className="truncate px-2 py-0">
              <span className="flex items-center gap-1.5">
                <LanguageSwatch languageId={f.language} />
                <span className="truncate">{model.languages.get(f.language)?.name ?? f.language}</span>
              </span>
            </TableCell>
            <Num v={f.lines} />
            <Num v={f.complexity} />
            {git && <Num v={f.git?.commits} />}
            {git && (
              <TableCell className="truncate px-2 py-0 text-ink-2">{f.git && authors ? authors[f.git.owner]?.name : ""}</TableCell>
            )}
            <Num v={f.fanIn} />
            {git && <TableCell className="figures px-2 py-0 text-right font-mono text-xs">{f.hotspot > 0 ? f.hotspot.toFixed(2) : ""}</TableCell>}
          </TableRow>
        );
      }}
    />
  );
}

function Num({ v }: { v: number | undefined }) {
  return <TableCell className="figures px-2 py-0 text-right font-mono text-xs">{v === undefined ? "" : formatInt(v)}</TableCell>;
}

// ─── Symbols ─────────────────────────────────────────────────────────────────────────────────

const KINDS = Object.keys(SYMBOL_KIND_LABEL).filter((k) => k !== "module") as SymbolKind[];

function useSymbolRows(): number[] {
  const report = useViewer((s) => s.report);
  const symbols = useViewer((s) => s.symbols);
  const sm = useViewer((s) => s.symbolModel);
  const filter = useShell((s) => s.symbolFilter);
  const kind = useShell((s) => s.symbolKind);
  const sort = useShell((s) => s.symbolSort);
  const focusDir = useViewer((s) => s.focusDir);
  const model = useViewer((s) => s.model);
  return useMemo(() => {
    if (!report || !symbols || !sm || !model) return [];
    const t = symbols.symbols;
    const q = filter.trim().toLowerCase();
    let inFocus: Set<number> | null = null;
    if (focusDir !== null) inFocus = new Set(filesUnder(model, focusDir));
    const ids: number[] = [];
    for (let i = 0; i < t.name.length; i++) {
      const k = t.kind[i]!;
      if (k === "module" || (kind !== "all" && k !== kind)) continue;
      if (q && !sm.lowerNames[i]!.includes(q)) continue;
      if (inFocus && !inFocus.has(t.file[i]!)) continue;
      ids.push(i);
    }
    const key: Record<SymbolSortKey, (i: number) => number | string> = {
      name: (i) => sm.lowerNames[i]!,
      kind: (i) => t.kind[i]!,
      file: (i) => report.files[t.file[i]!]?.path ?? "",
      refs: (i) => t.refs[i]!,
      callers: (i) => t.callers[i]!,
      complexity: (i) => t.complexity[i]!,
    };
    return sortIds(ids, key[sort.key], sort.dir, (i) => t.name[i]!);
  }, [report, symbols, sm, model, filter, kind, sort, focusDir]);
}

function SymbolToolbar({ rows }: { rows: number[] }) {
  const filter = useShell((s) => s.symbolFilter);
  const setFilter = useShell((s) => s.setSymbolFilter);
  const kind = useShell((s) => s.symbolKind);
  const setKind = useShell((s) => s.setSymbolKind);
  const focusDir = useViewer((s) => s.focusDir);
  const report = useViewer((s) => s.report);
  const status = useViewer((s) => s.symbolsStatus);
  return (
    <>
      <FilterInput value={filter} onChange={setFilter} placeholder="Filter by name" />
      <Select value={kind} onValueChange={(v) => setKind(v as SymbolKind | "all")}>
        <SelectTrigger size="sm" className="h-8 w-[170px] bg-paper" aria-label="Filter by kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">Every kind</SelectItem>
          {KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {SYMBOL_KIND_LABEL[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {focusDir !== null && report && (
        <Button variant="outline" size="sm" className="h-8 max-w-[260px] gap-1.5 bg-paper" onClick={() => focusDrawer(null)}>
          <span className="truncate font-mono text-xs">In {report.dirs[focusDir]!.path}</span>
          <X aria-label="Show every drawer" />
        </Button>
      )}
      <span className="figures ml-auto font-mono text-xs text-ink-3">{status === "ready" ? plural(rows.length, "symbol") : ""}</span>
    </>
  );
}

function SymbolTable({ rows }: { rows: number[] }) {
  const report = useViewer((s) => s.report);
  const symbols = useViewer((s) => s.symbols);
  const status = useViewer((s) => s.symbolsStatus);
  const selection = useViewer((s) => s.selection);
  const sort = useShell((s) => s.symbolSort);
  const setSort = useShell((s) => s.setSymbolSort);
  const selectedId = selection?.kind === "symbol" ? selection.id : -1;
  const selectedIndex = useMemo(() => rows.indexOf(selectedId), [rows, selectedId]);

  if (status === "loading" || status === "idle") return <Quiet className="px-4 py-6">Loading the symbol tables…</Quiet>;
  if (status === "error") return <Quiet className="px-4 py-6">The symbol tables did not load, so this view is empty. The files table still works.</Quiet>;
  if (!report || !symbols) return null;
  const t = symbols.symbols;

  return (
    <VirtualTable
      count={rows.length}
      selectedIndex={selectedIndex}
      onMove={(i) => show({ kind: "symbol", id: rows[i]! })}
      onOpen={(i) => openSymbolDefinition(symbols, rows[i]!)}
      empty={<Quiet>No symbol matches the filter.</Quiet>}
      colgroup={
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[108px]" />
          <col />
          <col className="w-[96px]" />
          <col className="w-[76px]" />
          <col className="w-[92px]" />
          <col className="w-[124px]" />
        </colgroup>
      }
      head={
        <>
          <SortHead label="Name" sortKey="name" sort={sort} onSort={setSort} />
          <SortHead label="Kind" sortKey="kind" sort={sort} onSort={setSort} />
          <SortHead label="File" sortKey="file" sort={sort} onSort={setSort} />
          <SortHead label="References" sortKey="refs" sort={sort} onSort={setSort} align="right" />
          <SortHead label="Callers" sortKey="callers" sort={sort} onSort={setSort} align="right" />
          <SortHead label="Complexity" sortKey="complexity" sort={sort} onSort={setSort} align="right" />
          <TableHead className="h-9 bg-paper px-2 text-xs font-semibold text-ink-2">Flags</TableHead>
        </>
      }
      row={(i) => {
        const id = rows[i]!;
        const file = report.files[t.file[id]!];
        const flags = t.flags[id]!;
        return (
          <TableRow
            key={id}
            data-state={id === selectedId ? "selected" : undefined}
            onClick={() => show({ kind: "symbol", id })}
            onDoubleClick={() => openSymbolDefinition(symbols, id)}
            className="cursor-default border-rule"
            style={{ height: ROW }}
          >
            <TableCell className="truncate px-2 py-0 font-mono text-xs text-ink" title={t.signature[id] || t.name[id]}>
              {t.parent[id]! >= 0 && <span className="text-ink-3">{t.name[t.parent[id]!]}.</span>}
              {t.name[id]}
            </TableCell>
            <TableCell className="truncate px-2 py-0 text-ink-2">{SYMBOL_KIND_LABEL[t.kind[id]!]}</TableCell>
            <TableCell className="px-2 py-0 text-xs text-ink-3">
              {file && <PathText path={file.path} line={t.line[id]! + 1} />}
            </TableCell>
            <Num v={t.refs[id]} />
            <Num v={t.callers[id]} />
            <Num v={t.complexity[id] || undefined} />
            <TableCell className="truncate px-2 py-0 text-xs text-ink-3">
              {[
                flags & SymbolFlag.exported ? "exported" : "",
                flags & SymbolFlag.unusedExport ? "unused" : "",
                flags & SymbolFlag.async ? "async" : "",
                flags & SymbolFlag.deprecated ? "deprecated" : "",
                flags & SymbolFlag.test ? "test" : "",
              ]
                .filter(Boolean)
                .join(", ")}
            </TableCell>
          </TableRow>
        );
      }}
    />
  );
}
