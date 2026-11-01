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

  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setRailSheetOpen: (railSheetOpen) => set({ railSheetOpen }),
  setExplorerMode: (explorerMode) => set({ explorerMode }),
  setFileSort: (fileSort) => set({ fileSort }),
  setSymbolSort: (symbolSort) => set({ symbolSort }),
  setFileFilter: (fileFilter) => set({ fileFilter }),
  setSymbolFilter: (symbolFilter) => set({ symbolFilter }),
  setSymbolKind: (symbolKind) => set({ symbolKind }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
}));
