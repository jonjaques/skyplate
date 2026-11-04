/**
 * Galaxy dev harness: the Plate Archive frame (rail, top bar, record, trays) as plain
 * placeholders around a real GalaxyView, plus query-string presets for repeatable looks:
 *
 *   ?compact=1        the Source tab's small plate
 *   ?color=churn      store.colorBy        ?size=commits   store.sizeBy
 *   ?layout=graph     store.layout         ?edges=all      store.edges
 *   ?gravity=churn    store.gravity
 *   ?symbol=name      select a symbol by name (loads the tables)
 *   ?file=path        select a file        ?focus=path     open a drawer
 *   ?time=0.5         scrubber at that fraction of history
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../components/ui/tooltip";
import { loadReport } from "../../data/load";
import { ensureSymbols } from "../../state/loaders";
import { useViewer, type ColorBy, type EdgeMode, type Gravity, type LayoutMode, type SizeBy } from "../../state/store";
import "../../styles.css";
import { Lockup } from "../../brand/Brand";
import { GalaxyView } from "../GalaxyView";

const q = new URLSearchParams(location.search);
(window as unknown as Record<string, unknown>).__viewer = useViewer;

async function boot() {
  const report = await loadReport();
  const s = useViewer.getState();
  s.setReport(report);
  if (q.get("color")) s.setColorBy(q.get("color") as ColorBy);
  if (q.get("size")) s.setSizeBy(q.get("size") as SizeBy);
  if (q.get("layout")) s.setLayout(q.get("layout") as LayoutMode);
  if (q.get("gravity")) s.setGravity(q.get("gravity") as Gravity);
  if (q.get("edges")) s.setEdges(q.get("edges") as EdgeMode);
  const model = useViewer.getState().model!;
  if (q.get("focus")) {
    const d = report.dirs.find((x) => x.path === q.get("focus"));
    if (d) s.focus(d.id);
  }
  if (q.get("file")) {
    const id = model.pathIndex.get(q.get("file")!);
    if (id !== undefined) s.select({ kind: "file", id });
  }
  if (q.get("time") && report.git) s.setTime(report.git.first + (report.git.last - report.git.first) * Number(q.get("time")));
  if (q.get("symbol")) {
    await ensureSymbols();
    const sy = useViewer.getState().symbols;
    const name = q.get("symbol")!;
    if (sy) {
      let best = -1;
      for (let i = 0; i < sy.symbols.name.length; i++) {
        if (sy.symbols.name[i] === name && (best < 0 || sy.symbols.refs[i]! > sy.symbols.refs[best]!)) best = i;
      }
      if (best >= 0) s.select({ kind: "symbol", id: best });
    }
  }
}

function Frame() {
  const report = useViewer((s) => s.report);
  const selection = useViewer((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    boot().catch((e: Error) => setError(e.message));
  }, []);
  const compact = q.get("compact") === "1";
  return (
    <div className="grid h-full grid-cols-[260px_1fr_340px] grid-rows-[52px_1fr_216px]">
      <nav className="row-span-3 border-r border-rule bg-rail p-5 text-ink">
        <Lockup height={17} />
        <div className="mt-3 text-xs text-ink-3">{report?.project.name ?? error ?? "loading"}</div>
      </nav>
      <header className="col-span-2 border-b border-rule bg-paper" />
      <main className={compact ? "relative grid min-h-0 grid-cols-[1fr_420px]" : "relative min-h-0"}>
        {compact && <div className="bg-paper" />}
        <div className={compact ? "relative min-h-0" : "absolute inset-0"}>
          <GalaxyView compact={compact} />
        </div>
      </main>
      <aside className="row-span-2 border-l border-rule bg-paper p-5 font-mono text-xs text-ink-3">
        {selection ? `${selection.kind} ${selection.id}` : "no selection"}
      </aside>
      <section className="border-t border-rule bg-tray" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={250}>
      <Frame />
    </TooltipProvider>
  </StrictMode>,
);
