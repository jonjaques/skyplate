# Prior art: where the field is, and where Skyplate can go past it

> Research behind the [roadmap](../README.md), with sources dated up to 2026-11-16. The ranked boundaries in section 3 are tracked, with their status, as [enhancements](../enhancements.md); this file is the dated record and the full design notes. The fetched source pages are not in the repository; section 7 has every URL with its date.

Research cutoff: November 16, 2026. Read-only baseline: checkout commit `f0f874f82700ec5e5c62beef457e74de95d5841d`, plus the working files present during this research. No checkout edits, project execution, builds, benchmarks, dev servers, delegates, or remote posting were performed.

## How to read this report

Skyplate's opportunity is to make a change understandable through joined evidence: compiler references, imports, behavior in git, and module boundaries. Competing with a full compiler for every language would consume the project. Combining those facts into bounded, inspectable answers has a much better return.

"Leader" below means a strong reference implementation for a particular capability among the sources reviewed. There is no defensible universal ranking of these products. Product documentation proves that a feature is offered, not that it beats competitors. Paper results are author-reported, with their original models, tasks, and metrics. I did not reproduce them. Proposed latency, accuracy, memory, and task-success thresholds are acceptance targets, not measured Skyplate results.

Every external factual claim links to a source ID. The dated source register supplies its URL and publication or update date. `U` means the source is live but undated and its last update could not be verified. Those pages were retrieved on November 16 local time. Older research is marked explicitly. Search access was uneven: general search endpoints returned a challenge, a rate limit, or irrelevant results. GitHub repository search, Context7 documentation search, Crossref discovery, and direct primary-source reading worked. This is substantial source coverage, not an exhaustive search of everything published in 2026.

## 1. Baseline

Skyplate is a local fact extractor and an in-memory query service with a static presentation format. It is already closer to a small code intelligence database than to a file visualizer. Its distinctive asset is that one file ID connects language recognition, structure, history, symbols, source positions, and design measurements.

The baseline includes [AGENTS.md](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/AGENTS.md), [README.md](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/README.md), [PRODUCT.md](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/PRODUCT.md), and the [Skyplate skill](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/.agents/skills/skyplate/SKILL.md). Implementation anchors are the [pipeline](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts), [TS analyzer](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts), [import resolver](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/imports/resolve.ts), [graph](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/graph.ts), [git derivations](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/git/derive.ts), [schema](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts), [shared call semantics](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts), [shared search](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/search.ts), [MCP tools](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/server.ts), and [workspace lifecycle](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/workspace.ts).

### What the model contains

- Recognition of roughly 800 languages and formats, file categories, generated and vendored flags, and secret detection. File metrics use a string- and comment-aware scanner. File complexity is a keyword approximation; TS/JS callable complexity comes from the compiler AST. Duplicate detection at this level is content-hash equality, not clone analysis.
- Import extraction and resolution for more than 30 languages, including package and workspace conventions. The extractor works on masked source, not a full semantic AST for each language. Code edges and document links differ. Explicit type-only TS imports remain coupling edges but do not create runtime cycles. The graph has CSR adjacency, PageRank, iterative SCC analysis, fan-in/out, and directory-derived module coupling and instability.
- One streaming git analysis with rename handling, per-file churn and authorship, activity and growth, a churn-complexity hotspot measure, and temporal coupling. Coupling needs at least three shared commits, excludes unusually wide commits using a repository-sensitive threshold bounded between 30 and 100 files, and retains only the strongest 500 pairs. Absence from that table is not evidence of independence. The truck factor uses a degree-of-authorship model, removes bots and generated or vendored material, and measures a historical proxy for knowledge.
- For TS/JS, real `tsconfig` and `jsconfig` projects plus an inferred project for leftovers. The TS7 async compiler client supplies declarations, signatures, docs, resolved references, alias targets, and hierarchy information. References include read, write, call, construction, JSX, type, import, export, extends, and implements. The aggregate call table preserves these kinds; it is not exclusively a runtime call graph. Source positions use UTF-16 columns.
- Existing TS refinements already cover explicit method override and implementation families, JSX components, CommonJS re-exports, literal member keys such as `o["area"]()`, `super`, and JSDoc links. Imports from Vue, Svelte, Astro, HTML, VitePress, and MDX protect matched exports from an unused flag, without pretending those host-file imports are compiler references.
- Entry-point and public-package awareness protects exposed APIs. MCP `seams` and `seam` measure an interface as used by outside production callers, separately account for tests, identify internal-only exports and simple relays, connect declared interfaces to adapters, and compare co-change with short import paths. This is already more specific than an undifferentiated architecture score.

### The actual limits

Compiler symbol identity is not runtime value flow. If `register(handler)` passes a function and another function later invokes its parameter, resolving `handler` does not prove that invocation reaches it. A call through an interface names the declared member; an implementation link exposes a family, not the receiver that executes on this path. Reflection, dependency injection, framework registration, and unconstrained string keys need other evidence. Missing dependencies, `any`, skipped files, and caps make answers lower bounds.

Defaults cap TS analysis at 20,000 candidate files and stored references at 600,000. Exceeding the file cap skips TS intelligence rather than sampling it. Totals and aggregate edges are calculated before reference truncation, so stored call-site detail can be incomplete even when totals survive. Git defaults to 20,000 commits. These are useful safeguards, not a claim of complete indexing at a million files.

MCP watches live projects, queues analyses, exposes jobs and freshness notes, and reuses a current analysis for reports. Refresh still invokes the analysis pipeline; it is not a persistent dependency-tracked incremental index. File and symbol search are ranked queries, not a general full-text or structural code search engine, and there is no task-specific context-packing operation today.

The static report uses columnar integer-ID tables and classic JavaScript payloads loaded through `window.__skyplate.resolve`. It opens over `file://`, with relative assets and no report-data `fetch`. Symbols and source already have separate payloads. New binary or WASM components must preserve that loading contract. Secrets must stay absent from source, hashes, caches, search text, and imported indexes.

## 2. The map

### A. Cross-language symbols and references

#### Formats are not analyzers

SCIP is the strongest interoperability target for Skyplate. It is a Protobuf transmission format with per-document occurrences, stable symbolic names, symbol information, and relationships. Its design explicitly says it is not a query storage format. Skyplate should translate it into its own query tables rather than query the transport representation directly. Current SCIP roles distinguish definitions, imports, reads, writes, generated occurrences, tests, and forward definitions. There is no universal occurrence role that means "this is a runtime call to this implementation." Its enclosing declaration information and syntax hints do not remove the need to classify call syntax. [A01] [A02]

LSIF encodes persisted language-server answers as a graph. It remains relevant when consuming existing artifacts, but SCIP's design records why Sourcegraph removed LSIF support, including debugging, development velocity, and indexer performance. That is Sourcegraph's decision, not proof that every LSIF consumer is obsolete. Kythe takes a richer graph-fact approach with extraction and indexing infrastructure that integrates with compilation and build systems. Both show how much semantic precision depends on the producer's environment. [A03] [A04] [A02]

Glean is the strongest reference for typed, queryable compiler facts at large-repository scale. It deduplicates immutable facts, permits language-specific schemas, derives language-neutral facts through Angle, and puts Glass and an LSP server over those facts. Its February 2026 release adds practical distribution and indexing improvements, but still brings Haskell, C++, RocksDB, and compiler-oriented indexers. Its LLVM example requires generated sources, a build, and a compilation database. Study its fact ownership and incrementality; do not embed its runtime. [A05] [F01]

Stack graphs are the most interesting build-independent name-resolution idea. Per-file graph fragments encode scope and name-resolution rules; stack-constrained path search composes them across files. That is much more than a tag index, but it still needs correct language-specific rules and does not infer every runtime receiver or generated declaration. GitHub announced it in December 2021 and stopped maintaining the repository on September 9, 2025. Treat it as reusable research with maintenance cost, not a supported turnkey engine. [A06] [A07]

#### Low-cost syntax and higher-cost semantics

Tree-sitter's `tags.scm` captures definitions and syntactic references; `locals.scm` identifies scopes, definitions, and local references. These queries do not by themselves resolve imports, overloads, receiver types, or dynamic dispatch. Grammar query coverage varies. For example, the reviewed Python tags query mainly lists declarations; a project-wide reference index needs additional queries and a resolver. `web-tree-sitter` supplies a JS/WASM path and documents runtime/grammar version compatibility. This is the best fit for a default no-build layer. [A08] [A09] [A10]

Universal Ctags is a mature declaration/tag baseline with optional language-specific reference roles. It is a native GPL-2.0 distribution, and its references should not be confused with a compiler's resolved reference table. It is useful as a comparison oracle, not a new bundled dependency. ast-grep is a useful reference for Tree-sitter structural matching and rules, but structural matching is not a cross-file semantic resolver. Its MIT license is suitable in principle; the native CLI packaging is outside the preferred default runtime. [A11] [A12]

Multilspy and Serena expose normalized definitions, references, symbol outlines, and call-hierarchy tools across language servers. They also reveal the operational burden: Python client infrastructure, language-specific server installation, startup and project initialization, differing capabilities, and IDE-style demand queries rather than a guaranteed all-symbol export. Serena's current application is GPL-3.0-or-later; its separable SolidLSP client remains MIT. Neither should be silently bundled as the Skyplate core. [A13] [A14]

LSP is a useful optional adapter protocol, not a universal batch index format. Its definitions, references, symbols, and call hierarchy are requests with optional server support. Enumerating all documents and then asking for references for each declaration can repeat workspace scans. It does not automatically produce a globally complete index. Capability detection, bounded request concurrency, snapshot identity, and explicit coverage are required. [A15] [A19]

#### What the language backends actually offer

| Backend | Strongest useful output | Setup and accuracy limits under Skyplate's rules |
| --- | --- | --- |
| TypeScript 7 | Compiler types and symbols; async API; LSP-oriented navigation | Skyplate already has this. The staging `typescript-go` repo says the port completed and development moved to `microsoft/TypeScript`. Current main has `./async` and snapshot APIs, unlike the checkout's pinned `typescript/unstable/async`. Do not migrate from a historical preview tutorial or assume those API shapes match the installed release. Keep an adapter and compatibility fixtures. [A16] [A17] |
| Pyright, basedpyright | Definitions, workspace references, call hierarchy, type-aware Python navigation; JS implementation | Most credible semantic addition that does not introduce a new language runtime. Imports and stubs depend on available environments. Unknown values, decorators, metaprogramming, and runtime injection remain incomplete. Basedpyright adds editor behavior; Pyright reference-provider source shows workspace traversal per queried symbol. A full batch fork is a maintenance obligation. [A18] [A19] |
| `scip-python` | Batch SCIP occurrences from a Pyright fork | A real batch route, not a hypothetical LSP export. README updated September 5, 2025. Depends on Python package/environment discovery and has its own Pyright lineage and memory costs. Evaluate separately from adopting current upstream Pyright. [A20] |
| `ty` | Native Rust Python checker and LSP; current docs list workspace references, definitions, implementations, and symbols | It is no longer accurate to dismiss it as only an early checker. However, a stable SCIP exporter and complete batch call graph were not verified. Its native runtime makes it optional rather than a core dependency here. [A21] |
| `gopls`, `scip-go` | Type-aware Go navigation and batch SCIP, respectively | `gopls` explicitly warns that references cover the selected build configuration and its call hierarchy excludes dynamic calls. `scip-go` shells out to Go by default and supports package drivers. Toolchain, modules, build tags, cgo, and generated files matter. [A22] [A23] |
| `rust-analyzer` | Semantic LSP and an actual `scip` CLI implementation | For configured projects it resolves much more than syntax, including language semantics. Cargo-free use still needs project metadata such as `rust-project.json`; macros, cfgs, build scripts, dependencies, and proc macros can require environment information or execution. No credible zero-config, pure JS replacement was verified. [A24] |
| JDT LS, `scip-java` | Java navigation; batch Java/Kotlin indexing | JDT LS requires a Java runtime and project/classpath setup. `scip-java`'s getting-started path uses build-tool integration. Missing classpaths and generated sources bound precision. Neither fits as a mandatory pure JS/WASM backend. [A25] [A26] |
| JetBrains Kotlin LSP | IntelliJ-powered Kotlin navigation and call hierarchy | README updated November 13, 2026: alpha, Gradle/Maven JVM support, experimental Android support, and partially closed-source implementation. This is an optional user-installed service, not a redistributable default engine. [A27] |
| `clangd`, `scip-clang` | Accurate C/C++ symbols, references, hierarchy, and batch index formats when configured | Preprocessor macros, include paths, target, and flags determine which program exists. clangd documents that its fallback command often fails on real projects. Its background index stores shards on disk, potentially next to the project. scip-clang consumes compile commands. Under a hard no-compile-database rule, a compiler-accurate promise is untenable. [A28] [A29] |
| SourceKit-LSP | Swift and C-family navigation and source indexing | README updated June 20, 2026: global/cross-module features are limited without a recent build or experimental background indexing. Strong optional integration, poor no-build default. A stable SCIP export was not verified. [A30] |

