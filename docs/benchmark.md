# A benchmark you can inspect before sharing

`skyplate bench <path>` measures Skyplate on a repository that its maintainer cannot see.
It writes `benchmark.json` and `benchmark.md` locally. It has no upload, network request,
telemetry enrollment or persistent identity. You decide whether to share either file after
reading it. The Markdown is the JSON laid out as lists and tables: every value in one is in
the other, and it contains no extra diagnostic details.

An agent can make the same files through the MCP server's `benchmark` tool. That one also
records how the server's tools were used in the session (see "Live MCP usage" below).

```sh
skyplate bench /path/to/private-project
skyplate bench /path/to/private-project --workers 2 --no-source --max-commits 5000
skyplate bench /path/to/private-project --out /path/to/new-benchmark-directory
```

The default destination is a new randomly named directory under the user's cache directory,
`~/Library/Caches/skyplate/benchmarks/` on macOS and `~/.cache/skyplate/benchmarks/` elsewhere.
Neither default directory name nor either filename uses the project name. An explicit
`--out` selects a new directory. Existing directories, even empty ones, are refused. The
destination must be outside the project and cannot contain it. Symlinks in existing path
ancestors are resolved for that check. Output files have mode 0600 and their directory 0700.

The normal analysis flags apply. `--workers`, `--max-read-bytes`, and `--ts-max-refs` also let
you reproduce resource limits. The command uses the ordinary analyzer and measures source
embedding when enabled. Source stays in memory for measurement and is never written in a
benchmark. `--no-source` measures that different configuration. A fatal analysis failure
still writes a benchmark and exits with status 1. Output validation failures write neither
file. A compiler or git failure that the analyzer treats as recoverable is recorded as a
diagnostic and leaves the command successful.

## Privacy contract and threat model

The aggregate level projects measurements into a closed vocabulary. It does not redact a
normal report. Its values are numbers, booleans, arrays, objects, and strings from shipped
sets. Those sets contain schema keys, language ids from the bundled Linguist registry,
Skyplate phases, enums, metric and diagnostic codes, tool and parameter names, and
Skyplate's own relative source locations. Even framework and dependency names are omitted;
this version needs no public-package allowlist.

No repository path, filename, directory name, unknown extension, symbol name, signature,
documentation, file contents, author identity, email, commit subject or hash, branch, tag,
remote, package name, machine name, username, absolute path, or date is copied into the
benchmark. Custom exclude patterns become a count. Secret files contribute counts and
coarse numeric attributes only, with no content or hash. Error messages and subprocess
output are never copied. Unknown warning types become a counted `unclassified_warning`;
unknown validation rules become `unclassified_validation`.

Before either output is written, `validateBenchmark` walks the finished value, checking
object keys as well as string values. Unknown strings, unsupported types, non-finite
numbers, custom serializers, accessors, cycles, and unexpected top-level fields fail
closed. The writer repeats validation, and the Markdown renderer also validates. Adding a
new field or code requires changing the shipped vocabulary. The validator's own errors are
fixed messages and do not quote the rejected value. The benchmark schema and collector live
under `src/core/bench/`; they ship with the CLI. Nothing crosses the analyzer/viewer schema.

Numbers come in three classes, by what each could give away (`src/core/bench/privacy.ts`):

- **Counts and sizes** round up to the next power of two. Zero remains zero. A count of 1001
  becomes 1024, meaning a value greater than 512 and at most 1024. An exact file or line
  count can confirm that a benchmark came from a repository someone already knows. Every
  histogram bound, histogram count, quantile, byte size and throughput uses this rule.
- **Durations** (`ms`, `totalMs`) are milliseconds to two significant figures: 5,227 becomes
  5,200. A time depends on the machine as much as on the project and identifies neither, and
  as a power of two a phase that took five seconds and one that took eight were the same
  number. Throughputs stay coarse, because a precise rate times a precise duration would be a
  precise count.
- **Shares** (`quality.rates`, `unresolvedShare`) are fractions of 1 to the nearest hundredth.
  "0.79 of eligible files covered" names no count, and as a power of two every share from 51%
  to 100% read as 1.

Ages are elapsed days, never dates. Release versions are numeric
major/minor/patch triples with build suffixes dropped. Schema constants, public source line
and column numbers, documented layout budgets, and optional structural ids are exceptions
to numeric coarsening. Beyond 50,000 files even the extrapolated layout budget is coarsened
to avoid disclosing an exact file count through the formula.

