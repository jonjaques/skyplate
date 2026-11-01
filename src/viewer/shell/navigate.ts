/**
 * The handful of moves every panel makes: select something, focus a drawer, open the source
 * reader at a place. They live in one module so a reference row in the record, a chip in the
 * findings and a hit in the command palette all behave identically.
 *
 * Jumps into the source (a call site, a definition) and `dig` are deliberate moves, so they
 * mark the next URL write as a browser history entry (state/url.ts): Back retraces them.
 * Plain `show` does not, because the plate and the explorer call it for every click.
 */

import type { CodeSymbols } from "../../shared/schema";
import { useViewer, type SourceTarget, type Tab, type Target } from "../state/store";
import { pushNextView } from "../state/url";

/** Select a target and, when asked, switch to the tab that shows it best. */
export function show(target: Target, tab?: Tab): void {
  const s = useViewer.getState();
  if (target.kind === "dir") s.focus(target.id === 0 ? null : target.id);
  s.select(target);
  if (tab) s.setTab(tab);
}

/**
 * Make another specimen the record's subject from inside the record (a crosshair, "Member of",
 * an implementation): a step deeper that Back should be able to undo.
 */
export function dig(target: Target): void {
  pushNextView();
  show(target);
}

/** Open a drawer: everything outside it dims, and the record describes it. */
export function focusDrawer(dir: number | null): void {
  const s = useViewer.getState();
  s.focus(dir === 0 ? null : dir);
  s.select(dir === null ? null : { kind: "dir", id: dir });
}

/**
 * Open the source reader without losing a symbol selection.
 *
 * store.openSource selects the file it opens, which is right for "read this file" but wrong for
 * "show me where this function is called": the record would jump from the function to the file
 * and the galaxy would drop the function's lighting. So when a symbol is selected it is put
 * back immediately; both writes land in the same React batch, so nothing flickers.
 */
export function openSourceKeepingSymbol(target: SourceTarget): void {
  const s = useViewer.getState();
  const previous = s.selection;
  pushNextView();
  s.openSource(target);
  if (previous?.kind === "symbol") s.select(previous);
}

/** Open the reader at a symbol's declaration with its name marked, and select the symbol. */
export function openSymbolDefinition(symbols: CodeSymbols, id: number): void {
  const t = symbols.symbols;
  const file = t.file[id];
  if (file === undefined) return;
  const line = t.line[id]!;
  const s = useViewer.getState();
  pushNextView();
  s.openSource({ file, line, marks: [{ line, col: t.col[id]!, len: t.name[id]!.length }] });
  s.select({ kind: "symbol", id });
}

/** Open a file in the reader (selecting it). */
export function openFile(file: number, line?: number): void {
  useViewer.getState().openSource(line === undefined ? { file } : { file, line });
}

/** "SC-0113": the specimen's catalog number, its index in the report, padded to the widest id. */
export function accession(id: number, count: number): string {
  return `SC-${String(id).padStart(Math.max(4, String(Math.max(0, count - 1)).length), "0")}`;
}
