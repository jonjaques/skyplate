/**
 * Linked selection for charts. Product principle: one selection, everywhere. Hovering a mark
 * that is a file, directory, author or symbol lights it in the galaxy (hover store); clicking
 * selects it for every view (main store). Charts also read both back, so a star hovered in
 * the galaxy lights its bar here.
 */

import { sameTarget, useHover, useViewer, type Target } from "../../state/store";

export function useLink() {
  const setHover = useHover((s) => s.setHover);
  const select = useViewer((s) => s.select);
  return {
    hover: (target: Target | null) => setHover(target),
    select: (target: Target | null) => select(target),
  };
}

/** Hover target of one kind, as an id (-1 when the hover is something else). */
export function useHoveredId(kind: Target["kind"]): number {
  return useHover((s) => (s.hover?.kind === kind ? s.hover.id : -1));
}

export function useSelectedId(kind: Target["kind"]): number {
  return useViewer((s) => (s.selection?.kind === kind ? s.selection.id : -1));
}

export { sameTarget };
