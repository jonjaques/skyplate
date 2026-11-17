# Structure and history evals

These evals preserve the inputs, methods, manual reviews, and results behind
`docs/roadmap/research/structure-and-history.md`. They measure extracted import statements,
file classification, graph arithmetic, history arithmetic, and analysis cost. They do not
turn a file import into a symbol reference or establish build correctness.

Run from the repository root with Bun dependencies and the built viewer template already
available. `run.ts` invokes this checkout's `bin/skyplate.ts`, including the report writer.
Python commands use `python3 -I`. No script installs dependencies. Every runner requires a
new `--out` directory whose parent already exists, outside this checkout and its analyzed
input. All reports, clones, generated histories, and logs stay below that output. Keep raw
reports there because they contain public source paths and contributor identities.

## Inputs

`corpus.json` records the public URL, full commit, depth, selected languages, and original
clone time. All seven structure commits were retained.

| Name | URL | Commit |
| --- | --- | --- |
| requests | https://github.com/psf/requests.git | `3c7baaa05ab4aa49cc819ce3a819d260de19c157` |
| chi | https://github.com/go-chi/chi.git | `c64ed7d6635f33a8b2feaff7dcfa55677023ac7d` |
| ripgrep | https://github.com/BurntSushi/ripgrep.git | `178cc027e283fd965cb72d0a7395b219eada170c` |
| junit | https://github.com/junit-team/junit-framework.git | `e5198f9b098c550e66d378650f78bac8883e2a72` |
| curl | https://github.com/curl/curl.git | `fb6f021d9a5744aa800da17bb9c0ec5b6238c088` |
| rails | https://github.com/rails/rails.git | `04988cc35d4281173f6327c07609f49227b5ccf9` |
| kubernetes | https://github.com/kubernetes/kubernetes.git | `074eb5db5bbe70923fd2d0af4dc2d0091a539253` |

`clone.py` fetches the recorded object with depth 50, then checks the resulting HEAD. Fetch
failure is an input-preparation failure, not permission to substitute current HEAD. Depth
limits ancestry distance, not total reachable commits. The original Kubernetes structure
clone exposed 18,070 commits and Rails exposed 2,130. A later fetch of the same commit may
retain a different shallow boundary; compare the saved `input.json` before interpreting
history differences.

`fixtures/repros.json` holds small invented source trees. `history-fixtures.py` creates two
repositories with invented author identities, fixed timestamps, isolated Git configuration,
and unsigned commits. `fixtures/japanese.py` is the original 193-byte Shift_JIS specimen,
not a UTF-8 transcription. `fixtures/questions.json` preserves the twelve Requests MCP
questions, including the two deliberately invalid requests.

## Rerun

Set `WORK` to an existing writable directory outside this checkout. Each destination below
must be new. The same clone/run pair works for any name in `corpus.json`.

```sh
python3 -I evals/structure/clone.py --name requests --out "$WORK/requests-input"
bun evals/structure/run.ts --project "$WORK/requests-input/repository" --name requests --out "$WORK/requests-analysis"
python3 -I evals/structure/type-guards.py --project "$WORK/requests-input/repository" --report "$WORK/requests-analysis/report/data/report.json" --imports "$WORK/requests-analysis/imports.ndjson.gz" --out "$WORK/requests-guards"
python3 -I evals/structure/correlate.py --project "$WORK/requests-input/repository" --report "$WORK/requests-analysis/report/data/report.json" --radon evals/structure/results/2026-11-16/radon-requests.json --out "$WORK/requests-complexity"
bun evals/structure/mcp.ts --project "$WORK/requests-input/repository" --out "$WORK/requests-mcp"
python3 -I evals/structure/history-fixtures.py --out "$WORK/histories"
bun evals/structure/repros.ts --out "$WORK/repros"
bun evals/structure/encoding.ts --out "$WORK/encoding"
bun evals/structure/graph-scale.ts --out "$WORK/chains"
python3 -I evals/structure/tables.py --results evals/structure/results/2026-11-16 --out "$WORK/study-tables"
python3 -I evals/structure/compare.py --historical evals/structure/results/2026-11-16 --current evals/structure/results/2026-11-17 --out "$WORK/comparison"
```

The correlation command above reuses the retained Radon oracle. To recompute that oracle,
use a separately installed Radon and keep its cache and output under `WORK`:

```sh
uvx --cache-dir "$WORK/radon-cache" --from radon radon cc --json "$WORK/requests-input/repository" > "$WORK/radon-new.json"
python3 -I evals/structure/correlate.py --project "$WORK/requests-input/repository" --report "$WORK/requests-analysis/report/data/report.json" --radon "$WORK/radon-new.json" --out "$WORK/requests-complexity-new"
```

