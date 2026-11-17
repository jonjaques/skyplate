# Skyplate

A Bun CLI that analyzes any project directory and writes a static report folder: a 3D plate
of files (react-three-fiber), D3 charts, an explorer, a source reader, and TypeScript code
intelligence. It was called starchart until its first release; the only places that name
survives are the back-compat paths noted below. `README.md` covers usage; this file covers how the code is put together and
what breaks if you change it carelessly.

## Commands

| Task | Command |
| --- | --- |
| Analyze a project | `bun run skyplate <path> [--out dir]` |
| Serve a report | `bun run skyplate serve <dir> [--open]` |
| MCP server for agents (stdio) | `bun run skyplate mcp [path...]` |
| Smoke-test an MCP server over stdio | `bun scripts/mcp-smoke.ts <skyplate-binary> <project-dir>` |
| Anonymous benchmark of one analysis | `bun run skyplate bench <path> [--out new-dir] [--skeleton]` (`docs/benchmark.md`) |
| Rebuild a synthetic repository from a skeleton | `bun run skyplate bench synth <benchmark.json> --out <new-dir>` |
| Viewer dev server (HMR, :4317) | `bun dev` (serves report data from `.skyplate/dev`, or `SKYPLATE_REPORT=<dir>`) |
| Build the viewer template | `bun run build` → `dist/viewer` (the CLI copies it into every report) |
| Regenerate the mark, wordmark and favicon | `bun scripts/brand.ts` (needs `woff2_decompress`: `brew install woff2`) |
| Tests | `bun test` |
| Typecheck | `bun check` (TypeScript 7; do not use `tsc`) |
| Publish to npm | bump `version`, then `bun publish` (`prepublishOnly` builds, tests and typechecks; not when handed a tarball) |

Bun is the runtime, package manager and bundler here (this project began from
`bun init --react=tailwind`). Use `bun add`, never npm/yarn/pnpm.

## Layout

```
bin/skyplate.ts           CLI entry → src/cli/ (args, progress, serve)
src/shared/schema.ts      THE contract between analyzer and viewer (Report, CodeSymbols…)
src/shared/web.ts         the cosmic web layout (pure; both sides import it, see below)
src/shared/dmath.ts       sin, cos, atan2, roots from + − × ÷ and sqrt: the same bits in every engine
src/shared/calls.ts       what the call table means (callers, callees, heritage); viewer and MCP
src/shared/search.ts      fuzzy ranking: the command palette and the MCP server's search
src/mcp/                  `skyplate mcp`: main (stdio), server (tools), workspace (projects,
                          queue, watch, builds, the structure pass), query (answers), changes
                          (the working tree against HEAD), report (reads a report folder)
.agents/skills/           agent skills for the MCP server: skyplate (the tools),
                          skyplate-architecture-review, skyplate-deepen (design, adapted from
                          mattpocock/skills, MIT); .claude/skills/* are symlinks to them
src/core/contracts.ts     function types each analyzer module exports
src/core/                 analyzer: walk, languages/, metrics, facts, imports/, graph, git/,
                          ts/ (TypeScript 7 compiler API), entries (declared entry points),
                          stats, findings, layout, site,
                          pipeline (orchestrates), worker + pool (per-file analysis), validate
src/core/bench/           `skyplate bench`: index (run, write, Markdown), privacy (the closed
                          vocabulary and its validator), shape, diagnostics (the pipeline's
                          side channel), workload (canned queries), recorder (MCP usage),
                          skeleton (anonymous structure and its generator)
docs/                     benchmark.md (the benchmark's privacy contract and fields), audits/
                          (dated measurements of the analyzers), brand/
src/viewer/               React app: state/ (zustand store, loaders, URL), model/ (derived
                          indexes), galaxy/ (engine, shaders, hoverIntent, clicks, groups:
                          hulls, picking, levels), charts/ (+ kit/), shell/ (rail, nav, top bar,
                          + record/), source/, brand/ (mark and wordmark), components/ui
                          (shadcn), lib/ (format, colors, cn)
build.ts                  viewer production build (see "file:// rules" and "Licenses")
scripts/                  brand.ts (mark, wordmark, favicon), third-party-notices.ts, licenses/
                          (vendored license files), gen-languages.ts
src/index.ts              dev server
```

## Rules that hold the design together

- **Change the schema first.** Anything crossing from analyzer to viewer goes through
  `src/shared/schema.ts`. Tables are columnar and reference files, symbols and authors by
  integer id. Run `validateReport` (`src/core/validate.ts`) in tests after any change to the
  report's shape.
- **file:// rules.** Reports must open by double-clicking `index.html`. Browsers block
  `fetch()` and module scripts over file://, so:
  - data ships as classic scripts calling `window.__skyplate.resolve(name, payload)`
    (`DATA_GLOBAL` in schema.ts; loaded by `src/viewer/data/load.ts`);
  - `build.ts` bundles the viewer as an IIFE behind a plain deferred `<script>`, and
    highlight.js as a second lazily injected IIFE;
  - all asset URLs stay relative.

  Don't switch to Bun's HTML entrypoint for production, and don't add `fetch()` for report
  data.
- **The npm package ships the CLI's source and a pre-built viewer, nothing else** (`files` in
  `package.json`). So `dependencies` holds only what `bin/`, `src/cli`, `src/core` and
  `src/shared` import at runtime (today `typescript`, `ignore`, `d3-force-3d`); the viewer's
  packages are `devDependencies` because `dist/viewer` arrives already bundled. `src/mcp` ships
  too and adds `@modelcontextprotocol/server` and `zod`; the SDK's client is a devDependency,
  for tests only. A new bare import in those five directories goes in `dependencies`, or
  installed copies fail with a missing module that `bun test` in a checkout never sees. CI
  packs, installs and runs the tarball on every PR for that reason (the CLI, then
  `scripts/mcp-smoke.ts`); repeat it with `bun pm pack` and an install before a release.
