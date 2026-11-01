/**
 * A number that is the whole chart. Label in sentence case, the value in proportional
 * figures (tabular digits look loose at display sizes), then an optional delta or status and
 * an optional sparkline in the measure color.
 *
 * Status, when present, always arrives as icon + label: the color alone never says "risk".
 *
 * Critical is drawn with the shell's own mark (SeverityIcon: a solid ink octagon), not the
 * status red. Red is reserved for the holotype, and the truck-factor tile beside the findings
 * should rank "critical" exactly as the Findings tab and the record do. The other levels read
 * the theme tokens rather than a copy of their values in JS.
 */

import { ArrowDownRight, ArrowUpRight, CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { SeverityIcon } from "../../shell/parts";

export type StatusLevel = "warning" | "serious" | "critical";

const STATUS_ICON = { warning: TriangleAlert, serious: CircleAlert } as const;

export function StatusMark({ level, label }: { level: StatusLevel; label: string }) {
  const Icon = level === "critical" ? null : STATUS_ICON[level];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-ink">
      {Icon ? (
        <Icon aria-hidden className="size-4 shrink-0" style={{ color: `var(--color-${level})` }} strokeWidth={2.25} />
      ) : (
        <SeverityIcon severity="critical" />
      )}
      {label}
    </span>
  );
}

/**
 * A signed change against a named period ("+12% vs the previous 90 days"). The arrow carries
 * the direction and, through a status color, whether that direction is good (orange, not red,
 * when it is not: red is the holotype's); the figures stay in ink, because text never wears a
 * data color.
 */
export interface Delta {
  text: string;
  direction: "up" | "down";
  /** Whether this direction is an improvement (fewer hotspots down is good, more tests up). */
  good: boolean;
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  status,
  detail,
  spark,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: Delta;
  status?: { level: StatusLevel; label: string };
  detail?: ReactNode;
  spark?: ReactNode;
  className?: string;
}) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.015em] text-ink [font-stretch:85%]">{value}</span>
        {unit && <span className="text-sm text-ink-2">{unit}</span>}
        {delta && (
          <span className="inline-flex items-center gap-0.5 text-xs text-ink-2">
            <DeltaIcon aria-hidden className="size-3.5" style={{ color: delta.good ? "var(--color-good)" : "var(--color-serious)" }} />
            <span className="figures font-mono">{delta.text}</span>
          </span>
        )}
      </div>
      {status && <StatusMark level={status.level} label={status.label} />}
      {detail && <div className="text-xs leading-snug text-ink-2">{detail}</div>}
      {spark}
    </div>
  );
}
