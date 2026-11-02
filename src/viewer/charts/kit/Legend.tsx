/**
 * Legend: the dependable identity channel for two or more series. The key mirrors the mark
 * (a rect for bars and areas, a line for lines, a dot for points); the text stays in ink,
 * because a light series hue is illegible as text on the tray.
 */

import { cn } from "../../lib/utils";

export interface LegendItem {
  /** React key when labels can repeat (two authors with one name); defaults to the label. */
  id?: string;
  label: string;
  color: string;
  /** Optional figure shown after the label, e.g. a share. */
  value?: string;
  key?: "rect" | "line" | "dot" | "ring";
}

export function Swatch({ color, kind = "rect" }: { color: string; kind?: LegendItem["key"] }) {
  if (kind === "line") return <span aria-hidden className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: color }} />;
  if (kind === "dot") return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
  if (kind === "ring")
    return <span aria-hidden className="size-2.5 shrink-0 rounded-full border-[1.5px]" style={{ borderColor: color }} />;
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2", className)}>
      {items.map((item) => (
        <li key={item.id ?? item.label} className="flex min-w-0 items-center gap-1.5">
          <Swatch color={item.color} kind={item.key} />
          <span className="truncate">{item.label}</span>
          {item.value && <span className="figures font-mono text-[11px] text-ink-3">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
