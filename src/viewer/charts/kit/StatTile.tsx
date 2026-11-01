/**
 * A number that is the whole chart. Label in sentence case, the value in proportional
 * figures (tabular digits look loose at display sizes), then an optional delta or status and
 * an optional sparkline in the measure color.
 *
 * Status, when present, always arrives as icon + label: the color alone never says "risk".
 */

import { CircleAlert, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS } from "../../lib/colors";
import { cn } from "../../lib/utils";

export type StatusLevel = "warning" | "serious" | "critical";

const STATUS_ICON = { warning: TriangleAlert, serious: CircleAlert, critical: OctagonAlert } as const;

export function StatusMark({ level, label }: { level: StatusLevel; label: string }) {
  const Icon = STATUS_ICON[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
      <Icon aria-hidden className="size-4 shrink-0" style={{ color: STATUS[level] }} strokeWidth={2.25} />
      {label}
    </span>
  );
}

export function StatTile({
  label,
  value,
  unit,
  status,
  detail,
  spark,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  status?: { level: StatusLevel; label: string };
  detail?: ReactNode;
  spark?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.015em] text-ink [font-stretch:85%]">{value}</span>
        {unit && <span className="text-sm text-ink-2">{unit}</span>}
      </div>
      {status && <StatusMark level={status.level} label={status.label} />}
      {detail && <div className="text-xs leading-snug text-ink-2">{detail}</div>}
      {spark}
    </div>
  );
}
