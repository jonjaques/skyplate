# Packaging verification commands

All commands ran from the repository root unless a working directory is given. `WORK`
denotes the assigned temporary `typescript-pack` directory, outside the checkout. `EVIDENCE`
denotes the original read-only `r1-ts` study directory. Paths below use these variables so
this public record contains no host-specific absolute roots. JSON files beside this log
hold the measurements and comparisons. No dev server, commit, staging, or git-state mutation
was run.

## Baseline and inspection

| Command | Result |
| --- | --- |
| `git status --short`; `git branch --show-current`; `git rev-parse HEAD` | Existing shared edits observed; branch `task-tools-benchmark`, head `e4b548cb3e71dc1c3edc3479b9f596a18c14dc3a` |
| `bun test` | 671 pass, 2 skip, 0 fail; 10,370 assertions; 19.41 s |
| `command cat docs/roadmap/research/typescript-symbols.md`; `rg` in `docs/roadmap/defects.md` | Read the study and defect mapping; neither file changed |
| `rg --files "$EVIDENCE"` excluding dependencies and unrelated chart inputs | Inventoried original scripts, fixture inputs, logs, and JSON |
| Reads of original scripts, summaries, selections, evidence, and timing logs using `cat`, `sed`, and Python | Recovered method, revisions, counts, original normalization, and saved outputs |
| Reads of analyzer contracts, TS API declarations, compiler pass, MCP symbol query, and `.gitignore` using `cat`, `sed`, and `rg` | Verified imports, checker overloads, current pagination shape, and fixture tracking rules |

## Installation, corpus runs, and comparisons

| Command | Result |
| --- | --- |
| `(cd evals/typescript && bun install --ignore-scripts)` | Installed the isolated TypeScript 5.9.3 oracle; generated `bun.lock`; no root installation |
| `git clone --revision=a8a6fbec4e0e866d6d779b10889bb4f5567e70eb https://github.com/sindresorhus/p-limit.git "$WORK/p-limit"` | Cloned the pinned public corpus |
| `bun evals/typescript/measure.ts --project "$WORK/p-limit" --out "$WORK/plimit-bare-rerun"` | 6 files, 38 symbols, 139 refs, 252 unresolved |
| `bun evals/typescript/oracle.ts --project "$WORK/p-limit" --input "$WORK/plimit-bare-rerun/analysis.json" --corpus plimit --out "$WORK/plimit-bare-oracle-rerun"` | 12 selected, zero selector errors; refs 35/0/0, invocations 23/0/0, callers 9/0/0 |
| `bun evals/typescript/compare.ts --kind oracle --baseline evals/typescript/results/2026-11-16/plimit-bare-oracle.json --current "$WORK/plimit-bare-oracle-rerun/oracle.json" --out "$WORK/plimit-bare-comparison"` | No changed or added selections |
| `(cd "$WORK/p-limit" && bun install --ignore-scripts)` | Installed dependencies only in the disposable corpus; 565 packages |
| `bun evals/typescript/measure.ts --project "$WORK/p-limit" --out "$WORK/plimit-installed-rerun"` | 6 files, 38 symbols, 139 refs, 116 unresolved |
| `bun evals/typescript/oracle.ts --project "$WORK/p-limit" --input "$WORK/plimit-installed-rerun/analysis.json" --corpus plimit --out "$WORK/plimit-installed-oracle-rerun"` | 12 selected, zero errors; same accuracy triples |
| `bun evals/typescript/compare.ts --kind oracle --baseline evals/typescript/results/2026-11-16/plimit-installed-oracle.json --current "$WORK/plimit-installed-oracle-rerun/oracle.json" --out "$WORK/plimit-installed-comparison"` | No changed or added selections |
| `git clone --revision=43fca52d28a422c8be48fd489cbd4f2d6152bab6 https://github.com/expressjs/express.git "$WORK/express"` | Cloned the pinned public corpus |
| `bun evals/typescript/measure.ts --project "$WORK/express" --out "$WORK/express-bare-rerun"` | 142 files, 407 symbols, 2,119 refs, 12,167 unresolved |
| `bun evals/typescript/oracle.ts --project "$WORK/express" --input "$WORK/express-bare-rerun/analysis.json" --corpus express --out "$WORK/express-bare-oracle-rerun"` | 16 selected, zero errors; refs 909/0/1, invocations 699/0/1, callers 118/0/1 |
| `bun evals/typescript/compare.ts --kind oracle --baseline evals/typescript/results/2026-11-16/express-bare-oracle.json --current "$WORK/express-bare-oracle-rerun/oracle.json" --out "$WORK/express-bare-comparison"` | No changed or added selections, including the CommonJS supplement |

After moving git revision collection outside the timed interval in `measure.ts`, the final
p-limit installed pass was repeated end to end:

```sh
bun evals/typescript/measure.ts --project "$WORK/p-limit" --out "$WORK/plimit-final-measure"
bun evals/typescript/oracle.ts --project "$WORK/p-limit" --input "$WORK/plimit-final-measure/analysis.json" --corpus plimit --out "$WORK/plimit-final-oracle"
bun evals/typescript/compare.ts --kind oracle --baseline evals/typescript/results/2026-11-16/plimit-installed-oracle.json --current "$WORK/plimit-final-oracle/oracle.json" --out "$WORK/plimit-final-comparison"
```

Result: unchanged counts and locations, 12 selections, zero errors or changed selections.
The final summary and oracle are the installed artifacts saved here.

## Probes, faults, and scale

| Command | Result |
| --- | --- |
| `bun evals/typescript/probes.ts --out "$WORK/probes-rerun"` | 34 files, 105 symbols, 71 refs, zero unresolved, seven host files; workspace fixture has two files/four symbols/two refs |
| `bun evals/typescript/compare.ts --kind probes --baseline evals/typescript/results/2026-11-16 --current "$WORK/probes-rerun" --out "$WORK/probes-comparison"` | All 71 non-module rows unchanged; only Leaf.run and Base.run query answers changed, as expected for T3 |
| `bun evals/typescript/measure.ts --project "$WORK/probes-rerun/probes" --out "$WORK/probes-measure-rerun"` | Same compiler file/symbol/reference totals; unused exports 45 versus 44 in the host-aware pipeline |
| `bun evals/typescript/oracle.ts --project "$WORK/probes-rerun/probes" --input "$WORK/probes-measure-rerun/analysis.json" --corpus probes --samples evals/typescript/probe-samples.json --out "$WORK/probes-oracle-rerun"` | 12 selected, zero errors; 24/24 refs, 9/9 invocations, 8/8 callers |
| `bun evals/typescript/faults.ts --out "$WORK/faults-rerun"` | T4, T6, T7, T8 reproduce; warning text uses the new injection label; timing differences are observational |
| `bun evals/typescript/mcp.ts --mode pagination --out "$WORK/pagination-rerun"` | 3,000 returned, 3,000 unique; pages of 2,500 and 500; old unknown offset rejected |
| `bun evals/typescript/scale.ts --count 100 --out "$WORK/scale100-rerun"` | 198 refs in both runs; 45.2 ms then 36.9 ms; no OS resource measurement |

## Historical import, arithmetic, and final checks

| Command | Result |
| --- | --- |
| `python3 evals/typescript/archive.py --source "$EVIDENCE" --out "$WORK/archive-final"` | Imported compact, sanitized original evidence with input hashes |
| Earlier imports with outputs `archive-2026-11-16`, `archive-sanitized`, and `archive-compact` | Successive archive checks found identity metadata and wrapped installer paths; final importer omits those fields and path text |
| `cp -R "$WORK/archive-final/" evals/typescript/results/2026-11-16/` | Packaged the imported results; original inputs unchanged |
| `bun evals/typescript/summarize.ts --results evals/typescript/results/2026-11-16 --out "$WORK/summary-rebuilt"` | Rebuilt corpus/stratum totals |
| `bun evals/typescript/summarize.ts --installed evals/typescript/results/2026-11-16/sky-installed-oracle.json --bare evals/typescript/results/2026-11-16/sky-bare-oracle.json --out "$WORK/paired-rebuilt"` | Rebuilt the installed-ground-truth stress comparison |
| Python assertions comparing TP/FP/FN and sample counts with `summary-results.json` | All corpus, stratum, and Skyplate paired totals match |
| `bun check` during implementation | First run found three errors in the injection overload and MCP result typing; fixed locally. Subsequent checks passed |
| `bun check` final | No errors in 266 files |
| `bun test` final, redirected to `"$WORK/final-tests.log"` | 671 pass, 2 skip, 0 fail; 10,370 assertions; 17.62 s |
| `bun evals/typescript/measure.ts --project "$WORK/p-limit" --out evals/typescript/rejected-output` | Expected rejection; no output directory created in checkout |
| `bun evals/typescript/measure.ts --project "$WORK/p-limit" --out "$WORK/plimit-final-measure"` repeated | Expected existing-output rejection |
| `git check-ignore -v evals/typescript/fixtures/probes/packages/built/dist/index.d.ts` | Eval-local exception retains the intentional dist declaration fixture |
| Requested public-content `rg` scan | Final scan prints nothing; exit 1 means no matches |
| Python file inventory and discovery-pattern audit | Dependencies excluded from packaged size, zero test-discovery filenames |

The fixture copies, manifests, verification summaries, and inventory were written using
Python and patch edits under `evals/typescript/`. Inspections used `cat`, `sed`, `rg`, and
Python; no credentials or home-directory configuration was read. No edits outside the
owned directory were needed. All temporary outputs and the two public clones remain in
the assigned temporary packing directory.