#### Cheapest credible route for the next five language families

There is no credible way to provide compiler-accurate definitions, references, and runtime call graphs for all five under every stated constraint. The cheapest honest product is a common syntax layer plus increasingly strong evidence, not a single "supported" checkbox.

| Family | Default implementation with no build | What can be claimed | What must remain candidate or unknown | Optional route if an index already exists |
| --- | --- | --- | --- | --- |
| Python | Python grammar WASM; definitions and scope queries; reuse module resolver; resolve lexical bindings, explicit imports, aliases, and statically named class members | High precision for parsed declarations and direct lexical/import targets; partial static call candidates | Monkey patches, descriptors, decorators, dynamic imports, `getattr`, runtime DI, unknown receiver types | Import `scip-python` SCIP; optionally use a separately enabled Pyright adapter for current configured environments. [A18] [A20] |
| Go | Go grammar WASM; package-scoped declarations; import aliases; explicit selector resolution; conservative receiver/type matching | Reliable declarations and ordinary package-level calls in available source; candidate interfaces | Build variants, generated files, cgo, function values, interfaces without sufficient type facts | `scip-go` import; optional gopls queries. Its call hierarchy still excludes dynamic calls. [A22] [A23] |
| Rust | Rust grammar WASM; modules, `use` aliases, lexical names, explicit paths; preserve unresolved macro sites | Reliable parsed declarations; useful explicit-path reference candidates | Macro expansions, proc macros, cfg-selected modules, trait method dispatch, inferred types, generated code | Read rust-analyzer SCIP from the matching snapshot; no requirement to invoke Cargo. [A24] |
| Java/Kotlin | Separate grammars; packages/imports; lexical and explicit type-qualified names; class hierarchy candidates | Good declarations; useful bounded navigation within visible source | Overloads and extensions without types, Kotlin delegation, annotation processors, reflection, missing classpaths | Read `scip-java`; user-installed JDT LS or Kotlin LSP only as explicit optional adapters. [A25] [A26] [A27] |
| C/C++ | C and C++ grammars; declarations; include graph; lexical and explicitly qualified symbols; retain preprocessor context | Good syntax inventory with visible ambiguity; direct function candidates in simple source | Which conditional program was compiled, macros, templates, overloads, headers and ABI context | Read existing SCIP or other configured compiler index. No automatically generated compile database or project build. [A28] [A29] |

These are qualitative expectations, not measured precision percentages. Ship language-specific gold sets before making numerical claims. A declaration parser can be very accurate while the reference and call recall is low. That distinction must survive through MCP and the report. The seven proposed grammar sources and Tree-sitter runtime are MIT; verify and pin the exact grammar/WASM artifacts and their notices. [L01]

### B. JavaScript and TypeScript call precision

Skyplate has a declaration/reference graph. Deeper call analysis must model functions and objects flowing through assignments, parameters, returns, properties, and libraries. Type information narrows candidates but does not generally identify the function object that executes.

The useful comparison is a ladder of cost and assumptions:

1. Class hierarchy analysis considers compatible implementations. It is cheap relative to points-to analysis but admits implementations never instantiated. Rapid type analysis uses reachable code and instantiated/runtime types to prune that set, so it needs roots and an execution-world assumption. Variable type analysis propagates possible types and function values through a graph. The current Go implementations document these tradeoffs and the experimental status of VTA; their October 2026 package docs are a useful concrete reference. Transferring the ideas to structural, dynamic TS/JS takes additional work. [B01]
2. Field-based approximate call graphs collapse properties by name and propagate function values through a cheaper model. The ACG reference implementation explicitly ignores some dynamic property accesses and reflective `call`/`apply` uses, and states that its graphs are incomplete. It is a useful design reference, not a modern TS7-compatible drop-in. Its core research is from 2013 and its EPL-2.0 implementation needs separate license review before reuse. [B02]
3. Jelly is a stronger practical reference. Its flow-insensitive control-flow and points-to analysis models much of ECMAScript, intentionally without full soundness; its README says Node's standard library is unknown code. It supports bounded indirection, timeouts, package selection, partial results, and dynamic-graph comparison. The 2024 indirection-bounding paper reports close to 2x speedup with about 5% recall reduction relative to its baseline on 25 Node programs, measured against observed dynamic graphs. That is evidence for a budget knob, not proof of universal speed or complete recall. Jelly's static core is TS/JS under BSD-3-Clause, but it brings Babel, its own TS dependency, and a sizable model. Bun compatibility and Skyplate-scale memory were not tested. [B03] [B04]
4. CodeQL supplies interprocedural/global data-flow and library modeling through access paths, sources, sinks, summaries, and type models. Joern unifies AST, control flow, and dependence information into a code property graph, with type propagation in its JS frontend. These are useful references for data-flow facts and explicit models; they are larger analysis/database systems than Skyplate needs. Do not equate a CPG's existence with sound dynamic dispatch. [B05] [B06]
5. Semgrep's proprietary cross-file analysis combines cross-function flow, constant propagation, and type inference. Its current docs distinguish this from CE's intraprocedural analysis and document a CommonJS function-export pattern it misses. Shipping coverage still depends on language, models, and supported constructs. It is not a redistributable pure JS engine Skyplate can adopt. [B07]

For callbacks, add parameter/return value-flow summaries, starting with local higher-order functions and a few precisely identified standard-library APIs. For dynamic dispatch, return a candidate family with an explicit reason and root assumptions. For DI and framework conventions, model registrations and invocations as distinct edges, tied to resolved imported API identities and supported versions. For string-keyed access, Skyplate already handles literal member names; the next step is finite key-set propagation, not all possible strings. An unknown key must remain unknown.

Never mix a type-declared reference, an inferred call candidate, a framework registration, and a runtime-observed edge into one unlabeled caller count. This separation is where Skyplate can be more useful to agents even before it matches Jelly's reach.

### C. Context retrieval for coding agents

Aider is the clearest small-system reference. It extracts definition/reference tags, constructs a dependency graph, personalizes PageRank around chat files and identifiers, and emits important signatures within a token budget. The current docs describe a default 1,000-token map that can expand. Its October 2023 design post remains useful but is old; this is a strategy, not a current controlled proof against grep. Compiler-resolved TS edges give Skyplate a stronger ranking signal than same-name syntactic references, while git and test relations add signals Aider's documented map does not provide. [C01]

The familiar product categories have changed. Cursor's current search page describes a local "Instant Grep" index, regex matching, and an Explore subagent. It explicitly says it does not store codebase embeddings for search. Its performance superiority over ripgrep is a vendor claim without a reproduced benchmark here. Do not use old embedding-index descriptions as its 2026 architecture. The Windsurf URL now redirects to Devin Desktop documentation, which describes RAG indexing, pinned context, and remote indexing. Augment's Context Engine offers a retrieval MCP and an SDK with indexed workspace/context services; its internals and comparative task-success claims are not independently established by those docs. These are product references, not acceptable required hosted dependencies. [C02] [C03] [C04]

Claude Code's current best-practice guidance supports search, source inspection, exploration, and use of LSP tools where available. Amp's tools page, updated November 5, 2026, describes shell/tool-based code inspection and search subagents. Neither source proves that grep dominates every indexed approach, nor that the entire product has no private retrieval machinery. The credible baseline is an agent equipped with fast search, not a deliberately weak text-RAG straw man. [C05] [C06]

#### What the research actually demonstrates

| Source and date | Evidence | What it does not demonstrate |
| --- | --- | --- |
| RepoGraph v2, March 18, 2025 | Plug-in line/definition/reference graphs improve several existing systems. With GPT-4o Agentless on SWE-bench Lite, resolve rate goes from 27.33% to 29.67%; file localization 68.7% to 74.3%, function 51.0% to 54.0%, line 34.3% to 36.7%. A flattened two-hop variant drops to 26.00%. [C07] | A graph is not automatically helpful when expanded. Results use older models and Python-heavy benchmarks, not today's best search agent or Skyplate. Localization here is inferred from generated patch locations. |
| LocAgent v2, April 29, 2025 | Typed contain/import/inherit/invoke relations, hierarchical entity search, bounded BFS, and fold/preview/full results. On 274 retained SWE-bench Lite tasks, Claude-3.5 file Acc@5 is 94.16% versus OpenHands 90.15%; function Acc@10 77.37% versus 70.07%. Its ablations remove traversal and constrain hops, reducing localization, especially at finer granularity. [C08] | These are not Acc@1 or pass@1 gains. The comparison changes the localization system and tooling; it does not isolate a graph from all search-agent design differences. Its fine-tuned model's 92.70% is file Acc@5, not 92.7% exact localization. |
| CodexGraph v3, July 27, 2026 | A code graph database and generated Cypher queries support several tasks. GPT-4o SWE-bench Lite pass@1 is 22.96%, tied with AutoCodeRover in its table; average tokens are 102.25k versus 76.01k. Its authors describe query-generation loops and uncontrolled result size. [C09] | General graph-query access is not a demonstrated improvement on every task or backbone. A hosted graph database and a second query-translation LLM do not fit Skyplate's constraints. |
| Agentless v2, October 29, 2024, old | Hierarchical file, symbol, and edit-location narrowing works without an elaborate autonomous search loop. The paper is a strong baseline for progressive detail. [C10] | It does not prove whole-repository summaries beat direct search in general. Its contemporary leaderboard claims are historical. |
| GraphRAG v2, February 19, 2025, general-domain evidence | Entity graphs and community summaries help global, query-focused summarization over text. [C11] | Global textual-summary results do not establish code localization or repository patch success. LLM-generated summaries have cost and faithfulness problems for a deterministic offline analyzer. |

The justified direction is hybrid retrieval with exact anchors first, token-limited symbol or function neighborhoods second, and full source on demand. Keep a text route for errors, string keys, config, SQL, and docs that have no symbol. Use code structure to select and explain context, not to force every question through a graph. File recall and function recall are separate objectives; giant functions may need statement windows. Deterministic outlines are cheap and verifiable. LLM-written hierarchical summaries are optional at most and should never become the stored source of truth.

The missing experiment is straightforward: same model, same task set, same time/token budget, compare grep only; symbol tools; lexical-plus-symbol retrieval; then add import, test, and co-change relations one at a time. Freeze each repository before the target patch and before later history. Otherwise temporal information leaks the answer.

### D. Behavioral code analysis

CodeScene is the best documented reference for joining change frequency with code health and ownership. Its X-Ray works inside functions and methods, reports function-level complexity trends and temporal coupling, and can relate work through ticket IDs when commits are too small or distributed across repositories. Its code-health docs already combine clone-like duplicated logic with predictable co-change. Skyplate cannot claim that function coupling or clone-plus-churn is new. Its opportunity is to join those behavioral measurements to compiler-resolved callers, an interface as used, and explicit missing-static-path evidence in a lightweight offline tool. [D01] [D02] [D03]

