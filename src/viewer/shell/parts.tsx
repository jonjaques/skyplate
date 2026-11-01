/**
 * Small pieces the shell's panels share: swatches, the hairline metric grid, ruled rows,
 * severity marks. Everything here sits on tray or paper, so it is ruled, never boxed.
 */

import { CircleAlert, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Severity } from "../../shared/schema";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { categoryGroupColor, seriesColor } from "../lib/colors";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useViewer } from "../state/store";
import { CATEGORY_GROUP } from "../../shared/schema";
import type { Category } from "../../shared/schema";
import { SEVERITY_LABEL } from "./labels";
import { useSurface } from "./theme";

/** A color chip. Identity lives here, never in the text beside it. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function useLanguageColor(languageId: string): string {
  const surface = useSurface();
  const slot = useViewer((s) => s.model?.languageSlot.get(languageId) ?? -1);
  return seriesColor(slot, surface);
}

export function LanguageSwatch({ languageId, className }: { languageId: string; className?: string }) {
  return <Swatch color={useLanguageColor(languageId)} className={className} />;
}

export function CategorySwatch({ category, className }: { category: Category; className?: string }) {
  const surface = useSurface();
  return <Swatch color={categoryGroupColor(CATEGORY_GROUP[category], surface)} className={className} />;
}

export interface Metric {
  label: string;
  value: ReactNode;
  /** Plain-language note under the figure, e.g. what a ratio is of. */
  note?: string;
}

/** Two-column hairline grid of figures, the record's measurement block. */
export function MetricGrid({ items, className }: { items: Metric[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 border-t border-rule", className)}>
      {items.map((m) => (
        <div
          key={m.label}
          className="min-w-0 border-b border-rule py-2 odd:border-r odd:pr-3 even:pl-3"
        >
          <dt className="text-xs text-ink-3">{m.label}</dt>
          <dd className="figures truncate font-mono text-lg leading-tight font-medium text-ink">{m.value}</dd>
          {m.note && <dd className="truncate text-[11px] text-ink-3">{m.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A titled run of rows inside the record. The title is the heading; no label above it. */
export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">
          {title}
          {count !== undefined && (
            <span className="figures ml-1.5 font-mono text-xs font-normal text-ink-3">{formatInt(count)}</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One ruled, clickable row: a label on the left, a figure on the right. */
export function RowButton({
  onClick,
  onDoubleClick,
  children,
  aside,
  title,
  active,
  className,
}: {
  onClick?: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
  aside?: ReactNode;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-current={active || undefined}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 border-b border-rule py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-wash focus-visible:bg-wash",
        active && "bg-wash",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {aside !== undefined && <span className="figures shrink-0 font-mono text-xs text-ink-3">{aside}</span>}
    </button>
  );
}

/** "Show 12 more" under a capped list. */
export function MoreButton({ hidden, onClick, noun = "more" }: { hidden: number; onClick: () => void; noun?: string }) {
  if (hidden <= 0) return null;
  return (
    <Button variant="ghost" size="xs" className="mt-1 h-7 px-0 text-ink-3 hover:bg-transparent hover:text-ink" onClick={onClick}>
      Show {formatInt(hidden)} {noun}
    </Button>
  );
}

const SEVERITY_ICON: Record<Exclude<Severity, "critical">, LucideIcon> = {
  warning: TriangleAlert,
  notice: CircleAlert,
  info: Info,
};

/**
 * The ladder climbs by weight at the top and hue below it: a solid ink octagon, then orange,
 * amber and gray outlines. The report's "warning" severity takes the orange "serious" step so
 * "notice" can keep amber and the ladder still reads in order.
 *
 * Critical is deliberately not red. The world reserves red for holotypes and nothing else, and
 * the status red (#d03b3b) sat beside holotype red (#c23a2b) on the Findings badge, the
 * "Critical" heading and the record's "Worth a look first" list, so a reader learning "red
 * means most depended on" met it on a truck-factor warning. A filled mark is the heaviest thing
 * in a ruled, hairline world, which is the rank critical needs, and it keeps its shape for
 * readers who do not see hue at all.
 */
const SEVERITY_COLOR: Record<Exclude<Severity, "critical">, string> = {
  warning: "text-serious",
  notice: "text-warning",
  info: "text-ink-3",
};

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  if (severity === "critical") return <CriticalIcon className={cn("size-4 shrink-0", className)} />;
  const Icon = SEVERITY_ICON[severity];
  return <Icon aria-hidden className={cn("size-4 shrink-0", SEVERITY_COLOR[severity], className)} />;
}

/**
 * lucide's octagon-alert geometry, filled with ink and the mark knocked out in paper, so it
 * matches the stroke icons beside it in size and corner and inverts cleanly in the dark theme.
 */
function CriticalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("text-ink", className)} strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2}
      />
      <path d="M12 8v4M12 16h.01" fill="none" stroke="var(--color-paper)" strokeWidth={2.25} />
    </svg>
  );
}

/** Icon plus label: status color is never the only carrier of meaning. */
export function SeverityMark({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <SeverityIcon severity={severity} />
      <span>{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}

/** Quiet single line used for "nothing here" inside a section. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("py-1.5 text-[13px] text-ink-3", className)}>{children}</p>;
}

/** A small hairline tag (ref kinds, flags): shadcn's outline Badge cut to label stock. */
export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        "h-[18px] rounded-xs border-rule-strong px-1 py-0 font-mono text-[10.5px] leading-none font-normal text-ink-2",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

/**
 * A path that truncates its directories, never its file name or line: "apps/game/sr…/Engine.ts:59".
 * End-truncating a path hides exactly the part a reader is looking for.
 */
export function PathText({
  path,
  line,
  className,
  dirClass,
}: {
  path: string;
  line?: number;
  className?: string;
  /** Extra classes for the directory part, e.g. a quieter ink in tables. */
  dirClass?: string;
}) {
  const slash = path.lastIndexOf("/");
  const tail = `${path.slice(slash + 1)}${line !== undefined ? `:${line}` : ""}`;
  return (
    <span className={cn("flex min-w-0 font-mono", className)} title={line !== undefined ? `${path}:${line}` : path}>
      {/* min-w-[2ch]: squeezed below the width of its ellipsis, the directory part showed a
          bare clipped letter glued to the file name ("pharness.ts" in a 180px tray). */}
      {slash >= 0 && <span className={cn("min-w-[2ch] truncate", dirClass)}>{path.slice(0, slash + 1)}</span>}
      <span className="max-w-full shrink-0 truncate">{tail}</span>
    </span>
  );
}
