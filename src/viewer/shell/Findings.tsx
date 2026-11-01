/**
 * Findings: the plain-language observations the analyzer derived from the numbers, grouped by
 * severity. Each one cites the files, drawers or authors it is about; a cited chip selects that
 * specimen and goes to the galaxy, so a finding is always one click from its evidence.
 *
 * Laid out as ruled unit trays (a severity heading, then hairline-separated rows), not cards.
 */

import { FileText, Folder, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Finding, Report, Severity } from "../../shared/schema";
import { Button } from "../components/ui/button";
import { formatInt, plural, shortenPath } from "../lib/format";
import { useViewer } from "../state/store";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "./labels";
import { focusDrawer, show } from "./navigate";
import { SeverityIcon } from "./parts";

export function Findings() {
  const report = useViewer((s) => s.report);
  if (!report) return null;
  const groups = SEVERITY_ORDER.map((sev) => ({ sev, items: report.findings.filter((f) => f.severity === sev) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="h-full overflow-y-auto bg-tray">
      <div className="mx-auto max-w-[920px] px-6 py-6 lg:px-8">
        <h1 className="text-[24px] leading-tight font-semibold text-ink [font-stretch:85%]">Findings</h1>
        <p className="mt-1.5 max-w-[68ch] text-ink-2">
          {report.findings.length === 0
            ? "Nothing in this report's numbers crossed a threshold worth calling out."
            : `${plural(report.findings.length, "observation")} drawn from this report's measurements: ${groups
                .map((g) => COUNT_PHRASE[g.sev](g.items.length))
                .join(", ")}. Each one names the files or people it is about.`}
        </p>

        {groups.map((g) => (
          <section key={g.sev} className="mt-8" aria-labelledby={`sev-${g.sev}`}>
            <h2 id={`sev-${g.sev}`} className="flex items-center gap-2 border-b border-ink pb-2 text-[15px] font-semibold text-ink">
              <SeverityIcon severity={g.sev} />
              {SEVERITY_LABEL[g.sev]}
              <span className="figures font-mono text-xs font-normal text-ink-3">{formatInt(g.items.length)}</span>
            </h2>
            <ol>
              {g.items.map((f) => (
                <FindingRow key={f.id} report={report} finding={f} severity={g.sev} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

const COUNT_PHRASE: Record<Severity, (n: number) => string> = {
  critical: (n) => `${formatInt(n)} critical`,
  warning: (n) => plural(n, "warning"),
  notice: (n) => plural(n, "notice"),
  info: (n) => `${formatInt(n)} for information`,
};

const CHIP_CAP = 8;

function FindingRow({ report, finding, severity }: { report: Report; finding: Finding; severity: Severity }) {
  const [all, setAll] = useState(false);
  const chips: ReactNode[] = [];
  const goto = (fn: () => void) => () => {
    fn();
    useViewer.getState().setTab("galaxy");
  };
  for (const id of finding.files ?? []) {
    const f = report.files[id];
    if (!f) continue;
    chips.push(
      <Chip key={`f${id}`} icon={<FileText />} title={f.path} onClick={goto(() => show({ kind: "file", id }))}>
        {shortenPath(f.path, 42)}
      </Chip>,
    );
  }
  for (const id of finding.dirs ?? []) {
    const d = report.dirs[id];
    if (!d) continue;
    chips.push(
      <Chip key={`d${id}`} icon={<Folder />} title={d.path} onClick={goto(() => focusDrawer(id))}>
        {d.path || report.project.name}
      </Chip>,
    );
  }
  for (const id of finding.authors ?? []) {
    const a = report.git?.authors[id];
    if (!a) continue;
    chips.push(
      <Chip key={`a${id}`} icon={<User />} title={a.email} onClick={goto(() => show({ kind: "author", id }))}>
        {a.name}
      </Chip>,
    );
  }
  const shown = all ? chips : chips.slice(0, CHIP_CAP);

  return (
    <li className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-rule py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <h3 className="text-[15px] leading-snug font-semibold text-ink">
          <span className="sr-only">{SEVERITY_LABEL[severity]}: </span>
          {finding.title}
        </h3>
        <p className="mt-1 max-w-[68ch] text-[13px] text-ink-2">{finding.detail}</p>
        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {shown}
            {chips.length > CHIP_CAP && !all && (
              <Button variant="ghost" size="xs" className="h-6 text-ink-3" onClick={() => setAll(true)}>
                {formatInt(chips.length - CHIP_CAP)} more
              </Button>
            )}
          </div>
        )}
      </div>
      {finding.metric && (
        <div className="sm:w-[180px] sm:text-right">
          <div className="figures font-mono text-[26px] leading-none font-medium text-ink">
            {formatMetric(finding.metric.value)}
            {finding.metric.unit && <span className="ml-0.5 text-[15px] text-ink-2">{finding.metric.unit}</span>}
          </div>
          <div className="mt-1 text-xs text-ink-3">{finding.metric.label}</div>
        </div>
      )}
    </li>
  );
}

function formatMetric(v: number): string {
  return Number.isInteger(v) ? formatInt(v) : v.toFixed(1);
}

function Chip({ icon, title, onClick, children }: { icon: ReactNode; title: string; onClick(): void; children: ReactNode }) {
  return (
    <Button
      variant="outline"
      size="xs"
      title={title}
      onClick={onClick}
      className="h-6 max-w-full gap-1 rounded-xs border-rule-strong bg-paper px-1.5 font-mono text-[11.5px] font-normal text-ink-2 hover:text-ink [&_svg]:text-ink-3"
    >
      {icon}
      <span className="truncate">{children}</span>
    </Button>
  );
}
