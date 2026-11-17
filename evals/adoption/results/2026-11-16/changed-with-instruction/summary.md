# Agent adoption experiment

Repository: https://github.com/vitejs/vite.git, commit 9a8d1a98922c5e445e8a618b8c27f84c63b9fbff. 3007 tracked files; 3230 reachable commits.

Positions count every observed tool invocation, including instruction and skill reads. Handshakes are excluded. These are counts from one pass per prompt, not adoption rates.

| Arm | Prompt | State | Exit | Tools | First Skyplate position | Skyplate calls | Seconds | Grade |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| codex | 01-env | completed | 0 | 7 | 3 | 2 | 52.6 | correct |
| codex | 02-size | completed | 0 | 13 | 3 | 7 | 76.8 | correct |
| codex | 03-rename | completed | 0 | 9 | 3 | 3 | 91.0 | correct |
| codex | 04-refactor | completed | 0 | 10 | 3 | 3 | 77.9 | correct |
| codex | 05-dead | completed | 0 | 9 | 3 | 3 | 56.6 | correct |
| codex | 06-risk | completed | 0 | 9 | 3 | 3 | 65.3 | correct |
| codex | 07-cycle | completed | 0 | 9 | 3 | 3 | 56.9 | correct |
| codex | 08-hmr | completed | 0 | 7 | 3 | 2 | 48.7 | correct |
| codex | 09-line control | completed | 0 | 1 | - | 0 | 9.0 | correct |
| codex | 10-read control | completed | 0 | 1 | - | 0 | 10.3 | correct |

| Arm | Completed | Tasks using Skyplate / tasks | First tool | First three | Controls using Skyplate / controls | Median tools | Median seconds | Correct / partly / wrong |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |
| codex | 10 | 8 / 8 | 0 | 8 | 0 / 2 | 9 | 56.7 | 10 / 0 / 0 |

## Grades

- codex/01-env: correct. Traces mode/envDir selection, the four ordered env files, expansion, Vite Task then process.env precedence, default/empty-prefix validation, config.env and dev/build injection. Identifies env.spec.ts, config.spec.ts, and playground/env tests. No claimed execution or edits.
- codex/02-size: correct. Gives the exact six-file/4094-physical-line optimizer count and explicit code-versus-physical counting bases for plugins/playground. Locates manual include expansion, scan exclusion, selectors/globs, runtime aliases/resolution, prebundling and cache hashing. Supplies focused unit/playground tests and conditions any semantic patch on the unspecified product requirement. Notes static-test and shallow-history limits.
- codex/03-rename: correct. Identifies implementation, conditional Windows slash conversion and POSIX normalization; inventories 71 files and 258 name occurrences with exact caller/test/playground/doc groups. Establishes documented public API and declaration/runtime build paths, plugin-legacy peer-range hazard and the unrelated Rollup documentation name. Proposes direct deprecated alias, staged migration and focused behavior/public-export checks without claiming execution.
- codex/04-refactor: correct. Keeps private formatting entry and error behavior local, uses a protected transform override consistent with the existing TODO, and leaves dependencies explicit through context methods rather than a public API or parameter bag. Preserves identity, pluginCode short circuit, position precedence/zero, branch-specific file/frame behavior, original-error propagation, private sourcemap cache behavior and location cleanup. Gives concrete characterization tests at the existing pluginContainer suite and required follow-up checks, not claimed runs.
- codex/05-dead: correct. Rejects deletion as dead code and proves the live cached runtime-padding → evaluator startOffset plus strict directive → runner fetchModule → server source-map mapping chain. Uses an actual historical commit explaining laziness, identifies exact source-map tests, and treats a fixed-three-line replacement as a separate cross-runtime validation decision rather than an unused-code cleanup. No edits or test claims.
- codex/06-risk: correct. Identifies resolution/hook order, environment identity/inheritance, loaders, roots and public/dependent behavior as risks. Uses actual commit examples, direct callers, bounded co-change neighbors and local author/blame evidence for sapphi-red, Bjorn Lu, Hiroshi Ogawa and btea. Explicitly rejects shallow-boundary attribution as ownership, notes shallow history, broad-commit noise and static-test limits, and does not claim reviewer availability or test execution.
- codex/07-cycle: correct. Separates both value-import directions from adjacent type imports, shows actual top-level/default and lazy-call uses, and does not equate a runtime cycle with a runtime failure. Proposes narrow server/options.ts extraction, moves forward-console resolution too to avoid recreating the direct cycle, keeps compatibility reexports/type-only back references and distinguishes residual indirect cycles. Identifies config tests/typecheck as future validation.
- codex/08-hmr: correct. Traces transport registration and serialized dispatch, triggeredBy normalization and importer-root selection versus all roots, empty-selection behavior, whole-cache invalidation, sequential reimports, closed guards, outdated-dependency suppression and bundled runtime/client reset. Does not propose tests, as also omitted by the earlier changed answer graded correct under the same rubric. No tests or edits claimed.
- codex/09-line: correct. Reads only env.ts and quotes the exact corrected literal with the missing word to. No edits or unrelated investigation.
- codex/10-read: correct. Reads only shared/utils.ts and explains removal from the first query/fragment delimiter, the cleanUrl plus slice split, and the correct /src/app.ts?raw=true#section example. No edits or unrelated reads.

## Limitations

- One pass per prompt and arm, on one repository. Counts are observations, not adoption rates.
- Global instructions and skills were in effect. They caused early shell discovery and skill reads in Codex. Their private text is omitted.
- Target dependencies were not installed; compiler evidence can be incomplete.
- Filesystem and provider caches were not flushed.
- Raw transcripts and final answers are omitted. Grades were reviewed against the preregistered rubric; they cannot be re-audited from this table alone.
- Call positions reflect observed invocation order, including instruction reads, not completion order.
- After-edit review was not exercised because sessions were read-only.
