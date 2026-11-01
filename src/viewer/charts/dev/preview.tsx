/**
 * Development-only harness for the charts builder: mounts the trays and the Charts tab in the
 * shell's grid without the shell, so they can be looked at before the shell mounts them.
 * Not imported by the viewer; delete with the folder once the shell hosts the real thing.
 */
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../components/ui/tooltip";
import { loadReport } from "../../data/load";
import { useViewer } from "../../state/store";
import { ActivityTray, ChartsView, HotspotTray, LanguageTray } from "../index";
import "../../styles.css";

const q = new URLSearchParams(location.search);
const view = q.get("view") ?? "galaxy";

function Preview() {
  const report = useViewer((s) => s.report);
  const focusDir = useViewer((s) => s.focusDir);
  const focus = useViewer((s) => s.focus);
  if (!report) return <div className="p-8">Loading…</div>;
  const tops = (report.dirs[0]?.dirs ?? []).map((id) => report.dirs[id]!).sort((a, b) => b.totalFiles - a.totalFiles).slice(0, 12);
  return (
    <div className="grid h-full grid-cols-[260px_1fr_340px] grid-rows-[52px_1fr_216px]">
      <nav className="row-span-3 flex flex-col bg-rail text-rail-ink">
        <div className="px-[22px] pt-5 pb-4 text-[28px] font-bold">starchart</div>
        {tops.map((d) => (
          <button key={d.id} className={`flex h-[38px] items-center justify-between border-t border-rail-line px-[22px] text-sm ${focusDir === d.id ? "bg-tray text-ink" : ""}`} onClick={() => focus(focusDir === d.id ? null : d.id)}>
            <span>{d.name}</span><span className="font-mono text-xs">{d.totalFiles}</span>
          </button>
        ))}
      </nav>
      <header className="col-span-2 flex items-center gap-4 border-b border-rule bg-paper px-5 text-sm">
        <a href={`?view=galaxy&theme=${q.get("theme") ?? "light"}`}>Galaxy</a>
        <a href={`?view=charts&theme=${q.get("theme") ?? "light"}`}>Charts</a>
      </header>
      {view === "charts" ? (
        <main className="col-span-2 row-span-2 min-h-0 overflow-hidden">
          <ChartsView />
        </main>
      ) : (
        <>
          <main className="bg-plate" />
          <aside className="row-span-2 border-l border-rule bg-paper" />
          <section className="grid min-h-0 grid-cols-[1.15fr_1fr_1.2fr] border-t border-ink">
            <div className="min-w-0 border-r border-rule"><LanguageTray /></div>
            <div className="min-w-0 border-r border-rule"><ActivityTray /></div>
            <div className="min-w-0"><HotspotTray /></div>
          </section>
        </>
      )}
    </div>
  );
}

loadReport().then((r) => useViewer.getState().setReport(r));
createRoot(document.getElementById("root")!).render(
  <TooltipProvider delayDuration={250}>
    <Preview />
  </TooltipProvider>,
);
