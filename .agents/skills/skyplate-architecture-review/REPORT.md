# The review report

One self-contained HTML file in the OS temp directory. Tailwind and Mermaid come from CDNs at
pinned versions, so the page renders the same next month. Mermaid draws graph-shaped
structure; hand-built divs and inline SVG draw the editorial pieces (mass diagrams,
cross-sections, locality bars). Mix them, or every card looks the same.

What sets this report apart from a reading-only review: **every card shows the numbers that
put it there**, and every diagram is drawn from measured edges (the `seam` result's imports,
relays, interface rows and co-change pairs), not from what the module probably looks like.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Architecture review: {{project}}</title>
    <script src="https://cdn.tailwindcss.com/3.4.17"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
      .num { font-variant-numeric: tabular-nums; }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
      <footer>...</footer>
    </main>
  </body>
</html>
```

## Header

Project name, date, the analysis it read (`overview.project.generatedAt`, commits analyzed),
and a compact legend: solid box = module, dashed line = seam, red line = leak (co-change with
no import, or a cycle across), dark box = deep module. Link the whole project on the plate
(`file://<out>/index.html#color=hotspot`). No introduction paragraph.

## Candidate card

One `<article>` per candidate, its id the module path slugged, so the top recommendation can
link to it.

- **Title**: names the deepening ("Collapse invoice pricing into the ledger module").
  (Every example on this page is an invented billing module; real cards use real figures.)
- **Badges**: strength (`Strong` emerald, `Worth exploring` amber, `Speculative` slate) and
  dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files**: `font-mono text-sm`, each linked into the reader
  (`#tab=source&file=<path>`).
- **Evidence strip**: a row of small figures from `seam`, each labeled in the vocabulary.
  Pick the four to six that carry this candidate, for example:
  `interface 18 symbols · 24 uses` · `implementation 1,900 code · complexity 310` ·
  `couldHide 12` · `relays 4` · `tests past interface 7` · `spread 4.2 modules per change` ·
  `hidden coupling 3 pairs` · `cycles across 1`. Use `.num`, and link the strip to the module on
  the plate (`#dir=<module>&color=hotspot`).
- **Before / After diagram**: side by side, the centerpiece (patterns below). "Before" is drawn
  from the measured edges; "after" shows the proposed shape, with what moves behind the seam
  greyed inside the deep box.
- **Problem**: one sentence, what hurts, citing the code read, not only the number.
- **Solution**: one sentence, what changes.
- **Wins**: bullets of six words or fewer, in the vocabulary: "locality: one module per
  change", "interface shrinks from 18 to 3", "delete 4 relays", "tests hit one interface".
- **What would confirm it**: the `seam` figures expected to move after the refactor (the
  re-measure in `skyplate-deepen`, step 6).
- **ADR callout** (if any): one line in an amber box.

No paragraphs of explanation. If the diagram needs a paragraph, redraw the diagram.

## Diagram patterns, and the data that draws them

### Dependency graph (Mermaid flowchart)

From `imports.inbound.from` and `imports.outbound.to` (grouped by directory), plus
`locality.coChange` pairs with `imports: "none"` as red dashed edges and `cyclesAcross` as
red solid ones. Directory nodes outside, the module as one node or as its files.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      api[src/api] --> invoice[src/billing/invoice]
      invoice --> money[src/lib/money]
      invoice -.co-change, no import.-> ledger[src/billing/ledger]
      linkStyle 2 stroke:#dc2626,stroke-width:2px;
  </pre>
</div>
```

### Mass diagram (interface against implementation)

Two bars per module: interface height from `interface.symbols` (or the interface rows' call
sites), implementation height from `implementation.code`. Before: a tall interface bar beside
the implementation, plus a hatched band for `couldHide`. After: the interface bar at the
designed entry-point count. Scale both columns the same way and print the numbers on the bars.

### Cross-section (layers a call passes through)

From a relay chain (`relays[].forwardsTo`, followed with `symbol`) or a `graph path`: one thin
band per hop, labeled with its file. After: one thick band labeled with the consolidated
responsibility.

### Locality bar

From `locality`: the module's `spread` (other modules a commit here touches, on average) as a
row of that many small boxes beside the module, with the top `changesWith` directories as their
labels. After: the intended spread, marked as the expectation to check once history accrues,
not as a result.

### Call-graph collapse

From `symbol` rows (`calledBy`, `calls`): before, nested boxes of the calls; after, one box
with the now-internal calls faded inside.

## Top recommendation

One larger card: the candidate's name, one sentence on why it comes first (signals that stack,
plus friction read in the code), and an anchor link to its card.

## Footer

The Skyplate report folder path, and one line: "Figures from Skyplate's analysis of
{{commit or date}}; re-run `seam` after a change to compare."

## Style

- Editorial, not a dashboard. Generous whitespace; `font-serif` headings sit well with stone
  and slate.
- One accent (emerald or indigo), red only for leaks, amber only for warnings.
- Diagrams about 320px tall, so before and after sit side by side; they stack below 640px.
- Module labels in diagrams: `text-xs uppercase tracking-wider`.
- The only scripts are the two CDN imports; the page is otherwise static.

## Tone

Plain and short, with the architecture words taken exactly from `skyplate-deepen`.

**Use:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage,
locality.
**Never substitute:** component, service or unit (for module); API or signature (for
interface); boundary (for seam); layer or wrapper (for module).

Phrasings that fit: "The invoice module is shallow: 18 interface symbols for 24 uses."
"Billing leaks across the seam: invoice.ts changes with ledger.ts in 9 of 12 commits, and no
import connects them." "Two adapters justify the seam: HTTP in production, in-memory in tests."
Don't write "easier to maintain" or "cleaner code": they are not in the vocabulary and don't
earn their place.
