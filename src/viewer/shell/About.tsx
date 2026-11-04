/**
 * About this report: when and how it was made, what the analyzer skipped and why, and the
 * non-fatal warnings it raised. This is the provenance a reader who never ran the tool needs
 * before trusting a number (principle 4: the report stands on its own).
 */

import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Report } from "../../shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatBytes, formatInt, plural } from "../lib/format";
import { useViewer } from "../state/store";
import { formatGenerated } from "./labels";
import { Lockup } from "../brand/Brand";
import { takeAboutOpener, useShell } from "./shell-state";

export function About() {
  const open = useShell((s) => s.aboutOpen);
  const setOpen = useShell((s) => s.setAboutOpen);
  const report = useViewer((s) => s.report);
  if (!report) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[86vh] gap-0 overflow-y-auto p-0 sm:max-w-[640px]"
        onCloseAutoFocus={(e) => {
          const opener = takeAboutOpener();
          if (!opener) return;
          e.preventDefault();
          opener.focus();
        }}
      >
        <DialogHeader className="border-b border-rule px-6 pt-5 pb-4">
          <Lockup height={15} className="mb-3 text-ink" />
          <DialogTitle className="text-[20px] font-bold [font-stretch:82%]">About this report</DialogTitle>
          <DialogDescription>
            How Skyplate measured {report.project.name}, and what it left out.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 px-6 py-5">
          <Provenance report={report} />
          {report.warnings.length > 0 && <Warnings warnings={report.warnings} />}
          <Timings timings={report.timings} />
          <Coverage report={report} />
          {report.symbols && <Symbols report={report} />}
          <Licenses version={report.tool.version} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Table({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h3>
      <dl className="grid grid-cols-[170px_1fr] border-t border-rule text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b border-rule py-1.5 pr-3 text-ink-3">{k}</dt>
            <dd className="min-w-0 border-b border-rule py-1.5 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const mono = (s: ReactNode) => <span className="figures font-mono text-xs">{s}</span>;
const yesNo = (b: boolean) => (b ? "Yes" : "No");

function Provenance({ report }: { report: Report }) {
  const git = report.git;
  const rows: [string, ReactNode][] = [
    // The rail prints the same string (labels.ts formatGenerated), so the two never disagree.
    ["Generated", formatGenerated(report.generatedAt)],
    ["Tool", mono(`${report.tool.name} ${report.tool.version}`)],
    ["Schema", mono(String(report.schemaVersion))],
  ];
  if (report.project.root) rows.push(["Analyzed folder", mono(report.project.root)]);
  if (report.project.license) rows.push(["License", report.project.license]);
  if (git) {
    rows.push(["Branch", mono(`${git.branch} @ ${git.head}`)]);
    if (git.remote) rows.push(["Remote", mono(git.remote)]);
    rows.push([
      "History",
      `${formatInt(git.analyzedCommits)} of ${plural(git.totalCommits, "commit")} analyzed${git.truncated ? " (capped)" : ""}${git.shallow ? "; shallow clone, so history starts at a boundary" : ""}`,
    ]);
  } else {
    rows.push(["History", "No git history: churn, authorship and age are not in this report."]);
  }
  rows.push(["Options", `git ${report.options.git ? "on" : "off"}, source ${report.options.source ? "embedded" : "left out"}, ignored files ${report.options.includeIgnored ? "included" : "skipped"}, commit cap ${formatInt(report.options.maxCommits)}`]);
  return <Table title="Provenance" rows={rows} />;
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <TriangleAlert aria-hidden className="size-4 text-serious" />
        Warnings
        <span className="figures font-mono text-xs font-normal text-ink-3">{warnings.length}</span>
      </h3>
      <ul className="border-t border-rule text-[13px] text-ink-2">
        {warnings.map((w, i) => (
          <li key={i} className="border-b border-rule py-1.5 break-words">
            {w}
          </li>
        ))}
      </ul>
    </section>
  );
}

const PHASE_LABEL: Record<string, string> = {
  walk: "Walking the tree",
  detect: "Detecting languages",
  files: "Measuring files",
  imports: "Reading imports",
  graph: "Building the import graph",
  git: "Reading git history",
  layout: "Laying out the plate",
  typescript: "TypeScript symbols",
  stats: "Statistics",
  findings: "Findings",
  write: "Writing the report",
};

function Timings({ timings }: { timings: Record<string, number> }) {
  const phases = Object.entries(timings).filter(([k]) => k !== "total");
  const max = Math.max(1, ...phases.map(([, ms]) => ms));
  return (
    <section>
      <h3 className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-ink">
        Time per phase
        {timings.total !== undefined && <span className="figures font-mono text-xs font-normal text-ink-3">{formatMs(timings.total)} total</span>}
      </h3>
      <div className="border-t border-rule">
        {phases.map(([k, ms]) => (
          <div key={k} className="grid grid-cols-[170px_1fr_64px] items-center gap-3 border-b border-rule py-1.5 text-[13px]">
            <span className="truncate text-ink-3">{PHASE_LABEL[k] ?? k}</span>
            <span className="h-1 bg-measure" style={{ width: `${Math.max(1, (ms / max) * 100)}%` }} aria-hidden />
            <span className="figures text-right font-mono text-xs">{formatMs(ms)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-3">Phases overlap, so they can sum to more than the total.</p>
    </section>
  );
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${formatInt(ms)} ms`;
}

function Coverage({ report }: { report: Report }) {
  const t = report.totals;
  const src = report.source;
  const rows: [string, ReactNode][] = [
    ["Files measured", mono(formatInt(t.files))],
    ["Skipped by the walker", `${formatInt(t.ignored)} (gitignored, unreadable or too large to read)`],
    ["Binary", mono(formatInt(t.binaryFiles))],
    ["Generated / vendored", mono(`${formatInt(t.generatedFiles)} / ${formatInt(t.vendoredFiles)}`)],
  ];
  if (src) {
    rows.push(["Source embedded", `${plural(src.embedded, "file")}, in ${plural(src.chunks.length, "chunk")}`]);
    rows.push([
      "Source left out",
      `${formatInt(src.skipped.binary)} binary, ${formatInt(src.skipped.tooLarge)} over the per-file cap, ${formatInt(src.skipped.overBudget)} over the total budget${src.skipped.disabled ? `, ${formatInt(src.skipped.disabled)} disabled` : ""}`,
    ]);
    rows.push(["Caps", `${formatBytes(src.maxFileBytes)} per file, ${formatBytes(src.maxTotalBytes)} in total`]);
  } else {
    rows.push(["Source", "Not embedded (written with --no-source)"]);
  }
  rows.push(["Credentials", "Files that look like secrets are never embedded"]);
  return <Table title="Coverage" rows={rows} />;
}

function Symbols({ report }: { report: Report }) {
  const s = report.symbols!;
  const loaded = useViewer((st) => st.symbols);
  const rows: [string, ReactNode][] = [
    ["Engine", mono(`${s.engine.name} ${s.engine.version}`)],
    ["Files analyzed", mono(formatInt(s.stats.files))],
    ["Symbols", mono(formatInt(s.stats.symbols))],
    ["References", `${formatInt(s.stats.references)} resolved, ${formatInt(s.stats.unresolved)} unresolved`],
    ["Unused exports", mono(formatInt(s.stats.unusedExports))],
    ["Analysis time", mono(formatMs(s.stats.ms))],
  ];
  if (s.stats.truncated > 0) rows.push(["Dropped by the cap", `${plural(s.stats.truncated, "reference")} (totals still count them)`]);
  if (loaded) rows.push(["Projects", loaded.projects.map((p) => `${p.config || "inferred"} (${formatInt(p.files)})`).join(", ")]);
  return <Table title="Code intelligence" rows={rows} />;
}

/**
 * The report's own license notices. Every report folder carries LICENSE, NOTICE and
 * THIRD_PARTY_NOTICES beside index.html (src/core/site.ts), because sharing a report
 * redistributes the viewer and everything bundled into it; these links are how a reader who
 * never opens the folder finds them. Relative, like every URL in a report, so they work over
 * file:// and from any static host (the CLI's server sends them as text).
 */
function Licenses({ version }: { version: string }) {
  const link = "underline decoration-rule-strong underline-offset-2 hover:text-ink hover:decoration-ink-3";
  return (
    <section className="border-t border-rule pt-4 text-xs leading-relaxed text-ink-3">
      Skyplate {version} is open source under the{" "}
      <a className={link} href="LICENSE" target="_blank" rel="noreferrer">
        Apache License 2.0
      </a>
      {" "}(
      <a className={link} href="NOTICE" target="_blank" rel="noreferrer">
        NOTICE
      </a>
      ). The viewer bundles open-source packages and fonts whose licenses are in{" "}
      <a className={link} href="THIRD_PARTY_NOTICES" target="_blank" rel="noreferrer">
        third-party notices
      </a>
      .
    </section>
  );
}
