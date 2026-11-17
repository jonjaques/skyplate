# TypeScript code intelligence eval

This eval measures Skyplate's recorded TS/JS declarations, reference locations, static
invocations, invocation callers, and unused-export classifications. It packages the
November 16, 2026 study behind
[the TypeScript symbols study](../../docs/roadmap/research/typescript-symbols.md). It is a diagnostic
eval: a changed result needs explanation, and an old defect is not an expected behavior
that future implementations must preserve.

The independent oracle is TypeScript 5.9.3 `LanguageService.findReferences`. Skyplate uses
TypeScript 7.0.2. The eval's private package pins the oracle separately, so installing it
does not change the analyzer's compiler. `samples.json` holds the original 72 declarations.
The initial selection contained 64; eight store members were added after observing a
dependency-related loss. This is a purposive sample, not a random accuracy estimate.

## Files and output rules

| File | Purpose |
| --- | --- |
| `measure.ts` | Run the production compiler pass with the original rg file selection; save tables and timing |
| `oracle.ts` | Independently find reference locations and classify invocation syntax and callers |
| `scoring.ts` | Oracle row types and precision/recall arithmetic, shared by the oracle, summary and comparison |
| `summarize.ts` | Sum corpus/stratum scores or compare absent dependencies with installed ground truth |
| `probes.ts` | Stage and analyze the semantic probes; query impact, host uses, and an object seam; run the project-reference fixture |
| `faults.ts` | Inject one checker failure; exercise missing dependencies, reference caps, recursion, seam, and JS prototypes |
| `mcp.ts` | Exercise actual stdio MCP reference pagination or the original dogfood questions |
| `scale.ts` | Generate a chain project, analyze it, edit one file, and analyze again |
| `compare.ts` | Compare oracle locations/callers or semantic probe rows/queries with saved evidence |
| `archive.py` | Pack the original study evidence; record source hashes and the reductions applied |
| `common.ts` | Validate arguments and output paths, discover files, stage fixtures, normalize paths |
| `cases.json` | Map each compiler input and host companion to its construct and defect IDs |
| `corpora.json` | Corpus URLs, revisions, and measured dependency states |

All measurement commands require a new `--out` directory outside both the Skyplate checkout
and the analyzed repository. They refuse an existing output. Roots in saved JSON are `.`
or placeholders; the oracle takes `--project` explicitly rather than relying on a saved
absolute root. No analyzed corpus is modified. Probe and scale commands prepare their own
disposable inputs under `--out` before analysis. The scale command's one source edit is the
explicit freshness experiment. Fixture package symlinks are relative and staged at runtime;
no `node_modules` or third-party clone is shipped here.

Fixtures intentionally retain the study's source spelling and line breaks so archived
coordinates remain meaningful. Some inputs are invalid or incomplete. They are excluded
from the root typecheck by its existing `evals/**/fixtures` rule. `oracle.ts` is excluded too,
because it imports TypeScript 5.9.3 from this directory's package, which a clean checkout does
not install; after the setup below, `bun check evals/typescript/oracle.ts` checks it. None of
the eval files uses a filename discovered by `bun test`.

## Setup and corpora

Run from the Skyplate repository root. Bun, rg, git, and the root's already installed
dependencies are required. Use Python 3 only to import the original evidence. The oracle
package installation is local to this directory:

```sh
REPO="$PWD"
(cd evals/typescript && bun install --frozen-lockfile --ignore-scripts)
WORK="$(mktemp -d -t skyplate-typescript)"
```

Keep `WORK` outside any source checkout. Every output subdirectory below must be new.
The original study used Bun 1.4.4. Archived source hashes, tool versions, and the original
Skyplate revision are in `results/2026-11-16/provenance.json`.

| Corpus | URL | Study commit |
| --- | --- | --- |
| Skyplate | This repository; canonical URL is `repository.url` in [package.json](../../package.json) | `f0f874f82700ec5e5c62beef457e74de95d5841d` |
| TanStack Query | https://github.com/TanStack/query.git | `d63a027c26b2489b8be065ad76f638e36216854a` |
| Express | https://github.com/expressjs/express.git | `43fca52d28a422c8be48fd489cbd4f2d6152bab6` |
| p-limit | https://github.com/sindresorhus/p-limit.git | `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` |

