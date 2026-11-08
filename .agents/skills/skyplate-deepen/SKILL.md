---
name: skyplate-deepen
description: Design or restructure a module with measurements behind every claim — the deep-module vocabulary (module, interface, implementation, depth, seam, adapter, leverage, locality), each term tied to what Skyplate's seam tool counts, then a measured deepening of one module, design-it-twice with parallel sub-agents, and a before/after re-measure. Use when designing a module's interface, deciding where a seam goes, deepening shallow modules, making code testable through its interface, or verifying a refactor actually shrank the interface. Needs the skyplate MCP server.
---

# Measured deepening

A **deep module** puts a lot of behavior behind a small interface, at a clean seam, testable
through that interface. This skill keeps that design language and adds what it usually lacks:
numbers. Skyplate's `seam` tool measures a module where its interface lives, so "this module
is shallow" becomes a claim with outside uses, callers and co-change behind it, and "the refactor
worked" becomes a before/after diff instead of a feeling.

The numbers say where to read and what to check. They never replace reading the code: an
interface also carries invariants, ordering and error modes that no table counts.

Adapted from Matt Pocock's `codebase-design` skill (MIT, see the end); the measurement layer is
Skyplate's.

## Vocabulary, and what each term measures

Use these terms exactly. Don't drift into "component," "service," "API," "boundary," "layer"
or "wrapper": the point is one language that maps to one set of measures.

| Term | Means | What `seam { path }` gives you |
| --- | --- | --- |
| **Module** | anything with an interface and an implementation: a function, file, directory, package | a recursive `path` (directory, file or glob), or a ranked row's `selector` for its exact review membership |
| **Interface** | everything a caller must know to use it correctly | `interface.rows`: symbols declared inside that code outside uses, directly (`uses`) or through their members (`viaMembers`, the outside uses of its fields and methods: a type nothing outside names but whose instances it reads is interface with `uses: 0`), the interface *as used*. A row with `exposes` hands callers another type too: a `store` property typed `AppStore #N (40 public members)` is one row, and every caller reading it can reach 40 more. Which of them callers actually use is not recorded (a reference does not say which object it went through), so search for `.store.` to size it. Invariants, ordering, error modes and performance are not counted; read them from the code and its callers |
| **Implementation** | the body of code behind the interface | `implementation`: production code only (lines, complexity, functions, hottest files); the module's own tests are counted apart in `tests` |
| **Depth** | leverage at the interface: behavior a caller gets per unit of interface learned | no score, on purpose. Read `interface.symbols` against `implementation`, and `interface.uses` / `callers` / `files` |
| **Seam** | where the interface lives, where behavior can change without editing in place | the edges crossing `path`: `imports.inbound` / `outbound`, `imports.cyclesAcross`, references across. Edges are file to file, so behind a barrel (an `index.ts` that re-exports) importers import the barrel and `inbound.files` undercounts; `imports.viaBarrel` says when, and `interface.files` is the count to trust |
| **Adapter** | a concrete thing that satisfies an interface at a seam | `adapters`: classes implementing an interface the module declares, test doubles marked |
| **Leverage** | what callers get from depth | outside uses (references: calls, reads, type annotations, not only calls) and files each interface symbol serves (`interface.rows[].uses`, `.files`); `interface.uses` is their sum |
| **Locality** | what maintainers get: change, bugs and knowledge in one place | `locality.spread` (how many other modules a commit here also touches, on average), `changesWith`, and `coChange` pairs with `imports: "none"` |

Shallow and leaky shapes have signatures in that output:

- **`couldHide`**: exported, used only in its own file, and imported by no test. Declared entry
  points and published APIs stay out of this list, even when used locally. Check dynamic
  consumers before removing `export`. An export only tests import appears in
  `testsPastInterface`.
- **`externalExports`**: exports with a declared entry-point or published-package consumer,
  but no measured production client outside this module. These are protected from hiding
  recommendations; they do not inflate the interface measured from in-repo uses.
- **`internalExports`**: exported for sibling files of the module only. Not interface (nothing
  outside uses it), but TypeScript needs the `export`, so hiding it means restructuring the
  module, not deleting a keyword.
- **`testsPastInterface`**: symbols that are not interface but that tests use, the module's
  own tests included (a test is a client wherever it sits): tests reaching past the interface,
  often to pure functions extracted for testability while the bugs live in how they are
  called. It overlaps `internalExports` (an internal helper a test calls is both). Fields of
  an interface or type alias are left out: a test building an options object sets them, which
  is not reaching past anything. `testUses` on an interface row counts the tests that do go through the interface,
  and `testFiles` lists every test file that touches the module.
