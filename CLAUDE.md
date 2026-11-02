# starchart

A Bun CLI that analyzes any project directory and writes a static report folder: a 3D galaxy
of files (react-three-fiber), D3 charts, an explorer, a source reader, and TypeScript code
intelligence. `README.md` covers usage; this file covers how the code is put together and
what breaks if you change it carelessly.

## Commands

| Task | Command |
| --- | --- |
| Analyze a project | `bun run starchart <path> [--out dir]` |
| Serve a report | `bun run starchart serve <dir> [--open]` |
| Viewer dev server (HMR, :4317) | `bun dev` (serves report data from `.starchart/dev`, or `STARCHART_REPORT=<dir>`) |
| Build the viewer template | `bun run build` → `dist/viewer` (the CLI copies it into every report) |
| Tests | `bun test` |
| Typecheck | `bun check` (TypeScript 7; do not use `tsc`) |

Bun is the runtime, package manager and bundler here (this project began from
`bun init --react=tailwind`). Use `bun add`, never npm/yarn/pnpm.

## Layout

```
bin/starchart.ts          CLI entry → src/cli/ (args, progress, serve)
src/shared/schema.ts      THE contract between analyzer and viewer (Report, CodeSymbols…)
src/shared/web.ts         the cosmic web layout (pure; both sides import it, see below)
src/core/contracts.ts     function types each analyzer module exports
src/core/                 analyzer: walk, languages/, metrics, facts, imports/, graph, git/,
                          ts/ (TypeScript 7 compiler API), stats, findings, layout, site,
                          pipeline (orchestrates), worker + pool (per-file analysis), validate
src/viewer/               React app: state/ (zustand store, loaders, URL), model/ (derived
                          indexes), galaxy/, charts/ (+ kit/), shell/ (+ record/), source/,
                          components/ui (shadcn), lib/ (format, colors, cn)
build.ts                  viewer production build (see "file:// rules")
src/index.ts              dev server
```

## Rules that hold the design together

- **Change the schema first.** Anything crossing from analyzer to viewer goes through
  `src/shared/schema.ts`. Tables are columnar and reference files, symbols and authors by
  integer id. Run `validateReport` (`src/core/validate.ts`) in tests after any change to the
  report's shape.
- **file:// rules.** Reports must open by double-clicking `index.html`. Browsers block
  `fetch()` and module scripts over file://, so:
  - data ships as classic scripts calling `window.__starchart.resolve(name, payload)`
    (`DATA_GLOBAL` in schema.ts; loaded by `src/viewer/data/load.ts`);
  - `build.ts` bundles the viewer as an IIFE behind a plain deferred `<script>`, and
    highlight.js as a second lazily injected IIFE;
  - all asset URLs stay relative.

  Don't switch to Bun's HTML entrypoint for production, and don't add `fetch()` for report
  data.
- **Secrets are never embedded.** `Detection.secret` files are measured but carry no content
  and no hash. Keep it that way.
- **TypeScript analysis uses the async API** (`typescript/unstable/async`). The sync client
  reads Node-internal pipe handles that Bun does not have.
- **Never write into an analyzed project.** The CLI refuses to replace a folder that isn't a
  starchart report, or the project itself (`site.ts`).
- **The web is computed, not shipped.** The galaxy's default layout (`src/shared/web.ts`) runs
  in the viewer, once per gravity the reader picks, and in the analyzer only to anchor the
  import-graph layout (`src/core/layout.ts`), which is shipped. Keep `computeWeb` pure and
  deterministic (no DOM, no three.js, no `Math.random`, sorts with id tie-breaks) and inside its
  main-thread budget (`test/web.test.ts`: 150 ms at 20k files, 400 ms at 50k). The truth rule:
  no layout choice, gravity included, moves a file out of its directory's neighborhood; bridge
  files leaning along a filament are the one bounded exception.

## Visual world

The viewer's direction is **Specimen Cabinet**: the contract is in
`.impeccable/surfaces/src-viewer-index-html.md` and the shipped system in `DESIGN.md`. In
short:
- a tray-white ground ruled by hairlines, with no cards and no tray shadows;
- an archival gray-blue rail;
- a dark glass galaxy plate in both themes;
- Archivo (condensed) with JetBrains Mono for paths and figures;
- holotype red (`#c23a2b`) reserved for each region's most depended-on file and nothing
  else, so critical status is ink, not red.

Colors come from `src/viewer/styles.css` / `src/viewer/lib/colors.ts`, which were checked
with the dataviz skill's palette validator. Don't add hues ad hoc; categorical sets cap at
seven slots plus Other. Use the shadcn components in `src/viewer/components/ui` for standard
controls; they are themed through the semantic tokens in `styles.css`.

The impeccable design hook runs on edits. Its findings are design feedback, not noise.

## Testing against real projects

`bun test` builds small fixture repos. For realistic checks, run the CLI on a few public
clones (a TypeScript monorepo, a Python project, a Go project) and open the reports. Never
analyze into, or write inside, a repository you don't own.
