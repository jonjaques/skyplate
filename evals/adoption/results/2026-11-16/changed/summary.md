# Agent adoption experiment

Repository: https://github.com/vitejs/vite.git, commit 9a8d1a98922c5e445e8a618b8c27f84c63b9fbff. 3007 tracked files; 3230 reachable commits.

Positions count every observed tool invocation, including instruction and skill reads. Handshakes are excluded. These are counts from one pass per prompt, not adoption rates.

| Arm | Prompt | State | Exit | Tools | First Skyplate position | Skyplate calls | Seconds | Grade |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| codex | 01-env | completed | 0 | 5 | - | 0 | 49.3 | correct |
| codex | 02-size | completed | 0 | 9 | - | 0 | 85.2 | correct |
| codex | 03-rename | completed | 0 | 8 | - | 0 | 88.1 | correct |
| codex | 04-refactor | completed | 0 | 7 | - | 0 | 78.2 | correct |
| codex | 05-dead | completed | 0 | 7 | - | 0 | 68.8 | correct |
| codex | 06-risk | completed | 0 | 8 | - | 0 | 104.0 | correct |
| codex | 07-cycle | completed | 0 | 5 | - | 0 | 48.7 | correct |
| codex | 08-hmr | completed | 0 | 6 | - | 0 | 95.1 | correct |
| codex | 09-line control | completed | 0 | 1 | - | 0 | 8.4 | correct |
| codex | 10-read control | completed | 0 | 1 | - | 0 | 13.4 | correct |
| claude | 01-env | completed | 0 | 41 | - | 0 | 142.3 | correct |
| claude | 02-size | completed | 0 | 46 | 1 | 6 | 227.6 | correct |
| claude | 03-rename | completed | 0 | 26 | 1 | 2 | 169.2 | correct |
| claude | 04-refactor | completed | 0 | 47 | 2 | 1 | 521.1 | correct |
| claude | 05-dead | completed | 0 | 27 | 2 | 1 | 109.4 | correct |
| claude | 06-risk | completed | 0 | 25 | 1 | 9 | 208.9 | correct |
| claude | 07-cycle | completed | 0 | 26 | 13 | 2 | 190.4 | correct |
| claude | 08-hmr | completed | 0 | 30 | - | 0 | 118.5 | correct |
| claude | 09-line control | completed | 0 | 2 | - | 0 | 12.3 | correct |
| claude | 10-read control | completed | 0 | 2 | - | 0 | 16.8 | correct |

| Arm | Completed | Tasks using Skyplate / tasks | First tool | First three | Controls using Skyplate / controls | Median tools | Median seconds | Correct / partly / wrong |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |
| codex | 10 | 0 / 8 | 0 | 0 | 0 / 2 | 6.5 | 73.5 | 10 / 0 / 0 |
| claude | 10 | 6 / 8 | 3 | 5 | 0 / 2 | 26.5 | 155.7 | 10 / 0 / 0 |

## Grades