The original Radon version was not recorded. The retained JSON fixes that oracle for
comparisons; a new Radon version is a changed input. The correlation method deduplicates
class methods and includes closures, then uses average ranks for ties.

Kubernetes phase isolation uses three separate new output directories after preparing its
recorded clone. These are expensive optional runs, not part of the small smoke pass:

```sh
python3 -I evals/structure/clone.py --name kubernetes --out "$WORK/kubernetes-input"
bun evals/structure/run.ts --project "$WORK/kubernetes-input/repository" --name kubernetes --git false --out "$WORK/kubernetes-nogit"
bun evals/structure/run.ts --project "$WORK/kubernetes-input/repository" --name kubernetes --max-commits 50 --out "$WORK/kubernetes-cap50"
bun evals/structure/run.ts --project "$WORK/kubernetes-input/repository" --name kubernetes --out "$WORK/kubernetes-default"
```

With Cargo installed, the native target comparison is:

```sh
python3 -I evals/structure/clone.py --name ripgrep --out "$WORK/ripgrep-input"
bun evals/structure/cargo.ts --project "$WORK/ripgrep-input/repository" --out "$WORK/ripgrep-targets"
```

The native command uses `--offline --locked --no-deps`, so it refuses missing prerequisites
instead of downloading dependencies or changing the clone's lockfile.

## Measurements and reviews

`run.ts` runs the real CLI with `--json --no-source --no-symbols`, validates the report, then
re-runs the production extractor/resolver over the report's walked files. The primary
counts are statements, including self resolutions. Sibling projections and deduplicated
graph edges are separate counts. Standard-library imports count as external. File reads
skip secret, binary, and oversized inputs. Optional `--git false`, `--max-commits N`, and
`--workers N` apply to the CLI run. The original runs used default workers.

The first twenty non-self internal rows sorted by the decimal string of
`Bun.hash(path + "|" + spec)` form `sample.json`. Detection samples sort by `Bun.hash(path)`
and retain eight opening lines. Bun's version can affect the sample; compare saved paths
before comparing verdicts. `results/2026-11-16/edge-review.json` retains all 140 verdicts and
excerpts. `detection-review.txt` and `detection-verdicts.json` retain the 120-row rubric.
`cap-ledger.txt` is the original manual source inventory, not generated ground truth.
The Kubernetes detection sample was captured but was outside the 120-row reviewed set.

Manual review must inspect the import, target, and relevant package context again after a
resolver change. Twenty correct targets establish sample precision, not corpus recall.
For Go the verdict checks package membership, not which file provides a used identifier.
The package-cap probe compares representative-plus-siblings against all non-test Go files
in the target directory, using distinct directed pairs and dropping self pairs. It does
not run `go list` or evaluate build tags.

The graph probe times only in-memory chain graphs at 100,000 and 1,000,000 nodes. Change
`--sizes 1000,100000` for smaller probes. It does not measure walking, decoding, imports,
history, layout, serialization, or a browser. CLI phase clocks overlap and must not be
summed. `cli.log` keeps BSD `time -l` on Darwin or GNU `time -v` on Linux; RSS units differ.

## Results and duration

The historical analyzer commit was `f0f874f82700ec5e5c62beef457e74de95d5841d`.
`results/2026-11-16/manifest.json` lists retained evidence hashes and transformations.
Paths identifying the original local checkout were replaced with neutral markers. Radon
keys are repository-relative. `measurements.json.gz` is a lossless compression of the
retained report summaries. Full viewer reports were not retained. The 2.1 MB Kubernetes
import stream is omitted to keep this eval package small; its counts, unresolved rows,
selected imports, reviews, phase logs, and projection totals remain.
The first Rails CLI attempt raced its clone and analyzed zero files. Its log and the
original `cli-summary.json` remain as experimental history. The retained table uses the
corrected `measurements.json.gz` entry and `rails-rerun.log`, never that zero-file attempt.

The historical statement totals for the primary languages were Requests 325, Chi 389,
ripgrep 1,136, JUnit Java 18,006, curl C 4,246, Rails 6,883, and Kubernetes Go 113,595.
All 140 reviewed internal targets were accepted under the stated rubric. Detection was
accepted for 119 of 120 language labels; the exception was a Ruby template classified as
text. The category rubric accepted all 120, which does not establish actual test roles.
`tables.json` rebuilds the numeric tables from the retained files.

On 2026-11-17, Requests still produced 128 files and 119 internal / 206 external / zero
unresolved Python imports at the recorded commit. The CLI wall was 0.429 seconds in this
single run. The 18 guarded imports and 12 guarded-only pairs still remove the runtime
cycle under the independent AST check. Reusing the historical Radon oracle gave the same
29 matched files and correlations, including 0.965 for production decisions plus one.
Both history fixtures matched commits, additions/deletions, ownership, coupling, truck
factor, identity fusion, and hotspots. The rename-only fixture still returned 66 pairs.
S7 still reproduced. All twelve source repros completed. Chain times were 23.9 and
85.2 ms, close to the original 24.8 and 85.7 ms. These are single runs with shared resource
load, not evidence of a performance improvement. Results are in `results/2026-11-17/`.

