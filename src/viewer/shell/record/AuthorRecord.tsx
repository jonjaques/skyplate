/** The record for one author: their history, what they own, where they work. */

import { useMemo, useState } from "react";
import type { Author, Report } from "../../../shared/schema";
import { formatDate, formatInt, formatMonth, formatPercent, plural, shortenPath } from "../../lib/format";
import type { Model } from "../../model/indices";
import { commitsByAuthor } from "../derived";
import { focusDrawer, openFile, show } from "../navigate";
import { MetricGrid, MoreButton, Quiet, RowButton, Section, Tag, type Metric, PathText } from "../parts";
import { RecordHeading } from "./common";

export function AuthorRecordView({ report, model, author, id }: { report: Report; model: Model; author: Author; id: number }) {
  const git = report.git!;
  const [limit, setLimit] = useState(8);
  const owned = useMemo(
    () => [...(model.authorFiles[id] ?? [])].sort((a, b) => report.files[b]!.lines - report.files[a]!.lines),
    [model, id, report],
  );

  // Where they work: commits per top-level drawer, counting each commit once per drawer.
  const { dirs, recent } = useMemo(() => {
    const byAuthor = commitsByAuthor(report);
    const counts = new Map<number, number>();
    const commits: number[] = [];
    if (byAuthor) {
      for (let i = byAuthor.offsets[id]!; i < byAuthor.offsets[id + 1]!; i++) {
        const c = byAuthor.targets[i]!;
        commits.push(c);
        const seen = new Set<number>();
        for (const f of git.commits.files[c] ?? []) seen.add(model.topDir[f]!);
        for (const d of seen) counts.set(d, (counts.get(d) ?? 0) + 1);
      }
    }
    return {
      dirs: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5),
      // Commit indexes run newest first, so the head of the list is the most recent work.
      recent: commits.slice(0, 5),
    };
  }, [report, model, id, git]);

  const metrics: Metric[] = [
    { label: "Commits", value: formatInt(author.commits), note: `${formatPercent(author.commits / Math.max(1, git.analyzedCommits))} of analyzed` },
    { label: "Files owned", value: formatInt(author.owned) },
    { label: "Lines added", value: formatInt(author.added) },
    { label: "Lines removed", value: formatInt(author.deleted) },
    { label: "First commit", value: formatMonth(author.first), note: formatDate(author.first) },
    { label: "Latest commit", value: formatMonth(author.last), note: formatDate(author.last) },
  ];
  const maxDir = dirs[0]?.[1] ?? 1;
  const truck = git.truckFactor.authors.includes(id);

  return (
    <div className="flex flex-col gap-5">
      <RecordHeading above={author.email} title={author.name}>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {author.bot && <Tag>bot</Tag>}
          {truck && <Tag title="Part of the smallest group whose departure would orphan most files">truck factor</Tag>}
        </div>
      </RecordHeading>

      <MetricGrid items={metrics} />

      {author.bot && <Quiet className="-mt-2">Automation accounts keep their commits here but never count as owners.</Quiet>}

      {dirs.length > 0 && (
        <Section title="Where they commit">
          <div className="border-t border-rule">
            {dirs.map(([dir, n]) => (
              <button
                key={dir}
                type="button"
                onClick={() => dir !== 0 && focusDrawer(dir)}
                className="block w-full border-b border-rule py-1.5 text-left transition-colors duration-150 hover:bg-wash"
              >
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-mono text-xs">{dir === 0 ? "Root files" : report.dirs[dir]!.path}</span>
                  <span className="figures font-mono text-xs text-ink-3">{plural(n, "commit")}</span>
                </span>
                <span className="mt-1 block h-1 bg-rail dark:bg-ink-3" style={{ width: `${Math.max(3, (n / maxDir) * 100)}%` }} aria-hidden />
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Files owned" count={owned.length}>
        {owned.length === 0 ? (
          <Quiet>{author.bot ? "Bots never own files." : "Owns no files: someone else wrote more of each one they touched."}</Quiet>
        ) : (
          <div className="border-t border-rule">
            {owned.slice(0, limit).map((f) => (
              <RowButton key={f} onClick={() => show({ kind: "file", id: f })} onDoubleClick={() => openFile(f)} title={report.files[f]!.path} aside={formatInt(report.files[f]!.lines)}>
                <PathText path={report.files[f]!.path} className="text-xs" />
              </RowButton>
            ))}
          </div>
        )}
        <MoreButton hidden={owned.length - limit} onClick={() => setLimit((l) => l + 30)} />
      </Section>

      {recent.length > 0 && (
        <Section title="Recent commits">
          <div className="border-t border-rule">
            {recent.map((c) => (
              <div key={c} className="border-b border-rule py-1.5 text-[13px]">
                <div className="truncate text-ink" title={git.commits.subject[c]}>
                  {git.commits.subject[c] || "(no message)"}
                </div>
                <div className="figures font-mono text-[11px] text-ink-3">
                  {git.commits.hash[c]} · {formatDate(git.commits.time[c]!)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
