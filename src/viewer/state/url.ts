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
 * would land on the wrong file.
 *
 * History: most updates use replaceState, because every click on the plate selects something
 * and an entry per click would make Back useless. But with replaceState alone Back was an exit
 * button: after any amount of work it left the report for whatever page came before. So the
 * deliberate moves add an entry: a tab switch (detected here), and the jumps callers mark with
 * pushNextView() (a palette pick, a call site or definition opened from the record, ⌘-click
 * in the reader). Back and Forward then restore the whole view of that entry, defaults
 * included, not just the params it happens to carry.
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

/**
 * True while the store is being set from the URL. Those changes describe an entry that already
 * exists, so they must never push a new one (Back would otherwise push, and wipe Forward).
 */
let applying = false;

/** When pushNextView() was last called (performance.now()), or 0. */
let pushRequested = 0;
/**
 * A mark older than this is stale: the move it announced changed nothing (the reader picked
 * what was already selected), and the next unrelated plate click must not inherit the push.
 */
const PUSH_WINDOW_MS = 1000;

/**
 * Make the next URL update a new history entry instead of replacing the current one. Call it
 * just before a deliberate move (see the header); ordinary selection changes do not.
 */
export function pushNextView(): void {
  pushRequested = performance.now();
}

/**
 * Apply a hash to the store. `full` is for history traversal: an entry's missing params mean
 * their defaults (no tab param is the galaxy, no selection param is nothing selected), where a
 * link pasted into an open tab only changes what it names.
 */
function applyHash(hash: string, full = false): void {
  applying = true;
  try {
    applyHashParams(hash, full);
  } finally {
    applying = false;
  }
}

function applyHashParams(hash: string, full: boolean): void {
  const s = useViewer.getState();
  const report = s.report;
  const model = s.model;
  if (!report || !model) return;
  const p = parseHash(hash);

  const tab = p.get("tab") as Tab | undefined;
  if (tab && TABS.includes(tab)) s.setTab(tab);
  else if (full) s.setTab("galaxy");
  const color = p.get("color") as ColorBy | undefined;
  if (color && COLOR_MODES.includes(color)) s.setColorBy(color);
  else if (full) s.setColorBy("language");
  const size = p.get("size") as SizeBy | undefined;
  if (size && SIZE_MODES.includes(size)) s.setSizeBy(size);
  else if (full) s.setSizeBy("lines");
  const layout = p.get("layout") as LayoutMode | undefined;
  if (layout && LAYOUTS.includes(layout)) s.setLayout(layout);
  else if (full) s.setLayout("tree");

  const focus = p.get("focus");
  if (focus !== undefined) {
    const d = dirByPath(report, focus);
    s.focus(d > 0 ? d : null);
  } else if (full && p.get("dir") === undefined) {
    s.focus(null);
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
      if (id === null) return;
      applying = true;
      try {
        const st = useViewer.getState();
        // A symbol link on the Source tab means "read its declaration". On a fresh load the
        // reader would derive that from the selection alone, but a link pasted into an open
        // tab (hashchange) arrives with the reader already pinned to some other file.
        if (tab === "source" && src === undefined && st.symbols) {
          const t = st.symbols.symbols;
          const line = t.line[id]!;
          st.openSource({ file: t.file[id]!, line, marks: [{ line, col: t.col[id]!, len: t.name[id]!.length }] });
          st.setTab("source");
        }
        st.select({ kind: "symbol", id });
      } finally {
        applying = false;
      }
    });
  } else if (full) {
    s.select(null);
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
    const push = pushRequested > 0 && performance.now() - pushRequested < PUSH_WINDOW_MS;
    pushRequested = 0;
    const next = buildHash();
    if (next === lastWritten) return;
    lastWritten = next;
    const url = next ? `#${next}` : location.pathname + location.search;
    if (push) history.pushState(null, "", url);
    else history.replaceState(history.state, "", url);
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
    if (!applying) {
      // A user picking anything supersedes a symbol link still waiting for its tables.
      if (state.selection !== prev.selection) pendingSymbol = null;
      // Switching tabs is always deliberate, whichever control did it (a tab, a number key,
      // "Open in source reader"), so it always earns an entry.
      if (state.tab !== prev.tab) pushNextView();
    }
    clearTimeout(timer);
    timer = setTimeout(write, 120);
  });

  // Back and Forward. The entry's hash describes the whole view (see applyHash's `full`). A
  // write still waiting on its debounce belongs to the entry being left, so it is dropped.
  const onPopState = () => {
    clearTimeout(timer);
    pushRequested = 0;
    lastWritten = location.hash.replace(/^#/, "");
    applyHash(location.hash, true);
  };
  // A link pasted into the same tab fires hashchange (after popstate, which already applied
  // it, hence the lastWritten check); replaceState and pushState never fire it.
  const onHashChange = () => {
    const next = location.hash.replace(/^#/, "");
    if (next === lastWritten) return;
    lastWritten = next;
    applyHash(location.hash);
  };
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
  };
}