CodeScene's knowledge maps use deep contribution history rather than just the current snapshot, and distinguish knowledge islands, former contributors, and complex hotspots. Skyplate's existing DOA truck factor is a credible research-derived baseline. The original 2016 authors report much stronger agreement about who the main authors are than about the exact truck-factor estimate. Treat it as a historical concentration proxy. Recentness, pair programming, reviews, bots, squashes, author identity, and generated changes all affect interpretation. Do not turn it into an employee ranking. [D04] [D05]

SZZ starts from identified bug-fix changes, traces changed or deleted lines backward, and guesses introducing commits. SZZ Unleashed explicitly describes the method as heuristic and demonstrates downstream just-in-time defect prediction. That requires trustworthy fix labels, enough history, and decisions about blame, refactorings, merges, and observation periods. Churn and complexity alone do not justify a calibrated probability that a file contains a defect. Skyplate can produce auditable historical associations, but should not ship an unvalidated "bug likelihood" score. [D06]

Test impact has several distinct reference systems:

- Bazel's query/affected-style workflows use a declared target graph and reverse dependencies. They are strong when the build graph is complete, but target granularity and runtime/data dependencies matter. Skyplate does not have that build contract. [D07]
- Jest's `--findRelatedTests` computes related tests for supplied source files and supports changed-file workflows. It is a practical static module-graph baseline for JS, not proof that all dynamic behavior is covered. [D08]
- pytest-testmon records executed-code dependencies with Coverage.py, compares changes, and persists `.testmondata`; it must run tests first and can place the database elsewhere through configuration. This is stronger execution evidence than static imports, while still limited to observed paths and environments. Skyplate should import existing coverage/test artifacts, never run the analyzed project just to discover them. [D09]
- Launchable learns from historical test results, code changes, test/path characteristics, and environment flavors, then selects a subset to a duration or confidence objective. Its reviewed explanatory pages say "last modified 3 years ago," so treat the exact service behavior as potentially stale. The essential difference is learned failure ranking, not a static dependency closure. Required service calls and training history are out of scope. [D10]

Symbol-level temporal coupling is useful, but obtaining it is more expensive than assigning today's line ranges to old diffs. Correct extraction needs the old source, declaration boundaries at that revision, rename/move matching, and stable symbol identity. Start with changed hunks and bounded history for selected hotspots; label unmatched spans and deleted symbols. Re-parsing every revision of every file would violate the minutes budget.

### E. Architecture and design

Dependency-cruiser is the strongest JS dependency-rule reference, with forbidden/required constraints, cycles, orphan detection, and configuration-aware resolution. Madge is a smaller graph-and-cycle reference. Nx adds a project graph, git-based affected analysis, dependency-aware invalidation, and tag/module-boundary rules. Turborepo has package and task graphs. These systems know different units: a file import, a package dependency, a task input, and a semantic caller cannot be substituted for one another. [E01] [E02] [E03] [E04]

For enforcement, ArchUnit tests Java bytecode dependencies and architecture rules, including layers and cycles. Import Linter offers Python forbidden, protected, layered, independence, and acyclic-sibling contracts. Tach enforces declared module dependencies and public interfaces in Python with a Rust implementation. Their useful lesson is explicit, executable architectural intent with actionable violations. Skyplate can add a cross-language policy layer above its existing evidence, without requiring these runtimes or modifying the analyzed project. [E05] [E06] [E07]

Knip is the best comparator for TS unused-code correctness because its plugin system discovers framework/tool entry points, configurations, and scripts. Reachability depends on knowing roots. Skyplate already reads several declared roots, protects published package APIs, and accounts for host-file imports; the next improvement is transparent convention coverage and explanation, not a blanket "more unused exports" claim. Knip's ISC license permits reuse of appropriate ideas or code with notices, but its complete plugin system would expand Skyplate's dependency and configuration budget. [E08]

A design structure matrix is a representation of relationships between units. Skyplate already computes a module coupling matrix, so the frontier is interaction and diagnosis: reorder modules, show cycles and direction, compare runtime with type coupling, and add a separate behavioral matrix. Do not present a second matrix as a new analysis algorithm.

Louvain and Leiden are plausible ways to ask whether dependency communities agree with directories. Leiden's 2019 paper shows that Louvain can yield badly connected communities and provides a better-connected partitioning algorithm. This is a useful algorithmic warning, not evidence that graph communities equal good software modules. Resolution, hubs, graph projection, edge direction, and stochastic choices affect partitions. Graphology's MIT Louvain implementation is a feasible pure JS starting point if stability and connectedness are checked. Compare partitions across seeds/resolutions and show disagreement rather than prescribing file moves. [E09] [L02]

Arcan's 2017 paper documents architecture-smell detection through dependency analysis and graph databases. Dependency cycles, hubs, and instability are useful architecture-smell families to evaluate. Their exact membership in Arcan's current catalog and its severity model were not verified from accessible full documentation. Its current commercial page describes change-impact models trained on historical changes and connections to delivery/test tools. That directly overlaps a superficial "hidden impact" pitch. Skyplate's possible advantage is open, local, source-linked explanations and explicit uncertainty, not the unsupported claim that nobody uses history for impact. Vendor savings percentages were not treated as independent evidence. [E10]

Clone detection ranges from hashes, through normalized tokens and syntax, to learned representations of similar behavior. SourcererCC is a strong scale reference for token-based near-miss clone detection, using indexing and filtering rather than all-pairs comparison. Its 2015 paper is old, and it is not a 2026 accuracy leader claim. GraphCodeBERT's 2021 revision demonstrates learned, data-flow-aware representations on clone and other tasks, but benchmark performance does not make semantic equivalence reliable or inexpensive. Token candidates plus current symbol boundaries and co-change are the credible default here. Required embedding weights and approximate-nearest-neighbor infrastructure are poor fits. [E11] [E12]

### F. Scale and incrementality

Glean's incremental design associates facts with source ownership units, hides invalidated units, stacks new facts, and propagates ownership to keep derived references valid. Its 2022 engineering post reports small overheads for its workloads, and its February 2026 release confirms ongoing development. Those numbers do not transfer to Bun arrays; the transferable principle is that derived facts need dependencies and snapshot identity, not just a content hash. [F01] [F02]

Salsa formalizes tracked inputs, memoized queries, change verification, and dependency-driven recomputation. Its documentation uses rust-analyzer as a production example. A small explicit dependency DAG for Skyplate is more realistic than importing a Rust query runtime. Watchman is a useful example of subscriptions, clocks, change sets, and fresh-instance handling, but it is another native daemon and should be optional at most. Filesystem notifications are hints, not proof of completeness; git HEAD alone misses uncommitted and untracked changes. [F03] [F04]

For Skyplate, separate cache units are needed for detection and metrics; raw import extraction; resolution context; compiler projects; git observations; and derived graph/statistics. A source hash can reuse tokens while `tsconfig`, `package.json`, an ignore file, a directory rename, or a missing dependency invalidates resolution. Git caches must handle appended ancestry, rewritten history, renames, shallow-history changes, and modified analysis options. Compiler project membership and type changes can affect consumers without textual edits. Persistent IDs and snapshot IDs must be separated from presentation row numbers.

At 100,000 to more than a million files, "finish everything in memory" becomes the wrong invariant. Stream the file inventory; bound per-file reads; index own code separately from vendor material; shard references; store reverse indexes; keep compact numeric columns; compute expensive refinements on demand. Current TS defaults intentionally decline more than 20,000 candidates. A larger cap alone will not solve peak memory, call-table size, serialization, browser parse time, or source retention.

Arrow provides a standardized columnar layout and typed buffers; Parquet adds compressed, column-oriented pages and row groups for storage. DuckDB-WASM offers SQL in the browser over Arrow, Parquet, JSON, and CSV, but brings a WASM engine, worker/bootstrap loading, and copies into its heap for buffer registration. Its convenient examples use URLs/CDNs or file registration. None of that automatically satisfies file-based classic-script loading. [F05] [F06] [F07]

Skyplate should keep a lightweight default, first introducing dictionary encoding, typed columns, independently loadable classic-script shards, metadata summaries, and on-demand detail. A separate optional served-report SQL mode could later justify DuckDB-WASM, but it must not replace double-click opening. Pure JS custom queries over already columnar tables will likely cover most product queries with much less shipping cost. This is an engineering judgment; browser performance and bundle sizes were not measured in this research.

### Resource costs worth budgeting explicitly

| Approach | Main cost | Consequence for a local analyzer |
| --- | --- | --- |
| Syntax and lexical facts | Parse bytes, syntax-tree memory, query matches, and language-specific resolver maintenance | Parse in bounded workers, extract facts, drop trees, and cache. A grammar does not remove resolution work. [A08] [A10] |
| Whole-workspace LSP queries | Server warmup plus repeated project search; Pyright reference collection walks workspace files | Do not issue one global references query for every symbol and assume linear cost. Use batch producers or explicit limits. [A19] |
| Compiler batch indexes | Toolchains, dependencies, build variants, generated source, and output I/O | Useful as imported artifacts. SCIP-python documents increasing the Node heap to 8 GB if necessary; that is a troubleshooting recommendation, not its minimum requirement. [A20] |
| Value-flow call analysis | Iterative set propagation, library models, and dependency expansion | Jelly warns about long dependency analysis and offers time/indirection budgets. Do not promise a fixed cost from line count alone. [B03] [B04] |
| Full compiler-fact databases | Extraction plus server/storage infrastructure | Glean's 2026 LLVM example budgets roughly 16 GB for 12 concurrent indexing processes after a project build. This is one documented example, not a lower bound for Glean. [F01] |
| Learned retrieval or failure prediction | Index/model storage and inference or service/training history | Product-specific costs were not independently measured. Required hosted inference fails the deployment constraint. [C04] [D10] |
| Browser SQL and compressed binary data | Engine/worker loading, decode buffers, query memory, and copies | Arrow/Parquet compactness is not a guarantee of low startup heap; prototype on `file://` before adopting an engine. [F05] [F06] [F07] |

Analyze-only parsers need not enter the viewer bundle. Any JS or WASM that does ship in a report must carry its license through the generated notices. A format change must not hide code dependencies in data payloads.

## 3. Ranked boundaries Skyplate could push

Effort is a planning estimate for one experienced contributor with fixture and benchmark work: S is several days, M is roughly 1-3 weeks, L is roughly 4-8 weeks, XL is multiple months. These ranges are not delivery promises. Ranking weights user value, existing data reuse, verifiability, and the constraints. Each proposal includes an experiment that can reject it.

### 1. Task-specific, token-budgeted context packs

What to build: an MCP operation accepting a question, optional seed files/symbols, relation filters, and a byte or token budget. Return ranked definitions, signatures, short source spans, nearby tests, and a separate "why included" trail. Exact text and symbol matches seed a personalized graph walk; imports, callers, and co-change are separate channels. Offer outline, preview, and source detail. Deduplicate overlapping spans and cap both graph expansion and output.

Best reference and limit: Aider supplies the compact map; LocAgent supplies typed traversal and progressive detail. RepoGraph supplies direct evidence that one-hop context helps and uncontrolled two-hop expansion can hurt. None of these reviewed designs establishes the value of adding temporal and interface facts to a compiler-resolved TS graph. [C01] [C07] [C08]

Gap and joined advantage: Skyplate has the entities and relations but no task-conditioned retrieval or budgeted packing. It can include a rarely imported but repeatedly co-changed companion with a clear reason, and distinguish production consumers from test-only uses. That is a concrete extension beyond merely ranking central files.

Feasibility and dependency/license: no new dependency is required for inverted identifier/text terms, BM25-style scoring, personalized PageRank, or UTF-8 byte budgets; implement in Apache-2.0 Skyplate. Start with explicit byte budgets and estimated tokens to avoid adding a tokenizer. An exact tokenizer can be a later optional adapter after package-size and license review. No LLM is required to construct the pack.

Effort M. Risk is distracting context from common names, hubs, and broad change sets. Measure file and function recall@k, useful source recall per 4k/8k budget, p95 query latency, and downstream pass@1 under the same agent/model/time budget. Require an ablation showing that git relations improve a hard subset without degrading the full task set. Target p95 under 100 ms on a warm 20k-own-code-file index, to be measured.

