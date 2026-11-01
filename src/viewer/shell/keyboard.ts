/**
 * Global shortcuts: ⌘K / Ctrl+K and "/" open the palette, 1-5 switch tabs.
 *
 * Bare keys only fire when focus is not in a text field, and never with a modifier held, so
 * typing a "3" into the explorer filter or pressing ⌘1 for a browser tab does what the reader
 * meant. The galaxy may bind its own keys on the plate; these stay out of its way by ignoring
 * events another handler already claimed (defaultPrevented).
 */

import { useEffect } from "react";
import { useViewer, type Tab } from "../state/store";

const TAB_KEYS: Record<string, Tab> = { "1": "galaxy", "2": "charts", "3": "explorer", "4": "source", "5": "findings" };

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useViewer.getState();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || s.paletteOpen) return;
      // A dialog or menu has focus; its own keys win.
      if (document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        s.setPaletteOpen(true);
        return;
      }
      const tab = TAB_KEYS[e.key];
      if (tab) s.setTab(tab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
