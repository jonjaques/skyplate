---
name: Skyplate
description: A static report that photographs a repository onto a glass plate and catalogs every file as a specimen.
colors:
  tray: "#f4f6f8"
  paper: "#ffffff"
  wash: "#eaeef2"
  rail: "#eef1f4"
  ink: "#11171d"
  ink-2: "#39434d"
  ink-3: "#5a6571"
  rule: "#dde2e8"
  rule-strong: "#c2cad2"
  measure: "#4e6170"
  holotype: "#c23a2b"
  holotype-ink: "#ffffff"
  label-stock: "#ffffff"
  plate: "#0b1016"
  plate-ink: "#e9eef1"
  plate-muted: "#aeb8bf"
  plate-rule: "#26313a"
  mark-plate: "#0b1016"
  mark-ink: "#ffffff"
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
  dark-tray: "#13181e"
  dark-paper: "#181e25"
  dark-wash: "#1f262e"
  dark-rail: "#0f1419"
  dark-ink: "#e8edf1"
  dark-ink-2: "#c3ccd3"
  dark-ink-3: "#98a3ad"
  dark-rule: "#262e36"
  dark-rule-strong: "#36404a"
  dark-measure: "#8da2b2"
  dark-holotype: "#b8402f"
  dark-mark-plate: "#e9eef2"
  dark-mark-ink: "#0b1016"
typography:
  wordmark:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 125"
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    fontVariation: "'wdth' 85"
  record-title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.15
    fontVariation: "'wdth' 80"
  figure:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "30px"
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
  nav:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.4
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
  region-name:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    fontVariation: "'wdth' 80"
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
  xs: "2px"
  sm: "4px"
  segment: "5px"
  md: "6px"
  lg: "8px"
  dot: "9999px"
spacing:
  hairline: "1px"
  row-y: "6px"
  rail-x: "16px"
  rail-nav-x: "12px"
  rail-indent: "12px"
  tray-x: "18px"
  plate-edge: "16px"
  plate-title-x: "24px"
  record-x: "22px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
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
  find-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  rail-view:
    textColor: "{colors.ink-2}"
    typography: "{typography.nav}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  rail-view-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  rail-view-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  drawer-row:
    textColor: "{colors.ink-2}"
    typography: "{typography.nav}"
    rounded: "{rounded.md}"
    height: "30px"
  drawer-row-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  bar-view-pill:
    backgroundColor: "{colors.wash}"
    rounded: "{rounded.md}"
    padding: "3px"
    height: "36px"
  bar-view-pill-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.segment}"
    height: "28px"
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
    height: "216px"
  holotype-badge:
    backgroundColor: "{colors.holotype}"
    textColor: "{colors.holotype-ink}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
  plate-button:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-muted}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  plate-legend:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-muted}"
    rounded: "{rounded.lg}"
    padding: "8px"
  region-name:
    textColor: "{colors.plate-muted}"
    typography: "{typography.region-name}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  specimen-card:
    backgroundColor: "{colors.label-stock}"
    textColor: "{colors.ink}"
    typography: "{typography.label-stock-field}"
    padding: "8px 10px 7px"
    width: "196px"
  specimen-card-holotype:
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
  scrubber:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-muted}"
    height: "52px"
---

# Design System: Skyplate

<!-- Recorded from the shipped viewer (src/viewer). The project was renamed to Skyplate from
     "starchart"; this file replaces the superseded Specimen Cabinet system. -->

## Overview

**Creative North Star: "The Plate Archive"**

Skyplate treats a repository as an astronomical photographic plate and the report as the archive that catalogs it. The plate is the image: a dark glass field, identical in both themes, on which every file is a star. Everything around it is the catalog, set in silver-gelatin monochrome: a cool silver ground, white paper for the record and floating layers, ink text, and one-pixel hairlines. Because the chrome has no hue of its own, every hue on screen is a measured fact: a language, a category, a magnitude, a status, or the one reserved red.

The catalog vocabulary of the earlier Specimen Cabinet direction stays: files are specimens, directories are drawers, the most depended-on file in each region is its holotype, and the right column is the accession record. What changed is the material. The solid slate rail is gone (a big dark rail fought the plate for the eye); the rail is now a sleeve a half step below the ground. The plate is marked as a plate: registration corners and an inscription of commit, branch and date on the glass. The brand mark is a notched plate with one star under the same four-tick reticle the viewer draws on hover.

Type is Archivo on its width axis: condensed (88%) for the interface, tighter for headings and label stock, and at its widest (125%) only in the lowercase `skyplate` wordmark. JetBrains Mono carries paths, figures, hashes and dates. Surfaces sit flat; only layers that float over content take a shadow. Motion is damped, never overshoots, and collapses under reduced motion.

