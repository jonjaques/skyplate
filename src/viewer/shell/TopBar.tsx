/**
 * The top bar: the five work-area tabs, the find field (it opens the command palette), the
 * color-by and size-by encodings, and the theme.
 *
 * Tabs are shadcn's line variant redrawn to the sketch: full bar height, an ink rule under the
 * active tab, nothing else. Below 1024px the rail lives in a sheet, so a drawers button leads.
 */

import { Menu, Monitor, Moon, Palette, Ruler, Search, SlidersHorizontal, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Severity } from "../../shared/schema";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Kbd } from "../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import { useViewer, type ColorBy, type SizeBy, type Tab, type ThemePref } from "../state/store";
import { COLOR_BY_HINT, COLOR_BY_LABEL, NEEDS_GIT, SEVERITY_LABEL, SEVERITY_ORDER, SIZE_BY_LABEL } from "./labels";
import type { Breakpoint } from "./media";
import { SeverityIcon } from "./parts";
import { useShell } from "./shell-state";

export const TAB_ORDER: { id: Tab; label: string }[] = [
  { id: "galaxy", label: "Galaxy" },
  { id: "charts", label: "Charts" },
  { id: "explorer", label: "Explorer" },
  { id: "source", label: "Source" },
  { id: "findings", label: "Findings" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/**
 * `ready` is false until a report is indexed (and stays false when it is missing or broken):
 * the tabs, find and encodings have nothing to act on then, so they render disabled instead of
 * opening an empty palette. The theme menu works either way.
 */
export function TopBar({ bp, ready = true }: { bp: Breakpoint; ready?: boolean }) {
  const setRailSheetOpen = useShell((s) => s.setRailSheetOpen);
  const sheetRail = bp === "narrow" || bp === "compact";
  const compact = bp === "compact";
  const tab = useViewer((s) => s.tab);
  const tabs = useRef<HTMLDivElement>(null);

  // Wherever the tab list can scroll sideways, a tab picked by number key, a link or an "Open
  // in source reader" button could be the one scrolled out of sight, leaving the bar with no
  // visible active tab. Bring it into view whenever it changes.
  useEffect(() => {
    tabs.current
      ?.querySelector<HTMLElement>("[data-state=active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [tab]);

  const drawers = sheetRail && (
    <Button variant="ghost" size="icon-sm" aria-label="Open drawers" disabled={!ready} onClick={() => setRailSheetOpen(true)}>
      <Menu />
    </Button>
  );

  // Below 768px the five tabs get a full-width row of their own. Sharing one row with the
  // drawers, find, encoding and theme buttons left a phone room for three of them: Source and
  // Findings sat in a sideways scroller with no visible scrollbar, unreachable unless the
  // reader guessed to swipe the tab labels. Icon-only tabs were the other option, but five
  // glyphs for galaxy/charts/explorer/source/findings are guesswork without their words.
  if (compact) {
    return (
      <header className="min-w-0 border-b border-rule bg-paper">
        <div className="flex h-[52px] min-w-0 items-center gap-2 px-3">
          {drawers}
          <ProjectName />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <FindButton compact iconOnly disabled={!ready} />
            <EncodingPopover disabled={!ready} />
            <ThemeMenu />
          </div>
        </div>
        <TabsList ref={tabs} variant="line" className="flex h-10 w-full justify-stretch gap-0 rounded-none border-t border-rule p-0">
          {TAB_ORDER.map((t, i) => (
            <TabTrigger key={t.id} id={t.id} label={t.label} index={i} ready={ready} className="flex-auto px-1.5 text-[13px]" />
          ))}
        </TabsList>
      </header>
    );
  }

  return (
    <header className="@container flex h-[52px] min-w-0 items-center gap-3 border-b border-rule bg-paper px-3 xl:gap-4 xl:px-5">
      {drawers}
      {/* justify-start overrides shadcn's justify-center: centered flex content that overflows
          spills past the left edge too, where no scroll position can reach it, so the first
          tab (Galaxy) was unreachable in a narrow bar. */}
      <TabsList
        ref={tabs}
        variant="line"
        className="h-full min-w-0 shrink justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-none p-0 [scrollbar-width:none]"
      >
        {TAB_ORDER.map((t, i) => (
          <TabTrigger key={t.id} id={t.id} label={t.label} index={i} ready={ready} className="flex-none px-2.5 text-sm xl:px-4" />
        ))}
      </TabsList>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <FindButton compact={bp !== "wide"} iconOnly={false} disabled={!ready} />
        {bp === "wide" || bp === "medium" ? (
          <>
            <ColorBySelect compact={bp === "medium"} disabled={!ready} />
            <SizeBySelect compact={bp === "medium"} disabled={!ready} />
          </>
        ) : (
          <EncodingPopover disabled={!ready} />
        )}
        <ThemeMenu />
      </div>
    </header>
  );
}

/**
 * One work-area tab. No Tooltip wrapper: its trigger stamps its own data-state on the child,
 * which overwrites the tab's data-state="active" and with it the active rule.
 */
function TabTrigger({ id, label, index, ready, className }: { id: Tab; label: string; index: number; ready: boolean; className?: string }) {
  return (
    <TabsTrigger
      value={id}
      disabled={!ready}
      title={`${label} (press ${index + 1})`}
      aria-keyshortcuts={String(index + 1)}
      className={cn(
        "h-full rounded-none border-0 border-b-2 border-transparent font-semibold text-ink-3 after:hidden",
        "hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-ink",
        className,
      )}
    >
      {label}
      {id === "findings" && <FindingsCount />}
    </TabsTrigger>
  );
}

/** On a phone the rail (and with it the project's name) lives in a sheet; the bar names it. */
function ProjectName() {
  const name = useViewer((s) => s.report?.project.name);
  return (
    <span className="min-w-0 truncate text-[15px] leading-none font-bold [font-stretch:80%]" title={name}>
      {name ?? "starchart"}
    </span>
  );
}

/** The findings count with the icon of the most severe one: icon plus number, never color alone. */
function FindingsCount() {
  const findings = useViewer((s) => s.report?.findings);
  if (!findings || findings.length === 0) return null;
  const worst: Severity = SEVERITY_ORDER.find((sev) => findings.some((f) => f.severity === sev)) ?? "info";
  return (
    <span className="ml-1.5 inline-flex items-center gap-1" aria-label={`${findings.length}, most severe: ${SEVERITY_LABEL[worst]}`}>
      <SeverityIcon severity={worst} className="size-3.5" />
      <span className="figures font-mono text-xs font-medium">{findings.length}</span>
    </span>
  );
}

function FindButton({ compact, iconOnly, disabled }: { compact: boolean; iconOnly: boolean; disabled?: boolean }) {
  const setPaletteOpen = useViewer((s) => s.setPaletteOpen);
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label="Find a file, symbol or author" disabled={disabled} onClick={() => setPaletteOpen(true)}>
        <Search />
      </Button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setPaletteOpen(true)}
      aria-label="Find a file, symbol or author"
      className={cn(
        "flex h-8 items-center gap-2 rounded-md border border-input bg-paper px-2.5 text-left text-[13px] text-ink-3 transition-colors duration-150 hover:border-ink-3 hover:text-ink-2 disabled:pointer-events-none disabled:opacity-50",
        // The wide layout starts at a 1280px window, where the bar is only 1020px: the full
        // field plus both labeled selects pushed the Findings tab out of the scrolling tab
        // list, out of sight. So the long form waits until the bar itself has room for it.
        compact ? "w-[124px]" : "w-[124px] @min-[1140px]:w-[280px]",
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0" />
      {compact ? (
        <span className="min-w-0 flex-1 truncate">Find</span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate @min-[1140px]:hidden">Find</span>
          <span className="hidden min-w-0 flex-1 truncate @min-[1140px]:inline">Find a file, symbol or author</span>
        </>
      )}
      <Kbd className="shrink-0">{MOD_KEY === "⌘" ? "⌘K" : "Ctrl K"}</Kbd>
    </button>
  );
}

const COLOR_MODES: ColorBy[] = ["language", "category", "hotspot", "churn", "age", "complexity", "ownership", "rank"];
const SIZE_MODES: SizeBy[] = ["lines", "bytes", "complexity", "commits", "rank"];

export function ColorBySelect({ compact, className, disabled }: { compact?: boolean; className?: string; disabled?: boolean }) {
  const colorBy = useViewer((s) => s.colorBy);
  const setColorBy = useViewer((s) => s.setColorBy);
  const hasGit = useViewer((s) => !!s.report?.git);
  return (
    <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label="Color stars by" className={cn("gap-1.5 bg-paper", compact ? "w-[124px]" : "w-[172px]", className)}>
        <Palette aria-hidden className="size-3.5 text-ink-3" />
        {!compact && <span className="text-ink-3">Color</span>}
        {/* Explicit children: the items carry a second line the trigger must not repeat. */}
        <SelectValue>{COLOR_BY_LABEL[colorBy]}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="w-[248px]">
        {COLOR_MODES.map((m) => {
          const disabled = !hasGit && NEEDS_GIT.has(m);
          return (
            <SelectItem key={m} value={m} disabled={disabled} textValue={COLOR_BY_LABEL[m]}>
              <span className="flex flex-col">
                <span>{COLOR_BY_LABEL[m]}</span>
                <span className="text-xs text-ink-3">{disabled ? "Needs git history" : COLOR_BY_HINT[m]}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function SizeBySelect({ compact, className, disabled }: { compact?: boolean; className?: string; disabled?: boolean }) {
  const sizeBy = useViewer((s) => s.sizeBy);
  const setSizeBy = useViewer((s) => s.setSizeBy);
  const hasGit = useViewer((s) => !!s.report?.git);
  return (
    <Select value={sizeBy} onValueChange={(v) => setSizeBy(v as SizeBy)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label="Size stars by" className={cn("gap-1.5 bg-paper", compact ? "w-[108px]" : "w-[148px]", className)}>
        <Ruler aria-hidden className="size-3.5 text-ink-3" />
        {!compact && <span className="text-ink-3">Size</span>}
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
  );
}

/** Below 1024px the two encodings fold into one popover so the tabs keep their room. */
function EncodingPopover({ disabled }: { disabled?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Color and size" disabled={disabled}>
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Color stars by
          <ColorBySelect className="w-full" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Size stars by
          <SizeBySelect className="w-full" />
        </label>
      </PopoverContent>
    </Popover>
  );
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function ThemeMenu() {
  const theme = useViewer((s) => s.theme);
  const setTheme = useViewer((s) => s.setTheme);
  const Icon = THEME_ICON[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Theme: ${theme}`}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs font-normal text-ink-3">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePref)}>
          <DropdownMenuRadioItem value="system">Match system</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
