/**
 * The accession record for one file: what it is, how big and tangled, who collected it, what it
 * depends on and what depends on it, and what it declares.
 */

import { BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileRecord as FileRec, Report } from "../../../shared/schema";
import { Button } from "../../components/ui/button";
import { formatAgo, formatBytes, formatInt, formatIsoDate, formatPercent, plural } from "../../lib/format";
import { neighbors, type Model } from "../../model/indices";
import { useViewer } from "../../state/store";
import { collectorsOf, degree, edgeSplit } from "../derived";
import { SYMBOL_KIND_LABEL } from "../labels";
import { accession, openFile, show } from "../navigate";
import { CategorySwatch, LanguageSwatch, MetricGrid, MoreButton, Quiet, RowButton, Section, Tag, type Metric, PathText } from "../parts";
import { describeUnavailable, sourceUnavailable } from "../../source/availability";
import { RecordHeading } from "./common";

const CATEGORY_LABEL: Record<FileRec["category"], string> = {
  code: "Code",
  test: "Test",
  markup: "Markup",
  style: "Style",
  data: "Data",
  config: "Config",
  docs: "Docs",
  build: "Build",
  notebook: "Notebook",
  image: "Image",
  media: "Media",
  font: "Font",
  archive: "Archive",
  binary: "Binary",
  lockfile: "Lockfile",
  unknown: "Unrecognized text",
};

const DETECTION: Record<FileRec["detection"], string> = {
  filename: "by its file name",
  extension: "by its extension",
  heuristic: "from its contents (the extension is ambiguous)",
  shebang: "from its #! line",
  modeline: "from an editor modeline",
  content: "from its bytes",
  fallback: "not recognized; shown as plain text or binary",
};

export function FileRecordView({ report, model, file }: { report: Report; model: Model; file: FileRec }) {
  const language = model.languages.get(file.language);
  const holotypeRegion = [...model.holotypeOfDir].find(([, f]) => f === file.id)?.[0];
  const now = Date.parse(report.generatedAt) / 1000;
  const slash = file.path.lastIndexOf("/");

  const metrics: Metric[] = [];
  if (file.lines > 0) {
    metrics.push({ label: "Lines", value: formatInt(file.lines), note: `${formatInt(file.code)} code · ${formatInt(file.blank)} blank` });
    const cc = file.code + file.comment;
    metrics.push({
      label: "Comments",
      value: cc > 0 ? formatPercent(file.comment / cc) : "None",
      note: cc > 0 ? `${formatInt(file.comment)} of ${formatInt(cc)} non-blank lines` : undefined,
    });
  } else {
    metrics.push({ label: "Size", value: formatBytes(file.bytes) });
  }
  if (file.complexity > 0) {
    metrics.push({ label: "Complexity", value: formatInt(file.complexity), note: `${plural(file.functions, "function")}, depth ${file.maxDepth}` });
  }
  if (file.git) {
    metrics.push({ label: "Commits", value: formatInt(file.git.commits), note: `+${formatInt(file.git.added)} −${formatInt(file.git.deleted)} lines` });
    metrics.push({ label: "Authors", value: formatInt(file.git.authors) });
  }
  // Code edges and document links are counted apart (see derived.edgeSplit). A document, with
  // links and no code edges, would otherwise lead with "Imports 0 · Imported by 0".
  const split = edgeSplit(report);
  const linksOut = degree(split.linksTo, file.id);
  const linksIn = degree(split.linkedFrom, file.id);
  const document = linksOut + linksIn > 0 && file.fanIn + file.fanOut === 0;
  if (!document) {
    metrics.push({ label: "Imports", value: formatInt(file.fanOut), note: file.imports !== file.fanOut ? `${plural(file.imports, "statement")}` : undefined });
    metrics.push({ label: "Imported by", value: formatInt(file.fanIn) });
  }
  if (linksOut + linksIn > 0) {
    metrics.push({ label: "Links to", value: formatInt(linksOut), note: "files in this project" });
    metrics.push({ label: "Linked from", value: formatInt(linksIn) });
  }
  metrics.push({ label: "PageRank", value: file.rank.toFixed(3), note: "1 = most depended on" });
  if (file.lines > 0 && metrics.length % 2 === 1) metrics.push({ label: "Size", value: formatBytes(file.bytes) });
  if (file.git) {
    // The specimen-label date form: fixed width, and it fits the narrow record.
    metrics.push({ label: "Created", value: formatIsoDate(file.git.created), note: formatAgo(file.git.created, now) });
    metrics.push({ label: "Last changed", value: formatIsoDate(file.git.modified), note: formatAgo(file.git.modified, now) });
  }

  return (
    <div className="flex flex-col gap-5">
      <RecordHeading above={slash >= 0 ? file.path.slice(0, slash + 1) : undefined} title={file.name}>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="figures font-mono text-xs text-ink-3">{accession(file.id, report.files.length)}</span>
          {holotypeRegion !== undefined && (
            <span className="rounded-xs bg-holotype px-2 py-0.5 text-xs font-semibold text-holotype-ink">
              Holotype · most central in {holotypeRegion === 0 ? "the root" : report.dirs[holotypeRegion]!.name}
            </span>
          )}
          {file.generated && <Tag>generated</Tag>}
          {file.vendored && <Tag>vendored</Tag>}
          {file.minified && <Tag>minified</Tag>}
          {file.secret && <Tag>credentials</Tag>}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <LanguageSwatch languageId={file.language} />
            {language?.name ?? file.language}
          </span>
          <span className="flex items-center gap-1.5">
            <CategorySwatch category={file.category} />
            {CATEGORY_LABEL[file.category]}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-3">Language decided {DETECTION[file.detection]}.</p>
      </RecordHeading>

      <MetricGrid items={metrics} />

      <Facts file={file} />
      {file.asset && (
        <div className="flex h-36 items-center justify-center border border-rule bg-tray p-2">
          <img src={file.asset} alt={`Preview of ${file.name}`} className="max-h-full max-w-full object-contain" />
        </div>
      )}

      {report.git && <Collectors report={report} file={file} />}
      {!document && (
        <>
          <FileList title="Imports" ids={neighbors(split.imports, file.id)} report={report} empty="Imports nothing from this project." />
          <FileList title="Imported by" ids={neighbors(split.importedBy, file.id)} report={report} empty="Nothing in this project imports it." />
        </>
      )}
      {linksOut > 0 && <FileList title="Links to" ids={neighbors(split.linksTo, file.id)} report={report} empty="" />}
      {linksIn > 0 && <FileList title="Linked from" ids={neighbors(split.linkedFrom, file.id)} report={report} empty="" />}
      <DeclaredSymbols file={file} />

      <OpenInReader report={report} file={file} />
    </div>
  );
}

