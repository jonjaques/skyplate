/**
 * The dig trail: the last few symbols the record described, so a reader who went from vec3 to
 * a caller to that caller's caller can step back the way they came.
 *
 * Every move inside the record (a crosshair, "Member of", an implementation, a name clicked in
 * the source) replaces the selection, and before this the only way back to where a dig started
 * was the palette. Browser history covers the deliberate jumps between views (state/url.ts);
 * this covers the walk within one, without an entry per hop, and without the plate clicks and
 * file selections that happen in between.
 *
 * Kept apart from the shared store: nothing outside the symbol record reads it.
 */

import { create } from "zustand";
import { useViewer } from "../state/store";
import { show } from "./navigate";

/** Symbols kept. Enough to retrace a dig; a longer trail stops being a trail. */
const CAP = 10;

interface TrailState {
  /** Symbol ids, oldest first, each at most once. */
  trail: number[];
  /** Index of the symbol the reader is on; entries after it are where Back came from. */
  at: number;
}

export const useTrail = create<TrailState>(() => ({ trail: [], at: -1 }));

/** Set while the trail itself moves the selection, so the move is not recorded as a new visit. */
let stepping = false;

/** Pure, for testing: the trail after visiting `id`. */
export function visit(state: TrailState, id: number): TrailState {
  if (state.trail[state.at] === id) return state;
  // A new visit after stepping back drops the steps ahead (as browser history does), and a
  // symbol already on the trail moves to its end rather than appearing twice.
  const next = state.trail.slice(0, state.at + 1).filter((s) => s !== id);
  next.push(id);
  const trail = next.slice(-CAP);
  return { trail, at: trail.length - 1 };
}

/** Record symbol selections. Call once, after the report is in; returns the cleanup. */
export function startSymbolTrail(): () => void {
  return useViewer.subscribe((state, prev) => {
    // Ids index one symbol table; new tables make the old trail meaningless.
    if (state.symbols !== prev.symbols) useTrail.setState({ trail: [], at: -1 });
    const sel = state.selection;
    if (stepping || sel === prev.selection || sel?.kind !== "symbol") return;
    const current = useTrail.getState();
    const next = visit(current, sel.id);
    if (next !== current) useTrail.setState(next);
  });
}

/** Select the symbol at a trail index (a breadcrumb, or Back/Forward). */
export function stepTo(index: number): void {
  const { trail } = useTrail.getState();
  const id = trail[index];
  if (id === undefined) return;
  stepping = true;
  try {
    useTrail.setState({ at: index });
    show({ kind: "symbol", id });
  } finally {
    stepping = false;
  }
}

/**
 * Back (-1) or Forward (+1) along the trail. When the reader has wandered off the trail (a
 * file is selected now), Back first returns to the symbol they left rather than skipping it.
 */
export function step(delta: -1 | 1): void {
  const { trail, at } = useTrail.getState();
  const sel = useViewer.getState().selection;
  const onTrail = sel?.kind === "symbol" && trail[at] === sel.id;
  stepTo(delta === -1 && !onTrail ? at : at + delta);
}
