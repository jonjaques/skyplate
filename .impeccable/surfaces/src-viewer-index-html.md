---
version: 1
slug: "src-viewer-index-html"
primary_target: "src/viewer/index.html"
related_targets: []
---

## Scope

The starchart report viewer: the static site the CLI writes for one analyzed project. One
application screen with four work areas (Galaxy, Charts, Explorer, Source) plus Findings.
Visitor mode: Operate. Build path: code-led (no comps; the chosen HTML sketch at
`.impeccable/mocks/decision/assigned.html` is the composition to match and the finish
review's reference).

## Audience and task

Developers orienting in an unfamiliar repo, teams and stakeholders reading a shared report,
maintainers running recurring audits. The task: name the project's regions, its most
depended-on files, its hotspots, and who knows what, within a minute of opening.

## Direction contract

THESIS: Every file is a catalogued specimen, classified, labeled, and pinned where it was
collected. Refuses the category default: a near-black card grid with a KPI row and one blue
accent.

OWN-WORLD: Tray-white ground (#f6f7f5) ruled by 1px hairlines into unit trays, with no cards
and no shadows. A solid archival-box gray-blue rail (#4e6170) holds the drawers (directories).
Ink #15191c. Holotype red #c23a2b is reserved for each region's most-depended-on file and
nothing else. The galaxy sits on a dark glass plate (#0b1016). Type: Archivo at condensed
widths for UI and labels, JetBrains Mono for paths and figures. Specimen labels are white
cards with a 1px ink title rule, Language/Category/Path/Collector/Collected fields, and an
italic det. line. Dark theme: the rail deepens, trays go to slate, and the plate is
unchanged.

STORY: The reader sees the whole collection as a galaxy, opens a drawer to focus a region,
reads pinned labels to learn what each specimen is and who collected it, and follows the
red holotypes to the files that everything depends on. Then they audit hotspots, history,
and ownership in the trays.

FIRST VIEWPORT: The rail on the left (260px) shows the wordmark, the repo and HEAD, and the
drawer list with counts, with the active drawer inverted to tray white. A top bar holds the
tabs (Galaxy, Charts, Explorer, Source, Findings), find, the color-by select, and actions.
The center is the galaxy plate, filling the height and carrying the drawer title, the pinned
labels, the holotype label, and the legend. On the right (340px) is the accession record for
the selection. Along the bottom is a row of three unit trays: language composition, commit
activity, hotspots with an alert. Signature interaction: hovering or selecting a star pins a
specimen label to it with a hairline leader. Motion grammar: the camera eases to a focused
drawer and the layout morphs between tree and import graph, both damped with no overshoot.
The history scrubber remaps every mark at once.

FORM: Specimen Cabinet, #3 of the ordered list (1 Geological survey, 2 Nautical chart,
3 Specimen cabinet, 4 Observatory plate archive, 5 Isotype, 6 NASA graphics standards
manual, 7 Transit diagram). seed:b1138d87fe1db105. Raises kept from declined challengers:
one history scrubber (Type Specimen), one region geometry per directory (Garden Guide Map),
1-device-pixel rules from layout (Centre-Rail Edition), focus that dims the rest
(Title Card Wall).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Exact dark-theme steps get validated with the dataviz palette script during the build.
