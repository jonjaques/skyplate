/**
 * Plate chrome: the drawer title, the filter chip, the selection's breadcrumb, the color legend,
 * the symbol-mode legend, status notes and the compact controls (layout, gravity, lanes, reset
 * view).
 *
 * All of it is plate-styled: small, plate-ink text, plate-rule hairlines. The text sits on the
 * plate's own color where stars or lanes can pass behind it (the controls, the legend inset,
 * the scrubber), which occludes them without reading as a panel, since it is the color already
 * there. Every element carries data-plate-chrome, which the label overlays read to keep clear.
 */

import { AlertCircle, Ellipsis, LoaderCircle, Maximize2, Orbit, SlidersHorizontal, X } from "lucide-react";
import { useMemo } from "react";
import { CATEGORY_GROUP, REF_KINDS, type Category, type CategoryGroup, type CodeSymbols, type RefKind } from "../../shared/schema";
import { GRAVITIES, GRAVITY_NEEDS_GIT, type Gravity } from "../../shared/web";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABEL, HOLOTYPE, categoryGroupColor, sequentialColor, seriesColor } from "../lib/colors";
import { formatInt, plural } from "../lib/format";
import { cn } from "../lib/utils";
import { COLOR_BY_HINT, COLOR_BY_LABEL, GRAVITY_HINT, GRAVITY_LABEL, NEEDS_GIT, SIZE_BY_LABEL } from "../shell/labels";
import { useHover, useViewer, type ColorBy, type EdgeMode, type Filters, type LayoutMode, type SizeBy } from "../state/store";
import { isNarrowed, passesFilters } from "./encode";
import type { GalaxyEngine } from "./engine";
import { selectionTrail, type Crumb } from "./groups";
import { LANE_INK, LANE_INK_2, selectionLanes } from "./lanes";
import { reachPhrase, type SymbolScene } from "./symbolScene";

// ─── Title ───────────────────────────────────────────────────────────────────────────────────

