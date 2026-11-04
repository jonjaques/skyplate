/**
 * The slim top bar, below 1024px only: there the rail is a sheet, so the bar carries what the
 * rail's head carries on wide screens (the drawers button, the mark and the project, find and
 * the theme) and the five views as a pill control.
 *
 *   768-1023px   one 52px row: drawers, mark, views, find, theme
 *   < 768px      two rows: drawers, mark and project, find, theme; then the views, full width
 *
 * Below 768px the views get a row of their own. Sharing one row with everything else left a
 * phone room for three of them: Source and Findings sat in a sideways scroller with no visible
 * scrollbar, unreachable unless the reader guessed to swipe the labels. Icon-only views were the
 * other option, but five glyphs are guesswork without their words.
 */

import { Menu } from "lucide-react";
import { useEffect, useRef } from "react";
import { Mark } from "../brand/Brand";
import { Button } from "../components/ui/button";
import { TabsList } from "../components/ui/tabs";
import { useViewer } from "../state/store";
import type { Breakpoint } from "./media";
import { BarViewTrigger, FindButton, TAB_ORDER, ThemeMenu } from "./nav";
import { useShell } from "./shell-state";

/**
 * `ready` is false until a report is indexed (and stays false when it is missing or broken):
 * the views and find have nothing to act on then, so they render disabled instead of opening
 * an empty palette. The theme menu works either way.
 */
export function TopBar({ bp, ready = true }: { bp: Breakpoint; ready?: boolean }) {
  const setRailSheetOpen = useShell((s) => s.setRailSheetOpen);
  const compact = bp === "compact";
  const tab = useViewer((s) => s.tab);
  const tabs = useRef<HTMLDivElement>(null);

  // Wherever the views can scroll sideways, one picked by number key, a link or an "Open in
  // source reader" button could be the one scrolled out of sight, leaving the bar with no
  // visible active view. Bring it into view whenever it changes.
  useEffect(() => {
    tabs.current
      ?.querySelector<HTMLElement>("[data-state=active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [tab]);

  const drawers = (
    <Button variant="ghost" size="icon-sm" aria-label="Open drawers" disabled={!ready} onClick={() => setRailSheetOpen(true)}>
      <Menu />
    </Button>
  );

  // justify-start overrides shadcn's justify-center: centered flex content that overflows spills
  // past the left edge too, where no scroll position can reach it, so the first view was
  // unreachable in a narrow bar.
  const views = (
    <TabsList
      ref={tabs}
      className="h-9 min-w-0 justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border border-rule bg-wash p-[3px] [scrollbar-width:none] dark:bg-tray"
    >
      {TAB_ORDER.map((t) => (
        <BarViewTrigger key={t.id} id={t.id} ready={ready} className={compact ? "flex-auto px-1.5" : undefined} />
      ))}
    </TabsList>
  );

  if (compact) {
    return (
      <header className="min-w-0 border-b border-rule bg-rail">
        <div className="flex h-[52px] min-w-0 items-center gap-2 px-3">
          {drawers}
          <Mark size={22} />
          <ProjectName />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <FindButton field={false} disabled={!ready} />
            <ThemeMenu side="bottom" />
          </div>
        </div>
        <div className="px-3 pb-2.5 [&>[role=tablist]]:w-full">{views}</div>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] min-w-0 items-center gap-3 border-b border-rule bg-rail px-3">
      {drawers}
      <Mark size={22} title="Skyplate" />
      <div className="hidden max-w-[160px] min-w-0 md:block">
        <ProjectName />
      </div>
      {views}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <FindButton field={false} disabled={!ready} />
        <ThemeMenu side="bottom" />
      </div>
    </header>
  );
}

/** On a phone the rail (and with it the project's name) lives in a sheet; the bar names it. */
function ProjectName() {
  const name = useViewer((s) => s.report?.project.name);
  return (
    <span className="block min-w-0 truncate text-[15px] leading-tight font-semibold [font-stretch:85%]" title={name}>
      {name ?? "Skyplate"}
    </span>
  );
}