**Key Characteristics:**
- Cool silver ground, white paper, ink; no chrome hue.
- A dark glass plate in both themes, with registration corners and an inscription.
- One red, reserved for holotypes; critical severity is ink.
- Hairline rules instead of cards; flat at rest, shadows only on floating layers.
- Archivo condensed for words, Archivo wide for the wordmark only, JetBrains Mono for data.
- Small consistent corners: 6px controls, 8px plate insets, round data marks.
- Damped motion, no overshoot; the loading plate develops its stars.

## Colors

A silver-gelatin monochrome catalog around a dark glass plate, with hue spent only on validated marks and reserved signals.

### Primary
- **Catalog Ink** (ink): text, and the fill of the primary button (shadcn `primary` maps to ink, `primary-foreground` to paper). Primary actions are printed in ink, not a hue. **Ink 2** is secondary text and the focus ring; **Ink 3** is tertiary text (5.48:1 on the ground, 5.24:1 on the rail).

### Secondary
- **Holotype Red** (holotype; dark-holotype in the dark theme): fills holotype specimen cards and pins on the plate, the holotype badge in the file record, and the holotype dot beside a path in the record, explorer, source reader and command palette. Nothing else wears it.

### Tertiary
- **Categorical slots** (series-1 to series-7, plus series-other): language and category identity on stars, swatches, bars and legends. The reference palette's red slot is removed so no category can impersonate the holotype. Light trays use the light steps; the plate and the dark theme use the series-dark steps.
- **Sequential blue** (seq-100 to seq-700): magnitude. On light surfaces more is darker; on dark surfaces the anchor flips so more is lighter. The viewer samples a 13-step interpolation of the same ramp (`lib/colors.ts`). seq-200 is the text selection color.
- **Measure Slate** (measure; dark-measure): single-series magnitude marks such as commit columns and size histograms. It belongs to no categorical slot, so a bar never reads as "slot 1's commits". 5.93:1 on the light ground, 6.75:1 on the dark one.
- **Status** (good, warning, serious): always with an icon and a label. Serious marks warnings and unfavorable deltas, warning marks notices and tints a severe top-hotspot callout (a 13% mix into the tray, 55% border). There is no critical hue: the critical and destructive tokens are ink, and a critical mark is a filled ink octagon.

### Neutral
- **Silver Ground** (tray; dark-tray): the page, unit trays, charts and explorer.
- **Print Paper** (paper; dark-paper): the accession record, popovers, the source reader, and the active rail row.
- **Wash** (wash; dark-wash): hover and pressed fills, one step below the ground; also the active row in the dark theme. Never a hue.
- **Sleeve** (rail; dark-rail): the rail and the slim top bar, a half step below the ground.
- **Hairline** (rule; dark-rule) and **Control Edge** (rule-strong; dark-rule-strong): dividers and grid seams; control borders and scrollbar thumbs.
- **Plate Glass** (plate) with **Plate Ink**, **Plate Muted** (9.46:1 on the plate) and **Plate Rule**: the galaxy's glass and its chrome, identical in both themes.
- **Label Stock** (label-stock): specimen labels, white in both themes, because it is paper laid on glass.
- **Mark Plate / Mark Ink** (mark-plate, mark-ink; dark-mark-plate, dark-mark-ink): the brand mark's two colors, swapped in the dark theme.

### Palette validation
Every color was checked with the dataviz skill's palette validator on the surface it renders on. Every categorical slot passes on the new grounds. Light slots 2-5 sit under 3:1 on the ground (#f4f6f8), so every chart that relies on them ships direct labels or a table view. The dark set passes on the dark ground and on the plate. series-other fails the chroma floor by design: it is the fold-in bucket. seq-100 fails the ordinal light-end check on the light ground (1.22:1); it is a continuous scale whose near-zero end recedes, and this is recorded as unresolved in the surface brief.

### Named Rules
**The Holotype Reservation Rule.** Red means "this region's most depended-on file" and nothing else. Critical severity is ink, unfavorable deltas are serious orange, and no categorical slot is red.

**The Silver Chrome Rule.** The chrome has no hue. Primary actions, active rows, focus rings and the hover wash are ink, paper and gray; any hue on screen is data or a reserved signal.

**The Ink Text Rule.** Text never wears a data color. Labels, values and legend entries stay in ink tokens; identity rides on a swatch dot beside them.

**The Fixed Slot Rule.** Slot order is the color-vision-safety mechanism and is never reordered. Anything past slot 7 folds into series-other.

