/**
 * A Charts-tab section: a plain heading over a grid of unit trays ruled by hairlines.
 *
 * The rules are the grid's 1px gaps showing the rule color through, so every tray edge is
 * exactly one device pixel wherever it falls and no tray draws a border of its own. That
 * only works when each row is full, so every section lays out spans that sum to 12 and a
 * chart with nothing to draw keeps its cell and says why.
 *
 * Spans collapse to one column below a ~900px container (a container query, not a viewport
 * one: the tab sits beside a 260px rail and its width is not the window's).
 */

import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`charts-${id}`} className="pt-8 first-of-type:pt-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 pb-3">
        <h2 id={`charts-${id}`} className="text-xl font-semibold tracking-[-0.01em] text-ink [font-stretch:82%]">
          {title}
        </h2>
        {note && <p className="text-xs text-ink-3">{note}</p>}
      </div>
      <div className="grid grid-cols-12 gap-px border-y border-rule bg-rule">{children}</div>
    </section>
  );
}

/** Literal class strings so Tailwind can see them; a span is a share of a 12-column row. */
export const SPAN = {
  4: "col-span-12 @4xl:col-span-4",
  5: "col-span-12 @4xl:col-span-5",
  6: "col-span-12 @4xl:col-span-6",
  7: "col-span-12 @4xl:col-span-7",
  8: "col-span-12 @4xl:col-span-8",
  12: "col-span-12",
} as const;

export function span(n: keyof typeof SPAN, extra?: string) {
  return cn(SPAN[n], extra);
}