The external revisions are recorded in the original `external-evidence.md`, whose hash is
retained in provenance. No corpus revision is missing. Skyplate's URL is resolved from its
own metadata instead of duplicating the repository owner's identity in this eval.

Clone the measured inputs into the temporary directory. `git clone --revision` requires
a recent git; it creates a detached input clone without changing this checkout.

```sh
SKY_URL="$(bun -e 'const p = await Bun.file("package.json").json(); console.log(p.repository.url.replace(/^git\+/, ""))')"
git clone --revision=f0f874f82700ec5e5c62beef457e74de95d5841d "$SKY_URL" "$WORK/skyplate"
git clone --revision=d63a027c26b2489b8be065ad76f638e36216854a https://github.com/TanStack/query.git "$WORK/query"
git clone --revision=43fca52d28a422c8be48fd489cbd4f2d6152bab6 https://github.com/expressjs/express.git "$WORK/express"
git clone --revision=a8a6fbec4e0e866d6d779b10889bb4f5567e70eb https://github.com/sindresorhus/p-limit.git "$WORK/p-limit"
```

These input clones pin corpus source. The analyzer always comes from the checkout containing
this eval, so later analyzer fixes can be measured on the same corpus. Bare and installed
oracle runs must happen before and after dependency installation respectively. Installing
first and then running both oracles would invalidate the dependency experiment.

## Rerun corpus accuracy and dependency stress

This helper writes one analyzer dump and one oracle result per state. The oracle uses the
same source tree as that dump; do not edit the corpus between the two commands.

```sh
measure_corpus() {
  eval_label="$1"
  eval_corpus="$2"
  eval_project="$3"
  bun "$REPO/evals/typescript/measure.ts" --project "$eval_project" --out "$WORK/$eval_label-measure"
  bun "$REPO/evals/typescript/oracle.ts" --project "$eval_project" \
    --input "$WORK/$eval_label-measure/analysis.json" --corpus "$eval_corpus" \
    --out "$WORK/$eval_label-oracle"
}

measure_corpus sky-bare sky "$WORK/skyplate"
measure_corpus query-bare query "$WORK/query"
measure_corpus express-bare express "$WORK/express"
measure_corpus plimit-bare plimit "$WORK/p-limit"

(cd "$WORK/skyplate" && bun install --ignore-scripts)
(cd "$WORK/express" && npm install --ignore-scripts)
(cd "$WORK/p-limit" && bun install --ignore-scripts)

measure_corpus sky-installed sky "$WORK/skyplate"
measure_corpus express-installed express "$WORK/express"
measure_corpus plimit-installed plimit "$WORK/p-limit"
```

The original Query installation with pnpm 12.3.4 failed to parse
`lockfile.includeResolutionSettings` in `pnpm-workspace.yaml`; its requested manager was
12.18.0. `results/2026-11-16/query-install.log` preserves the failure. Installed Query was
not measured. There is no substitute installed result in this eval.

Rebuild the historical corpus and stratum arithmetic, and the installed-versus-absent
comparison, directly from the checked-in location evidence:

```sh
bun evals/typescript/summarize.ts --results evals/typescript/results/2026-11-16 --out "$WORK/historical-summary"
bun evals/typescript/summarize.ts \
  --installed evals/typescript/results/2026-11-16/sky-installed-oracle.json \
  --bare evals/typescript/results/2026-11-16/sky-bare-oracle.json --out "$WORK/historical-paired"
```

To summarize new runs, copy each `oracle.json` to a temporary collection named
`sky-installed-oracle.json`, `query-bare-oracle.json`, `express-installed-oracle.json`, and
`plimit-installed-oracle.json`, then pass that directory to `--results`. For new dependency
stress, pass the new installed and bare oracle files directly. Precision is TP / actual;
recall is TP / expected. Empty denominators produce null, not a perfect score.

