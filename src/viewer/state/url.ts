/**
 * The view, in the URL hash, so a link opens the same view.
 *
 * Reports get shared with teams ("look at this hotspot"), so the tab, the selection, the open
 * drawer and the encodings round-trip through `location.hash`:
 *
 *   #tab=source&file=src/server/index.ts&line=120
 *   #sym=createServer@src/node/server/index.ts:412
 *   #dir=packages/vite&color=hotspot&size=commits&layout=graph
 *
 * References are paths, names and emails, never report ids: ids are positions in one report's
 * tables and shift when the project changes, so a link written against last week's report
 * would land on the wrong file. Updates use replaceState, because every click selects
 * something and a history entry per click would make Back useless.
 */

import type { Report } from "../../shared/schema";
import { ensureSymbols } from "./loaders";
import { useViewer, type ColorBy, type LayoutMode, type SizeBy, type Tab, type Target } from "./store";

const TABS: Tab[] = ["galaxy", "charts", "explorer", "source", "findings"];
const COLOR_MODES: ColorBy[] = ["language", "category", "churn", "age", "complexity", "ownership", "hotspot", "rank"];
const SIZE_MODES: SizeBy[] = ["lines", "bytes", "complexity", "commits", "rank"];
const LAYOUTS: LayoutMode[] = ["tree", "graph"];

/** encodeURIComponent, but leave the characters paths and symbol refs are made of readable. */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%40/g, "@");
}

function parseHash(hash: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of hash.replace(/^#/, "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const raw = eq < 0 ? "" : part.slice(eq + 1);
    try {
      out.set(key, decodeURIComponent(raw));
    } catch {
      // A hand-edited link with a stray "%": ignore that one key, keep the rest.
    }
  }
  return out;
}

// ─── Selection <-> text ──────────────────────────────────────────────────────────────────────

function dirByPath(report: Report, path: string): number {
  const clean = path.replace(/\/+$/, "");
  return report.dirs.findIndex((d) => d.path === clean);
}

/** "name@path:line", 1-based line as people quote it. */
function symbolRef(target: Extract<Target, { kind: "symbol" }>): string | null {
  const { symbols, report } = useViewer.getState();
  if (!symbols || !report) return null;
  const t = symbols.symbols;
  const file = report.files[t.file[target.id]!];
  if (!file) return null;
  return `${t.name[target.id]}@${file.path}:${t.line[target.id]! + 1}`;
}

function resolveSymbolRef(ref: string): number | null {
  const { symbols, model } = useViewer.getState();
  if (!symbols || !model) return null;
  const m = /^(.*)@(.*):(\d+)$/.exec(ref);
  if (!m) return null;
  const [, name, path, lineText] = m;
  const file = model.pathIndex.get(path!);
  if (file === undefined) return null;
  const line = Number(lineText) - 1;
  const t = symbols.symbols;
  let fallback: number | null = null;
  // Same name and file is enough when the line moved a little since the link was written.
  for (let i = 0; i < t.name.length; i++) {
    if (t.file[i] !== file || t.name[i] !== name) continue;
    if (t.line[i] === line) return i;
    fallback ??= i;
  }
  return fallback;
}

