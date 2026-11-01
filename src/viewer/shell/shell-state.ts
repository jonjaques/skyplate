/**
 * Shell-only UI state: which overlays are open and how the explorer is sorted.
 *
 * Kept out of state/store.ts on purpose. None of it is "what the reader is looking at" (that is
 * the shared selection), so the galaxy and charts never need it, and keeping it here means a
 * palette toggle or an explorer re-sort never wakes their subscriptions. The explorer's sort and
 * filter live here rather than in component state because work areas unmount when their tab is
 * left (a hidden WebGL plate would keep burning frames), and a reader coming back to the
 * explorer expects the order they left it in.
 */

import { create } from "zustand";
import type { SymbolKind } from "../../shared/schema";

export type FileSortKey = "path" | "language" | "lines" | "complexity" | "commits" | "owner" | "fanIn" | "hotspot";
export type SymbolSortKey = "name" | "kind" | "file" | "refs" | "callers" | "complexity";
export type SortDir = "asc" | "desc";

interface ShellState {
  aboutOpen: boolean;
  railSheetOpen: boolean;
  explorerMode: "files" | "symbols";
  fileSort: { key: FileSortKey; dir: SortDir };
  symbolSort: { key: SymbolSortKey; dir: SortDir };
  fileFilter: string;
  symbolFilter: string;
  symbolKind: SymbolKind | "all";
  wrapLines: boolean;

  setAboutOpen(open: boolean): void;
  setRailSheetOpen(open: boolean): void;
  setExplorerMode(mode: ShellState["explorerMode"]): void;
  setFileSort(sort: ShellState["fileSort"]): void;
  setSymbolSort(sort: ShellState["symbolSort"]): void;
  setFileFilter(filter: string): void;
  setSymbolFilter(filter: string): void;
  setSymbolKind(kind: ShellState["symbolKind"]): void;
  setWrapLines(wrap: boolean): void;
}

/**
 * The element that opened About. Radix returns focus to its DialogTrigger on close, but About
 * opens through this store (the rail's button and a palette action both call setAboutOpen),
 * so there is no trigger and focus fell to <body>: a keyboard reader started over at the top.
 * Kept outside the store because a DOM node is not state anything should render from.
 */
let aboutOpener: HTMLElement | null = null;

/** Hand back (once) the element to refocus when About closes, if it is still on the page. */
export function takeAboutOpener(): HTMLElement | null {
  const el = aboutOpener;
  aboutOpener = null;
  return el?.isConnected ? el : null;
}

/** When a keyboard open asked the reader to take focus (performance.now()), or 0. */
let readerFocusAsked = 0;

/**
 * Ask the source reader to take keyboard focus when it next shows a file. Enter on an explorer
 * row switches to the Source tab, which unmounts the explorer and with it the focused table;
 * focus fell to <body> and a keyboard reader started over from the top of the page.
 */
export function requestReaderFocus(): void {
  readerFocusAsked = performance.now();
}

/**
 * Called by the reader's text (or its no-source page) when it mounts: true once if a request
 * is pending. A request older than a few seconds is dropped (the source never loaded, or the
 * reader moved on), so a later, unrelated mount does not steal focus.
 */
export function takeReaderFocus(): boolean {
  const asked = readerFocusAsked;
  readerFocusAsked = 0;
  return asked > 0 && performance.now() - asked < 4000;
}

export const useShell = create<ShellState>((set) => ({
  aboutOpen: false,
  railSheetOpen: false,
  explorerMode: "files",
  fileSort: { key: "hotspot", dir: "desc" },
  symbolSort: { key: "refs", dir: "desc" },
  fileFilter: "",
  symbolFilter: "",
  symbolKind: "all",
  wrapLines: false,

  setAboutOpen: (aboutOpen) => {
    if (aboutOpen && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      aboutOpener = document.activeElement;
    }
    set({ aboutOpen });
  },
  setRailSheetOpen: (railSheetOpen) => set({ railSheetOpen }),
  setExplorerMode: (explorerMode) => set({ explorerMode }),
  setFileSort: (fileSort) => set({ fileSort }),
  setSymbolSort: (symbolSort) => set({ symbolSort }),
  setFileFilter: (fileFilter) => set({ fileFilter }),
  setSymbolFilter: (symbolFilter) => set({ symbolFilter }),
  setSymbolKind: (symbolKind) => set({ symbolKind }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
}));
