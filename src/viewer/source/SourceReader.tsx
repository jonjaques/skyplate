/**
 * The source reader: one file's text with line numbers, highlighting and code intelligence.
 *
 * What it shows follows the shared state: `store.source` when something sent the reader to a
 * place (a reference, a definition, "Open in source reader"), otherwise the selected file, or
 * the selected symbol's declaration. When the selection moves to another file while the reader
 * is open (a star clicked on the compact plate beside it), the reader follows; that is "one
 * selection, everywhere".
 *
 * For TypeScript and JavaScript files every identifier the compiler resolved is interactive:
 * hover for its kind and signature, click to select it (the record and the galaxy follow),
 * ⌘/Ctrl-click to jump to its definition. Occurrences of the selected symbol are marked.
 */

import type { HLJSApi } from "highlight.js";
import { FileX, Image as ImageIcon, Lock, LoaderCircle, WrapText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeSymbols, FileRecord, Report } from "../../shared/schema";
import { Kbd } from "../components/ui/kbd";
import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { formatBytes, formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import type { SymbolModel } from "../model/symbols";
import type { SourceUnavailable } from "../state/loaders";
import { useHover, useViewer, type SourceTarget } from "../state/store";
import { SYMBOL_KIND_LABEL } from "../shell/labels";
import { openSymbolDefinition } from "../shell/navigate";
import { LanguageSwatch, PathText, RowButton } from "../shell/parts";
import { useShell } from "../shell/shell-state";
import { CodeView, type CodeMark, type CodeRange } from "./CodeView";
import { grammarFor, htmlToLines, loadHighlighter, plainLines, type Tok } from "./highlight";
import { useSourceText } from "./useSource";

/** Past these, highlighting costs more than it gives (and minified files have no structure). */
const HIGHLIGHT_MAX_CHARS = 600_000;
const HIGHLIGHT_MAX_LINE = 4_000;

const highlighted = new Map<number, Tok[][]>();

function useLines(file: FileRecord, text: string | null): { lines: Tok[][]; highlighting: boolean } {
  const plain = useMemo(() => (text === null ? [] : plainLines(text)), [text]);
  // lines: null records "settled as plain text" (no grammar, or the highlighter did not load),
  // so the progress mark stops instead of spinning for languages highlight.js does not know.
  const [result, setResult] = useState<{ id: number; lines: Tok[][] | null } | null>(null);
  const skip = text === null || text.length > HIGHLIGHT_MAX_CHARS || file.minified || file.longestLine > HIGHLIGHT_MAX_LINE;

  useEffect(() => {
    if (skip || text === null || highlighted.has(file.id)) return;
    let live = true;
    void loadHighlighter().then((hljs: HLJSApi | null) => {
      if (!live) return;
      const grammar = hljs ? grammarFor(hljs, file) : null;
      if (!hljs || !grammar) {
        setResult({ id: file.id, lines: null });
        return;
      }
      // Off the click's frame: the plain text paints first, the colors follow a beat later.
      setTimeout(() => {
        if (!live) return;
        try {
          const lines = htmlToLines(hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value);
          highlighted.set(file.id, lines);
          if (highlighted.size > 24) highlighted.delete(highlighted.keys().next().value!);
          setResult({ id: file.id, lines });
        } catch {
          // A grammar that throws on odd input leaves the file readable as plain text.
          setResult({ id: file.id, lines: null });
        }
      }, 0);
    });
    return () => {
      live = false;
    };
  }, [file, text, skip]);

  const cached = highlighted.get(file.id);
  if (cached && cached.length === plain.length) return { lines: cached, highlighting: false };
  if (result?.id === file.id) {
    return { lines: result.lines && result.lines.length === plain.length ? result.lines : plain, highlighting: false };
  }
  return { lines: plain, highlighting: !skip && text !== null };
}

/** Identifiers the compiler resolved in this file: every reference, plus each declaration. */
function buildRanges(symbols: CodeSymbols, sm: SymbolModel, file: number): Map<number, CodeRange[]> | null {
  const start = symbols.fileRefStart[file];
  const end = symbols.fileRefStart[file + 1];
  if (start === undefined || end === undefined || symbols.moduleSymbol[file] === -1) return null;
  const byLine = new Map<number, CodeRange[]>();
  const add = (line: number, r: CodeRange) => {
    const list = byLine.get(line);
    if (list) list.push(r);
    else byLine.set(line, [r]);
  };
  const refs = symbols.refs;
  for (let i = start; i < end; i++) add(refs.line[i]!, { col: refs.col[i]!, len: refs.len[i]!, sym: refs.symbol[i]!, decl: false });
  const t = symbols.symbols;
  const { offsets, targets } = sm.symbolsInFile;
  for (let i = offsets[file]!; i < offsets[file + 1]!; i++) {
    const s = targets[i]!;
    if (t.kind[s] === "module") continue;
    add(t.line[s]!, { col: t.col[s]!, len: t.name[s]!.length, sym: s, decl: true });
  }
  for (const list of byLine.values()) list.sort((a, b) => a.col - b.col || a.len - b.len);
  return byLine;
}

/** Where the reader points, derived from the shared state (see the header comment). */
export function useReaderTarget(): SourceTarget | null {
  const source = useViewer((s) => s.source);
  const selection = useViewer((s) => s.selection);
  const symbols = useViewer((s) => s.symbols);
  // Memoized: the target's identity is the reader's "scroll here" signal, so a fresh object
  // per render would re-aim the scroll on every hover.
  return useMemo(() => {
    if (source) return source;
    if (selection?.kind === "file") return { file: selection.id };
    if (selection?.kind === "symbol" && symbols) {
      const t = symbols.symbols;
      const line = t.line[selection.id]!;
      return { file: t.file[selection.id]!, line, marks: [{ line, col: t.col[selection.id]!, len: t.name[selection.id]!.length }] };
    }
    return null;
  }, [source, selection, symbols]);
}

const NO_MARKS: CodeMark[] = [];

export function SourceReader() {
  const report = useViewer((s) => s.report);
  const target = useReaderTarget();
  const selection = useViewer((s) => s.selection);

  // Follow the selection to another file (see the header comment). A symbol selection does
  // not move the reader: clicking a name in the text must not navigate away from the text.
  useEffect(() => {
    const s = useViewer.getState();
    if (selection?.kind === "file" && s.source && s.source.file !== selection.id) s.openSource({ file: selection.id });
  }, [selection]);

  if (!report) return null;
  if (!target) return <NothingOpen report={report} />;
  const file = report.files[target.file];
  if (!file) return <NothingOpen report={report} />;
  return <FileReader key={file.id} report={report} file={file} target={target} />;
}

function FileReader({ report, file, target }: { report: Report; file: FileRecord; target: SourceTarget }) {
  const source = useSourceText(file.id);
  const text = source.status === "ready" ? source.text : null;
  const { lines, highlighting } = useLines(file, text);
  const wrap = useShell((s) => s.wrapLines);
  const setWrap = useShell((s) => s.setWrapLines);
  const symbols = useViewer((s) => s.symbols);
  const symbolModel = useViewer((s) => s.symbolModel);
  const symbolsStatus = useViewer((s) => s.symbolsStatus);
  const selection = useViewer((s) => s.selection);
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const [hover, setHoverCard] = useState<{ sym: number; rect: DOMRect } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const analyzed = !!symbols && symbols.moduleSymbol[file.id] !== undefined && symbols.moduleSymbol[file.id] !== -1;
  const ranges = useMemo(
    () => (symbols && symbolModel && analyzed ? buildRanges(symbols, symbolModel, file.id) : null),
    [symbols, symbolModel, analyzed, file.id],
  );
  const refCount = symbols && analyzed ? symbols.fileRefStart[file.id + 1]! - symbols.fileRefStart[file.id]! : 0;
  const selectedSymbol = selection?.kind === "symbol" ? selection.id : null;
  const marks = target.file === file.id && target.marks ? target.marks : NO_MARKS;

  useEffect(
    () => () => {
      clearTimeout(pending.current);
      setHover(null);
    },
    [setHover],
  );

  const shown = useRef<number | null>(null);
  const onSymbolHover = (sym: number | null, el: HTMLElement | null) => {
    if (sym === shown.current) return;
    shown.current = sym;
    clearTimeout(pending.current);
    if (sym === null || !el) {
      setHoverCard(null);
      setHover(null);
      return;
    }
    setHoverCard(null);
    setHover({ kind: "symbol", id: sym });
    // A short dwell, so sweeping across a line does not strobe cards.
    pending.current = setTimeout(() => setHoverCard({ sym, rect: el.getBoundingClientRect() }), 280);
  };

  const onSymbolClick = (sym: number, toDefinition: boolean) => {
    if (!symbols) return;
    if (toDefinition) {
      openSymbolDefinition(symbols, sym);
      return;
    }
    // Pin this file first: when the reader is showing it only because it is selected,
    // selecting a symbol would otherwise send the reader to that symbol's declaration.
    const s = useViewer.getState();
    if (!s.source || s.source.file !== file.id) s.openSource({ file: file.id });
    select({ kind: "symbol", id: sym });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-rule px-4">
        <h2 className="flex min-w-0 text-[12.5px] text-ink">
          <PathText path={file.path} />
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-2">
          <LanguageSwatch languageId={file.language} />
          {report.languages.find((l) => l.id === file.language)?.name ?? file.language}
        </span>
        {file.lines > 0 && <span className="figures shrink-0 font-mono text-xs text-ink-3">{plural(file.lines, "line")}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <IntelStatus status={symbolsStatus} analyzed={analyzed} refCount={refCount} hasSymbols={!!report.symbols} file={file} />
          {highlighting && <LoaderCircle aria-label="Highlighting" className="size-3.5 animate-spin text-ink-3" />}
          {text !== null && (
            <Toggle
              size="sm"
              pressed={wrap}
              onPressedChange={setWrap}
              aria-label="Wrap long lines"
              className="h-7 gap-1.5 px-2 text-xs text-ink-2 data-[state=on]:bg-wash data-[state=on]:text-ink"
            >
              <WrapText />
              Wrap
            </Toggle>
          )}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {source.status === "loading" && <ReaderSkeleton />}
        {source.status === "unavailable" && <NoSource report={report} file={file} reason={source.reason} />}
        {source.status === "ready" && (
          <>
            {file.asset && <AssetStrip file={file} />}
            <CodeView
              lines={lines}
              ranges={ranges}
              marks={marks}
              selectedSymbol={selectedSymbol}
              targetLine={target.file === file.id ? target.line : undefined}
              scrollKey={target}
              wrap={wrap}
              onSymbolHover={onSymbolHover}
              onSymbolClick={onSymbolClick}
            />
          </>
        )}
        {hover && symbols && <SymbolCard symbols={symbols} report={report} sym={hover.sym} rect={hover.rect} />}
      </div>
    </div>
  );
}

function IntelStatus({
  status,
  analyzed,
  refCount,
  hasSymbols,
  file,
}: {
  status: string;
  analyzed: boolean;
  refCount: number;
  hasSymbols: boolean;
  file: FileRecord;
}) {
  if (!hasSymbols || file.binary) return null;
  if (status === "loading" || status === "idle") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        Loading code intelligence
      </span>
    );
  }
  if (status === "error") return <span className="text-xs text-ink-3">Code intelligence did not load</span>;
  if (!analyzed) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="figures hidden cursor-default items-center gap-1.5 font-mono text-xs text-ink-3 xl:flex">
          {plural(refCount, "reference")}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5">
        Click a name to select it; <Kbd>⌘</Kbd>-click goes to its definition
      </TooltipContent>
    </Tooltip>
  );
}