- **`relays`**: functions whose body is one in-repo call. The deletion test in miniature:
  deleting one moves a single call into each caller. Calls into packages are invisible to the
  reference table, so read a relay before calling it a pass-through. A relay that names a
  distinct concept in the interface (a `tick` beside `evaluate`) can be earning its place.
- **`forwardsTo` on an interface row** (and on `symbol`): a one-line getter or property that
  only reads another object's member (`get store() { return this.app.store }`), the relay's
  property form. It names the member as its type declares it: the target is read through a
  field typed as an interface, so it may say `AppHost.store` where the code reads
  `this.app.store`. A forward assigned in a constructor (`this.store = this.app.store`)
  leaves no trace and is not found; `exposes` usually catches what it hands on.
- **`coChange` with `imports: "none"`**: files that change together with nothing in the code
  saying why. A dependency is crossing the seam out of sight.
- **`cyclesAcross`**: the seam is not a seam; both sides depend on each other at runtime.
  Loops closed only by `import type` are not listed there (nothing runs through them); `graph
  { view: "cycles", include_type_only: true }` shows them with the edge that closes each, and
  breaking one means moving a type, not reordering modules.
- **High `spread`**: a change here keeps touching other modules (5.6 means five or six of them,
  on average). Compare modules within one project; `leaving` is the plain share of commits
  that touch anything outside at all, and sits near 1 in a squash-merge history, where most
  pull requests touch several modules.

Every list in a `seam` answer is present whenever its measure ran: `relays: []` and
`cyclesAcross: []` mean measured and none. A list or figure that is missing was not measured,
and `unmeasured` says why (no git history, no code intelligence, every commit a sweep).
Other fields:
- `interface.declared` is every symbol the module declares; `interface.offset` pages its rows
  past `limit` (500 at most per call).
- `unusedExports` is the analyzer's flag (exported, nothing outside its own file references
  it, tests included), which overlaps `couldHide` and `internalExports`.
- `adapters` lists classes that declare `implements` / `extends` of an interface or abstract
  class the module declares; an interface extending another is the type hierarchy, not an
  adapter. `interfacesWithoutDeclaredAdapters` counts the module's interfaces and abstract
  classes no class implements (data shapes, mostly, or ports satisfied structurally).
- Production code only, tests counted apart: `implementation` (tests in `tests`),
  `imports.inbound.files` (test importers in `inbound.testFiles`), `imports.outbound`, and in
  `seams` the `files`, `code` and `complexity` columns (tests in `testFiles`).
- `imports.outbound` counts the files imported, so a package imported through its barrel
  counts once, as the barrel file.
- `locality.alsoTouchOutside` is how many of the `spreadBasis` commits (those no wider than
  the sweep width) reached outside at all, and `leaving` is that share. `changesWith` lists
  the directories of the production code those commits touched outside the module.
- A `coChange` pair's `imports` is `"direct"` (one imports the other), `"indirect"` (within
  four hops) or `"none"`; pairs with a test file are left out (a test changes with what it
  covers).
- In `seams`, `hotspotMass` is the sum of the module's file hotspot scores, so it ranks large
  hot modules first; it is not a 0-1 score.
- `seams { offset, limit }` pages module rankings. Keep the same sort and depth across pages.
  Pass a row's `selector` unchanged to `seam` for drilldown. It carries `scope: "module"` and
  the optional `depth`, so separately selected children stay outside a residual parent module.
  A plain `seam { path }` includes all descendants instead.

`locality.commits` counts every commit that touched the module. `spread` and `coChange` use
only commits no wider than `locality.sweepWidth`, the history's own 90th-percentile commit
size (30 to 100 files), the same cutoff the analyzer's coupling uses. In a squash-merge
repository a pull request lands as one commit, so wide commits are often real changes rather
than reformats. The percentile keeps them; only the history's rare outliers are left out.
When `locality.thin` is set, most of the module's commits were outliers; quote it rather than
the spread. `spreadBasis` is how many commits the figure rests on: under five, it is an
anecdote. A figure that could not be computed comes with its reason in `unmeasured`; pass the
reason on rather than a blank. With under ten commits, or a shallow clone, locality says
little; say so instead of leaning on it.

## Principles

- **Depth belongs to the interface, not the implementation.** A deep module can be built from
  small parts; they stay off its interface. A module can have internal seams (private,
  for its own tests) as well as the external one.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a
  pass-through; if it reappears across N callers, it earns its keep. `symbol { id }` gives N
  (callers, files) and `impact_depth` how far it spreads.
