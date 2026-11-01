/**
 * Viewer shell: the Specimen Cabinet composition. Drawer rail on the left, top bar, the work
 * area for the active tab, the accession record on the right, and on the Galaxy tab the row of
 * three unit trays under the plate (.impeccable/mocks/decision/assigned.html is the reference).
 *
 *   ≥ 1280px   260px rail | work | 340px record
 *   1024+      220px rail | work | 300px record
 *   < 1024     the rail is a sheet behind a top-bar button; the record follows the work area
 *   < 768      one column; the plate takes about 60% of the viewport height
 *
 * Inactive tabs unmount. The galaxy is a WebGL scene, and a hidden one would keep its context
 * and its frame loop alive behind the explorer; remounting it on return is the cheaper cost.
 */

import { useEffect, useState, type ReactNode } from "react";
import { SCHEMA_VERSION } from "../shared/schema";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./components/ui/sheet";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { loadReport } from "./data/load";
import { cn } from "./lib/utils";
import { ensureSymbols } from "./state/loaders";
import { useViewer, type Tab } from "./state/store";
import { startUrlSync } from "./state/url";
import { About } from "./shell/About";
import { Boundary } from "./shell/Boundary";
import { CommandPalette } from "./shell/CommandPalette";
import { Explorer } from "./shell/Explorer";
import { Findings } from "./shell/Findings";
import { useGlobalShortcuts } from "./shell/keyboard";
import { useBreakpoint, type Breakpoint } from "./shell/media";
import { ActivityTray, ChartsView, GalaxyView, HotspotTray, LanguageTray } from "./shell/mounts";
import { Rail } from "./shell/Rail";
import { Record } from "./shell/record/Record";
import { useShell } from "./shell/shell-state";
import { useThemeSync } from "./shell/theme";
import { TopBar } from "./shell/TopBar";
import { SourceTab } from "./source/SourceTab";

type LoadState = { status: "loading" } | { status: "ready" } | { status: "missing" } | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useThemeSync();

  useEffect(() => {
    // A report.js that exists but does not parse never calls resolve(), so loadReport() would
    // wait forever. Its syntax error still surfaces here, tagged with the script's URL.
    const onError = (e: ErrorEvent) => {
      if (e.filename && /data\/report\.js/.test(e.filename)) {
        setState({ status: "error", message: `data/report.js could not be read: ${e.message}` });
      }
    };
    window.addEventListener("error", onError);
    loadReport().then(
      (report) => {
        if (report.schemaVersion !== SCHEMA_VERSION) {
          setState({
            status: "error",
            message: `This report uses data format ${report.schemaVersion}; this viewer reads format ${SCHEMA_VERSION}. Re-run starchart to rebuild it with a matching viewer.`,
          });
          return;
        }
        try {
          useViewer.getState().setReport(report);
          document.title = `${report.project.name} · starchart`;
          setState({ status: "ready" });
        } catch (error) {
          setState({ status: "error", message: `The report loaded but could not be indexed: ${(error as Error).message}` });
        }
      },
      () => setState({ status: "missing" }),
    );
    return () => window.removeEventListener("error", onError);
  }, []);

  const ready = state.status === "ready";

  // Restore the view from the URL, then keep the URL in step.
  useEffect(() => (ready ? startUrlSync() : undefined), [ready]);

  // The symbol tables are the biggest data file; fetch them once the first view has painted
  // and the main thread is idle, so a first look never waits on them.
  useEffect(() => {
    if (!ready) return;
    const run = () => void ensureSymbols();
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(run, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1200);
    return () => clearTimeout(id);
  }, [ready]);

  return <Shell state={state} />;
}

