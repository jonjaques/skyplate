# Detailed tool recipes and measurement limits

## Recipes

**Orient in a new repository.** `map_codebase { project }` gives a bounded directory map.
Use `locate_code { query }` for a concept, then read the evidence. `overview` gives project
risk totals; `findings` gives the details behind them. `open` is useful for explicit analysis
options, not a required first call.

**Before changing a function.** Start with `change_impact { symbols: [{ name: "parseConfig" }] }`
for the combined risk and test briefing. Drill into `symbol { name: "parseConfig", impact_depth: 3 }`: callers with
their call sites, what it calls, its type hierarchy, every reference by file, and how far a
change can travel (symbols and files by depth). Check `calledThroughBases`: a method behind an
interface is called through the interface, so its own `calledBy` can look empty while it runs
on every request.

**Before deleting code.** `search_symbols { unused_exports: true }` lists exports nothing
outside their file references: all of them, the total `open` reports as
`codeIntelligence.unusedExports`. They come in four classes. The header `unusedExports`
counts each by name, the same name each row carries as a flag (`symbol` gives it as
`unusedExport`), and `unused_kind` returns one class alone:

- `unreferenced`: no use anywhere. A row's `refs` can still be 1: the `export { x }` line that
  names it is a reference row, not a use.
- no flag: used inside its own file; it only needs to lose `export`.
- `entry-export`: declared in a declared entry point (a config a tool loads, a script a runtime
  runs, a package's entry file). Whatever loads the entry may read it.
- `public-api`: in a published package's API (its package.json has no `"private": true`):
  declared in its entry or re-exported from it, so consumers outside the repository may use it.

A symbol a private package's entry re-exports with `export *` stays `unreferenced`: nothing
inside the repository uses it, and nothing outside can. The list pages with `offset` past
`limit`; `search_symbols { unused_kind: "unreferenced" }` gets the deletable ones in one call.

Each row carries its `doc` comment. Before deleting an `unreferenced` row, read it: a comment
naming a consumer that does not use it ("Shown on the settings page", "Kept for the export
job") is lost wiring to ask about, not dead code. Then search the repository for the name, one
search for the lot: docs, ADRs, string keys and dynamic access are invisible to the reference
table. Imports from Vue, Svelte, Astro, MDX and VitePress files need no separate check: a
symbol such a file imports is never flagged unused (`symbol` lists those imports as
`importedByHostFiles` when there are any).

For files, `files { flag: "unimported" }` lists code no file imports and nothing declares an
entry point; `files { flag: "entry" }` lists the declared ones with who declares them
(package.json main, bin, exports or scripts, a knip `entry`, a CI step, an agent hook, a T3
script, a tool config, a `.d.ts`). Files run by hand or found by a framework's convention are
declared nowhere Skyplate reads, so they stay unimported; check before deleting.

**Untangle structure.** `graph { view: "cycles" }` (runtime cycles; `include_type_only` adds
the loops only `import type` closes, each with `closedBy`: every type-only import inside it.
Removing them all ends the loop; which subset is enough is not computed, so start with the
imports into the loop's most-imported file, usually a types-heavy file worth splitting),
`graph { view: "modules" }` (instability
near 1: depends on much, little depends on it), `graph { view: "path", path: a, to: b }` for
why `a` ends up importing `b`, `graph { view: "dependents", path: "src/db", depth: 5 }` for
what a directory's change reaches.

**Ownership and risk.** `history { view: "ownership", path: "src/billing" }`,
`files { flag: "single_owner", sort: "code" }`, `history { view: "coupling", path: "src/api.ts" }`
for files that change with it (inspect composition and registration before treating a missing
import as a hidden dependency),
`history { view: "commits", path: "src/auth", since: "90d" }`.

Result keys differ by tool: `search_symbols` returns `symbols`, `files` returns `files`, and
`seams` returns `rows`. Page `seams` with `offset` when `more` is present. In a `seam` answer,
the interface has `symbols` and `rows`; export lists have `count` and `rows`; `relays` and
`adapters` are arrays.

For programmatic clients, successful tools also return `structuredContent.data`. It contains
the query result, or a source object with `path`, `source`, `startLine`, `endLine`, `totalLines`
and `origin` for `read_source`. Preserve `structuredContent.freshnessNote` when present.

**Module design.** `seams {}` ranks every module by `hotspotMass` (the sum of its files'
hotspot scores) with its design signals (interface as used, exports that could be hidden or are
internal, symbols only tests reach, relays, hidden co-change coupling, spread). Pass a row's
`selector` unchanged to `seam` to measure that same membership. Its `scope: "module"` excludes
separately selected child modules; its `depth`, when present, preserves the ranking partition.
Use `seam { path }` for a file, glob or a whole directory with every descendant. For a full
review use the `skyplate-architecture-review` skill; to design or verify one deepening, the
`skyplate-deepen` skill, which also defines the vocabulary those numbers stand for.

**Dependencies.** `dependencies { filter: "unused" }` (declared, never imported: CLI tools,
type packages and plugins land here legitimately) and `dependencies { filter: "undeclared" }`
(runtime built-ins and standard libraries are left out; `filter: "builtin"` lists them).

**Runtime impact versus type coupling.** Add `runtime_only: true` to `graph`'s `dependents`,
`dependencies` or `path` view to skip explicit type-only imports. Leave it off when changing
a type's contract, since its consumers still need to compile. The flag does not remove
ordinary imports merely because the compiler might erase their uses.

**A report for a person.** `build_report {}` writes the 3D plate, dashboard, explorer and
source reader to a folder in the user's cache directory, reusing the live analysis when it is
current; `serve_report { open_browser: true }` serves it on localhost and opens it. Pass `out`
to choose the folder, and `source: false` and `redact_paths: true` for a report that will be
shared outside the machine. Say where it was written.

## Reading the numbers

- **hotspot** (0-1): log churn × complexity, normalized. It needs history: under 10 analyzed
  commits every score is 0 and the overview's warnings say why. In a shallow clone (`git.shallow`)
  it reflects only the fetched commits.
- **rank** (0-1): PageRank over code imports, the max file is 1. **fanIn / fanOut** count
  distinct files over code edges; Markdown links are listed apart (`linksTo`, `linkedFrom`).
- **complexity**: keyword-based decision points + 1 for a file, comparable within a language
  family, approximate across them. A symbol's complexity is the compiler AST's.
- **refs / callers / files** on `symbol` count every reference anywhere, the symbol's own
  module and tests included; `seam`'s interface rows count only uses from outside the module
  by production code (`uses`, `files`), with test uses apart (`testUses`). The two disagree by
  design. **callers** counts distinct enclosing symbols that use it, leaving out import/export
  specifiers and extends/implements rows. `calledBy` lists only invocations for a function and
  every use for a type or variable (`usedBy`). "(top level of x.ts)" is code outside any function.
- **truck factor**: the fewest authors whose departure leaves over half the files without an
  active owner. Bots never count.
- **coupling degree**: shared commits ÷ commits of the less-changed file of the pair. A pair
  is kept only with 3 or more shared commits, and only the strongest 500 pairs in the project,
  so a file with no pairs may still change with others, just not often enough to count.

A file is a test by its name and location (`*.test.ts`, `__tests__/`, `test/`); a helper
imported only by tests but named like code (`fakeClock.ts`) counts as code, in
implementation and interface alike. `file { path }`'s `importedBy` shows when every importer is
a test.

Code intelligence covers TypeScript and JavaScript only; for other languages, use the import
graph and history. When `codeIntelligence.uninstalledManifests` is set, dependencies were never
installed: names imported from packages did not resolve, so reference counts are lower bounds
and an `unused-export` flag can be wrong. Say so, or suggest installing and calling
`open { reanalyze: true }`. `codeIntelligence.unresolved` counts identifiers the checker could
not resolve at all, mostly members read off `any`-typed values and undeclared globals: named
imports of exports still resolve, but a member used only through an untyped value is missed.
`unresolvedShare` gives it as a share of every identifier met: under a few percent, member
counts are close; past ten percent, read them as lower bounds.

## Freshness

A live project is watched. After files change, the next question re-analyzes first, waiting
up to `wait_seconds` (default 20). If the analysis is slower than that, the answer comes from the
previous analysis and starts with a `note:` line saying so; pass it on rather than presenting
stale numbers as current. `open { path, refresh: "on_change" }` re-analyzes after each burst of
edits instead, and `"manual"` only when asked (`open { path, reanalyze: true }`).

`read_source` reads a live project's file from disk as it is now, and a report folder's
embedded copy. Files that look like credentials (`.env`, keys, keystores) are measured but
their contents are never returned by any tool; do not try to read them another way on
Skyplate's behalf.

Reopening a live project with analysis options changes only the supplied options. A change
requested during analysis queues another run. `watch: false` and `watch: true` also apply to
an already open project. A report rebuilt while a lazy source or symbol read is in progress
returns an error asking you to reopen it, so its file IDs cannot be mixed across versions.

## Boundaries

- Analysis only reads the project. `build_report` writes only to `out` (by default a cache
  folder outside the project) and refuses to replace anything that is not an empty folder or
  an earlier report. Never point `out` inside a repository the user does not own.
- `open_browser` opens a window on the user's screen: use it when they asked to see the report.
- Positions are repo-relative paths and 1-based lines (`src/app.ts:12`), ready for your file
  tools.