/** The selection as hash params, or null when it cannot be written (symbols not loaded yet). */
function selectionParams(sel: Target | null): [string, string] | null {
  const { report } = useViewer.getState();
  if (!sel || !report) return null;
  switch (sel.kind) {
    case "file": {
      const f = report.files[sel.id];
      return f ? ["file", f.path] : null;
    }
    case "dir": {
      const d = report.dirs[sel.id];
      return d && sel.id !== 0 ? ["dir", d.path] : null;
    }
    case "author": {
      const a = report.git?.authors[sel.id];
      return a ? ["author", a.email] : null;
    }
    case "symbol": {
      const ref = symbolRef(sel);
      return ref ? ["sym", ref] : null;
    }
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────────────────────

/**
 * A symbol link that arrived before the symbol tables did. While it is pending the writer keeps
 * it in the hash, so the link survives the second or two the tables take to load instead of
 * being overwritten by "nothing selected".
 */
let pendingSymbol: string | null = null;

function applyHash(hash: string): void {
  const s = useViewer.getState();
  const report = s.report;
  const model = s.model;
  if (!report || !model) return;
  const p = parseHash(hash);

  const tab = p.get("tab") as Tab | undefined;
  if (tab && TABS.includes(tab)) s.setTab(tab);
  const color = p.get("color") as ColorBy | undefined;
  if (color && COLOR_MODES.includes(color)) s.setColorBy(color);
  const size = p.get("size") as SizeBy | undefined;
  if (size && SIZE_MODES.includes(size)) s.setSizeBy(size);
  const layout = p.get("layout") as LayoutMode | undefined;
  if (layout && LAYOUTS.includes(layout)) s.setLayout(layout);

  const focus = p.get("focus");
  if (focus !== undefined) {
    const d = dirByPath(report, focus);
    s.focus(d > 0 ? d : null);
  }

  // The reader's file and line, when the link was taken on the Source tab.
  const src = p.get("src") ?? p.get("file");
  const lineText = p.get("line");
  if (tab === "source" && src !== undefined) {
    const file = model.pathIndex.get(src);
    if (file !== undefined) {
      const line = lineText ? Math.max(0, Number(lineText) - 1) : undefined;
      s.openSource(line === undefined || Number.isNaN(line) ? { file } : { file, line });
    }
  }

  const file = p.get("file");
  const dir = p.get("dir");
  const author = p.get("author");
  const sym = p.get("sym");
  if (file !== undefined) {
    const id = model.pathIndex.get(file);
    if (id !== undefined) s.select({ kind: "file", id });
  } else if (dir !== undefined) {
    const id = dirByPath(report, dir);
    if (id >= 0) {
      s.select({ kind: "dir", id });
      if (focus === undefined && id > 0) s.focus(id);
    }
  } else if (author !== undefined) {
    const id = report.git?.authors.findIndex((a) => a.email === author) ?? -1;
    if (id >= 0) s.select({ kind: "author", id });
  } else if (sym !== undefined) {
    pendingSymbol = sym;
    void ensureSymbols().then(() => {
      if (pendingSymbol !== sym) return;
      pendingSymbol = null;
      const id = resolveSymbolRef(sym);
      if (id !== null) useViewer.getState().select({ kind: "symbol", id });
    });
  }
  // The tab param was applied first, but openSource/select may have moved it; put it back.
  if (tab && TABS.includes(tab)) useViewer.getState().setTab(tab);
}

// ─── Write ───────────────────────────────────────────────────────────────────────────────────

function buildHash(): string {
  const s = useViewer.getState();
  const parts: string[] = [];
  if (s.tab !== "galaxy") parts.push(`tab=${s.tab}`);

  const sel = selectionParams(s.selection);
  if (sel) parts.push(`${sel[0]}=${enc(sel[1])}`);
  else if (pendingSymbol) parts.push(`sym=${enc(pendingSymbol)}`);

  if (s.focusDir !== null && !(s.selection?.kind === "dir" && s.selection.id === s.focusDir)) {
    const d = s.report?.dirs[s.focusDir];
    if (d) parts.push(`focus=${enc(d.path)}`);
  }
  if (s.tab === "source" && s.source) {
    const f = s.report?.files[s.source.file];
    if (f && !(s.selection?.kind === "file" && s.selection.id === s.source.file)) parts.push(`src=${enc(f.path)}`);
    if (s.source.line !== undefined) parts.push(`line=${s.source.line + 1}`);
  }
  if (s.colorBy !== "language") parts.push(`color=${s.colorBy}`);
  if (s.sizeBy !== "lines") parts.push(`size=${s.sizeBy}`);
  if (s.layout !== "tree") parts.push(`layout=${s.layout}`);
  return parts.join("&");
}

/**
 * Restore the view from the hash, then keep the hash in step with the store. Call once, after
 * the report is in the store. Returns the cleanup.
 */
export function startUrlSync(): () => void {
  applyHash(location.hash);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWritten = location.hash.replace(/^#/, "");
  const write = () => {
    const next = buildHash();
    if (next === lastWritten) return;
    lastWritten = next;
    history.replaceState(history.state, "", next ? `#${next}` : location.pathname + location.search);
  };
  const unsubscribe = useViewer.subscribe((state, prev) => {
    if (
      state.tab === prev.tab &&
      state.selection === prev.selection &&
      state.focusDir === prev.focusDir &&
      state.source === prev.source &&
      state.colorBy === prev.colorBy &&
      state.sizeBy === prev.sizeBy &&
      state.layout === prev.layout &&
      state.symbols === prev.symbols
    ) {
      return;
    }
    // A user picking anything supersedes a symbol link still waiting for its tables.
    if (state.selection !== prev.selection) pendingSymbol = null;
    clearTimeout(timer);
    timer = setTimeout(write, 120);
  });

  // A pasted link in the same tab fires hashchange; replaceState never does.
  const onHashChange = () => {
    const next = location.hash.replace(/^#/, "");
    if (next === lastWritten) return;
    lastWritten = next;
    applyHash(location.hash);
  };
  window.addEventListener("hashchange", onHashChange);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("hashchange", onHashChange);
  };
}
