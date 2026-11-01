/**
 * Viewer shell. The layout is the chosen Specimen Cabinet composition: drawer rail, top bar,
 * galaxy plate, accession record, unit trays. Work areas fill in as their modules land.
 */

import { useEffect, useState } from "react";
import type { Report } from "../shared/schema";
import { loadReport } from "./data/load";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; report: Report }
  | { status: "missing"; message: string };

const TABS = ["Galaxy", "Charts", "Explorer", "Source", "Findings"] as const;
const nf = new Intl.NumberFormat("en-US");

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    loadReport().then(
      (report) => setState({ status: "ready", report }),
      (error: Error) => setState({ status: "missing", message: error.message }),
    );
  }, []);

  const report = state.status === "ready" ? state.report : undefined;
  const topDirs = report
    ? (report.dirs[0]?.dirs ?? [])
        .map((id) => report.dirs[id]!)
        .sort((a, b) => b.totalFiles - a.totalFiles)
        .slice(0, 12)
    : [];

  return (
    <div className="grid h-full grid-cols-[260px_1fr_340px] grid-rows-[52px_1fr_216px]">
      <nav className="row-span-3 flex flex-col bg-rail text-rail-ink" aria-label="Drawers">
        <div className="border-b border-rail-line px-[22px] pt-5 pb-4">
          <div className="text-[28px] leading-none font-bold tracking-[-0.01em] [font-stretch:80%]">
            starchart
          </div>
          <div className="mt-1.5 text-xs text-rail-muted">
            {report ? report.project.name : "No report loaded"}
          </div>
        </div>
        <h2 className="px-[22px] pt-4 pb-2 text-xs font-semibold text-rail-muted [font-stretch:75%]">
          {report ? `Drawers · ${nf.format(report.totals.files)} files` : "Drawers"}
        </h2>
        <ul>
          {topDirs.map((dir) => (
            <li
              key={dir.id}
              className="flex h-[38px] items-center justify-between border-t border-rail-line px-[22px] text-sm font-medium last:border-b"
            >
              <span className="truncate">{dir.name}</span>
              <span className="figures font-mono text-xs text-rail-muted">
                {nf.format(dir.totalFiles)}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <header className="col-span-2 flex items-center gap-5 border-b border-rule bg-paper px-5">
        <div className="flex h-full" role="tablist">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              role="tab"
              aria-selected={i === 0}
              className={`flex items-center border-b-2 px-4 text-sm font-semibold ${
                i === 0 ? "border-ink text-ink" : "border-transparent text-muted-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      <main className="relative overflow-hidden bg-plate text-plate-ink">
        {state.status === "missing" ? (
          <div className="absolute inset-0 grid place-items-center p-10">
            <div className="max-w-md">
              <h1 className="text-2xl font-semibold [font-stretch:85%]">No report in this folder</h1>
              <p className="mt-3 text-plate-muted">
                The viewer looks for <code className="font-mono">data/report.js</code> next to this
                page. Generate a report with{" "}
                <code className="font-mono text-plate-ink">bun run starchart &lt;path&gt;</code>, then
                open the folder it writes.
              </p>
            </div>
          </div>
        ) : (
          <h1 className="absolute top-[18px] left-6 text-2xl font-semibold [font-stretch:85%]">
            {report ? `${report.project.name} · ${nf.format(report.totals.files)} specimens` : "Loading report…"}
          </h1>
        )}
      </main>

      <aside className="row-span-2 border-l border-rule bg-paper px-[22px] py-5" aria-label="Accession record">
        <h2 className="text-xs text-muted-foreground">Accession record</h2>
        <p className="mt-2 text-muted-foreground">Select a specimen in the galaxy to read its record.</p>
      </aside>

      <section className="grid grid-cols-[1.15fr_1fr_1.2fr] border-t border-ink" aria-label="Unit trays">
        {["Language composition", "Commit activity", "Hotspots"].map((title) => (
          <div key={title} className="border-r border-rule px-[18px] py-3.5 last:border-r-0">
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
        ))}
      </section>
    </div>
  );
}