This protects against accidentally handing source and identifying strings to a maintainer.
It is not differential privacy and does not promise resistance to an adversary matching
repository fingerprints. Language presence, rough language mix, approximate size, unusual
histograms, hardware class, tool versions, error locations, and enabled analysis options
remain visible. Small counts such as one remain exact. Multiple correlated buckets or
repeated runs may narrow ranges. Rare languages and unusual graphs can identify a known
repository. Share only when those disclosures are acceptable under your own restrictions.
The file cannot establish whether an unused export is truly dead, or reproduce a parser bug
that depends on private syntax.

## Fields

The format is versioned independently of the viewer report. Version 1 has these top-level
fields. Empty arrays mean no observations, no reported violations, or unavailable analysis,
as specified below; they never conceal a separate text log.

| Field | Meaning |
| --- | --- |
| `format`, `version` | `skyplate-benchmark` and format version 1. |
| `privacy` | `level` is `aggregate` or `skeleton`; `coarsening` (counts) is `power-of-two`, `durations` is `two-significant-figures`, `ratios` is `hundredths`; `retainsShape` states whether structure was requested. A failed analysis can have no skeleton despite that request. |
| `environment` | Numeric `skyplate` and `bun` release triples, `reportSchema`, platform and architecture enums with `other` fallback, bucketed available `cores` and physical `memoryBytes`. No OS release, environment variables, paths, or host identity. |
| `options` | `{code, value}` rows for all effective boolean flags and numeric caps. Booleans here are 0 or 1. `workers: 0` means automatic; actual size is under `cost.workers`. `exclude_count` counts only caller-supplied patterns. Automatic report exclusions are not counted. |
| `scale` | Totals, category and language groups, and numeric distributions. |
| `cost` | Phase timings, memory, worker behavior, serialized payload sizes, and viewer-layout timing. |
| `quality` | Import outcomes, compiler coverage, unused-export classes, entry kinds, cycles, validation rules, and diagnostic codes. |
| `limits` | Counts and indicators for information lost to caps, skips, and bounded summaries. |
| `queries` | Ranked canned query measurements. No inputs or answers. |
| `anomalies` | Coded suspicions with a shipped `source` location and numeric `evidence`. `language`, `phase`, `tool`, and `rank` give closed context when applicable. These are investigation leads, not proof of a bug. |
| `failures` | Fatal error class, best known active phase, and Skyplate-only stack frames. |
| `session` | How the MCP server's tools were used. Empty from the CLI; filled when the benchmark is made with the server's `benchmark` tool. |
| `skeleton` | Present only when explicitly requested and successfully built. See below. |

A counter row is `{code, value}`. `code` describes the measure; `value` is a bucket upper
bound (in `quality.rates`, a share). Counters are arrays so a project-derived string can never become a property name.
Per-group totals do not necessarily add to the separately bucketed overall total.

### Scale

`scale.totals` counts files, dirs, bytes, lines, code, comment and blank lines, binary,
generated and vendored files, ignored entries, languages, and secrets. Ignored entries are
the walker's lower bound: ignored directories are not recursively counted. Language rows
have `language`, `totals` with files/bytes/lines/code/comment/blank, and `diagnostics` counting
detection reasons: filename, extension, heuristic, shebang, modeline, content, fallback.
Category rows have `category` and file/byte/line `totals`.

Every `distributions` row has `metric`, `count`, `minimum`, `p50`, `p90`, `p99`, `maximum`,
and `histogram`. A histogram row has `upper` and bucketed `count`. Quantiles select sorted
values at floor of quantile times population size, capped at the last element. Empty
populations have zero quantiles. Metrics are `file_bytes`, `file_lines`, `file_depth`,
`directory_fanout` counting direct directories and files, `fanIn`, `fanOut`,
`symbols_per_file`, `references_per_symbol`, `commits_per_file`, `authors_per_file`,
`age_days` since file creation in available history, and `cycle_size` for runtime cycles.
Absent file history or symbol analysis contributes zero to per-file distributions; the
compiler and history availability fields explain those zeroes.

### Cost

`cost.phases` includes all ten pipeline phases, with `phase`, `status`, `ms`,
`filesPerSecond`, and `bytesPerSecond`. Throughput divides the whole repository's file or
byte count by raw phase time, then buckets the result. It is a normalized comparison, not
a claim that every phase read every byte. Git and TypeScript overlap other phases, so phase
times must not be summed. A zero-millisecond phase has zero throughput rather than infinity.
Statuses are `ok`, `skipped`, `failed`, or `incomplete`; an interrupted phase's duration is
measured until the benchmark catches the failure. A progress event's free-text message is
never retained. An error during overlapping work may name the last started phase; frames
and diagnostic codes are stronger evidence.