To compare a small rerun with its archived sites and caller identities:

```sh
bun evals/typescript/compare.ts --kind oracle \
  --baseline evals/typescript/results/2026-11-16/plimit-installed-oracle.json \
  --current "$WORK/plimit-installed-oracle/oracle.json" --out "$WORK/plimit-comparison"
```

Comparisons write changes for review and do not impose historical defects as pass criteria.
Oracle commands exit nonzero if a selected declaration cannot be resolved uniquely. A low
accuracy score is recorded as a measurement rather than a script execution failure.

## November 16 accuracy results

Each TP/FP/FN triple counts unique locations or unique invocation caller identities for
the selected declarations. Calls include direct calls, `new`, JSX, tags, and decorators.

| Corpus/state | Selected | Reference TP/FP/FN | Ref precision / recall | Invocation TP/FP/FN | Caller TP/FP/FN |
| --- | ---: | --- | --- | --- | --- |
| Skyplate installed | 26 | 375 / 0 / 0 | 100% / 100% | 59 / 0 / 0 | 36 / 0 / 0 |
| Query absent | 18 | 1,447 / 0 / 0 | 100% / 100% | 707 / 0 / 0 | 100 / 0 / 0 |
| Express installed | 16 | 909 / 0 / 1 | 100% / 99.890% | 699 / 0 / 1 | 118 / 0 / 1 |
| p-limit installed | 12 | 35 / 0 / 0 | 100% / 100% | 23 / 0 / 0 | 9 / 0 / 0 |
| Total | 72 | 2,766 / 0 / 1 | 100% / 99.964% | 1,488 / 0 / 1 | 263 / 0 / 1 |

Invocation recall was 99.933%; caller recall was 99.621%; both precisions were 100%.
Express's missed call is `this.lookup(fileName)` in `lib/view.js:94`, reproducing T8.
Only one method reference was discoverable across the four selected Express methods, so
the denominator does not establish completeness for dynamic request/response dispatch.

| Stratum | Selected | Reference TP/FP/FN | Invocation TP/FP/FN | Caller TP/FP/FN |
| --- | ---: | --- | --- | --- |
| Functions, including CommonJS factory | 25 | 1,198 / 0 / 0 | 783 / 0 / 0 | 152 / 0 / 0 |
| Types, interfaces, classes | 13 | 568 / 0 / 0 | 256 / 0 / 0 | 30 / 0 / 0 |
| Methods | 14 | 187 / 0 / 1 | 156 / 0 / 1 | 48 / 0 / 1 |
| Properties | 11 | 445 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| React components/hooks | 5 | 327 / 0 / 0 | 293 / 0 / 0 | 33 / 0 / 0 |
| Variables/constants | 3 | 39 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Getter | 1 | 2 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

Against the installed Skyplate oracle, absent dependencies retained 142 of 375 reference
locations, 48 of 59 invocations, and 30 of 36 callers. Recall was 37.867%, 81.356%, and
83.333%, respectively, with zero false positives. All 233 lost sampled references belonged
to the eight postselected store members. For example `selection` lost 58, `report` 33,
`select` 29, and `symbols` 28. An uninstalled oracle also misses those members, so comparing
only within that environment hides the loss. This is the source of the rounded 38% claim;
it is not an estimate for arbitrary fresh clones. Express and p-limit's selections were
unchanged by installation.

| Corpus/state | TS/JS files | Symbols | Stored refs | Unresolved | Pass wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skyplate absent | 227 | 4,767 | 27,803 | 13,360 | 784 ms |
| Skyplate installed | 227 | 4,767 | 29,363 | 592 | 1,575 ms |
| Query absent | 2,223 | 8,662 | 39,463 | 100,071 | 3,049 ms |
| Express absent | 142 | 407 | 2,119 | 12,167 | 405 ms |
| Express installed | 142 | 407 | 2,119 | 12,149 | 252 ms |
| p-limit absent | 6 | 38 | 139 | 252 | 66 ms |
| p-limit installed | 6 | 38 | 139 | 116 | 122 ms |

