---
name: starchart
description: A static report that catalogs every file in a repository as a pinned, labeled specimen.
colors:
  tray: "#f6f7f5"
  paper: "#ffffff"
  wash: "#eef0ee"
  ink: "#15191c"
  ink-2: "#3b4348"
  ink-3: "#5d666d"
  rule: "#d5d9d6"
  rule-strong: "#b9c0c4"
  rail: "#4e6170"
  rail-deep: "#41525f"
  rail-line: "#5d707e"
  rail-ink: "#ffffff"
  rail-muted: "#dfe6eb"
  holotype: "#c23a2b"
  holotype-ink: "#ffffff"
  label-stock: "#ffffff"
  plate: "#0b1016"
  plate-ink: "#e9eef1"
  plate-muted: "#aeb8bf"
  plate-rule: "#26313a"
  good: "#0ca30c"
  warning: "#fab219"
  serious: "#ec835a"
  series-1: "#2a78d6"
  series-2: "#eb6834"
  series-3: "#1baf7a"
  series-4: "#eda100"
  series-5: "#e87ba4"
  series-6: "#008300"
  series-7: "#6250d6"
  series-other: "#9aa4aa"
  series-dark-1: "#3987e5"
  series-dark-2: "#d95926"
  series-dark-3: "#199e70"
  series-dark-4: "#c98500"
  series-dark-5: "#d55181"
  series-dark-6: "#008300"
  series-dark-7: "#9085e9"
  series-dark-other: "#6b767d"
  seq-100: "#cde2fb"
  seq-200: "#9ec5f4"
  seq-300: "#6da7ec"
  seq-400: "#3987e5"
  seq-500: "#256abf"
  seq-600: "#184f95"
  seq-700: "#0d366b"
  measure-dark: "#8da2b2"
  dark-tray: "#161c20"
  dark-paper: "#1c2328"
  dark-wash: "#222a30"
  dark-ink: "#e8ecee"
  dark-ink-2: "#c4ccd1"
  dark-ink-3: "#9aa5ad"
  dark-rule: "#2b3439"
  dark-rule-strong: "#3d484f"
  dark-rail: "#2c3a45"
  dark-rail-deep: "#24303a"
  dark-rail-line: "#3a4a56"
  dark-rail-muted: "#d8dfe4"
  dark-holotype: "#b8402f"
typography:
  wordmark:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 80"
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    fontVariation: "'wdth' 85"
  figure:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 85"
  headline:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 82"
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
    fontVariation: "'wdth' 88"
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontVariation: "'wdth' 88"
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
    fontVariation: "'wdth' 88"
  label-stock-title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.35
    fontVariation: "'wdth' 80"
  label-stock-field:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
    fontVariation: "'wdth' 75"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum' 1"
  mono-metric:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
  lg: "4px"
  dot: "9999px"
spacing:
  hairline: "1px"
  row-y: "6px"
  tray-x: "18px"
  figure-x: "20px"
  rail-inset: "22px"
  plate-inset: "24px"
components:
  button-primary:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.tray}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.wash}"
  input:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  tab:
    textColor: "{colors.ink-3}"
    typography: "{typography.title}"
    height: "52px"
    padding: "0 16px"
  tab-active:
    textColor: "{colors.ink}"
  drawer-row:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    height: "38px"
  drawer-row-hover:
    backgroundColor: "{colors.rail-deep}"
  drawer-row-active:
    backgroundColor: "{colors.tray}"
    textColor: "{colors.ink}"
  record-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "6px 0"
  record-row-hover:
    backgroundColor: "{colors.wash}"
  tag:
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    padding: "0 4px"
    height: "18px"
  unit-tray:
    backgroundColor: "{colors.tray}"
    textColor: "{colors.ink}"
    padding: "14px 18px 12px"
  specimen-label:
    backgroundColor: "{colors.label-stock}"
    textColor: "{colors.ink}"
    typography: "{typography.label-stock-field}"
    padding: "8px 10px 7px"
    width: "196px"
  specimen-label-holotype:
    backgroundColor: "{colors.holotype}"
    textColor: "{colors.holotype-ink}"
    width: "216px"
  pin-label:
    backgroundColor: "{colors.label-stock}"
    textColor: "{colors.ink}"
    typography: "{typography.label-stock-title}"
    padding: "3px 6px"
  pin-label-holotype:
    backgroundColor: "{colors.holotype}"
    textColor: "{colors.holotype-ink}"
  plate-legend:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-muted}"
    rounded: "{rounded.xs}"
    padding: "8px 10px"
  holotype-badge:
    backgroundColor: "{colors.holotype}"
    textColor: "{colors.holotype-ink}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