### 2. Evidence types and completeness attached to every answer

What to build: a shared edge contract carrying origin, relation kind, source position, snapshot, analysis assumptions, and support count. Separate compiler-resolved references, syntactic candidates, inferred value-flow calls, declared registrations, temporal associations, and imported coverage. Add coverage by language, project, file, and query. Explain why "no results" might be a lower bound. Do not invent numerical confidence probabilities.

Best reference and limit: SCIP carries occurrence roles and relationships; Glean tracks fact provenance/ownership; gopls explicitly documents build-configuration and dynamic-call exclusions. These are strong pieces, but no reviewed source supplies Skyplate's combined static, historical, and design-specific completeness explanation. This is a scoped observation about the reviewed sources. [A02] [A22] [F02]

Gap and joined advantage: today's schema largely assumes one TS engine and stores relations without per-edge provenance. Existing warnings, truncation counts, host uses, and freshness notes provide a good start. The same uncertainty can constrain unused-export claims, caller display, context packs, seam findings, and change-impact answers.

Feasibility and dependency/license: schema and query changes only, no new runtime dependency; Apache-2.0 project code. Dictionary-encode origins and store shared analysis metadata once rather than repeating strings per reference. Imported indexes must never import secret text just because their producer included it.

Effort M. Risk is a verbose API and table-size growth. Measure additional bytes per million edges, response overhead, and a gold set of misleading-negative scenarios: missing node_modules, `any`, capped references, skipped language, stale snapshot, missing build variant, and an unknown callback. Every fixture must return the correct caveat, and all existing strict-reference counts must remain unchanged.

### 3. Persistent, dependency-aware incremental snapshots

What to build: a cache outside the analyzed directory with versioned per-file facts, resolution-context fingerprints, compiler-project snapshots, git checkpoints, and derived-query invalidation. Retain a current snapshot while building the next, then swap atomically. Preserve stable entity keys internally and remap to dense report IDs only at export.

Best reference and limit: Glean provides source-owned fact replacement and snapshot stacking; Salsa provides input/query dependency tracking. Glean is too large to embed, and tracking every query dynamically would be excessive here. Current TS main exposes snapshot/update concepts, but compatibility with Skyplate's pinned async API must be established before relying on them. [F02] [F03] [A17]

Gap and joined advantage: the watcher currently invalidates an analysis, not a set of derived units. Skyplate knows both compiler ownership and import reach, so it can invalidate at the right levels rather than trusting filesystem paths alone. A git-only invalidator would miss in-flight edits and config changes.

Feasibility and dependency/license: use built-in Bun filesystem, hashing, and optionally `bun:sqlite`, so no new npm runtime dependency. Cache code is Apache-2.0. Do not retain secret contents or secret hashes. Use schema/tool/grammar version keys and a disposable cache with bounded size. Built-in SQLite is a CLI cache option, never a viewer requirement.

Effort L to XL. Risk is silent stale analysis. Require incremental/full-rebuild equality across edit, rename, delete, package/config change, git rewrite, shallow-fetch extension, and dependency appearance scenarios. Targets: at least 5x faster repeated analysis after a local 1% edit and less than 2 seconds to refresh common small-project edits, measured on named fixtures. Correctness precedes speed.

### 4. Honest symbol navigation for five more language families

What to build: one WASM parser layer, pinned grammars, declaration spans, local binding indexes, explicit imported-name resolution, and syntactic call sites for Python, Go, Rust, Java/Kotlin, and C/C++. Return unresolved/candidate sets rather than false certainty. Add an engine/language discriminator to the schema; keep TS compiler data as the stronger tier.

Best reference and limit: Tree-sitter provides the cheap syntax layer; stack graphs demonstrate cross-file lexical resolution without builds. Tree-sitter tags alone are insufficient, and GitHub no longer maintains stack graphs. [A08] [A09] [A07]

Gap and joined advantage: these languages currently have imports and history but no symbol inventory. Even without compiler fidelity, a function-level declaration and lexical-reference index makes git hotspots, source spans, test relationships, and seams useful at a finer level. A generic tags tool does not supply that existing joined model.

Feasibility and dependency/license: `web-tree-sitter` plus seven pinned language grammars, all MIT in the reviewed upstream license files. Ship prebuilt WASM so analyzing a directory triggers no grammar build. Runtime/grammar ABI compatibility needs fixtures. Load grammars only for present languages and amortize parsing with the cache. [L01]

Effort L for a first useful Python/Go tranche, XL for all families with meaningful resolution. Risk is calling same-name matches references. Measure declaration precision/recall, exact-target precision, unresolved share, candidate set size, and call recall separately for each language and construct. Target more than 99% declaration precision on maintained fixtures and report measured semantic coverage rather than promise a cross-language percentage.

### 5. Bounded TS/JS callback and receiver flow

What to build: an optional refinement pass over existing AST/symbol facts for function aliases, parameter and return flow, object-literal slots, finite string keys, and receiver families. Add explicit summaries for a small set of standard higher-order APIs. Stop at an indirection/time/edge budget and expose partial status. Preserve the strict reference graph as its own view.

Best reference and limit: Jelly's points-to core and indirection bounding are the practical references. Its bounded-analysis paper gives a measured precision/recall/runtime tradeoff, while its current README warns about unknown Node code and expensive dependency analysis. Skyplate should not simply import the entire analyzer. [B03] [B04]

Gap and joined advantage: the compiler resolves declarations; it does not propagate every callable value through application code. Skyplate can prioritize refinement on hot, broadly consumed interfaces and let an agent request deeper analysis for one seed rather than pay whole-repository cost.

Feasibility and dependency/license: initially use the existing TypeScript package, Apache-2.0, and Skyplate code. Jelly, BSD-3-Clause, can be a separately invoked research comparator or source of carefully reviewed ideas; its package has many dependencies and a separate TS5 line, and Bun compatibility is unverified. Approximate interpretation executes parts of code and is excluded from this proposal.

Effort L. Risk is graph explosion and overconfident dispatch. Use hand-labeled callback/DI fixtures plus dynamic traces from benchmark projects executed only in an explicit evaluation environment. Targets: recover at least 20% of known callback misses in the chosen gold set with at least 90% precision on added edges, and less than 25% cold-analysis overhead at the default bound. Those are proposed gates, not observed results.

### 6. Explainable change impact and test candidates

What to build: accept a patch or set of edited symbols, distinguish body/type/export/registration/config changes, traverse suitable relation kinds, and return ranked impacted symbols, files, and tests with paths explaining each result. Add existing coverage JSON as optional observed evidence, with commit/environment metadata and stale-coverage handling. Always retain a conservative broader set.

Best reference and limit: Jest provides related tests from dependencies; Bazel provides target-level reverse reachability; testmon adds executed-code evidence; Launchable learns failure likelihood. None makes static reachability a proof that omitted tests are safe. [D07] [D08] [D09] [D10]

Gap and joined advantage: Skyplate already has transitive symbol impact and file dependents, but no patch-aware operation, test-artifact import, or joint ranking by type/runtime path and historical co-change. It can explain why a companion test is relevant despite no direct import, and why a type-only edit reaches a compile consumer.

Feasibility and dependency/license: patch parsing, existing graph code, and JSON coverage adapters need no new dependency; Apache-2.0 project code. No test execution, instrumentation, database writes, or build step in the analyzed directory. Start with documented existing artifact schemas and never require .testmondata or a service.

Effort M to L. Risk is unsafe test exclusion. Ship "test candidates and reasons," not an automatic safe-to-skip gate. Replay pre-change snapshots with known executed failing tests. Measure failure-catching recall, tests retained, path explanation correctness, and stale-artifact rejection; report the recall/selection curve rather than one savings number.

### 7. Function-level history and temporal coupling

What to build: assign changed hunks to declarations at the revision where they occurred; retain stable identities through detectable moves/renames; report per-function churn, complexity trend, authorship, and coupling. Bound analysis by selected hotspots, recent window, and total historical parse bytes. Include deleted or unmatched spans as explicit unknowns.

Best reference and limit: CodeScene X-Ray already supplies function hotspots, complexity trends, method coupling, and clone-like co-change. That capability is established, not novel. The open gap is a lightweight connection to compiler references and the interface as used. [D01] [D02]

Gap and joined advantage: Skyplate has current symbol spans and file-level git behavior, but historical file stats cannot accurately identify which current function caused the churn. Joined symbols let an answer say "this method changes often, is called across three boundaries, and usually changes with an adapter that imports no path to it," with supporting commits.

Feasibility and dependency/license: use existing git streaming and TS parsing first; later use the MIT WASM parsers in boundary 4. No new runtime dependency in the TS first version. Keep historical text transient and cache only nonsecret derived facts outside the project.

Effort L. Risk is bad identity across large refactors and high parse cost. Measure hunk-to-symbol attribution and rename/move precision on manually labeled histories; benchmark parse-byte limits. Reject any implementation that replays the whole repository unboundedly or assigns old hunks using only today's line ranges. Compare hotspot ranking against file-only ranking in real review tasks.

### 8. Structural and behavioral disagreement as architecture evidence

What to build: compute separate import, caller, test, and co-change views; compare dependency communities with directory modules; identify stable disagreements and explain the actual bridging symbols and commits. Offer counterfactual module membership without moving files. Preserve direction and type/runtime distinctions instead of collapsing all relations into one weight.

Best reference and limit: Leiden improves on Louvain's connectedness guarantees; CodeScene and Arcan already use behavior for architecture/impact questions. Graph communities are not automatically intended modules, and historical similarity is not causation. [E09] [D02] [E10]

Gap and joined advantage: Skyplate has directory modules and a hidden-coupling lead, but no independent community comparison, stability analysis, or evidence for which interface creates the mismatch. Compiler callers plus temporal evidence can separate a hub utility, a registration seam, and a misplaced responsibility more credibly than imports alone.

Feasibility and dependency/license: begin on bounded module/own-code graphs with `graphology` and `graphology-communities-louvain`, MIT, or implement a small deterministic graph routine. Those packages add transitive dependencies; benchmark against the existing CSR representation before adopting them. A Leiden implementation for Bun/WASM was not license- and quality-verified. [L02]

Effort M to L. Risk is stochastic, resolution-sensitive prescriptions. Require repeatability, connectedness checks, sensitivity intervals, and source inspection for every recommendation. Measure precision of the top ten review leads with blinded maintainer judgments, plus backtesting of whether suggested partitions reduce future cross-boundary edits. Do not optimize modularity alone.

### 9. Read existing SCIP indexes and join them to history

What to build: import one or more explicitly supplied local SCIP artifacts, map their document paths and symbol keys into a snapshot, retain indexer/version/build metadata, and query them through existing symbol tools. Read matching source syntax to classify invocation sites where possible. Mark artifacts stale when their source snapshot does not match.

Best reference and limit: SCIP has real indexers for Python, Go, Rust, Java/Kotlin, and C/C++, with backend-specific environment requirements. It is a transmission format, not an execution-complete call graph. Importing an artifact must not imply every language's symbol references are calls. [A01] [A02] [A20] [A23] [A24] [A26] [A29]

Gap and joined advantage: Skyplate's schema names only TypeScript as engine and assumes dense local symbol identities. An importer buys compiler-grade facts when users already have them, without imposing toolchains on everyone. The differentiator is immediate git/seam/context joins for the imported symbols.

Feasibility and dependency/license: generate a narrow decoder from the Apache-2.0 SCIP schema using `@bufbuild/protobuf`, Apache-2.0, or a reviewed small decoder; stream per-document messages and bound input size. The format and decoder license do not grant licenses to bundled indexer executables or generated source contents. Never auto-build, auto-install, or execute an indexer. [L03]

Effort M. Risk is mismatched versions, source encodings, path escapes, indexer omissions, and secret data embedded in indexes. Measure parity against each indexer's navigation fixtures, stale-index detection, UTF-8/UTF-16 conversion, and memory per million occurrences. Reject content for secret-classified documents before storage.