- codex/01-env: correct. Covers mode/envDir, the four files in increasing precedence, expansion, Vite Task then process.env overrides, default and empty-prefix validation, client delivery, and env.spec.ts/config.spec.ts/playground evidence. No implementation or test execution claimed.
- codex/02-size: correct. Supplies a stated rg --files/wc counting basis, exact six-file/4094-line optimizer size, measured unit/playground areas, include expansion, scan/exclusion/runtime/bundler/cache integration and focused tests. Counting differences from tracked-file investigation are within the stated basis. Unlike baseline, completes sizing rather than asking only for new semantics.
- codex/03-rename: correct. Finds the exact implementation/public export and 71-file scope; separates unrelated Rollup API text, inventories callers/tests/docs, preserves normalization behavior, proposes a deprecated alias and staged migration, and identifies plugin-legacy peer-version compatibility. The proposed alias needs declaration-build validation, which is explicitly planned rather than claimed performed.
- codex/04-refactor: correct. Keeps extraction local and follows the existing transform override TODO. Preserves object identity, pluginCode short circuit, truthiness and position precedence, file/frame/map behavior, original-error propagation and location cleanup; provides concrete public-hook characterization tests. No broad public API or claimed test run.
- codex/05-dead: correct. Rejects deletion as dead code, proves the live evaluator/startOffset/runner/fetchModule/source-map chain, explains cached runtime padding plus strict-directive offset, and uses actual history. Any fixed-three-line alternative is explicitly a cross-runtime compatibility decision requiring tests, not an unused-code removal.
- codex/06-risk: correct. Uses concrete config/runtime dependency evidence and historical fixes; gives measured co-change neighbors with explicit date/boundary handling and reviewer identities backed by author history. Calls out shallow history, broad-commit noise, unavailable review discussion/availability and absent CODEOWNERS. No ownership certainty or execution claims.
- codex/07-cycle: correct. Shows both named runtime import directions separately from type-only imports and actual uses, proposes a narrow server/options extraction with type-only back references and compatibility reexports, and explicitly limits the result to the direct cycle because preview introduces another path. Does not claim a runtime failure or completed test run; explicit regression-test detail is limited.
- codex/08-hmr: correct. Traces transport registration and serialization, full-reload selection by triggeredBy/importer roots or all roots, no-selection behavior, whole-graph invalidation, bundled-runtime/client reset, sequential reimport, closed guards and outdated-dependency suppression. Distinguishes selection from invalidation and ordinary runner reload from browser reload.
- codex/09-line: correct. Quotes the exact corrected literal with to inserted after lead. One shell read restricted to env.ts; no unrelated inspection or Skyplate use.
- codex/10-read: correct. Explains the cleanUrl regex and splitFileAndPostfix slicing and supplies the requested query-plus-fragment example. One shell read restricted to shared/utils.ts; no Skyplate use.
- claude/01-env: correct. Covers mode/envDir, four-file precedence, expansion, Vite Task and process.env layers, prefix validation, client replacement/injection, and concrete unit/playground tests. Uses direct implementation evidence and states dependencies and tests were not run.
- claude/02-size: correct. Uses measured six-file/4094-line optimizer totals and separately measured source/test/playground areas; traces manual includes, scanner/runtime/bundler exclusions, config mutation and cache hashing, with concrete bounded helper changes and regression tests. Distinguishes unspecified desired semantics and labels proposed behavior changes. Rough playground counting differences are within the baseline rubric.
- claude/03-rename: correct. Finds exact normalization behavior, public export, 71-file/258-occurrence inventory, staged typed deprecated alias, tests/docs, external Rollup-name exclusion and plugin-legacy peer floor. Maintains runtime behavior and distinguishes unmeasured external consumers. Concrete validation is proposed, not claimed run.
- claude/04-refactor: correct. Follows the existing TODO with a narrow context/subclass boundary, local helpers and no new public API. Preserves identity, early-return and truthiness behavior, position precedence, original-error failure path, file/frame handling, exactly-once source-map side effects and cleanup. Provides concrete characterization tests including empty input and nested this.load behavior. No tests claimed run.
- claude/05-dead: correct. Rejects dead-code deletion, proves the one direct evaluator caller and default-runner/source-map chain, explains cached engine wrapper padding plus strict offset, actual lazy-evaluation history and concrete source-map regression tests. A fixed-offset alternative is explicitly a cross-runtime compatibility tradeoff requiring verification.
- claude/06-risk: correct. Combines Skyplate complexity, symbols, dependencies and coupling with independent git range/co-change/author investigation. Gives concrete risky config regions, actual neighboring files, area-specific reviewers and clone limits. Explicitly detects and rejects Pierre Carrier shallow-boundary ownership rather than repeating it as genuine expertise.
- claude/07-cycle: correct. Shows exact runtime and type-only imports, verifies the one-hop reverse edge, proposes a narrow server-options extraction with explicit moved dependencies and test import updates, and distinguishes the removed direct edge from remaining preview/barrel transitive cycles. Includes appropriate validation without claiming execution.
- claude/08-hmr: correct. Traces transport normalization/registration, serialized handler, triggeredBy file variants and importer roots, no-entry behavior, full graph invalidation, sequential reimport/error guards and bundled-runtime/client reset. Gives concrete regression-test locations and labels untested inferred paths.
- claude/09-line: correct. Quotes the exact corrected literal. Both Grep calls are confined to env.ts, with no unrelated file/test inspection and no Skyplate. Unlike baseline, preserves the one-file control scope.
- claude/10-read: correct. Accurately explains regex removal from the first query/fragment delimiter and postfix slicing, including both delimiters in one example. Grep and Read are restricted to the specified shared/utils.ts file. No execution falsely claimed.

## Limitations

- One pass per prompt and arm, on one repository. Counts are observations, not adoption rates.
- Global instructions and skills were in effect. They caused early shell discovery and skill reads in Codex. Their private text is omitted.
- Target dependencies were not installed; compiler evidence can be incomplete.
- Filesystem and provider caches were not flushed.
- Raw transcripts and final answers are omitted. Grades were reviewed against the preregistered rubric; they cannot be re-audited from this table alone.
- Call positions reflect observed invocation order, including instruction reads, not completion order.
- After-edit review was not exercised because sessions were read-only.
