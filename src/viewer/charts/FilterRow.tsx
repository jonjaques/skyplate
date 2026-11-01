/**
 * The one filter row above the Charts tab. It scopes everything below it, and nothing below it
 * has filters of its own.
 *
 * The time range is local to this tab (it narrows history charts, not the galaxy's
 * scrubber). Language, category, generated and vendored are the shared store filters, so the
 * galaxy, the explorer and the trays narrow with them. The open drawer is shown here too: it
 * scopes the charts the same way it dims the plate, and this is where it can be closed.
 */

import { Check, ChevronDown, FolderOpen, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Category } from "../../shared/schema";
import { Button } from "../components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Label } from "../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Switch } from "../components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useViewer } from "../state/store";
import { Swatch } from "./kit/Legend";
import { slotColor } from "./kit/theme";
import { RANGES, type ChartScope, type RangeKey } from "./scope";

const CATEGORY_LABEL: Record<Category, string> = {
  code: "Code",
  test: "Tests",
  markup: "Markup",
  style: "Styles",
  data: "Data",
  config: "Config",
  docs: "Docs",
  build: "Build",
  notebook: "Notebooks",
  image: "Images",
  media: "Audio and video",
  font: "Fonts",
  archive: "Archives",
  binary: "Binaries",
  lockfile: "Lockfiles",
  unknown: "Unrecognized",
};

export function FilterRow({ scope, range, onRange }: { scope: ChartScope; range: RangeKey; onRange: (r: RangeKey) => void }) {
  const { report, filters, surface, files } = scope;
  const setFilters = useViewer((s) => s.setFilters);
  const focusDir = useViewer((s) => s.focusDir);
  const focus = useViewer((s) => s.focus);

  const languageOptions = useMemo(
    () =>
      [...report.languages]
        .sort((a, b) => b.code - a.code || b.files - a.files)
        .map((l) => ({ value: l.id, label: l.name, count: l.files, swatch: slotColor(l.slot, surface) })),
    [report, surface],
  );
  const categoryOptions = useMemo(
    () =>
      [...report.categories]
        .sort((a, b) => b.files - a.files)
        .map((c) => ({ value: c.category, label: CATEGORY_LABEL[c.category], count: c.files })),
    [report],
  );

  const narrowed = !!filters.languages || !!filters.categories || filters.hideGenerated || focusDir !== null;
  const drawer = focusDir !== null && focusDir > 0 ? report.dirs[focusDir] : undefined;

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-tray px-5 py-2.5">
      {scope.history ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={range}
          onValueChange={(v) => v && onRange(v as RangeKey)}
          aria-label="Time range for history charts"
        >
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.key} value={r.key} className="h-8 px-2.5 text-xs data-[state=on]:bg-paper data-[state=on]:font-semibold data-[state=on]:text-ink">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <span className="text-xs text-ink-3">
          {report.git ? "One commit, so there is no time range to narrow" : "No commit history in this report"}
        </span>
      )}

      <MultiSelect
        noun="languages"
        all="All languages"
        options={languageOptions}
        value={filters.languages}
        onChange={(languages) => setFilters({ languages })}
      />
      <MultiSelect
        noun="categories"
        all="All categories"
        options={categoryOptions}
        value={filters.categories as Set<string> | null}
        onChange={(categories) => setFilters({ categories: categories as Set<Category> | null })}
      />

      <div className="flex items-center gap-2">
        <Switch id="charts-hide-generated" size="sm" checked={filters.hideGenerated} onCheckedChange={(v) => setFilters({ hideGenerated: v })} />
        <Label htmlFor="charts-hide-generated" className="text-xs font-normal text-ink-2">
          Hide generated
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="charts-hide-vendored" size="sm" checked={filters.hideVendored} onCheckedChange={(v) => setFilters({ hideVendored: v })} />
        <Label htmlFor="charts-hide-vendored" className="text-xs font-normal text-ink-2">
          Hide vendored
        </Label>
      </div>

      {drawer && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-rule-strong bg-paper pr-1 pl-2 text-xs text-ink">
          <FolderOpen aria-hidden className="size-3.5 text-ink-3" />
          <span className="max-w-[220px] truncate font-mono text-[11px]">{drawer.path}</span>
          <button type="button" aria-label={`Close the ${drawer.path} drawer`} onClick={() => focus(null)} className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-wash hover:text-ink">
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="figures text-xs text-ink-3">
          {files.narrowed ? `${formatInt(files.ids.length)} of ${formatInt(report.files.length)} files` : `All ${formatInt(report.files.length)} files`}
        </span>
        {narrowed && (
          <Button
            variant="ghost"
            size="xs"
            className="text-ink-2"
            onClick={() => {
              setFilters({ languages: null, categories: null, hideGenerated: false });
              focus(null);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

interface Option {
  value: string;
  label: string;
  count: number;
  swatch?: string;
}

/**
 * Searchable multi-select. Nothing checked means "all", which is what store filters encode
 * as null; checking an option narrows to the checked set. A report can carry hundreds of
 * languages (linguist's samples have 765), so the list filters as you type.
 */
function MultiSelect({
  noun,
  all,
  options,
  value,
  onChange,
}: {
  noun: string;
  all: string;
  options: Option[];
  value: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value ? options.filter((o) => value.has(o.value)) : [];
  const summary = chosen.length === 0 ? all : chosen.length === 1 ? chosen[0]!.label : `${chosen.length} ${noun}`;

  function toggle(v: string) {
    const next = new Set(value ?? []);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next.size ? next : null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 bg-paper px-2.5 text-xs font-normal", chosen.length > 0 && "font-semibold")} aria-label={`Filter ${noun}: ${summary}`}>
          {chosen.length === 1 && chosen[0]!.swatch && <Swatch color={chosen[0]!.swatch} />}
          <span className="max-w-[160px] truncate">{summary}</span>
          <ChevronDown aria-hidden className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={`Find ${noun}`} className="h-9 text-xs" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="py-4 text-center text-xs text-ink-3">No {noun} match.</CommandEmpty>
            {chosen.length > 0 && (
              <CommandGroup>
                <CommandItem onSelect={() => onChange(null)} className="text-xs text-ink-2">
                  <X aria-hidden className="size-3.5" />
                  Show {all.toLowerCase()}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => {
                const on = value?.has(o.value) ?? false;
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)} className="gap-2 text-xs">
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] border border-rule-strong", on && "border-primary bg-primary text-primary-foreground")}>
                      {on && <Check aria-hidden className="size-3 text-current" strokeWidth={3} />}
                    </span>
                    {o.swatch && <Swatch color={o.swatch} />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="figures font-mono text-[10px] text-ink-3">{formatInt(o.count)}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