`cost.totalMs` is the wall time of the whole benchmark run and `cost.samplingMs` the memory
sampling interval, a constant (100). `cost.memory` records `phase`, progress `status` at
start/done/skip boundaries, process `rss` and JavaScript `heap` bytes. `cost.totals` holds
sampled `peak_rss`, `peak_heap` and the OS process-lifetime `high_water_rss`. This process includes Bun worker heaps in RSS but not
the separate compiler or git subprocess RSS. Heap is the main runtime's reported heap.
Synchronous main-thread work delays timers; boundary samples and OS high water supplement
the samples. OS high water may predate this benchmark in a long-lived process. Total time
includes validation, payload serialization, layout probes, skeleton construction, and the
query workload, but excludes final JSON/Markdown rendering and disk writes.

`cost.workers` has actual pool `size`, `submitted`, `completed`, `failed`, `spawned`,
`queuePeak`, `busyPeak`, summed queue `waitMs`, and summed worker `runMs`. Sums can exceed
wall time because jobs overlap. Submitted jobs unfinished at failure remain visible in the
gap between submitted and completed/failed. Queue peak includes the next immediately
dispatchable request.

`cost.payloads` gives data-script byte sizes using the same serializer as `writeSite`:
`report`, `symbols_payload`, one `source_chunk` row per chunk in order, and aggregate
`assets` bytes. These are projected report data sizes, not the benchmark file size or the
viewer bundle. No report folder is written. Report size excludes the site writer's later
`timings.write` addition and asset-copy failures that only an actual write could observe.

`cost.layout` runs the viewer's pure `computeWeb` twice, for dependencies and complexity,
and reports the best `ms`, `budgetMs`, `siblingBudgetMs`, and `exceeded`. It follows
`test/web.test.ts`: 150 ms up to 20,000 files, 400 ms up to 50,000, then a linear
extrapolation. The 300 ms sibling-directory budget also applies when a directory has at
least 10,000 direct subdirectories. The report uses the unmultiplied interactive budgets,
not CI's slowdown allowance. This is a Bun probe of the shared algorithm, not a browser or
GPU measurement. Repository shapes differ from the test fixtures.

### Quality and limits

`quality.imports` rows give each importing language's `internal`, `external`, `unresolved`,
`unresolvedShare` (unresolved over all three) and unresolved `shapes`. Statements count once; documentation links do not count. Shape
codes, tested in order, are relative, absolute, URL scheme, alias, scoped package, dotted,
bare, other. Only their counts survive. Dotted C headers and dotted language module names
share a shape, distinguished by the enclosing language. A language with no extracted
imports has no import row. `scale.languages` still includes its files.

`quality.typescript` counts `present` TS/JS-family files, `eligible` files after the same
filters as the compiler pass, `covered` files with a retrieved program source, `projects`,
`symbols`, `references` including dropped stored rows, `unresolved` identifier candidates,
`uninstalledManifests`, and `hostFiles`. `quality.rates` gives the shares a maintainer reads
first: `ts_coverage` (covered over eligible), `ts_unresolved_share` (unresolved over resolved
plus unresolved) and `unused_export_share` (unused over all exports). These reference measures describe the compiler's
resolvable in-repository candidates, not all identifiers or all external library uses.
Coverage deliberately compares actual compiler files with eligible files, and separately
exposes total TS/JS presence. Installed dependencies are not downloaded by a benchmark.

`quality.unusedExports` counts exports, unusedExports, and the shared viewer
classes unreferenced, used-in-own-file, entry-export, public-api. An entry or public API
export with no internal users is not proof of dead code. `entryPoints` counts `EntrySource`
members, including package main/bin/exports/script, knip entry, workflow step, agent hook,
t3 script, tool config, and type declarations. `cycles` counts runtime cycles and loops
closed by type-only edges.

`quality.validation` counts exact `validateReport` rule codes before any unsafe viewer or
query work. An empty list means validation passed when analysis completed. If validation
fails, unsafe post-analysis probes are omitted. All rules are listed in
`src/core/bench/privacy.ts`, including totals, file-id, file-dir, dir-parent, edges, refs,
calls, layout, and finite. A code's value counts all violations, including those whose
normal human messages `validateReport` would suppress. No normal validation message is
included.

