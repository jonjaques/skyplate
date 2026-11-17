# Packaging verification

All commands ran from the repository root. `WORK` below denotes the permitted external
scratch output parent. It is intentionally not stored as a local absolute path. Existing
inputs were read in place. Generated repositories and reports remain under that parent.
Only `evals/structure`, `evals/first-answer`, and `evals/benchmark` were written in the
checkout. No checkout changes were staged or committed, no packages were installed, and
no dev server was started.

The historical structure analyzer was
`f0f874f82700ec5e5c62beef457e74de95d5841d`. The small reruns used
`e4b548cb3e71dc1c3edc3479b9f596a18c14dc3a` plus the shared uncommitted working tree.
Other eval owners were writing concurrently. Their changes can affect self-analysis file
counts and typecheck availability. Per-run runtime and input commits are retained where
the original method exposed them.

## Command ledger

These are the executed eval and verification commands, with the external scratch prefix
represented by `WORK`. Source/evidence reads and file-creation commands are not evals.

| Command | Result |
| --- | --- |
| `bun test`, before edits | 671 pass, 2 skip, 0 fail; 10,370 assertions; 18.05 seconds |
| `bun check`, first implementation pass | No errors in these three directories; three errors in the concurrently edited TypeScript eval directory |
| `python3 -I evals/structure/clone.py --name requests --out "$WORK/requests-input"` | Fetched and verified `3c7baaa05ab4aa49cc819ce3a819d260de19c157`, depth 50 |
| `bun evals/structure/run.ts --project "$WORK/requests-input/repository" --name requests --out "$WORK/requests-rerun"` | Exit 0; 128 files; Python 119 internal, 206 external, zero unresolved; report validates |
| `python3 -I evals/structure/history-fixtures.py --out "$WORK/history-rerun"` | Exit 0; initial arithmetic checks matched |
| `python3 -I evals/structure/history-fixtures.py --out "$WORK/history-rerun-v2"` | Exit 0 after adding ownership/coupling/truck-factor checks; all fourteen checks true |
| `bun evals/structure/encoding.ts --out "$WORK/encoding-rerun"` | Exit 0; nonbinary text differs from strict Shift_JIS decode; S7 reproduced |
| `bun evals/structure/repros.ts --out "$WORK/repros-rerun"` | Exit 0; twelve source cases and one known graph measured |
| `python3 -I evals/structure/type-guards.py --project "$WORK/requests-input/repository" --report "$WORK/requests-rerun/report/data/report.json" --imports "$WORK/requests-rerun/imports.ndjson.gz" --out "$WORK/type-guards-rerun"` | Exit 0; 18 guarded imports, 12 guarded-only pairs, no runtime cycle after removal |
| `python3 -I evals/structure/correlate.py --project "$WORK/requests-input/repository" --report "$WORK/requests-rerun/report/data/report.json" --radon evals/structure/results/2026-11-16/radon-requests.json --out "$WORK/complexity-rerun"` | Exit 0; all original correlation rows and aggregates match using retained Radon output |
| `bun evals/structure/graph-scale.ts --out "$WORK/graph-rerun"` | Exit 0; 23.87 ms at 100k and 85.23 ms at 1M, chain only |
| `bun evals/structure/mcp.ts --project "$WORK/requests-input/repository" --out "$WORK/mcp-rerun"` | Exit 0; twelve calls recorded, including expected invalid queries; client closed |
| `python3 -I evals/structure/tables.py --results evals/structure/results/2026-11-16 --out "$WORK/historical-tables"` | Exit 0; historical tables reconstructed |
| Same tables command with `--out "$WORK/historical-tables-v2"` | Exit 0 after adding detection verdict totals; 119 of 120 language labels accepted |
| `python3 -I evals/structure/compare.py --historical evals/structure/results/2026-11-16 --current evals/structure/results/2026-11-17 --out "$WORK/comparison"` | Exit 0; import counts, correlations, guarded-pair results unchanged; history checks true |
| `bun evals/first-answer/run.ts --project . --query 'benchmark privacy' --out "$WORK/first-answer-rerun"` | Development attempt interrupted after finding the client assumed status always returned a list. With a project selector status returns one project; parser corrected. This attempt is not a timing result |
| `bun evals/first-answer/run.ts --project . --query 'benchmark privacy' --timeout-seconds 60 --out "$WORK/first-answer-rerun-v2"` | Exit 0; map at 1,663 ms, locate 5.4 ms, complete analysis observed, clean exit 0, no stderr |
| `bun evals/benchmark/run.ts --project . --out "$WORK/benchmark-rerun"` | Exit 0; 508 files / 104 directories / 979 edges preserved; both canary controls caught mutations |
| `bun evals/benchmark/run.ts --project "$WORK/requests-input/repository" --out "$WORK/benchmark-requests-rerun"` | Exit 0; 128 files / 24 directories / 107 edges preserved; both canary controls caught mutations |
| `bun evals/benchmark/verify.ts --input <pre-release Go snapshot> --out "$WORK/validate-go-report"` | Expected rejection of retired `search` vocabulary |
| `bun evals/benchmark/verify.ts --input <historical-folder> --out "$WORK/revalidate-<folder>"`, separately for all seven originals | Six retired schemas rejected; `bench-check` JSON valid with a current-renderer mismatch. The six rejected snapshots were then dropped from the repository rather than kept as samples |
| `bun evals/benchmark/verify.ts --input <original-bench-check> --out "$WORK/validate-bench-check"` | JSON valid, old Markdown differs from current renderer |
| `bun evals/benchmark/rerender.ts --input <original bench-check> --out "$WORK/rerender-baseline"` | Exit 0; measurements unchanged, Markdown regenerated |
| `bun evals/benchmark/verify.ts --input evals/benchmark/results/2026-11-16/validated-skyplate --out "$WORK/verify-baseline-rerender"` | Exit 0; vocabulary, shape, report counters, Markdown all valid |
| `bun evals/benchmark/verify.ts --input evals/benchmark/results/2026-11-17/skyplate --out "$WORK/verify-new-skyplate"` | Exit 0; current self-analysis sample valid |
| `bun evals/benchmark/verify.ts --input evals/benchmark/results/2026-11-17/requests --out "$WORK/verify-requests"` | Exit 0; current public sample valid |
| `bun check`, after owners' fixes and final runner edits | Pass; no type errors in 267 files |
| `bun evals/benchmark/imports.ts --project . --out "$WORK/benchmark-import-followup"` | Exit 0; three unresolved statements preserved as local follow-up evidence |
| `bun evals/first-answer/run.ts --project "$WORK/requests-input/repository" --query requests --timeout-seconds 60 --out "$WORK/first-answer-requests-final"` | Exit 0 after final client changes; map at 300 ms, locate 1.8 ms, full ready at 303 ms, clean shutdown |
| `bun test`, after implementation | 671 pass, 2 skip, 0 fail; 10,370 assertions; 17.59 seconds |
| `git diff --check -- evals/structure evals/first-answer evals/benchmark` | Pass; created files are untracked, so a separate content scan also checked them |
| Required `rg -i` scan for local names, local home/private paths, and machine names across the three directories | No matches; a separate scan also decompressed every gzip file |
| JSON parse and test-discovery filename scans | Pass; no created file matches a Bun test-discovery pattern |

## Remaining limits

No Kubernetes or Rails clone/run was repeated, nor the large Go/Flask benchmark analyses.
No new Radon oracle was generated; the original parser output was reused. Cargo comparison,
native language builds, blame, broad dependency-use oracles, a second parser-complexity
language, and repeated isolated timing studies were not run. Large corpus sample selection
and the original manual 140-edge review were retained rather than repeated.

The full 2.1 MB Kubernetes import stream, original viewer reports, generated synthetic
trees, public clones, and redundant source copies are omitted from the checkout. Counts,
selected rows, manual sheets, logs, and rerun methods remain. The published three-directory
package stays below approximately 3 MB.

No source or configuration change outside the assigned directories is needed for the
runners. The missing historical commits and full-completion timing cannot be recovered
from anonymous aggregates or from a client that never waited for them. Documentation
should retain those limits rather than attribute the separate structure clone to the
first-answer run. Old Go/Flask benchmark JSON requires an explicitly designed schema
migration if current-format reuse is wanted; these evals preserve the originals and their
validation failures instead.