**The Surface Steps Rule.** Dark surfaces get their own validated steps (series-dark, dark-measure); light colors are never inverted or dimmed to fit. The plate always uses the dark steps.

## Typography

**Display Font:** Archivo Variable (with system-ui, sans-serif)
**Body Font:** Archivo Variable (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, monospace)

**Character:** A workmanlike grotesque narrowed on its width axis, like a catalog's label stock, beside a mono that makes every path and figure read as measured data. The only wide setting is the wordmark.

### Hierarchy
- **Wordmark** (600, width 125%, -0.02em): the lowercase `skyplate`, outlined to paths by `scripts/brand.ts` so it never flashes a fallback face. 18px tall in the rail lockup, beside the mark at 1.2 times that.
- **Display** (600, 24px, width 85%): the plate title. 20px on plates under 640px, 15px on the compact plate. The project and the slim bar's project name use 15px at 85%.
- **Record title** (700, 22px, line-height 1.15, width 80%): the accession record's heading, with the parent path above it in 12px mono Ink 3 when there is one.
- **Figure** (600, 30px, line-height 1, -0.015em, width 85%): the single standalone number that heads a unit tray. Proportional digits.
- **Headline** (600, 20px, -0.01em, width 82%): Charts section headings.
- **Title** (600, 14px): tray titles. Record section headings and the Display popover's title run at 13px.
- **Nav** (500, 13.5px): rail views and top-level drawers; nested drawers 13px regular.
- **Body** (400, 13px, line-height 1.4, width 88%): the base size of the interface.
- **Label** (400, 12px): captions, asides, metric labels, usually Ink 2 or Ink 3; rail foot and branch line at 11.5px.
- **Region name** (600, 12px, width 80%): names on the plate, with a 10.5px mono count.
- **Label stock** (title 700, 13px, width 80%; fields 11px, field names width 75%; pins 11px bold): specimen cards and pins.
- **Mono** (400, 12px, tabular): paths, counts, dates, hashes; 11px for counts in rails and lists, 10.5px in tags and the plate inscription. Record metrics run at 18px, weight 500.

### Named Rules
**The Two Faces Rule.** Words are Archivo; paths, figures, hashes, dates and code are JetBrains Mono. No third family, and no system display face.

**The Width Axis Rule.** Interface text runs at 88% width; headings and label stock tighten to 75-85%. Width, not size, fits dense labels. 125% belongs to the wordmark alone.

**The Column Figures Rule.** Figures that align in columns are tabular. Figures inside running text stay in Archivo with tabular digits (MetaText), so a comma never gets a full mono cell.

## Layout

A fixed application frame with no top bar on wide screens: each work area opens with its own header, and the plate takes the height a bar would.

- **1280px and wider:** a 264px rail, the work area, and a 340px accession record on paper.
- **1024px to 1279px:** a 224px rail and a 300px record.
- **768px to 1023px:** the rail becomes a 288px sheet. A slim 52px bar on the sleeve tone carries the drawers button, the mark, the project name, the views as a pill control, find, and theme. The record follows the work area and the document scrolls under the sticky bar.
- **Under 768px:** one column; the bar takes two rows (the views get a full-width row of their own), and the plate takes about 60% of the viewport (min 360px).

The rail runs, top to bottom: the lockup (18px top inset), the project name and branch at HEAD, the find field, the five views (Plate, Charts, Explorer, Source, Findings) as a vertical list, the drawers with mono counts, and a foot with the generation date, totals, theme and About. Its insets are 16px for text and 12px for the find field and views; drawers indent 12px per depth.

On the Plate view the plate fills the height, with its 52px history scrubber along the foot, and a row of three unit trays (language composition, commit activity, hotspots) sits beneath at 216px in a 1.15 / 1 / 1.2 split; on compact screens they stack at 216px each. Plate chrome keeps 16px from the plate's edges; the title sits 24px in. The record's content is inset 22px.

Charts sections are 12-column grids collapsing to one column under a roughly 900px container; trays and the plate use container queries because their width is not the window's. Ruled rows take 6px vertical padding.

### Named Rules
**The Hairline Grid Rule.** Regions are separated by 1px rules in the rule color; no tray draws its own box. A chart with nothing to draw keeps its cell and says why.

**The No-Scroll Tray Rule.** Nothing inside a unit tray scrolls. Overflow folds into a count ("6 others").

## Elevation & Depth

