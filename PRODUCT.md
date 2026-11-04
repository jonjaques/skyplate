# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Pinned by the user: Bun (runtime, package manager, and the Bun React starter template's
bundler + dev server), React, Tailwind CSS v4, D3, react-three-fiber, three.js.

## Users

One audience in three situations, all confirmed:

- **Orienting in an unfamiliar repository.** A developer points Skyplate at a codebase they
  have never seen and needs to learn fast where things live, what is central, and what is risky.
- **Sharing with a team or stakeholders.** A report gets attached to a PR, handed to a client,
  or used in an architecture review, so people who did not run the tool read it too.
- **Recurring health audits.** A maintainer re-runs it on projects they own to watch hotspots,
  churn, ownership concentration, and dependency tangles.

## Product Purpose

Skyplate turns any project directory into an explorable report. One command
(`skyplate <path>`) walks the tree, recognizes every kind of file (source in any language,
markup, config, data, docs, notebooks, media, binaries), measures it, reads its imports and
its git history, and writes a static site that pairs a 3D map of the codebase with a
statistical dashboard and a source reader.

Success: within a minute of opening a report, a reader can name the project's main regions,
its most depended-on files, its riskiest hotspots, and who knows which parts.

## Positioning

The map is the codebase's real structure and history, not decoration: every point is a file,
its place comes from the directory tree or from its import graph, and its size, color, and
glow come from measured metrics. The same selection drives the 3D map, every chart, and the
source view.

## Operating Context

- Run from a terminal against a local checkout. The CLI writes a **static site folder**
  (`index.html` plus assets, data files and its license notices) that opens by
  double-clicking `index.html`: the viewer ships as classic scripts, which browsers run over
  `file://`. The CLI also serves a folder, for other machines and locked-down browsers.
- Works with or without git. With git, history adds churn, authorship, age, and
  co-change coupling.
- Reports can be large (tens of thousands of files) and must stay responsive.

## Capabilities and Constraints

- Language and document recognition by extension, filename, shebang, and content sniffing,
  with category assignment (code, markup, data, config, prose, style, test, build, asset,
  binary, generated/vendored, lockfile).
- File contents are embedded with per-file and total size caps; `--no-source` omits them
  for reports that get shared.
- Static output only; no backend at view time.

## Brand Commitments

- Name: **Skyplate** in prose; `skyplate` (lowercase) is the CLI command, the npm package and
  the wordmark. Renamed from starchart before the first release: the name collided with an
  existing codebase-mapping tool.
- The name comes from astronomical photographic plates, the sky recorded on glass and then
  catalogued. The identity leans on the plate and the catalog, not on the word "galaxy" (the
  closest visual competitor is a 3D file-star galaxy).
- Licensed Apache-2.0. Every report carries LICENSE, NOTICE and THIRD_PARTY_NOTICES.

## Evidence on Hand

No real users, testimonials, or benchmarks exist. Demonstration reports are generated from
real repositories at build time; do not invent performance or adoption claims.

## Product Principles

1. Every visual mark is a measured fact about a file; nothing is decorative data.
2. One selection, everywhere: the map, charts, explorer, and source agree at all times.
3. Recognize everything; when a file type is unknown, say so instead of guessing silently.
4. The report must stand on its own for a reader who never ran the tool.
5. Scale is a feature: large repositories degrade gracefully, never break.