These are single compiler-pass measurements, some concurrent with other work. They are
not controlled performance comparisons. The raw pass uses rg's file selection and skips
dependencies, dist, and build, but does not run Skyplate's language/generated/vendor
detector. The original full-pipeline dogfood result had 224 files and 4,746 symbols;
its denominator differs from the raw pass's 227 and 4,767.

## Rerun probes and fault injections

```sh
bun evals/typescript/probes.ts --out "$WORK/probes"
bun evals/typescript/compare.ts --kind probes \
  --baseline evals/typescript/results/2026-11-16 --current "$WORK/probes" --out "$WORK/probe-comparison"
bun evals/typescript/faults.ts --out "$WORK/faults"
bun evals/typescript/mcp.ts --mode pagination --out "$WORK/pagination"
bun evals/typescript/mcp.ts --mode dogfood --project "$WORK/skyplate" --out "$WORK/dogfood"
```

The study's probe tree has 34 analyzed compiler files, 105 symbols, 71 references, zero
unresolved candidates, and seven host files. These are 34 source inputs covering paired
constructs and consumers, not 34 independent statistical trials. `cases.json` lists every
file; `probe-rows.json` retains all non-module declarations, signatures, complexity, unused
flags, host uses, and reference locations. `probe-queries.json` preserves query answers.
The separate workspace fixture has two files, two owning configs, two reference rows,
and zero unresolved candidates.

| Construct group | Historical outcome |
| --- | --- |
| Interface dispatch and override chain | Direct interface call and heritage links present; impact misses callers beyond immediate base, T3 |
| Callbacks, timers, array callbacks, value aliases, call/apply/bind | Reads retained; indirect execution not propagated; optional direct call resolves |
| JSX | Component invocation resolves; interface attributes get writes; type-literal members absent, T1 |
| Decorators, tags, getters/setters, new, arrow class fields | Expected syntactic invocation/access rows present |
| ES star/rename/default, namespace/dynamic import, export=, require/destructuring | TS/JS consumers resolve to declarations |
| Declaration merging and overloads | Merged parts remain separate; repeated names can be ambiguous; adjacent overloads share first anchor |
| Object members | Methods/arrows omitted; object reads remain; no corresponding callees, T1 |
| Destructuring, typeof, ambient/module augmentation, JSDoc | Expected binding/type/property rows present |
| Workspace source export and project references | Source condition and path alias resolve; ownership has no duplicates |
| Workspace dist declarations | Source implementation remains unused with zero refs; no source rebinding, zero unresolved |
| Vue/Svelte/Astro | Direct import protects the declaration; star/renamed/local-export aliases can remain unused, T2 |
| Nested locals and complexity | Local callable absent; its decisions increase outer complexity, T9 |

| Defect | Fixture and script | November 16 observation |
| --- | --- | --- |
| T1 | `probes/jsx.tsx`, `probes/object.ts`; `probes.ts` | Type-literal and object members missing despite interface controls |
| T2 | `probes/host-*`, `probes/alias-only.ts`; `probes.ts` | Direct control protected; host-only star, rename, and local alias exports remain unused |
| T3 | `probes/heritage.ts`; `probes.ts` | `Leaf.run` and `Base.run` impact have zero symbols; fixed on the current branch |
| T4 | `failures/`; `faults.ts` | Two files, six symbols, one reference, zero unresolved, four unused exports; warning without structured incompleteness |
| T5 | `pagination/x.ts`; `mcp.ts --mode pagination` | 3,000 stored locations, 2,500 returned, 500 inaccessible; old `offset` ignored; fixed with `offset` (named `references_offset` until the paging interface was unified) |
| T6 | `cap/x.ts`, `seam-cap/`; `faults.ts` | Caps 100 → 0 change recursion from used-in-own-file to unreferenced and seam interface/uses/callers/files from 1 → 0 |
| T7 | `missing-deps/`; `faults.ts` | Missing React yields zero refs, two unresolved; unrelated ancestor node_modules suppresses absence warning |
| T8 | `prototype-probe/index.js`; `faults.ts` | Prototype method recorded with zero refs; real Express miss also retained in oracle evidence |
| T9 | `probes/local.ts`, `probes/nested-complexity.ts`; `probes.ts` | Uncalled inner branch makes outer complexity 2 instead of direct-body 1 |