The system is flat. The rail, trays, record, buttons, inputs and the active row carry no shadow; depth comes from tone (the sleeve under the ground, paper on the ground, the dark plate against everything) and from hairlines. In the dark theme the plate keeps a hairline edge from the shell so it never merges into the ground. Layers that genuinely float (menus, popovers, select lists, hover cards, dialogs, sheets, the command palette) take a soft offset shadow. On the plate, chrome that stars can pass behind (controls, the legend, the scrubber, the inscription) is backed by the plate's own color, which occludes without reading as a panel; region names get a plate-colored halo, as a map knocks a road out from under a town name.

### Shadow Vocabulary
- **Flat** (`box-shadow: 0 0 #0000`): shadow-xs and shadow-sm, on controls. Invisible but a valid list member, so focus rings still paint.
- **Float** (`box-shadow: 0 10px 24px -8px rgb(17 23 29 / 0.22), 0 1px 2px rgb(17 23 29 / 0.08)`): dropdown menus, popovers, hover cards, select lists.
- **Float Large** (`box-shadow: 0 22px 48px -14px rgb(17 23 29 / 0.34), 0 2px 6px rgb(17 23 29 / 0.08)`): dialogs (the command palette and About among them), sheets, and submenus.

### Named Rules
**The Flat Tray Rule.** Anything that sits in the layout sits flat. A shadow means "floating above the page" and appears nowhere else.

**The Transparent Flat Rule.** Flat is a transparent zero shadow, never `none`: Tailwind composes shadow and focus ring into one box-shadow list, and a `none` in it voids the whole declaration.

**The Glass Backing Rule.** On the plate, occlusion uses the plate's own color (fills, halos), never a bordered panel or a shadow.

## Shapes

Small, consistent corners, set outright because shadcn's derived scale goes negative at these sizes: 2px for tags, the holotype badge and crumb hit areas; 4px for region-name plaques and small plate wrappers; 5px for segments inside a pill control; 6px for buttons, inputs, selects, the find field, rail rows and plate buttons; 8px for plate insets (the legend) and dialogs. Specimen cards and pins are square-cornered label stock. Full rounding is kept for data marks (swatch and holotype dots, the leader's end dot) and for conventionally round controls (switch track, slider and scrubber thumbs). Borders are always 1px.

The brand mark is a 32-unit glass square with 5-unit corners and an 8-unit identification notch chamfered from the top right; one star sits under a four-tick reticle, with two fainter stars. The plate's registration corners repeat the language: 11px L-shaped hairlines in plate ink at 28%, inset 5px.

## Components

### Buttons
Quiet and compact; most actions are ghost or outline so ink stays the only solid.
- **Shape:** 6px corners; 36px default, 32px small, 24px extra-small.
- **Primary:** ink fill, paper text; hover at 90%.
- **Outline:** ground fill with a hairline; hover fills with wash. In the record it sits on paper.
- **Ghost:** no fill; hover fills with wash.
- **Focus:** the border shifts to the ring (Ink 2) with a 3px Ink 2 halo at 50%. The solid edge carries focus (9.30:1 light, 10.96:1 dark); the halo (2.56:1 light, 3.66:1 dark) is not relied on. Everything else takes the global outline: 2px Ink 2, offset 2px, inset -2px inside scrollers.

### Navigation
- **Rail views:** 32px rows, 13.5px medium in Ink 2 with a 16px icon in Ink 3. Hover fills wash; active is a paper row with a hairline and ink text (a wash row in the dark theme). The number key shows on hover and focus; Findings shows its most severe icon and a mono count instead.
- **Drawers:** 30px top-level rows (28px nested), chevrons rotating 90 degrees on the damped ease over 200ms, file counts in 11px mono Ink 3; active is the same paper row.
- **Slim bar views:** a 36px pill on wash with a hairline; segments are 28px, 13px semibold Ink 3, active on paper with a hairline.
- **Find field:** a 32px paper field-styled button with a search icon, placeholder text, and a keyboard hint.

### Inputs / Fields
- **Style:** transparent ground (paper inside the Display popover), 1px Control Edge border, 6px corners, 36px (32px small).
- **Focus:** the control treatment, as on buttons.

### Unit trays
- **Corner / Border:** none; trays are cells of the ruled row.
- **Background:** ground. **Padding:** 14px 18px 12px.
- **Anatomy:** a 14px semibold title (a link with a small up-right arrow when a full chart exists), an optional 12px aside dropped below a 250px container, a figure-sized headline, then the plot.

### Record rows, metrics and tags
- **Record row:** a full-width ruled button, label left, a 12px Ink 3 aside right, hairline below, wash on hover, focus and when current.
- **Metric grid:** two columns ruled by hairlines; label 12px Ink 3, value 18px mono, optional 11px note.
- **Tag:** 18px hairline badge, 2px corners, Control Edge border, 10.5px mono in Ink 2.
- **Holotype badge:** 2px corners, red fill, 12px semibold white text ("Holotype · most depended on in …").