- **Secrets are never embedded.** `Detection.secret` files are measured but carry no content
  and no hash, and the MCP server never returns their text, live or from a report. Keep it
  that way.
- **The MCP server answers by the viewer's rules.** What counts as a caller, a code edge versus
  a link, own code, and how a name ranks are shared (`src/shared/calls.ts`, `search.ts`,
  `isOwnCode`), so an agent and a reader of the same report read the same numbers; change them
  there, never in a copy. stdout is the protocol channel under `skyplate mcp`: nothing on that
  path may write to it. Analysis runs in a queue, one at a time, and long work is a job that
  answers after `wait_seconds` rather than outliving a client's deadline. Builds default to the
  user cache directory, never into the project.
- **Agents reach for a tool that answers the moment they are in.** The server's `instructions`
  and each skill's `description` are the only text in context before an agent decides to look,
  so they name moments (about to search a large repository, about to rename, done editing),
  not measurements. `map_codebase`, `locate_code` and `change_impact` are registered first for
  the hosts that show tool names only. Every tool goes through `guarded` in `server.ts`, which
  turns a thrown error into one the model can act on, appends the follow-up hint, and counts
  the call; every schema is built by `toolArgs`, so an argument a tool does not take is an error
  naming the ones it does, never a silently different question. Answers that can grow take a
  `token_budget` and cut rows, never totals (`text.ts` `fitBudget`). A new tool or argument also
  goes in `TOOLS` / `PARAMS` in `src/core/bench/privacy.ts`; a test fails until it does.
- **A first analysis answers in two steps.** `workspace.ts` runs a structure pass (no git, no
  symbols, no layout) and publishes it as a `partial` snapshot before the full analysis, because
  history took 509 s on a 32k-file repository and the structure 2.5 s. Only tools registered
  with `"structure"` answer from it, with a note; a symbol or history question sees the analysis
  as still running. A partial snapshot is never written as a report or reused by a build.
- **The benchmark is anonymous by construction, not by scrubbing.** Everything in a
  `skyplate bench` file is a number, a boolean or a string from the lists in
  `src/core/bench/privacy.ts`, none of them derived from the analyzed project, and
  `validateBenchmark` fails closed before anything is written. Counts and sizes are powers of
  two, durations two significant figures, shares hundredths; a precise rate beside a precise
  duration would be a precise count, so throughputs stay coarse. Never add free text (a message,
  a path, a name), never add a network call, and extend the canary test (`test/bench.test.ts`)
  with whatever new source of strings a change touches. The Markdown is a generic layout of the
  JSON so that no field can be in one and not the other. Extra numbers reach the benchmark
  through the pipeline's optional diagnostics argument, a side channel; the Report is unchanged.
- **TypeScript analysis uses the async API** (`typescript/unstable/async`). The sync client
  reads Node-internal pipe handles that Bun does not have.
- **Never write into an analyzed project.** The CLI refuses to replace a folder that isn't a
  Skyplate report, or the project itself (`site.ts`). A report written before the rename (as
  starchart) still counts as a report, but only when both of its old markers hold together
  (`REPORT_MARKS` in `site.ts`): an unrelated tool also calls itself starchart.
- **Licenses travel with every report.** Sharing a report redistributes the viewer and all it
  bundles, so `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES` sit at the top of every report
  folder (`writeSite` checks they arrived) and the bundled scripts open with a one-line
  `/*! … */` banner, outside the IIFE. `THIRD_PARTY_NOTICES` is generated by `build.ts` from
  the bundles' metafiles (`scripts/third-party-notices.ts`): never edit it by hand. A newly
  bundled package that publishes no license file fails the build; vendor its upstream LICENSE,
  verbatim, under `scripts/licenses/<name>` with a `.source` file naming the URL.
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

The viewer's direction is **Plate Archive**: a codebase photographed onto glass and
catalogued. The contract is in `.impeccable/surfaces/src-viewer-index-html.md` and the shipped
system in `DESIGN.md`. In short:
- silver-gelatin monochrome chrome: a cool silver ground, white paper, ink, hairlines, and
  hue only on measured marks and the reserved signals;
- one rail holds everything that moves you around (brand, project, find, the five views, the
  drawers); there is no top bar on wide screens, and a slim one below 1024px;
- the plate is dark glass in both themes and carries its own encodings (Gravity, Display);
- Archivo (condensed for the UI, its widest setting for the wordmark) with JetBrains Mono for
  paths and figures;
- holotype red (`#c23a2b`) reserved for each region's most depended-on file and nothing
  else, so critical status is ink, not red;
- the mark is a notched glass plate with one star under the hover reticle; it is drawn from
  `scripts/brand.ts`, never redrawn by hand.

Colors come from `src/viewer/styles.css` / `src/viewer/lib/colors.ts`, which were checked
with the dataviz skill's palette validator. Don't add hues ad hoc; categorical sets cap at
seven slots plus Other. Use the shadcn components in `src/viewer/components/ui` for standard
controls; they are themed through the semantic tokens in `styles.css`.

The impeccable design hook runs on edits. Its findings are design feedback, not noise.

## Testing against real projects

`bun test` builds small fixture repos. For realistic checks, run the CLI on a few public
clones (a TypeScript monorepo, a Python project, a Go project) and open the reports. Never
analyze into, or write inside, a repository you don't own.
