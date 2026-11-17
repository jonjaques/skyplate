# Structure and history across languages: how accurate, and what it costs

> Research behind the [roadmap](../README.md), measured 2026-11-16 on 0.2.0. The scripts, fixtures and results named here are in [evals/structure/](../../../evals/structure/). Defects D1 to D9 below are [S1 to S9](../defects.md#structure-and-history) in the defect list, where their status is kept; this file is the dated record and is not updated as they are fixed.

Measured Skyplate 0.2.0 at `f0f874f82700ec5e5c62beef457e74de95d5841d`, in the repository, on an Apple M5 laptop with 32 GB. All source references below are relative to that checkout. Measurements ran November 16, 2026, Central time. The checkout stayed unchanged. No subagents, delegates, dev servers, browser sessions, system installs, commits in the checkout, or GitHub writes were used.

The graph algorithms are sound on the checked inputs. The main accuracy problems occur before them: lost or guessed import targets, absent non-JavaScript entry declarations, and incompatible names for imported versus declared dependencies. The history implementation handles renames and merges carefully, but its semantic interpretation still includes mechanical changes and its default cost can overwhelm the rest of analysis.

## Inventory

### Execution, scope and data contracts

| Analyzer | What it computes and how | Bounds and important consequences | Evidence |
| --- | --- | --- | --- |
| Walk | Git `ls-files --cached --others --exclude-standard`; otherwise a breadth-first filesystem walk with nested ignore rules. Deduplicates conflicted index entries. Sorts paths into stable IDs. | 64 concurrent filesystem calls. Ignores symlinks, sockets and VCS metadata. Plain walk excludes node_modules, Python environments and selected caches. `includeIgnored` removes defaults except VCS metadata. Ignored-directory counts are a lower bound. Git submodules are not recursively analyzed. | `src/core/walk.ts:23`, `:119`, `:192`, `:205`, `:240` |
| Detect | Pure path plus first 8 KiB classifier. Binary sniff, modeline, filename, extension heuristics, interpreter, text shape, text fallback. Linguist tables plus ranked defaults replace a trained classifier. | Header and, only for complete short files, footer modelines use five lines and 400 characters per line. Generated markers use the first 12 lines, at most 2,000 characters; generator signatures the first three. Does not read `.gitattributes` overrides. | `src/core/languages/detect.ts:91`, `:506`, `:630`, `:1211`, `:1238`; `registry.ts:159`; `heuristics.ts:43` |
| Workers | Detect and measure in Bun Workers; git and the TypeScript pass start after detection, concurrently with measurement/imports/graph/layout. | Default available cores minus one, minimum one. Batches 16 to 256 files, target eight batches per worker; detect batches have no byte limit because they carry only paths; measurement batches target 8 MiB. A crashed worker rejects its job. All submitted batches are retained as promises. | `src/core/pool.ts:27`, `:75`; `pipeline.ts:287`, `:512`, `:529`, `:548` |
| Large files | Text files above 8 MiB stream line counts and hashes; binary files above that retain header facts but no hash. | No comment, complexity or import analysis for oversized text; nonblank lines become code. Streaming uses 1 MiB buffers and byte line lengths, whereas ordinary text uses characters. Source embedding defaults to 512 KiB/file and 64 MiB total. A later `readText` of a manifest/config has no equivalent 8 MiB bound. | `src/core/pipeline.ts:91`, `:625`, `:641`; `worker.ts:86`, `:134`, `:230`; `site.ts:40` |
| Report | File records, directory rollups, columnar file edges, external dependency records, graph summary, history and findings. | Graph edges retain file pair/kind and explicit type-only status. They discard import spelling, source line, resolution reason, confidence and truncation evidence. Externals retain importer counts but no importer IDs. | `src/shared/schema.ts:195`, `:302`, `:317`, `:354`, `:439`; `pipeline.ts:688`, `:748` |

Detection accepts UTF-16 BOMs, valid UTF-8, controlled low-high-byte Windows-1252 text, and strictly decodable Shift_JIS/EUC-KR/GB18030 for high-byte text with spaces/newlines. NUL is binary without a UTF-16 BOM. Categories prioritize lockfiles, tests, build/config conventions and documentation rules over the language's broad type. `*.test`, `*_test`, Java-style Test classes, fixture directories and related conventions determine tests. The classifier is not deciding whether a file executes in a test run. A test support module named `testutil.rs` outside a test directory remains code. Generated and vendored flags remain separate from category. Vendor regexes come from Linguist, with Pods and agent skill directories added. JavaScript/CSS average head line length above 110 marks generated output; full-file minified detection separately uses a longest line above 1,000 with at most ten lines, or average length above 300. Evidence: `detect.ts:750`, `:1020`, `:1051`, `:1116`, `:1220`; `metrics.ts:1168`.

### Per-file metrics and format facts

The scanner masks comments with spaces and string contents with sentinel bytes, preserving offsets and newlines. It knows nested comments, raw literals, heredocs, regexes, Python docstrings and embedded script/style segments. Mixed code/comment lines count as code; whitespace-only lines count as blank even inside comments. Unknown lexical rules produce nonblank/code counts but complexity/functions/TODOs of zero. Measurement and extraction each run their own scanner, so normal supported source is scanned twice. Evidence: `metrics.ts:249`, `:290`, `:1019`, `:1123`; `imports/extract.ts:820`.

The exact file complexity formula is `1 + number of branch-keyword/operator matches` when the lexical rules mark a programming language, otherwise zero. It adds one per file, not per function. The language-specific branch vocabularies include C-family `if/for/while/case/catch/&&/||/?`, Python `if/elif/for/while/except/case/and/or`, Go `if/for/case/&&/||`, Rust `if/while/for/&&/||/=>`, and Ruby `if/elsif/unless/while/until/for/when/rescue/&&/||/and/or/?`. A question mark needs whitespace around it in the generic branch compiler. Function counts are regex matches. Nesting is brace depth or an indentation stack; Python implicit line joining and continuation lines are excluded from indentation depth. TODO/FIXME/HACK/XXX/BUG count only in comment positions. Hashes are 16 hex characters of SHA-1 of decoded UTF-8 text for ordinary text and raw bytes for binaries/streamed text. This means hashes are not uniformly hashes of on-disk bytes across encodings. Evidence: `metrics.ts:30`, `:170`, `:299`, `:1070`, `:1084`, `:1155`; `languages/syntax.ts:115`, `:233`, `:243`, `:337`, `:350`.

Format facts cover image dimensions/magic, Markdown/AsciiDoc/reStructuredText headings/title/links, CSV rows/columns, JSON/YAML/TOML keys, SVG dimensions and notebooks. JSON and TOML full parses stop at 2 MiB; CSV exact quoted-record scanning at 32 MiB; notebook parsing at 32 MiB; SVG opening-tag scanning at 64 KiB. The worker's 8 MiB full-read ceiling usually wins before the larger CSV/notebook ceilings. YAML key facts use line shapes and only the first document. Notebooks measure concatenated code cells and prose cells rather than output JSON; complexity remains zero, although function/depth counts come from code cells. Source cells do not feed notebook imports into the cross-language graph. Evidence: `facts.ts:14`, `:23`, `:211`, `:273`, `:329`, `:358`, `:398`; `metrics.ts:1173`.

### Import extraction and resolution

Extraction is lexical, not a compiler graph. A masked regex finds a declaration and the original text supplies its string. Duplicate kind/line/specifier triples collapse; the generic specifier length cap is 1,000 characters. Host-language segments select separate extractors. Dynamic expressions usually have no edge. The numeric regex envelopes include 2,000-character ordinary clauses, 4,000-character grouped/use clauses, bounded HTML/Markdown constructs and a 32-leaf Rust use-tree expansion. Silent truncation is not represented in the report. The complete literal cap/regex ledger is preserved in `cap-ledger.txt`.

| Languages or family | Extraction | Resolution and limits |
| --- | --- | --- |
| JS/TS and host components | Static import/export, require, literal dynamic import, references, URL assets; host script/style segments; Markdown links separate from code. | Extension probing, `.js` to TS source substitutions, config path aliases, package imports/exports, workspace entries and source fallbacks. Config extends depth 8; condition traversal depth 6; at most two stripped build-directory prefixes. Node/Bun/URL/virtual ecosystems distinguished. This study did not assess compiler symbols. |
| CSS/Sass/Less/Stylus | import/use/forward and URLs. | Partials, extension preferences, package style/sass fields, relative assets and JS package resolver. |
| Python/Cython/Starlark | Line-anchored `import` and `from`; bare-relative `from . import a,b` expands children. | Import roots inferred from contiguous `__init__.py/pyi` directories. Exact module, then stdlib, then parent-package fallback, then top-name PyPI external. Relative miss can fall back to `__init__`. No PEP 420 namespace roots or imported-child probing for `from pkg import child`. Distribution names only joined by spelling normalization. Starlark `load` is not extracted by the Python patterns. |
| Go | Single and grouped imports, including aliases. | go.mod module-prefix match, nearest vendor directories, stdlib by absence of a dot in the first segment, longest declared module prefix, host-based external guesses. `replace`, go.work semantics, build tags and cgo are not modeled. A package projects onto one representative plus at most 16 non-test siblings. |
| Rust | Out-of-line mod, expanded use trees, extern crate; inline-module handling adjusts super paths. | Cargo names/path dependencies, std crates, crate/self/super and filesystem module walks. Resolution may stop at the deepest file or module owner. Parsed-manifest unknown names can become self resolutions. Custom binary and custom library target-root handling is incomplete. Attributes such as `#[path]`, cfg conditions, macro expansion, re-export binding and fully qualified crate uses are not resolved semantically. |
| Java/Kotlin/Scala/Groovy/Gradle Kotlin DSL | Explicit imports, static/nested imports, Scala selectors. | Dotted file/directory suffix indexes limited to eight segments, closest-directory tie-breaks, wildcard package projections capped at 17 files. Does not read package declarations to establish identity, JVM classpaths, Kotlin top-level declarations in differently named files, same-package implicit references or fully qualified uses. External names are guessed namespace prefixes, not artifact coordinates. |
| C/C++/ObjC/CUDA/Metal/HLSL/GLSL | Literal include/import/include_next, ObjC modules. | Relative quoted header, then suffix/nearest-path match. Known or extensionless angle headers become system externals. No translation unit, ordered include search, macro includes, compile_commands, conditional compilation or module map. |
| C# | Namespace/static/alias using. | Folder-suffix namespace approximation, optional dropped root segment; capped directory projection. System/Microsoft become dotnet; other names become nuget prefixes. No namespace declarations/project references/compiler binding. |
| Swift | Import declarations including import-kind prefixes. | Only top-level `Sources/<module>` directory projection; other modules become swift externals. Package.swift dependencies use swiftpm, so imported and declared names do not even share an ecosystem key. |
| Ruby/Crystal | Literal require, require_relative, load, autoload. | Relative targets, then nearest matching suffix within lib/test/spec/app. Standard library table and first-component gem guess. Does not evaluate load paths or Zeitwerk/autoloaded constant references. Interpolated Ruby require strings can survive as unresolved literal text. |
| PHP | include/require, __DIR__/dirname forms, namespace uses. | Composer PSR-4 prefixes, then suffix fallback; otherwise first two namespace parts become composer externals. Not Composer classmaps/runtime include paths. |
| Dart | import/export/part. | Relative files, pubspec package to lib mapping, dart stdlib. |
| Elixir | alias/import/require/use including grouped references. | Snake-case filename suffix plus stdlib and guessed Hex name. No module declaration or macro semantics. |
| Haskell/Elm/PureScript | Import syntax through the shared Haskell-shaped matcher. | Dotted paths to matching suffix files; otherwise ecosystem-specific externals. |
| Lua/Luau, Perl, Julia, R | Literal require/use/source/include forms, Julia using/import. | Conventional dotted/suffix paths; pragmas/stdlib tables or package guesses. Julia nested module and R namespace member uses are not symbol edges. |
| Zig/Nix/Proto/HCL | Literal imports/path expressions/module source. | Relative files, Nix default.nix, proto relative/suffix or external, Terraform directory projection. Zig root is classed stdlib rather than an edge to the program root. |
| Shell/Fish/Tcsh/Make/CMake/Docker/HTML/Markdown | Source/include, CMake include/subdirectory, Docker FROM, asset/doc links. | Relative/root/suffix paths; Docker stage names excluded; variable paths sometimes reduced heuristically. HTML/Markdown links do not enter code PageRank/cycles. |

Evidence: `imports/extract.ts:84`, `:174`, `:421`, `:480`, `:558`, `:591`, `:611`, `:750`; `imports/resolve.ts:24`, `:63`, `:142`, `:521`, `:608`, `:759`, `:836`, `:909`, `:1095`, `:1187`, `:1205`, `:1249`, `:1337`.

### Manifests, entries, graph and statistics

Manifests cover package.json, Deno, Cargo, go.mod, pyproject, Pipfile, setup.cfg, requirements, Conda environments, Gemfile/gemspec, Composer, Maven, Gradle/catalogs, MSBuild/central NuGet/packages.config, Pub, Mix, SwiftPM and vcpkg. Bun JSON/TOML/YAML parsing handles data formats; line patterns handle executable formats; Maven/MSBuild use regex XML extraction. Malformed manifests disappear without a parse-diagnostic record. Vendor/fixture/sample paths are excluded. Cargo path, workspace npm and declared internal names are removed from external dependencies. Root/shallowest declarations win versions; scopes merge in runtime, peer, optional, build, dev, unknown order. All declarations of one ecosystem/name collapse across workspaces. Gradle catalogs record every listed library even if no build uses it; catalog scope is unknown. Maven dependencyManagement, parent, build, reporting and profiles are excluded as direct dependencies. Go indirect requirements are excluded. No installed package or jar metadata joins imports to declarations. Evidence: `manifests.ts:50`, `:172`, `:260`, `:327`, `:478`, `:575`, `:613`, `:652`, `:824`, `:880`, `:925`.

Entries are much narrower than manifest support. They include package.json main/module/browser/bin/exports/scripts, root knip JSON entries and workspaces, GitHub workflow commands, agent hooks, t3 scripts, JS/TS `*.config` and `.d.ts`. Command file suffixes are JS/TS, shell and Python only. Makefiles and executable configs are intentionally not evaluated. Existing targets only; compiled output is not mapped to source. Workflow working directories are gathered globally and tried against every command, rather than attached to a specific step. No Cargo/Go/Python packaging/JVM/Ruby/Swift/Dotnet declaration readers feed entries. Evidence: `entries.ts:56`, `:116`, `:158`, `:223`, `:247`.

The graph deduplicates non-self pairs with numeric packed keys and typed-array sorting. Fan-in/out count distinct file neighbors. PageRank uses importer-to-imported orientation, damping 0.85, uniform teleport and dangling-node redistribution, at most 60 iterations and L1 convergence `delta < 1e-10 * fileCount`; results are max-normalized to one and rounded to four decimals in the pipeline. No edges yields zero ranks. SCCs use iterative Tarjan, avoiding recursive-stack limits; SCCs of at least two files are labeled cycles. Explicit TS type-only imports are excluded only from runtime SCCs, retained in rank/fan counts, and separate full-graph type loops are listed. For C headers and other ecosystems, the term runtime cycle overstates what the edges establish. Evidence: `graph.ts:14`, `:44`, `:82`, `:120`, `:364`; `pipeline.ts:779`.

Modules are a visualization-sized adaptive directory partition over connected files. Target `clamp(round(sqrt(connected)/1.5),4,12)`, splitting cap 24 modules; forced size split above one-third of connected files, minimum five-percent split for quota, two-percent size/rank folding of minor directories. Declared package boundaries are protected until the cap forces fallback. Root expansion itself can initially exceed 24 if there are many major top-level directories; the cap governs subsequent splits. `Ca` is distinct outside source files importing the module. `Ce` is distinct inside source files importing outward, not distinct external target files. `I = Ce/(Ca+Ce)`, zero when both are zero. The matrix counts deduplicated file edges, including its diagonal. This is a file-based convention, not class-level Martin coupling. Evidence: `graph.ts:20`, `:202`, `:259`, `:273`, `:432`.

Stats use own code/test only, excluding generated/vendor, for line/complexity distributions, comment ratio `comment/(code+comment)` and test ratio `test files / production code files`. Quantiles interpolate type 7; Gini uses the sorted closed form. SHA-prefix duplicate groups include all nonempty hashed files, ranked by repeated bytes, limited to 200 groups; duplicate findings use uncapped grouping and discard groups smaller than 256 bytes. Author distributions exclude bots. Evidence: `stats.ts:15`, `:26`, `:31`, `:42`, `:94`, `:108`.

### Git and findings

Git uses a streaming numstat pass plus a merge-only combined-name pass and metadata/count calls. It disables user follow/signature/relative-diff/textconv/external-diff surprises, normalizes locale, and removes inherited repository variables. Logs walk HEAD, not all disconnected branches. Defaults to 20,000 newest analyzed commits. Dates are author dates; creation means oldest analyzed touch, with creator determined by walk order. Buckets clamp time to epoch through now plus one week, while commit tables keep the original time. Subjects are capped at 120 characters. All paths touched, including deleted files, contribute commit width and aggregate churn. Only current file lineages enter per-file history and language churn. Growth lines include net historical lines; growth file counts represent births of surviving current files, not historical live file count. Evidence: `git.ts:71`, `:106`, `:215`, `:238`, `:282`; `git/history.ts:151`, `:205`, `:318`; `git/derive.ts:24`.

| Metric or awkward case | Exact behavior | Evidence |
| --- | --- | --- |
| Renames/moves | `-M` follows path aliases backward, including swaps and deferred parallel-branch touches; same path recreated later gets a separate lineage. Exhaustive rename limit 10,000. Subdirectory moved-in sources get up to four widening rounds and 256 KiB of pathspecs. Detection skips and exhausted widening produce warnings. Copy detection is absent. | `git.ts:98`, `:357`; `git/history.ts:8`, `:151`, `:265` |
| Merge commits | No merge churn; add a zero-line file touch only when combined merge result differs from every parent. Normal branch work is counted in its original commits. Unique merge-resolution line changes therefore do not increase churn. | `git.ts:21`, `:292`; `history.ts:165` |
| Churn/ownership | File added/deleted lines are raw numstat. Owner is human with most added lines, ties by commits then ID; bot fallback if no human. Ownership is that contribution/total added, or commit share if no additions. This is historical contribution, not surviving-line blame. | `git/derive.ts:318` |
| Identity | Git `%aN/%aE` applies mailmap; normalize email/noreply IDs; union identities by normalized habitual names. Main name, at least 25% of commits, or at least ten uses qualifies. Placeholders, bot/human pairs and capitalized one-word given names are guarded; full-name collisions and lowercase handle collisions can still merge different people. | `git/authors.ts:4`, `:95`, `:105`, `:142`, `:212` |
| Bots | Name/email-local-part patterns plus a short known-address list. Kept in commit history. Excluded entirely from DOA human activity. File ownership prefers a human even if a bot added more; bot-only FileGit can still have a bot owner. Bot commits still affect hotspot commit counts and co-change. | `git/authors.ts:50`; `git/derive.ts:318`, `:377`; `pipeline.ts:879` |
| Mechanical/vendor changes | No whitespace suppression, semantic diff, blame-ignore revision support or rename-only suppression. Generated/vendor/lockfiles retain FileGit but leave `Author.owned`, coupling and truck factor. Whole-commit width still includes their paths. Formatting remains churn even when a wide commit is excluded from coupling. | `git.ts:322`; `git.ts:527`, `:589`; `pipeline.ts:1028` |
| Coupling | `degree = shared commits / min(total commits of file A, total commits of file B)`. Eligible commit width is at most historical p90, using sorted index floor(0.9*(N-1)), clamped to 30..100. At least three shared commits. Keep top 500 pairs by `shared * degree`, ties shared then IDs. Denominator still includes ineligible sweep commits. | `git/derive.ts:122`, `:142`, `:168`, `:205` |
| Truck factor | `DOA = 3.293 + 1.098*creator + 0.164*authorFileCommits - 0.321*ln(1+otherHumanFileCommits)`. Authors qualify at DOA >=3.293 and DOA/best >0.75. Order authors by authored-file count, then author activity, remove until >half eligible human-touched files are orphaned. Bots/excluded files leave the denominator. It is a greedy estimate; no recency decay is applied to knowledge. | `git/derive.ts:367`, `:389`, `:393` |
| Hotspot | If >=10 analyzed commits, own file score is `ln(1+fileCommits) * ln(1+fileComplexity) / max(all such products)`, rounded four decimals. Otherwise every score is zero with a warning. It uses commit frequency, not added+deleted lines, despite the broader word churn. | `stats.ts:24`; `pipeline.ts:872` |
| Shallow/capped history | Shallow and truncated flags, explicit warnings and limited ages/ownership. Shallow findings suppress truck-factor/island/stale-region conclusions, but file and history queries still expose the computed values. A capped full clone still gets people findings with truncation qualification. | `git.ts:573`; `findings.ts:147`, `:220` |

Findings are thresholded observations, not independently validated defects. The non-symbol rules are: top-five-percent churn concentration only with >=20 churned files and >=10 history commits, warning at 50% share and notice at 30%; top five hotspots, warning if any have >=50 commits and complexity >=100; cycles warning at ten files; truck factor one critical/two warning; knowledge islands at >=90% added-line ownership plus owner inactive a year relative to newest commit, warning at 20% of own files; stale top directories/inactive project after a year; fan-in hubs at >=10, warning >=100; large files >1,000 code lines, warning >5,000; complexity >100, warning >300; duplicates notice at 1 MiB repeated or twenty groups; test ratio below 0.25 with >=10 production files, warning below 0.1; TODO notice at fifty; any credential-like file notice/warning depending on history; generated/vendor share starts at 5%, notice at 25%. File examples are generally limited to twenty, secret examples fifty, generated examples ten. Evidence: `findings.ts:67`, `:87`, `:101`, `:147`, `:235`, `:275`, `:292`, `:310`, `:425`.

### MCP query layer

`files` filters/ranks the measured tree and pages with offset; generated/vendor are hidden by default. `file` joins local graph neighbors, top five contributors/recent commits, top ten stored coupling partners, duplicates and findings. `dir` reports quantitative rollups, dominant languages, top owners/hotspots/hubs and an adaptive module if one matches. Graph queries run file-level BFS, shortest path, cycle/module/hub views. Default dependency traversal depth is three; tool maximum fifty. History queries provide summary, authors, commits, coupling, activity and ownership, all from retained tables. Dependencies simply filter merged declarations/importer counts, with builtins excluded from undeclared warnings. It has no external-to-file provenance. Findings return generated observations. Evidence: `src/mcp/query.ts:538`, `:572`, `:622`, `:714`, `:1082`, `:1238`, `:2097`.

Every tool row limit is at most 500 (`server.ts:89`). `file` defaults to 25 neighbors; `files` and `dir` to thirty; graph forty; dependencies fifty. Cycles truncate member paths at fifteen, and `file` at twelve; no cycle-member offset. History/dependency queries have no offset, unlike `files`, `search_symbols` and `seams`. A large report can say more results exist without a way to enumerate the tail under the same selector.

## Measured accuracy

### Protocol and repositories

Ran the real CLI for every repository with `--json --no-source --no-symbols --out <scratch>/reports/<name>.skyplate`. Default git options unless explicitly named otherwise. Every clone used public GitHub HTTPS and `--depth 50`. That yielded 50 commits for most repositories, 2,130 for Rails and 18,070 for Kubernetes because merge ancestry expands a depth-limited clone. These are fetched histories, not full-history ownership benchmarks.

`inspect.ts` reads the report's exact walked file list and language labels, re-runs the production extractor/resolver against that list, and preserves every relevant import statement in compressed NDJSON. It does not divide expanded graph-edge count by statements. External includes recognized standard libraries. Internal includes same-file resolutions, which the stored graph subsequently drops. The table reports extracted-statement outcomes, not compiler-verified dependency recall. A guessed external or fallback parent can make unresolved zero without making the answer correct.

| Project | Commit | Report files | Selected language files |
| --- | --- | ---: | ---: |
| psf/requests | `3c7baaa05ab4aa49cc819ce3a819d260de19c157` | 128 | Python 37 |
| go-chi/chi | `c64ed7d6635f33a8b2feaff7dcfa55677023ac7d` | 111 | Go 90 |
| BurntSushi/ripgrep | `178cc027e283fd965cb72d0a7395b219eada170c` | 225 | Rust 102 |
| junit-team/junit-framework | `e5198f9b098c550e66d378650f78bac8883e2a72` | 2,467 | Java 1,813, Kotlin 154 |
| curl/curl | `fb6f021d9a5744aa800da17bb9c0ec5b6238c088` | 4,579 | C 1,072, C++ 2 |
| rails/rails | `04988cc35d4281173f6327c07609f49227b5ccf9` | 5,040 | Ruby 3,599 |
| kubernetes/kubernetes | `074eb5db5bbe70923fd2d0af4dc2d0091a539253` | 32,005 | Go 18,291, shell 314, Python 7, C 6 |

### Tables per language

| Language and repository | Statements | Internal resolved | External | Unresolved | Non-self resolved sample |
| --- | ---: | ---: | ---: | ---: | --- |
| Python, Requests | 325 | 119, 36.62% | 206, 63.38% | 0 | 20/20 correct file/module target |
| Go, Chi | 389 | 59, 15.17% | 330, 84.83% | 0 | 20/20 correct package membership |
| Rust, ripgrep | 1,136 | 593, 52.20% | 445, 39.17% | 98, 8.63% | 20/20 correct file/module interface |
| Java, JUnit | 18,006 | 9,893, 54.94% | 8,113, 45.06% | 0 | 20/20 correct file/interface |
| C, curl | 4,246 | 3,227, 76.00% | 1,017, 23.95% | 2, 0.05% | 20/20 correct header path |
| Ruby, Rails | 6,883 | 6,158, 89.47% | 724, 10.52% | 1, 0.01% | 20/20 correct require target |
| Go, Kubernetes | 113,595 | 74,372, 65.47% | 39,223, 34.53% | 0 | 20/20 correct package membership |

Supplemental language counts, without independent twenty-edge precision samples:

| Language | Statements | Internal | External | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Kotlin, JUnit | 1,076 | 672 | 404 | 0 |
| C++, curl | 8 | 2 | 6 | 0 |
| Shell, Kubernetes | 233 | 223 | 0 | 10 |
| Python, Kubernetes | 26 | 1 | 25 | 0 |
| C, Kubernetes | 21 | 0 | 21 | 0 |

Samples are the first twenty non-self internal outcomes after sorting by a deterministic Bun hash of source path plus specifier. I inspected the original import and target file/package path. The 140 verdicts and excerpts are in `edge-review.json`; original selected rows are in `*-sample.json`. Go precision means the representative belongs to the right package. It does not establish that each expanded file contains a used identifier. C precision ignores which preprocessor branch is active. Rust interface targets can be a module re-exporting an item. Twenty successes have a wide uncertainty interval, roughly 84% to 100% at 95% Wilson confidence. This sample cannot establish near-perfect corpus precision.

Self resolutions: Rust 90, Java 47, Kotlin 2, C 1, Ruby 14. These inflate statement-level resolved counts relative to graph edges. Rust records 593 resolved statements but only 503 are non-self. Explicit source graph edge counts differ further due repeated statements and Go sibling expansion.

Unresolved patterns:

- Rust: all 98 occur in `crates/core`. Ninety-three start `crate::`; five are `mod messages/flags/haystack/logger/search`. The root manifest declares `[[bin]] path = "crates/core/main.rs"`, which the resolver's default-root logic misses. This is a fixable coverage gap, not missing source or dependencies.
- C: `lib/curl_setup.h:135` includes build-generated `curl_config.h`; `tests/libtest/unitcheck.h:27` includes generated `unitprotos.h`. Both absent from the clone. They should be described as generated/build inputs rather than ordinary missing files when build metadata is available.
- Ruby: `activejob/test/support/integration/jobs_manager.rb:13` has interpolated `require_relative "adapters/#{adapter_name}"`. The current extractor treats its interpolated text as one unresolved specifier.
- Python, Go and Java: no unresolved outcomes in these corpora. Confirmed counterexamples show this is partly a consequence of external/parent fallbacks.
- Kubernetes shell: ten unresolved source declarations include environment-dependent helpers and relative paths not in the walked tree. Raw rows are retained in `accuracy.json`; these were not given a compiler/runtime ground-truth classification.

### Detection and category checks

Selected twenty nonbinary, nonsecret paths per small repository using a deterministic hash of path, inspected eight opening lines plus path/context. Files included source, tests, fixtures, docs, workflow config, lockfiles, templates and build scripts. The 120 rows are preserved in `*-detection-sample.json` and `detection-review.txt`.

Language labels were reasonable on 119/120 under this manual rubric. Rails' `railties/lib/rails/generators/test_unit/authentication/templates/test/mailers/previews/passwords_mailer_preview.rb.tt` is Ruby template code but falls back to text. This is an unsupported-template limitation. Category labels followed the documented path rules in all samples, which is weaker than proving actual runtime/test roles. Ripgrep's `crates/searcher/src/testutil.rs` remains code despite being test support; Rails generator templates inside a directory named test become tests although they are templates for downstream applications. No Linguist corpus benchmark was run; the repository's optional sample corpus test skipped.

### Entry points and unused dependencies against project evidence

Cargo's own `cargo metadata --offline --no-deps --format-version 1` succeeded. It identified eleven executable/test/example/bench/build targets in the ripgrep workspace, including `rg` at `crates/core/main.rs`, integration test `tests/tests.rs` and `build.rs`. Skyplate marked zero entries. `entry-cargo-check.json` retains the full comparison. Chi also had zero entries despite runnable `_examples/*/main.go`. Requests had zero, which is reasonable for a library with no declared command target; its CLI/plugin dependencies still need use evidence other than imports. JUnit had two JS configuration entries, curl fourteen shell/Python workflow entries, Rails thirteen entries, mostly front-end declarations/configuration. These counts do not establish native entry recall for those languages.

JUnit declared 82 Maven dependencies; all 82 had zero importers. Another 89 Maven rows were guessed from imported namespaces and had no declarations. This is a deterministic key mismatch between Maven coordinates such as `org.slf4j:slf4j-api` and import prefixes such as `org.slf4j.Logger`. A minimal fixture proves the split with one declaration and one import. Actual JUnit declarations/imports use the same incompatible naming conventions.

Requests flags `pyopenssl` unused even though `src/requests/help.py:32` imports `OpenSSL`. PySocks is also called unused while the code uses urllib3's SOCKS integration, illustrating transitive/optional runtime usage. Pyright, wheel, Sphinx and pytest plugins cannot be declared unused merely because source never imports their distribution names. Rails calls `concurrent-ruby` unused despite `actionview/lib/action_view/renderer/abstract_renderer.rb:3` requiring `concurrent/map`; root-name matching yields `concurrent`. Ripgrep calls `encoding_rs`, `lexopt`, `textwrap` and `tikv-jemallocator` unused although fully qualified `encoding_rs::...`, `lexopt::Parser`, `textwrap::...` and `tikv_jemallocator::Jemalloc` uses appear in code. The Rust extractor only sees imports, not fully qualified references.

No native unused-dependency detector was run. Cargo metadata validated declarations/targets, not used dependencies. No Go executable was installed, and no Go build/list command ran. Gradle/Maven/Rails builds and test suites were not run. The unused findings above were checked against specific project source and manifest evidence; this is not a broad dependency-pruning oracle benchmark.

## Metric validity

### Complexity against a real parser

Ran `uvx --cache-dir <scratch>/uv-cache --from radon radon cc --json <requests-clone>`. Radon uses Python's parser. Matched 29 files with function/method records. Deduplicated methods repeated under class summaries and recursively included closures. Compared both the raw sum of function CC and `1 + sum(functionCC - 1)`, which removes the per-function baseline to align with Skyplate's per-file baseline. Spearman ranks average ties. Script `correlate.py`, output `complexity.json`.

| Sample | Files | Spearman versus summed function CC | Spearman versus parser decisions plus one |
| --- | ---: | ---: | ---: |
| All matched Python | 29 | 0.733 | 0.782 |
| Production category code | 16 | 0.853 | 0.965 |
| Test category | 13 | 0.559 | 0.546 |

Production ranking is useful. `utils.py` is 159 versus parser 159 decisions-plus-one; `models.py` 154 versus 153; `cookies.py` 71 versus 71. Tests are a different metric: `tests/test_requests.py` is Skyplate 53 versus parser decisions-plus-one 454, largely because Radon counts asserts and the lexical branch vocabulary does not. Cross-language global thresholds and test hotspot comparisons therefore need qualifications. This is not evidence that every difference is a scanner bug. No second language's parser-complexity tool was run.

### PageRank, SCCs and instability

The independent four-file fixture contains `0->1`, `1->2`, `2->1`, `3->2`, with the `2->1` input duplicated. Expected unique edge count four, fan-in `[0,2,2,0]`, fan-out `[1,1,1,1]`, only cycle `{1,2}`. Symmetry and damping 0.85 give max-normalized rank `[3/37,1,1,3/37]`. Actual results match exactly. Put files 0/3 in module A and 1/2 in B: A has Ca 0/Ce 2/I 1; B Ca 2/Ce 0/I 0. Actual matches. Saved in `repros.json`, generated by `repros.ts`.

Requests exposes a semantic failure before SCC analysis. Python AST traversal found eighteen internal import statements in `if TYPE_CHECKING` blocks. Twelve file pairs had only guarded imports. Removing those twelve pairs makes the reported eight-file cycle disappear completely. The original cycle includes models, _types, cookies, utils, auth, exceptions, adapters and hooks. `python-type-guards.json` and `type-guards.py` retain the independent AST classification and graph reachability check. The source graph currently labels this a runtime cycle.

### Package projections and graph truth

The resolver projects package imports onto at most seventeen files. Compared the stored Go pairs with the uncapped projection onto all non-test `.go` files in each matched directory. This is a representation check, not compiler symbol ground truth, and it intentionally includes platform/build-tag variants as the current resolver does.

| Repository | Internal Go statements capped | Uncapped distinct projected pairs | Actual projected pairs | Retained |
| --- | ---: | ---: | ---: | ---: |
| Chi | 10/59 | 531 | 391 | 73.63% |
| Kubernetes | 10,410/74,372 | 702,926 | 531,462 | 75.61% |

Chi middleware has 31 non-test files; each import gets seventeen. The omitted fourteen files lose all of those importer edges. Kubernetes' largest matched package directory has 284 non-test files. The cap preferentially rewards the representative and early filenames in fan-in/PageRank. Removing the cap would still invent file-use specificity for every package member. The correct long-term answer is a package node plus actual declaration/reference edges where available. Evidence in `package-cap.json`.

### History checked by hand

Created an isolated twelve-commit synthetic repository under scratch. Alice creates four four-line Python files, changes a/b three times, Bob changes c three times, Alice renames a, a bot reformats renamed/b, the bot touches d, and Alice commits once under a second email; final empty commit checks empty history rows. `history-fixture.py` and `history-ground-truth.txt` preserve construction and ordinary git numstat/follow output.

| File | Expected/actual commits | Added/deleted | Owner, share | Hotspot |
| --- | ---: | ---: | --- | ---: |
| renamed.py | 6 | 10/3 | Alice, 0.7 | 1 |
| b.py | 5 | 10/3 | Alice, 0.7 | 0.9208 |
| c.py | 4 | 7/0 | Alice, 0.5714 | 0.8271 |
| d.py | 2 | 5/0 | Alice, 0.8 | 0.5646 |

Alice's two emails merged; bot remained separate; rename added zero lines and preserved original creation/contribution history. Renamed/b shared five commits, degree `5/min(6,5)=1`. Both formatting and initial creation count in that pair. Hand-derived hotspots match `ln(1+n)/ln(7)` because all complexities equal two. Truck factor is one: Alice qualifies for all four files; removing Alice orphans three, more than half, while Bob still qualifies on c. A contributor can own a file by accumulated additions while another owns more recent changes.

A second ten-commit fixture creates twelve unique files, performs three directory-only renames and six empty commits. No file content changes after creation. Skyplate reports all 66 possible file pairs at shared four/degree one and every file hotspot one. Renames are intentionally touches, so this is a semantic ceiling, not incorrect arithmetic. A rename sweep below the 30-file floor is not filtered. `rename-fixture.py`, `rename-ground-truth.txt` and the compact retained report in `measurements.json` preserve it.

The focused existing suite ran `bun test test/imports.test.ts test/graph.test.ts test/git.test.ts test/metrics.test.ts test/languages.test.ts test/manifests.test.ts test/pipeline.test.ts test/entries.test.ts test/walk.test.ts`: 328 pass, two skip, zero fail, 2,093 assertions, 4.13 seconds. The skipped tests require the external Linguist sample corpus and a Vite checkout. This suite includes clean/conflict merges, evil-merge-created files, rename swaps, deleted/recreated paths, cross-branch and moved-in history, bot handling, DOA and sweep filtering. These passing regression tests support the merge implementation; I did not conduct a separate real-repository blame check or a controlled squash-versus-unsquashed experimental pair.

## Scale

Kubernetes has 32,005 walked files, 6,171 directories, 286 MB on-disk file content, 7,516,112 lines, forty detected languages, 637 generated files and 5,543 vendored files. Selected Go has 18,291 files. Full report graph has 532,217 code edges. All runs used no source and no TypeScript symbols, so these numbers exclude the TypeScript study's compiler pass and source-embedding costs.

| Phase, milliseconds | No git | Git cap 50 | Default git, 18,070 fetched commits |
| --- | ---: | ---: | ---: |
| Walk | 284 | 308 | 265 |
| Detect | 592 | 626 | 397 |
| Measure | 1,125 | 1,486 | 1,313 |
| Imports/manifests/entries | 383 | 458 | 423 |
| Graph | 42 | 62 | 45 |
| Layout | 5,227 | 5,844 | 5,052 |
| Git | disabled | 1,469 | 507,594 |
| Statistics | 14 | 22 | 14 |
| Findings | 7 | 10 | 14 |
| Analysis total | 7,662 | 8,797 | 508,355 |
| Whole CLI wall, seconds | 7.77 | 8.90 | 509.20 |
| Maximum RSS, GiB | 1.23 | 1.24 | 2.48 |

Phase clocks overlap; they must not be summed. `report.timings.write` records the site writer portion, while whole CLI wall also includes JSON serialization and startup. `/usr/bin/time -l` measured maximum RSS. On macOS this is not the sum of every process's simultaneous RSS; a sampled git child additionally had roughly 611 MB RSS during the long run. The sampler found the main Bun thread waiting while that git subprocess consumed a core. No CPU flamegraph was collected. These are single-run measurements on a shared Mac, not isolated repeated benchmarks. Logs are retained as `kubernetes-cli.log`, `kubernetes-cap50.log`, `kubernetes-nogit.log`, and `kubernetes-sample.txt`.

With git off, layout dominates. Even MCP live analysis pays for layout immediately, before an agent asks for a report (`pipeline.ts:799`). Layout is outside this assignment's accuracy focus, but it accounts for about 68% of the no-git analysis wall time. A symbol-free agent could get quantitative answers substantially earlier if layout were lazy. The force simulation uses an 800,000 node-tick budget, clamped to 12..120 ticks, so the floor dominates beyond roughly 66,667 connected files (`layout.ts:61`, `:89`).

The graph itself scaled well in a deliberately simple synthetic chain benchmark. `analyzeGraph` alone took 24.8 ms for 100,000 files/99,999 edges and 85.7 ms for 1,000,000 files/999,999 edges. Maximum process RSS across that script was 237 MiB. These were pure in-memory chains with one module and a nearly uniform PageRank distribution, which reaches the average-L1 tolerance quickly. They are not a million-file pipeline benchmark. `graph-scale.ts/json/log` retains the exact inputs and results.

Expected first limits, unverified beyond the measured runs:

- At 100k real files, graph quality already hits the 17-file package projection, 24-module display partition and 500 co-change pair limits. Accuracy ceilings arrive before the CSR/SCC implementation fails.
- Git cost depends on changed bytes/rename candidate matrices and history shape, not file count alone. The raised 10k rename limit permits expensive quadratic comparisons; the 18k-commit run took more than eight minutes without exceeding the 20k cap. No wall-time/byte budget or persisted history cache bounds it.
- At 1M files, full JavaScript FileRecords/path indexes, retained per-file import arrays, duplicate graphs, worker structured-clone copies and whole-report JSON become memory/serialization problems. Layout has a twelve-tick floor. Linear extrapolation of Kubernetes memory would be a guess, not a capacity result.
- Index construction is mostly linear in paths/depth. Sorting edges/distributions is O(E log E)/O(N log N), PageRank O(iterations*(N+E)), SCC O(N+E). Go resolution scans known module/require lists and re-filters directory members per import; C/Ruby suffix matches scan same-basename candidate buckets, so repeated common basenames can approach quadratic work. Rust inline-module brace scans can repeat nested ranges. These are code-derived complexity risks, not measured worst-case slowdowns.
- Coupling uses an inverted index and bounded partner arrays rather than storing every pair. Its work is proportional to eligible commit widths squared, bounded by width <=100, but retains all current-file touches and pending deleted-path touches. Rename ancestry scans are cached per rename commit. A million-file/high-history worst case was not run.

## Defects

Severity here measures the chance an agent makes a wrong structural or cleanup decision. High does not mean a security vulnerability. Fix sizes are rough engineering sizes, not elapsed-time estimates.

### D1. Declared dependencies and imported packages fail to join

Severity high. Size L across ecosystems, M for a scoped Maven repair.

Evidence: `src/core/imports/resolve.ts:1152`, `:1255`, `:1352`, `:1380`; `src/core/manifests.ts:595`, `:925`; `src/core/pipeline.ts:674`, `:723`; `src/mcp/query.ts:2106`.

Minimal repro: `repros.ts` case `jvm-coordinate` declares `org.slf4j:slf4j-api` and imports `org.slf4j.Logger`. Expected one declared dependency with one importer, or a clearly unjoined unknown use. Actual is a declared row with zero importers and an undeclared row named `org.slf4j.Logger`. JUnit's 82/82 declared Maven dependencies have zero importers while 89 namespace rows are undeclared. Python PyYAML/yaml and Ruby concurrent-ruby/concurrent reproduce the same class of failure; Swift's ecosystem keys differ too.

Suggested fix: separate import namespace identity from package-manager coordinate identity; join with authoritative installed metadata, lock/build/classpath information or a known explicit mapping. Retain confidence/unmapped status. Do not classify an unjoined declaration as unused when the ecosystem cannot establish that claim. Preserve per-workspace declarations instead of using one merged version/scope as a usage decision.

### D2. Package imports silently lose members and bias file centrality

Severity high. Size L for correct package nodes, S for exposing current truncation.

Evidence: `src/core/imports/resolve.ts:24`, `:119`, `:855`; `src/core/pipeline.ts:717`; `src/shared/schema.ts:302`.

Minimal repro: `repros.ts` case `go-cap` contains a 24-file Go package and one importer. Expected a package relationship, or an explicitly incomplete set of file projections. Actual is seventeen file edges with no truncation metadata. Chi retains 391/531 projected pairs, Kubernetes 531,462/702,926. Which files receive fan-in is partly a lexical filename choice.

Suggested fix: add first-class package/module nodes and file membership; compute package centrality separately. Bind file references only when a compiler/parser establishes them. In the interim return totalMembers, omittedMembers and representative status and prevent incomplete projections from posing as precise file-level impact.

### D3. Python type-checking imports create false runtime cycles

Severity high. Size M.

Evidence: `src/core/imports/extract.ts:426`, `src/core/graph.ts:381`, `src/shared/schema.ts:343`, `src/core/findings.ts:101`.

Minimal repro: a.py imports b only inside `if TYPE_CHECKING`; b.py imports a at runtime. Expected a type-coupling loop without a runtime cycle. Actual reports a runtime SCC because the Python extractor never sets type-only status. On Requests, eighteen guarded internal statements account for twelve guarded-only pairs; removing those pairs removes the entire eight-file cycle.

Suggested fix: parse Python imports with guards, recognize `typing.TYPE_CHECKING` and imported aliases, carry type-only edges through the existing contract. More generally keep conditional/build-config provenance instead of applying JavaScript evaluation-order wording to every language graph.

### D4. Cargo custom target paths are ignored when choosing the current crate root

Severity high. Size M.

Evidence: `src/core/imports/resolve.ts:948`, `:980`, `:987`, `:1017`, `:1038`; ripgrep root Cargo.toml declares the bin path. Native evidence in `cargo-metadata.json` and `entry-cargo-check.json`.

Minimal repro: Cargo declares `[[bin]] path="cli/main.rs"`; that file declares `mod helper` and imports `crate::helper::run`; helper.rs is next to it. Expected both statements resolve to helper.rs. Both are unresolved in `rust-custom-bin`. In ripgrep this accounts for 98 unresolved statements, 93 crate paths and five mods.

Suggested fix: index every Cargo target root and custom library path, map each source to its owning target/module tree, and handle ambiguous files shared by targets explicitly. A Cargo metadata adapter can supply declared/auto targets; a manifest-only fallback should still honor path fields without spawning Cargo.

### D5. Known non-JavaScript entry declarations are absent

Severity high for dead-file decisions, medium for navigation. Size M per ecosystem.

Evidence: `src/core/entries.ts:56`, `:158`, `:247`; `src/mcp/query.ts:549`; `src/shared/schema.ts:269`.

Minimal repro: the `rust-custom-bin` manifest explicitly declares cli/main.rs. Expected it is an entry. `findEntries` returns an empty map. Cargo metadata identifies eleven executable/test/example/bench/build targets in ripgrep; Skyplate has zero entries. That can put runnable code in the `unimported` dead-file candidate list.

Suggested fix: share a typed entry-declaration adapter among manifest/root resolution and entries. Prioritize Cargo targets and build.rs, Go package main, Python script entry points and __main__, JVM main/service descriptors and framework conventions with reason/confidence. An agent query should distinguish unsupported entry discovery from established non-entry status.

### D6. Python namespace packages and imported submodules lose internal edges

Severity high for graph recall. Size M.

Evidence: `src/core/imports/extract.ts:427`, `:442`; `src/core/imports/resolve.ts:762`, `:783`, `:792`, `:813`.

Minimal repro A: `pkg/__init__.py`, `pkg/child.py`, app `from pkg import child`. Expected a relationship to child plus any package-initialization dependency; actual only pkg/__init__.py. Minimal repro B: `src/acme/app.py` imports util from acme, `src/acme/util.py` exists, no __init__.py, with src on PYTHONPATH. Expected local namespace package; actual external PyPI acme. Both cases are in `repros.json`.

Suggested fix: preserve imported names from Python declarations; resolve candidate child modules before treating names as attributes. Discover source roots and namespace packages from packaging/configuration plus a qualified fallback. Retain ambiguity when both a package attribute and module exist. Do not turn every unknown absolute name into an asserted external package.

### D7. CJK text accepted by detection is decoded as Windows-1252 by measurement

Severity medium. Size S/M.

Evidence: `src/core/languages/detect.ts:69`, `:110`; `src/core/worker.ts:187`, `:193`.

Minimal repro: `encoding.ts` analyzes a Shift_JIS Python file containing Japanese string text. Expected source displays its original Japanese. Detector correctly returns binary=false, but the embedded source begins mojibake such as `“ú–{Œê` because worker decode falls back only to Windows-1252. Confirmed output in `encoding.json`. String/comment boundaries can also be affected by backslash-like bytes.

Suggested fix: make decoding a shared module; carry the chosen encoding or a normalized decoded buffer from detection into measurement/source storage. Test UTF-8, BOM UTF-16, Windows-1252, Shift_JIS, EUC-KR and GB18030 end to end.

### D8. Extensionless local C/C++ angle includes are forced external

Severity medium. Size S for this case, L for build-aware resolution.

Evidence: `src/core/imports/resolve.ts:1188`.

Minimal repro: main.c includes `<projectheader>` and include/projectheader exists. Expected resolve according to the configured include path, or unresolved/ambiguous until that path is known. Actual returns system external without considering repository paths, since the header has no extension. `c-extensionless` confirms it. `c-search-order` additionally shows nearest suffix can select src/unrelated/api.h instead of the real include/api.h when build include search says otherwise; the fixture is an illustration with a stipulated include path, not a compiled-build comparison.

Suggested fix: reserve builtin status for known headers; parse compile_commands and ordered include paths, include_next semantics and translation unit conditions. Keep fallback suffix matches labeled heuristic.

### D9. Rust fully qualified dependency uses appear unused

Severity medium/high for cleanup advice. Size M for qualified paths, L for compiler-level use.

Evidence: `src/core/imports/extract.ts:480`, `:535`, `:750`; `src/mcp/query.ts:2106`. Real examples preserved under `specimens/ripgrep`.

Minimal repro: Cargo dependency textwrap, source `fn f(){textwrap::fill("x",10);}` with no use declaration. Expected dependency is used, or unknown because only imports are counted. Actual extraction has no package use and the declared row stays unused. Ripgrep exhibits this for textwrap, lexopt, encoding_rs and its target-specific allocator.

Suggested fix: a Rust syntax pass should collect qualified crate-root paths and macro invocations with dependency context. Rename the current import-only result to not-observed-as-import, or suppress the unused claim where use syntax is not covered. Keep platform/configuration-specific uses qualified by condition.

## Ceilings

These are design limits or intentionally approximate semantics, not proof of implementation bugs.

1. File-level import graphs do not supply non-TypeScript definitions, references, call graphs, inheritance, exported APIs or actual test coverage. Same-package Java/Go/C# uses, Rust/ Ruby implicit resolution and macro/dynamic wiring remain invisible even when explicit import extraction is perfect.
2. Most resolution decisions are heuristics with no uncertainty field. A resolved-looking graph cannot distinguish compiler binding, package projection, suffix guess, parent fallback or declared-name mismatch. The schema discards exactly the evidence an agent would need to audit those decisions.
3. The graph is a union across build configurations. C conditionals, Go build tags, Cargo cfg/features, optional dependencies and platform files can be mutually exclusive. File SCCs over this union are not necessarily executable cycles.
4. The adaptive module matrix is capped for display, not a complete architecture model. Large packages and minority modules fold away; architectural boundary validation should not use that partition as a statement of intent.
5. Exact duplicate files are not clone detection. Renamed functions, copied blocks with edits and generated variants are not detected by SHA prefixes.
6. Ownership is cumulative additions; DOA is a commit-frequency estimate without decay, surviving lines, reviews, coauthor trailers or organizational context. Squash commits credit the commit author and collapse the development sequence. Name-based identity fusion knowingly trades false joins for false splits.
7. Formatting, initial drops and renames can dominate churn/coupling. The fixture's 66 spurious-looking temporal pairs are true shared touches. A 500-pair global cut and three-shared floor also make no-pairs mean below retention rather than no coupling. No per-file completeness count is available.
8. Growth file counts include only current lineages. A repository that once held and deleted 10,000 files cannot recover its historical live file count from this report. Language churn follows the current file's language, including historical text before a language-changing rename, and omits deleted lineages from the language breakdown.
9. Shallow/truncated history stays a lower-bound sample. Warnings are honest; the oldest shallow boundary still assigns apparent ownership to a snapshot author in per-file data. Isolated tool responses should repeat that limitation, not rely on the agent remembering open's warning.
10. Executable manifests and plugins cannot be understood by string matching alone. Unknown dependency usage is not absence, and dependency declarations are not a software bill of materials with resolved versions/licenses.
11. Whole-project work, layout and JSON delivery impose latency before basic agent answers. A budgeted partial analysis with explicit completeness could be more useful than a single all-or-nothing snapshot.

### What a non-TypeScript agent can learn now

| Agent question | Current answer quality | What to use and what remains missing |
| --- | --- | --- |
| Where is X defined? | Cannot answer as a symbol query. | Files/path fuzzy search can guess a location; read_source can show a known file. `search_symbols` on Requests returned the explicit no-code-intelligence error. No general source-text search tool. |
| Who calls Y? | Cannot answer. | An importing file is not a caller. Dynamic dispatch/qualified uses and same-package calls are absent. |
| What does this directory do? | Approximate quantitative orientation. | dir supplies size/languages/history/owners/hubs/findings. It does not infer behavior, domain responsibility, API contracts or runtime role. README/source reading is still needed. |
| What breaks if this file changes? | Approximate explicit-import reachability. | graph dependents/path gives transitive file relationships. Package projections, capped memberships and missing implicit uses undermine completeness. No semantic member-level impact. |
| Which tests cover this file? | Approximate candidate selection, no coverage answer. | Test-category direct/transitive importers and co-change can suggest tests. There is no execution coverage, test symbol map, test runner discovery or assertion relation. Go same-package tests are especially invisible to import-based matching. |
| Who knows this file? | Historical estimate. | file/history ownership, recent contributors and DOA, with shallow/cap/mechanical-change caveats. No reviewer/recency-aware knowledge graph. |
| Which dependency can I remove? | Often unsafe outside npm-shaped naming. | Dependencies returns declarations with no observed import. Naming, plugins, executables, qualified references and platform configurations must be checked elsewhere. |
| Why did this edge/finding appear? | Incomplete evidence. | File paths and numeric findings are available, but import line/specifier/resolution reason, omitted package members and per-finding confidence are lost. |

## Frontier

Ranked by expected improvement in what an agent can learn per implementation effort. Sizes include the contract/query work, not only another regex. These proposals are grounded in this study; [prior-art.md](prior-art.md) chooses standards and comparisons.

| Rank | Change | Size | Why it matters | How to measure success |
| --- | --- | --- | --- | --- |
| 1 | Preserve import/use evidence, resolution method, confidence, condition and completeness in the schema and MCP. | M | Agents can distinguish facts, guesses and missing coverage immediately across every language. Fixes the zero-unresolved illusion and makes later adapters testable. | Every returned edge links to a source span and method; every cap has omitted/total counts; no heuristic is labeled exact; measure answer correctness on held-out edge questions. |
| 2 | Use package/build-unit nodes and real membership, with uncapped graph data and separately bounded display views. | L | Removes the quantified 24% lost Go projections and filename-centrality bias without inventing per-file uses. Supports package impact and workspace architecture. | Chi/Kubernetes package import recall 100% against build metadata; arbitrary file renames preserve package centrality; all 31 Chi middleware members discoverable; bounded UI output no longer truncates analysis truth. |
| 3 | Add shared manifest/build adapters for native target roots and entries, starting with Cargo and Go, then Python and JVM. | M/L | One adapter fixes Rust root resolution and dead-entry classification together. Cargo metadata already exposes eleven missed targets. | Ripgrep's 98 root-caused misses resolve; eleven executable/test/build targets are marked with reasons; custom-target fixtures pass; measure native entry precision/recall in each corpus. |
| 4 | Replace unjoined unused-dependency claims with ecosystem identity mapping and explicit unknown usage. | L | Prevents destructive cleanup advice and lets agents reason about dependency boundaries. Maven's current 82/82 false-unused shape is an immediate target. | JUnit coordinates join to the right imported namespaces without false positives; OpenSSL/PyYAML/concurrent-ruby cases join; fully qualified Rust uses count; benchmark pruning precision against native tooling plus manual review. |
| 5 | Add parser-based definitions and reference indexes for Python, Go, Rust and JVM, using a portable syntax baseline plus optional semantic adapters. | L | Answers where-defined, exported API and who-uses questions on non-TS repositories. It is the largest capability gain, but lower impact/effort than repairing contracts and roots first. | A stratified query set of definition/use/caller questions per language, with separately reported syntax and semantic precision/recall, dynamic/implicit unknowns and build prerequisites. |
| 6 | Model type-only and build-conditional edges across languages. | M/L | Removes false runtime conclusions and gives agents a useful union-versus-configuration choice. | Requests runtime SCC disappears while its type loop remains; Go/Cargo/C fixtures report correct active edges for two configurations; every unknown condition is visible. |
| 7 | Add mechanical-change-aware history views, recency-weighted knowledge and a revision ignore mechanism. | M | Current arithmetic works, but risk interpretation is polluted by renames/reformats/bot sweeps and ancient additions. | In the rename fixture, semantic coupling disappears while raw-touch history stays auditable; whitespace-only commit does not change semantic churn; compare ranked hotspots with a labeled change/risk set and measure ranking stability under formatting. |
| 8 | Make layout lazy for MCP; cache file analysis and git increments; support explicit time/byte budgets and partial completeness. | L, lazy layout alone S/M | Kubernetes answers are delayed by a five-second picture and an eight-minute history walk. | Same 32k-file basic open under three seconds without layout on comparable hardware; second unchanged open and one-file edits avoid whole scans; history timeout yields quantified partial data and no orphan child process. |
| 9 | Build a test-to-production map from discovered test symbols, static relations, co-change and optional coverage imports. | L | Lets agents choose tests with explicit confidence instead of guessing through file imports. | Held-out affected-test recall and false-selection rate against actual coverage/change outcomes; support Go same-package tests and Rust inline modules; distinguish static candidate from measured coverage. |
| 10 | Expose change-oriented multi-graph queries and uncapped/paged module evidence. | M/L | Combine package imports, references, tests and co-change into explainable change plans. Keep structural relations separate from correlated history. | Agent tasks can enumerate all dependents/commits/dependencies and explain every hop; evaluate recommended files/tests for a set of historical changes; report recall and output/token cost rather than only a composite score. |

## Friction log

- Temporary MCP worked without registration or settings changes. `run-mcp.py` launches the SDK recipe, opens Requests with watch=false/symbols=false, preserves complete structured results/freshness, and closes the client in finally. `mcp.ndjson` has tool schemas and twelve calls. No server remained.
- Requests open took 128.8 ms. Successful subsequent queries took 0.3 to 1.4 ms in this small run. This verifies transport/query usability, not large-project query latency.
- Deliberately tried graph dependents without path. It returned `dependents needs a path (a file, a directory or a glob)`, which is a good actionable error. The corrected query succeeded.
- file limited to five imports returned a count and more, but exposed no external/unresolved imports, original specifiers, lines or resolution reasons. I had to re-run the internal extractor/resolver to measure language outcomes; the report/MCP cannot answer why an import was unresolved.
- history coupling for sessions.py returned zero pairs with no explanation of the three-shared threshold/global top-500 cutoff in the response. The skill explains it, but an isolated answer remains too thin to infer absence.
- dependencies unused returned ten rows on Requests, including CLI/plugins and name-mismatch cases. The tool description acknowledges legitimate CLI/plugin rows; the result does not classify unknown versus established nonuse.
- Non-TS search_symbols produced an accurate error, but no next tool can perform general source-text search or definition discovery. I fell back to AST scripts and rg for fully qualified Rust uses, Cargo paths and Python import aliases.
- More-only pagination in history/dependencies and truncated cycle members cannot enumerate the tail of one selection. Increasing limit stops at 500. `files` offset works; equivalent mechanisms are missing elsewhere.
- Full default Kubernetes history took 509 seconds. A shallow clone did not imply a small analyzed commit count; merge ancestry fetched 18,070. A separate no-git run and cap-50 run isolated history cost. All three completed successfully.
- My first CLI batch reached Rails while that clone was still in progress and produced a zero-file report. I discarded that Rails result and reran after clone completion. The kept Rails report has 5,040 files/2,130 commits. `rails-cli.log` is retained as the failed experimental attempt, `rails-rerun.log` is the measurement used. This was an orchestration error in this study, not an accuracy defect in Skyplate.
- My first independent Python guard script failed to constrain rows to the current file. I corrected it and recomputed before using results. Only `type-guards.py` and the final eighteen-statement/twelve-pair output support D3. Similarly, Radon class-method duplicates were removed before reporting correlations.
- Existing project tests passed without changes. No full bun test, typecheck, viewer build, browser/report visual review, full-history public clone, Go tooling run, Java/Gradle build, native unused-dependency oracle, second-language parser-complexity run, separate blame check, controlled squash history pair, 100k/1M real repository or repeat-isolated scale benchmark was run.
- All seven public clones were deleted after preserving small source/evidence samples. Generated full viewer report folders and one-off comparison cache were removed too. Scratch stayed below 6 GB. Kept report, scripts, measured summaries, import outcomes, sample checks, snippets and logs; they are now in [evals/structure/](../../../evals/structure/). Final cleanup and checkout verification are recorded in `cleanup.json`.
