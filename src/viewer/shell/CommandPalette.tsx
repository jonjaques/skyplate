/**
 * The command palette (⌘K, Ctrl+K or "/"): find any file, directory, symbol or author, and run
 * the view actions (color by, size by, layout, gravity, theme, tabs, about).
 *
 * Built from shadcn's Dialog and Command rather than its CommandDialog wrapper because that
 * wrapper cannot turn cmdk's own filtering off, and cmdk re-scores and re-sorts everything it
 * is given; search.ts ranks here instead (see its header). Symbol tables load when the palette
 * opens, with a loading row until they arrive.
 */

import {
  Braces,
  FileText,
  Folder,
  Info,
  LayoutGrid,
  LoaderCircle,
  Monitor,
  Moon,
  Network,
  Orbit,
  Palette,
  Ruler,
  Sun,
  User,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatInt, plural } from "../lib/format";
import { ensureSymbols } from "../state/loaders";
import { pushNextView } from "../state/url";
import { useViewer, type ColorBy, type SizeBy, type Tab } from "../state/store";
import { GRAVITIES, GRAVITY_NEEDS_GIT } from "../../shared/web";
import { COLOR_BY_LABEL, GRAVITY_HINT, GRAVITY_LABEL, NEEDS_GIT, SIZE_BY_LABEL, SYMBOL_KIND_LABEL } from "./labels";
import { focusDrawer, openSymbolDefinition, show } from "./navigate";
import { LanguageSwatch } from "./parts";
import { queryTerms, rankScored, searchable, type Searchable } from "./search";
import { useShell } from "./shell-state";
import { TAB_ORDER } from "./TopBar";

const LIMIT = { files: 8, dirs: 5, symbols: 8, authors: 5 };

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
}