### 10. Full-text and structural search that complements symbols

What to build: a source-text inverted/trigram index and syntax-pattern queries, with file/language/category filters, symbol containment, regex confirmation, and excerpt budgets. Search docs, configuration, and string keys alongside source, but return literal and structural evidence separately. Include generated/vendor material only under explicit filters.

Best reference and limit: current Cursor emphasizes local grep-style indexed search; ast-grep demonstrates structural matching. Neither literal search nor syntax patterns alone prove a semantic reference. [C02] [A12]

Gap and joined advantage: Skyplate's fuzzy symbol/path queries miss nonidentifier evidence. Mapping literal hits to enclosing symbols and their dependencies/history makes them useful seeds for context packs and answers about framework wiring.

Feasibility and dependency/license: a minimal index and regex verification can use built-in runtime features, Apache-2.0 project code. Reuse `web-tree-sitter`, MIT, for structural matching rather than add the native ast-grep binary. This requires source availability; no-source static reports must plainly disable text search rather than silently index private source in another payload.

Effort M. Risk is index size, regex cost, and secret retention. Compare recall and p95 latency with ripgrep on warm/cold indexed workloads, including rare error strings, punctuation-heavy keys, and natural-language queries. Require exact matches to remain exact and all secret fixtures to remain absent from both results and cache bytes.

### 11. Registration and cross-language contract edges

What to build: small declarative extractors for resolved registration APIs, route declarations, test declarations, command registries, schemas, and generated-code source declarations. Represent `registers`, `implements-contract`, `generates`, and `loads-by-convention` separately from `calls` and `imports`. Start with one or two common TS patterns and static OpenAPI/protobuf-like contracts where path/type names are explicit.

Best reference and limit: CodeQL's library models show why standard AST/data flow needs explicit API summaries; Knip's plugins show why framework entry discovery matters. Such models are expensive to maintain, and string equality does not establish a cross-language connection. [B05] [E08]

Gap and joined advantage: current host-file handling and entry metadata cover some blind spots but not a general registration/contract graph. Skyplate can use historical coupling to prioritize which missing relationship deserves an extractor, while preserving the actual registration site as evidence.

Feasibility and dependency/license: plain JSON and existing TS AST facilities initially, Apache-2.0 project code and existing Apache-2.0 TypeScript. Reuse MIT WASM parsers later. Do not execute config files, frameworks, annotation processors, generators, or user plugins. A schema parser dependency requires an exact license and package audit before adoption.

Effort M per narrow family, XL for broad coverage. Risk is convention churn and false matches. Gate models on resolved package/API identity and declared supported versions. Measure added-edge precision, supported-pattern coverage, and reduction of unexplained co-change on independently labeled registration examples. Never infer a contract solely because two strings or names match.

### 12. Boundary contracts, baselines, and measurable change reports

What to build: a read-only policy file supplied outside the analyzed project or explicitly chosen by the user, defining allowed module relations, protected interfaces, type/runtime rules, and exceptions with reasons. Compare two snapshots and report only new violations, changed interface consumers, introduced cycles, and shifted ownership/coverage. Support existing explicit project policies through safe parsers where practical.

Best reference and limit: dependency-cruiser, Import Linter, Tach, Nx, and ArchUnit demonstrate explicit rules and actionable checks. They typically bind to an ecosystem or build/project model. [E01] [E03] [E05] [E06] [E07]

Gap and joined advantage: Skyplate measures seams but does not preserve intended boundaries or compare a candidate change against them. It can attach both a static violation and the historical cost of that boundary, instead of treating every architecture warning equally.

Feasibility and dependency/license: no new runtime dependency for a small JSON policy format and graph checks, Apache-2.0 project code. No automatic writes to analyzed projects. An optional CI command can read two report/cache snapshots and return deterministic results.

Effort M. Risk is turning approximate facts into mandatory failures. Enforce only rules whose evidence tier supports them; show unknown coverage and offer findings rather than pass/fail for unsupported relations. Measure violation precision, baseline stability, stable entity matching across moves, and review time saved on actual changes. This is architectural intent, not a new universal health score.

### 13. Consumer cohorts and public-interface reduction

What to build: cluster outside consumers by which interface symbols they use; find disjoint API cohorts, facade bypasses, public APIs with unrelated consumers, and tests that couple to internals. Show a candidate split or facade and recompute the interface-as-used locally without editing files.

Best reference and limit: Knip gives reachability/unused correctness; Tach and explicit boundary tools provide public-interface constraints. Skyplate already measures internal-only exports, test-only reach, relays, and adapters. The new result is consumer structure and counterfactual membership, not another count of unused exports. [E08] [E07]

Gap and joined advantage: the existing seam gives per-symbol usage but does not group actual consumers and compare their change behavior. Adding caller cohorts and co-change can distinguish legitimate public extension points from an interface serving unrelated responsibilities.

Feasibility and dependency/license: existing sparse reference and commit tables; no new runtime dependency, Apache-2.0 project code. Respect entry and public-package protections and incomplete external-consumer knowledge.

Effort M. Risk is recommending API breaks because in-repository usage is sparse. Measure candidate precision on maintained libraries and private applications separately. Ask whether a proposed split reduces interface overlap and future change spread on historical replay. No automated removal recommendations for public APIs based solely on absent local uses.

### 14. Near-miss clones ranked by maintenance evidence

What to build: normalized token fingerprints at declaration/block granularity, candidate retrieval using a token index or bounded sketches, and exact token-overlap confirmation. Group clone families and rank them by repeated co-change, divergent fixes, complexity, and shared external consumers. Include a source-to-source diff.

Best reference and limit: SourcererCC supplies scalable token candidate generation; CodeScene already combines duplicated logic and temporal change. Embedding models can retrieve semantic similarity, but similarity is not equivalence and adds weights/runtime costs. [E11] [D03] [E12]

Gap and joined advantage: current hash duplicates miss copied functions with renamed variables and small edits. Skyplate can connect clone families to compiler-resolved callers and architecture seams, helping decide whether duplication is harmful or deliberate.

Feasibility and dependency/license: own token index using existing scanners/AST or MIT Tree-sitter grammars; no extra engine required, Apache-2.0 project code. Do not copy unreviewed research implementation code merely because the paper is public. No default embeddings.

Effort L. Risk is boilerplate floods and inappropriate abstraction recommendations. Evaluate clone-family precision, false positives from tests/generated code, recall on known near-miss edits, and maintainer usefulness of top-ranked families. Bound comparison count and candidate memory; never perform all-pairs block comparisons.

### 15. A report format that degrades gracefully past 100k files

What to build: a small summary table plus lazy classic-script shards for references, symbols, source, and text indexes; dictionary-encoded strings; typed numeric columns; per-shard bounds and checksums; and query-specific indexes. Offer detail-on-demand and visible unavailable/truncated states instead of parsing every reference at startup.

Best reference and limit: Arrow establishes columnar buffers; Parquet establishes compressed storage organization; DuckDB-WASM provides browser analytics but needs substantial loader/runtime adaptation for `file://`. Skyplate already has columnar tables and separated symbol/source payloads, so this is a scale extension, not a format rewrite for fashion. [F05] [F06] [F07]

Gap and joined advantage: the joined model's full detail can outgrow both Bun and browser memory. A summary plus local detail shards lets the report preserve the same facts and explanations as MCP without forcing them all into the initial heap.

Feasibility and dependency/license: first use existing classic-script loader and custom typed-array encoding, no new dependency, Apache-2.0 project code. Apache Arrow JS is Apache-2.0 and DuckDB-WASM MIT if an optional SQL mode is later justified, with their transitive notices audited. Parquet encoding does not by itself provide a no-fetch browser reader. [F05] [F07] [L04]

Effort L. Risk is encoded-data complexity, file-browser restrictions, and duplicated memory while decoding. Test actual Safari and Chrome double-click opening, startup heap, first interactive query, hover latency, and detail-query p95 on 100k/1M inventory fixtures. As a sizing example only, ten million references in seven uint32 columns take 280 MB before strings, indexes, call tables, decode buffers, or JS overhead; the overview must not eagerly load them.

### 16. Knowledge concentration around contracts, with temporal uncertainty

What to build: views that connect contributor history to specific interfaces and their consumers, distinguish recent maintainers from historical authors, show identity/coverage assumptions, and report sensitivity to the selected history window. Let a user inspect the supporting commits rather than trust a single truck-factor number.

Best reference and limit: CodeScene has knowledge islands and former-contributor risks; DOA has a published method and only partial empirical agreement on exact truck factor. Do not pitch this as measuring actual individual knowledge. [D04] [D05]

Gap and joined advantage: Skyplate has file ownership and truck factor but lacks recent-vs-historical contribution models at interface/function level. It can identify an API with many dependents and concentrated maintenance history, which is a useful documentation and handoff lead.

Feasibility and dependency/license: no new runtime dependency after symbol history; Apache-2.0 project code. Keep identity matching transparent and avoid external identity enrichment or personnel systems.

Effort M after boundary 7. Risk is misleading people metrics from squashes, shared authorship, reviews, and reorganizations. Measure the stability of results under time-window and author-alias changes, compare to maintainer review, and expose unknowns. The success criterion is useful handoff/documentation prioritization, never ranking developers.

### A sensible sequence

Build boundaries 1 and 2 together. Establish a replay corpus and strict output budgets before adding more graph relations. Implement reusable cached per-file facts from boundary 3 while adding the first Python/Go tranche of boundary 4. Then choose between callback flow and function history based on measured misses in real tasks. Test impact and architecture disagreement become much stronger once those foundations exist. SCIP import is a useful independent option for users who already have high-quality artifacts; it should not delay a no-build default.

Every experiment should record cold analysis time, warm refresh, peak RSS, persistent bytes, npm/runtime dependency growth, report payload size, browser startup/heap, query p50/p95, and a coverage breakdown. Run representative language and repository shapes, not just a larger copy of one TS project. At 1M files, distinguish all-file inventory completion from semantic coverage of own source. Avoid a headline number that hides skipped code.

## 4. Three moonshots

These are hypotheses, not claims that nobody has ever attempted them. I found no reviewed public system that delivers each complete behavior below under Skyplate's offline, no-build, static-report constraints. CodeScene and Arcan already combine behavioral and structural/impact ideas, so novelty must be established through implementation and evaluation, not a marketing assertion.

### A. A change contract that explains what it cannot see

Given a proposed change, produce a compact, inspectable change contract: the symbols whose semantics may change, their consumers, relevant tests, historical companions, and a machine-readable list of escape points where the analysis loses track. For example, an injected service might have an exact interface reference, three possible implementations, a registry site, observed test coverage for one environment, and an unmodeled runtime loader. The answer must preserve each distinction.

The unusual part is an explicit boundary on the answer's knowledge, across both static and temporal evidence. Most impact tools offer a ranked affected set; a useful contract would also say which claim requires which assumption, and what evidence would close an uncertainty. It is not a proof of program equivalence or completeness. In unrestricted dynamic code such a proof is not available.

Build from boundaries 2, 5, 6, 9, and 11. Default computation needs no model. Evaluate on seeded cross-file changes with hidden dynamic edges, measuring both missed affected behavior and whether the escape-point list honestly anticipated those misses. A good result reduces review effort without making "all clear" claims it cannot support. Effort XL; greatest risk is users reading an evidence contract as a safety certificate.

### B. Architecture experiments evaluated against history

Allow a user or agent to propose two module boundaries or interface designs in memory, then compute their used interfaces, coupling, caller cohesion, ownership concentration, and projected impact paths. Replay past changes against both partitions. Show which design would have reduced cross-module work and where the conclusion depends on the chosen history window or development regime.

This moves past a static modularity score or a smell list by making design alternatives testable against real work. CodeScene already makes history useful for refactoring; the proposed advance is a compiler-symbol-level, reproducible comparison of alternate boundaries with source-linked counterexamples and held-out future history. [D01] [D02]

