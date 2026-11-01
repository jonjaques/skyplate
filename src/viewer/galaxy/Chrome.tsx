/**
 * Plate chrome: the drawer title, the color legend, the symbol-mode legend, status notes and
 * the compact controls (layout, lanes, reset view).
 *
 * All of it is plate-styled: small, plate-ink text, plate-rule hairlines, no fills behind it,
 * so it reads as print on the glass rather than as panels floating over the galaxy. Every
 * element carries data-plate-chrome, which the label overlays read to keep clear of it.
 */

import { AlertCircle, LoaderCircle, Maximize2, Spline } from "lucide-react";
import { useMemo } from "react";
import { CATEGORY_GROUP } from "../../shared/schema";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABEL, categoryGroupColor, sequentialColor, seriesColor } from "../lib/colors";
import { formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import { useViewer, type ColorBy, type EdgeMode, type LayoutMode, type SizeBy } from "../state/store";
import type { GalaxyEngine } from "./engine";
import type { SymbolScene } from "./symbolScene";

// ─── Title ───────────────────────────────────────────────────────────────────────────────────

export function PlateTitle({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const report = engine.model.report;
  const focusDir = useViewer((s) => s.focusDir);
  const time = useViewer((s) => s.time);
  const dir = focusDir !== null ? report.dirs[focusDir] : undefined;
  const count = useMemo(() => {
    if (time === null) return dir ? dir.totalFiles : report.totals.files;
    // At a point in history: the specimens collected by then (files without a recorded
    // creation date count as always present).
    const files = dir ? engine.model.fileOrder.subarray(engine.model.dirStart[dir.id]!, engine.model.dirEnd[dir.id]!) : null;
    let c = 0;
    const n = files ? files.length : engine.n;
    for (let k = 0; k < n; k++) {
      const i = files ? files[k]! : k;
      const born = engine.model.created[i]!;
      if (Number.isNaN(born) || born <= time) c++;
    }
    return c;
  }, [engine, dir, time, report]);
  const name = dir && dir.id !== 0 ? dir.path : report.project.name;
  return (
    <h2
      data-plate-chrome
      className={cn(
        "pointer-events-none absolute z-20 max-w-[60%] truncate font-semibold text-plate-ink [font-stretch:85%]",
        compact ? "top-2.5 left-3 text-[15px]" : "top-[18px] left-6 text-2xl",
      )}
    >
      {name} <span className="text-plate-muted">·</span> <span className="figures">{formatInt(count)}</span>{" "}
      {count === 1 ? "specimen" : "specimens"}
    </h2>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────────────────────

const SEQUENTIAL_LABEL: Record<Exclude<ColorBy, "language" | "category">, [string, string, string]> = {
  churn: ["Commits", "fewest", "most"],
  age: ["Time since last change", "recent", "oldest"],
  complexity: ["Complexity", "lowest", "highest"],
  ownership: ["Top author's share of lines", "shared", "one author"],
  hotspot: ["Hotspot score", "calm", "hottest"],
  rank: ["Dependency rank", "leaf", "most depended on"],
};

const SIZE_LABEL: Record<SizeBy, string> = {
  lines: "lines",
  bytes: "bytes on disk",
  complexity: "complexity",
  commits: "commits",
  rank: "dependency rank",
};

function Swatch({ color }: { color: string }) {
  return <i className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function PlateLegend({ engine, compact, raised }: { engine: GalaxyEngine; compact: boolean; raised: boolean }) {
  const colorBy = useViewer((s) => s.colorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const report = engine.model.report;

  const items = useMemo(() => {
    if (colorBy === "language") {
      const slots = report.languages.filter((l) => l.slot >= 0).sort((a, b) => a.slot - b.slot);
      const out = slots.map((l) => ({ label: l.name, color: seriesColor(l.slot, "dark") }));
      if (report.languages.some((l) => l.slot < 0 && l.files > 0)) out.push({ label: "Other", color: seriesColor(-1, "dark") });
      return out;
    }
    if (colorBy === "category") {
      const present = new Set(report.categories.filter((c) => c.files > 0).map((c) => CATEGORY_GROUP[c.category]));
      return CATEGORY_GROUPS.filter((g) => present.has(g)).map((g) => ({ label: CATEGORY_GROUP_LABEL[g], color: categoryGroupColor(g, "dark") }));
    }
    return null;
  }, [colorBy, report]);

  return (
    <div
      data-plate-chrome
      className={cn(
        "pointer-events-none absolute left-6 z-20 flex max-w-[calc(100%-3rem)] flex-col gap-1.5 text-xs text-plate-muted",
        raised ? "bottom-[64px]" : "bottom-4",
        compact && "left-3 bottom-2.5",
      )}
    >
      {items ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {items.slice(0, compact ? 5 : 8).map((it) => (
            <span key={it.label} className="flex items-center gap-1.5">
              <Swatch color={it.color} />
              {it.label}
            </span>
          ))}
        </div>
      ) : (
        <SequentialScale mode={colorBy as Exclude<ColorBy, "language" | "category">} />
      )}
      {!compact && <span className="text-[11px] text-plate-muted/80">Star size: {SIZE_LABEL[sizeBy]}, square-root scaled</span>}
    </div>
  );
}

function SequentialScale({ mode }: { mode: Exclude<ColorBy, "language" | "category"> }) {
  const [label, low, high] = SEQUENTIAL_LABEL[mode];
  const stops = Array.from({ length: 9 }, (_, i) => sequentialColor(i / 8, "dark"));
  return (
    <div className="flex items-center gap-2">
      <span className="text-plate-ink">{label}, by percentile</span>
      <span>{low}</span>
      <span className="flex h-2 w-28">
        {stops.map((c) => (
          <i key={c} className="h-full flex-1" style={{ background: c }} />
        ))}
      </span>
      <span>{high}</span>
    </div>
  );
}

// ─── Symbol legend ───────────────────────────────────────────────────────────────────────────

function LineSample({ kind }: { kind: "call" | "other" | "callee" }) {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" className="shrink-0" aria-hidden="true">
      {kind === "call" && (
        <>
          <line x1="1" y1="4" x2="25" y2="4" stroke="#dfe8ee" strokeOpacity="0.7" />
          <circle cx="17" cy="4" r="2" fill="#ffffff" />
        </>
      )}
      {kind === "other" && <line x1="1" y1="4" x2="25" y2="4" stroke="#dfe8ee" strokeOpacity="0.6" strokeDasharray="3 3" />}
      {kind === "callee" && <line x1="1" y1="4" x2="25" y2="4" stroke="#dfe8ee" strokeOpacity="0.5" strokeDasharray="1 3" />}
    </svg>
  );
}

export function SymbolLegend({ engine, scene }: { engine: GalaxyEngine; scene: SymbolScene }) {
  const symbols = useViewer((s) => s.symbols);
  if (!symbols) return null;
  const t = symbols.symbols;
  const name = t.name[scene.symbol]!;
  const { totals } = scene;
  return (
    <div
      data-plate-chrome
      className="pointer-events-none absolute top-[58px] left-6 z-20 flex max-w-[300px] flex-col gap-1 text-xs text-plate-muted"
    >
      <p className="mb-0.5 text-plate-ink">
        <span className="font-mono">{name}</span> <span className="text-plate-muted">({t.kind[scene.symbol]})</span> reaches{" "}
        {plural(totals.files, "file")}
      </p>
      <span className="flex items-center gap-2">
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
          <circle cx="13" cy="6" r="4.5" fill="none" stroke="#ffffff" strokeWidth="1.2" />
        </svg>
        Definition, in {engine.model.report.files[scene.defFile]?.name}
      </span>
      <span className="flex items-center gap-2">
        <LineSample kind="call" /> Calls, pulsing toward the definition · <span className="figures font-mono">{formatInt(totals.calls)}</span>
      </span>
      <span className="flex items-center gap-2">
        <LineSample kind="other" /> Other uses: types, reads, imports
        {totals.implementations > 0 ? ", implementations" : ""} · <span className="figures font-mono">{formatInt(totals.other)}</span>
      </span>
      {scene.callees.length > 0 && (
        <span className="flex items-center gap-2">
          <LineSample kind="callee" /> What it calls · <span className="figures font-mono">{formatInt(scene.callees.length)}</span>{" "}
          {scene.callees.length === 1 ? "file" : "files"}
        </span>
      )}
      {totals.ripple > 0 && (
        <span className="pl-[34px]">
          Callers of callers glow dimmer, up to 3 hops · <span className="figures font-mono">{formatInt(totals.ripple)}</span> more files
        </span>
      )}
    </div>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────────

export function PlateStatus() {
  const selection = useViewer((s) => s.selection);
  const status = useViewer((s) => s.symbolsStatus);
  if (selection?.kind !== "symbol") return null;
  if (status === "loading" || status === "idle")
    return (
      <p
        data-plate-chrome
        role="status"
        className="pointer-events-none absolute top-[60px] left-6 z-20 flex items-center gap-1.5 text-xs text-plate-muted"
      >
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Reading the code-intelligence tables
      </p>
    );
  if (status === "error" || status === "absent")
    return (
      <p data-plate-chrome role="status" className="pointer-events-none absolute top-[60px] left-6 z-20 flex items-center gap-1.5 text-xs text-plate-ink">
        <AlertCircle className="size-3.5 text-serious" aria-hidden="true" />
        {status === "error" ? "The code-intelligence tables did not load, so usages cannot be drawn" : "This report has no code-intelligence tables"}
      </p>
    );
  return null;
}

// ─── Controls ────────────────────────────────────────────────────────────────────────────────

const plateToggle =
  "h-7 border border-plate-rule px-2.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink data-[state=on]:bg-plate-ink/15 data-[state=on]:text-plate-ink focus-visible:ring-plate-ink/40";

const EDGE_LABEL: Record<EdgeMode, string> = { none: "No lanes", selection: "Selected file's lanes", all: "Every import, faintly" };

export function PlateControls({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const layout = useViewer((s) => s.layout);
  const setLayout = useViewer((s) => s.setLayout);
  const edges = useViewer((s) => s.edges);
  const setEdges = useViewer((s) => s.setEdges);
  const hasImports = engine.model.report.edges.from.length > 0;

  const reset = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 border border-plate-rule text-plate-muted hover:bg-plate-ink/10 hover:text-plate-ink"
          onClick={() => engine.home(true)}
          aria-label="Reset view"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Reset view</TooltipContent>
    </Tooltip>
  );

  if (compact)
    return (
      <div data-plate-chrome className="absolute top-2 right-2 z-20">
        {reset}
      </div>
    );

  return (
    <div data-plate-chrome className="absolute top-4 right-4 z-20 flex items-center gap-2">
      <ToggleGroup
        type="single"
        value={layout}
        onValueChange={(v) => v && setLayout(v as LayoutMode)}
        aria-label="Arrange stars by"
        className="rounded-sm"
      >
        <ToggleGroupItem value="tree" className={cn(plateToggle, "rounded-l-sm")} aria-label="Arrange by directory tree">
          Tree
        </ToggleGroupItem>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The span keeps the tooltip reachable when the item is disabled. */}
            <span className="inline-flex">
              <ToggleGroupItem
                value="graph"
                disabled={!hasImports}
                className={cn(plateToggle, "rounded-r-sm border-l-0")}
                aria-label="Arrange by import graph"
              >
                Imports
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hasImports ? "Pull files that import each other together" : "No imports between files were found, so there is no graph to arrange by"}
          </TooltipContent>
        </Tooltip>
      </ToggleGroup>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 border border-plate-rule px-2.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink"
              >
                <Spline className="size-3.5" aria-hidden="true" />
                Lanes
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{EDGE_LABEL[edges]}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Import lanes on the plate</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={edges} onValueChange={(v) => setEdges(v as EdgeMode)}>
            <DropdownMenuRadioItem value="selection">For the selected file</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="all" disabled={!hasImports}>
              Every import, faintly
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {reset}
    </div>
  );
}