`quality.errors` records top-level caught git/compiler exceptions and failed reference
passes with the same safe
class/phase/frame shape as fatal failures. Messages and external frames are dropped.
It does not change the CLI exit status.

`quality.diagnostics` contains `warnings_total` plus numeric codes from their source:
history_insufficient, history_boundary, git_shallow, git_commit_cap, dependencies_missing,
unreadable_file, text_read_cap, binary_read_cap, git_failed, git_unavailable,
git_rename_limit, git_move_limit, ts_failed, ts_file_cap, ts_reference_cap,
ts_config_unreadable, ts_config_invalid, ts_config_circular, ts_config_base,
ts_config_solution, ts_config_failed, ts_timeout, ts_read_failed, ts_resolve_failed,
resolver_failed, package_sibling_cap, uninstalled_manifests, pagerank_iteration_cap,
module_split_cap, git_coupling_cap, rust_use_cap, and rust_statement_cap. `ts_notice` is reserved. Unclassified walker
warnings are counted without text. Counts of observations and counts of affected files
are not interchangeable: config and resolver retries can produce multiple observations.

`limits` repeats information-loss counters where a maintainer looks for partial results:

- `text_read_cap`, `binary_read_cap`: files streamed without full metrics/import analysis,
  or binary files not hashed, above maxReadBytes.
- `ts_file_cap`: candidate files in a skipped compiler pass; `ts_reference_cap`: dropped
  reference rows. Symbol totals and aggregate call counts still include dropped references.
- `rust_use_cap`: omitted leaf imports beyond 32 in a Rust use tree;
  `rust_statement_cap`: Rust use statements above the extractor's 4000-character bound.
- `package_sibling_cap`: omitted package sibling edge incidences across import statements,
  not distinct missing files. Repeated imports can count the same omitted sibling again.
- `git_rename_limit`, `git_move_limit`: occurrences of partial rename tracking.
- `shallow`, `truncated`, `analyzedCommits`, `totalCommits`: available history and its boundary.
- `git_sweep_threshold`, `git_sweep_commits`: commit-width threshold and commits left out of
  co-change analysis; `git_coupling_cap`: eligible co-change pairs beyond the best 500.
- `pagerank_iteration_cap`: PageRank exhausted its iteration limit before convergence;
  `module_split_cap`: observed module splits refused by the 24-module matrix bound.
- `source_file_cap`, `source_total_cap`: source files left out by per-file or total budgets;
  `source_secret_disabled`, `source_binary_disabled`: files excluded by content policy;
  `asset_size_cap`: image-category files above the preview byte cap.
- `source_disabled`, `symbols_disabled`, `git_disabled`: intentional switches, as 0 or 1.

Fixed sampling limits are part of algorithm semantics: head sniffing, bounded graph-layout
iterations, seven categorical language slots, abbreviated labels, signatures and docs, and
ranked findings are not loss of graph or compiler tables. Their text never enters this
format. Query result pagination is reported on each canned query as `truncated`.

### Query workload and failures

`queries` rows contain `tool`, `rank`, `status`, `ms`, `responseBytes`, approximate `tokens`
as ceil of UTF-8 bytes divided by four before bucketing, `truncated` counting positive
numeric `more`/`*More` fields, and an `error` code. This token estimate is a budgeting
heuristic, not a tokenizer. Timings include query execution, serialization, and truncation
counting. Inputs stay in memory. No answer, warning, query text, result path, selected
symbol id, or identity is serialized.

The fixed workload calls overview cold and warm; map_codebase for the root; locate_code
with the top hotspot's file name as its term (paths, symbols, docs and commits only: no
source is read); change_impact for the top hotspot file and for the most-referenced symbol;
files sorted by hotspot with 40 rows; dir and seam for the largest and median non-root
directory; file for the top hotspot and median line-count file; symbol and search_symbols
for the most-referenced symbol; seams with 40 rows; graph dependents for the top hotspot;
history summary; and dependencies with 40 rows. Directories rank by descendant file count. Ties use integer report ids. The root
replaces a missing non-root directory. Missing history or symbols yields `skipped`, not a
fake successful zero-byte query. Cold means first call of that query in this workload;
an earlier query may already have initialized shared indexes. The workload does not invoke MCP transport, file reading, or builds.

`failures` contain `phase`, a fixed `error` class, and up to twelve `frames`. Each frame has
a shipped relative `source` filename and numeric `line`/`column`. Only exact paths below
the installed Skyplate source root can supply a frame, and the path must appear in the
shipped source allowlist. Function names and error messages are dropped. Error classes
include type_error, range_error, syntax_error, query_error, permission, missing, io,
error, unknown_error. This format cannot capture an OS kill or runtime abort that prevents
JavaScript from handling the failure. Recoverable errors appear in diagnostic codes, with caught git/compiler exceptions also
under `quality.errors`. Fatal handled errors have safe stack frames under `failures`.

