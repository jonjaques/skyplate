---
version: 1
slug: "src-viewer-index-html"
primary_target: "src/viewer/index.html"
related_targets: []
---

## Scope

The Skyplate report viewer: the static site the CLI writes for one analyzed project. One
application screen with five work areas (Plate, Charts, Explorer, Source, Findings) plus the
accession record. Visitor mode: Operate. Build path: code-led; no comp. The Specimen Cabinet
sketch at `.impeccable/mocks/decision/assigned.html` is the superseded direction's reference,
kept as history, not as a composition to match.

## Audience and task

Developers orienting in an unfamiliar repo, teams and stakeholders reading a shared report,
maintainers running recurring audits. The task: name the project's regions, its most
depended-on files, its hotspots, and who knows what, within a minute of opening.

## Direction contract

THESIS: A codebase photographed onto glass, then catalogued: the plate is the image and the
chrome is the catalog around it. Chrome is silver-gelatin monochrome so that every hue on
screen is a measured fact. Refuses the category default: a navy sidebar, a top tab bar of
form controls, and a KPI card grid with one blue accent.

OWN-WORLD: Cool silver ground (#f4f6f8), white paper (record, popovers, the active row), ink
#11171d, hairlines #dde2e8, 6px control corners; dark theme drops the ground to #13181e and
paper to #181e25. The plate is dark glass #0b1016 in both themes. Holotype red #c23a2b is each
region's most depended-on file and nothing else. Archivo condensed (88%) for UI, Archivo at
its widest (125%, 600) for the lowercase wordmark, JetBrains Mono for paths and figures. The
mark is a notched glass plate with one star under the four-tick hover reticle; positive on
light grounds, negative on dark.

STORY: The reader opens a report and sees the whole project as a plate of stars, names its
regions from the labels, follows the red holotypes to the files everything depends on, opens a
drawer to focus a region, and reads the accession record for what was measured. Then the
trays, charts and findings give hotspots, history and ownership.

FIRST VIEWPORT: Left, a 264px rail on the silver sleeve tone: the lockup, the project and its
branch and commit, a find field (⌘K), the five views as a vertical list with icons (active =
paper row with a hairline, Findings shows its severity icon and count), then the drawers with
mono counts, then a foot with the generation date, totals, theme and About. No top bar. Center,
the plate fills the height: its title (project in plate ink, the specimen count muted), the
breadcrumb, Web/Imports, Gravity, Display (color, size, lanes) and reset at top right, the
legend inset at bottom left, the history scrubber along the foot; below it three unit trays
(language composition, commit activity, hotspots) at 216px. Right, the 340px accession record
on paper. Below 1024px the rail becomes a sheet and a slim 52px bar carries the mark, the
views as a pill control, find and theme. Signature interaction: the hover reticle (four short
ticks) commits to a specimen label pinned by a hairline leader; the same reticle is the brand
mark. Motion grammar: damped camera eases and layout morphs, no overshoot; the loading plate
develops its stars in turn.

FORM: Observatory plate archive, #4 of the original ordered list, pinned by the brief (the
rename to Skyplate names astronomical photographic plates), evolved from Specimen Cabinet (#3),
whose catalog vocabulary (specimens, holotypes, drawers, accession records) it keeps.
seed: none (no roll this round: the direction was pinned by the brief, so concept-seed was not run)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The sequential ramp's lightest step (#cde2fb) fails the validator's ordinal light-end check
  on the light ground (1.22:1); the ramp is used as a continuous magnitude scale whose
  near-zero end recedes on purpose, and was not restepped in this round.
