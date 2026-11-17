# Known defects

Answers Skyplate gives today that are wrong, or that look complete when they are not. New
capabilities are in [enhancements.md](enhancements.md); the order of work is in
[README.md](README.md).

**Severity** is the chance that an agent or a reader makes a wrong decision from the answer:
deletes live code, misses a caller, trusts a cycle that never runs. It is not a security
rating. **Size** is engineering size: S is days, M one to three weeks, L more. **Status** is
`open`, `proposed for 0.3.0`, `mitigated` (the answer now warns, the cause remains) or
`fixed in 0.3.0`.

Each defect has a minimal repro. Most were found by the November 2026 measurements in
[research/](research/), and their fixtures live under [evals/](../../evals/). Line numbers are
at commit `f0f874f` (0.2.0), where they were found; the research write-ups link each one. IDs
are stable: a fixed defect keeps its number and moves to [Fixed](#fixed).

## At a glance

| ID | Defect | Severity | Size | Status |
| --- | --- | --- | --- | --- |
| [T1](#t1) | Members of type literals and object literals are never symbols | high | M | open |
| [T2](#t2) | A Vue, Svelte or Astro import through a barrel or alias does not protect the export | high | M | open |
| [T4](#t4) | A failed tsconfig project keeps ordinary "unused" verdicts | high | M | open |
| [T6](#t6) | Capped reference locations change seam and unused classifications | medium | M | open |
| [T7](#t7) | Any ancestor `node_modules` counts as "dependencies installed" | high | S | proposed for 0.3.0 |
| [T8](#t8) | `this.method()` on a JavaScript prototype method is not bound | medium | M | open |
| [T9](#t9) | Decisions in a nested function count toward the enclosing one | medium | S | proposed for 0.3.0 |
| [S1](#s1) | Declared dependencies and imported names do not join outside npm | high | L (M for Maven) | open |
| [S2](#s2) | A package import is projected onto at most 17 files, unmarked | high | S to mark, L to fix | proposed for 0.3.0 (marking) |
| [S3](#s3) | Python `if TYPE_CHECKING` imports are runtime edges | high | M | proposed for 0.3.0 |
| [S4](#s4) | A Cargo `[[bin]] path` is ignored when choosing the crate root | high | M | open |
| [S5](#s5) | Native entry points outside JavaScript are not discovered | high | M per ecosystem | open |
| [S6](#s6) | Python namespace packages and imported submodules lose internal edges | high | M | open |
| [S7](#s7) | Text detected as Shift_JIS is decoded as Windows-1252 | medium | S to M | open |
| [S8](#s8) | An extensionless local `#include <header>` is called a system header | medium | S | proposed for 0.3.0 |
| [S9](#s9) | Rust uses written `crate_name::item` without a `use` are not seen | medium | M | open |
| [M3](#m3) | Owners in a shallow clone are the snapshot's author | medium | S | mitigated |

Fixed in 0.3.0: [T3](#t3), [T5](#t5), [M1](#m1), [M2](#m2), [M4](#m4).

"Proposed for 0.3.0" is a recommendation: these are small, and each is a case where an agent
acts on a wrong answer. The release scope is in [README.md](README.md#030).

## TypeScript and JavaScript

Found by comparing Skyplate with an independent TypeScript language service and by
one-construct probes ([research/typescript-symbols.md](research/typescript-symbols.md),
[evals/typescript/](../../evals/typescript/)). What Skyplate records there is right: 2,766 of
2,767 references found, none false. These defects are about what it does not record and does
not say it did not record.

### T1

**Members of type literals and object literals are never symbols.** Severity high for rename,
signature and move work. Size M. Open.

- **What an agent sees.** `type P = { label: string; run(): void }` has no `P.label` or `P.run`,
  and `const o = { m() {} }` has no `o.m`. Their uses and calls vanish from every answer, and
  the unresolved count stays 0, so nothing says they are missing. The interface equivalents
  work.
- **Where.** `src/core/ts/declarations.ts:188` descends interface members but `:193` adds only
  the type alias; `:251` does not descend ordinary object literals; `src/core/ts/resolve.ts:266`
  drops checker declarations missing from the store.
- **Repro.** `type P = { label: string; run(): void }; function C(p: P) { return p.label };
  const o = { m() {} }; o.m();` Probes [`object.ts`](../../evals/typescript/fixtures/probes/object.ts) and
  [`jsx.tsx`](../../evals/typescript/fixtures/probes/jsx.tsx).
- **Fix.** Traverse type literals and object literals with explicit parents, keeping binder
  handles for member identity, including callable members of function-valued properties.
- **Done when.** Paired interface/type-alias and class/object fixtures give the same member
  recall, and a sample of at least 100 real members holds 99% precision and recall.

### T2

**A Vue, Svelte or Astro file that imports through `export *`, a renamed export or an exported
alias does not protect the export.** Severity high for delete advice. Size M. Open.

- **What an agent sees.** Live code listed as an unused export, and the private file that holds
  it can be called unreferenced.
- **Where.** `src/core/ts/hosts.ts:23` documents the missing forms; `:79` and `:85` match by
  declaration name, so an export under another name is lost.
- **Repro.** `a.ts` exports `live`, `barrel.ts` re-exports it with `export *`, and a `.vue` file
  imports `live` from the barrel and calls it. Probes [`host-value.ts`](../../evals/typescript/fixtures/probes/host-value.ts),
  [`host-rename-value.ts`](../../evals/typescript/fixtures/probes/host-rename-value.ts) and
  [`host-local-alias.ts`](../../evals/typescript/fixtures/probes/host-local-alias.ts) with their host importers.
- **Fix.** Keep the compiler's exported-name to target-symbol map per module, star expansion and
  default aliases included, and use it for host matching and public API reachability.
- **Done when.** Every direct, default, alias, star and namespace host fixture is protected
  through several barrel levels, with no false dead export.

### T4

**When one tsconfig project's reference pass fails, its exports keep ordinary "unused"
verdicts.** Severity high for delete advice. Size M. Open. Part of
[E1](enhancements.md#e1).

- **What an agent sees.** Delete advice from a pass that never ran. Only a report-level warning
  says anything went wrong; no symbol, project or answer carries it.
- **Where.** `src/core/ts/index.ts:194` catches the batch failure and `:174` still builds the
  tables; `src/core/ts/tables.ts:98` sets unused flags whether or not the pass completed;
  projects record only config, files and time (`src/shared/schema.ts:696`).
- **Repro.** Two one-file projects, each with an exported function and an export that calls it,
  and an exception injected into one project's checker. Result: four unused exports and zero
  unresolved. Fixture [`failures/`](../../evals/typescript/fixtures/failures/), script `faults.ts`.
- **Fix.** Carry pass, project and file completion into the schema and the answers. A negative
  verdict needs complete coverage of the possible consumers; positive edges survive with their
  provenance.
- **Done when.** The injected failure keeps the healthy project's results and yields no
  confident unused verdict for the failed one.

### T6

**When stored reference locations are capped, seam and unused classifications are computed from
the capped rows.** Severity medium, high for seam and delete advice. Size M. Open.

- **What an agent sees.** A module's interface shrinks, and "used in own file" becomes
  "unreferenced", only because locations were truncated. Totals are right; the
  classifications are not.
- **Where.** Totals are computed before the cap (`src/core/ts/tables.ts:45`), but
  `src/mcp/query.ts:1485` derives interface use, and `src/shared/calls.ts:274` residual use,
  from the retained rows.
- **Repro.** `lib/a.ts` exports `api` and `consumer.ts` calls it: `seam lib` at a reference cap
  of 100 and of 0 gives an interface of 1 and 0. An exported self-recursive function flips from
  used-in-own-file to unreferenced at the same caps. Fixtures [`seam-cap/`](../../evals/typescript/fixtures/seam-cap/) and
  [`cap/`](../../evals/typescript/fixtures/cap/), script `faults.ts`.
- **Fix.** Store the aggregates the classifications need before capping, or classify from the
  uncapped edges plus file ownership. Counts from retained rows say they are partial.
- **Done when.** Every seam count and unused class is invariant from a cap of zero to uncapped;
  only location completeness changes.

### T7

**Any `node_modules` in any ancestor directory counts as "dependencies installed".** Severity
high: missing package types erase whole interfaces. Size S. Proposed for 0.3.0. Part of
[E1](enhancements.md#e1).

- **What an agent sees.** No warning while package types fail to resolve and references
  disappear. Without installed dependencies the same 26 Skyplate symbols kept 142 of 375
  references (38%); eight zustand store members account for the loss
  (`ViewerState.selection` went from 58 to 0). Agents often meet a repository before anyone
  ran an install.
- **Where.** `src/core/pipeline.ts:209` walks up to any ancestor and treats the existence of a
  `node_modules` directory as success.
- **Repro.** A nested package that declares and imports React, with no React installed, inside
  a parent whose `node_modules` holds something else: zero references, two unresolved
  identifiers, no warning. Fixture [`missing-deps/`](../../evals/typescript/fixtures/missing-deps/).
- **Fix.** Check that the declared packages resolve from the applicable workspace root, and
  report compiler and import resolution failures as missing dependencies.
- **Done when.** The fixture warns, and the uninstalled-manifest count is right with and
  without an unrelated ancestor `node_modules`.

### T8

**`this.lookup()` on a JavaScript prototype method is not bound.** Severity medium, high for
CommonJS refactoring. Size M. Open.

- **What an agent sees.** Express's `View.lookup` with 0 references and 0 callers, although the
  language service finds the call.
- **Where.** `src/core/ts/declarations.ts:465` notes the binding limit.
- **Repro.** `function V() { this.lookup("x") }; V.prototype.lookup = function lookup(x) {
  return x }; new V();` Fixture [`prototype-probe/`](../../evals/typescript/fixtures/prototype-probe/index.js).
- **Fix.** First check whether the TypeScript 7 API exposes the prototype relation. If not, bind
  constructor-`this` calls to same-prototype methods conservatively, with provenance; never
  match method names globally.
- **Done when.** The repro and Express's `View.lookup` have their call, and no new false
  reference appears in the Express comparison.

### T9

**Decisions inside a nested function count toward the enclosing function.** Severity medium for
hotspot and relay ranking. Size S. Proposed for 0.3.0.

- **What an agent sees.** An uncalled inner arrow with one `if` makes its parent's complexity 2.
- **Where.** `src/core/ts/references.ts:123` changes the counter only at recorded scopes, and
  inner functions are deliberately not recorded (`src/core/ts/declarations.ts:4`).
- **Repro.** `function outer() { const neverCalled = () => { if (x) return 1; return 2 };
  return 0 }`. Probe [`nested-complexity.ts`](../../evals/typescript/fixtures/probes/nested-complexity.ts).
- **Fix.** Reset attribution at every function boundary. If containment complexity is wanted,
  report it as its own aggregate.
- **Done when.** The probe gives `outer` a complexity of 1.

## Structure and history

Found by running the CLI on seven public repositories (nine languages), hand-checking 140
import edges and building git histories by hand
([research/structure-and-history.md](research/structure-and-history.md),
[evals/structure/](../../evals/structure/)). The graph algorithms and the history arithmetic
were right on every checked input. The defects are in what feeds them.

### S1

**Declared dependencies and imported names do not join outside npm-shaped ecosystems.**
Severity high for cleanup advice. Size L across ecosystems, M for Maven alone. Open.

- **What an agent sees.** All 82 of JUnit's Maven dependencies "unused" while 89 imported
  namespaces are "undeclared". `PyYAML` and `yaml`, `concurrent-ruby` and `concurrent` fail the
  same way.
- **Where.** `src/core/imports/resolve.ts:1152`, `:1255`, `:1352`, `:1380`;
  `src/core/manifests.ts:595`, `:925`; `src/core/pipeline.ts:674`, `:723`;
  `src/mcp/query.ts:2106`.
- **Repro.** A Maven project that declares `org.slf4j:slf4j-api` and imports
  `org.slf4j.Logger` gives a declared row with no importers and an undeclared row
  ([`repros.json`](../../evals/structure/fixtures/repros.json) cases `jvm-coordinate` and `python-dist-name`, run by `repros.ts`).
- **Fix.** Separate an import namespace from a package coordinate, and join them through
  installed metadata, a lock or build file, or an explicit mapping. An unjoined declaration is
  "unknown", never "unused".
- **Done when.** JUnit's coordinates join their namespaces with no false positives, and the
  PyYAML and concurrent-ruby cases join.

### S2

**A package import is projected onto at most 17 files of the package, with no mark.** Severity
high for impact and centrality. Size S to mark, L for package nodes. Marking proposed for
0.3.0. Part of [E1](enhancements.md#e1).

- **What an agent sees.** A Go import of a 24-file package becomes 17 file edges. Kubernetes
  keeps 75.6% of its package edges (531,462 of 702,926), chi 391 of 531, and which files gain
  fan-in depends on filename order.
- **Where.** `src/core/imports/resolve.ts:24`, `:119`, `:855`; `src/core/pipeline.ts:717`;
  `src/shared/schema.ts:302`.
- **Repro.** A 24-file Go package and one importer ([`repros.json`](../../evals/structure/fixtures/repros.json) case `go-cap`).
- **Fix.** Now: record total and omitted members on the edge and say so in answers. Later:
  package nodes with real membership, and package centrality computed separately.
- **Done when.** Every projected edge says how many members it stands for; later, chi and
  Kubernetes package import recall is 100% against build metadata.

### S3

**Python imports under `if TYPE_CHECKING` are runtime edges.** Severity high: false cycles.
Size M. Proposed for 0.3.0.

- **What an agent sees.** Requests' eight-file "runtime cycle" exists only because of
  type-checking imports: 18 guarded statements make 12 file pairs that no runtime import
  shares, and without those pairs the cycle is gone.
- **Where.** `src/core/imports/extract.ts:426` never sets type-only for Python; the graph and
  findings then treat the edge as runtime (`src/core/graph.ts:381`, `src/core/findings.ts:101`).
- **Repro.** `a.py` imports `b` only under `if TYPE_CHECKING`, `b.py` imports `a` at runtime
  ([`repros.json`](../../evals/structure/fixtures/repros.json) case `python-type-guard`; `type-guards.py` measures Requests).
- **Fix.** Recognize `typing.TYPE_CHECKING` (and its imported aliases) as a guard and mark the
  edges type-only, through the contract TypeScript already uses.
- **Done when.** The repro shows a type loop and no runtime cycle, and Requests' runtime cycle is
  gone while its type loop remains.

### S4

**A Cargo `[[bin]] path` is ignored when choosing the crate root.** Severity high for graph
recall. Size M. Open.

- **What an agent sees.** 98 unresolved statements in ripgrep, all in one crate (93 crate paths,
  five `mod` lines).
- **Where.** `src/core/imports/resolve.ts:948`, `:980`, `:987`, `:1017`, `:1038`.
- **Repro.** Cargo declares `[[bin]] path = "cli/main.rs"`, which declares `mod helper` and uses
  `crate::helper::run`: both unresolved ([`repros.json`](../../evals/structure/fixtures/repros.json) case `rust-custom-bin`).
- **Fix.** Index every Cargo target root and custom library path; map each source file to its
  target's module tree. Honor path fields without running Cargo.
- **Done when.** ripgrep's 98 resolve and the custom-target fixtures pass. Shares an adapter
  with S5.

### S5

**Native entry points outside JavaScript are not discovered.** Severity high for dead-file
advice, medium for navigation. Size M per ecosystem. Open.

- **What an agent sees.** Cargo names eleven targets in ripgrep; Skyplate finds none, so runnable
  files sit in the dead-file candidates. Files a CI workflow step runs are found in any
  language; what is missing is each ecosystem's own declaration of its entries.
- **Where.** `src/core/entries.ts:56`, `:158`, `:247`; `src/mcp/query.ts:549`.
- **Repro.** The `rust-custom-bin` manifest declares `cli/main.rs`; `findEntries` returns
  nothing ([`repros.json`](../../evals/structure/fixtures/repros.json)).
- **Fix.** One typed entry adapter shared with root resolution: Cargo targets and `build.rs`,
  Go `package main`, Python script entry points and `__main__`, JVM main and service
  descriptors, each with a reason. Answers tell "entry discovery unsupported here" from "not an
  entry".
- **Done when.** ripgrep's eleven targets are entries with reasons, and entry precision and
  recall are measured per corpus.

### S6

**Python namespace packages and `from pkg import submodule` lose internal edges.** Severity
high for graph recall. Size M. Open.

- **What an agent sees.** A local package without `__init__.py` called an external PyPI package;
  `from pkg import child` linked only to `pkg/__init__.py`.
- **Where.** `src/core/imports/extract.ts:427`, `:442`; `src/core/imports/resolve.ts:762`,
  `:783`, `:792`, `:813`.
- **Repro.** `src/acme/app.py` imports `util` from `acme`, `src/acme/util.py` exists, no
  `__init__.py`, `src` on the path. And `from pkg import child` with `pkg/child.py` ([`repros.json`](../../evals/structure/fixtures/repros.json) cases
  `python-namespace` and `python-submodule`).
- **Fix.** Keep imported names; resolve child modules before treating a name as an attribute;
  find source roots and namespace packages from packaging configuration. An unknown absolute
  name is "unresolved", not "external" (this is also where "zero unresolved" comes from).
- **Done when.** Both repros resolve internally, and unknown names count as unresolved.

### S7

**Text the detector accepts as Shift_JIS is decoded as Windows-1252.** Severity medium. Size S
to M. Open.

- **What an agent sees.** Mojibake in embedded source (`“ú–{Œê` for Japanese), and string
  boundaries can shift on backslash-like bytes.
- **Where.** `src/core/languages/detect.ts:69`, `:110`; `src/core/worker.ts:187`, `:193`.
- **Repro.** A Shift_JIS Python file with Japanese strings
  ([`japanese.py`](../../evals/structure/fixtures/japanese.py), run by `encoding.ts`).
- **Fix.** One shared decoding module, with the encoding chosen at detection carried into
  measurement and source storage.
- **Done when.** UTF-8, UTF-16 with BOM, Windows-1252, Shift_JIS, EUC-KR and GB18030 specimens
  round-trip end to end.

### S8

**An extensionless local `#include <header>` is called a system header.** Severity medium. Size
S for this case. Proposed for 0.3.0.

- **What an agent sees.** A project header reported external.
- **Where.** `src/core/imports/resolve.ts:1188`.
- **Repro.** `main.c` includes `<projectheader>` and `include/projectheader` exists
  ([`repros.json`](../../evals/structure/fixtures/repros.json) case `c-extensionless`).
- **Fix.** Call only known headers builtin; otherwise look in the repository, and label a
  suffix match as a guess. Build-aware include paths (`compile_commands.json`) are a larger,
  separate step.
- **Done when.** The repro resolves to the repository file.

### S9

**Rust uses written as `crate_name::item` without a `use` are not seen.** Severity medium, high
for cleanup advice. Size M. Open.

- **What an agent sees.** `textwrap`, `lexopt` and `encoding_rs` "unused" in ripgrep.
- **Where.** `src/core/imports/extract.ts:480`, `:535`, `:750`; `src/mcp/query.ts:2106`.
- **Repro.** A Cargo dependency `textwrap` used only as `textwrap::fill("x", 10)` ([`repros.json`](../../evals/structure/fixtures/repros.json) case
  `rust-qualified`).
- **Fix.** Collect qualified crate-root paths and macro invocations in a Rust syntax pass. Until
  then, say "not observed as an import" instead of "unused".
- **Done when.** ripgrep's three dependencies count as used.

## MCP answers

Found while measuring how agents use the server
([research/agent-adoption.md](research/agent-adoption.md)) and in the structure study's
friction log.

### M3

**Owners in a depth-limited clone are the snapshot's author.** Severity medium. Size S.
Mitigated in 0.3.0.

- **What an agent sees.** On a shallow clone, the oldest commit credits its author with every
  line it holds, so ownership names one person for most files. Agents in two adoption runs
  noticed this with git and discounted the answer.
- **Now.** Answers on a shallow clone say that owners, co-change and churn may be weak
  evidence. The attribution itself is unchanged.
- **Fix.** Exclude the shallow boundary commit from ownership, or report ownership as unknown
  for lines it introduced.
- **Done when.** A depth-limited fixture gives no owner for lines that only the boundary commit
  touched.

## Fixed

### T3

**Impact followed one base level.** Fixed in 0.3.0. `impact_depth: 3` on a method three links
down an inheritance chain returned nothing; `callsThroughBases` in `src/shared/calls.ts` now
walks the whole base chain with a cycle guard (tests: chain, loop, diamond in
`test/shell-derived.test.ts`; probe [`heritage.ts`](../../evals/typescript/fixtures/probes/heritage.ts)).

### T5

**`symbol` returned at most 2,500 reference locations and could not page.** Fixed in 0.3.0.
`offset` pages through every site and the answer returns `nextOffset`; the
[3,000-site fixture](../../evals/typescript/fixtures/pagination/x.ts) now returns all 3,000 in two pages. The `offset`
an agent tried was dropped silently, which is M1.

### M1

**An argument a tool does not take was dropped silently.** Fixed in 0.3.0. `seams { path }` or
`symbol { offset }` answered a different question without saying so. Every schema is now
strict, and an unknown argument is an error that lists the arguments the tool takes.

### M2

**`map_codebase` rejected `depth: 0` and a small `token_budget`.** Fixed in 0.3.0, found by
agents in the adoption runs. Both are accepted, with a budget down to 100 tokens.

### M4

**`history`, `dependencies` and `graph` could not page past their limit.** Fixed in 0.3.0. They
returned a `more` count with no way to reach the rest, and `limit` stops at 500. Every list an
answer cuts now pages the same way, with `offset` in and `nextOffset` out, in every tool
(`symbol`'s reference locations included, so `references_offset` is gone), and a cycles answer
that holds one cycle lists all its members. Lists inside a single row, such as the 15 members
per cycle in a list of many, are still capped; narrow with `path` to read one in full.
