# Benchmark verification

These scripts check the benchmark's privacy contract and structural regeneration through
the same functions used by `skyplate bench`. Read `docs/benchmark.md` for the output's
meaning. The benchmark is anonymous by construction; the surrounding eval metadata is
separate and identifies public inputs so the experiment can be repeated.

`run.ts` analyzes a project with `runBenchmark`, validates it with the current
`validateBenchmark`, writes JSON and Markdown, and checks the current rendering. It
requests a skeleton, generates a synthetic repository below the selected output, analyzes
that repository, and checks file and directory counts, every directory parent, every file
membership, and every directed code edge including type-only status.

The same command creates an independent canary repository under the output. Random tokens
appear in paths, extensions, identifiers, source text, package/dependency names, secret
contents, author identity, commit subject, branch, tag, and remote. It validates the
collected benchmark and scans JSON and Markdown for every token. It then injects a token
into an in-memory Markdown rendering and into a JSON field to prove the checks reject
them. The original renderer and analyzed project are never edited. The mutation control
tests detection of a leaked rendering; it does not modify the production renderer as the
historical experiment did. The existing `test/bench.test.ts` additionally exercises fault
and cap paths; this eval does not duplicate that suite.

## Inputs and commands

Run from the repository root. Dependencies must already be installed. Set `WORK` to an
existing writable directory outside the checkout and analyzed projects. Every `--out`
must be a new directory. All generated files, Git histories, benchmark files, and synthetic
source stay below it. No script installs packages or executes generated synthetic source.

```sh
bun evals/benchmark/run.ts --project . --out "$WORK/benchmark-skyplate"
bun evals/benchmark/verify.ts --input "$WORK/benchmark-skyplate/benchmark" --out "$WORK/verify-skyplate"
bun evals/benchmark/imports.ts --project . --out "$WORK/benchmark-import-followup"
python3 -I evals/structure/clone.py --name requests --out "$WORK/benchmark-requests-input"
bun evals/benchmark/run.ts --project "$WORK/benchmark-requests-input/repository" --out "$WORK/benchmark-requests"
```

The public Requests input is https://github.com/psf/requests.git at
`3c7baaa05ab4aa49cc819ce3a819d260de19c157`, depth 50. Skyplate's input/analyzer HEAD is
recorded in `run.json`. Working-tree eval additions affect its counts and can differ even
when HEAD is unchanged. Default workers are two, matching the historical benchmark study.
Optional `--workers N` and `--max-commits N` select explicit limits. Ordinary source, git,
and compiler analysis remain enabled. The synthetic reanalysis disables all three and
uses the requested worker count.

`imports.ts` preserves the original follow-up method for inspecting unresolved import
spellings. It excludes secrets and binary/oversized files, disables history and compiler
work, and writes local source evidence under `--out`. Its output is not anonymous and is
not part of the benchmark format.

| Historical input | URL | Recorded commit |
| --- | --- | --- |
| Go | https://github.com/golang/go.git | Missing from retained evidence |
| Flask | https://github.com/pallets/flask.git | Missing from retained evidence |
| Skyplate implementation checkout | This repository | Missing from the original benchmark work notes |

The Go and Flask clones used depth 50. The source notes did not capture their commit IDs,
and benchmark outputs intentionally contain no commit IDs. Their exact historical inputs
cannot be reconstructed from these aggregates. To run a new public comparison, pin a
commit explicitly and retain it outside the anonymous benchmark. For example, after
preparing external directories `GO_INPUT` and `FLASK_INPUT`:

```sh
bun evals/benchmark/run.ts --project "$GO_INPUT" --out "$WORK/benchmark-go"
bun evals/benchmark/run.ts --project "$FLASK_INPUT" --out "$WORK/benchmark-flask"
```

## Historical evidence and current validation

The study's first benchmark outputs (Go, Flask and Skyplate) predate the released format:
they name a tool that has since been renamed, and the current validator rejects them. They are
not kept here, and nothing was migrated or relabeled to make them pass. What they showed, in
their older power-of-two duration buckets: total time at most 2,048 ms for Skyplate, 128 ms for
Flask and 4,096 ms for a Go repository of 16,296 tracked files, with two workers. Those buckets
are not comparable with today's two-significant-figure durations.

`results/2026-11-16/` keeps what still applies. `shape-proof.json` records the Flask skeleton
regeneration (236 files, 52 directories, 189 code edges); that proof checked directed pairs,
parents and memberships, and type-only preservation was covered by a separate fixture test.
`canary-mutation.log` records the deliberate renderer leak and the canary failing on it, with
local paths replaced by neutral markers. `validated-skyplate/` is the final Skyplate benchmark
of that day, which passes the current validator; its Markdown was regenerated by the current
renderer with the measurements unchanged (`rerender-provenance.json`):

```sh
bun evals/benchmark/verify.ts --input evals/benchmark/results/2026-11-16/validated-skyplate --out "$WORK/benchmark-baseline-verify"
```

`verify.ts` always records the validation outcome in its new output directory and exits
nonzero on rejection or a rendering mismatch. `rerender.ts` regenerates only the Markdown of a
valid benchmark, which is how a sample written by an older renderer is brought current.

## Current rerun and duration

`results/2026-11-17/skyplate/` passed vocabulary, shape, report-validation, and rendering
checks. Analysis measured 2,100 ms after duration rounding. The synthetic round trip
preserved 508 files, 104 directories, and 979 typed code edges. All structural checks
passed. Both canary mutation controls fired, and the unmodified canary had no token leaks,
fatal failures, or report-validation errors. `run.json`, `shape-proof.json`, and
`canary-proof.json` record these outcomes.

The public Requests rerun measured 93 ms after rounding and regenerated 128 files,
24 directories, and 107 edges. It passed both canary controls and every shape check.
Its benchmark and proofs are under `results/2026-11-17/requests/`. These checks take a few
seconds on Skyplate and less than a second on Requests in this smoke pass; a large
project's history or compiler pass can take minutes. The command does an original
analysis, a synthetic analysis, and a separate small canary analysis.

The analyzer version and working-tree input changed between studies, and the historical
Go/Flask commit IDs are missing. Current successful checks establish the present format's
contract on these inputs. They do not establish performance regression bounds against
the older buckets. The large Go/Flask benchmark runs and the original source-editing
mutation were not repeated. No upload, external telemetry, private input, or dev server
was used.

The historical Go run exposed the package sibling cap behind S2. The follow-up noted
standard-library root handling and unresolved generated/environment inputs, but those
observations are not independent native dependency or compiler oracles. S1-S9 accuracy
repros live in `evals/structure/`; a valid anonymous benchmark alone does not prove those
relationships correct. A skeleton preserves tree and graph shape, not original syntax,
symbols, source, secrets, history, or dependency semantics.
