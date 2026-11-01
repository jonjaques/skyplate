/**
 * The reader's text: line numbers, highlighted tokens, interactive identifiers, virtualized.
 *
 * Only the lines in view (plus an overscan) are in the DOM, with spacers above and below, so a
 * 10k-line file costs the same to scroll as a 100-line one. Rows stay in normal flow between
 * the spacers rather than being absolutely positioned: with wrapping on, row heights are
 * estimated from character counts (exact for monospace, approximate for tabs and wide
 * glyphs), and an estimate that is off by a row then shifts the scroll extent slightly instead
 * of overlapping two lines.
 *
 * Identifier interaction is delegated: one listener on the scroller reads `data-sym` from the
 * span under the pointer. A tooltip trigger per identifier would mount hundreds of Radix roots
 * per screen and re-create them on every scroll.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { cn } from "../lib/utils";
import type { Tok } from "./highlight";
import { syntaxClass } from "./syntax";

export interface CodeRange {
  col: number;
  len: number;
  sym: number;
  /** A declaration name rather than a use. */
  decl: boolean;
}

export interface CodeMark {
  line: number;
  col: number;
  len: number;
}

const LINE_HEIGHT = 20;
const OVERSCAN = 12;
const TAB = 4;

interface Props {
  lines: Tok[][];
  /** Interactive identifiers per line, sorted by column. */
  ranges: Map<number, CodeRange[]> | null;
  /** Ranges the reader was sent to (a reference, a definition). */
  marks: CodeMark[];
  selectedSymbol: number | null;
  /** Line to bring into view; `scrollKey` changes when the same line is requested again. */
  targetLine: number | undefined;
  scrollKey: unknown;
  wrap: boolean;
  onSymbolHover(sym: number | null, el: HTMLElement | null): void;
  onSymbolClick(sym: number, toDefinition: boolean): void;
}

function visualLength(toks: Tok[]): number {
  let n = 0;
  for (const tok of toks) for (let i = 0; i < tok.t.length; i++) n += tok.t.charCodeAt(i) === 9 ? TAB : 1;
  return n;
}

/** Measure one monospace character at the reader's size, once per mount. */
function useCharWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(7.5);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    host.appendChild(probe);
    const width = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (width > 0) setW(width);
  }, [ref]);
  return w;
}

export function CodeView({
  lines,
  ranges,
  marks,
  selectedSymbol,
  targetLine,
  scrollKey,
  wrap,
  onSymbolHover,
  onSymbolClick,
}: Props) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 800 });
  const charWidth = useCharWidth(scroller);
  const digits = String(lines.length).length;
  const gutter = Math.ceil(digits * charWidth + 28);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport((v) => ({ ...v, height: el.clientHeight, width: el.clientWidth }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Row offsets. Without wrap every row is one line tall, so the prefix sums are implicit.
  const offsets = useMemo(() => {
    if (!wrap) return null;
    const perRow = Math.max(8, Math.floor((viewport.width - gutter - 24) / charWidth));
    const out = new Float64Array(lines.length + 1);
    for (let i = 0; i < lines.length; i++) {
      out[i + 1] = out[i]! + Math.max(1, Math.ceil(visualLength(lines[i]!) / perRow)) * LINE_HEIGHT;
    }
    return out;
  }, [wrap, lines, viewport.width, gutter, charWidth]);

  const total = offsets ? offsets[lines.length]! : lines.length * LINE_HEIGHT;
  const offsetOf = useCallback((i: number) => (offsets ? offsets[i]! : i * LINE_HEIGHT), [offsets]);
  const indexAt = useCallback(
    (y: number) => {
      if (!offsets) return Math.floor(y / LINE_HEIGHT);
      let lo = 0;
      let hi = lines.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1]! <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [offsets, lines.length],
  );

  const start = Math.max(0, indexAt(viewport.top) - OVERSCAN);
  const end = Math.min(lines.length, indexAt(viewport.top + viewport.height) + OVERSCAN + 1);

  // Bring the requested line to the upper third, where the eye lands after a jump.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || targetLine === undefined) return;
    const y = Math.max(0, offsetOf(Math.min(targetLine, lines.length - 1)) - el.clientHeight * 0.3);
    el.scrollTop = y;
    setViewport((v) => ({ ...v, top: el.scrollTop }));
    // offsetOf changes with wrap and width; re-aim only on a new request or a new file.
  }, [scrollKey, targetLine, lines.length]);

  const raf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) setViewport((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }));
    });
    onSymbolHover(null, null);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const marksByLine = useMemo(() => {
    const m = new Map<number, CodeMark[]>();
    for (const mark of marks) m.set(mark.line, [...(m.get(mark.line) ?? []), mark]);
    return m;
  }, [marks]);

  const symbolAt = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sym]");
    return el ? { el, sym: Number(el.dataset.sym) } : null;
  };

  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <Line
        key={i}
        index={i}
        toks={lines[i]!}
        ranges={ranges?.get(i)}
        marks={marksByLine.get(i)}
        selectedSymbol={selectedSymbol}
        target={i === targetLine}
        wrap={wrap}
        gutter={gutter}
      />,
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      onMouseOver={(e) => {
        const hit = symbolAt(e);
        onSymbolHover(hit?.sym ?? null, hit?.el ?? null);
      }}
      onMouseLeave={() => onSymbolHover(null, null)}
      onClick={(e) => {
        const hit = symbolAt(e);
        if (hit) onSymbolClick(hit.sym, e.metaKey || e.ctrlKey);
      }}
      className="relative h-full overflow-auto bg-paper font-mono text-[12.5px] leading-5 [tab-size:4]"
      role="region"
      aria-label="Source text"
      tabIndex={0}
    >
      <div className={wrap ? "w-full" : "w-max min-w-full"}>
        <div style={{ height: offsetOf(start) }} />
        {rows}
        <div style={{ height: total - offsetOf(end) }} />
      </div>
    </div>
  );
}