## Turning an anomaly into a fix

Thresholds are fixed in `src/core/bench/index.ts`. They are loose triage rules. Evidence is
computed from raw measurements and then bucketed, so two similar-looking rounded reports
can differ in whether a threshold fired.

| Code | Trigger and where to begin |
| --- | --- |
| `IMPORT_RESOLUTION_LOW` | At least 20 extracted imports and under 10% internal or external resolution in one language. Start at `src/core/imports/resolve.ts`, then `src/core/imports/extract.ts`; compare the language and specifier shapes. |
| `TS_COVERAGE_LOW` | At least 20 eligible compiler files, below 80% coverage, and no explicit file-cap skip. Start at `src/core/ts/projects.ts` and `src/core/ts/index.ts`. |
| `TS_UNRESOLVED_HIGH` | At least 20 unresolved candidates and more than 30% unresolved. Start at `src/core/ts/resolve.ts`; check uninstalledManifests before assuming a resolver bug. |
| `UNUSED_EXPORTS_HIGH` | At least 20 exports with over 80% marked unused. Start at `src/core/ts/tables.ts` and `src/shared/calls.ts`; compare compiler coverage, entry kinds, and dependency installation. |
| `PHASE_COST_HIGH` | At least 100 files, over one second, and over 5 ms per file, or 50 ms for git/TypeScript. Start at the row's source, `src/core/pipeline.ts`, `src/core/git.ts`, or `src/core/ts/index.ts`. Phase context and worker wait time distinguish a queue from parsing cost. |
| `QUERY_SLOW` | Query latency exceeds 1,024 ms. Start at `src/mcp/query.ts`, using tool and rank. Shared-index construction and serialization are included. |
| `QUERY_LARGE` | Bucketed query response exceeds 65,536 bytes. Start at `src/mcp/query.ts`; compare token estimate and pagination before expanding result limits. |
| `LAYOUT_BUDGET` | Best shared-web computation exceeds its size or sibling budget. Start at `src/shared/web.ts` and `test/web.test.ts`. Request a skeleton only if the user can share structure. |
| `VALIDATION_FAILED` | One or more integrity rules failed. Start at `src/core/validate.ts`; file-id/file-dir/edges/refs/calls rules point to the producer of that table in `src/core/pipeline.ts` or `src/core/ts/tables.ts`. |
| `ANALYSIS_FAILED` | A caught fatal error interrupted the run. Start at the safe frame locations, then `src/core/pipeline.ts`. Empty remaining sections reflect incomplete work. |

## Optional structural skeleton

```sh
skyplate bench /path/to/private-project --skeleton
skyplate bench synth /path/to/benchmark.json --out /path/to/new-synthetic-repository
```

This level is off by default. It reveals the exact directory tree, file membership, and
directed code-import graph. Two independent cryptographically random permutations replace
file and directory ids. The seed, old ids, original sorted order, hashes, and names do not
survive. It is pseudonymous structure, not a guarantee of anonymity: graph matching can
recognize a repository despite the permutation. Exact structural counts can be recovered
by counting rows. Review this level with that disclosure in mind.

`skeleton.dirs[i].parent` is another randomly permuted directory id, or -1 for its one root.
`files[i]` contains `dir`, registry `language`, `category`, bucketed `bytes` and `lines`,
and boolean `binary`, `secret`, `generated`, `vendored`. `edges` contains integer `from`
and `to`, the code edge `kind`, and boolean `type` for a type-only edge. Documentation
links, external names, and unresolved import spellings are omitted.

The generator validates vocabulary, ids, unique edges, one root, an acyclic tree, and size
bounds before creating anything. It refuses all existing destinations and uses exclusive
file writes. It creates `d<id>` directories and `f<id>.ts` files with side-effect imports or
type-only imports, a fixed exported type, blank lines, and space padding. Original language
syntax, identifiers, secrets, commits, dependency manifests, complexity, and exact file
sizes are not reconstructed. All generated files are TypeScript so the existing resolver
can rebuild exactly the supplied code graph. Tree fan-out, file counts, code edges and
type-only edges are preserved; byte/line attributes are approximate lower targets after
required synthetic imports. This is useful for dependency-gravity layout and graph cost,
not for reproducing a private type-checking or parsing error. Output is never executed.
Imports within the generated files stay inside the generated repository.