Build from boundaries 7, 8, 12, and 13. Use temporal holdouts and do not imply that moving a graph node removes a real semantic dependency. Evaluate prediction of later change spread, blinded maintainer judgments, and stability across feature-specific windows. No source edits or required LLM calls. Effort XL; greatest risk is mistaking a past workload for the future architecture.

### C. A local map of cross-language contracts and forgotten companions

Join explicit contracts such as RPC/schema fields, route names, CLI commands, serializers, UI registrations, and tests across language boundaries. Use static declarations and exact mapping rules first, then show historical co-change as supporting or conflicting evidence. When a change touches one side of a contract, suggest the other side with the registration/schema line and supporting commits, not just a name match.

The plausible advantage is one portable model spanning places where per-language IDE indexes stop. Kythe and Glean show rich multi-language fact systems; Arcan demonstrates learned historical impact. The proposed distinction is a minimal local analyzer that explains explicit contract evidence and historical disagreement together, and exports that model as a double-click report. [A04] [A05] [E10]

Build from boundaries 4, 7, 9, and 11. Start with one RPC/schema family and one registration family, then evaluate held-out changes for forgotten companion detection. Compare exact rules, co-change alone, and their combination at fixed top-k and inspectable precision. Never invent cross-language edges from embedding similarity. Effort XL; greatest risks are generated code, versioned contracts, and coincidental co-change.

## 5. What not to build

1. **A universal bundled fleet of language servers or compiler indexers.** Native runtimes, Java/Go/Rust toolchains, proc macros, builds, compile databases, server caches, and heterogeneous licenses break the default deployment contract. A no-build syntax layer plus existing-index import is viable. Compiler-accurate C++ without compilation context is not. [A24] [A25] [A27] [A28] [A29] [A30]

2. **A mandatory embedding/LLM retrieval platform or free-form graph database interface.** Indexing and summaries would add models, runtime costs, storage, and faithfulness problems. Hosted retrieval fails the offline requirement. CodexGraph documents higher token costs and query loops; RepoGraph documents a larger graph performing worse. Start with search, exact symbols, bounded traversal, and progressive detail. A separately enabled local embedding reranker can be evaluated later, but should have to beat the same-budget lexical/graph baseline. [C07] [C09] [C11]

3. **A sound whole-program JS/TS call graph, or executing code to manufacture one during analysis.** Reflection, eval, runtime registration, arbitrary strings, and unknown libraries do not become solved because a tool emits edges. Jelly explicitly acknowledges unsoundness. Approximate interpretation and dynamic instrumentation are useful evaluation techniques but execute target code, so they are not default analyzer operations. [B03] [B04]

4. **A security scanner by adopting the CodeQL, Joern, or Semgrep engines.** Security flow analysis has a different model and maintenance burden. CodeQL CLI has separate terms, distinct from its open query libraries; Semgrep's cross-file engine is proprietary; Joern is a substantial separate CPG system. Learn from their summaries and evidence paths, but do not inherit their entire runtime and promise set. [B05] [B06] [B07] [N01]

5. **An unused-code delete button backed only by absent references.** Framework conventions, public APIs, missing dependencies, unknown members, entry points, and truncated data all affect reachability. Knip's plugin investment illustrates the size of that problem. Skyplate should improve discovery explanations and lower-bound warnings before making stronger deletion claims. [E08]

6. **Defect probabilities, debt dollars, safe-to-skip test guarantees, or developer productivity scores without calibration.** SZZ labels are heuristic; contribution history is not actual knowledge; static reachability misses runtime data effects. Useful risk leads and explicit evidence are already valuable. Cost or probability labels would require external ground truth, validation, and confidence calibration that are absent here. [D05] [D06] [D09] [D10]

7. **A mandatory Arrow/Parquet/DuckDB rewrite of every report.** The existing columnar model is already the right starting point. Binary formats do not erase decode cost, WASM heap copies, or `file://` loader restrictions. Add sharding and typed buffers first; reserve SQL for an independently justified optional capability. [F05] [F06] [F07]

8. **All-history, all-symbol, all-pairs mining.** Parsing every historical revision, comparing every clone pair, or retaining every co-change pair will defeat the minutes and memory budget. Use explicit query scope, commit windows, candidate generation, and visible caps. Strong findings can be selective without pretending absence is independence.

9. **A single blended "architecture health" score or automatic community-based file moves.** Modularity, churn, interface width, test reach, and ownership answer different questions. Combining them obscures tradeoffs. Leiden's guarantees concern graph connectivity, not software responsibility. Keep the measured axes and show counterexamples. [E09]

## 6. Verification limits and reproducibility

The source cache (raw responses, extracted text, URL metadata and errors) was kept outside the repository, since it is third-party text; the register in section 7 has every URL and date, so individual claims can be revisited. It contains no checkout source copied into an outbound query. Context7 was used to discover Tree-sitter, SCIP, TypeScript, Pyright, and DuckDB-WASM documentation. Primary source pages and repository files were then inspected for the consequential claims; a Context7 snippet was not treated as proof of current API compatibility.

Not verified:

- Bun compatibility, memory, package size, and runtime/grammar compatibility of proposed dependencies. Licenses were read for proposed core additions, but a complete lockfile-level transitive license audit was not performed.
- Quantitative precision/recall or latency for Skyplate's proposed next-language, callback, retrieval, history, or incremental layers. All success thresholds in section 3 are proposals.
- Current proprietary ranking/index internals or controlled same-task head-to-head results for Cursor, Devin/Windsurf, Augment, Amp, Claude Code, CodeScene, and Arcan. Documentation claims are attributed; none of their marketing performance numbers establish Skyplate's expected gains.
- A supported SCIP exporter from gopls, Pyright/basedpyright themselves, ty, clangd itself, Kotlin LSP, JDT LS itself, or SourceKit-LSP. Separate indexers are distinguished above. The rust-analyzer SCIP implementation was directly verified.
- A stable, redistributable, good-quality JS/WASM Leiden package. Graphology Louvain is a verified feasible starting candidate, not an endorsement that it produces correct module designs.
- The complete current Arcan smell catalog and severity formulas. The 2017 paper and current commercial positioning were verified; current feature completeness was not.
- Any claim that a reviewed 2024/2025 agent result beats the strongest November 2026 models and agents. The original benchmark and metric are retained to avoid that inference.

No implementation was changed or validated by tests. The useful next step is an evaluation fixture and prototype of boundaries 1 and 2, not a dependency installation or architecture rewrite.

## 7. Dated primary-source register

Dates below belong to the linked source, not to the whole product. A README's latest commit can be a small edit and does not date every feature it describes. `U` explicitly means publication and last-update dates were unavailable or unverified. Older primary sources remain useful for mechanisms, but their contemporary leadership or performance claims may be stale.

