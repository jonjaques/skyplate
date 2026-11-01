/**
 * The record for a directory (a drawer): its totals, language mix, largest and hottest files,
 * and who owns what is in it.
 */

import { useMemo } from "react";
import type { DirRecord as DirRec, Report } from "../../../shared/schema";
import { Button } from "../../components/ui/button";
import { seriesColor } from "../../lib/colors";
import { formatBytes, formatInt, formatPercent, plural } from "../../lib/format";
import type { Model } from "../../model/indices";
import { useViewer } from "../../state/store";
import { summarizeDir } from "../derived";
import { focusDrawer, openFile, show } from "../navigate";
import { MetricGrid, Quiet, RowButton, Section, Swatch, type Metric, PathText } from "../parts";
import { useSurface } from "../theme";
import { RecordHeading } from "./common";

export function DirRecordView({ report, model, dir }: { report: Report; model: Model; dir: DirRec }) {
  const filters = useViewer((s) => s.filters);
  const summary = useMemo(() => summarizeDir(model, dir.id, filters), [model, dir.id, filters]);
  const focusDir = useViewer((s) => s.focusDir);
  const surface = useSurface();
  const holotype = model.holotypeOfDir.get(dir.id);
  const slash = dir.path.lastIndexOf("/");
  const isRoot = dir.id === 0;

  const metrics: Metric[] = [
    { label: "Files", value: formatInt(dir.totalFiles), note: `${plural(dir.files.length, "file")} directly inside` },
    { label: "Subdirectories", value: formatInt(dir.dirs.length) },
    { label: "Lines", value: formatInt(dir.totalLines), note: `${formatInt(dir.totalCode)} code` },
    { label: "Size", value: formatBytes(dir.totalBytes) },
  ];
  if (dir.commits !== undefined) metrics.push({ label: "Commits", value: formatInt(dir.commits), note: "touching anything beneath" });
  if (report.totals.files > 0) metrics.push({ label: "Share of files", value: formatPercent(dir.totalFiles / report.totals.files) });

  const langs = summary.languages;
  const shown = langs.slice(0, 6);
  const rest = langs.slice(6).reduce((n, l) => n + l.lines, 0);
  const authors = report.git?.authors ?? [];

  return (
    <div className="flex flex-col gap-5">
      <RecordHeading above={!isRoot && slash >= 0 ? dir.path.slice(0, slash + 1) : undefined} title={isRoot ? report.project.name : dir.name}>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {!isRoot && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => focusDrawer(focusDir === dir.id ? null : dir.id)}
              aria-pressed={focusDir === dir.id}
            >
              {focusDir === dir.id ? "Show every drawer" : "Focus this drawer"}
            </Button>
          )}
        </div>
      </RecordHeading>

      <MetricGrid items={metrics} />

      {summary.codeLines > 0 && (
        <Section title="Language mix" count={langs.length}>
          <div className="flex h-3 w-full overflow-hidden" aria-hidden>
            {langs.map((l) => (
              <span
                key={l.id}
                style={{ flex: l.lines, backgroundColor: seriesColor(model.languageSlot.get(l.id) ?? -1, surface) }}
              />
            ))}
          </div>
          <div className="mt-2 border-t border-rule">
            {shown.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 border-b border-rule py-1 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch color={seriesColor(model.languageSlot.get(l.id) ?? -1, surface)} />
                  <span className="truncate">{model.languages.get(l.id)?.name ?? l.id}</span>
                </span>
                <span className="figures font-mono text-xs text-ink-3">{formatPercent(l.lines / summary.codeLines)}</span>
              </div>
            ))}
            {rest > 0 && (
              <div className="flex items-center justify-between border-b border-rule py-1 text-[13px] text-ink-3">
                <span>{plural(langs.length - shown.length, "other language")}</span>
                <span className="figures font-mono text-xs">{formatPercent(rest / summary.codeLines)}</span>
              </div>
            )}
          </div>
          <Quiet className="text-xs">
            Share of code lines, comments and blanks excluded.
            {summary.filteredOut > 0 && ` Leaves out ${plural(summary.filteredOut, "file")} the filters hide, as the trays do.`}
          </Quiet>
        </Section>
      )}

      {holotype !== undefined && (
        <Section title="Holotype">
          <RowButton onClick={() => show({ kind: "file", id: holotype })} aside={`${formatInt(report.files[holotype]!.fanIn)} importers`} className="border-t">
            <span className="size-2 shrink-0 rounded-full bg-holotype" aria-hidden />
            <PathText path={report.files[holotype]!.path} className="text-xs" />
          </RowButton>
          <Quiet className="text-xs">The most central file in this region: the highest PageRank, which counts files that depend on it through others, not only its direct importers.</Quiet>
        </Section>
      )}

      <FileRows title="Largest files" ids={summary.largest} report={report} figure={(id) => plural(report.files[id]!.lines, "line")} />
      {summary.hottest.length > 0 && (
        <FileRows title="Hottest files" ids={summary.hottest} report={report} figure={(id) => report.files[id]!.hotspot.toFixed(2)} note="Hotspot score: churn × complexity, 0 to 1." />
      )}

      {summary.owners.length > 0 && (
        <Section title="Owners" count={summary.owners.length}>
          <div className="border-t border-rule">
            {summary.owners.slice(0, 5).map(({ author, files }) => (
              <RowButton key={author} onClick={() => show({ kind: "author", id: author })} aside={plural(files, "file")}>
                <span className="truncate">{authors[author]?.name ?? "Unknown"}</span>
              </RowButton>
            ))}
          </div>
          <Quiet className="text-xs">Files where each person wrote the most lines. Bots never count as owners.</Quiet>
        </Section>
      )}
    </div>
  );
}

function FileRows({
  title,
  ids,
  report,
  figure,
  note,
}: {
  title: string;
  ids: number[];
  report: Report;
  figure(id: number): string;
  note?: string;
}) {
  if (ids.length === 0) return null;
  return (
    <Section title={title}>
      <div className="border-t border-rule">
        {ids.map((id) => (
          <RowButton key={id} onClick={() => show({ kind: "file", id })} onDoubleClick={() => openFile(id)} title={report.files[id]!.path} aside={figure(id)}>
            <PathText path={report.files[id]!.path} className="text-xs" />
          </RowButton>
        ))}
      </div>
      {note && <Quiet className="text-xs">{note}</Quiet>}
    </Section>
  );
}