/** The hover card for an identifier, anchored to it with a fixed, invisible trigger. */
function SymbolCard({ symbols, report, sym, rect }: { symbols: CodeSymbols; report: Report; sym: number; rect: DOMRect }) {
  const t = symbols.symbols;
  const file = report.files[t.file[sym]!];
  return (
    <Tooltip open key={sym}>
      <TooltipTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={6} className="max-w-[460px] px-3 py-2 text-left">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12.5px] font-semibold">{t.name[sym]}</span>
          <span className="opacity-75">{SYMBOL_KIND_LABEL[t.kind[sym]!]}</span>
        </div>
        {t.signature[sym] && (
          <p className="mt-1 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap opacity-90">{t.signature[sym]}</p>
        )}
        {t.doc[sym] && <p className="mt-1 opacity-90">{t.doc[sym]}</p>}
        <p className="figures mt-1.5 font-mono text-[11px] opacity-75">
          {plural(t.refs[sym]!, "reference")} · {plural(t.files[sym]!, "file")}
          {file ? ` · ${file.path}:${t.line[sym]! + 1}` : ""}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ReaderSkeleton() {
  return (
    <div className="space-y-2 p-5" aria-label="Loading source">
      {[72, 54, 88, 40, 66, 80, 30].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded-xs bg-wash" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** An image's preview above its text (SVG), or as the whole view (raster). */
function AssetStrip({ file }: { file: FileRecord }) {
  return (
    <div className="flex h-40 items-center justify-center border-b border-rule bg-tray p-3">
      <img src={file.asset} alt={file.name} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

const REASON: Record<SourceUnavailable, (report: Report, file: FileRecord) => { title: string; body: string }> = {
  secret: () => ({
    title: "Contents withheld: this file looks like it holds credentials",
    body: "starchart never embeds files that look like keys, tokens or .env secrets, whatever the report options say. Its size and history are still measured.",
  }),
  binary: (_, file) => ({
    title: file.asset ? "An image, shown as a preview" : "A binary file has no text to read",
    body: file.facts?.format
      ? `The analyzer read its header as ${file.facts.format}${file.facts.width ? `, ${file.facts.width} × ${file.facts.height} px` : ""}.`
      : `${formatBytes(file.bytes)} of binary data.`,
  }),
  disabled: () => ({
    title: "This report was written without source",
    body: "It was generated with --no-source, so file contents were left out for sharing. Metrics, history, imports and symbols are all still here.",
  }),
  "too-large": (report, file) => ({
    title: "Over the size cap for embedded source",
    body: `At ${formatBytes(file.bytes)}, this file is over the ${formatBytes(report.source?.maxFileBytes ?? 0)} per-file cap (or the report's total budget ran out), so its contents were left out.`,
  }),
  missing: () => ({
    title: "The source for this file could not be loaded",
    body: "Its chunk under data/source did not load. If the report was copied, check that the data folder came with it.",
  }),
};

function NoSource({ report, file, reason }: { report: Report; file: FileRecord; reason: SourceUnavailable }) {
  const { title, body } = REASON[reason](report, file);
  const Icon = reason === "secret" ? Lock : file.asset ? ImageIcon : FileX;
  return (
    <div className="h-full overflow-auto">
      {file.asset && (
        <div className="flex min-h-[50%] items-center justify-center border-b border-rule bg-tray p-6">
          <img src={file.asset} alt={file.name} className="max-h-[60vh] max-w-full object-contain" />
        </div>
      )}
      <div className="max-w-[62ch] px-6 py-6">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Icon aria-hidden className="size-4 shrink-0 text-ink-3" />
          {title}
        </h3>
        <p className="mt-2 text-ink-2">{body}</p>
        <dl className="mt-5 grid max-w-sm grid-cols-2 border-t border-rule text-[13px]">
          {[
            ["Size", formatBytes(file.bytes)],
            ["Lines", file.lines ? formatInt(file.lines) : "None counted"],
            ["Commits", file.git ? formatInt(file.git.commits) : "No history"],
            ["Imported by", formatInt(file.fanIn)],
          ].map(([k, v]) => (
            <div key={k} className="border-b border-rule py-2 odd:border-r odd:pr-3 even:pl-3">
              <dt className="text-xs text-ink-3">{k}</dt>
              <dd className="figures font-mono text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-3">The accession record has the rest of what was measured.</p>
      </div>
    </div>
  );
}

/** No file chosen yet: say how to choose one, and offer the files most worth reading. */
function NothingOpen({ report }: { report: Report }) {
  const model = useViewer((s) => s.model);
  const openSource = useViewer((s) => s.openSource);
  const picks = useMemo(() => {
    if (!model) return [];
    const holo = [...model.holotypes];
    const rest = report.files
      .filter((f) => f.src >= 0 && !model.holotypes.has(f.id))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, Math.max(0, 8 - holo.length))
      .map((f) => f.id);
    return [...holo, ...rest].slice(0, 8);
  }, [model, report]);
  return (
    <div className="h-full overflow-auto bg-paper px-6 py-6">
      <h2 className="text-[17px] font-semibold text-ink [font-stretch:85%]">Choose a file to read</h2>
      <p className="mt-1.5 max-w-[60ch] text-ink-2">
        Pick a star on the plate, a row in the explorer, or press <Kbd>⌘K</Kbd> and type part of a file name.
      </p>
      {picks.length > 0 && (
        <div className="mt-5 max-w-xl">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Most depended on</h3>
          <div className="border-t border-rule">
            {picks.map((id) => {
              const f = report.files[id]!;
              return (
                <RowButton key={id} onClick={() => openSource({ file: id })} aside={plural(f.fanIn, "importer")}>
                  <span
                    className={cn("size-2 shrink-0 rounded-full", model?.holotypes.has(id) ? "bg-holotype" : "bg-rule-strong")}
                    title={model?.holotypes.has(id) ? "Holotype: the most depended-on file in its region" : undefined}
                  />
                  <span className="truncate font-mono text-xs">{f.path}</span>
                </RowButton>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
