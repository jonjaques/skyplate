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

import { useMemo, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useViewer } from "../../state/store";
import { scopeFiles } from "../data";

export function TrayShell({
  title,
  aside,
  label,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  /** Accessible name, including the scope ("Language composition in apps/game"). */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label ?? title} className={cn("flex h-full min-h-0 min-w-0 flex-col px-[18px] pt-3.5 pb-3", className)}>
      <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="shrink-0 text-sm font-semibold text-ink">{title}</h3>
        {aside && <div className="figures min-w-0 truncate font-mono text-xs text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A tray's big figure: proportional digits in the label face, a short caption beside it. */
export function Headline({ value, caption }: { value: string; caption?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-[30px] leading-none font-semibold tracking-[-0.015em] text-ink [font-stretch:85%]">{value}</span>
      {caption && <span className="min-w-0 truncate text-xs text-ink-2">{caption}</span>}
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
