# Agent adoption experiment

Repository: https://github.com/vitejs/vite.git, commit 9a8d1a98922c5e445e8a618b8c27f84c63b9fbff. 3007 tracked files; 3230 reachable commits.

Positions count every observed tool invocation, including instruction and skill reads. Handshakes are excluded. These are counts from one pass per prompt, not adoption rates.

| Arm | Prompt | State | Exit | Tools | First Skyplate position | Skyplate calls | Seconds | Grade |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| codex | 01-env | completed | 0 | 5 | - | 0 | 55.4 | correct |
| codex | 02-size | completed | 0 | 4 | - | 0 | 29.9 | partly |
| codex | 03-rename | completed | 0 | 6 | - | 0 | 100.3 | correct |
| codex | 04-refactor | completed | 0 | 6 | - | 0 | 79.9 | correct |
| codex | 05-dead | completed | 0 | 9 | - | 0 | 78.1 | correct |
| codex | 06-risk | completed | 0 | 7 | - | 0 | 80.6 | correct |
| codex | 07-cycle | completed | 0 | 4 | - | 0 | 39.1 | correct |
| codex | 08-hmr | completed | 0 | 8 | - | 0 | 62.1 | correct |
| codex | 09-line control | completed | 0 | 1 | - | 0 | 10.1 | correct |
| codex | 10-read control | completed | 0 | 1 | - | 0 | 16.3 | correct |
| claude | 01-env | completed | 0 | 36 | - | 0 | 129.9 | correct |
| claude | 02-size | completed | 0 | 47 | 1 | 4 | 210.3 | correct |
| claude | 03-rename | completed | 0 | 33 | - | 0 | 179.4 | correct |
| claude | 04-refactor | completed | 0 | 38 | - | 0 | 405.6 | correct |
| claude | 05-dead | completed | 0 | 25 | - | 0 | 121.5 | correct |
| claude | 06-risk | completed | 0 | 38 | 1 | 11 | 297.2 | correct |
| claude | 07-cycle | completed | 0 | 33 | 13 | 9 | 177.8 | correct |
| claude | 08-hmr | completed | 0 | 24 | - | 0 | 126.0 | correct |
| claude | 09-line control | completed | 0 | 4 | - | 0 | 20.7 | partly |
| claude | 10-read control | completed | 0 | 2 | - | 0 | 15.7 | correct |

| Arm | Completed | Tasks using Skyplate / tasks | First tool | First three | Controls using Skyplate / controls | Median tools | Median seconds | Correct / partly / wrong |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |
| codex | 10 | 0 / 8 | 0 | 0 | 0 / 2 | 5.5 | 58.8 | 9 / 1 / 0 |
| claude | 10 | 3 / 8 | 2 | 2 | 0 / 2 | 33 | 153.8 | 9 / 1 / 0 |

## Grades

