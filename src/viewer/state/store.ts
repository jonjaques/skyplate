/**
 * The viewer's single source of truth.
 *
 * Product principle: one selection, everywhere. The galaxy, every chart, the explorer, the
 * accession record and the source reader all read `selection` and `focusDir` from here and
 * write them back through the actions below, so they never disagree about what is selected.
 *
 * Hover lives in its own store. It changes on every pointer move; keeping it out of the main
 * store means components that only care about selection or filters never re-render while
 * the pointer sweeps across the galaxy.
 */

import { create } from "zustand";
import type { Category, CodeSymbols, Report } from "../../shared/schema";
import { buildModel, type Model } from "../model/indices";
import { buildSymbolModel, type SymbolModel } from "../model/symbols";

export type Tab = "galaxy" | "charts" | "explorer" | "source" | "findings";

/** Anything a reader can point at. Ids index the report's tables. */
export type Target =
  | { kind: "file"; id: number }
  | { kind: "dir"; id: number }
  | { kind: "symbol"; id: number }
  | { kind: "author"; id: number };

export type ColorBy =
  | "language" //   categorical, 7 slots + Other
  | "category" //   categorical, 7 groups
  | "churn" //      sequential: commits
  | "age" //        sequential: time since last change
  | "complexity" // sequential
  | "ownership" //  sequential: top author's share
  | "hotspot" //    sequential
  | "rank"; //      sequential: PageRank

export type SizeBy = "lines" | "bytes" | "complexity" | "commits" | "rank";
export type LayoutMode = "tree" | "graph";
export type EdgeMode = "none" | "selection" | "all";
export type ThemePref = "system" | "light" | "dark";

export interface Filters {
  /** null = every language. */
  languages: Set<string> | null;
  categories: Set<Category> | null;
  hideGenerated: boolean;
  hideVendored: boolean;
}

/** Where the source reader is pointed, and what to highlight there. */
export interface SourceTarget {
  file: number;
  /** 0-based line to scroll to. */
  line?: number;
  /** Ranges to mark, 0-based line/col, UTF-16 length. */
  marks?: { line: number; col: number; len: number }[];
}

interface ViewerState {
  report: Report | null;
  model: Model | null;
  symbols: CodeSymbols | null;
  symbolModel: SymbolModel | null;
  symbolsStatus: "absent" | "idle" | "loading" | "ready" | "error";

  tab: Tab;
  selection: Target | null;
  /** The open drawer: a directory whose specimens stay lit while everything else dims. */
  focusDir: number | null;
  colorBy: ColorBy;
  sizeBy: SizeBy;
  layout: LayoutMode;
  edges: EdgeMode;
  /** History scrubber position (unix seconds); null means HEAD, the present. */
  time: number | null;
  filters: Filters;
  source: SourceTarget | null;
  theme: ThemePref;
  paletteOpen: boolean;

  setReport(report: Report): void;
  setSymbols(symbols: CodeSymbols): void;
  setSymbolsStatus(status: ViewerState["symbolsStatus"]): void;
  setTab(tab: Tab): void;
  select(target: Target | null): void;
  focus(dir: number | null): void;
  setColorBy(mode: ColorBy): void;
  setSizeBy(mode: SizeBy): void;
  setLayout(mode: LayoutMode): void;
  setEdges(mode: EdgeMode): void;
  setTime(time: number | null): void;
  setFilters(patch: Partial<Filters>): void;
  /** Open a file in the source reader (switches to the Source tab). */
  openSource(target: SourceTarget): void;
  setTheme(theme: ThemePref): void;
  setPaletteOpen(open: boolean): void;
}

export const useViewer = create<ViewerState>((set, get) => ({
  report: null,
  model: null,
  symbols: null,
  symbolModel: null,
  symbolsStatus: "absent",

  tab: "galaxy",
  selection: null,
  focusDir: null,
  colorBy: "language",
  sizeBy: "lines",
  layout: "tree",
  edges: "selection",
  time: null,
  filters: { languages: null, categories: null, hideGenerated: false, hideVendored: true },
  source: null,
  theme: "system",
  paletteOpen: false,

  setReport(report) {
    set({
      report,
      model: buildModel(report),
      symbolsStatus: report.symbols ? "idle" : "absent",
    });
  },
  setSymbols(symbols) {
    const model = get().model;
    if (!model) return;
    set({ symbols, symbolModel: buildSymbolModel(symbols, model), symbolsStatus: "ready" });
  },
  setSymbolsStatus(symbolsStatus) {
    set({ symbolsStatus });
  },
  setTab(tab) {
    set({ tab });
  },
  select(selection) {
    set({ selection });
  },
  focus(focusDir) {
    set({ focusDir });
  },
  setColorBy(colorBy) {
    set({ colorBy });
  },
  setSizeBy(sizeBy) {
    set({ sizeBy });
  },
  setLayout(layout) {
    set({ layout });
  },
  setEdges(edges) {
    set({ edges });
  },
  setTime(time) {
    set({ time });
  },
  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },
  openSource(source) {
    set({ source, tab: "source", selection: { kind: "file", id: source.file } });
  },
  setTheme(theme) {
    set({ theme });
  },
  setPaletteOpen(paletteOpen) {
    set({ paletteOpen });
  },
}));

/** Transient pointer hover, kept apart from the main store (see the header comment). */
export const useHover = create<{ hover: Target | null; setHover(target: Target | null): void }>(
  (set) => ({
    hover: null,
    setHover(hover) {
      set({ hover });
    },
  }),
);

export function sameTarget(a: Target | null, b: Target | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}