The small Requests clone, CLI, histories, repros, encoding, and chain probes each take
roughly a second or less in this smoke pass. Network and machine load vary. The original
Kubernetes CLI took 7.77 seconds without git, 8.90 seconds with cap 50, and 509.20 seconds
with default history. The original Rails clone alone took 220 seconds. Neither large clone
was rerun for this packaging work. No independent native build, dependency-pruning oracle,
new Radon run, blame audit, or broad parser benchmark was run.

## Defect repro map

S1 through S9 correspond to D1 through D9 in the original study's headings.

| Defect | Input and runner | Observation to inspect |
| --- | --- | --- |
| S1, dependency identity | `jvm-coordinate`, `python-dist-name` in `fixtures/repros.json`; `repros.ts` | Declared rows have zero importers while separately named import rows exist |
| S2, package projection | `go-cap`; `repros.ts`, or Chi/Kubernetes with `run.ts` | 24 package members project onto 17 files; compare `package-cap.json` |
| S3, Python guards | `python-type-guard`; `repros.ts`; Requests with `type-guards.py` | A guarded import closes a reported runtime cycle; AST removal eliminates it |
| S4, Cargo custom root | `rust-custom-bin`; `repros.ts` | `helper` and `crate::helper::run` remain unresolved |
| S5, native entries | `rust-custom-bin`, `go-cap`, `swift-entry`; `repros.ts`; `cargo.ts` | Source/native targets exist while entries are absent |
| S6, Python modules | `python-submodule`, `python-namespace`; `repros.ts` | Parent-package fallback or guessed external loses a child-module relationship |
| S7, CJK decoding | `fixtures/japanese.py`; `encoding.ts` | Text classification accepts bytes, embedded source differs from strict Shift_JIS decode |
| S8, C header resolution | `c-extensionless`, `c-search-order`; `repros.ts` | System-external guess or nearest-suffix choice disagrees with stipulated include search |
| S9, Rust qualified use | `rust-qualified`; `repros.ts` | `textwrap::fill` has no extracted import; declared dependency has zero importers |

`jvm-no-explicit-import`, the known graph, and rename histories demonstrate scope limits;
they are not additional defect IDs. Repros record observations rather than asserting that
a defect must remain forever. History assertions check the arithmetic contract and fail
if it changes. Review the saved output before updating any expectation.

## Study table provenance

Paths below are relative to this directory. This maps every Markdown table in the study,
including source inventories and proposals that are not empirical measurements.

| Study table | Runner or method | Retained result/input |
| --- | --- | --- |
| Execution, scope and data contracts | Manual source inventory; `run.ts`, `encoding.ts` | `results/2026-11-16/cap-ledger.txt`, phase logs, `encoding.json` |
| Import extraction and resolution families | Manual source inventory; `repros.ts`, `run.ts` | `cap-ledger.txt`, `repros.json`, `accuracy.json` under the historical result directory |
| Git metric/awkward case behavior | Manual contract review; `history-fixtures.py` | `history-ground-truth.txt`, `rename-ground-truth.txt`, `measurements.json.gz` |
| Repository commits and file counts | `clone.py`, `run.ts`, `tables.py` | `corpus.json`, historical `measurements.json.gz`, `tables.json` |
| Primary language outcomes and 20-row reviews | `run.ts`, manual review, `tables.py` | historical `accuracy.json`, `*-sample.json`, `edge-review.json`, compressed import streams |
| Supplemental language outcomes | `run.ts`, `tables.py` | historical `accuracy.json`, `tables.json` |
| Complexity correlations | `correlate.py` and Radon | historical `radon-requests.json`, `complexity.json` |
| Go package projection | `run.ts`, `tables.py` | historical `package-cap.json`, `tables.json` |
| Hand-counted history file metrics | `history-fixtures.py`, `history.ts`, `tables.py` | historical `measurements.json.gz`, `history-ground-truth.txt`, `tables.json` |
| Kubernetes phases, wall, RSS | `run.ts` in three modes, `tables.py` | historical `measurements.json.gz`, `kubernetes-cli.log`, `kubernetes-cap50.log`, `kubernetes-nogit.log` |
| Non-TypeScript agent questions | Manual interpretation plus `mcp.ts` | `fixtures/questions.json`, historical `mcp-timings.json`; source/graph repros above |
| Ranked frontier proposals | Recommendations, not measured results | The study's cited observations above; no runner claims to validate the proposed future behavior |