All fixture paths in this table are under `fixtures/`. Empty defect lists in `cases.json`
mean controls or documented modeling limits. T4 patches the root TS7 checker's
`getSymbolAtLocation` only for `bad/`, restoring it in `finally`. It models a resolution
batch failure, not a spontaneous process crash. T7 stages an unrelated empty ancestor
installation; the old run's ancestor contained only the independent oracle. Neither
contains React, and the same directory-existence heuristic applies.

Pagination follows `references.nextOffset` until exhausted and checks for exactly 3,000
unique positions. It also submits the obsolete unknown `offset` argument to document
strict validation. `mcp.ts` closes its own client/server and starts no dev server. The
dogfood mode deliberately includes ambiguity and unsupported-selector questions, so error
responses are evidence rather than a command failure.

An additional 12-declaration oracle check on the staged probes can be run independently.
This selection is new and is not part of the historical 72:

```sh
bun evals/typescript/measure.ts --project "$WORK/probes/probes" --out "$WORK/probe-pass"
bun evals/typescript/oracle.ts --project "$WORK/probes/probes" \
  --input "$WORK/probe-pass/analysis.json" --corpus probes \
  --samples evals/typescript/probe-samples.json --out "$WORK/probe-oracle"
```

The raw pass does not add host-use protection, so its unused-export count can differ from
the full-pipeline probe result even when compiler reference locations agree.

## Rerun scale and freshness

The source generator is part of the eval; there are no 20,000-file fixture trees to vendor.
Each run times compiler creation/planning, both passes, and tables, then appends one comment
to the first file and repeats the whole pass in the same Bun process.

```sh
for eval_count in 100 1000 5000 20000 20001; do
  /usr/bin/time -l bun evals/typescript/scale.ts --count "$eval_count" \
    --out "$WORK/scale$eval_count" 2> "$WORK/scale$eval_count-time.txt"
done
```

`/usr/bin/time -l` is the original macOS resource measurement. On other systems the Bun
command remains usable; choose the platform's resource-accounting tool separately.

| Files | Refs | Initial | After edit | OS max RSS | Bun host high-water after second pass |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 198 | 46.4 ms | 34.7 ms | 62.8 MiB | 41.2 MiB |
| 1,000 | 1,998 | 137.6 ms | 119.3 ms | 130.9 MiB | 103.0 MiB |
| 5,000 | 9,998 | 493.2 ms | 455.3 ms | 363.9 MiB | 279.9 MiB |
| 20,000 | 39,998 | 1,724.1 ms | 1,623.8 ms | 761.3 MiB | 451.4 MiB |
| 20,001, default cap | None | 1.1 ms to skip | 0.4 ms to skip | 44.0 MiB | 25.3 MiB |

The OS maximum includes native-child resource accounting, not a sampled simultaneous sum
of processes. Bun's `process.resourceUsage().maxRSS` is in KiB and is a host high-water
across both passes. Reanalysis repeats all work. A faster second pass is not evidence of
incremental snapshots. Above the file cap the entire compiler pass returns null.

## Archive provenance and verification

`results/2026-11-16/` contains the original measurements, not newly measured substitutes.
Large analyzer dumps were reduced to summaries. All selected oracle locations, invocation
classifications, caller identities, and mismatches remain. Duplicate MCP text renderings,
source-context excerpts, and git/ownership identities were omitted. Wrapped installer
paths were removed. Original byte counts and SHA-256 hashes identify the source evidence.
Wall-clock timestamps can cross midnight UTC; the study date uses its original local date.

Given an external copy of the original evidence, the import is rerunnable without writing
back to it or into this checkout:

```sh
python3 evals/typescript/archive.py --source "$EVIDENCE" --out "$WORK/archive"
```