---

# Design System: starchart

## Overview

**Creative North Star: "The Specimen Cabinet"**

starchart treats a repository as a natural-history collection: every file is a specimen, every directory a drawer, and the report is the cabinet you open to study them. The application is one dense working screen. A solid gray-blue rail of drawers runs down the left, a pale tray ground holds the work, and the 3D galaxy sits on a dark glass plate that stays dark in both themes. Information is ruled apart by one-pixel hairlines, not boxed into cards. Color is scarce and every hue means something: categorical slots identify languages and categories, a single blue ramp carries magnitude, and one red marks each region's holotype, the file the rest of it depends on most.

Type is set like small label stock. Archivo runs slightly condensed for every word in the interface, and JetBrains Mono carries paths, counts, dates, accession numbers and source. Figures that line up in columns are tabular; large standalone numbers stay proportional. The galaxy's signature is the specimen label: a small white card pinned to a star by a hairline leader, with ruled fields and an italic determination line. A holotype's label is the one printed in red.

Surfaces sit flat. Depth appears only on layers that float over content (menus, popovers, dialogs, the command palette). Motion is damped and never overshoots, and reduced-motion preferences collapse every transition.

**Key Characteristics:**
- Pale tray ground, a solid archival gray-blue rail, ink text, a dark glass plate for the galaxy.
- Hairline rules instead of cards; grids rule their cells with 1px gaps.
- One red, reserved for holotypes.
- Archivo at condensed widths for words, JetBrains Mono for paths and figures.
- Barely rounded label-stock corners (1-4px).
- Flat at rest; shadows only on floating layers.
- Damped motion, no overshoot.

## Colors

A cool, nearly neutral ground with a single archival slate as the structural color, one reserved red, and a validated categorical set used only on marks.