export function PlateTitle({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const report = engine.model.report;
  const focusDir = useViewer((s) => s.focusDir);
  const time = useViewer((s) => s.time);
  const filters = useViewer((s) => s.filters);
  const dir = focusDir !== null ? report.dirs[focusDir] : undefined;
  const narrowed = isNarrowed(filters);
  // [specimens present, of which pass the reader's filters]. A filter set on the Charts tab
  // dims the plate too, and the title used to go on counting every specimen, so nothing on
  // the Galaxy tab said the picture was narrowed.
  const [count, inView] = useMemo(() => {
    if (time === null && !narrowed) {
      const c = dir ? dir.totalFiles : report.totals.files;
      return [c, c];
    }
    // At a point in history: the specimens collected by then (files without a recorded
    // creation date count as always present).
    const files = dir ? engine.model.fileOrder.subarray(engine.model.dirStart[dir.id]!, engine.model.dirEnd[dir.id]!) : null;
    let c = 0;
    let v = 0;
    const n = files ? files.length : engine.n;
    for (let k = 0; k < n; k++) {
      const i = files ? files[k]! : k;
      const born = engine.model.created[i]!;
      if (time !== null && !Number.isNaN(born) && born > time) continue;
      c++;
      if (!narrowed || passesFilters(engine.model, i, filters)) v++;
    }
    return [c, v];
  }, [engine, dir, time, report, narrowed, filters]);
  const name = dir && dir.id !== 0 ? dir.path : report.project.name;
  return (
    <h2
      data-plate-chrome
      data-plate-inset="top"
      className={cn(
        "pointer-events-none absolute z-20 truncate font-semibold text-plate-ink [font-stretch:85%]",
        // The width left beside the controls in the top-right corner (about 330px on the full
        // plate, one 28px button on the compact one). A percentage cap ran the title under the
        // Web/Imports toggle on plates narrower than about 700px. On a narrow plate there is
        // no room beside them at all, so the title drops below them instead.
        compact
          ? "top-2.5 left-3 max-w-[calc(100%-4rem)] text-[15px]"
          : "top-[18px] left-6 max-w-[calc(100%-380px)] text-2xl @max-[640px]:top-[58px] @max-[640px]:max-w-[calc(100%-3rem)] @max-[640px]:text-xl",
      )}
    >
      {/* The name leads; the count reads as its caption, in the muted plate ink and a lighter
          weight, except the in-view figure of a filtered plate, which is the news. */}
      {name}
      <span className="font-normal text-plate-muted">
        {" · "}
        {narrowed ? (
          <>
            <span className="figures font-semibold text-plate-ink">{formatInt(inView)}</span> of{" "}
          </>
        ) : null}
        <span className="figures">{formatInt(count)}</span> {count === 1 ? "specimen" : "specimens"}
      </span>
    </h2>
  );
}

// ─── Filter chip ─────────────────────────────────────────────────────────────────────────────

function describeFilters(engine: GalaxyEngine, filters: Filters): string {
  const parts: string[] = [];
  if (filters.languages) {
    const names = [...filters.languages].map((id) => engine.model.languages.get(id)?.name ?? id);
    parts.push(names.length <= 2 ? names.join(" and ") : `${names.length} languages`);
  }
  if (filters.categories) {
    const groups = new Set([...filters.categories].map((c) => CATEGORY_GROUP[c]));
    const full = CATEGORY_GROUPS.filter((g) => groups.has(g));
    parts.push(full.length <= 2 ? full.map((g) => CATEGORY_GROUP_LABEL[g].toLowerCase()).join(" and ") : `${filters.categories.size} categories`);
  }
  const shown = parts.length > 0 ? `Showing ${parts.join(", ")} only` : "";
  const gen = filters.hideGenerated ? "generated files hidden" : "";
  return [shown, gen].filter(Boolean).join("; ").replace(/^g/, "G");
}

/**
 * What the reader has filtered to, wherever it was set (the legend here, or the Charts tab's
 * filter row), with the way back. It sits under the title, so the count beside the name and
 * the reason for the dimmed stars read together.
 */
export function PlateFilterChip({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const filters = useViewer((s) => s.filters);
  const setFilters = useViewer((s) => s.setFilters);
  if (!isNarrowed(filters)) return null;
  return (
    <div
      data-plate-chrome
      data-plate-inset="top"
      className={cn(
        "pointer-events-auto flex max-w-full items-center gap-1 rounded-sm border border-plate-rule bg-plate py-0.5 pr-0.5 pl-2 text-xs text-plate-ink",
        // On the full plate it is the first of the notes stacked under the title (GalaxyView).
        compact && "absolute top-10 left-3 z-20 max-w-[calc(100%-3rem)]",
      )}
    >
      <span className="truncate">{describeFilters(engine, filters)}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-1.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink focus-visible:ring-plate-ink/40"
        onClick={() => setFilters({ languages: null, categories: null, hideGenerated: false })}
      >
        <X className="size-3" aria-hidden="true" />
        Clear
      </Button>
    </div>
  );
}

// ─── Breadcrumb ──────────────────────────────────────────────────────────────────────────────

/** Past this many levels the middle folds into a menu: a 30-deep tree ran off the plate. */
const CRUMB_MAX = 6;
/** Levels kept visible at the deep end when the middle folds. */
const CRUMB_TAIL = 4;

/**
 * Where the selection sits in the tree, from the project down: project › packages › universe ›
 * src › file.ts. Any level can be jumped to; hovering one previews that group on the plate (its
 * envelope, its lit stars and strands) through the hover store, as a region name does.
 */
export function PlateCrumbs({ engine }: { engine: GalaxyEngine }) {
  const selection = useViewer((s) => s.selection);
  const symbols = useViewer((s) => s.symbols);
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const report = engine.model.report;
  const trail = useMemo(() => selectionTrail(report, symbols, selection), [report, symbols, selection]);
  if (trail.length < 2) return null;

  const preview = (c: Crumb | null) => setHover(c?.target && c.target.kind !== "symbol" ? c.target : null);
  const go = (c: Crumb) => {
    setHover(null);
    if (c.target) select(c.target);
    else {
      // The project crumb is "everything": nothing selected, the whole web in view.
      select(null);
      engine.home(true);
    }
  };
  const folded = trail.length > CRUMB_MAX ? trail.slice(1, trail.length - CRUMB_TAIL) : [];
  const shown: (Crumb | "fold")[] = folded.length > 0 ? [trail[0]!, "fold", ...trail.slice(-CRUMB_TAIL)] : trail;
  const last = trail.length - 1;
  const crumbClass = "max-w-[18ch] truncate rounded-xs px-1 py-px outline-none hover:bg-plate-ink/10 hover:text-plate-ink focus-visible:ring-1 focus-visible:ring-plate-ink/60";

  return (
    <nav data-plate-chrome data-plate-inset="top" aria-label="Selection path" className="pointer-events-auto max-w-full rounded-xs bg-plate py-px pr-1 text-plate-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-0.5">
        {shown.map((c, i) => {
          const sep = i > 0 && (
            <span aria-hidden="true" className="px-0.5 text-[11px] text-plate-muted/60">
              ›
            </span>
          );
          if (c === "fold")
            return (
              <li key="fold" className="flex items-center">
                {sep}
                <DropdownMenu onOpenChange={(open) => !open && preview(null)}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={cn(crumbClass, "grid h-[18px] place-items-center")} aria-label={`${plural(folded.length, "more level")}`}>
                      <Ellipsis className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    {folded.map((f) => (
                      <DropdownMenuItem key={f.target ? `${f.target.kind}:${f.target.id}` : "root"} onSelect={() => go(f)} onFocus={() => preview(f)} className="font-mono text-xs">
                        {f.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          const isLast = trail.indexOf(c) === last;
          const text = c.mono ? "font-mono text-[11px]" : "text-xs font-semibold [font-stretch:85%]";
          return (
            <li key={c.target ? `${c.target.kind}:${c.target.id}` : "root"} className="flex min-w-0 items-center">
              {sep}
              {isLast ? (
                <span aria-current="location" className={cn("max-w-[24ch] truncate px-1 py-px text-plate-ink", text)} title={c.label}>
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  className={cn(crumbClass, text)}
                  title={c.target?.kind === "dir" ? report.dirs[c.target.id]!.path : c.label}
                  onClick={() => go(c)}
                  onPointerEnter={() => preview(c)}
                  onPointerLeave={() => preview(null)}
                  onFocus={() => preview(c)}
                  onBlur={() => preview(null)}
                >
                  {c.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────────────────────

const SEQUENTIAL_LABEL: Record<Exclude<ColorBy, "language" | "category">, [string, string, string]> = {
  churn: ["Commits", "fewest", "most"],
  age: ["Time since last change", "recent", "oldest"],
  complexity: ["Complexity", "lowest", "highest"],
  ownership: ["Top author's share of lines", "shared", "one author"],
  hotspot: ["Hotspot score", "calm", "hottest"],
  // "Most depended on" names the holotype rule (direct importers); PageRank also weighs who
  // imports the importers, so it gets its own word.
  rank: ["Dependency rank", "leaf", "most central"],
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

/** One color key: its files, as language ids or categories, for previewing and filtering. */
interface LegendKey {
  label: string;
  color: string;
  languages?: Set<string>;
  categories?: Set<Category>;
}

/** A predicate for "is this file one of the key's", or null for no preview. */
export type LegendPreview = ((file: number) => boolean) | null;

function sameSet<T>(a: Set<T> | null, b: Set<T> | undefined): boolean {
  if (!a || !b || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function PlateLegend({
  engine,
  compact,
  raised,
  scene,
  onPreview,
}: {
  engine: GalaxyEngine;
  compact: boolean;
  raised: boolean;
  /** A selected symbol's neighborhood: its key joins the legend, above the color key. */
  scene: SymbolScene | null;
  /** Called as a key is hovered or focused (and with null when it is left). */
  onPreview: (preview: LegendPreview) => void;
}) {
  const colorBy = useViewer((s) => s.colorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const filters = useViewer((s) => s.filters);
  const setFilters = useViewer((s) => s.setFilters);
  const selection = useViewer((s) => s.selection);
  const edges = useViewer((s) => s.edges);
  const model = engine.model;
  const report = model.report;

  const items = useMemo<LegendKey[] | null>(() => {
    if (colorBy === "language") {
      const slots = report.languages.filter((l) => l.slot >= 0).sort((a, b) => a.slot - b.slot);
      const out: LegendKey[] = slots.map((l) => ({ label: l.name, color: seriesColor(l.slot, "dark"), languages: new Set([l.id]) }));
      const rest = report.languages.filter((l) => l.slot < 0 && l.files > 0);
      if (rest.length > 0) out.push({ label: "Other", color: seriesColor(-1, "dark"), languages: new Set(rest.map((l) => l.id)) });
      return out;
    }
    if (colorBy === "category") {
      const byGroup = new Map<CategoryGroup, Set<Category>>();
      for (const c of report.categories) {
        if (c.files === 0) continue;
        const g = CATEGORY_GROUP[c.category];
        if (!byGroup.has(g)) byGroup.set(g, new Set());
        byGroup.get(g)!.add(c.category);
      }
      return CATEGORY_GROUPS.filter((g) => byGroup.has(g)).map((g) => ({
        label: CATEGORY_GROUP_LABEL[g],
        color: categoryGroupColor(g, "dark"),
        categories: byGroup.get(g)!,
      }));
    }
    return null;
  }, [colorBy, report]);

  const shown = items?.slice(0, compact ? 5 : 8) ?? null;
  const active = (k: LegendKey) => (k.languages ? sameSet(filters.languages, k.languages) : sameSet(filters.categories, k.categories));
  const anyActive = !!shown?.some(active);
  const predicate = (k: LegendKey): LegendPreview => {
    const files = report.files;
    if (k.languages) return (i) => k.languages!.has(files[i]!.language);
    if (k.categories) return (i) => k.categories!.has(files[i]!.category);
    return null;
  };
  // Click isolates: the key becomes the language or category filter (the same one the Charts
  // tab sets, so every view narrows with it, and the chip under the title can clear it). A
  // second click on the isolated key puts everything back. Hue alone could not tell seven
  // languages apart for every reader; lighting one key's stars at a time can.
  const toggle = (k: LegendKey) => {
    onPreview(null);
    if (k.languages) setFilters({ languages: active(k) ? null : new Set(k.languages) });
    else if (k.categories) setFilters({ categories: active(k) ? null : new Set(k.categories) });
  };

  const fileLanes = !compact && selection?.kind === "file" && edges !== "none" ? selectionLanes(model, selection.id) : null;
  const showHolotypeKey = !compact && model.holotypes.size > 0 && !scene;
  const layout = useViewer((s) => s.layout);
  const gravity = useViewer((s) => s.gravity);
  const strands = engine.filaments.a.length;

  return (
    <div
      data-plate-chrome
      data-plate-inset="bottom"
      className={cn(
        // A key in the plate's margin: the plate's own fill behind it, so lanes and stars passing
        // under it never make it unreadable over a dense region, and no edge, so it reads as
        // writing on the glass rather than a panel laid over it (a bordered box was the heaviest
        // object on the plate).
        "absolute left-4 z-20 flex w-fit max-w-[calc(100%-2rem)] flex-col gap-1.5 rounded-lg bg-plate px-2 py-2 text-xs text-plate-muted",
        raised ? "bottom-[64px]" : "bottom-4",
        compact && "bottom-2.5 left-3 max-w-[calc(100%-1.5rem)] px-2 py-1.5",
      )}
    >
      {scene && !compact && <SymbolKey engine={engine} scene={scene} />}
      {scene && compact && <CompactSymbolKey scene={scene} />}
      {fileLanes && fileLanes.imports.length + fileLanes.totalImporters > 0 && <LaneKey lanes={fileLanes} />}
      {shown ? (
        <ul className="flex flex-wrap gap-x-1 gap-y-0.5" aria-label={colorBy === "language" ? "Languages: click to show one alone" : "Categories: click to show one alone"}>
          {shown.map((it) => {
            const on = active(it);
            return (
              <li key={it.label}>
                <button
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-left transition-[color,opacity] outline-none hover:text-plate-ink focus-visible:ring-1 focus-visible:ring-plate-ink/60",
                    on ? "bg-plate-ink/10 text-plate-ink" : anyActive && "opacity-55 hover:opacity-100",
                  )}
                  onPointerEnter={() => onPreview(predicate(it))}
                  onPointerLeave={() => onPreview(null)}
                  onFocus={() => onPreview(predicate(it))}
                  onBlur={() => onPreview(null)}
                  onClick={() => toggle(it)}
                  title={on ? `Show every ${colorBy}` : `Show ${it.label} alone`}
                >
                  <Swatch color={it.color} />
                  {it.label}
                </button>
              </li>
            );
          })}
          {/* The compact plate keeps five keys; the rest are named as a count rather than
              silently dropped, so the key never claims to be the whole palette. */}
          {items && items.length > shown.length && (
            <li className="flex items-center px-1.5 py-0.5 text-plate-muted" title={items.slice(shown.length).map((k) => k.label).join(", ")}>
              +{items.length - shown.length} more
            </li>
          )}
        </ul>
      ) : (
        <SequentialScale mode={colorBy as Exclude<ColorBy, "language" | "category">} />
      )}
      {!compact && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-plate-muted/90">
          {showHolotypeKey && (
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
                <circle cx="6" cy="6" r="4.6" fill="none" stroke={HOLOTYPE} strokeWidth="1.4" />
              </svg>
              Holotype: its region's most depended-on file
            </span>
          )}
          <span>Star size: {SIZE_LABEL[sizeBy]}, square-root scaled</span>
        </span>
      )}
      {!compact && layout === "web" && !scene && (
        <span className="flex flex-col gap-0.5 text-[11px] text-plate-muted/90">
          <span>
            <span className="text-plate-ink">Gravity: {GRAVITY_LABEL[gravity].toLowerCase()}.</span> {GRAVITY_MEANING[gravity]}
          </span>
          {strands > 0 && (
            <span className="flex items-center gap-1.5">
              <StrandSample />
              Strands: imports between clusters, brighter for more
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** The legend's sample of a filament: a faint, gently bowed hairline. */
function StrandSample() {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" className="shrink-0" aria-hidden="true">
      <path d="M1 6 Q13 0 25 5" fill="none" stroke={LANE_INK} strokeOpacity="0.45" />
    </svg>
  );
}

/** The key for a selected file's import lanes, with the cap spelled out when it applies. */
function LaneKey({ lanes }: { lanes: ReturnType<typeof selectionLanes> }) {
  const { imports, importers, hiddenImporters, totalImporters } = lanes;
  return (
    <span className="flex items-center gap-2">
      <LineSample kind="import" />
      <span>
        Import lanes · <span className="figures font-mono">{formatInt(imports.length)}</span> out,{" "}
        {hiddenImporters > 0 ? (
          <>
            <span className="figures font-mono">{formatInt(importers.length)}</span> of{" "}
            <span className="figures font-mono">{formatInt(totalImporters)}</span> in, most depended-on first
          </>
        ) : (
          <>
            <span className="figures font-mono">{formatInt(totalImporters)}</span> in
          </>
        )}
      </span>
    </span>
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

/** Reference kinds drawn as "other use" arcs, and how the legend names them. */
const OTHER_KIND_ORDER = ["type", "read", "write", "import", "export"] as const satisfies readonly RefKind[];
const OTHER_KIND_WORD: Record<(typeof OTHER_KIND_ORDER)[number], string> = {
  type: "types",
  read: "reads",
  write: "writes",
  import: "imports",
  export: "re-exports",
};

function LineSample({ kind }: { kind: "call" | "other" | "callee" | "implementation" | "import" | "dispatch" }) {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" className="shrink-0" aria-hidden="true">
      {kind === "call" && (
        <>
          <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK} strokeOpacity="0.7" />
          <circle cx="17" cy="4" r="2" fill="#ffffff" />
        </>
      )}
      {kind === "implementation" && (
        <>
          <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK_2} strokeOpacity="0.85" strokeWidth="1.2" />
          <circle cx="8" cy="4" r="1.6" fill={LANE_INK_2} />
        </>
      )}
      {kind === "import" && (
        <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK} strokeOpacity="0.7" strokeDasharray="6 3" />
      )}
      {kind === "other" && <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK} strokeOpacity="0.6" strokeDasharray="3 3" />}
      {kind === "callee" && <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK} strokeOpacity="0.5" strokeDasharray="1 3" />}
      {/* A call's line at the strength the plate draws it, with no pulse riding it. */}
      {kind === "dispatch" && <line x1="1" y1="4" x2="25" y2="4" stroke={LANE_INK} strokeOpacity="0.38" />}
    </svg>
  );
}

/**
 * The key for a selected symbol's neighborhood. It lives in the legend slot at the plate's foot
 * rather than under the title: up there it sat on top of the arcs, which bow toward the top of
 * the plate (see bowNormal), and the framing keeps the foot clear anyway.
 */
function SymbolKey({ engine, scene }: { engine: GalaxyEngine; scene: SymbolScene }) {
  const symbols = useViewer((s) => s.symbols);
  if (!symbols) return null;
  const t = symbols.symbols;
  const name = t.name[scene.symbol]!;
  const { totals, own } = scene;
  const arcCalls = totals.calls - own.calls;
  const arcOther = totals.other - own.other;
  const implElsewhere = scene.arcs.filter((a) => a.implementation).length;
  // The kinds the dashed arcs actually carry, largest first: a type alias's uses are types and
  // imports, and calling them "types, reads, imports" claimed reads that were never there.
  // (Computed inline, not memoized: this runs after an early return, and it is a few hundred adds.)
  const sum = new Array<number>(REF_KINDS.length).fill(0);
  for (const a of scene.arcs) for (let k = 0; k < REF_KINDS.length; k++) sum[k] = sum[k]! + a.kinds[k]!;
  const otherKinds = OTHER_KIND_ORDER.filter((k) => sum[REF_KINDS.indexOf(k)]! > 0)
    .sort((a, b) => sum[REF_KINDS.indexOf(b)]! - sum[REF_KINDS.indexOf(a)]!)
    .slice(0, 3)
    .map((k) => OTHER_KIND_WORD[k])
    .join(", ");
  const n = (v: number) => <span className="figures font-mono">{formatInt(v)}</span>;
  const files = (v: number) => (
    <>
      {n(v)} {v === 1 ? "file" : "files"}
    </>
  );
  const tests = totals.tests + totals.dispatchTests;
  const hostKinds = hostExtensions(engine, scene);
  const bases = [...new Set(scene.dispatch.map((d) => d.base))].map((b) => qualifiedName(symbols, b)).join(", ");
  // Rows with nothing to show are left out: a type alias's "Calls · 0" and an interface's
  // pulse legend described lines that were never drawn.
  return (
    <div className="mb-1 flex max-w-[360px] flex-col gap-1">
      <p className="mb-0.5 text-plate-ink">
        <span className="font-mono">{name}</span> <span className="text-plate-muted">({t.kind[scene.symbol]})</span>{" "}
        {scene.typeLevel || !scene.callable ? "is used in" : "reaches"} {reachPhrase(totals)}
        {/* reachPhrase counts dispatch files too; saying so keeps this figure from disagreeing
            with the record's Files cell, which counts only files that name the symbol. */}
        {scene.dispatch.length > 0 && <span className="text-plate-muted">, including through the {scene.through}</span>}
      </p>
      <span className="flex items-center gap-2">
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
          <circle cx="13" cy="6" r="4.5" fill="none" stroke="#ffffff" strokeWidth="1.2" />
        </svg>
        Definition, in {engine.model.report.files[scene.defFile]?.name}
      </span>
      {arcCalls > 0 ? (
        <span className="flex items-center gap-2">
          <LineSample kind="call" /> Calls, pulsing toward the definition · {n(arcCalls)}
          {own.calls > 0 && <> (+{n(own.calls)} in its own file)</>}
        </span>
      ) : own.calls > 0 ? (
        <span className="pl-[34px]">
          {plural(own.calls, "call")}, all in its own file
        </span>
      ) : null}
      {totals.implementations > 0 && (
        <span className="flex items-center gap-2">
          <LineSample kind="implementation" /> Implementations · {n(implElsewhere)} {implElsewhere === 1 ? "file" : "files"}
          {own.impl > 0 && <>, and in its own file</>}
        </span>
      )}
      {arcOther > 0 && (
        <span className="flex items-center gap-2">
          {/* These count references; the record's "Other uses" counts symbols. Sharing the
              label made 12 here and 3 there look like a contradiction. */}
          <LineSample kind="other" /> {scene.callable || arcCalls > 0 ? "Other references" : "References"}: {otherKinds} · {n(arcOther)}
        </span>
      )}
      {totals.host > 0 && (
        <span className="flex items-center gap-2" title="Imports read from script blocks the TypeScript checker does not open">
          <LineSample kind="other" /> Imports from {hostKinds}, read outside the checker · {files(totals.host)}
        </span>
      )}
      {scene.dispatch.length > 0 && (
        <span className="flex items-center gap-2" title={`Callers of ${bases}, which this ${scene.through === "base method" ? "overrides" : "implements"}`}>
          <LineSample kind="dispatch" /> Through the {scene.through} · {files(scene.dispatch.length)}
        </span>
      )}
      {scene.callees.length > 0 && (
        <span className="flex items-center gap-2">
          <LineSample kind="callee" /> What it calls · {n(scene.callees.length)} {scene.callees.length === 1 ? "file" : "files"}
        </span>
      )}
      {totals.ripple > 0 && (
        <span className="pl-[34px]">
          Callers of its callers glow dimmer, up to 3 hops · {n(totals.ripple)} more {totals.ripple === 1 ? "file" : "files"}
        </span>
      )}
      {tests > 0 && tests < totals.files + totals.dispatch && <span className="pl-[34px]">Arcs and stars from tests are drawn fainter</span>}
    </div>
  );
}

/** "Vue and Markdown": the kinds of file a symbol's host imports come from, for the legend. */
function hostExtensions(engine: GalaxyEngine, scene: SymbolScene): string {
  const files = engine.model.report.files;
  const names: string[] = [];
  for (const a of scene.arcs) {
    if (a.host === 0) continue;
    const f = files[a.file]!;
    const name = engine.model.languages.get(f.language)?.name ?? (f.ext ? `.${f.ext}` : f.name);
    if (!names.includes(name)) names.push(name);
  }
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and other`;
}

/** "SaveStore.read" for a member, the bare name otherwise (as the record writes it). */
function qualifiedName(symbols: CodeSymbols, s: number): string {
  const t = symbols.symbols;
  const p = t.parent[s]!;
  return p >= 0 && t.kind[p] !== "module" ? `${t.name[p]}.${t.name[s]}` : t.name[s]!;
}

/**
 * The Source tab's side plate has room for one line, and it is where a reader digging into a
 * definition actually is: what is lit, how many files, what the line style means.
 */
function CompactSymbolKey({ scene }: { scene: SymbolScene }) {
  const { totals } = scene;
  const parts = [reachPhrase(totals)];
  if (totals.calls > 0) parts.push(plural(totals.calls, "call"));
  if (totals.implementations > 0) parts.push(plural(totals.implementations, "implementation"));
  if (totals.dispatch > 0) parts.push(`${formatInt(totals.dispatch)} through the ${scene.through}`);
  if (totals.ripple > 0) parts.push(`${formatInt(totals.ripple)} ripple`);
  return (
    <span className="flex items-center gap-2 text-plate-ink">
      <LineSample kind={totals.calls > 0 ? "call" : totals.implementations > 0 ? "implementation" : "other"} />
      <span className="truncate">{parts.join(" · ")}</span>
    </span>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────────

/** A note on the code-intelligence tables, last of the notes stacked under the title (GalaxyView). */
export function PlateStatus() {
  const selection = useViewer((s) => s.selection);
  const status = useViewer((s) => s.symbolsStatus);
  if (selection?.kind !== "symbol") return null;
  if (status === "loading" || status === "idle")
    return (
      <p data-plate-chrome role="status" className="flex items-center gap-1.5 text-xs text-plate-muted">
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Reading the code-intelligence tables
      </p>
    );
  if (status === "error" || status === "absent")
    return (
      <p data-plate-chrome role="status" className="flex items-center gap-1.5 text-xs text-plate-ink">
        <AlertCircle className="size-3.5 text-serious" aria-hidden="true" />
        {status === "error" ? "The code-intelligence tables did not load, so usages cannot be drawn" : "This report has no code-intelligence tables"}
      </p>
    );
  return null;
}

// ─── Controls ────────────────────────────────────────────────────────────────────────────────

/** Plate buttons: plate-ink on the plate's glass, a hairline edge, a 10% plate-ink hover. */
// Focus on the plate is plate ink: the shell's ring (ink 2) is a dark slate in the light theme,
// which all but disappears against the dark glass.
const plateButton =
  "h-7 gap-1.5 rounded-md border border-plate-rule bg-plate px-2.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink focus-visible:border-plate-ink focus-visible:ring-plate-ink/40 disabled:opacity-45";
const plateToggle =
  "h-[26px] rounded-[5px] border-0 px-2.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink data-[state=on]:bg-plate-ink/15 data-[state=on]:text-plate-ink focus-visible:outline-plate-ink focus-visible:ring-plate-ink/40";

const EDGE_LABEL: Record<EdgeMode, string> = { none: "None", selection: "Selected file", all: "Every import, faintly" };
const COLOR_MODES: ColorBy[] = ["language", "category", "hotspot", "churn", "age", "complexity", "ownership", "rank"];
const SIZE_MODES: SizeBy[] = ["lines", "bytes", "complexity", "commits", "rank"];

/** The legend's reading of the current gravity, after "Gravity: <mode>." */
const GRAVITY_MEANING: Record<Gravity, string> = {
  dependencies: "Files many others import sink to the core of their clump.",
  complexity: "The most complex files sink to the core of their clump.",
  hotspots: "Complex, often-changed files sink to the core of their clump.",
  churn: "The most-committed files sink to the core of their clump.",
  recent: "Recently changed files sink to the core of their clump.",
  size: "The largest files sink to the core of their clump.",
};

export function PlateControls({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const layout = useViewer((s) => s.layout);
  const setLayout = useViewer((s) => s.setLayout);
  const gravity = useViewer((s) => s.gravity);
  const setGravity = useViewer((s) => s.setGravity);
  const edges = useViewer((s) => s.edges);
  const setEdges = useViewer((s) => s.setEdges);
  const hasImports = engine.model.report.edges.from.length > 0;
  const hasGit = !!engine.model.report.git;

  const reset = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn(plateButton, "size-7 px-0")} onClick={() => engine.home(true)} aria-label="Reset view">
          <Maximize2 className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Reset view</TooltipContent>
    </Tooltip>
  );

  if (compact)
    return (
      <div data-plate-chrome data-plate-inset="top" className="absolute top-2 right-2 z-20 rounded-sm bg-plate">
        {reset}
      </div>
    );

  return (
    // bg-plate: zoomed in on a hub, stars pass behind the corner and the unfilled buttons
    // read as "Web" written over a star field. The plate's own color occludes them without
    // drawing a panel, since it is the color already there.
    <div data-plate-chrome data-plate-inset="top" className="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-sm bg-plate">
      <ToggleGroup
        type="single"
        value={layout}
        onValueChange={(v) => v && setLayout(v as LayoutMode)}
        aria-label="Arrange stars by"
        className="gap-0.5 rounded-md border border-plate-rule bg-plate p-px"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ToggleGroupItem value="web" className={plateToggle} aria-label="Arrange as a web of the directory tree">
                Web
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Directories as clusters, strung together by their imports</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The span keeps the tooltip reachable when the item is disabled. */}
            <span className="inline-flex">
              <ToggleGroupItem
                value="graph"
                disabled={!hasImports}
                className={plateToggle}
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
            {/* The span keeps the tooltip reachable while the trigger is disabled. */}
            <span className="inline-flex">
              <DropdownMenuTrigger asChild disabled={layout !== "web"}>
                <Button variant="ghost" size="sm" className={plateButton} aria-label={`Gravity: ${GRAVITY_LABEL[gravity]}`}>
                  <Orbit className="size-3.5" aria-hidden="true" />
                  Gravity
                </Button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {layout === "web"
              ? `What has mass: ${GRAVITY_LABEL[gravity].toLowerCase()}`
              : "Gravity shapes the web; the import graph places files by their imports alone"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">What has mass in the web</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={gravity} onValueChange={(v) => setGravity(v as Gravity)}>
            {GRAVITIES.map((g) => {
              const needsGit = GRAVITY_NEEDS_GIT.has(g) && !hasGit;
              return (
                <DropdownMenuRadioItem key={g} value={g} disabled={needsGit} className="flex-col items-start gap-0">
                  <span>{GRAVITY_LABEL[g]}</span>
                  <span className="text-xs text-muted-foreground">{needsGit ? "Needs git history, which this report lacks" : GRAVITY_HINT[g]}</span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          {/* The group half of gravity, which the legend's one line leaves out. */}
          <p className="border-t border-rule px-2 pt-2 pb-1 text-xs leading-snug text-muted-foreground">
            Heavy files sink to the core of their clump, and heavy groups draw toward the heart of their cluster.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <DisplayOptions engine={engine} edges={edges} setEdges={setEdges} hasImports={hasImports} />

      {reset}
    </div>
  );
}

/**
 * Display: how stars are colored and sized, and which import lanes are drawn. These used to be
 * the top bar's two labeled selects, but they only ever applied to the plate, so they live on
 * it now, beside Gravity, behind one button: a popover of three rows, each a select whose items
 * say what the mode measures (and which need git history this report may lack). A popover, not
 * a menu, because each row is a choice of its own; it is a role=dialog, which the plate's click
 * rules already treat as an open overlay (GalaxyView overlayOpen), so dismissing it never selects
 * the star under the pointer.
 */
function DisplayOptions({
  engine,
  edges,
  setEdges,
  hasImports,
}: {
  engine: GalaxyEngine;
  edges: EdgeMode;
  setEdges(e: EdgeMode): void;
  hasImports: boolean;
}) {
  const colorBy = useViewer((s) => s.colorBy);
  const setColorBy = useViewer((s) => s.setColorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const setSizeBy = useViewer((s) => s.setSizeBy);
  const hasGit = !!engine.model.report.git;
  const row = "grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3";
  const label = "text-xs font-medium text-ink-3";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={plateButton} aria-label={`Display: color by ${COLOR_BY_LABEL[colorBy]}, size by ${SIZE_BY_LABEL[sizeBy]}`}>
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              Display
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Color by {COLOR_BY_LABEL[colorBy].toLowerCase()}, size by {SIZE_BY_LABEL[sizeBy].toLowerCase()}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[300px] flex-col gap-2.5 p-3">
        <p className="text-[13px] font-semibold text-ink">Display</p>
        <label className={row}>
          <span className={label}>Color</span>
          <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)}>
            <SelectTrigger size="sm" aria-label="Color stars by" className="w-full bg-paper">
              {/* Explicit children: the items carry a second line the trigger must not repeat. */}
              <SelectValue>{COLOR_BY_LABEL[colorBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end" className="w-[248px]">
              {COLOR_MODES.map((m) => {
                const off = !hasGit && NEEDS_GIT.has(m);
                return (
                  <SelectItem key={m} value={m} disabled={off} textValue={COLOR_BY_LABEL[m]}>
                    <span className="flex flex-col">
                      <span>{COLOR_BY_LABEL[m]}</span>
                      <span className="text-xs text-ink-3">{off ? "Needs git history" : COLOR_BY_HINT[m]}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </label>
        <label className={row}>
          <span className={label}>Size</span>
          <Select value={sizeBy} onValueChange={(v) => setSizeBy(v as SizeBy)}>
            <SelectTrigger size="sm" aria-label="Size stars by" className="w-full bg-paper">
              <SelectValue>{SIZE_BY_LABEL[sizeBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {SIZE_MODES.map((m) => (
                <SelectItem key={m} value={m} disabled={!hasGit && NEEDS_GIT.has(m)}>
                  {SIZE_BY_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={row}>
          <span className={label}>Lanes</span>
          <Select value={edges} onValueChange={(v) => setEdges(v as EdgeMode)}>
            <SelectTrigger size="sm" aria-label="Import lanes on the plate" className="w-full bg-paper">
              <SelectValue>{EDGE_LABEL[edges]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="selection">{EDGE_LABEL.selection}</SelectItem>
              <SelectItem value="all" disabled={!hasImports}>
                {EDGE_LABEL.all}
              </SelectItem>
              <SelectItem value="none">{EDGE_LABEL.none}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs leading-snug text-ink-3">Gravity, beside this, chooses which files sink to the center of their cluster.</p>
      </PopoverContent>
    </Popover>
  );
}

// ─── Plate marks ─────────────────────────────────────────────────────────────────────────────

/** One registration mark: an L of two short hairlines, turned to face its corner. */
function Corner({ className, rotate }: { className: string; rotate: number }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" className={cn("absolute", className)} style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M0.5 10.5V0.5H10.5" fill="none" stroke="var(--color-plate-ink)" strokeOpacity="0.28" />
    </svg>
  );
}

/**
 * What marks the plate as a plate: registration marks in its four corners, the way a
 * photographic plate's corners are marked for the measuring engine, and its inscription, the
 * plate number and date written on the glass. The number is the commit the report was measured
 * at and the date is when it was taken, so the inscription is a fact about the plate, not
 * decoration; it repeats what the rail says, so it is hidden from assistive tech.
 *
 * The corners sit inside the 16px the controls and the title keep from the edges, and above the
 * scrubber when there is one. The inscription takes the bottom-right margin, opposite the
 * legend, and carries data-plate-chrome so specimen labels keep off it; it claims no framing
 * inset, so the camera frames the web as before. Narrow plates drop it, where the legend takes
 * the whole width.
 */
export function PlateMarks({ engine, compact, raised }: { engine: GalaxyEngine; compact: boolean; raised: boolean }) {
  const report = engine.model.report;
  const git = report.git;
  const bottom = raised ? 52 : 0;
  // The reader's local calendar date, as the rail and About print it (labels.ts
  // generatedParts): the ISO string's first ten characters are the UTC date, which said
  // "2026-11-04" under a rail that said "Nov 3" for a report written late in the evening.
  const at = new Date(report.generatedAt);
  const taken = Number.isNaN(at.getTime())
    ? report.generatedAt.slice(0, 10)
    : `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10" style={{ bottom }}>
        <Corner className="top-[5px] left-[5px]" rotate={0} />
        <Corner className="top-[5px] right-[5px]" rotate={90} />
        <Corner className="right-[5px] bottom-[5px]" rotate={180} />
        <Corner className="bottom-[5px] left-[5px]" rotate={270} />
      </div>
      {!compact && (
        <p
          data-plate-chrome
          aria-hidden="true"
          className="pointer-events-none absolute right-5 z-20 flex items-baseline gap-2 bg-plate px-1 text-[10.5px] text-plate-muted/75 @max-[640px]:hidden"
          style={{ bottom: bottom + 12 }}
        >
          <span className="font-semibold tracking-[0.08em] uppercase [font-stretch:80%]">Plate</span>
          <span className="figures font-mono">{git ? git.head.slice(0, 7) : "no git"}</span>
          {git && <span className="max-w-[16ch] truncate font-mono">{git.branch}</span>}
          <span className="figures font-mono">{taken}</span>
        </p>
      )}
    </>
  );
}