### Specimen labels (signature)
White label stock pinned to a star by a 1px white leader ending in a 2px dot.
- **Card** (196px; 216px for a holotype): a 13px bold condensed title over a 1px ink rule, a two-column field list (Language, Category, Path, Collector, Collected) with mono paths and dates, and an italic determination line above a hairline. A holotype card is red with white text, a white title rule, and its name prefixed "Holotype ·".
- **Pin:** one line, the file's name, 11px bold; red for holotypes. Used for secondary holotypes and on plates under 560px.
- **Tag:** a selected symbol's one-line summary.
Labels fade over 150ms and avoid each other, the plate chrome, region names and the lanes they describe.

### Plate chrome (signature)
- **Title:** display type in plate ink, then " · N specimens" in regular Plate Muted.
- **Controls** (top right): the Web/Imports toggle as a pill on the plate with a plate-rule edge, then Gravity, Display (a popover of Color, Size and Lanes selects) and reset, each a 28px plate button: plate fill, plate-rule hairline, 12px semibold Plate Muted at 85% width, a 10% plate-ink hover, and a plate-ink focus halo.
- **Legend** (bottom left): plate-filled, 8px corners, no edge; swatch-led entries that isolate a language on click, the holotype key, the gravity in force, and the strand key.
- **Inscription** (bottom right): "Plate", then the commit, branch and date in 10.5px mono, Plate Muted at 75%. It states facts about the plate; it is hidden on plates under 640px and from assistive tech.
- **Registration corners** and the **history scrubber** (52px, plate fill, plate-rule top edge).

### Pointing at the plate (signature interaction)
Hover follows intent (`galaxy/hoverIntent.ts`): the cursor and a faint four-tick reticle answer at once; the card, the envelope, lit lanes and dimming wait until the pointer settles. A hovered group is traced by a hairline envelope, dashed plate ink at 60%; a selected one is solid at 85%. No fills, no shadows. Region names go through the same intent and the name under the pointer holds still.

### Brand mark
Positive on light grounds (white stars on plate glass), negative on dark ones (dark stars on clear glass), through mark-plate and mark-ink. Drawn on the plate itself (loading and empty states) it stays positive whatever the theme. Under 20px the ticks draw heavier (2.3 units instead of 1.7). The wordmark is currentColor.

### Loading plate
Stars come up out of the emulsion: each fades and scales from 0.6 to 1 and back over 2.4s on the damped ease, on its own delay, above "Developing the plate…".

## Do's and Don'ts

### Do:
- **Do** keep the chrome monochrome: ink, paper, silver, wash and hairlines; let hue appear only on marks and reserved signals.
- **Do** print primary actions, active states and focus in ink (focus ring Ink 2, solid 2px edge).
- **Do** rule regions apart with 1px hairlines in the rule color instead of boxing them.
- **Do** keep text in ink, Ink 2 or Ink 3 and put identity on a swatch dot beside it.
- **Do** use the series-dark steps on the plate and in the dark theme, and dark-measure for single-series marks there.
- **Do** ship direct labels or a table view with any chart that relies on light slots 2-5; they sit under 3:1 on the ground.
- **Do** pair every status color with an icon and a label.
- **Do** set paths, counts, hashes and dates in JetBrains Mono with tabular figures.
- **Do** back plate chrome with the plate's own color, and halo text set over stars.
- **Do** ease camera moves, chevrons and layout morphs with the damped curve (cubic-bezier(0.22, 1, 0.36, 1)), no overshoot; hover color changes take 150ms.

### Don't:
- **Don't** use holotype red for anything but a region's most depended-on file: not errors, critical severity, negative deltas or a chart series.
- **Don't** give the chrome a hue: no navy or slate rail, no blue focus ring, no colored primary button.
- **Don't** give in-layout surfaces (trays, rail, record, buttons, inputs) a shadow.
- **Don't** wrap trays in bordered or rounded cards, or lay bordered panels over the plate.
- **Don't** reorder the categorical slots or add a red slot.
- **Don't** invert or dim light-surface colors to fit a dark surface.
- **Don't** let the plate follow the theme; it is dark glass in both.
- **Don't** round structural elements past 8px; full rounding is for data dots and round controls.
- **Don't** set the wordmark's 125% width anywhere but the wordmark, or introduce a third typeface.
- **Don't** reuse the inscription's uppercase "Plate" as a section label or eyebrow; it is part of the inscription only.