`results/2026-11-17/` records the packaging reruns, comparisons, commands, and checks.
The probes retain identical semantic rows. T3 changes only `Leaf.run` and `Base.run` query
answers: impact grows from zero to two symbols. T5 now returns 2,500 then 500 locations,
with 3,000 unique positions; the obsolete unknown argument is rejected. p-limit matches
all 12 selections, both absent and installed, including every location/call/caller.
Express absent matches all 16 selections and retains the same single prototype miss.
The new probe oracle finds 24/24 reference locations, 9/9 invocations, and 8/8 callers.
Fault outcomes remain reproducible. The 100-file scale rerun is a smoke check only.

Not rerun during packaging: the Skyplate corpus in either state, Query, installed Express,
the dogfood session, the four larger scale points, OS RSS accounting, and the original
standalone 54-test/711-assertion TS run. Root checks are recorded separately. No browser,
runtime-dispatch validation, cold-cache series, real large monorepo benchmark, or heap
profile was performed.

## Study table to evidence map

| Table in `typescript-symbols.md` | Rerun script | Checked-in evidence under `results/2026-11-16/` |
| --- | --- | --- |
| Bounds, selection and failure handling | Production source at the pinned study revision; `faults.ts`, `scale.ts`, `mcp.ts` exercise measured boundaries | `partial-failure.json`, `cap-recursion.json`, `seam-cap.json`, `missing-deps.json`, `pagination-mcp.json`, `scale20001.json` |
| Existing-symbol results by corpus | `measure.ts` → `oracle.ts` → `summarize.ts` | `*-summary.json`, `*-oracle.json`, `summary-results.json`; selections in `../../samples.json` relative to this results directory |
| Results by stratum | `summarize.ts` | `summary-results.json.strata`, supported by each oracle row's kind |
| Dependencies installed versus absent | `measure.ts`, paired `summarize.ts` | Seven `*-summary.json` files; `summary-results.json.paired`; both environments' oracle locations; `query-install.log` |
| Semantics probes | `probes.ts`, `faults.ts` for standalone prototype | `probes.json`, `probe-rows.json`, `probe-queries.json`, `workspace-probe.json`, `prototype-probe.json` |
| Scale and freshness | `scale.ts` with the OS timing command above | `scale100.json` through `scale20001.json` and matching `*-time.txt` |
| Fitness for an editing agent | Qualitative interpretation of source and probes, not an additional measured score | Probe/query/fault evidence above; `mcp.json` for actual questions and errors |
| Frontier | Proposed future acceptance criteria, not measured results | No results claimed; the existing fixtures provide starting inputs |

The study's 54-pass/711-assertion statement came from its existing TS test-file run, not
this eval's probe score. Its other numeric implementation bounds are source facts at the
pinned revision, not performance observations. The archive does not turn proposed future
thresholds into measurements.

## What this does not establish

The oracle aggregates root compiler options over repository TS/JS sources. It does not
reproduce every project owner, export condition, framework language service, or build
variant. It normalizes definition tokens, renamed alias tokens, closing JSX tags, and
synthetic override links while retaining real heritage identifiers. Caller containment
is projected onto Skyplate's recorded declaration granularity; omitted locals and test
callbacks are not independently discovered. Self-recursion is excluded from distinct
invocation caller counts. These counts differ from the broader `SymbolTable.callers`.

Express's re-exported factory needs a narrow supplement: TS5.9's reference service misses
its entry-bound require aliases and includes six instance uses. The oracle keeps the
factory's own-file references, then independently walks locally bound relative requires
of the audited entry/factory. That accounts for 873 factory locations. It is an explicit
corpus-specific adjustment, not general CommonJS ground truth.

Agreement for recorded declarations cannot establish recall for omitted object/type
members, dynamic dispatch, callbacks, external consumers, generated code, or host template
positions. An unused-export verdict means no observed in-repo consumer, not safe deletion.
Zero unresolved candidates do not certify completeness. Dependency versions installed
from ranges can drift despite pinned corpus commits; retain installation state when
investigating future differences. The original installed dependency trees were not saved.