export function CommandPalette() {
  const open = useViewer((s) => s.paletteOpen);
  const setOpen = useViewer((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  // cmdk only re-selects the first item when it filters; with filtering off the active value
  // would keep pointing at a row that is gone, so it is controlled here.
  const [active, setActive] = useState("");
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (open) void ensureSymbols();
    else setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[16vh] translate-y-0 overflow-hidden p-0 sm:max-w-[620px]" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Find</DialogTitle>
          <DialogDescription>Search files, directories, symbols and authors, or run a view action.</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Find a file, directory, symbol or author"
            className="h-12 text-[14px]"
          />
          <CommandList className="max-h-[min(460px,60vh)]">
            {open && <Results query={query} close={close} setActive={setActive} />}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function useIndex<T>(items: T[] | undefined, key: (t: T) => string): Searchable | null {
  return useMemo(() => (items ? searchable(items.map(key)) : null), [items]);
}

type GroupKey = "files" | "dirs" | "symbols" | "authors" | "actions";
const GROUP_ORDER: GroupKey[] = ["files", "dirs", "symbols", "authors", "actions"];

function Results({ query, close, setActive }: { query: string; close(): void; setActive(value: string): void }) {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const symbols = useViewer((s) => s.symbols);
  const symbolModel = useViewer((s) => s.symbolModel);
  const symbolsStatus = useViewer((s) => s.symbolsStatus);
  const tab = useViewer((s) => s.tab);
  const q = useDeferredValue(query.trim());

  const fileIndex = useIndex(report?.files, (f) => f.path);
  const dirIndex = useIndex(report?.dirs, (d) => d.path);
  const authorIndex = useIndex(report?.git?.authors, (a) => `${a.name} ${a.email}`);
  const symbolIndex = useMemo(() => (symbols ? searchable(symbols.symbols.name) : null), [symbols]);

  const hits = useMemo(() => {
    if (!report || !q) return null;
    const t = symbols?.symbols;
    return {
      files: fileIndex ? rankScored(fileIndex, q, LIMIT.files, undefined, (i) => report.files[i]!.rank) : [],
      dirs: dirIndex ? rankScored(dirIndex, q, LIMIT.dirs, (i) => i !== 0, (i) => report.dirs[i]!.totalFiles) : [],
      symbols:
        symbolIndex && t ? rankScored(symbolIndex, q, LIMIT.symbols, (i) => t.kind[i] !== "module", (i) => t.refs[i]!) : [],
      authors: authorIndex ? rankScored(authorIndex, q, LIMIT.authors, undefined, (i) => report.git!.authors[i]!.commits) : [],
    };
  }, [report, q, fileIndex, dirIndex, symbolIndex, authorIndex, symbols]);

  const actions = useActions(close);
  const actionIndex = useMemo(() => searchable(actions.map((a) => a.label)), [actions]);
  // Actions match only when every typed term is a substring of the label: scattered letters
  // match nearly any of these short sentences. Matches are scored like every other row, so
  // "about" puts "About this report" first when nothing else matches as literally.
  const actionHits = useMemo(() => {
    if (!q) return actions.map((_, i) => ({ i, s: 0 }));
    const terms = queryTerms(q);
    return rankScored(actionIndex, q, actions.length, (i) => terms.every((term) => actionIndex.lower[i]!.includes(term)));
  }, [actions, actionIndex, q]);

  const symbolsReady = symbolsStatus === "ready";
  const t = symbols?.symbols;
  // The ref-count column is as wide as its widest entry, in ch of the mono face (exact, since
  // every glyph is one ch). A fixed 68px fit "283 refs" and wrapped "1,117 refs" onto two lines.
  const refsWidth = useMemo(
    () => (t && hits ? Math.max(0, ...hits.symbols.map(({ i }) => plural(t.refs[i]!, "ref").length)) : 0),
    [t, hits],
  );

  // Groups in order of their best hit, so an exact author or action is not buried under eight
  // fuzzy file rows. A symbol whose name is exactly the query, and that something actually
  // uses, goes first outright: typing "vec3" means the function, not the file named after it.
  const order = useMemo<GroupKey[]>(() => {
    if (!hits) return GROUP_ORDER;
    const best: Record<GroupKey, number> = {
      files: hits.files[0]?.s ?? -Infinity,
      dirs: hits.dirs[0]?.s ?? -Infinity,
      symbols: symbolsReady ? (hits.symbols[0]?.s ?? -Infinity) : -Infinity,
      authors: hits.authors[0]?.s ?? -Infinity,
      actions: actionHits[0]?.s ?? -Infinity,
    };
    const top = hits.symbols[0];
    if (symbolsReady && t && top && t.name[top.i]!.toLowerCase() === q.toLowerCase() && t.refs[top.i]! > 0) {
      best.symbols = Infinity;
    }
    return [...GROUP_ORDER].sort((a, b) => best[b] - best[a]);
  }, [hits, actionHits, symbolsReady, t, q]);

  const firstOf: Record<GroupKey, string | null> = {
    files: hits?.files[0] ? `file:${hits.files[0].i}` : null,
    dirs: hits?.dirs[0] ? `dir:${hits.dirs[0].i}` : null,
    symbols: hits?.symbols[0] && symbolsReady ? `sym:${hits.symbols[0].i}` : null,
    authors: hits?.authors[0] ? `author:${hits.authors[0].i}` : null,
    actions: actionHits[0] ? `action:${actions[actionHits[0].i]!.id}` : null,
  };
  const first = !hits
    ? model && model.holotypes.size > 0
      ? `file:${[...model.holotypes].sort((a, b) => report!.files[b]!.fanIn - report!.files[a]!.fanIn)[0]}`
      : (actions[0] && `action:${actions[0].id}`) || ""
    : (order.map((g) => firstOf[g]).find(Boolean) ?? "");
  useEffect(() => setActive(first), [first, setActive]);

  if (!report || !model) return null;

  // A pick from the palette is a deliberate move, so it gets a browser history entry (Back
  // returns to where the reader was); see state/url.ts.
  const pickFile = (id: number) => {
    close();
    pushNextView();
    // In the reader, picking a file means "read it"; elsewhere it means "select it".
    if (tab === "source") useViewer.getState().openSource({ file: id });
    else show({ kind: "file", id }, tab === "charts" || tab === "findings" ? "galaxy" : undefined);
  };
  const pickSymbol = (id: number) => {
    close();
    pushNextView();
    if (tab === "source" && symbols) openSymbolDefinition(symbols, id);
    else show({ kind: "symbol", id }, tab === "charts" || tab === "findings" ? "galaxy" : undefined);
  };

  // An empty query offers the files most worth knowing, then the actions.
  if (!hits) {
    const top = [...model.holotypes].sort((a, b) => report.files[b]!.fanIn - report.files[a]!.fanIn).slice(0, 6);
    return (
      <>
        {top.length > 0 && (
          <CommandGroup heading="Holotypes, each region's most depended-on file">
            {top.map((id) => (
              <FileItem key={id} id={id} onSelect={() => pickFile(id)} />
            ))}
          </CommandGroup>
        )}
        <ActionGroup actions={actions} />
      </>
    );
  }

  const nothing =
    hits.files.length + hits.dirs.length + hits.symbols.length + hits.authors.length + actionHits.length === 0;

  const groups: Record<GroupKey, ReactNode> = {
    files: hits.files.length > 0 && (
      <CommandGroup key="files" heading="Files">
        {hits.files.map(({ i: id }) => (
          <FileItem key={id} id={id} onSelect={() => pickFile(id)} />
        ))}
      </CommandGroup>
    ),
    dirs: hits.dirs.length > 0 && (
      <CommandGroup key="dirs" heading="Directories">
        {hits.dirs.map(({ i: id }) => {
          const d = report.dirs[id]!;
          return (
            <CommandItem
              key={id}
              value={`dir:${id}`}
              onSelect={() => {
                close();
                pushNextView();
                focusDrawer(id);
              }}
            >
              <Folder />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{d.path}</span>
              <span className="figures shrink-0 font-mono text-xs whitespace-nowrap text-ink-3">{formatInt(d.totalFiles)}</span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    ),
    // The group shows while the tables load (so a symbol search is not mistaken for "no
    // match"), and after that only when something matched.
    symbols: report.symbols && (symbolsStatus !== "ready" || hits.symbols.length > 0) && (
      <CommandGroup key="symbols" heading="Symbols">
        {symbolsStatus === "loading" || symbolsStatus === "idle" ? (
          <CommandItem disabled value="symbols-loading">
            <LoaderCircle className="animate-spin" />
            <span className="text-ink-3">Loading symbols…</span>
          </CommandItem>
        ) : symbolsStatus === "error" ? (
          <CommandItem disabled value="symbols-error">
            <span className="text-ink-3">The symbol tables did not load</span>
          </CommandItem>
        ) : (
          t &&
          symbolModel &&
          hits.symbols.map(({ i: id }) => {
            const file = report.files[t.file[id]!];
            return (
              <CommandItem key={id} value={`sym:${id}`} onSelect={() => pickSymbol(id)}>
                <Braces />
                {/* The name is what the reader typed toward, so the path gives way first: at
                    390px both shrank together and "vec3" was cut to "v…" beside a long path. */}
                <span className="max-w-[45%] shrink-0 truncate font-mono text-[12.5px] text-ink">{t.name[id]}</span>
                <span className="shrink-0 text-xs text-ink-3">{SYMBOL_KIND_LABEL[t.kind[id]!]}</span>
                <span className="ml-auto min-w-0 truncate font-mono text-xs text-ink-3">
                  {file ? `${file.path}:${t.line[id]! + 1}` : ""}
                </span>
                {/* Two symbols can share a name ("Vec3" the interface, "Vec3" a test-local
                    alias); how much the project uses each is what tells them apart. */}
                <span className="figures shrink-0 text-right font-mono text-xs whitespace-nowrap text-ink-3" style={{ width: `${refsWidth}ch` }}>
                  {plural(t.refs[id]!, "ref")}
                </span>
              </CommandItem>
            );
          })
        )}
      </CommandGroup>
    ),
    authors: hits.authors.length > 0 && (
      <CommandGroup key="authors" heading="Authors">
        {hits.authors.map(({ i: id }) => {
          const a = report.git!.authors[id]!;
          return (
            <CommandItem
              key={id}
              value={`author:${id}`}
              onSelect={() => {
                close();
                pushNextView();
                show({ kind: "author", id }, tab === "charts" || tab === "findings" ? "galaxy" : undefined);
              }}
            >
              <User />
              <span className="truncate">{a.name}</span>
              <span className="min-w-0 truncate font-mono text-xs text-ink-3">{a.email}</span>
              <span className="figures ml-auto shrink-0 font-mono text-xs whitespace-nowrap text-ink-3">{plural(a.commits, "commit")}</span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    ),
    actions: <ActionGroup key="actions" actions={actionHits.map((h) => actions[h.i]!)} />,
  };

  return (
    <>
      {nothing && symbolsStatus !== "loading" && <CommandEmpty>Nothing in this report matches “{q}”.</CommandEmpty>}
      {order.map((g) => groups[g])}
    </>
  );
}

function FileItem({ id, onSelect }: { id: number; onSelect(): void }) {
  const file = useViewer((s) => s.report!.files[id]!);
  const holotype = useViewer((s) => s.model?.holotypes.has(id) ?? false);
  const slash = file.path.lastIndexOf("/");
  return (
    <CommandItem value={`file:${id}`} onSelect={onSelect}>
      <FileText />
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
        <span className="text-ink-3">{slash >= 0 ? file.path.slice(0, slash + 1) : ""}</span>
        <span className="text-ink">{file.name}</span>
      </span>
      {holotype && <span className="shrink-0 rounded-xs bg-holotype px-1.5 py-px text-[11px] font-semibold text-holotype-ink">Holotype</span>}
      <LanguageSwatch languageId={file.language} />
    </CommandItem>
  );
}

function ActionGroup({ actions }: { actions: Action[] }) {
  if (actions.length === 0) return null;
  return (
    <CommandGroup heading="Actions">
      {actions.map((a) => (
        <CommandItem key={a.id} value={`action:${a.id}`} onSelect={a.run} disabled={a.disabled}>
          {a.icon}
          <span>{a.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** A label inside a sentence: lowercased, except a name like PageRank, which keeps its case. */
function phrase(label: string): string {
  return /[a-z][A-Z]/.test(label) ? label : label.toLowerCase();
}

function useActions(close: () => void): Action[] {
  const hasGit = useViewer((s) => !!s.report?.git);
  const colorBy = useViewer((s) => s.colorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const layout = useViewer((s) => s.layout);
  const gravity = useViewer((s) => s.gravity);
  const theme = useViewer((s) => s.theme);
  return useMemo(() => {
    const s = () => useViewer.getState();
    const done = (fn: () => void) => () => {
      fn();
      close();
    };
    const colors = (Object.keys(COLOR_BY_LABEL) as ColorBy[])
      .filter((m) => m !== colorBy)
      .map<Action>((m) => ({
        id: `color-${m}`,
        label: `Color by ${phrase(COLOR_BY_LABEL[m])}`,
        icon: <Palette />,
        run: done(() => s().setColorBy(m)),
        disabled: !hasGit && NEEDS_GIT.has(m),
      }));
    const sizes = (Object.keys(SIZE_BY_LABEL) as SizeBy[])
      .filter((m) => m !== sizeBy)
      .map<Action>((m) => ({
        id: `size-${m}`,
        label: `Size by ${phrase(SIZE_BY_LABEL[m])}`,
        icon: <Ruler />,
        run: done(() => s().setSizeBy(m)),
        disabled: !hasGit && NEEDS_GIT.has(m),
      }));
    // Gravity shapes the web only, so picking one from the import graph switches to the web: a
    // command that changed nothing on screen would read as broken.
    const gravities = GRAVITIES.filter((g) => g !== gravity || layout !== "web").map<Action>((g) => ({
      id: `gravity-${g}`,
      label: `Gravity: ${GRAVITY_LABEL[g].toLowerCase()} (${GRAVITY_HINT[g].toLowerCase()})`,
      icon: <Orbit />,
      run: done(() => {
        s().setGravity(g);
        s().setLayout("web");
      }),
      disabled: !hasGit && GRAVITY_NEEDS_GIT.has(g),
    }));
    const tabs = TAB_ORDER.map<Action>((t) => ({
      id: `tab-${t.id}`,
      label: `Go to ${t.label}`,
      icon: <LayoutGrid />,
      run: done(() => s().setTab(t.id as Tab)),
    }));
    const themes: Action[] = (
      [
        ["system", "Match the system theme", <Monitor key="m" />],
        ["light", "Use the light theme", <Sun key="s" />],
        ["dark", "Use the dark theme", <Moon key="d" />],
      ] as const
    )
      .filter(([id]) => id !== theme)
      .map(([id, label, icon]) => ({ id: `theme-${id}`, label, icon, run: done(() => s().setTheme(id)) }));
    return [
      {
        id: "layout",
        label: layout === "web" ? "Lay out by import graph" : "Lay out as a web of directories",
        icon: <Network />,
        run: done(() => s().setLayout(layout === "web" ? "graph" : "web")),
      },
      ...gravities,
      ...colors,
      ...sizes,
      ...tabs,
      ...themes,
      { id: "about", label: "About this report", icon: <Info />, run: done(() => useShell.getState().setAboutOpen(true)) },
    ];
  }, [hasGit, colorBy, sizeBy, layout, gravity, theme, close]);
}
