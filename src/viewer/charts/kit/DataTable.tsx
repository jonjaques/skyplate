/**
 * Sortable table: the accessible twin of every chart (Figure's table view) and the form for
 * data that is a list to scan rather than a shape to see (largest files, dependencies,
 * co-change pairs).
 *
 * Long tables page with "Show more" instead of scrolling inside the tray: a nested scroll
 * region inside a scrolling dashboard traps the wheel and hides how much is there.
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatInt } from "../../lib/format";
import { cn } from "../../lib/utils";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Numbers and paths set in mono with tabular figures, so columns align. */
  mono?: boolean;
  /** Sort key; omit to make the column unsortable. */
  sort?: (row: T) => number | string;
  render: (row: T) => ReactNode;
  /** Width hint, e.g. "40%". Paths get the room; figures stay narrow. */
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  caption?: string;
  onRowClick?: (row: T) => void;
  onRowHover?: (row: T | null) => void;
  isSelected?: (row: T) => boolean;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  pageSize = 12,
  caption,
  onRowClick,
  onRowHover,
  isSelected,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [limit, setLimit] = useState(pageSize);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
      return String(va).localeCompare(String(vb)) * sign;
    });
  }, [rows, columns, sort]);

  const visible = sorted.slice(0, limit);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) {
        // Numbers usually want "largest first"; text wants A to Z.
        const col = columns.find((c) => c.key === key);
        const sample = rows[0] && col?.sort ? col.sort(rows[0]) : 0;
        return { key, dir: typeof sample === "number" ? "desc" : "asc" };
      }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Table className="table-fixed text-xs">
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow className="border-rule hover:bg-transparent">
            {columns.map((col) => {
              const active = sort?.key === col.key;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <TableHead
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("h-8 px-2 text-xs font-semibold text-ink-2", col.align === "right" && "text-right")}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "-mx-1 inline-flex h-6 items-center gap-1 rounded-sm px-1 hover:bg-wash hover:text-ink",
                        col.align === "right" && "flex-row-reverse",
                        active && "text-ink",
                      )}
                    >
                      {col.label}
                      <Icon aria-hidden className={cn("size-3", !active && "opacity-40")} />
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody onPointerLeave={onRowHover ? () => onRowHover(null) : undefined}>
          {visible.map((row) => {
            const selected = isSelected?.(row) ?? false;
            return (
              <TableRow
                key={rowKey(row)}
                data-state={selected ? "selected" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                onPointerEnter={onRowHover ? () => onRowHover(row) : undefined}
                onFocus={onRowHover ? () => onRowHover(row) : undefined}
                className={cn(
                  "border-rule hover:bg-wash data-[state=selected]:bg-wash",
                  onRowClick && "cursor-pointer focus-visible:-outline-offset-2",
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      "h-7 truncate px-2 py-1 text-ink",
                      col.align === "right" && "text-right",
                      col.mono && "figures font-mono text-[11px]",
                      selected && "font-semibold",
                    )}
                  >
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sorted.length > limit && (
        <div className="mt-2 flex items-center gap-3">
          <Button variant="ghost" size="xs" onClick={() => setLimit((l) => l + pageSize * 2)}>
            Show {formatInt(Math.min(pageSize * 2, sorted.length - limit))} more
          </Button>
          <span className="text-xs text-ink-3">
            {formatInt(visible.length)} of {formatInt(sorted.length)}
          </span>
        </div>
      )}
    </div>
  );
}
