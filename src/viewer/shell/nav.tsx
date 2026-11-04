/**
 * Navigation pieces shared by the rail (1024px and wider) and the slim top bar (narrower): the
 * five work-area views, find, the theme, and the findings count.
 *
 * Why the views live in the rail and not in a top bar: the old bar was a second, separate strip
 * of controls (underlined tabs at one end, find, two labeled selects and the theme at the
 * other) that cost the plate 52px of height and read as a form toolbar, and the color and size
 * selects only ever applied to the plate. The plate now carries its own encodings (Display, in
 * galaxy/Chrome.tsx), and every way to move around the report, views, find and drawers, sits in
 * one column under the brand. Below 1024px the rail is a sheet, so the bar comes back, slimmer.
 */

import { ChartColumnBig, FileCode2, Lightbulb, Monitor, Moon, Rows3, Search, Sun, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
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
import { TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import { useViewer, type Tab, type ThemePref } from "../state/store";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "./labels";
import { SeverityIcon } from "./parts";

/**
 * The plate view's icon: the brand mark's plate (the notched glass square) in lucide's 24-unit
 * grid and 2-unit stroke, with one star on it, so it sits beside the lucide icons of the other
 * views as one family.
 */
function PlateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M5 3h9l7 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <circle cx="10" cy="14" r="2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="15.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/**
 * The views, in key order (1-5). "Plate" rather than "Galaxy": the view is the plate the whole
 * product is named for, and it is what the rest of the interface already called it.
 */
export const TAB_ORDER: { id: Tab; label: string; icon: LucideIcon | ComponentType<{ className?: string }> }[] = [
  { id: "galaxy", label: "Plate", icon: PlateIcon },
  { id: "charts", label: "Charts", icon: ChartColumnBig },
  { id: "explorer", label: "Explorer", icon: Rows3 },
  { id: "source", label: "Source", icon: FileCode2 },
  { id: "findings", label: "Findings", icon: Lightbulb },
];

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
export const FIND_KEY = isMac ? "⌘K" : "Ctrl K";

/**
 * One view in the rail's vertical list: icon, label, and at the right either its number key
 * (shown on hover and focus, so the rail is not a column of digits at rest) or, for Findings,
 * the count. No Tooltip wrapper: its trigger stamps its own data-state on the child, which
 * overwrites the tab's data-state="active" and with it the active look.
 */
export function RailViewTrigger({ id, ready }: { id: Tab; ready: boolean }) {
  const index = TAB_ORDER.findIndex((t) => t.id === id);
  const view = TAB_ORDER[index]!;
  const Icon = view.icon;
  return (
    <TabsTrigger
      value={id}
      disabled={!ready}
      title={`${view.label} (press ${index + 1})`}
      aria-keyshortcuts={String(index + 1)}
      className={cn(
        "group/view h-8 flex-none justify-start gap-2.5 rounded-md border border-transparent px-2.5 text-[13.5px] font-medium text-ink-2 shadow-none transition-colors duration-150",
        "hover:bg-wash hover:text-ink",
        "data-[state=active]:border-rule data-[state=active]:bg-paper data-[state=active]:text-ink",
        "dark:text-ink-2 dark:hover:text-ink dark:data-[state=active]:border-rule dark:data-[state=active]:bg-wash dark:data-[state=active]:text-ink",
      )}
    >
      <Icon className="size-4 shrink-0 text-ink-3 transition-colors group-hover/view:text-ink-2 group-data-[state=active]/view:text-ink" />
      <span className="min-w-0 flex-1 truncate text-left">{view.label}</span>
      {id === "findings" ? (
        <FindingsCount />
      ) : (
        <span aria-hidden className="figures font-mono text-[11px] text-ink-3 opacity-0 transition-opacity group-hover/view:opacity-100 group-focus-visible/view:opacity-100">
          {index + 1}
        </span>
      )}
    </TabsTrigger>
  );
}

/** One view in the slim top bar: a segment of a pill control. */
export function BarViewTrigger({ id, ready, className }: { id: Tab; ready: boolean; className?: string }) {
  const index = TAB_ORDER.findIndex((t) => t.id === id);
  const view = TAB_ORDER[index]!;
  return (
    <TabsTrigger
      value={id}
      disabled={!ready}
      title={`${view.label} (press ${index + 1})`}
      aria-keyshortcuts={String(index + 1)}
      className={cn(
        "h-7 flex-none rounded-[5px] border border-transparent px-2.5 text-[13px] font-semibold text-ink-3 shadow-none",
        "hover:text-ink data-[state=active]:border-rule data-[state=active]:bg-paper data-[state=active]:text-ink",
        "dark:text-ink-3 dark:data-[state=active]:border-rule dark:data-[state=active]:bg-wash dark:data-[state=active]:text-ink",
        className,
      )}
    >
      {view.label}
      {id === "findings" && <FindingsCount />}
    </TabsTrigger>
  );
}

/** The findings count with the icon of the most severe one: icon plus number, never color alone. */
export function FindingsCount() {
  const findings = useViewer((s) => s.report?.findings);
  if (!findings || findings.length === 0) return null;
  const worst: Severity = SEVERITY_ORDER.find((sev) => findings.some((f) => f.severity === sev)) ?? "info";
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1" aria-label={`${findings.length}, most severe: ${SEVERITY_LABEL[worst]}`}>
      <SeverityIcon severity={worst} className="size-3.5" />
      <span className="figures font-mono text-xs font-medium">{findings.length}</span>
    </span>
  );
}

/** Opens the command palette. `field` draws it as a search field; otherwise an icon button. */
export function FindButton({ field, disabled, className }: { field: boolean; disabled?: boolean; className?: string }) {
  const setPaletteOpen = useViewer((s) => s.setPaletteOpen);
  if (!field) {
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
        "flex h-8 w-full items-center gap-2 rounded-md border border-rule bg-paper px-2.5 text-left text-[13px] text-ink-3 transition-colors duration-150",
        "hover:border-rule-strong hover:text-ink-2 disabled:pointer-events-none disabled:opacity-50 dark:bg-tray",
        className,
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Find a file, symbol or author</span>
      <Kbd className="shrink-0">{FIND_KEY}</Kbd>
    </button>
  );
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: "Match system", light: "Light", dark: "Dark" } as const;

/** The theme menu. In the rail's foot it opens upward (`side="top"`); in the top bar, down. */
export function ThemeMenu({ className, align = "end", side = "top" }: { className?: string; align?: "start" | "end"; side?: "top" | "bottom" }) {
  const theme = useViewer((s) => s.theme);
  const setTheme = useViewer((s) => s.setTheme);
  const Icon = THEME_ICON[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Theme: ${THEME_LABEL[theme]}`} title={`Theme: ${THEME_LABEL[theme]}`} className={className}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-40">
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
