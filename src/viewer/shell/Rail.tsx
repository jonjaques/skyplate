/**
 * The rail: the plate's sleeve. From the top: the Skyplate lockup, the project and the commit
 * it was measured at, find, the five views, the drawers (the project's directories), and a foot
 * with when the report was made, the theme and About.
 *
 * Top-level directories are listed largest first (the regions a reader should learn first), each
 * with its recursive file count, and open into their subdirectories. Opening a drawer focuses
 * it: the plate dims everything outside it and the record describes it. Files that sit at the
 * root have no drawer of their own, so "Root files" lists them directly.
 *
 * Below 1024px the rail is a sheet behind the top bar's drawers button, and the top bar carries
 * the views and find, so the sheet renders the rail with `nav={false}`: two tab lists for one
 * set of tabs would give every view two triggers and duplicate their ids.
 */

import { ChevronRight, GitBranch, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DirRecord, Report } from "../../shared/schema";
import { Lockup } from "../brand/Brand";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { TabsList } from "../components/ui/tabs";
import { formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import { dirAncestry } from "../model/indices";
import { useViewer } from "../state/store";
import { generatedParts } from "./labels";
import { FindButton, RailViewTrigger, TAB_ORDER, ThemeMenu } from "./nav";
import { focusDrawer, show } from "./navigate";
import { useShell } from "./shell-state";

/** Subdirectories shown per level before "Show more"; a vendored tree can have thousands. */
const LEVEL_CAP = 30;

export function Rail({
  onNavigate,
  nav = true,
  ready = true,
  loading = false,
}: {
  onNavigate?: () => void;
  nav?: boolean;
  ready?: boolean;
  /** While the report loads, the project line is a placeholder; a missing report gets none. */
  loading?: boolean;
}) {
  const report = useViewer((s) => s.report);
  const focusDir = useViewer((s) => s.focusDir);
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  // A drawer focused from elsewhere (the plate, a finding, a link) opens its ancestors here.
  useEffect(() => {
    if (!report || focusDir === null) return;
    const chain = dirAncestry(report, focusDir).slice(1, -1);
    if (chain.length === 0) return;
    setOpen((prev) => (chain.every((d) => prev.has(d)) ? prev : new Set([...prev, ...chain])));
  }, [report, focusDir]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const root = report?.dirs[0];
  const top = report ? (root?.dirs ?? []).map((id) => report.dirs[id]!).sort(bySize) : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-rail text-ink">
      <div className="px-4 pt-[18px] pb-3">
        <Lockup height={18} />
      </div>
      {report ? <ProjectLine report={report} /> : loading ? <div className="mx-4 mb-3 h-[38px] rounded-md bg-wash motion-safe:animate-pulse" /> : <div className="mb-3" />}
      {nav && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <FindButton field disabled={!ready} />
          {/* The views. A vertical tab list (the Tabs root is vertical on wide screens), so the
              arrow keys move up and down it and 1-5 still jump straight to one. */}
          <TabsList aria-label="Views" className="h-auto w-full flex-col items-stretch gap-px rounded-none bg-transparent p-0">
            {TAB_ORDER.map((t) => (
              <RailViewTrigger key={t.id} id={t.id} ready={ready} />
            ))}
          </TabsList>
        </div>
      )}

      {report ? (
        <>
          <div className="flex items-baseline justify-between border-t border-rule px-4 pt-3.5 pb-1.5">
            <h2 className="text-xs font-semibold text-ink-2">
              Drawers <span className="figures ml-1 font-mono text-[11px] font-normal text-ink-3">{formatInt(report.totals.files)}</span>
            </h2>
            {focusDir !== null && (
              <button
                type="button"
                onClick={() => {
                  focusDrawer(null);
                  onNavigate?.();
                }}
                className="rounded-xs text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Show all
              </button>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
            <ul className="flex flex-col gap-px px-2 pb-3" aria-label="Directories">
              {top.map((dir) => (
                <DrawerRow key={dir.id} report={report} dir={dir} depth={0} open={open} toggle={toggle} focusDir={focusDir} onNavigate={onNavigate} />
              ))}
              {root && root.files.length > 0 && <RootFiles report={report} files={root.files} onNavigate={onNavigate} />}
            </ul>
          </ScrollArea>
          <RailFooter report={report} />
        </>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}

function bySize(a: DirRecord, b: DirRecord): number {
  return b.totalFiles - a.totalFiles || a.name.localeCompare(b.name);
}

/** The project's name, and the branch and commit it was measured at. */
function ProjectLine({ report }: { report: Report }) {
  const git = report.git;
  return (
    <div className="mb-3 px-4">
      <div className="truncate text-[15px] leading-tight font-semibold [font-stretch:85%]" title={report.project.root ?? report.project.name}>
        {report.project.name}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] text-ink-3" title={git ? `${git.branch} @ ${git.head}` : undefined}>
        {git ? (
          <>
            <GitBranch aria-hidden className="size-3 shrink-0" />
            {/* The branch truncates; the commit it was measured at must stay readable. */}
            <span className="truncate">{git.branch}</span>
            <span className="shrink-0">{git.head.slice(0, 7)}</span>
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
  const generated = generatedParts(report.generatedAt);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-rule py-2.5 pr-2 pl-4 text-[11.5px] leading-snug text-ink-3">
      <div className="min-w-0">
        {/* The 220px rail wraps these; a date or a figure split from its unit reads badly. */}
        <div title={report.generatedAt}>
          <span className="whitespace-nowrap">{generated.time ? `${generated.date},` : generated.date}</span> <span className="whitespace-nowrap">{generated.time}</span>
        </div>
        <div className="figures">
          <span className="whitespace-nowrap">{formatInt(report.totals.lines)} lines</span> ·{" "}
          <span className="whitespace-nowrap">{plural(report.totals.languages, "language")}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <ThemeMenu className="text-ink-3 hover:text-ink" />
        <Button variant="ghost" size="icon-sm" onClick={() => setAboutOpen(true)} aria-label="About this report" title="About this report" className="text-ink-3 hover:text-ink">
          <Info />
        </Button>
      </div>
    </div>
  );
}

/** Row classes shared by drawers and root files: a pill that fills on hover, paper when open. */
function rowClass(active: boolean): string {
  return cn(
    "group flex items-center rounded-md border transition-colors duration-150",
    active ? "border-rule bg-paper text-ink dark:bg-wash" : "border-transparent text-ink-2 hover:bg-wash hover:text-ink",
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
  const children = useMemo(() => (isOpen ? dir.dirs.map((id) => report.dirs[id]!).sort(bySize) : []), [isOpen, dir, report]);
  const hasChildren = dir.dirs.length > 0;

  return (
    <li>
      <div className={cn(rowClass(active), depth === 0 ? "h-[30px]" : "h-7")} style={{ paddingLeft: 2 + depth * 12 }}>
        <button
          type="button"
          onClick={() => hasChildren && toggle(dir.id)}
          aria-label={hasChildren ? `${isOpen ? "Close" : "Open"} subdirectories of ${dir.path}` : undefined}
          aria-expanded={hasChildren ? isOpen : undefined}
          tabIndex={hasChildren ? 0 : -1}
          className={cn("grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink", !hasChildren && "invisible")}
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
          className={cn("flex h-full min-w-0 flex-1 items-center justify-between gap-3 pr-2.5 text-left", depth === 0 ? "text-[13.5px] font-medium" : "text-[13px]")}
        >
          <span className="truncate">{dir.name}</span>
          <span className="figures shrink-0 font-mono text-[11px] text-ink-3">{formatInt(dir.totalFiles)}</span>
        </button>
      </div>
      {isOpen && children.length > 0 && (
        <ul className="mt-px flex flex-col gap-px">
          {children.slice(0, limit).map((child) => (
            <DrawerRow key={child.id} report={report} dir={child} depth={depth + 1} open={open} toggle={toggle} focusDir={focusDir} onNavigate={onNavigate} />
          ))}
          {children.length > limit && (
            <li style={{ paddingLeft: 32 + depth * 12 }}>
              <button type="button" className="h-7 text-xs text-ink-3 hover:text-ink" onClick={() => setLimit((l) => l + LEVEL_CAP * 2)}>
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
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn(rowClass(false), "h-[30px] w-full pr-2.5 pl-0.5 text-left text-[13.5px] font-medium")}>
        <span className="grid size-6 shrink-0 place-items-center text-ink-3">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-damped", open && "rotate-90")} />
        </span>
        <span className="flex-1">Root files</span>
        <span className="figures font-mono text-[11px] text-ink-3">{formatInt(files.length)}</span>
      </button>
      {open && (
        <ul className="mt-px flex flex-col gap-px">
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
                  className={cn(rowClass(active), "h-7 w-full pr-2.5 pl-8 text-left font-mono text-xs")}
                >
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            );
          })}
          {sorted.length > limit && (
            <li className="pl-8">
              <button type="button" className="h-7 text-xs text-ink-3 hover:text-ink" onClick={() => setLimit((l) => l + LEVEL_CAP * 2)}>
                Show {formatInt(sorted.length - limit)} more
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
