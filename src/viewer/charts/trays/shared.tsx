/**
 * Shared parts of the three unit trays under the galaxy.
 *
 * A tray fills one cell of the shell's bottom row (about 216px tall); the shell draws the
 * hairlines between cells and the ink rule above the row, the tray brings its own padding.
 * Nothing in a tray scrolls: content is sized to the cell, and anything that would not fit
 * is folded ("16 others") rather than clipped.
 *
 * Trays follow the same scope as the galaxy: the shared filters and the open drawer. A tray
 * that counted files the plate has dimmed would disagree with the picture above it.
 */

import { ArrowUpRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { useViewer } from "../../state/store";
import { scopeFiles } from "../data";
import { openChartsAt, type ChartsSection } from "../jump";

export function TrayShell({
  title,
  aside,
  label,
  children,
  className,
  open,
}: {
  title: string;
  aside?: ReactNode;
  /**
   * The full chart behind this tray, on the Charts tab: its axes, its table view, its
   * filters. A tray is sized to its cell and shows no table, so this is where its exact
   * figures live.
   */
  open?: { section: ChartsSection; label: string };
  /** Accessible name, including the scope ("Language composition in apps/game"). */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    // A container, so the tray adapts to its own width rather than the window's: between
    // 1024 and 1280px the shell narrows the rail and the record, and each tray drops to about
    // 200px, where the header aside and a two-column key would only show ellipses.
    <section aria-label={label ?? title} className={cn("@container flex h-full min-h-0 min-w-0 flex-col px-[18px] pt-3.5 pb-3", className)}>
      <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
        {/* With somewhere to open, the title is the link: a 12px arrow beside it costs a third
            of a separate icon button, which pushed the aside into an ellipsis at 288px. */}
        <h3 className="shrink-0 text-sm font-semibold whitespace-nowrap text-ink">
          {open ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="group inline-flex items-baseline gap-1 rounded-sm underline-offset-[3px] hover:underline"
                  onClick={() => openChartsAt(open.section)}
                  aria-label={`${title}. ${open.label}`}
                >
                  {title}
                  <ArrowUpRight aria-hidden className="size-3 shrink-0 self-center text-ink-3 group-hover:text-ink" strokeWidth={2.25} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{open.label}</TooltipContent>
            </Tooltip>
          ) : (
            title
          )}
        </h3>
        {aside && <div className="figures hidden min-w-0 truncate font-mono text-xs text-ink-3 @min-[250px]:block">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A tray's big figure: proportional digits in the label face, a short caption beside it.
 * `scope` ("in packages/core") is appended only when the tray is wide enough; the plate title
 * above already names the open drawer, so a narrow tray can drop it without losing the fact.
 * The caption wraps under the figure rather than truncating, so the period never turns into
 * an ellipsis.
 */
export function Headline({ value, caption, scope }: { value: string; caption?: ReactNode; scope?: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="shrink-0 text-[30px] leading-none font-semibold tracking-[-0.015em] text-ink [font-stretch:85%]">{value}</span>
      {caption && (
        <span className="min-w-0 text-xs text-ink-2">
          {caption}
          {scope && <span className="hidden @min-[300px]:inline"> {scope}</span>}
        </span>
      )}
    </div>
  );
}

/** A direction sentence for a tray with nothing to draw. */
export function TrayEmpty({ children }: { children: ReactNode }) {
  return <p className="max-w-[40ch] text-xs leading-relaxed text-ink-2">{children}</p>;
}

/** The scope every tray shares: filters plus the open drawer. */
export function useTrayScope() {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const filters = useViewer((s) => s.filters);
  const focusDir = useViewer((s) => s.focusDir);
  const scope = useMemo(
    () => (report && model ? scopeFiles(report, model, filters, focusDir) : null),
    [report, model, filters, focusDir],
  );
  const dirPath = report && scope?.dir != null ? report.dirs[scope.dir]?.path : undefined;
  return { report, model, scope, dirPath };
}