/**
 * Hidden while the reader beside the record already shows this file (it would do nothing), and
 * replaced by the reason when the report holds no text for it: a button that only leads to
 * "nothing to read here" is a wasted trip. Images keep the button; the reader previews them.
 */
function OpenInReader({ report, file }: { report: Report; file: FileRec }) {
  const reading = useViewer((s) => s.tab === "source" && s.source?.file === file.id);
  if (reading) return null;
  const reason = file.asset ? null : sourceUnavailable(report, file);
  if (reason) return <Quiet className="border-t border-rule pt-2 text-xs">{describeUnavailable(report, file, reason).title}.</Quiet>;
  return (
    <Button onClick={() => openFile(file.id)} className="w-full">
      <BookOpen />
      Open in source reader
    </Button>
  );
}

function Facts({ file }: { file: FileRec }) {
  const f = file.facts;
  if (!f) return null;
  const rows: [string, string][] = [];
  if (f.format) rows.push(["Format", f.format]);
  if (f.width && f.height) rows.push(["Pixels", `${formatInt(f.width)} × ${formatInt(f.height)}`]);
  if (f.title) rows.push(["Title", f.title]);
  if (f.headings !== undefined) rows.push(["Headings", formatInt(f.headings)]);
  if (f.links !== undefined) rows.push(["Links", `${formatInt(f.links)}${f.relativeLinks ? `, ${formatInt(f.relativeLinks)} inside the repo` : ""}`]);
  if (f.cells !== undefined) rows.push(["Cells", `${formatInt(f.cells)} (${formatInt(f.codeCells ?? 0)} code, ${formatInt(f.markdownCells ?? 0)} text)`]);
  if (f.kernel) rows.push(["Kernel", f.kernel]);
  if (f.rows !== undefined) rows.push(["Rows", `${formatInt(f.rows)} × ${formatInt(f.columns ?? 0)} columns`]);
  if (f.keys !== undefined) rows.push(["Top-level keys", formatInt(f.keys)]);
  if (file.todos > 0) rows.push(["TODO markers", formatInt(file.todos)]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[110px_1fr] border-t border-rule text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-rule py-1.5 text-ink-3">{k}</dt>
          <dd className="min-w-0 border-b border-rule py-1.5 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Collectors({ report, file }: { report: Report; file: FileRec }) {
  const collectors = useMemo(() => collectorsOf(report, file.id), [report, file.id]);
  const authors = report.git!.authors;
  if (collectors.length === 0) return null;
  const max = collectors[0]!.commits;
  const owner = file.git ? authors[file.git.owner] : undefined;
  return (
    <Section title="Top collectors" count={collectors.length}>
      <div className="border-t border-rule">
        {collectors.slice(0, 4).map(({ author, commits }) => {
          const a = authors[author]!;
          return (
            <button
              key={author}
              type="button"
              onClick={() => show({ kind: "author", id: author })}
              className="block w-full border-b border-rule py-1.5 text-left transition-colors duration-150 hover:bg-wash"
            >
              <span className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate">
                  {a.name}
                  {a.bot && <span className="ml-1.5 text-xs text-ink-3">bot</span>}
                </span>
                <span className="figures font-mono text-xs text-ink-3">{plural(commits, "commit")}</span>
              </span>
              <span className="mt-1 block h-1 bg-rail dark:bg-ink-3" style={{ width: `${Math.max(3, (commits / max) * 100)}%` }} aria-hidden />
            </button>
          );
        })}
      </div>
      {/* Ownership is a share of added lines; a file whose commits added none (an image, a
          rename) has no share to state, and "100% of its added lines" beside "+0" reads wrong. */}
      {owner && file.git && file.git.added > 0 && (
        <Quiet className="text-xs">
          {owner.name} wrote {formatPercent(file.git.ownership)} of its added lines.
        </Quiet>
      )}
    </Section>
  );
}

const LIST_CAP = 6;

function FileList({ title, ids, report, empty }: { title: string; ids: Int32Array; report: Report; empty: string }) {
  const [limit, setLimit] = useState(LIST_CAP);
  const sorted = useMemo(() => Array.from(ids).sort((a, b) => report.files[b]!.rank - report.files[a]!.rank), [ids, report]);
  return (
    <Section title={title} count={sorted.length}>
      {sorted.length === 0 ? (
        <Quiet>{empty}</Quiet>
      ) : (
        <div className="border-t border-rule">
          {sorted.slice(0, limit).map((id) => {
            const f = report.files[id]!;
            return (
              <RowButton key={id} onClick={() => show({ kind: "file", id })} onDoubleClick={() => openFile(id)} title={f.path} aside={f.fanIn ? formatInt(f.fanIn) : undefined}>
                <LanguageSwatch languageId={f.language} />
                <PathText path={f.path} className="text-xs" />
              </RowButton>
            );
          })}
        </div>
      )}
      <MoreButton hidden={sorted.length - limit} onClick={() => setLimit((l) => l + 20)} />
    </Section>
  );
}

function DeclaredSymbols({ file }: { file: FileRec }) {
  const symbols = useViewer((s) => s.symbols);
  const symbolModel = useViewer((s) => s.symbolModel);
  const status = useViewer((s) => s.symbolsStatus);
  const hasSymbols = useViewer((s) => !!s.report?.symbols);
  const [limit, setLimit] = useState(10);
  const ids = useMemo(() => {
    if (!symbols || !symbolModel) return [];
    const { offsets, targets } = symbolModel.symbolsInFile;
    const t = symbols.symbols;
    const out: number[] = [];
    for (let i = offsets[file.id]!; i < offsets[file.id + 1]!; i++) {
      const s = targets[i]!;
      // Top-level declarations only; members are one click away in their class's record.
      if (t.kind[s] !== "module" && t.parent[s] === -1) out.push(s);
    }
    return out;
  }, [symbols, symbolModel, file.id]);

  if (!hasSymbols || file.binary) return null;
  if (status === "loading" || status === "idle") {
    return (
      <Section title="Declares">
        <Quiet>Loading symbols…</Quiet>
      </Section>
    );
  }
  if (!symbols || symbols.moduleSymbol[file.id] === -1 || symbols.moduleSymbol[file.id] === undefined) return null;
  const t = symbols.symbols;
  return (
    <Section title="Declares" count={ids.length}>
      {ids.length === 0 ? (
        <Quiet>No top-level declarations.</Quiet>
      ) : (
        <div className="border-t border-rule">
          {ids.slice(0, limit).map((s) => (
            <RowButton key={s} onClick={() => show({ kind: "symbol", id: s })} aside={`:${t.line[s]! + 1}`}>
              <span className="truncate font-mono text-xs text-ink">{t.name[s]}</span>
              <span className="shrink-0 text-xs text-ink-3">{SYMBOL_KIND_LABEL[t.kind[s]!]}</span>
            </RowButton>
          ))}
        </div>
      )}
      <MoreButton hidden={ids.length - limit} onClick={() => setLimit((l) => l + 30)} />
    </Section>
  );
}
