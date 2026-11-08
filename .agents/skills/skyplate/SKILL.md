---
name: skyplate
description: Measure and question a codebase with Skyplate's MCP server — where the complexity and churn concentrate (hotspots), who owns what, what imports what, who calls a function and what a change to it can reach, which dependencies are unused, plus a shareable report folder of all of it. Use when orienting in an unfamiliar repository, before refactoring or deleting code (impact, dead exports, cycles), when asked about ownership, history or risk, or when asked to build, serve or open a Skyplate report. Works on any directory, live, without writing into it.
---

# Skyplate

Skyplate analyzes a project directory the way its CLI does for a report: every file classified
(~800 languages) and measured, imports resolved for 30+ languages into a graph, one git pass
for churn, ownership, co-change and hotspots, and for TypeScript and JavaScript the TypeScript 7
compiler's symbols, references and call graph. The `skyplate` MCP server holds that analysis
in memory and answers questions from it in milliseconds.

Reach for it when the question is about the shape of the code rather than one line of it.
"Where is the risk", "who calls this", "what breaks if I change it", "who knows this part" take
dozens of greps and still miss things; here they are one call, with the compiler's resolution
behind the symbol answers. For reading a specific file you already know, your own file tools
are fine.

## Is the server attached?

Its tools appear as `open`, `files`, `symbol`… under the `skyplate` server (in Claude Code,
`mcp__skyplate__open`). If they are missing, tell the user and offer to register it rather than
working around it:

```sh
claude mcp add skyplate -s user -- bunx skyplate mcp        # Claude Code, every project
codex mcp add skyplate -- bunx skyplate mcp                 # Codex
```

It needs Bun 1.4+ (the CLI is TypeScript that Bun runs; `npx` under Node will not work). From
a checkout of Skyplate, use `bun /path/to/skyplate/bin/skyplate.ts mcp` as the command.
Adding paths (`skyplate mcp ~/code/app`) opens them at startup.

If the user would rather not register it, the CLI writes the same data as JSON:
`bunx skyplate <dir> --json --out <scratch>/x.skyplate --quiet`, then query
`<scratch>/x.skyplate/data/report.json` with `jq` (the shape is `Report` in Skyplate's
`src/shared/schema.ts`: files and symbols are referenced by integer id).

## The first call

```
open { path: "/abs/path/to/project" }
```

A directory is analyzed live (a few seconds for a small project, minutes for a large monorepo)
and then watched. A Skyplate report folder (`*.skyplate/`, with `data/report.js`) is read as
written. `open` returns the overview: size, languages, structure, git summary, top hotspots and
hubs, and the report's findings. Read it before asking anything else; it usually says where to
look next.

If the analysis outlasts `wait_seconds` (default 45), the answer is the job's state. Call
`status { project, wait_seconds }` to keep waiting instead of re-opening. With one project
open, every other tool can leave `project` out.

## Recipes

**Orient in a new repository.** `open` already returns the top hotspots, hubs, git summary and
finding titles, so start from it, not from a fresh round of calls. Then `findings` for the
details behind the titles, and only what the question needs: `dir {}` for the top level,
`files { sort: "hotspot", limit: 15 }` past the five hotspots `open` lists, `history { view:
"summary" }` for recent weeks and conventional types.

**Before changing a function.** `symbol { name: "parseConfig", impact_depth: 3 }`: callers with
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
for files that change with it (a hidden dependency when there is no import between them),
`history { view: "commits", path: "src/auth", since: "90d" }`.

Result keys differ by tool, named for what they list: `search_symbols` returns `symbols`,
`files` returns `files`, `seams` returns `rows`, and every list inside a `seam` answer is
`{ count, rows }` (its interface too).

**Module design.** `seams {}` ranks every module by `hotspotMass` (the sum of its files'
hotspot scores) with its design signals (interface as used, exports that could be hidden or are
internal, symbols only tests reach, relays, hidden co-change coupling, spread); `seam { path }`
measures one module at its interface. For a full
review use the `skyplate-architecture-review` skill; to design or verify one deepening, the
`skyplate-deepen` skill, which also defines the vocabulary those numbers stand for.

**Dependencies.** `dependencies { filter: "unused" }` (declared, never imported: CLI tools,
type packages and plugins land here legitimately) and `dependencies { filter: "undeclared" }`
(runtime built-ins and standard libraries are left out; `filter: "builtin"` lists them).

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

## Boundaries

- Analysis only reads the project. `build_report` writes only to `out` (by default a cache
  folder outside the project) and refuses to replace anything that is not an empty folder or
  an earlier report. Never point `out` inside a repository the user does not own.
- `open_browser` opens a window on the user's screen: use it when they asked to see the report.
- Positions are repo-relative paths and 1-based lines (`src/app.ts:12`), ready for your file
  tools.
