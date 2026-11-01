/**
 * The top bar: the five work-area tabs, the find field (it opens the command palette), the
 * color-by and size-by encodings, and the theme.
 *
 * Tabs are shadcn's line variant redrawn to the sketch: full bar height, an ink rule under the
 * active tab, nothing else. Below 1024px the rail lives in a sheet, so a drawers button leads.
 */

import { Menu, Monitor, Moon, Palette, Ruler, Search, SlidersHorizontal, Sun } from "lucide-react";
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

export function TopBar({ bp }: { bp: Breakpoint }) {
  const setRailSheetOpen = useShell((s) => s.setRailSheetOpen);
  const sheetRail = bp === "narrow" || bp === "compact";
  const compact = bp === "compact";

  return (
    <header className="flex h-[52px] min-w-0 items-center gap-3 border-b border-rule bg-paper px-3 xl:gap-4 xl:px-5">
      {sheetRail && (
        <Button variant="ghost" size="icon-sm" aria-label="Open drawers" onClick={() => setRailSheetOpen(true)}>
          <Menu />
        </Button>
      )}
      <TabsList
        variant="line"
        className="h-full min-w-0 shrink gap-0 overflow-x-auto overflow-y-hidden rounded-none p-0 [scrollbar-width:none]"
      >
        {/* No Tooltip wrapper here: its trigger stamps its own data-state on the child, which
            overwrites the tab's data-state="active" and with it the active rule. */}
        {TAB_ORDER.map((t, i) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            title={`${t.label} (press ${i + 1})`}
            aria-keyshortcuts={String(i + 1)}
            className={cn(
              "h-full flex-none rounded-none border-0 border-b-2 border-transparent px-2.5 text-sm font-semibold text-ink-3 after:hidden xl:px-4",
              "hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink dark:data-[state=active]:border-ink",
            )}
          >
            {t.label}
            {t.id === "findings" && <FindingsCount />}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <FindButton compact={bp !== "wide"} iconOnly={compact} />
        {bp === "wide" || bp === "medium" ? (
          <>
            <ColorBySelect compact={bp === "medium"} />
            <SizeBySelect compact={bp === "medium"} />
          </>
        ) : (
          <EncodingPopover />
        )}
        <ThemeMenu />
      </div>
    </header>
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

function FindButton({ compact, iconOnly }: { compact: boolean; iconOnly: boolean }) {
  const setPaletteOpen = useViewer((s) => s.setPaletteOpen);
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label="Find a file, symbol or author" onClick={() => setPaletteOpen(true)}>
        <Search />
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md border border-input bg-paper px-2.5 text-left text-[13px] text-ink-3 transition-colors duration-150 hover:border-ink-3 hover:text-ink-2",
        compact ? "w-[124px]" : "w-[280px]",
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{compact ? "Find" : "Find a file, symbol or author"}</span>
      <Kbd className="shrink-0">{MOD_KEY === "⌘" ? "⌘K" : "Ctrl K"}</Kbd>
    </button>
  );
}

const COLOR_MODES: ColorBy[] = ["language", "category", "hotspot", "churn", "age", "complexity", "ownership", "rank"];
const SIZE_MODES: SizeBy[] = ["lines", "bytes", "complexity", "commits", "rank"];

export function ColorBySelect({ compact, className }: { compact?: boolean; className?: string }) {
  const colorBy = useViewer((s) => s.colorBy);
  const setColorBy = useViewer((s) => s.setColorBy);
  const hasGit = useViewer((s) => !!s.report?.git);
  return (
    <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)}>
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

export function SizeBySelect({ compact, className }: { compact?: boolean; className?: string }) {
  const sizeBy = useViewer((s) => s.sizeBy);
  const setSizeBy = useViewer((s) => s.setSizeBy);
  const hasGit = useViewer((s) => !!s.report?.git);
  return (
    <Select value={sizeBy} onValueChange={(v) => setSizeBy(v as SizeBy)}>
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
function EncodingPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Color and size">
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
