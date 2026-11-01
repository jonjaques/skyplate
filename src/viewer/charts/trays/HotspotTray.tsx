/**
 * Hotspots tray: the top hotspot as an alert, then the next four with their figures.
 *
 * A hotspot is churn × complexity (FileRecord.hotspot, Tornhill), so each row shows exactly
 * those two inputs, commits then complexity, keyed once in the tray header. The alert takes a
 * status color only when the analyzer's own bar for "severe" is met (50+ commits and
 * complexity 100+, as in core/findings.ts); otherwise it is an ordinary first row. It never
 * wears red: red is the holotype's.
 *
 * Without history there are no hotspots, and the tray says so and lists the most complex
 * files instead, which is the half of the measure it can still show.
 *
 * Rows join linked selection: hover lights the file in the galaxy, click selects it.
 */

import { Flame } from "lucide-react";
import { useMemo } from "react";
import type { FileRecord } from "../../../shared/schema";
import { STATUS } from "../../lib/colors";
import { baseName, formatCompact, formatInt, plural } from "../../lib/format";
import { cn } from "../../lib/utils";
import { useHover, useViewer } from "../../state/store";
import { hasHistory, MIN_HISTORY } from "../data";
import { PathText } from "../kit/PathText";
import { StatusMark } from "../kit/StatTile";
import { TrayEmpty, TrayShell, useTrayScope } from "./shared";

export function HotspotTray() {
  const { report, scope, dirPath } = useTrayScope();
  const hoverId = useHover((s) => (s.hover?.kind === "file" ? s.hover.id : -1));
  const setHover = useHover((s) => s.setHover);
  const selectedId = useViewer((s) => (s.selection?.kind === "file" ? s.selection.id : -1));
  const select = useViewer((s) => s.select);

  const history = !!report && hasHistory(report) && (report.git?.analyzedCommits ?? 0) >= MIN_HISTORY;
  const ranked = useMemo(() => {
    if (!report || !scope) return [];
    const files = scope.ids.map((id) => report.files[id]!);
    return history
      ? files.filter((f) => f.hotspot > 0).sort((a, b) => b.hotspot - a.hotspot || a.id - b.id).slice(0, 5)
      : files.filter((f) => f.complexity > 0).sort((a, b) => b.complexity - a.complexity || a.id - b.id).slice(0, 5);
  }, [report, scope, history]);

  if (!report) return <TrayShell title="Hotspots" />;
  const label = dirPath ? `Hotspots in ${dirPath}` : "Hotspots";

  if (ranked.length === 0) {
    return (
      <TrayShell title="Hotspots" label={label}>
        <TrayEmpty>
          {history
            ? "No hotspots in view: nothing here is both changed and complex. Widen the filters or close the drawer."
            : "No hotspots: they need commit history (churn × complexity), and nothing in view has measurable complexity either."}
        </TrayEmpty>
      </TrayShell>
    );
  }

  const row = (f: FileRecord) => ({
    onPointerEnter: () => setHover({ kind: "file", id: f.id }),
    onFocus: () => setHover({ kind: "file", id: f.id }),
    onPointerLeave: () => setHover(null),
    onBlur: () => setHover(null),
    onClick: () => select({ kind: "file", id: f.id }),
    "aria-pressed": selectedId === f.id,
  });

  if (!history) {
    return (
      <TrayShell title="Most complex" label={dirPath ? `Most complex files in ${dirPath}` : "Most complex files"} aside="complexity">
        <p className="mb-1.5 text-xs leading-snug text-ink-2">Hotspots need commit history; these are the files with the most decision points.</p>
        <ul>
          {ranked.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                {...row(f)}
                className={cn(
                  "flex h-6 w-full items-center justify-between gap-3 border-b border-rule px-1 text-left outline-offset-[-2px] hover:bg-wash",
                  (hoverId === f.id || selectedId === f.id) && "bg-wash",
                )}
              >
                <PathText path={f.path} className={cn("font-mono text-[11px] text-ink", selectedId === f.id && "font-semibold")} />
                <span className="figures shrink-0 font-mono text-[11px] text-ink-2">{formatInt(f.complexity)}</span>
              </button>
            </li>
          ))}
        </ul>
      </TrayShell>
    );
  }

  const [top, ...rest] = ranked as [FileRecord, ...FileRecord[]];
  const severe = (top.git?.commits ?? 0) >= 50 && top.complexity >= 100;
  const facts = `${plural(top.git?.commits ?? 0, "commit")} · complexity ${formatInt(top.complexity)}`;

  return (
    <TrayShell title="Hotspots" label={label} aside="commits · complexity">
      <button
        type="button"
        {...row(top)}
        aria-label={`Top hotspot: ${top.path}, ${facts}`}
        className={cn(
          "mb-1 flex w-full min-w-0 flex-col gap-0.5 rounded-[3px] border px-2.5 py-1.5 text-left outline-offset-[-2px]",
          !severe && "border-rule hover:bg-wash",
          (hoverId === top.id || selectedId === top.id) && "brightness-[0.97]",
        )}
        style={
          severe
            ? {
                background: `color-mix(in oklab, ${STATUS.warning} 13%, var(--color-tray))`,
                borderColor: `color-mix(in oklab, ${STATUS.warning} 55%, var(--color-tray))`,
              }
            : undefined
        }
      >
        {/* In a narrow tray the file name takes its own line instead of shrinking to "harn…". */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          {severe ? (
            <StatusMark level="warning" label="Top hotspot" />
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-ink">
              <Flame aria-hidden className="size-4 text-ink-2" />
              Top hotspot
            </span>
          )}
          <span
            className={cn("min-w-0 truncate font-mono text-[11px] text-ink @max-[249px]:basis-full", selectedId === top.id && "font-semibold")}
            title={top.path}
          >
            {baseName(top.path)}
          </span>
        </span>
        <span className="text-xs text-ink-2">{facts}</span>
      </button>
      <ul>
        {rest.slice(0, 4).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              {...row(f)}
              aria-label={`${f.path}: ${plural(f.git?.commits ?? 0, "commit")}, complexity ${formatInt(f.complexity)}`}
              className={cn(
                "flex h-6 w-full items-center justify-between gap-3 border-b border-rule px-1 text-left outline-offset-[-2px] last:border-b-0 hover:bg-wash",
                (hoverId === f.id || selectedId === f.id) && "bg-wash",
              )}
            >
              <PathText path={f.path} className={cn("font-mono text-[11px] text-ink", selectedId === f.id && "font-semibold")} />
              <span className="figures shrink-0 font-mono text-[11px] text-ink-2">
                {formatCompact(f.git?.commits ?? 0)} · {formatCompact(f.complexity)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </TrayShell>
  );
}