function Shell({ state }: { state: LoadState }) {
  const bp = useBreakpoint();
  const tab = useViewer((s) => s.tab);
  const setTab = useViewer((s) => s.setTab);
  const ready = state.status === "ready";
  useGlobalShortcuts();

  const sheetRail = bp === "narrow" || bp === "compact";
  const showRecord = ready && tab !== "charts";

  const work = ready ? (
    <WorkArea bp={bp} />
  ) : (
    <div className="relative h-full min-h-[60vh] bg-plate text-plate-ink">
      {state.status === "loading" && <LoadingPlate />}
      {state.status === "missing" && <MissingReport />}
      {state.status === "error" && <BrokenReport message={state.message} />}
    </div>
  );

  const record = (
    <div className="px-[22px] py-5">
      <Record />
    </div>
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="h-full gap-0">
      {sheetRail ? (
        <div className="flex h-full min-h-0 flex-col">
          <TopBar bp={bp} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <main className="min-w-0">{work}</main>
            {showRecord && (
              <aside aria-label="Accession record" className="border-t border-ink bg-paper">
                {record}
              </aside>
            )}
          </div>
          <RailSheet />
        </div>
      ) : (
        <div className={cn("grid h-full min-h-0", bp === "wide" ? "grid-cols-[260px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]")}>
          <nav aria-label="Drawers" className="min-h-0 overflow-hidden">
            <Rail />
          </nav>
          <div className="grid min-h-0 min-w-0 grid-rows-[52px_minmax(0,1fr)]">
            <TopBar bp={bp} />
            <div className="flex min-h-0 min-w-0">
              <main className="relative min-h-0 min-w-0 flex-1">{work}</main>
              {(showRecord || !ready) && (
                <aside
                  aria-label="Accession record"
                  className={cn("min-h-0 shrink-0 border-l border-rule bg-paper", bp === "wide" ? "w-[340px]" : "w-[300px]")}
                >
                  <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:!block">{record}</ScrollArea>
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
      {ready && (
        <>
          <CommandPalette />
          <About />
        </>
      )}
    </Tabs>
  );
}

/** One tab's content. Below 1024px each gets a height of its own, since the page scrolls. */
function WorkArea({ bp }: { bp: Breakpoint }) {
  const stacked = bp === "narrow" || bp === "compact";
  const pane = (value: Tab, className: string, tall: string, children: ReactNode) => (
    <TabsContent value={value} className={cn("min-h-0", stacked ? tall : "h-full", className)}>
      {children}
    </TabsContent>
  );
  return (
    <>
      {pane("galaxy", "", "", <GalaxyArea bp={bp} />)}
      {pane(
        "charts",
        "overflow-hidden",
        "h-[calc(100dvh-52px)]",
        <Boundary what="The charts">
          <ChartsView />
        </Boundary>,
      )}
      {pane("explorer", "", "h-[72dvh]", <Explorer />)}
      {pane("source", "", "h-[88dvh]", <SourceTab />)}
      {pane("findings", "", "", <Findings />)}
    </>
  );
}

function GalaxyArea({ bp }: { bp: Breakpoint }) {
  const stacked = bp === "narrow" || bp === "compact";
  const cell = "relative min-h-0 min-w-0 overflow-hidden";
  return (
    <div className={cn("flex min-h-0 flex-col", !stacked && "h-full")}>
      <div className={cn("relative min-h-0 overflow-hidden bg-plate", stacked ? "h-[60dvh] min-h-[360px]" : "flex-1")}>
        <Boundary what="The galaxy" tone="plate">
          <GalaxyView />
        </Boundary>
      </div>
      <section
        aria-label="Unit trays"
        className={cn(
          "grid shrink-0 border-t border-ink bg-tray",
          bp === "compact" ? "grid-cols-1 [&>*]:h-[216px] [&>*]:border-b [&>*]:border-rule" : "h-[216px] grid-cols-[1.15fr_1fr_1.2fr]",
        )}
      >
        <div className={cn(cell, bp !== "compact" && "border-r border-rule")}>
          <Boundary what="Language composition">
            <LanguageTray />
          </Boundary>
        </div>
        <div className={cn(cell, bp !== "compact" && "border-r border-rule")}>
          <Boundary what="Commit activity">
            <ActivityTray />
          </Boundary>
        </div>
        <div className={cell}>
          <Boundary what="Hotspots">
            <HotspotTray />
          </Boundary>
        </div>
      </section>
    </div>
  );
}

function RailSheet() {
  const open = useShell((s) => s.railSheetOpen);
  const setOpen = useShell((s) => s.setRailSheetOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-[280px] gap-0 border-rail-line bg-rail p-0 text-rail-ink sm:max-w-[280px] [&>button]:text-rail-ink">
        <SheetTitle className="sr-only">Drawers</SheetTitle>
        <SheetDescription className="sr-only">The project's directories. Open one to focus it.</SheetDescription>
        <Rail onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

// ─── Before the report is in ─────────────────────────────────────────────────────────────────

function LoadingPlate() {
  return (
    <div className="absolute inset-0 grid place-items-center" role="status">
      <p className="text-sm text-plate-muted">Reading the report…</p>
    </div>
  );
}

function MissingReport() {
  return (
    <div className="absolute inset-0 grid place-items-center p-10">
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold [font-stretch:85%]">No report in this folder</h1>
        <p className="mt-3 text-plate-muted">
          The viewer looks for <code className="font-mono text-plate-ink">data/report.js</code> next to this page and did not
          find it. Run <code className="font-mono text-plate-ink">starchart &lt;path&gt;</code> on a project, then open the
          folder it writes; starchart serves it for you.
        </p>
      </div>
    </div>
  );
}

function BrokenReport({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-10" role="alert">
      <div className="max-w-lg">
        <h1 className="text-2xl font-semibold [font-stretch:85%]">This report could not be opened</h1>
        <p className="mt-3 text-plate-muted">{message}</p>
        <p className="mt-3 text-plate-muted">
          Re-running <code className="font-mono text-plate-ink">starchart &lt;path&gt;</code> writes a fresh copy of both the
          data and the viewer.
        </p>
      </div>
    </div>
  );
}
