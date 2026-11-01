/**
 * Labeled horizontal bars: the form for ranked lists of named things (languages, files,
 * authors, commit types). Built from HTML rather than SVG so long names truncate with an
 * ellipsis instead of colliding, and so each row is a real button with focus, Enter and a
 * 28px hit target.
 *
 * Marks follow the spec: at most 24px thick (14px here), 4px rounded at the data end and
 * square at the baseline, value at the tip. Rows that point at something (a file, an author)
 * join linked selection: hover lights it in the galaxy, click selects it everywhere.
 */

import { useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useHover, useViewer, type Target } from "../../state/store";
import { PathText } from "./PathText";
import { ChartTooltip, type Tip, type TipRow } from "./Tooltip";

export interface BarItem {
  key: string | number;
  label: string;
  /** Paths and identifiers set in mono. */
  mono?: boolean;
  /** The label is a repository path: truncate from the left so the file name stays. */
  path?: boolean;
  value: number;
  valueText: string;
  color: string;
  target?: Target;
  /** Extra tooltip rows; the row already shows label and value. */
  tip?: TipRow[];
  /** Small trailing mark after the label (e.g. a bot icon). */
  badge?: ReactNode;
  /** Folded remainder ("12 others"): drawn, but not interactive. */
  rest?: boolean;
}

export function BarList({
  items,
  max,
  labelWidth = "38%",
  label,
}: {
  items: BarItem[];
  /** Domain maximum; defaults to the largest value, so the longest bar fills the track. */
  max?: number;
  labelWidth?: string;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const setHover = useHover((s) => s.setHover);
  const hover = useHover((s) => s.hover);
  const selection = useViewer((s) => s.selection);
  const select = useViewer((s) => s.select);
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  const width = containerRef.current?.clientWidth ?? 0;

  function show(item: BarItem, el: HTMLElement) {
    if (item.target) setHover(item.target);
    if (!item.tip || !containerRef.current) return setTip(null);
    const box = containerRef.current.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    const frac = Math.min(1, item.value / top);
    // Anchor just past the value at the bar's tip, where the eye already is. Mirrors the
    // row's grid: px-1 padding, a label column of `labelWidth`, a track reserving 64px.
    const lw = parseFloat(labelWidth) / 100;
    const inner = row.width - 8;
    const trackStart = row.left - box.left + 4 + inner * lw;
    const x = trackStart + (inner * (1 - lw) - 64) * frac + 48;
    setTip({ x, y: row.top - box.top, title: item.label, path: item.path, rows: [{ value: item.valueText }, ...item.tip] });
  }
  function hide() {
    setTip(null);
    setHover(null);
  }

  return (
    <div ref={containerRef} className="relative" role="list" aria-label={label} onPointerLeave={hide}>
      {items.map((item) => {
        const hot = !!item.target && hover?.kind === item.target.kind && hover.id === item.target.id;
        const selected = !!item.target && selection?.kind === item.target.kind && selection.id === item.target.id;
        const frac = Math.max(0, Math.min(1, item.value / top));
        const interactive = !item.rest && !!item.target;
        const content = (
          <>
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 pr-3 text-left",
                item.mono ? "font-mono text-[11px]" : "text-xs",
                item.rest ? "text-ink-3" : "text-ink",
                selected && "font-semibold",
              )}
            >
              {item.path ? <PathText path={item.label} /> : <span className="truncate">{item.label}</span>}
              {item.badge}
            </span>
            <span className="flex min-w-0 items-center">
              <span
                aria-hidden
                className={cn("h-3.5 shrink-0 rounded-r-[4px] transition-[filter] duration-150", hot && "brightness-110 saturate-150")}
                style={{
                  // Room for the value at the tip, so the longest bar never pushes it out.
                  width: `calc((100% - 64px) * ${frac})`,
                  minWidth: item.value > 0 ? 2 : 0,
                  background: item.color,
                  outline: hot || selected ? `1.5px solid var(--color-ink)` : undefined,
                  outlineOffset: 1,
                }}
              />
              <span className="figures ml-1.5 shrink-0 font-mono text-[11px] text-ink-2">{item.valueText}</span>
            </span>
          </>
        );
        const gridStyle = { gridTemplateColumns: `minmax(0, ${labelWidth}) minmax(0, 1fr)` };
        return interactive ? (
          <button
            key={item.key}
            type="button"
            role="listitem"
            className={cn(
              "grid h-7 w-full items-center rounded-sm px-1 text-left outline-offset-[-2px] hover:bg-wash",
              (hot || selected) && "bg-wash",
            )}
            style={gridStyle}
            onPointerEnter={(e) => show(item, e.currentTarget)}
            onFocus={(e) => show(item, e.currentTarget)}
            onBlur={hide}
            onClick={() => item.target && select(item.target)}
            aria-label={`${item.label}: ${item.valueText}`}
            aria-pressed={selected}
          >
            {content}
          </button>
        ) : (
          <div
            key={item.key}
            role="listitem"
            className="grid h-7 items-center px-1"
            style={gridStyle}
            onPointerEnter={(e) => (item.tip ? show(item, e.currentTarget) : setTip(null))}
          >
            {content}
          </div>
        );
      })}
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}
