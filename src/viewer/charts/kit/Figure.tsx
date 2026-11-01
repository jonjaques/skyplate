/**
 * A unit tray holding one chart: a plain heading, an optional one-line subtitle, the legend,
 * the plot, and a table-view toggle that swaps the plot for an accessible table of the same
 * values.
 *
 * Trays have no card chrome. The section grid rules them apart with hairlines; the figure
 * itself is just padding on the tray ground.
 *
 * The plot gets its width from the tray and its height from the chart, which includes its own
 * axis band. Nothing inside a tray scrolls, so an axis label can never push a nested
 * scrollbar into the dashboard.
 */

import { ChartColumn, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Toggle } from "../../components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { formatInt } from "../../lib/format";
import { cn } from "../../lib/utils";
import { DataTable, type Column } from "./DataTable";
import { useMeasure } from "./useMeasure";

export type Cell = number | string | { text: string; sort: number | string };

export interface TableView {
  columns: { label: string; align?: "left" | "right"; mono?: boolean; width?: string }[];
  rows: Cell[][];
}

export interface FigureProps {
  title: string;
  subtitle?: ReactNode;
  /** Small controls beside the heading (a measure toggle, a breadcrumb). */
  actions?: ReactNode;
  legend?: ReactNode;
  /** Built lazily: only computed when the reader opens the table view. */
  table?: () => TableView;
  /** A sentence saying why there is nothing to draw and what would produce it. */
  empty?: string | null;
  /** Plot height in pixels, used to hold the space before the tray is measured. */
  height: number;
  className?: string;
  /** Dims the plot while its data is being replaced, keeping the previous frame. */
  stale?: boolean;
  children: (width: number) => ReactNode;
}

export function Figure({
  title,
  subtitle,
  actions,
  legend,
  table,
  empty,
  height,
  className,
  stale,
  children,
}: FigureProps) {
  const [tableView, setTableView] = useState(false);
  const [ref, width] = useMeasure<HTMLDivElement>();
  const showTable = tableView && !!table && !empty;

  return (
    <figure className={cn("flex min-w-0 flex-col bg-tray px-5 pt-4 pb-5", className)}>
      <figcaption className="flex min-h-7 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-tight font-semibold text-balance text-ink">{title}</h3>
          {subtitle && <p className="mt-1 text-xs leading-snug text-ink-3">{subtitle}</p>}
        </div>
        {!showTable && actions}
        {table && !empty && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={tableView}
                onPressedChange={setTableView}
                aria-label={tableView ? "Show the chart" : "Show as a table"}
                className="size-7 min-w-7 shrink-0 text-ink-3 data-[state=on]:bg-wash data-[state=on]:text-ink"
              >
                {tableView ? <ChartColumn /> : <Table2 />}
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="left">{tableView ? "Show the chart" : "Show as a table"}</TooltipContent>
          </Tooltip>
        )}
      </figcaption>
      {legend && !showTable && !empty && <div className="mt-3">{legend}</div>}
      <div
        ref={ref}
        className={cn("relative mt-3 min-w-0 transition-opacity duration-200", stale && "opacity-50")}
      >
        {empty ? (
          <p className="max-w-[52ch] py-2 text-sm leading-relaxed text-ink-2" style={{ minHeight: Math.min(height, 120) }}>
            {empty}
          </p>
        ) : showTable ? (
          <TableViewBody view={table!()} label={title} />
        ) : width > 0 ? (
          children(width)
        ) : (
          <div style={{ height }} />
        )}
      </div>
    </figure>
  );
}

function cellText(c: Cell): string {
  if (typeof c === "number") return formatInt(c);
  if (typeof c === "string") return c;
  return c.text;
}
function cellSort(c: Cell): number | string {
  if (typeof c === "number" || typeof c === "string") return c;
  return c.sort;
}

function TableViewBody({ view, label }: { view: TableView; label: string }) {
  const columns: Column<{ cells: Cell[]; i: number }>[] = view.columns.map((col, i) => ({
    key: String(i),
    label: col.label,
    align: col.align,
    mono: col.mono,
    width: col.width,
    sort: (row) => cellSort(row.cells[i]!),
    render: (row) => cellText(row.cells[i]!),
  }));
  const rows = view.rows.map((cells, i) => ({ cells, i }));
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.i} pageSize={15} caption={label} />;
}