interface Segment {
  text: string;
  cls: string;
  sym: number;
  decl: boolean;
  mark: "target" | "occurrence" | null;
}

/** Cut a line into runs where the syntax scope, the identifier and the mark are constant. */
function segment(toks: Tok[], ranges: CodeRange[] | undefined, marks: CodeMark[] | undefined, selected: number | null): Segment[] {
  const text = toks.map((t) => t.t).join("");
  const cuts = new Set<number>([0, text.length]);
  let at = 0;
  for (const t of toks) {
    cuts.add(at);
    at += t.t.length;
  }
  // Overlapping ranges (shorthand properties report two symbols at one spot) keep the first.
  const kept: CodeRange[] = [];
  let reach = -1;
  for (const r of ranges ?? []) {
    if (r.col < reach || r.col >= text.length) continue;
    kept.push(r);
    reach = r.col + r.len;
    cuts.add(r.col);
    cuts.add(Math.min(text.length, r.col + r.len));
  }
  for (const m of marks ?? []) {
    cuts.add(Math.min(text.length, m.col));
    cuts.add(Math.min(text.length, m.col + m.len));
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const out: Segment[] = [];
  let ti = 0;
  let tokStart = 0;
  let ri = 0;
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k]!;
    const b = sorted[k + 1]!;
    if (b <= a) continue;
    while (ti < toks.length && tokStart + toks[ti]!.t.length <= a) {
      tokStart += toks[ti]!.t.length;
      ti++;
    }
    while (ri < kept.length && kept[ri]!.col + kept[ri]!.len <= a) ri++;
    const r = kept[ri] && kept[ri]!.col <= a ? kept[ri]! : null;
    const target = marks?.some((m) => m.col <= a && a < m.col + m.len);
    out.push({
      text: text.slice(a, b),
      cls: syntaxClass(toks[ti]?.c ?? ""),
      sym: r ? r.sym : -1,
      decl: r?.decl ?? false,
      mark: target ? "target" : r && r.sym === selected ? "occurrence" : null,
    });
  }
  return out;
}

const MARK_CLASS = {
  target: "rounded-[2px] bg-[#b7d3f6] dark:bg-[#184f95]",
  occurrence: "rounded-[2px] bg-[#d6e6fa] dark:bg-[#1f3550]",
};

const Line = memo(function Line({
  index,
  toks,
  ranges,
  marks,
  selectedSymbol,
  target,
  wrap,
  gutter,
}: {
  index: number;
  toks: Tok[];
  ranges: CodeRange[] | undefined;
  marks: CodeMark[] | undefined;
  selectedSymbol: number | null;
  target: boolean;
  wrap: boolean;
  gutter: number;
}) {
  // Only lines that hold the selected symbol need to know which symbol that is.
  const relevantSelection = ranges?.some((r) => r.sym === selectedSymbol) ? selectedSymbol : null;
  const segs = useMemo(() => segment(toks, ranges, marks, relevantSelection), [toks, ranges, marks, relevantSelection]);

  // Group consecutive pieces of one identifier so its underline and hit area are continuous.
  const children = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.sym < 0) {
      children.push(
        <span key={i} className={cn(s.cls, s.mark && MARK_CLASS[s.mark])}>
          {s.text}
        </span>,
      );
      continue;
    }
    const group: Segment[] = [s];
    while (i + 1 < segs.length && segs[i + 1]!.sym === s.sym && segs[i + 1]!.decl === s.decl) group.push(segs[++i]!);
    const mark = group.find((g) => g.mark)?.mark ?? null;
    children.push(
      <span
        key={i}
        data-sym={s.sym}
        className={cn(
          "cursor-pointer decoration-ink-3 decoration-1 underline-offset-[3px] hover:underline",
          s.decl && "decoration-dotted",
          mark && MARK_CLASS[mark],
        )}
      >
        {group.map((g, k) => (
          <span key={k} className={g.cls}>
            {g.text}
          </span>
        ))}
      </span>,
    );
  }

  return (
    <div className={cn("flex", target ? "bg-[#edf3fb] dark:bg-[#1f2b38]" : "bg-paper")} data-line={index}>
      <span
        aria-hidden
        className="figures sticky left-0 z-[1] shrink-0 bg-inherit pr-4 text-right text-ink-3 select-none"
        style={{ width: gutter }}
      >
        {index + 1}
      </span>
      <span className={wrap ? "min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap" : "pr-8 whitespace-pre"}>
        {children.length ? children : " "}
      </span>
    </div>
  );
});