- **A01. SCIP overview and indexer ecosystem.** README updated 2026-06-15. Date verified through GitHub README commit history. Sources: [scip](https://raw.githubusercontent.com/scip-code/scip/main/README.md).

- **A02. SCIP schema and design rationale.** Schema updated 2026-07-06; design rationale U. The format transports facts; its design explicitly excludes being the query storage engine. Schema date verified through file commit history. Sources: [scip-proto](https://raw.githubusercontent.com/scip-code/scip/main/scip.proto); [scip-design](https://raw.githubusercontent.com/scip-code/scip/main/docs/DESIGN.md).

- **A03. LSIF overview.** U. Living Microsoft protocol documentation; ecosystem-wide deprecation was not inferred. Sources: [lsif](https://microsoft.github.io/language-server-protocol/overviews/lsif/overview/).

- **A04. Kythe overview.** U. Architecture and interchange mechanism, not an independently reproduced scale comparison. Sources: [kythe](https://kythe.io/docs/kythe-overview.html).

- **A05. Glean introduction.** U. Typed facts, Angle, Glass, LSP and per-language schemas. See F01 for a dated 2026 update. Sources: [glean](https://glean.software/docs/introduction/).

- **A06. GitHub introducing stack graphs.** Published 2021-12-09; page also records 2024-07-23. Older mechanism description; maintenance status comes from A07. Sources: [stack-graphs](https://github.blog/open-source/introducing-stack-graphs/).

- **A07. Stack graphs current README.** Updated 2025-09-09. Commit explicitly ends GitHub maintenance; dual MIT/Apache-2.0 license in README. Sources: [stack-repo](https://raw.githubusercontent.com/github/stack-graphs/main/README.md).

- **A08. Tree-sitter code navigation.** U. Defines tags captures and explains syntax-based navigation. Sources: [tree-tags](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html).

- **A09. Tree-sitter locals queries.** U. Documents lexical scope/definition/reference captures; not an inter-file type checker. Sources: [tree-locals](https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html).

- **A10. Python tagging query and Web Tree-sitter.** Python query U; web README updated 2026-08-25. Web README date verified through file commit history; documents WASM version compatibility. Sources: [python-wasm-readme](https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/tags.scm); [webtree](https://raw.githubusercontent.com/tree-sitter/tree-sitter/master/lib/binding_web/README.md).

- **A11. Universal Ctags.** README/manual U; GPL v2 text dated 1991. Older license text is the current linked distribution license, not a project release date. Sources: [ctags](https://raw.githubusercontent.com/universal-ctags/ctags/master/README.md); [ctags-refs](https://docs.ctags.io/en/latest/man/ctags.1.html); [ctags-license](https://raw.githubusercontent.com/universal-ctags/ctags/master/COPYING).

- **A12. ast-grep FAQ and license.** U. Structural matching reference. MIT license file read; no Bun benchmark performed. Sources: [astgrep](https://ast-grep.github.io/advanced/faq.html); [astgrep-license](https://raw.githubusercontent.com/ast-grep/ast-grep/main/LICENSE).

- **A13. Microsoft multilspy README.** U. Agent-facing normalized language-server client; README references its 2023 research origin. Sources: [multilspy](https://raw.githubusercontent.com/microsoft/multilspy/main/README.md).

- **A14. Serena and SolidLSP current licensing.** README updated 2026-10-26; license updated 2026-09-14. File dates verified separately. Current application GPL-3.0-or-later, separable SolidLSP MIT. Historical MIT cutoff is in the license. Sources: [serena](https://raw.githubusercontent.com/oraios/serena/main/README.md); [serena-license](https://raw.githubusercontent.com/oraios/serena/main/LICENSE).

- **A15. LSP specification 3.18.** U. Current spec as retrieved. Optional server/client capabilities, symbols, references, and hierarchy requests. Sources: [lsp318](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/).

- **A16. TypeScript native-port staging repository.** U; README describes completed 7.0 port and September 2026 archive. Staging status table contains older text. Current API evidence comes from A17, not that table. Sources: [tsnative](https://raw.githubusercontent.com/microsoft/typescript-go/main/README.md).

- **A17. Current TypeScript package exports and async API.** Package file updated 2026-11-09; async file updated 2026-11-06. Current main branch, not a claim that the installed package exports match it. Apache-2.0. Sources: [ts-api-package](https://raw.githubusercontent.com/microsoft/TypeScript/main/packages/typescript/package.json); [ts-async](https://raw.githubusercontent.com/microsoft/TypeScript/main/packages/typescript/src/api/async/api.ts); [typescript-license](https://raw.githubusercontent.com/microsoft/TypeScript/main/LICENSE.txt).

- **A18. Pyright language features, basedpyright editor improvements and licenses.** U. Living docs and license files. No formal batch exporter inferred from LSP support. Sources: [pyright-features](https://raw.githubusercontent.com/microsoft/pyright/main/docs/features.md); [basedpyright](https://docs.basedpyright.com/latest/benefits-over-pyright/language-server-improvements/); [based-pylance](https://docs.basedpyright.com/latest/benefits-over-pyright/pylance-features/); [pyright-license](https://raw.githubusercontent.com/microsoft/pyright/main/LICENSE.txt); [based-license](https://raw.githubusercontent.com/DetachHead/basedpyright/main/LICENSE.txt).

- **A19. Pyright references-provider source.** U. Primary implementation checked after documentation search; accumulates references across workspace walks. Sources: [pyright-refs-source](https://raw.githubusercontent.com/microsoft/pyright/main/packages/pyright-internal/src/languageService/referencesProvider.ts).

- **A20. scip-python README and license.** README updated 2025-09-05; license U. Uses the repository scip branch. Environment discovery, Pyright fork, indexing, MIT license. Sources: [scip-python3](https://raw.githubusercontent.com/sourcegraph/scip-python/scip/README.md); [scip-python-license](https://raw.githubusercontent.com/sourcegraph/scip-python/scip/LICENSE.txt).

- **A21. ty language-server features.** U. Current documentation lists definitions, implementations, workspace references and symbols. Export and call-graph completeness remain unverified. Sources: [ty-language](https://docs.astral.sh/ty/features/language-server/index.md).

- **A22. gopls navigation.** U. Explicitly excludes dynamic calls from call hierarchy and warns about selected build configurations. Sources: [gopls-nav](https://go.dev/gopls/features/navigation).

- **A23. scip-go README.** U. Go invocation and package-driver requirements. Sources: [scip-go](https://raw.githubusercontent.com/sourcegraph/scip-go/main/README.md).

- **A24. rust-analyzer SCIP implementation and non-Cargo project setup.** U. Direct primary code verifies SCIP CLI; project metadata requirements remain distinct from having no Cargo build. Sources: [rust-scip](https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/crates/rust-analyzer/src/cli/scip.rs); [rust-analyzer](https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/docs/book/src/non_cargo_based_projects.md).

- **A25. Eclipse JDT LS README.** U. Java runtime, build/project support and navigation. Sources: [jdtls](https://raw.githubusercontent.com/eclipse-jdtls/eclipse.jdt.ls/main/README.md).

- **A26. scip-java and Kotlin setup.** U. Build-tool integration; no no-build accuracy claim. Sources: [scip-java](https://raw.githubusercontent.com/sourcegraph/scip-java/main/README.md); [scip-java-start](https://raw.githubusercontent.com/scip-code/scip-java/main/docs/getting-started.md).

- **A27. JetBrains Kotlin LSP README.** Updated 2026-11-13. Date verified through README commit history. Alpha and partially closed-source status explicitly stated. Sources: [kotlin](https://raw.githubusercontent.com/Kotlin/kotlin-lsp/main/README.md).

- **A28. clangd compile commands and indexing.** U. Compiler-context requirements, fallback limitations, background shards and dynamic index. Sources: [clangd](https://clangd.llvm.org/design/compile-commands); [clangd-index](https://clangd.llvm.org/design/indexing).

- **A29. scip-clang README and license.** U. Compilation database required by the reviewed workflow; Apache-2.0 license file read. Sources: [scip-clang](https://raw.githubusercontent.com/sourcegraph/scip-clang/main/README.md); [scip-clang-license](https://raw.githubusercontent.com/sourcegraph/scip-clang/main/LICENSE).

- **A30. SourceKit-LSP README.** Updated 2026-06-20. Date verified through README commit history. Recent build/background indexing constraints. Sources: [swift-lsp](https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/main/README.md).

- **B01. Go CHA, RTA and VTA implementation documentation.** Package pages published 2026-10-10. Primary current implementation descriptions; underlying papers are 1995, 1996 and 2000. VTA marked experimental. Sources: [go-cha](https://pkg.go.dev/golang.org/x/tools/go/callgraph/cha); [go-rta](https://pkg.go.dev/golang.org/x/tools/go/callgraph/rta); [go-vta](https://pkg.go.dev/golang.org/x/tools/go/callgraph/vta).

- **B02. Field-based approximate JS call graphs.** README U; underlying ICSE paper 2013. Old research implementation; explicit limitations and EPL-2.0 badge. License reuse audit not completed. Sources: [approx](https://raw.githubusercontent.com/Persper/js-callgraph/master/README.md).

- **B03. Jelly README, package and license.** README updated 2026-02-19; package/license last update U. BSD-3-Clause; package version 0.13.0 as retrieved. No Bun execution or benchmark. Sources: [jelly2](https://raw.githubusercontent.com/cs-au-dk/jelly/master/README.md); [jelly-pkg](https://raw.githubusercontent.com/cs-au-dk/jelly/master/package.json); [jelly-license](https://raw.githubusercontent.com/cs-au-dk/jelly/master/LICENSE).

- **B04. Indirection-bounded call graph analysis.** ECOOP 2024. Older experimental evidence; 25 Node programs and bounded-analysis tradeoff, not a universal performance guarantee. Sources: [jelly-ecoop](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2024.10).

- **B05. CodeQL JS/TS data flow and library models.** U. Global/local flow, API access paths and extensible models; current docs label custom-model API beta. Sources: [codeql-call](https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/); [codeql-models](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/).

- **B06. Joern CPG and JavaScript frontend.** U. AST/control/dependence graph and JS type propagation documentation; no completeness guarantee inferred. Sources: [joern-cpg](https://docs.joern.io/code-property-graph/); [joern-js2](https://docs.joern.io/frontends/javascript/).

- **B07. Semgrep cross-file analysis.** U. Proprietary interfile analysis, CE distinction, and documented CommonJS limitation. Sources: [semgrep-limits](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro.md).

- **C01. Aider map documentation, design post and current implementation.** Design post 2023-10-22; current docs/code U. Old design post checked against current personalized graph-ranking source; token budget is documented. Sources: [aider](https://aider.chat/docs/repomap.html); [aider-blog](https://aider.chat/2023/10/22/repomap.html); [aider-code](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/repomap.py).

- **C02. Cursor search.** U. Current redirect target says local Instant Grep and no stored codebase embeddings. Vendor speed claim not reproduced. Sources: [cursor2](https://cursor.com/docs/agent/tools/search).

- **C03. Windsurf URL, now Devin Desktop context documentation.** U. Redirect observed in this research. RAG, pinning, and remote indexing are documented; proprietary internals unverified. Sources: [windsurf](https://docs.devin.ai/desktop/context-awareness/overview).

- **C04. Augment Context Engine MCP and SDK.** U. Product interfaces and indexed context service; no independent comparative benchmark inferred. Sources: [augment-mcp](https://docs.augmentcode.com/context-services/mcp/overview.md); [augment-sdk](https://docs.augmentcode.com/context-services/sdk/overview.md).

- **C05. Claude Code best practices.** U. Original Anthropic URL redirects to current Code Claude documentation; search/source inspection workflow guidance. Sources: [claude-search](https://code.claude.com/docs/en/best-practices).

- **C06. Amp tools.** Last modified 2026-11-05. Date is explicit in Markdown front matter. Search/inspection and subagents, not proof of all internal retrieval mechanisms. Sources: [amp-tools](https://ampcode.com/docs/markdown/tools).

- **C07. RepoGraph v2.** Revised 2025-03-18; original 2024-10-03. Paper version and date verified against arXiv history. Author-reported SWE-bench Lite and localization results. Sources: [repograph-v2](https://arxiv.org/html/2410.14684v2).

- **C08. LocAgent v2.** Revised 2025-04-29; original 2025-03-12. Metric and 274-task filtering matter; Acc@5/Acc@10 are not pass@1. Sources: [locagent-v2](https://arxiv.org/html/2503.09089v2).

- **C09. CodexGraph v3.** Revised 2026-07-27; original 2024-08-07. 2026 revision read directly; token costs and query-loop limitations included. Sources: [codexgraph-v3](https://arxiv.org/html/2408.03910v3).

- **C10. Agentless v2.** Revised 2024-10-29; original 2024-07-01. Older baseline. v1 full text was read, v2 abstract/history checked; no v2-specific numeric results claimed. Sources: [agentless-latest](https://arxiv.org/abs/2407.01489).

- **C11. GraphRAG v2.** Revised 2025-02-19; original 2024-04-24. General-domain global query-focused summarization, not evidence of code-patch success. Sources: [graphrag-v2](https://arxiv.org/html/2404.16130v2).

- **D01. CodeScene hotspots and X-Ray.** Versioned 7.3.0 docs; publication/update U. Current reachable versioned documentation. Function hotspots, complexity trends, coupling and ticket grouping. Sources: [codescene-current](https://docs.enterprise.codescene.io/versions/7.3.0/guides/technical/hotspots.html); [codescene-xray](https://docs.enterprise.codescene.io/versions/7.3.0/guides/technical/xray.html).

- **D02. CodeScene temporal coupling.** Coupling page U; X-Ray version 7.3.0 publication/update U. Some older domain pages report Documentation 1. X-Ray provides a versioned confirmation of mechanism. Sources: [codescene-coupling](https://codescene.io/docs/guides/technical/change-coupling.html); [codescene-xray](https://docs.enterprise.codescene.io/versions/7.3.0/guides/technical/xray.html).

- **D03. CodeScene code health.** U; older docs URL. Function/module smells and clone-like predictable co-change. Exact current scoring formula not verified. Sources: [codescene-health](https://codescene.io/docs/guides/technical/code-health.html).

- **D04. CodeScene knowledge distribution.** Versioned 7.3.0 docs; publication/update U. Deep contribution history and knowledge islands; actual human knowledge is not directly measured. Sources: [codescene-knowledge](https://docs.enterprise.codescene.io/versions/7.3.0/guides/social/knowledge-distribution.html).

- **D05. Avelino et al. degree-of-authorship truck factor study.** 2016-04-22; ICPC 2016. Older primary research. Reports survey agreement separately for main authors and truck-factor estimates. Sources: [doa](https://arxiv.org/abs/1604.06766).

- **D06. SZZ Unleashed paper and implementation.** Paper revised 2019-08-19; repository U. Old research. Heuristic introducing-commit labels and illustrative JIT prediction study. Sources: [szz-html](https://arxiv.org/html/1903.01742); [szz-unleashed](https://raw.githubusercontent.com/wogscpar/SZZUnleashed/master/README.md).

- **D07. Bazel query guide.** U. Declared build-target reverse dependencies. No proof of runtime-complete test impact. Sources: [bazel-query](https://bazel.build/query/guide).

- **D08. Jest CLI documentation.** U. findRelatedTests and changed-file selection; no static completeness guarantee inferred. Sources: [jest](https://jestjs.io/docs/cli).

- **D09. pytest-testmon.** U. Coverage-based executed-code dependencies, persistent data, need for an initial test run. Sources: [testmon2](https://www.testmon.org/).

- **D10. Launchable predictive selection and model inputs.** Pages say last modified 3 years ago; exact dates unavailable. Potentially stale service details. Historical failures, changes, test characteristics and confidence/duration selection. Sources: [launchable](https://help.launchableinc.com/features/predictive-test-selection/); [launchable-how](https://help.launchableinc.com/features/predictive-test-selection/how-launchable-selects-tests/).

- **E01. dependency-cruiser README.** U. Dependency rules, ecosystem resolution and cycle/orphan detection. Sources: [dependency-cruiser](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/README.md).

- **E02. Madge README.** U. Module graphs/cycles, configured resolution; not symbol semantics. Sources: [madge](https://raw.githubusercontent.com/pahen/madge/master/README.md).

- **E03. Nx affected and module boundaries.** Current pages show v24; publication/update U. Project graph and git-based affected workflows; current exact performance claims ignored. Sources: [nx-affected](https://nx.dev/docs/features/ci-features/affected); [nx-boundaries](https://nx.dev/docs/features/enforce-module-boundaries).

- **E04. Turborepo repository inspection.** U. Redirect to turborepo.dev observed; package/task graph distinction. Sources: [turbo](https://turborepo.dev/docs/crafting-your-repository/understanding-your-repository).

- **E05. ArchUnit user guide.** Current guide version 1.5.1; publication/update U. Bytecode import, architecture tests, layers and slices. Sources: [archunit](https://www.archunit.org/userguide/html/000_Index.html).

- **E06. Import Linter contract types.** U. Forbidden, protected, layers, independence and acyclic siblings. Sources: [import-linter3](https://import-linter.readthedocs.io/en/stable/contract_types/).

- **E07. Tach README.** U. Python boundaries and public interfaces, Rust implementation. Sources: [tach](https://raw.githubusercontent.com/gauge-sh/tach/main/README.md).

- **E08. Knip plugins, entry files and license.** Docs U; license copyright through 2026. ISC. Roots/convention discovery as the unused-code correctness problem. Sources: [knip](https://knip.dev/explanations/plugins); [knip-entry](https://knip.dev/explanations/entry-files); [knip-license](https://raw.githubusercontent.com/webpro-nl/knip/main/LICENSE).

- **E09. Traag et al. Louvain-to-Leiden paper.** Published 2019-03-26. Older algorithmic evidence; graph connectedness does not establish software design quality. Sources: [leiden-paper](https://www.nature.com/articles/s41598-019-41695-z?error=cookies_not_supported&code=657e65fe-df8d-4e27-8914-ab1cc34a170c).

- **E10. Arcan original paper repository and current commercial site.** Original ICSAW paper 2017-04; commercial site U. Institutional abstract verified; current impact-model positioning verified. Current smell catalog/formulas unverified. Sources: [arcan-paper-repo](https://boa.unimib.it/handle/10281/155470); [arcan-root](https://www.arcan.tech/).

- **E11. SourcererCC paper and repository.** Paper 2015-12-20; ICSE 2016; repository U. Older token-index/filtering scale mechanism, not a current leaderboard claim. Sources: [clone-paper-details](https://arxiv.org/html/1512.06448); [sourcerercc2](https://raw.githubusercontent.com/Mondego/SourcererCC/master/README.md).

- **E12. GraphCodeBERT.** Latest arXiv revision 2021-09-13; ICLR 2021. Old learned representation/clone-detection evidence. No current model leadership claimed. Sources: [graphcodebert](https://arxiv.org/abs/2009.08366).

- **F01. Glean release 0.2.** Published 2026-02-06. Current dated primary update; GHC/C++/RocksDB, generic LSP, and compiler-oriented C++ example. Sources: [glean-release](https://glean.software/blog/release-0-2/).

- **F02. Glean incrementality design and engineering post.** Engineering post 2022-12-01; implementation docs U. Older mechanisms with current implementation docs; numeric overheads are Glean-specific. Sources: [glean-increment2](https://glean.software/blog/incremental/); [glean-impl](https://glean.software/docs/implementation/incrementality/).

- **F03. Salsa overview and repository.** U. Tracked inputs, memoization and dependency-driven recomputation. Sources: [salsa](https://salsa-rs.github.io/salsa/overview.html); [salsa-repo](https://raw.githubusercontent.com/salsa-rs/salsa/master/README.md).

- **F04. Watchman subscriptions.** U. Subscriptions, clock/fresh-instance behavior and change tracking. Sources: [watchman2](https://meta.github.io/watchman/docs/cmd/subscribe).

- **F05. Apache Arrow columnar format and license.** Current format docs version 26.0.1; publication/update U. Apache-2.0 distribution with additional component notices; full transitive audit not performed. Sources: [arrow](https://arrow.apache.org/docs/format/Columnar.html); [arrow-license](https://raw.githubusercontent.com/apache/arrow/main/LICENSE.txt).

- **F06. Apache Parquet file format.** U. Column-oriented storage, page/row-group organization; not a browser loader. Sources: [parquet](https://parquet.apache.org/docs/file-format/).

- **F07. DuckDB-WASM current README, package, and launch explanation.** README/package U; launch post 2021-10-29. Current package metadata and README read; older post used only for mechanism context. File-buffer API checked via Context7 primary-source pointers. Sources: [duckdb-readme](https://raw.githubusercontent.com/duckdb/duckdb-wasm/main/README.md); [duckdb-package](https://raw.githubusercontent.com/duckdb/duckdb-wasm/main/packages/duckdb-wasm/package.json); [duckdb3](https://duckdb.org/2021/10/29/duckdb-wasm).

- **L01. Tree-sitter runtime and seven grammar license files.** All file update dates U. MIT texts read. License conclusions apply to reviewed upstream files, not an unbuilt bundle or arbitrary grammar fork. Sources: [tree-license](https://raw.githubusercontent.com/tree-sitter/tree-sitter/master/LICENSE); [webtree-license](https://raw.githubusercontent.com/tree-sitter/tree-sitter/master/lib/binding_web/package.json); [grammars-license-python](https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/LICENSE); [grammars-license-go](https://raw.githubusercontent.com/tree-sitter/tree-sitter-go/master/LICENSE); [grammars-license-rust](https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/LICENSE); [grammars-license-java](https://raw.githubusercontent.com/tree-sitter/tree-sitter-java/master/LICENSE); [grammars-license-kotlin](https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/main/LICENSE); [grammars-license-c](https://raw.githubusercontent.com/tree-sitter/tree-sitter-c/master/LICENSE); [grammars-license-cpp](https://raw.githubusercontent.com/tree-sitter/tree-sitter-cpp/master/LICENSE).

- **L02. Graphology and Louvain package metadata/licenses.** U. MIT verified; transitive dependency list observed. Runtime cost not benchmarked. Sources: [graphology-license](https://raw.githubusercontent.com/graphology/graphology/master/LICENSE.txt); [louvain-license](https://raw.githubusercontent.com/graphology/graphology/master/src/communities-louvain/package.json); [Louvain implementation](https://raw.githubusercontent.com/graphology/graphology/master/src/communities-louvain/README.md).

- **L03. SCIP and Protobuf-ES licenses.** U. Both Apache-2.0. Importer code generation is feasible in principle; exact output/runtime package not tested. Sources: [scip-license](https://raw.githubusercontent.com/scip-code/scip/main/LICENSE); [proto-license](https://raw.githubusercontent.com/bufbuild/protobuf-es/main/LICENSE).

- **L04. DuckDB-WASM license.** U; copyright 2018-2025. MIT license text read. All bundled transitive notices still require audit. Sources: [duckdb-license](https://raw.githubusercontent.com/duckdb/duckdb-wasm/main/LICENSE).

- **N01. GitHub CodeQL CLI terms.** U. Separate use/license restrictions; open query-library licensing must not be confused with CLI redistribution rights. Sources: [codeql-cli-license](https://raw.githubusercontent.com/github/codeql-cli-binaries/main/LICENSE.md).

[A01]: https://raw.githubusercontent.com/scip-code/scip/main/README.md
[A02]: https://raw.githubusercontent.com/scip-code/scip/main/scip.proto
[A03]: https://microsoft.github.io/language-server-protocol/overviews/lsif/overview/
[A04]: https://kythe.io/docs/kythe-overview.html
[A05]: https://glean.software/docs/introduction/
[A06]: https://github.blog/open-source/introducing-stack-graphs/
[A07]: https://raw.githubusercontent.com/github/stack-graphs/main/README.md
[A08]: https://tree-sitter.github.io/tree-sitter/4-code-navigation.html
[A09]: https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html
[A10]: https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/tags.scm
[A11]: https://raw.githubusercontent.com/universal-ctags/ctags/master/README.md
[A12]: https://ast-grep.github.io/advanced/faq.html
[A13]: https://raw.githubusercontent.com/microsoft/multilspy/main/README.md
[A14]: https://raw.githubusercontent.com/oraios/serena/main/README.md
[A15]: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/
[A16]: https://raw.githubusercontent.com/microsoft/typescript-go/main/README.md
[A17]: https://raw.githubusercontent.com/microsoft/TypeScript/main/packages/typescript/package.json
[A18]: https://raw.githubusercontent.com/microsoft/pyright/main/docs/features.md
[A19]: https://raw.githubusercontent.com/microsoft/pyright/main/packages/pyright-internal/src/languageService/referencesProvider.ts
[A20]: https://raw.githubusercontent.com/sourcegraph/scip-python/scip/README.md
[A21]: https://docs.astral.sh/ty/features/language-server/index.md
[A22]: https://go.dev/gopls/features/navigation
[A23]: https://raw.githubusercontent.com/sourcegraph/scip-go/main/README.md
[A24]: https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/crates/rust-analyzer/src/cli/scip.rs
[A25]: https://raw.githubusercontent.com/eclipse-jdtls/eclipse.jdt.ls/main/README.md
[A26]: https://raw.githubusercontent.com/sourcegraph/scip-java/main/README.md
[A27]: https://raw.githubusercontent.com/Kotlin/kotlin-lsp/main/README.md
[A28]: https://clangd.llvm.org/design/compile-commands
[A29]: https://raw.githubusercontent.com/sourcegraph/scip-clang/main/README.md
[A30]: https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/main/README.md
[B01]: https://pkg.go.dev/golang.org/x/tools/go/callgraph/cha
[B02]: https://raw.githubusercontent.com/Persper/js-callgraph/master/README.md
[B03]: https://raw.githubusercontent.com/cs-au-dk/jelly/master/README.md
[B04]: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2024.10
[B05]: https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/
[B06]: https://docs.joern.io/code-property-graph/
[B07]: https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro.md
[C01]: https://aider.chat/docs/repomap.html
[C02]: https://cursor.com/docs/agent/tools/search
[C03]: https://docs.devin.ai/desktop/context-awareness/overview
[C04]: https://docs.augmentcode.com/context-services/mcp/overview.md
[C05]: https://code.claude.com/docs/en/best-practices
[C06]: https://ampcode.com/docs/markdown/tools
[C07]: https://arxiv.org/html/2410.14684v2
[C08]: https://arxiv.org/html/2503.09089v2
[C09]: https://arxiv.org/html/2408.03910v3
[C10]: https://arxiv.org/abs/2407.01489
[C11]: https://arxiv.org/html/2404.16130v2
[D01]: https://docs.enterprise.codescene.io/versions/7.3.0/guides/technical/hotspots.html
[D02]: https://codescene.io/docs/guides/technical/change-coupling.html
[D03]: https://codescene.io/docs/guides/technical/code-health.html
[D04]: https://docs.enterprise.codescene.io/versions/7.3.0/guides/social/knowledge-distribution.html
[D05]: https://arxiv.org/abs/1604.06766
[D06]: https://arxiv.org/html/1903.01742
[D07]: https://bazel.build/query/guide
[D08]: https://jestjs.io/docs/cli
[D09]: https://www.testmon.org/
[D10]: https://help.launchableinc.com/features/predictive-test-selection/
[E01]: https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/README.md
[E02]: https://raw.githubusercontent.com/pahen/madge/master/README.md
[E03]: https://nx.dev/docs/features/ci-features/affected
[E04]: https://turborepo.dev/docs/crafting-your-repository/understanding-your-repository
[E05]: https://www.archunit.org/userguide/html/000_Index.html
[E06]: https://import-linter.readthedocs.io/en/stable/contract_types/
[E07]: https://raw.githubusercontent.com/gauge-sh/tach/main/README.md
[E08]: https://knip.dev/explanations/plugins
[E09]: https://www.nature.com/articles/s41598-019-41695-z?error=cookies_not_supported&code=657e65fe-df8d-4e27-8914-ab1cc34a170c
[E10]: https://boa.unimib.it/handle/10281/155470
[E11]: https://arxiv.org/html/1512.06448
[E12]: https://arxiv.org/abs/2009.08366
[F01]: https://glean.software/blog/release-0-2/
[F02]: https://glean.software/blog/incremental/
[F03]: https://salsa-rs.github.io/salsa/overview.html
[F04]: https://meta.github.io/watchman/docs/cmd/subscribe
[F05]: https://arrow.apache.org/docs/format/Columnar.html
[F06]: https://parquet.apache.org/docs/file-format/
[F07]: https://raw.githubusercontent.com/duckdb/duckdb-wasm/main/README.md
[L01]: https://raw.githubusercontent.com/tree-sitter/tree-sitter/master/LICENSE
[L02]: https://raw.githubusercontent.com/graphology/graphology/master/LICENSE.txt
[L03]: https://raw.githubusercontent.com/scip-code/scip/main/LICENSE
[L04]: https://raw.githubusercontent.com/duckdb/duckdb-wasm/main/LICENSE
[N01]: https://raw.githubusercontent.com/github/codeql-cli-binaries/main/LICENSE.md
