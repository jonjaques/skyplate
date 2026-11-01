/**
 * The rail: the archival box. Its drawers are the project's directories.
 *
 * Top-level directories are listed largest first (the regions a reader should learn first), each
 * with its recursive file count, and open into their subdirectories. Opening a drawer focuses
 * it: the galaxy dims everything outside it and the record describes it. The open drawer is
 * drawn inverted to tray white, the one state the sketch gives the rail. Files that sit at the
 * root have no drawer of their own, so "Root files" lists them directly.
 */

import { ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DirRecord, Report } from "../../shared/schema";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { formatDate, formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import { dirAncestry } from "../model/indices";
import { useViewer } from "../state/store";
import { focusDrawer, show } from "./navigate";
import { useShell } from "./shell-state";

/** Subdirectories shown per level before "Show more"; a vendored tree can have thousands. */
const LEVEL_CAP = 30;

export function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const report = useViewer((s) => s.report);
  const focusDir = useViewer((s) => s.focusDir);
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  // A drawer focused from elsewhere (the galaxy, a finding, a link) opens its ancestors here.
  useEffect(() => {
    if (!report || focusDir === null) return;
    const chain = dirAncestry(report, focusDir).slice(1, -1);
    if (chain.length === 0) return;
    setOpen((prev) => (chain.every((d) => prev.has(d)) ? prev : new Set([...prev, ...chain])));
  }, [report, focusDir]);

  if (!report) return <RailFrame />;

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const root = report.dirs[0];
  const top = (root?.dirs ?? []).map((id) => report.dirs[id]!).sort(bySize);

  return (
    <div className="flex h-full min-h-0 flex-col bg-rail text-rail-ink">
      <RailHeader report={report} />
      <div className="flex items-center justify-between px-[22px] pt-4 pb-2">
        <h2 className="text-xs font-semibold text-rail-muted">
          Drawers · <span className="figures font-mono font-normal">{plural(report.totals.files, "file")}</span>
        </h2>
        {focusDir !== null && (
          <button
            type="button"
            onClick={() => {
              focusDrawer(null);
              onNavigate?.();
            }}
            className="text-xs text-rail-muted underline-offset-2 hover:text-rail-ink hover:underline"
          >
            Show all
          </button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <ul className="border-b border-rail-line" aria-label="Directories">
          {top.map((dir) => (
            <DrawerRow
              key={dir.id}
              report={report}
              dir={dir}
              depth={0}
              open={open}
              toggle={toggle}
              focusDir={focusDir}
              onNavigate={onNavigate}
            />
          ))}
          {root && root.files.length > 0 && <RootFiles report={report} files={root.files} onNavigate={onNavigate} />}
        </ul>
      </ScrollArea>
      <RailFooter report={report} />
    </div>
  );
}

function bySize(a: DirRecord, b: DirRecord): number {
  return b.totalFiles - a.totalFiles || a.name.localeCompare(b.name);
}

/** The frame while the report loads: the wordmark only, so the page has its shape at once. */
function RailFrame() {
  return (
    <div className="flex h-full flex-col bg-rail text-rail-ink">
      <div className="h-[84px] border-b border-rail-line px-[22px] pt-5">
        <Wordmark />
      </div>
    </div>
  );
}

function Wordmark() {
  return <div className="text-[28px] leading-none font-bold tracking-[-0.01em] [font-stretch:80%]">starchart</div>;
}

function RailHeader({ report }: { report: Report }) {
  const git = report.git;
  return (
    <div className="border-b border-rail-line px-[22px] pt-5 pb-4">
      <Wordmark />
      <div className="mt-2 truncate text-[13px] font-medium" title={report.project.root ?? report.project.name}>
        {report.project.name}
      </div>
      <div className="mt-0.5 flex min-w-0 font-mono text-xs text-rail-muted" title={git ? `${git.branch} @ ${git.head}` : undefined}>
        {git ? (
          <>
            {/* The branch truncates; the commit it was measured at must stay readable. */}
            <span className="truncate">{git.branch}</span>
            <span className="shrink-0 whitespace-pre"> @ {git.head.slice(0, 7)}</span>
          </>
        ) : (
          "No git history"
        )}
      </div>
    </div>
  );
}

function RailFooter({ report }: { report: Report }) {
  const setAboutOpen = useShell((s) => s.setAboutOpen);
  return (
    <div className="flex items-end justify-between gap-2 border-t border-rail-line px-[22px] py-4 text-xs text-rail-muted">
      <div className="min-w-0">
        {/* The 220px rail wraps these; a date or a figure split from its unit reads badly. */}
        <div>
          Report generated <span className="whitespace-nowrap">{formatDate(Date.parse(report.generatedAt) / 1000)}</span>
        </div>
        <div className="figures mt-0.5">
          <span className="whitespace-nowrap">{formatInt(report.totals.lines)} lines</span> ·{" "}
          <span className="whitespace-nowrap">{plural(report.totals.languages, "language")}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setAboutOpen(true)}
        aria-label="About this report"
        className="shrink-0 text-rail-muted hover:bg-rail-deep hover:text-rail-ink"
      >
        <Info />
      </Button>
    </div>
  );
}

function DrawerRow({
  report,
  dir,
  depth,
  open,
  toggle,
  focusDir,
  onNavigate,
}: {
  report: Report;
  dir: DirRecord;
  depth: number;
  open: Set<number>;
  toggle(id: number): void;
  focusDir: number | null;
  onNavigate?: () => void;
}) {
  const [limit, setLimit] = useState(LEVEL_CAP);
  const isOpen = open.has(dir.id);
  const active = focusDir === dir.id;
  const children = useMemo(
    () => (isOpen ? dir.dirs.map((id) => report.dirs[id]!).sort(bySize) : []),
    [isOpen, dir, report],
  );
  const hasChildren = dir.dirs.length > 0;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center border-t border-rail-line transition-colors duration-150",
          depth === 0 ? "h-[38px]" : "h-8",
          active ? "bg-tray text-ink" : "hover:bg-rail-deep",
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggle(dir.id)}
          aria-label={hasChildren ? `${isOpen ? "Close" : "Open"} subdirectories of ${dir.path}` : undefined}
          aria-expanded={hasChildren ? isOpen : undefined}
          tabIndex={hasChildren ? 0 : -1}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-xs",
            hasChildren ? (active ? "text-ink-3 hover:text-ink" : "text-rail-muted hover:text-rail-ink") : "invisible",
          )}
        >
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-damped", isOpen && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => {
            focusDrawer(active ? null : dir.id);
            if (!active && hasChildren && !isOpen) toggle(dir.id);
            onNavigate?.();
          }}
          aria-current={active || undefined}
          title={dir.path}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center justify-between gap-3 pr-[22px] text-left",
            depth === 0 ? "text-sm font-medium" : "text-[13px]",
          )}
        >
          <span className="truncate">{dir.name}</span>
          <span className={cn("figures shrink-0 font-mono text-xs", active ? "text-ink-3" : "text-rail-muted")}>
            {formatInt(dir.totalFiles)}
          </span>
        </button>
      </div>
      {isOpen && children.length > 0 && (
        <ul>
          {children.slice(0, limit).map((child) => (
            <DrawerRow
              key={child.id}
              report={report}
              dir={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              focusDir={focusDir}
              onNavigate={onNavigate}
            />
          ))}
          {children.length > limit && (
            <li className="border-t border-rail-line" style={{ paddingLeft: 40 + depth * 14 }}>
              <button
                type="button"
                className="h-8 text-xs text-rail-muted hover:text-rail-ink"
                onClick={() => setLimit((l) => l + LEVEL_CAP * 2)}
              >
                Show {formatInt(children.length - limit)} more
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function RootFiles({ report, files, onNavigate }: { report: Report; files: number[]; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(LEVEL_CAP);
  const selection = useViewer((s) => s.selection);
  const sorted = useMemo(() => [...files].sort((a, b) => report.files[a]!.name.localeCompare(report.files[b]!.name)), [files, report]);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-[38px] w-full items-center border-t border-rail-line pr-[22px] pl-2.5 text-left text-sm font-medium transition-colors duration-150 hover:bg-rail-deep"
      >
        <span className="grid size-6 shrink-0 place-items-center text-rail-muted">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-damped", open && "rotate-90")} />
        </span>
        <span className="flex-1">Root files</span>
        <span className="figures font-mono text-xs text-rail-muted">{formatInt(files.length)}</span>
      </button>
      {open && (
        <ul>
          {sorted.slice(0, limit).map((id) => {
            const f = report.files[id]!;
            const active = selection?.kind === "file" && selection.id === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    show({ kind: "file", id });
                    onNavigate?.();
                  }}
                  aria-current={active || undefined}
                  className={cn(
                    "flex h-8 w-full items-center border-t border-rail-line pr-[22px] pl-[46px] text-left font-mono text-xs transition-colors duration-150",
                    active ? "bg-tray text-ink" : "hover:bg-rail-deep",
                  )}
                >
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            );
          })}
          {sorted.length > limit && (
            <li className="border-t border-rail-line pl-[46px]">
              <button type="button" className="h-8 text-xs text-rail-muted hover:text-rail-ink" onClick={() => setLimit((l) => l + LEVEL_CAP * 2)}>
                Show {formatInt(sorted.length - limit)} more
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
