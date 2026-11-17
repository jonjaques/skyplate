# Enhancements

Capabilities Skyplate does not have yet, ranked for an agent working in a large, unfamiliar,
possibly private repository. Wrong answers it gives today are in [defects.md](defects.md); the
order of work and the release scope are in [README.md](README.md).

Each entry says what an agent cannot do today, what exists already, the next step, the size
(S days, M one to three weeks, L more, XL a quarter or more), the defects it closes, and the
measure that says it worked. Claims about other tools cite the dated source register in
[research/prior-art.md](research/prior-art.md#7-dated-primary-source-register), which also
holds the full design notes behind each entry (its section 3 has the same ideas in its own
order). IDs are stable.

**Status** is `not started`, `started` (a first version shipped and the entry says what is
missing) or `done`.

## At a glance

| ID | Enhancement | Size | Status | Closes |
| --- | --- | --- | --- | --- |
| [E1](#e1) | Every answer says how much it knows | M | started | T4, T6, S2, S6 in part, M3 |
| [E2](#e2) | A first answer in seconds, at any size | L to XL | started | |
| [E3](#e3) | Context for a task, under a budget | M | started | |
| [E4](#e4) | Change impact that explains itself, and the tests to run | M to L | started | |
| [E5](#e5) | Full-text search beside symbols | M | not started | |
| [E6](#e6) | Symbols for the next five languages, as a weaker tier | L to XL | not started | |
| [E7](#e7) | Function-level history, joined to callers | L | not started | |
| [E8](#e8) | Bounded callback flow for TypeScript | L | not started | |
| [E9](#e9) | History that sees through renames, reformats and sweeps | M | not started | |
| [E10](#e10) | Type-only and build-conditional edges in every language | M to L | started | |
| [E11](#e11) | Compiler questions at a position | M | not started | |
| [E12](#e12) | A way to send a benchmark back | S | done | |
| [E13](#e13) | Further out: SCIP, architecture evidence, contracts, clones, scale | each M to L | not started | |
| [E14](#e14) | A smaller tool surface | M | not started | |

## The first four, which build on what 0.3.0 shipped

### E1

**Every answer says how much it knows.** Size M. Started. Closes T4, T6, S2 and the "zero
unresolved" half of S6; makes M3's note structural.

- **Today.** What Skyplate records is right (no false reference in 2,766), but what it does not
  record it does not announce. An export called unused because a compiler pass failed, a cycle
  made of type-only imports, zero unresolved imports because the resolver guessed "external",
  a Go package projected onto 17 files: each looks complete and is a lower bound. An agent acts
  on these answers, so this is the first thing to fix. Both measurement studies ranked it first
  independently.
- **Exists.** Answers carry a freshness note when history or symbols are missing, a shallow
  clone note on owners, co-change and churn, and `partial` while a first analysis runs.
- **Next.** Attach to every claim its basis (compiler-resolved, syntactic, projected, temporal)
  and its coverage (which projects, languages and files it rests on, and what was capped), in
  the schema and in the answer, and withhold a negative verdict when coverage is incomplete.
  Dictionary-encode the bases so the tables do not grow per edge. No probabilities: a stated
  basis, not a confidence number.
- **Prior art.** SCIP carries occurrence roles; gopls documents what its references exclude
  ([gopls navigation](https://go.dev/gopls/features/navigation)); Glean tracks fact provenance.
  None of the surveyed tools explains static, historical and design evidence together.
- **Measure.** A fixture set of misleading negatives (missing `node_modules`, a failed project,
  capped references, a skipped language, a stale snapshot, a projected package): every answer
  carries the right caveat, and no strict count changes.

### E2

**A first answer in seconds, at any size.** Size L to XL. Started.

- **Today.** History took 509 s on Kubernetes (32,005 files, 18,070 commits walked from a
  depth-50 clone); the viewer's layout took 5.2 s of a 7.8 s history-free run, and the MCP
  server paid for it on every analysis.
- **Exists (0.3.0).** A structure pass (no history, symbols or layout) is published as a
  partial snapshot, and structure tools answer from it. Cold on a depth-50 Kubernetes clone,
  `map_codebase` answered in 2.1 s and `locate_code` in 24 ms while history ran
  ([evals/first-answer/](../../evals/first-answer/)). The MCP server's analyses skip the
  viewer's layout, and `build_report` computes it only when it writes a report: a full MCP
  analysis of a synthetic 6,000-file tree took 94% less time (median of five runs).
- **Next, in order.**
  1. Walk the tree once: a first `open` walks it twice, about 1.5 s on Skyplate itself. Size S.
  2. A cache outside the project of per-file facts keyed by content and resolution context,
     compiler-project snapshots and git checkpoints, so a one-file edit is not a full run, and
     a bounded, resumable history walk. Size L to XL. Glean shows why derived facts need owners
     and invalidation ([incremental indexing](https://glean.software/blog/incremental/)).
- **Measure.** `open` on a 32k-file repository under three seconds without history; an
  unchanged reopen that scans nothing; incremental and full results byte-equal across edit,
  rename, delete and config-change fixtures. Correctness before speed: a stale answer is worse
  than a slow one.

### E3

**Context for a task, under a budget.** Size M. Started.

- **Today.** `locate_code` (0.3.0) ranks directories and files for a concept from paths,
  symbols, doc comments, commit subjects, packages and a bounded source scan, each with its
  evidence. It returns places, not the code an agent needs to read.
- **Next.** Given a question or seed files and symbols, return ranked definitions, signatures,
  short spans and nearby tests under a byte budget, with the reason each was included. Exact
  text and symbol matches seed a bounded walk; imports, callers and co-change stay separate
  channels, and production consumers are told from tests. No tokenizer and no LLM: bytes and
  an estimate.
- **Prior art.** Aider's repo map is the compact reference; RepoGraph measured that one hop of
  graph context helps and unbounded expansion hurts
  ([RepoGraph](https://arxiv.org/html/2410.14684v2)). None has a co-change channel.
- **Measure.** File and function recall at k, and useful source per 4k and 8k budget, with an
  ablation showing the git channel helps a hard subset without hurting the rest.

### E4

**Change impact that explains itself, and the tests to run.** Size M to L. Started.

- **Today.** `change_impact` (0.3.0) gives dependents, compiler users, test candidates,
  co-change, owners and warnings for a planned change, and with `working_tree: true` reviews
  the uncommitted diff. It does not tell a body change from a signature or export change, does
  not say which path put each result there, and reads no coverage.
- **Next.** Classify each changed symbol (body, signature, export, deletion), return impacted
  symbols, files and tests each with the path that put it there, and read existing coverage
  files as optional observed evidence. Ship candidates with reasons, never "safe to skip".
- **Prior art.** Jest's related tests, Bazel's reverse reachability and
  [testmon](https://www.testmon.org/) each cover one part; none joins type paths with
  co-change.
- **Measure.** Failing-test recall against tests kept, replayed on real histories. And the
  after-edit review has not yet been exercised by a measured agent (the adoption sessions were
  read-only); measure that too.

## New ground

### E5

**Full-text search beside symbols.** Size M. Not started.

- **Today.** The two adoption prompts Claude Code still answered with a text search were the
  two that handed it an exact string (an environment-loading feature, a message string).
  `locate_code` reads at most 200 files and 2 MiB per call, so on a large repository a string
  match can be missed.
- **Next.** An index of identifiers and text built in the same pass, stored with the cache
  (E2), with literal and regular-expression queries whose hits carry the enclosing symbol and
  file facts. Secrets stay excluded, as everywhere.
- **Measure.** Exact-string prompts answered from one call; hit recall equal to `rg` on the same
  tree, at warm latency under 100 ms on 20k files.

### E6

**Symbols for the next five languages, labeled as a weaker tier.** Size L for Python and Go, XL
for all. Not started.

- **Today.** Outside TypeScript and JavaScript there are no symbols at all. On a Python, Go,
  Rust or Java repository an agent cannot ask where something is defined or who calls it. This
  is the largest capability gap.
- **Next.** Tree-sitter grammars compiled to WASM for declarations, local bindings,
  imported-name resolution and syntactic call sites in Python, Go, Rust, Java and Kotlin, and C
  and C++, with no build
  ([tree-sitter code navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html)).
  It is not compiler resolution, and the schema carries the tier so no answer pretends
  otherwise (E1). `web-tree-sitter` and the grammars are MIT; ship prebuilt WASM. Pairs with
  E2's cache, since parsing is what the cache amortizes.
- **Measure.** Per language: declaration precision and recall, exact-target precision,
  unresolved share, candidate-set size.

### E7

**Function-level history, joined to callers.** Size L. Not started.

- **Next.** Assign each historical hunk to the declaration it changed at that revision, so churn,
  authors and coupling exist per function. CodeScene's X-Ray does function hotspots; what it
  lacks is the join to compiler references, which lets an answer say "this method changes often,
  is called across three module boundaries, and usually changes with an adapter that has no
  import path to it". Bound it by hotspot and recency; never replay all history.
- **Measure.** Hunk-to-declaration assignment checked by hand on a sample, and ranking
  stability under formatting commits.

### E8

**Bounded callback flow for TypeScript.** Size L. Not started.

- **Today.** A function passed as a callback, bound, or stored in a variable is a read; the call
  that later runs it is not attributed to it.
- **Next.** Propagate callable values through aliases, parameters, object slots and finite
  string keys up to a budget, as a view beside the strict graph and labeled as inferred.
  Indirection-bounded analysis reports about twice the speed for about 5% less recall
  ([ECOOP 2024](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2024.10)).
- **Measure.** Recover a fifth of labeled callback misses at 90% precision on added edges.

### E9

**History that sees through renames, reformats and sweeps.** Size M. Not started.

- **Today.** Renames and reformats count as touches: a twelve-file directory rename produced all
  66 possible co-change pairs. Ownership is cumulative additions, with no decay. A sweep is
  recognized by width alone (wider than the 90th percentile of commits, clamped to 30 to 100
  files), so a narrow reformat counts in full.
- **Next.** Views that set aside mechanical changes (pure renames, whitespace-only changes, a
  repository's `.git-blame-ignore-revs`), recency-weighted ownership, and the raw view kept for
  audit.
- **Measure.** In the rename fixture semantic coupling disappears while raw touches remain; a
  whitespace-only commit does not change semantic churn; hotspot ranking is stable under
  formatting.

### E10

**Type-only and build-conditional edges in every language.** Size M to L. Started: Python's
`if TYPE_CHECKING` imports are type-only since 0.3.0 (S3).

- **Today.** The import graph is the union of every build configuration: C conditionals, Go
  build tags and Cargo features can be mutually exclusive, so a cycle over the union may never
  execute.
- **Next.** Carry type-only and condition provenance on edges in every language, and let answers
  choose the union or one configuration.
- **Measure.** Requests' runtime cycle disappears while its type loop remains; Go, Cargo and C
  fixtures report the right active edges for two configurations.

### E11

**Compiler questions at a position.** Size M. Not started.

- **Today.** There is no definition, type or diagnostics at a line and column. An agent with a
  cursor on a local name, an import alias or an overload has to search by printed name.
- **Next.** Versioned position queries over the TypeScript project that owns the file, rejecting
  a stale source hash.
- **Measure.** Definition, type and diagnostics at every probe cursor match the native compiler.

### E12

**A way to send a benchmark back.** Size S. Done in 0.3.0.

- **Shipped.** The "Share a benchmark" issue form
  ([.github/ISSUE_TEMPLATE/benchmark.yml](../../.github/ISSUE_TEMPLATE/benchmark.yml)) restates
  what the file holds, takes `benchmark.md` as pasted and the JSON as an attachment, requires a
  consent checkbox, and labels the issue `benchmark`. Skyplate itself sends nothing.
- **Measure.** Benchmarks arrive, and their anomaly codes can be triaged into this file and
  [defects.md](defects.md).

### E13

**Further out.** Each M to L, not started; each is written up in
[research/prior-art.md](research/prior-art.md) with a dependency, a license and an experiment
that could reject it.

- Read existing SCIP indexes and join them to history (section 3, boundary 9).
- Directory boundaries compared with import, caller and co-change communities, as evidence
  about architecture (boundary 8).
- Boundary contracts checked between two snapshots (boundary 12).
- Consumer cohorts and public-interface reduction (boundary 13).
- Near-miss clones ranked by co-change (boundary 14).
- A report format that loads detail on demand past 100k files (boundary 15).
- Knowledge concentration around contracts, with temporal uncertainty (boundary 16).
- Stable symbol ids across a refresh: today they follow file and declaration order.

### E14

**A smaller tool surface.** Size M. Not started.

- **Today.** 22 tools, and a `tools/list` of 33,241 characters that every session pays for
  before its first question (26,582 at 0.2.0, before the three task tools and `benchmark`).
  `overview` and `dir` overlap `map_codebase` (both descriptions already send agents to it), and
  `search_symbols` and `locate_code` both start from a name. Hosts that show only tool names
  give an agent 22 to choose from.
- **Next.** Fold what only `overview` and `dir` say (compiler totals, ownership, module
  coupling, warnings) into `map_codebase` and drop them, decide whether `search_symbols` stays
  separate from `locate_code`, and cut descriptions to the moment each tool is for. Nothing
  depends on the current names yet, so this is the cheapest time to do it.
- **Measure.** The adoption eval before and after: Skyplate within the first three calls on
  task prompts, no use on controls, answers graded the same, and the surface size from
  `evals/adoption/surface.ts`.

## Moonshots

1. **A change contract that lists what it cannot see.** For a proposed change: the consumers,
   tests and historical companions, plus a machine-readable list of the points where the
   analysis loses track (an injected service, a registry, a runtime loader).
2. **Architecture experiments replayed against history.** Propose two module boundaries in
   memory and see which would have kept more past changes inside one module, on held-out
   commits.
3. **A local map of cross-language contracts.** Routes, schemas, RPC fields and registrations
   joined across languages by explicit rules, with co-change as supporting evidence, so a change
   to one side names the other.

## Limits we state rather than fix

Not bugs, and not on the list above as their own items, but an agent should hear them from the
tool rather than from this page (E1).

| Limit | What it means for an answer | Lifted by |
| --- | --- | --- |
| No value flow | Callbacks, dependency injection, `bind`, event dispatch and string-keyed access are outside a declaration index; a call through an interface names the declared member | E8, in part |
| No locals | Parameters, inner functions and anonymous callbacks have no identity, so ten test callbacks that call a function collapse into one caller | E11, in part |
| One project owns each file | A file compiled under two configurations is read under one | |
| Symbol ids change on refresh | They follow file and declaration order; re-resolve after a refresh | E13 |
| The import graph is a union | A cycle over all configurations may never execute | E10 |
| Co-change is a top-500 table with a floor of three shared commits | No pair for a file means "below retention", not "independent" | E1 (say so), E9 |
| Ownership is cumulative additions | No decay, review or co-author signal | E9 |
| Freshness is a full rebuild | And the viewer loads every table at startup | E2, E13 |
| Text search is bounded | `locate_code` reads at most 200 files per call | E5 |
