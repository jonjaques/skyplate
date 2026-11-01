/**
 * The accession record: the right-hand column describing whatever is selected. It follows the
 * shared selection, so a star clicked on the plate, a row in the explorer, a chip in the findings
 * and a name clicked in the source all land here the same way.
 */

import { Kbd } from "../../components/ui/kbd";
import { formatInt, plural, shortenPath } from "../../lib/format";
import { useViewer } from "../../state/store";
import { show } from "../navigate";
import { Quiet, RowButton, Section, SeverityMark, PathText } from "../parts";
import { MOD_KEY } from "../TopBar";
import { AuthorRecordView } from "./AuthorRecord";
import { DirRecordView } from "./DirRecord";
import { FileRecordView } from "./FileRecord";
import { SymbolRecordView } from "./SymbolRecord";

export function Record() {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const selection = useViewer((s) => s.selection);
  const symbols = useViewer((s) => s.symbols);
  const symbolModel = useViewer((s) => s.symbolModel);

  if (!report || !model) return <RecordSkeleton />;
  if (!selection) return <Guide />;

  switch (selection.kind) {
    case "file": {
      const file = report.files[selection.id];
      return file ? <FileRecordView key={file.id} report={report} model={model} file={file} /> : <Guide />;
    }
    case "dir": {
      const dir = report.dirs[selection.id];
      return dir ? <DirRecordView key={dir.id} report={report} model={model} dir={dir} /> : <Guide />;
    }
    case "author": {
      const author = report.git?.authors[selection.id];
      return author ? <AuthorRecordView key={selection.id} report={report} model={model} author={author} id={selection.id} /> : <Guide />;
    }
    case "symbol":
      if (!symbols || !symbolModel) return <Quiet>Loading the symbol tables…</Quiet>;
      return symbols.symbols.name[selection.id] !== undefined ? (
        <SymbolRecordView key={selection.id} report={report} symbols={symbols} sm={symbolModel} id={selection.id} />
      ) : (
        <Guide />
      );
  }
}

function RecordSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading">
      <div className="h-3 w-1/3 animate-pulse rounded-xs bg-wash" />
      <div className="h-6 w-3/4 animate-pulse rounded-xs bg-wash" />
      <div className="mt-4 h-24 animate-pulse rounded-xs bg-wash" />
    </div>
  );
}

/**
 * Nothing selected: what the reader can do here, then the project's own orientation points
 * (its description, its holotypes, its most pressing findings), so the column is never idle.
 */
function Guide() {
  const report = useViewer((s) => s.report)!;
  const model = useViewer((s) => s.model)!;
  const setTab = useViewer((s) => s.setTab);
  const holotypes = [...model.holotypeOfDir]
    .map(([dir, file]) => ({ dir, file }))
    .sort((a, b) => report.files[b.file]!.rank - report.files[a.file]!.rank)
    .slice(0, 6);
  const pressing = report.findings.filter((f) => f.severity === "critical" || f.severity === "warning").slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="text-[22px] leading-[1.15] font-bold [font-stretch:80%]">{report.project.name}</h2>
        {report.project.description && <p className="mt-2 text-[13px] text-ink-2">{report.project.description}</p>}
        <p className="figures mt-2 font-mono text-xs text-ink-3">
          {plural(report.totals.files, "file")} · {formatInt(report.totals.lines)} lines · {plural(report.totals.languages, "language")}
        </p>
      </header>

      <Section title="Reading this report">
        <ul className="border-t border-rule text-[13px] text-ink-2">
          <li className="border-b border-rule py-1.5">Click a star to read its record here: size, history, who wrote it, what it imports.</li>
          <li className="border-b border-rule py-1.5">Open a drawer in the rail to focus one region; everything else dims.</li>
          <li className="border-b border-rule py-1.5">
            Press <Kbd>{MOD_KEY === "⌘" ? "⌘K" : "Ctrl K"}</Kbd> or <Kbd>/</Kbd> to find any file, directory, symbol or author.
          </li>
          <li className="border-b border-rule py-1.5">
            Keys <Kbd>1</Kbd>–<Kbd>5</Kbd> switch between the galaxy, charts, explorer, source and findings.
          </li>
        </ul>
      </Section>

      {holotypes.length > 0 && (
        <Section title="Holotypes">
          <p className="mb-1.5 text-xs text-ink-3">The most depended-on file in each region, marked red on the plate.</p>
          <div className="border-t border-rule">
            {holotypes.map(({ dir, file }) => (
              <RowButton key={file} onClick={() => show({ kind: "file", id: file })} title={report.files[file]!.path} aside={formatInt(report.files[file]!.fanIn)}>
                <span className="size-2 shrink-0 rounded-full bg-holotype" aria-hidden />
                <PathText path={report.files[file]!.path} className="text-xs" />
                <span className="sr-only">in {dir === 0 ? "the root" : report.dirs[dir]!.name}</span>
              </RowButton>
            ))}
          </div>
        </Section>
      )}

      {pressing.length > 0 && (
        <Section title="Worth a look first">
          <div className="border-t border-rule">
            {pressing.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTab("findings")}
                className="block w-full border-b border-rule py-2 text-left transition-colors duration-150 hover:bg-wash"
              >
                <SeverityMark severity={f.severity} className="text-xs text-ink-3" />
                <span className="mt-0.5 block text-[13px] text-ink">{f.title}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