Imported skeletons are limited to one million files/directories, ten million edges, 64 MiB
per synthetic file and 2 GiB total projected content. Exceeding a safety limit refuses the
generation instead of silently truncating it. The destination's parent must already exist.
`test/bench-skeleton.test.ts` regenerates a fixture and checks every code edge, directory
fan-out, file count and type-only edge. The same generator is the CLI implementation.

## Live MCP usage

`skyplate mcp` counts how its tools are used, in memory, from the moment it starts: for each
call the tool's name, how long it took, how large the answer was, an error code, and which
argument keys were present. It never keeps an argument's value, a path, a query, an answer or
an error message, and it keeps no clock time and no client identity. Nothing is written or
sent. The counts leave the process in one way only: inside a benchmark someone asked for with
the server's `benchmark` tool.

```
benchmark { project?, out?, skeleton?, wait_seconds? }
```

The tool analyzes the project again (its timings have to be of a whole run), writes the two
files to a new folder outside the project, and answers with their paths and the anomaly
codes. It uploads nothing. The agent's job is to tell the user where the files are; reading
`benchmark.md` and deciding whether to share is the user's.

`session.calls` has, per tool: `count`, `durationMs` and `responseBytes` distributions,
error-code counters and present-argument-key counters (each key once per call).
`session.transitions` has `previous`, `next` and `count` for adjacent calls. A call rejected
for its arguments (a key the tool does not take, a missing required argument, a value out of
range) is counted too, as `invalid_parameters` against the tool, with the keys it was sent.
A key the tool does not take is recorded as `unknown_parameter`: which tools agents guess
wrong is the most useful thing this section can say, and the guessed key is the caller's
text, so it is not kept. Unknown tool, argument or error names become `unknown_tool`, `unknown_parameter`
or `unknown_error`. This still reveals coarse workflow preferences and error rates.

Every tool call goes through one wrapper in `src/mcp/server.ts` (`guarded`), which is where
the recorder is fed, and the tool and argument names it may record are written out in
`src/core/bench/privacy.ts`. A test fails when the server gains a tool or an argument those
lists lack.

## Evidence and prior art

The design borrows fixed counters and local inspectability from
[Go transparent telemetry](https://research.swtch.com/telemetry-design) and
[Go's telemetry documentation](https://go.dev/doc/telemetry). It goes further on transport:
there is no upload mode. [Homebrew's analytics disclosure](https://docs.brew.sh/Analytics)
and [Next.js's disclosure](https://nextjs.org/telemetry) are useful models for listing
collected and excluded data. This command requires an explicit invocation and leaves
sharing to the user, without enrollment or a persistent anonymous id.

[TypeScript extendedDiagnostics](https://www.typescriptlang.org/tsconfig/extendedDiagnostics.html)
motivates phase times, counts and coverage comparisons. Its
[performance tracing guidance](https://github.com/microsoft/TypeScript/wiki/Performance-Tracing)
warns that traces can contain workspace paths and source. Context7's TypeScript performance
documentation was consulted for both options. This benchmark deliberately excludes raw
traces and type tables. [rustc self profiling](https://doc.rust-lang.org/unstable-book/compiler-flags/self-profile.html)
motivates measuring internal operations separately from overall elapsed time.

[Sentry's path-scrubbing convention](https://conventions.sentry.dev/attributes/file/)
recognizes that paths can expose users; its
[data scrubbing guidance](https://docs.sentry.io/security-legal-pii/scrubbing/)
also shows why free-text crash payloads need special care. Here only fixed classes and
allowlisted Skyplate frames are constructed, rather than trusting a PII scrubber.
[C-Reduce](https://github.com/csmith-project/creduce) and
[preduce](https://github.com/fitzgen/preduce) preserve a failure predicate while reducing a
test case. The skeleton instead preserves selected structure while replacing all content;
it can reproduce structural cost but cannot promise to retain a syntax-dependent bug.

## Handing a benchmark back

Read `benchmark.md` in full, including `privacy` and any `skeleton`. JSON and Markdown hold
the same data, the Markdown as lists and tables; send whichever is convenient, or both. Do not attach the ordinary report,
source folder, shell history, trace, or logs unless you have separately decided those can
be shared. The filenames are generic. The command neither contacts a maintainer nor
chooses a service for you. On receipt, a maintainer should check failures and validation,
then limits and compiler coverage, then anomaly evidence, phase/worker cost and query size.