### Primary
- **Archival Slate** (#4e6170): the drawer rail's solid ground and the primary action color (shadcn `primary` and `sidebar` both map here). It is also the single-series "measure" color for magnitude marks such as commit columns, because no categorical slot uses it. Dark theme deepens it (#2c3a45) for the rail; dark-theme measure marks use **Lifted Slate** (#8da2b2).
- **Rail Deep** (#41525f): drawer hover and the rail's accent state. **Rail Line** (#5d707e) rules drawers apart. **Rail Muted** (#dfe6eb) carries counts and secondary text on the rail (5.10:1).

### Secondary
- **Holotype Red** (#c23a2b, dark theme #b8402f): fills holotype labels and pins on the plate, the holotype badge in the record, and the holotype dot beside a path in the explorer, source reader and command palette. Nothing else wears it.

### Tertiary
- **Categorical slots** (series-1 through series-7, plus series-other gray): language and category identity on stars, swatches, stacked bars and legends. Light trays use the light steps; the plate and the dark theme use the series-dark steps. The reference palette's red slot was removed so no category can impersonate the holotype.
- **Sequential blue** (seq-100 to seq-700): magnitude ramps. On light surfaces more is darker; on dark surfaces the anchor flips so more is lighter. seq-200 is also the text selection color.
- **Status** (good, warning, serious): always shipped with an icon and a label. Warning tints the top-hotspot callout (a 13% mix into the tray with a 55% border); serious orange marks an unfavorable delta. Critical has no hue of its own: the critical token is Ink, and shadcn's destructive role maps to it, so a critical mark is a filled ink octagon with its exclamation knocked out in paper.

### Neutral
- **Tray** (#f6f7f5): the page ground and every unit tray. Dark: #161c20.
- **Paper** (#ffffff): the top bar, the accession record panel, popovers and cards. Dark: #1c2328.
- **Wash** (#eef0ee): hover and pressed fills, one step off the tray. Never a hue.
- **Ink** (#15191c), **Ink 2** (#3b4348), **Ink 3** (#5d666d, 5.45:1 on tray): primary, secondary and tertiary text.
- **Rule** (#d5d9d6): hairlines and grid gaps. **Rule Strong** (#b9c0c4): control borders and scrollbar thumbs.
- **Plate** (#0b1016) with **Plate Ink** (#e9eef1), **Plate Muted** (#aeb8bf) and **Plate Rule** (#26313a): the galaxy's glass and its chrome, identical in both themes.
- **Label Stock** (#ffffff): specimen labels on the plate, white in both themes.

### Named Rules
**The Holotype Reservation Rule.** Red means "this region's most-depended-on file" and nothing else. Critical severity is drawn as a solid ink octagon (the critical and destructive tokens are Ink), unfavorable deltas use serious orange, and no categorical slot is red.

**The Ink Text Rule.** Text never wears a data color. Labels, values and legend entries stay in the ink tokens; identity is carried by a swatch dot beside them.

**The Fixed Slot Rule.** Categorical slot order is the color-vision-safety mechanism and is never reordered. Anything past slot 7 folds into the series-other gray.

**The Surface Steps Rule.** Dark surfaces get their own validated steps (series-dark, measure-dark); light colors are never inverted or dimmed to fit a dark ground. The plate always uses the dark steps.

## Typography

**Display Font:** Archivo Variable (with system-ui, sans-serif)
**Body Font:** Archivo Variable (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, monospace)

**Character:** A workmanlike grotesque narrowed on its width axis, like typeset museum labels, beside a mono that makes every path and figure read as catalog data.

### Hierarchy
- **Wordmark** (700, 28px, line-height 1, width 80%): the lowercase "starchart" at the top of the rail. Used once.
- **Display** (600, 24px, width 85%): the plate title (drawer name and specimen count). 20px on narrow plates, 15px on the compact plate.
- **Figure** (600, 34px in stat tiles, 30px in unit trays, line-height 1, -0.015em, width 85%): a single standalone number that is the whole chart. Proportional digits.
- **Headline** (600, 20px, -0.01em, width 82%): Charts tab section headings.
- **Title** (600, 14px): tray and figure headings, top-bar tabs. Record section headings run at 13px.
- **Body** (400, 13px, line-height 1.4, width 88%): the base size for the whole interface. Prose notes cap at 52-72ch.
- **Label** (400, 12px): subtitles, captions, metric labels, rail metadata, usually in Ink 2 or Ink 3.
- **Label stock** (title 700, 13px, width 80%; fields 11px, width 75%): specimen labels and pins on the plate.
- **Mono** (400, 12px, tabular): paths, counts, dates, accession numbers. Record metrics run at 18px weight 500; mono paths in labels and hotspots run at 10.5-11px.

### Named Rules
**The Two Faces Rule.** Words are Archivo; paths, figures, hashes, dates and code are JetBrains Mono. No third family.

**The Condensed Stock Rule.** Interface text runs at 88% width; headings tighten to 80-85%. Width, not size, is how the system fits dense labels.

**The Column Figures Rule.** Figures that align in columns use tabular digits; large standalone numbers stay proportional.

## Layout

A fixed application frame. At 1280px and wider: a 260px drawer rail, the work area, and a 340px accession record on the right. From 1024px the rail narrows to 220px and the record to 300px. Below 1024px the rail becomes a sheet behind a top-bar button, the record follows the work area, and the document scrolls under a sticky top bar.

The top bar is 52px tall on paper, holding the tabs (Galaxy, Charts, Explorer, Source, Findings), find, the color and size selects, and actions. On the Galaxy tab the plate fills the remaining height and a row of three unit trays (language composition, commit activity, hotspots) sits beneath it at 216px, in a 1.15 / 1 / 1.2 split. On compact screens the trays stack, each keeping 216px.

Charts sections are a 12-column grid whose spans always sum to 12 per row; they collapse to one column below a roughly 900px container (container queries, because the tab's width is not the window's). Trays are container-query aware too and drop secondary asides below 250px.

Insets are specific rather than scaled: 22px in the rail, 18px across unit trays (14px top, 12px bottom), 20px across chart figures (16px top, 20px bottom), 24px for plate chrome. Ruled rows run 6px vertical padding; drawer rows are 38px at the top level and 32px when nested, indenting 14px per depth.

### Named Rules
**The Hairline Grid Rule.** Tray boundaries are the grid's 1px gaps showing the rule color through; no tray draws its own border. Every row is full, and a chart with nothing to draw keeps its cell and says why.

**The No-Scroll Tray Rule.** Nothing inside a tray scrolls. Content is sized to its cell, and overflow folds into a count ("16 others") rather than clipping.

## Elevation & Depth

The system is flat. Trays, the rail, the record, buttons, inputs and the active tab carry no shadow: shadcn's `shadow-xs` and `shadow-sm` are a transparent zero shadow (`0 0 #0000`), not `none`, because Tailwind composes them into one box-shadow list with the focus ring and a `none` in that list voids the whole declaration. Depth comes from tone: the rail's solid slate against the tray, paper panels against the tray, and the dark plate against everything. Layers that genuinely float over content (dropdown menus, popovers, hover cards, dialogs, sheets, the command palette) take a soft offset shadow. Seams are rules: a 1px hairline in most places, a 1px ink rule where a block needs a firmer edge (the line above a specimen label's fields, the top of the record panel on compact screens).

### Shadow Vocabulary
- **Flat** (`box-shadow: 0 0 #0000`): the at-rest value of shadow-xs and shadow-sm on controls. Invisible, but a valid list member so focus rings still paint.
- **Float** (`box-shadow: 0 8px 20px -6px rgb(21 25 28 / 0.22), 0 1px 2px rgb(21 25 28 / 0.08)`): menus, popovers, select lists, chart tooltips.
- **Float Large** (`box-shadow: 0 18px 40px -12px rgb(21 25 28 / 0.32), 0 2px 6px rgb(21 25 28 / 0.08)`): dialogs, sheets, the command palette.

### Named Rules
**The Flat Tray Rule.** Anything that sits in the layout sits flat. A shadow says "this is floating above the page" and appears nowhere else.

**The Transparent Flat Rule.** Flat is written as a transparent zero shadow, never `none`, so a control's shadow and its focus ring can share one box-shadow.

## Shapes

Label stock with barely-there corners. The radius scale is set outright (xs 1px, sm 2px, md 3px, lg 4px) because shadcn's derived scale goes negative at these sizes. Buttons, inputs and selects use 3px; tags, legend insets, drawer chevrons and the holotype badge use 1px; the top-hotspot callout uses 3px. Specimen labels and pins are square-cornered. Full rounding is kept for data marks (swatch dots, holotype dots, legend rings) and for the two controls whose form is conventionally round: the switch track and the slider and scrubber thumbs. Borders are always 1px; the active tab is marked by a 2px ink underline.

## Components

### Buttons
Quiet and compact; most actions are ghost or outline so the rail's slate stays the only solid structural color.
- **Shape:** gently squared (3px), 36px default height, 32px small, 24px extra-small.
- **Primary:** Archival Slate fill with white text; hover drops to 90% opacity.
- **Outline:** tray ground with a hairline border; hover fills with wash.
- **Ghost:** no fill; hover fills with wash. On the plate, ghost controls use plate-muted text and a 10% plate-ink hover.
- **Focus:** the border shifts to the ring color and a 3px ring-color halo at 50% opacity draws as a box-shadow (series-1 in light, series-dark-1 in dark). Selects, toggles, switches and checkboxes share it. On the plate, controls use a plate-ink ring instead.

### Tabs
- **Style:** the line variant: no container fill, 13-14px semibold labels in Ink 3, full top-bar height.
- **Active:** Ink text with a 2px ink bottom border. Hover raises text to Ink. The Findings tab carries its severity icon and a mono count.

### Drawer rail
The signature navigation. Solid slate, white text, each drawer ruled by a rail-line hairline, its file count in mono at the right in Rail Muted. Hover deepens to Rail Deep; the active drawer inverts to tray with ink text. Chevrons rotate 90 degrees on the damped ease. The rail's head holds the wordmark, the project name and the branch at HEAD in mono; its foot holds the generation date and totals.

### Unit trays and figures
- **Corner Style:** none; trays are cells of a ruled grid.
- **Background:** tray.
- **Border:** none of their own (see The Hairline Grid Rule).
- **Internal Padding:** 14px 18px 12px for galaxy trays, 16px 20px 20px for Charts figures.
- **Anatomy:** a 14px semibold title (a link with a small up-right arrow when a full chart exists), an optional mono aside, a figure-sized headline, then the plot. Charts figures offer a table-view toggle that swaps the plot for a sortable table of the same values.

### Inputs / Fields
- **Style:** transparent ground (paper in the top bar), 1px Rule Strong border, 3px radius, 36px height (32px small).
- **Focus:** the control halo (border to ring color plus a 3px ring at 50%), as on buttons.
- **Find trigger:** a field-styled button with a search icon, placeholder text and a keyboard hint.

### Record rows, metrics and tags
- **Record row:** a full-width ruled button, label left and a mono figure right in Ink 3, hairline below, wash on hover, focus and when active.
- **Everything else:** rows, links and tray titles take the global focus outline (2px ring color, offset 2px); scrolling panels (the explorer tree, the source reader, record panels) draw it inset at -2px so it is never clipped.
- **Metric grid:** two columns ruled by hairlines; label 12px Ink 3, value 18px mono, optional 11px note.
- **Tag:** 18px-tall hairline badge, 1px radius, Rule Strong border, 10.5px mono in Ink 2.
- **Holotype badge:** 1px radius, red fill, 12px semibold white text, beside the accession number.

### Specimen labels
The plate's signature. Three forms of label stock, all positioned by the plate and joined to their star by a 1px leader line:
- **Card** (196px; 216px for a holotype): bold condensed title over a 1px ink rule, a two-column field list (Language, Category, Path, Collector, Collected) with mono values for paths and dates, and an italic determination line above a hairline. White with ink text; a holotype card is red with white text and a white title rule.
- **Pin:** one line, the file's name in bold condensed type; red with "Holotype ·" for holotypes. Used for secondary holotypes and on narrow plates.
- **Tag:** a selected symbol's one-line summary under its definition.

Labels fade in over 150ms and avoid each other, the plate chrome, region names and the lanes they describe.

### The web
The plate's default arrangement is a cosmic web of the directory tree (`src/shared/web.ts`, computed in the viewer). Top-level directories are superclusters, their children clusters, and so on down; each directory's own files are one clump (a dense core, a sparse halo, a slightly flattened and turned ellipsoid), with its subdirectories orbiting it as satellite clumps, so every directory is one neighborhood and nesting reads as nesting. Gaps widen up the hierarchy: galaxies in a group nearly touch, superclusters sit apart across voids. It is real 3D, seen from a low oblique angle broadside to its widest spread.
- **Filaments:** faint, gently bowed hairlines in lane ink, additive, one draw call. Each strand aggregates the imports between two clusters (brighter for more, by log coupling) and attaches to the files that carry them. The skeleton is the maximum spanning forest plus each cluster's strongest one or two further links; a cluster with no imports floats alone. Strands of the hovered, selected or open group come up while the rest step back.
- **Bridge files:** a file whose imports mostly cross along one strand leans out along it, at most about a third of the way, so strands carry real stars.
- **Gravity:** a plate control chooses what has mass (dependencies, complexity, hotspots, churn, recent change, size). The heaviest files sink to their clump's core, heavier groups draw toward the heart of their cluster, heavy clumps are denser. Star size and color never change with gravity. Each change morphs from wherever the stars are, on the damped curve; reduced motion snaps.
- **Symbol arcs** bow toward the camera's up, perpendicular to their chord, so a function's callers rise over the web as a canopy rather than threading through the knots between them.

### Plate chrome
The plate title (display type in plate ink), the Web/Imports toggle, the Gravity menu (each mode with a one-line description; disabled, with a tooltip saying why, in the Imports layout and for history modes without git) and the Lanes control, and a legend inset: solid plate fill with a plate-rule hairline and 1px corners, swatch-led entries that isolate a language on click, the holotype key, one line stating the current gravity, and one line keying the strands. The history scrubber runs along the plate's bottom.

## Do's and Don'ts

### Do:
- **Do** rule regions apart with 1px hairlines in the rule color, using grid gaps so every edge is one device pixel.
- **Do** keep text in ink, Ink 2 or Ink 3 and put identity on a swatch dot beside it.
- **Do** use the series-dark steps on the plate and in the dark theme, and measure-dark for single-series magnitude marks there.
- **Do** ship direct labels or a table view with any chart that relies on light slots 2-5; they sit under 3:1 on the tray.
- **Do** pair every status color with an icon and a label.
- **Do** set paths, counts, dates and accession numbers in JetBrains Mono with tabular figures.
- **Do** ease camera moves, chevrons and layout morphs with the damped curve (cubic-bezier(0.22, 1, 0.36, 1)) and no overshoot; hover color changes take 150ms.
- **Do** fold overflow into a count instead of scrolling inside a tray.

### Don't:
- **Don't** use holotype red for anything but a region's most-depended-on file: not for errors, critical severity, negative deltas or a chart series.
- **Don't** give in-layout surfaces (trays, panels, buttons, inputs, tabs) a shadow; shadows belong to floating layers only.
- **Don't** wrap trays in bordered or rounded cards.
- **Don't** reorder the categorical slots or add a red slot.
- **Don't** invert or dim light-surface colors to fit a dark surface.
- **Don't** let the plate follow the theme; it is dark glass in both.
- **Don't** round corners past 4px on structural elements; full rounding is for data dots, the switch track and slider thumbs.
- **Don't** introduce a third typeface.
