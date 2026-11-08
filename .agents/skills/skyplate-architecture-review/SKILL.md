---
name: skyplate-architecture-review
description: Review a codebase's architecture with measurements — rank modules by hotspot, interface size, tests that reach past interfaces, relays and hidden co-change coupling (Skyplate), read the code behind the strongest signals, present deepening candidates as an HTML report with the evidence and links into the Skyplate plate, then grill through the one the user picks. Use when asked for an architecture review, where to refactor, or which modules are shallow or leaky. Needs the skyplate MCP server.
disable-model-invocation: true
---

# Measured architecture review

Find **deepening opportunities**, refactors that turn shallow modules into deep ones, and
back each with numbers. A review from reading alone is only as good as the reader's sample;
this one starts from Skyplate's measurement of every module, so the sample is chosen by where
complexity, change and leakage actually are, and each card shows the evidence that put it
there.

Two sources of truth, and a candidate needs both: **the numbers** say where to look, **the
code** says whether it hurts. Numbers alone produce refactors nobody needed; reading alone
misses the coupling no file shows.

Adapted from Matt Pocock's `improve-codebase-architecture` skill (MIT; credit and license in
the `skyplate-deepen` skill), with the scan, evidence and verification done by Skyplate.

## Vocabulary

Load the **`skyplate-deepen`** skill first: it defines **module**, **interface**,
**implementation**, **depth**, **seam**, **adapter**, **leverage** and **locality**, and what
Skyplate measures for each. Use those words exactly in every candidate. Domain words come from
the project's `GLOSSARY.md` when it has one ("the invoice ledger module", not
"InvoiceLedgerService"); decisions in `docs/adr/` are not re-litigated without cause.

## Process

### 1. Measure

`open { path }` on the project, then read the overview's findings and hotspots.

**Scope before you scan.** Deepening pays off by making future changes easier, so weight what
changes. If the user named a direction (a module, a subsystem, a pain point), take it and go
straight to `seam` on it. Otherwise:

- `seams {}` ranks every module by hotspot (churn × complexity) with all its signals. Its
  modules are the analyzer's, with package roots kept whole and any module over a quarter of
  the code split into its subdirectories, so a monorepo reads package by package and a large
  app by its parts. Also sort by `hidden`, `tests_past` and `spread`: a module can be cold and
  still leak.
- Shortlist 3 to 6 modules where signals stack: a hot module that also has a wide
  `couldHide`, relays, `testsPastInterface`, hidden coupling, cycles across, or a high
  `spread`. One signal alone is a lead, not a candidate.
- `seam { path }` each shortlisted module. Keep the results: they are the evidence on the
  cards, and the baseline a later refactor is measured against.
- Follow the strongest signals one level down: `symbol { id, impact_depth: 2 }` on the
  busiest interface rows and on each relay; `history { view: "coupling", path }` and
  `graph { view: "path" }` on each `coChange` pair with `imports: "none"`.

Read `GLOSSARY.md` and the ADRs for the areas you shortlisted.

### 2. Read the code behind the numbers

If your harness can run sub-agents, give each shortlisted module (or the whole shortlist) to
one with a fresh context. Its brief carries the `seam` result, the files, the vocabulary and
these questions; it reads the code and reports friction, not opinions about style:

- Does understanding one concept mean bouncing between many small modules (relays, a
  `graph path` that passes through several thin files)?
- Is a module **shallow**: an interface nearly as complex as its implementation (many
  interface rows, each serving one or two uses, beside little implementation)?
- Were pure functions extracted only to be tested (`testsPastInterface`) while the bugs hide
  in how they are called?
- Does something leak across the seam: the `coChange` pairs with no import, the cycles across?
- What is untested, or hard to test through the current interface (interface rows with no
  `testUses`)?
- **The deletion test** on anything suspected shallow: would deleting it concentrate
  complexity, or only move it into its callers (and how many: `symbol` gives the count)?

Confirm what comes back against the code yourself before it becomes a card. Without
sub-agents, do the reading yourself, module by module.

### 3. Grade each candidate

- **Strong**: the measurements and the code reading agree, and the area changes (hot, or
  coupled to something hot).
- **Worth exploring**: one of the two is clear and the other is quiet (real friction in a cold
  module, or strong signals the code explains away only partly).
- **Speculative**: friction you can argue for, with neutral numbers.

Tag each with its dependency category from `skyplate-deepen` (`in-process`,
`local-substitutable`, `ports & adapters`, `mock`). If a candidate contradicts an ADR, keep it
only when the friction is real enough to reopen the decision, and say so on the card.

### 4. Present an HTML report

Build the Skyplate report so cards can link into the plate: `build_report {}` (it reuses the
live analysis and writes to the user's cache directory) and note `result.out`. Links open the
report from disk with the view in the URL hash, so they keep working after this session ends:

```
file://<out>/index.html#dir=<module>&color=hotspot                          a module on the plate
file://<out>/index.html#sym=<name>@<path>:<line>                            a symbol and its callers
file://<out>/index.html#tab=source&file=<path>&line=<line>                  a line in the reader
```

Then write one self-contained HTML file to the OS temp directory, never into the repository
(`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows), named `architecture-review-<timestamp>.html`.
Open it for the user (`open` on macOS, `xdg-open` on Linux, `start` on Windows) and give its
absolute path. [REPORT.md](REPORT.md) has the scaffold, the card, and the diagram patterns.
Every card carries its measured evidence and a before/after diagram drawn from the measured
edges, not from memory.

End with a **Top recommendation**: the candidate you would tackle first, and why.

Do not propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 5. Grill the chosen candidate

Walk the decision tree with the user: constraints, dependencies, the shape of the deepened
module, what sits behind the seam, which tests survive. If the `grilling` skill is installed,
use it. Otherwise work in rounds: ask every question whose prerequisites are settled, numbered,
each with your recommended answer and worded so "yes" accepts it; wait; recompute. Facts are
yours to find (with Skyplate or the code), never the user's to supply; decisions are theirs.

As decisions settle, keep the domain model current (the `domain-modeling` skill, if
installed, has the formats):

- Naming the deepened module after a concept missing from `GLOSSARY.md`? Add the term,
  creating the file if needed. Sharpening a fuzzy term? Update it there and then.
- The user rejects the candidate for a reason a future review would need? Offer an ADR: "Want
  me to record this as an ADR so future architecture reviews don't re-suggest it?" Skip
  ephemeral reasons ("not now") and self-evident ones.

To design the interface itself, hand over to **`skyplate-deepen`** with the candidate's `seam`
result: design it twice with parallel sub-agents, compare on what the measurements count, and
re-measure after the change.

## What not to claim

- A number is not a finding until the code agrees. Say "relay" only after reading it: calls
  into packages are invisible to the reference table.
- Locality claims need history. Under ten analyzed commits, or in a shallow clone, say the
  co-change numbers are thin. Commits wider than the history's own sweep width (its
  90th-percentile commit size, 30 to 100 files) are left out of spread and co-change; when
  `locality.thin` says most of a module's commits were, say so on the card.
- Code intelligence covers TypeScript and JavaScript. Elsewhere the interface, relays and test
  signals are absent, and the review stands on imports, history and reading.
- `codeIntelligence.uninstalledManifests` in the overview means imports through package names
  did not resolve: interface counts are low and `couldHide` can list symbols that are in fact
  used. Say so on the cards it affects, or suggest installing dependencies and re-opening.
