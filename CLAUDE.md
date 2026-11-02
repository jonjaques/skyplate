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
src/shared/dmath.ts       sin, cos, atan2, roots from + − × ÷ and sqrt: the same bits in every engine
src/core/contracts.ts     function types each analyzer module exports
src/core/                 analyzer: walk, languages/, metrics, facts, imports/, graph, git/,
                          ts/ (TypeScript 7 compiler API), stats, findings, layout, site,
                          pipeline (orchestrates), worker + pool (per-file analysis), validate
src/viewer/               React app: state/ (zustand store, loaders, URL), model/ (derived
                          indexes), galaxy/ (engine, shaders, hoverIntent, clicks, groups:
                          hulls, picking, levels), charts/ (+ kit/), shell/ (+ record/), source/,
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
  main-thread budget (`test/web.test.ts`: 150 ms at 20k files, 400 ms at 50k, 300 ms for 10,000
  sibling directories under one parent). Deterministic means across engines too: Safari (JSC)
  and Chrome (V8) must lay out the same web, so the layout uses `dmath.ts` and plain arithmetic,
  never `Math.sin`, `cos`, `atan2`, `acos`, `cbrt`, `pow` or `hypot`, which engines round
  differently (check: hash `computeWeb` output under node and under Bun). The truth rule: no
  layout choice, gravity included, moves a file out of its directory's neighborhood; bridge
  files leaning along a filament are the one exception, bounded both as a share of the strand
  and in radii of their own directory.
- **Hover goes through intent; hover never uploads.** The plate picks on every pointer sample
  (moon, then star, then the deepest group whose envelope holds the pointer, `engine.pick` /
  `pickGroup`) but only commits to the hover store when `galaxy/hoverIntent.ts` says the pointer
  settled. That module is pure and clock-injected; tune its constants there, with the reasons
  beside them, and keep `hoverIntent.test.ts` passing. A hovered star or group reaches the
  shader as uniforms (`uHover`, `uReticle`, and `uHotRange`, a depth-first file range tested
  against the `aOrder` attribute): a per-hover attribute rewrite is a regression. Region names
  drawn on the plate go through the same intent (GalaxyView reads `data-region-dir`), and the
  name under the pointer must not move. Clicks go through `galaxy/clicks.ts`: only a press that
  began on the canvas with no menu open can select (Radix menus leave the canvas live under
  them), and a double-click acts on what its first click hit.
- **New per-frame work does not allocate.** Frame listeners (`engine.onFrame`) and what they
  call reuse buffers and recompute only when the camera, morph or subject changed (see
  `Envelopes.tsx`, which draws on a 2D canvas because an SVG path string was garbage every
  frame). The specimen and region label placement passes still allocate per frame (about 2 MB/s
  while frames run, measured); don't add to them. Check with a heap sampling profile, not by
  eye. In the dev server, `window.__plate` exposes the full plate's engine, hover intent and
  stores for scripted pointer runs; production builds drop it.

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