- codex/01-env: correct. Traces mode/envDir, all four files in precedence order, expansion, Vite Task and process.env override layers, prefix validation, client injection, and concrete unit and playground tests. All material preregistered requirements are covered.
- codex/02-size: partly. Locates optimizer/index.ts, scan.ts, resolve/preAlias and docs, but supplies no directory file/line counts and no concrete test area. Asks for behavior clarification instead of completing the explicitly requested sizing.
- codex/03-rename: correct. Correct declaration and public export, independently matching 71-file scope, detailed import/callback/dynamic-import references, tests and docs, deprecated alias and plugin-legacy peer-version compatibility. Preserves existing Windows/relative-path behavior. Its final answer also self-reports a rejected heredoc that the JSON events do not independently show.
- codex/04-refactor: correct. Proposes a narrow in-file extraction and transform-specific override matching the existing TODO, preserves identity, truthiness, position precedence, file-read/frame/map behavior and error propagation, and gives concrete public-interface regression tests in the existing test file. All material requirements covered.
- codex/05-dead: correct. Rejects dead-code deletion, finds live evaluator consumer, traces startOffset through runner/fetchModule to source-map padding, checks historical rationale, and distinguishes a deliberate fixed-offset compatibility change from deletion of unused code. Tests not run and runtime uncertainty are explicit.
- codex/06-risk: correct. Uses actual config history, concrete runtime dependencies and historical fixes, computes companion files with a stated non-merge/boundary filter, identifies area-specific reviewers, and distinguishes expertise from ownership or availability. Co-change rankings agree with independent investigation under its broader counting basis. Explicit shallow-history and co-change limits.
- codex/07-cycle: correct. Shows both named runtime import directions separately from type-only edges, identifies actual runtime uses, proposes a narrow server/options extraction with type-only back references and compatibility reexports, and limits its claim to removing the direct cycle.
- codex/08-hmr: correct. Traces transport registration, serialized handler, triggeredBy graph traversal, roots, whole-graph invalidation, bundled-runtime reset, sequential reimport, closed guards and outdated-dependency handling. Distinguishes selection scope from invalidation scope.
- codex/09-line: correct. Quotes the exact corrected message with to inserted after lead. Reads only the requested target file with one rg command.
- codex/10-read: correct. Accurately explains cleanUrl regex and postfix slicing and gives the requested query-plus-fragment example. One direct read of the specified file, with no unrelated inspection.
- claude/01-env: correct. Covers mode/envDir, four env files and precedence, expansion, Vite Task and process.env overrides, prefix validation, client exposure and real unit/playground tests. Explicitly limits claims about uninstalled dependencies and reports tests not run.
- claude/02-size: correct. Reports measured optimizer file/line/code totals matching the independent 6-file/4094-line count, relevant plugin/config/helper areas, unit specs and playground sizes; traces include/exclude consumers and gives concrete design/test locations with stated behavioral uncertainty. Minor playground counting differences are within the requested rough sizing.
- claude/03-rename: correct. Finds the 71-file reference scope, exact implementation/public export, isolatedDeclarations typed alias constraint, tests/docs and external-name collision. Preserves backward compatibility and plugin-legacy peer range. Minor overstatements in the proposed final grep inventory do not change the sound migration plan.
- claude/04-refactor: correct. Proposes a narrow hierarchy-based extraction matching the existing TODO, preserves mutation/identity, pluginCode guard, truthiness, position validation, included-file/frame differences, sourcemap side effects and cleanup, and specifies concrete characterization tests through the container interface. No public API expansion or claimed test run.
- claude/05-dead: correct. Rejects dead-code deletion, finds the one live evaluator call and offset path through runner/fetchModule, checks history and a Node runtime probe, and describes source-map/stack risks. Any constant replacement is identified as a compatibility decision with a nonconforming-runtime tradeoff, rather than deleting unreferenced code.
- claude/06-risk: correct. Uses Skyplate file/symbol/graph/seam/history evidence, then independently detects and excludes the shallow-boundary ownership artifact. Names actual expert reviewers, concrete risky line ranges and focused co-change partners, and states counting, alias, uninstalled-dependency and external-review limits. The central ownership/risk conclusions match independent Git investigation.
- claude/07-cycle: correct. Correctly separates named runtime imports from type-only edges, confirms both one-hop edges with graph queries, traces candidate extraction dependencies, and proposes a narrow server-options module while preserving relevant type placement. Initialization hazard is explicitly reasoned rather than claimed as tested, and remaining transitive cycles are stated.
- claude/08-hmr: correct. Traces transport registration and queue, triggeredBy importer traversal, graph-root selection, whole-cache invalidation, bundled-runtime/HMR/client-id reset, sequential reimport and error guards. Distinguishes inferred bundled-mode edge cases from tested behavior.
- claude/09-line: partly. Exact grammar fix and test-assertion observations are correct. However, it broadened the preregistered one-file control with a repository-wide search and a read of config.spec.ts, contrary to the expected one-file scope. No Skyplate misuse.
- claude/10-read: correct. Accurately explains the regex and postfix slicing, gives a concrete query-plus-fragment example, and restricts both Grep and Read to the specified file.

## Limitations

- One pass per prompt and arm, on one repository. Counts are observations, not adoption rates.
- Global instructions and skills were in effect. They caused early shell discovery and skill reads in Codex. Their private text is omitted.
- Target dependencies were not installed; compiler evidence can be incomplete.
- Filesystem and provider caches were not flushed.
- Raw transcripts and final answers are omitted. Grades were reviewed against the preregistered rubric; they cannot be re-audited from this table alone.
- Call positions reflect observed invocation order, including instruction reads, not completion order.
- After-edit review was not exercised because sessions were read-only.
- An inherited-server pilot and a source-drift interruption were excluded. Completed sessions combine original baseline source and a pinned archive of the same commit.
- The original risk session used inherited temporary storage. Subsequent runner invocations put temporary files under the output directory.
