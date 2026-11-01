/**
 * Breakpoints the shell restructures at. Width classes alone cannot move the rail into a sheet
 * or the record under the work area (different components mount), so the layout reads these.
 *
 *   wide    ≥ 1280  the sketch: 260px rail, 340px record
 *   medium  1024+   narrower rail and record
 *   narrow  768+    rail becomes a sheet, the record moves under the work area
 *   compact < 768   one column
 */

import { useSyncExternalStore } from "react";

export type Breakpoint = "wide" | "medium" | "narrow" | "compact";

const QUERIES: [Breakpoint, string][] = [
  ["wide", "(min-width: 1280px)"],
  ["medium", "(min-width: 1024px)"],
  ["narrow", "(min-width: 768px)"],
];

function current(): Breakpoint {
  for (const [name, q] of QUERIES) if (matchMedia(q).matches) return name;
  return "compact";
}

function subscribe(onChange: () => void): () => void {
  const lists = QUERIES.map(([, q]) => matchMedia(q));
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => "wide");
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const l = matchMedia(query);
      l.addEventListener("change", cb);
      return () => l.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
