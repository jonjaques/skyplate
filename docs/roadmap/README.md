# Skyplate roadmap

Where Skyplate's code intelligence stands, what to build next and in what order, and how we know.
Revised 2026-11-17 for 0.3.0.

| File | What it holds |
| --- | --- |
| [defects.md](defects.md) | Answers Skyplate gives today that are wrong or look more complete than they are, each with a repro, a fix direction and a test that says it is fixed |
| [enhancements.md](enhancements.md) | Capabilities it does not have yet, ranked, each with the measure that says it worked |
| [research/](research/) | The dated studies behind both: [TypeScript symbols](research/typescript-symbols.md), [structure and history](research/structure-and-history.md), [prior art](research/prior-art.md), [agent adoption](research/agent-adoption.md) |
| [evals/](../../evals/) | The scripts, fixtures and results those studies produced, so every number here can be rerun |

## What we are betting on

1. **Right first, then complete, then fast.** What Skyplate records, it records correctly: no
   false reference in 2,766 checked against an independent language service, no wrong edge in
   140 checked by hand. What it does not record, it does not announce, and nearly every serious
   defect is an answer that looks complete and is a lower bound. An agent acts on those, so
   saying how much an answer knows ([E1](enhancements.md#e1)) comes before new reach.
2. **The joined model is the edge.** Compiler-accurate symbols, an import graph, git behavior
   and module seams under one file id, in memory. The surveyed tools each have one or two of
   these; the most valuable next steps (context under a budget, change impact with reasons,
   evidence on every answer) need the join and no new dependency.
3. **An agent reaches for a tool that answers the moment it is in.** About to search a large
   repository, about to rename, done editing. The first answer has to be fast and small and
   point to the next question, and adoption is measured by what agents do, not what they say.
4. **Every number is rerunnable, and private repositories can still teach us.** Each claim in
   these files traces to [evals/](../../evals/). On code that cannot be shared, `skyplate bench`
   returns an anonymous measurement ([docs/benchmark.md](../benchmark.md)).

## Where it stands

Measured 2026-11-16 on 0.2.0 (commit `f0f874f`), single runs on one laptop. Each study says what
its numbers do not establish.

**TypeScript and JavaScript references**, against `LanguageService.findReferences` for the
declarations Skyplate records ([evals/typescript/](../../evals/typescript/)):

| Corpus | Symbols | References found / false / missed | Precision | Recall |
| --- | ---: | --- | ---: | ---: |
| Skyplate, dependencies installed | 26 | 375 / 0 / 0 | 100% | 100% |
| TanStack Query, not installed | 18 | 1,447 / 0 / 0 | 100% | 100% |
| Express, installed | 16 | 909 / 0 / 1 | 100% | 99.89% |
| p-limit, installed | 12 | 35 / 0 / 0 | 100% | 100% |
| **Total** | **72** | **2,766 / 0 / 1** | **100%** | **99.96%** |

The denominator is only what Skyplate extracts: members of type and object literals are not
symbols ([T1](defects.md#t1)). Without `node_modules`, the same Skyplate symbols kept 38% of
their references, with no warning ([T7](defects.md#t7)).

**Imports**, every extracted statement, 20 resolved edges per repository checked by hand
([evals/structure/](../../evals/structure/)):

| Repository | Language | Statements | Internal | External | Unresolved | Checked |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Requests | Python | 325 | 119 | 206 | 0 | 20 / 20 |
| chi | Go | 389 | 59 | 330 | 0 | 20 / 20 |
| ripgrep | Rust | 1,136 | 593 | 445 | 98 | 20 / 20 |
| JUnit | Java | 18,006 | 9,893 | 8,113 | 0 | 20 / 20 |
| curl | C | 4,246 | 3,227 | 1,017 | 2 | 20 / 20 |
| Rails | Ruby | 6,883 | 6,158 | 724 | 1 | 20 / 20 |
| Kubernetes | Go | 113,595 | 74,372 | 39,223 | 0 | 20 / 20 |

Twenty of twenty bounds accuracy at roughly 84% to 100%; it says the resolver is not badly
wrong, not that it is nearly perfect, and nothing about recall. Zero unresolved is partly an
artifact ([S2](defects.md#s2), [S6](defects.md#s6)).

**Metrics, graph and history.** Keyword complexity ranks Requests' production files like
Radon's parser does (Spearman 0.965) but not its tests (0.546). PageRank, cycles and instability
matched a hand-computed fixture exactly, and `analyzeGraph` took 86 ms on a million-file chain.
Churn, ownership, coupling, hotspots and truck factor matched hand derivations on a twelve-commit
history. The arithmetic is right; the inputs are noisy ([E9](enhancements.md#e9)).

**Scale, Kubernetes** (32,005 files, 7.5 M lines; symbols and embedded source off):

| Phase (ms) | No git | Default git, 18,070 commits |
| --- | ---: | ---: |
| Walk, detect, measure | 2,001 | 1,975 |
| Imports, manifests, entries, graph | 425 | 468 |
| Layout | 5,227 | 5,052 |
| Git | off | 507,594 |
| Whole CLI | 7.8 s | 509 s |
| Peak memory | 1.23 GiB | 2.48 GiB |

On 0.3.0's MCP server, a cold depth-50 clone answers `map_codebase` in 2.1 s while history runs
([evals/first-answer/](../../evals/first-answer/)).

**Agent adoption**, one headless session per prompt on vitejs/vite, eight task prompts and two
controls that should not use Skyplate ([evals/adoption/](../../evals/adoption/)):

| Agent | Run | Used on tasks (of 8) | Within first three calls | Used on controls (of 2) |
| --- | --- | ---: | ---: | ---: |
| Codex | 0.2.0 | 0 | 0 | 0 |
| Codex | 0.3.0 surface | 0 | 0 | 0 |
| Codex | 0.3.0 surface + `AGENTS.md`-style instruction | 8 | 8 | 0 |
| Claude Code | 0.2.0 | 3 | 2 | 0 |
| Claude Code | 0.3.0 surface | 6 | 5 | 0 |

The rewording moved Claude Code and did nothing for Codex; one five-line instruction took Codex
to all eight. That instruction is in the project README. These are counts from one pass, not
rates.

## 0.3.0

### On the release branch

- **Task tools for agents.** `map_codebase` (size up the tree), `locate_code` (where a concept
  lives, with evidence) and `change_impact` (blast radius before an edit; with
  `working_tree: true`, a review of the uncommitted diff), registered first. Instructions,
  descriptions and the three skills lead with the moment, not the data.
- **Strict arguments.** An argument a tool does not take is an error that names the ones it
  does ([M1](defects.md#m1)).
- **A first answer in two steps** ([E2](enhancements.md#e2), first step): the structure pass
  answers while history and symbols run.
- **`skyplate bench`** and the `benchmark` tool: an anonymous measurement of one analysis, safe
  to hand back from a private repository ([docs/benchmark.md](../benchmark.md)).
- **Fixed:** [T3](defects.md#t3), [T5](defects.md#t5), [M1](defects.md#m1),
  [M2](defects.md#m2). **Mitigated:** [M3](defects.md#m3).
- **The studies and their evals** in the repository, so the numbers above can be rerun.

### Proposed before tagging

Small, and each removes a case where an agent acts on a wrong answer or cannot finish a list:

| | Item | Size |
| --- | --- | --- |
| [T7](defects.md#t7) | Check that declared packages resolve, not that some ancestor has `node_modules` | S |
| [S3](defects.md#s3) | Python `if TYPE_CHECKING` imports become type-only edges | M |
| [S2](defects.md#s2) | Mark projected package edges with the members they stand for | S |
| [M4](defects.md#m4) | `offset` on `history`, `dependencies`, `graph` and cycle members | S |
| [T9](defects.md#t9) | Complexity stops at nested function boundaries | S |
| [S8](defects.md#s8) | Extensionless local includes resolve in the repository | S |
| [E12](enhancements.md#e12) | An issue form for sending a benchmark back | S |
| [E2](enhancements.md#e2) step 1 | Compute the layout only when a report is written | S |

Then, on the release candidate: rerun the adoption eval (adding Claude Code with the
instruction, and one after-edit review task), the TypeScript and structure evals, the
first-answer timing and the benchmark verification; compare each with its 2026-11-16 results;
bump `version`; pack, install and smoke-test the tarball (CI does this on every PR).

## After 0.3.0, in order

1. **[E1](enhancements.md#e1), answers that say how much they know,** with E2's next two steps.
   This changes what every existing answer is worth, and closes T4, T6 and the rest of T7, S2
   and S6.
2. **The recall holes the compiler and manifests already let us close:**
   [T1](defects.md#t1), [T2](defects.md#t2), [T8](defects.md#t8), [S4](defects.md#s4) with
   [S5](defects.md#s5) (one Cargo adapter), [S6](defects.md#s6), [S9](defects.md#s9),
   [S1](defects.md#s1) for Maven. None needs a new idea.
3. **[E3](enhancements.md#e3) and [E4](enhancements.md#e4)** on top of `locate_code` and
   `change_impact`, and **[E5](enhancements.md#e5)**, because exact-string prompts are where
   agents still prefer grep.
4. **[E6](enhancements.md#e6) for Python and Go,** with E2's cache, since parsing is what the
   cache amortizes.
5. **[E7](enhancements.md#e7) or [E8](enhancements.md#e8),** chosen by which misses show up most
   in real tasks and in benchmarks returned from private repositories.

[E9](enhancements.md#e9) to [E11](enhancements.md#e11) fit wherever there is room; each is M.

## What not to build

- **A bundled fleet of language servers or compiler indexers.** Toolchains, builds and licenses
  break "any directory, no build step".
- **A required embedding or LLM retrieval layer, or a free-form graph query language.** The
  published gains over search plus bounded graph walks are not established; the costs are.
- **A sound JavaScript call graph, or running code to get one.**
- **A delete button backed only by missing references.**
- **Defect probabilities, debt in dollars, safe-to-skip test sets, developer scores.**
- **One blended architecture score, or file moves chosen by community detection.**
- **Mining all history for all symbols, or all clone pairs.**

## How we measure

| Eval | Answers | Rerun |
| --- | --- | --- |
| [adoption](../../evals/adoption/) | Do agents call Skyplate unprompted, on which prompts, and are the answers right | before a release that changes instructions, descriptions, skills or tool names |
| [typescript](../../evals/typescript/) | Are references, calls and unused verdicts right against an independent language service, and what do the probes and injected faults do | before a release that touches `src/core/ts` or `src/shared/calls.ts` |
| [structure](../../evals/structure/) | Are imports, entries, dependencies, metrics and history right on seven languages | before a release that touches imports, manifests, entries, metrics or git |
| [first-answer](../../evals/first-answer/) | How long a cold server takes to answer on a large repository | before a release that touches the workspace or the pipeline |
| [benchmark](../../evals/benchmark/) | Does `skyplate bench` stay anonymous and valid, and does a skeleton rebuild | before a release that touches `src/core/bench` or adds a tool or argument |

Not yet measured: a repository with full history, a real 100k or million-file repository, an
installed TanStack Query (pnpm rejected its workspace file), a native unused-dependency tool,
a Go or JVM build, a second parser-based complexity comparison, more than one pass per adoption
prompt, a second adoption repository (and one slow enough that the first answer matters), and
the viewer in a browser.

## Keeping this plan

- **IDs are stable.** A fixed defect keeps its ID, moves to the Fixed section with the version
  that fixed it, and its row leaves the table above. A new defect takes the next number in its
  group (T for TypeScript and JavaScript, S for structure and history, M for MCP answers).
- **Research files are dated records.** Correct a factual error in place; otherwise a new study
  is a new file, and this README carries the current numbers with their date.
- **A number here has an eval behind it.** If a change moves one, rerun the eval, commit the
  new results beside the old under a new date, and update the table.