- **The interface is the test surface.** Callers and tests cross the same seam. A test that
  needs to reach past it (`testsPastInterface`) says the module is the wrong shape.
- **One adapter means a hypothetical seam; two adapters make it real.** Don't add a port
  unless something varies across it, typically production plus a test double. `adapters`
  counts only classes that declare `implements`/`extends`; an object satisfying an interface
  structurally leaves no row, so a count of one may be low, and an interface missing from the
  list may still be a port.
- **No implementation-to-interface ratio.** Ratios reward padding the implementation. Put the
  numbers side by side and judge.

## Deepening one module

To say where deepening should start, step 1 and reading the code behind it are enough. Steps 2
to 6 are for designing the change and checking it.

### 1. Measure it

`open` the project if it isn't, then `seam { path: "<module>" }`. Keep this result: it's the
baseline step 6 compares against. For a module that is part of a directory, pass a glob
(`"src/billing/{invoice,ledger}*.ts"`) to measure exactly the files that would merge.

Read the files behind the numbers: the interface rows, the relays, the `couldHide` list, and
both sides of each `coChange` pair.

### 2. Classify its dependencies

The category decides how the deepened module is tested across its seam. Skyplate lists the
in-repo ones (`imports.outbound`); it does not record which packages a file imports, so read
the module's import statements (`rg "^import|require\(" <path>`) and check them against
`dependencies`.

1. **In-process**: pure computation, in-memory state. Merge and test through the new
   interface directly; no adapter.
2. **Local-substitutable**: has a local stand-in (PGlite for Postgres, an in-memory
   filesystem). Test with the stand-in; the seam stays internal.
3. **Remote but owned**: your own services across a network. Define a port at the seam; an
   HTTP/queue adapter in production, an in-memory adapter in tests.
4. **True external**: third-party services. Inject it as a port; tests use a mock adapter.

### 3. Plan the tests: replace, don't layer

- Tests at the new interface replace tests on the shallow parts; once they exist, the old ones
  are waste. `testsPastInterface` and `testFiles` list which tests reach past today.
- Tests assert observable outcomes through the interface, never internal state, so they
  survive internal refactors. A test that must change with the implementation tests past it.

### 4. Design it twice

Your first interface is unlikely to be the best. Write the user a short framing (constraints,
dependency categories, a rough sketch to make them concrete), then, if your harness can run
sub-agents, start 3 or more in parallel, each with a fresh context and a different
constraint:

1. Minimize the interface: 1 to 3 entry points, maximum leverage per entry point.
2. Maximize flexibility: many uses, room to extend.
3. Make the most common caller's case trivial.
4. (When dependencies cross a network) design around ports and adapters.

Each brief carries the measured facts, so no agent re-derives them or guesses: the `seam`
result (interface rows with their uses, relays, `couldHide`, `internalExports`, adapters, coupling), the
files, the dependency categories, this vocabulary, and the project's own terms from
`GLOSSARY.md` if it has one. Each returns: the interface (types, invariants, ordering, error
modes), a usage example, what hides behind the seam, its dependency strategy and adapters, and
trade-offs.

Without sub-agents, draft the three yourself, one constraint at a time, before comparing.

### 5. Compare, then recommend

Present the designs one at a time, then compare in prose on depth, locality and seam
placement, and on what the measurements let you count:

- **Interface size**: entry points against today's `interface.symbols`.
- **Migration**: the uses and files in today's interface rows that each design changes
  (`symbol { id }` lists them with their lines).
- **What moves behind the seam**: which `couldHide` symbols, relays and internal helpers
  leave the interface.
- **Locality**: which `coChange` pairs end up inside one module.

Be opinionated: say which design you'd build and why, or propose a hybrid.

### 6. Re-measure after the change

A live project re-analyzes on the next question after files change. Call `seam` with the same
path and compare against step 1:

- `interface.symbols` and `couldHide` went down, or the interface is the one designed;
- `relays` and `testsPastInterface` are gone or explained;
- `imports.cyclesAcross` is empty, and `inbound` callers reach it through the new entry points;
- `search_symbols { unused_exports: true, path }` shows nothing the refactor orphaned.

Report the before and after numbers. Locality cannot be verified yet: `spread` and `coChange`
need commits that haven't happened, so say it is the thing to check after a few weeks of
changes, and don't claim it improved.

## Credit

The vocabulary, principles, dependency categories and design-it-twice process are adapted
from [`codebase-design`](https://github.com/mattpocock/skills) by Matt Pocock, which credits
John Ousterhout (*A Philosophy of Software Design*) and Michael Feathers (seams).

Its license:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
