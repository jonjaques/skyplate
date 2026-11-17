# TypeScript and JavaScript symbols: how accurate, and where they stop

> Research behind the [roadmap](../README.md), measured 2026-11-16 on 0.2.0. The scripts, fixtures and results named here are in [evals/typescript/](../../../evals/typescript/). Defects D1 to D9 below are [T1 to T9](../defects.md#typescript-and-javascript) in the defect list, where their status is kept; this file is the dated record and is not updated as they are fixed. Source links point at the commit measured.

Measured November 16, 2026. Checkout: the repository, `main`, commit `f0f874f82700ec5e5c62beef457e74de95d5841d`. Bun 1.4.4, TypeScript 7.0.2 analyzer, independent TypeScript 5.9.3 language service, on a laptop. The checkout was clean before and after this work. No checkout files, git state, settings, services, or GitHub state changed.

The existing compiler resolution is accurate for declarations it records. Its largest refactoring risks come from missing declarations, incomplete analysis presented as ordinary zeroes, and queries that cannot return all editing locations. Repairing those matters more than adding another graph metric.

All artifacts named below are in [evals/typescript/](../../../evals/typescript/). `summary-results.json` contains the arithmetic; `samples.json` contains the 72 selections; `*-oracle.json` preserves each expected location, actual location, call classification, caller identity, and mismatch. `probe-rows.json`, `probe-queries.json`, `partial-failure.json`, `seam-cap.json`, `cap-recursion.json`, and `pagination-mcp.json` preserve the reproductions. The public clones were deleted after extracting the evidence. Small source excerpts and commit identifiers remain in `external-evidence.md`.

## Inventory

### Extracted declarations and metadata

- The public kinds are function, method, constructor, getter, setter, property, variable, class, interface, type, enum, namespace, component, hook, and synthetic file module. See [src/shared/schema.ts:581](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L581). Each file module owns executable top-level statements.
- Pass A walks module/namespace statements, class and interface members, enum members, top-level bindings, selected CommonJS export assignments and expando methods. It deliberately does not descend into function bodies. Locals, parameters, inner functions and anonymous callbacks do not become symbols. See [src/core/ts/declarations.ts:4](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L4), [src/core/ts/declarations.ts:158](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L158) and [src/core/ts/declarations.ts:181](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L181).
- Class fields initialized with an arrow/function become methods. Constructor parameter properties become properties. Interface methods and adjacent overloads are combined. Ordinary object-literal members and type-literal members are absent. See [src/core/ts/declarations.ts:329](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L329), [src/core/ts/declarations.ts:343](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L343) and [src/core/ts/declarations.ts:352](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L352).
- CommonJS support recognizes `exports.x`, `module.exports.x`, `module.exports`, object exports, prototype/expando function assignments, and relative `module.exports = require('./x')` chains. Relative re-export resolution tries eight JS/TS extensions and directory indexes; cycles terminate without guessing a value. See [src/core/ts/declarations.ts:419](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L419), [src/core/ts/declarations.ts:472](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L472) and [src/core/ts/declarations.ts:530](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L530).
- Flags are exported, defaultExport, async, generator, static, abstract, private, protected, deprecated, test, ambient, unusedExport. There are no separate readonly, optional, override, accessor-effect, purity or visibility-of-package-contract fields. Some of that text survives in signatures. See [src/shared/schema.ts:599](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L599).
- Symbol positions are zero-based UTF-16 line/column and last body line, without a declaration end column. The table stores parent, signature, first JSDoc sentence, complexity, parameter count, reference count, distinct referencing files, and distinct enclosing users. See [src/shared/schema.ts:637](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L637). MCP positions are converted to one-based lines/columns.
- Function/property/variable types come from the checker, clipped at 240 characters; classes, interfaces, types and constructors use source headers. Error/`any` types fall back to source headers. Docs keep the first paragraph/sentence, at most 200 characters. Deprecation comes from JSDoc. See [src/core/ts/store.ts:27](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/store.ts#L27), [src/core/ts/resolve.ts:338](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L338) and [src/core/ts/syntax.ts:216](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/syntax.ts#L216).
- Adjacent overloads share the first signature's position; extent grows through the implementation, and implementation parameters supply `params`. There is no structured overload list, parameter-name table, resolved overload per call site, or inferred generic substitution. See [src/core/ts/declarations.ts:136](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L136).
- React classifications are conventions. `/^use[A-Z]/` marks functions as hooks. PascalCase containing lowercase plus JSX makes components; wrapped functions and known React component type names receive extra handling. Calls assigned to `useX` are demoted if the returned type is definitely noncallable. JSX-tag use can promote a function/variable. These are classifications, not proof of React semantics. See [src/core/ts/declarations.ts:35](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L35), [src/core/ts/declarations.ts:150](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L150), [src/core/ts/declarations.ts:251](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L251) and [src/core/ts/refine.ts:98](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/refine.ts#L98).

### References, calls, hierarchy and uncertainty

- The ten reference kinds are read, write, call, new, jsx, type, import, export, extends, implements. See [src/shared/schema.ts:619](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L619). CallTable is an aggregation of **all** reference kinds by enclosing symbol, target and kind, rather than an invocation-only call graph. See [src/shared/schema.ts:687](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L687).
- Pass B walks identifiers/private identifiers, `super()`, string-literal member accesses/indexed-access types, and JSDoc links. Declaration names and closing JSX tags are excluded. Namespace qualifiers remain reads; aliases resolve to targets. Shorthand properties require a second lookup. See [src/core/ts/references.ts:143](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L143), [src/core/ts/references.ts:172](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L172), [src/core/ts/references.ts:182](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L182) and [src/core/ts/references.ts:264](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L264).
- Syntactic direct calls, `new`, optional calls, tags and decorators are classified. `new C()` yields rows for the class and explicit constructor; `super()` targets the base constructor. `f.call/apply/bind`, a function copied into a variable, and functions passed to array methods retain reads of `f`; they are not propagated into calls to `f`. See [src/core/ts/references.ts:348](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L348) and [src/core/ts/resolve.ts:124](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L124).
- JSX attributes, contextually typed object members, and shorthand destructuring use the contextual/container type to find interface properties. Unions are enumerated constituent by constituent. If several variants share a property, assignability filters them. When nothing fits, the resolver credits the first entry rather than all variants. This is an explicit heuristic under erroneous/incomplete code. See [src/core/ts/resolve.ts:144](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L144), [src/core/ts/resolve.ts:169](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L169) and [src/core/ts/resolve.ts:229](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L229).
- Merged declarations are selected by type/value use and container. Import/export rows name all declarations. A get/set pair picks setter for writes and getter for reads; same-container repeated interfaces are not unified into one persistent logical symbol. See [src/core/ts/resolve.ts:294](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L294).
- Override links are synthetic references from the implementing member's declaration to the nearest same-named member on each base path. Static/instance names stay separate; constructors and `#private` members are excluded. This is a name/heritage walk, not the checker's full implementation relationship. See [src/core/ts/refine.ts:31](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/refine.ts#L31).
- `callEdges` excludes import/export, heritage and self edges. `partitionByCall` separates invocations from value/type uses. `SymbolTable.callers` counts distinct enclosing users across all nonwiring, nonheritage kinds, so it is broader than MCP `calledBy` for functions. Getters/setters use the non-function `usedBy` presentation. See [src/shared/calls.ts:87](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L87), [src/shared/calls.ts:117](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L117) and [src/core/ts/tables.ts:83](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L83).
- `callsThroughBases` follows one base level. Impact performs reverse breadth-first traversal over direct uses plus that one-level expansion. It includes value/type dependencies, not only executable calls. See [src/shared/calls.ts:209](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L209) and [src/mcp/query.ts:910](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L910).
- Complexity is 1 plus if, conditional, nondefault case, loops, catch, `&&`, `||`, `??` and their assignment forms. Optional chaining and default clauses do not count. Decisions in omitted nested functions accumulate on the nearest recorded callable. Function signatures with no body start at complexity 1 too. See [src/core/ts/references.ts:123](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L123), [src/core/ts/references.ts:223](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L223) and [src/core/ts/store.ts:136](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/store.ts#L136).
- `unresolved` increases when an identifier/alias has no checker symbol. Resolved locals, external symbols, and symbols whose declarations Pass A omitted disappear without increasing it. Contextual-member lookup failures are often caught as empty results too. `unresolvedShare` divides unresolved by emitted references plus unresolved; it is **not** the share of every identifier examined. See [src/core/ts/resolve.ts:113](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L113), [src/core/ts/resolve.ts:266](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L266) and [src/mcp/query.ts:455](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L455). A zero value is not a completeness certificate.

### Unused exports, entries and host files

- An export is flagged unused when no non-import/export reference comes from another file. Flags, aggregate counts and CallTable are computed before location truncation. Self use and imports without use do not make it externally used. See [src/core/ts/tables.ts:45](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L45) and [src/core/ts/tables.ts:98](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L98).
- Queries classify flagged exports as public-api, entry-export, unreferenced, or used-in-own-file, in that order of protection. `unreferenced` consults aggregate callers and stored nonwiring rows. See [src/shared/calls.ts:268](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L268) and [src/shared/calls.ts:282](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L282).
- Entry files come from package main/module/browser/bin/exports/scripts, JSON knip entries/workspaces, known tool config filenames, `.d.ts`, CI run steps, agent hooks and T3 scripts. Absent build outputs are not translated to source. Executable knip configs, arbitrary build scripts, framework route conventions, runtime string registries and external consumers are not evaluated. See [src/core/entries.ts:1](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/entries.ts#L1), [src/core/entries.ts:131](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/entries.ts#L131) and [src/core/entries.ts:158](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/entries.ts#L158).
- Public API protection starts at nonprivate package entry targets and follows file re-exports, protecting whole files rather than exported names. See [src/core/pipeline.ts:735](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts#L735). This can conservatively protect nonpublic sibling exports in the same file.
- Host imports from Vue, Svelte, Astro, HTML, MDX and Markdown can clear unused flags and create `hostUses`. They do not add compiler reference/call rows. Direct exported names and unrenamed named re-exports work; star re-exports, renamed exports and exported aliases do not. Namespace imports conservatively protect every known export. See [src/core/ts/hosts.ts:23](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/hosts.ts#L23) and [src/core/ts/hosts.ts:58](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/hosts.ts#L58).

### Bounds, selection and failure handling

| Boundary | Current rule and evidence |
| --- | --- |
| Eligible source files | `.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs`; reject node_modules, `.min.js/.min.cjs/.min.mjs`, supplied generated/vendor skips, or conflicting detected language. [src/core/ts/projects.ts:30](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/projects.ts#L30) |
| Default compiler cap | 20,000 eligible files; one file over returns null for the entire compiler pass, without partial symbols. [src/core/pipeline.ts:100](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts#L100) and [src/core/ts/index.ts:62](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L62) |
| Stored locations | Default 600,000. Water-fill per-symbol allowance, retaining early file-order locations for high-volume symbols. Full raw stores exist before capping, so this bounds output, not peak resolution memory. [src/core/ts/tables.ts:106](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L106) |
| IPC batches | 20,000 candidate threshold, flushed between files; a single huge file can exceed it. Declarations clear AST cache every 256 files; reference flushes clear it again. [src/core/ts/index.ts:50](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L50) and [src/core/ts/index.ts:143](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L143) |
| Parallel fetch/requests | Eight prefetched source files; checker side requests in slices of 512. [src/core/ts/index.ts:255](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L255) and [src/core/ts/resolve.ts:63](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L63) |
| Config planning | Circular extends screened; nonprimary extended bases and empty solution configs skipped; leftover files opened as inferred. Nearest ancestor config wins, then primary name, then lexical path. Each file gets one owning project. [src/core/ts/projects.ts:78](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/projects.ts#L78) and [src/core/ts/projects.ts:348](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/projects.ts#L348) |
| Compiler timeouts | Snapshot requests: 60,000 ms + 5 ms per candidate file. Failed group opens retry individually. Closing gets 5 s, then its own child is stopped. Reference/checker requests have no corresponding per-request wall-clock bound in this implementation. [src/core/ts/projects.ts:206](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/projects.ts#L206) and [src/core/ts/projects.ts:248](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/projects.ts#L248) |
| Partial failures | Reading and resolution failures log and continue. There is no per-project references-complete field; project files count declarations read. [src/core/ts/index.ts:152](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L152) and [src/core/ts/index.ts:194](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L194) |
| Search | Every whitespace term must match. Substrings score at least 1,000; subsequences cap at 900; filename/word boundaries and shorter strings rank better. Query search breaks ties by refs. [src/shared/search.ts:23](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/search.ts#L23) and [src/mcp/query.ts:807](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L807) |
| Symbol lookup | Exact qualified/unqualified name, then case-insensitive match. Ambiguity errors list up to 12 candidates; missing-name suggestions list eight. Only id/name selectors, no position selector. [src/mcp/query.ts:881](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L881) |
| MCP row bounds | `limit` defaults vary and caps at 500. `symbol` defaults to 20 hierarchy rows and max of 5×limit or 50 references, hence at most 2,500 locations. No symbol reference offset. Impact depth caps at six; output has at most 40 files and 30 nearest symbols. [src/mcp/server.ts:89](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/server.ts#L89), [src/mcp/server.ts:418](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/server.ts#L418) and [src/mcp/query.ts:967](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L967) |
| Seam approximations | Uses are calculated from stored rows, production/test split by file classification. Exposed types are parsed from a short printed type and require a unique bare name. Relays allow complexity ≤2, body span ≤2 line differences, one in-repo call and no other recorded use; package/builtin calls are invisible. Adapters use direct heritage and list eight implementations. [src/mcp/query.ts:1476](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L1476), [src/mcp/query.ts:1600](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L1600), [src/mcp/query.ts:1639](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L1639) and [src/mcp/query.ts:1929](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L1929) |
| Dependency warning | Any ancestor node_modules/PnP path is treated as installation evidence. The pipeline warning additionally requires unresolved ≥10% of emitted-plus-unresolved. [src/core/pipeline.ts:207](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts#L207) and [src/core/pipeline.ts:826](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts#L826) |
| Freshness | Every reanalysis calls the whole pipeline, and the TS pass creates/closes a fresh native compiler. No cross-run compiler snapshots are retained. MCP can return an older snapshot with a freshness note while a refresh runs. [src/mcp/workspace.ts:458](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/workspace.ts#L458) and [src/core/ts/index.ts:81](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L81) |

## Measured accuracy

### Corpus and oracle

I shallow-cloned only public repositories: Express `43fca52d28a422c8be48fd489cbd4f2d6152bab6`, TanStack Query `d63a027c26b2489b8be065ad76f638e36216854a`, and p-limit `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`. Query supplies a workspace monorepo and React code; Express supplies CommonJS/prototype code; p-limit supplies ESM JavaScript, declarations, private class members and benchmark code. A separate two-project composite fixture verifies path aliases and project references.

`measure.ts` called the production `analyzeTypeScript` pass on repository files discovered by rg. It excluded dependencies/build folders but did not apply Skyplate's language/generated/vendor detector. Therefore these pass-level file counts differ slightly from MCP's end-to-end counts. For example MCP dogfooding analyzed 224 Skyplate files and returned 4,746 symbols, while the raw pass analyzed 227 files and returned 4,767 symbols. Do not mix those denominators.

`oracle.ts` uses independently installed TypeScript 5.9.3 `LanguageService.findReferences`, with root compiler options and an aggregate root project containing the repository's TS/JS sources. This is not an exact reproduction of every Query project owner. It normalizes declaration definitions, renamed import/export alias tokens, closing JSX tags, and synthetic heritage links. Real heritage identifiers stay in the comparison. Calls are classified independently from the TypeScript AST. Caller edges project the AST's containing declaration onto Skyplate's recorded declaration granularity; recursion is excluded from distinct caller counts. These are static invocation callers, not measured runtime dispatch or callback executions, and not the broader `SymbolTable.callers` metric.

TypeScript 5.9's CommonJS find-references did not follow Express's re-exported factory adequately and included six uses of an app instance. I did not count that disagreement as Skyplate failure. I read the entry/factory chain and supplemented the oracle with an independent checker walk over locally bound `require` aliases that resolve to that audited entry/factory. The 873 factory locations are all accounted for by that trace. The adjustment and original experiment logs remain in `oracle.ts` and evidence files.

The baseline sample contains 64 declarations across kind and usage pattern. I added eight dependency-sensitive store members after inspecting the dependency delta. The final 72-symbol sample is purposive, not random, and the extra eight are an explicit stress stratum. Existing-symbol accuracy does not measure whether omitted type/object members are discoverable.

### Existing-symbol results by corpus

| Corpus/state | Symbols | Reference TP/FP/FN | Precision / recall | Invocation-site TP/FP/FN | Invocation-caller TP/FP/FN |
| --- | ---: | --- | --- | --- | --- |
| Skyplate, installed | 26 | 375 / 0 / 0 | 100% / 100% | 59 / 0 / 0 | 36 / 0 / 0 |
| Query, uninstalled | 18 | 1,447 / 0 / 0 | 100% / 100% | 707 / 0 / 0 | 100 / 0 / 0 |
| Express, installed | 16 | 909 / 0 / 1 | 100% / 99.890% | 699 / 0 / 1 | 118 / 0 / 1 |
| p-limit, installed | 12 | 35 / 0 / 0 | 100% / 100% | 23 / 0 / 0 | 9 / 0 / 0 |
| Total, mixed dependency states | 72 | 2,766 / 0 / 1 | 100% / 99.964% | 1,488 / 0 / 1 | 263 / 0 / 1 |

Invocation-site recall is 99.933%; invocation-caller recall is 99.621%. Both precisions are 100%. Express's missed location is `this.lookup(fileName)` in `lib/view.js:94`, inside the View constructor. `View.lookup` exists but has no reference rows. This is consistent with the implementation's documented limitation binding JS prototype methods. The four sampled Express methods have only one reference discoverable by this oracle, so their apparently tiny denominator is itself a warning against treating these scores as runtime completeness.

### Results by stratum

| Stratum | Symbols | Ref TP/FP/FN | Ref precision / recall | Invocation TP/FP/FN | Caller TP/FP/FN |
| --- | ---: | --- | --- | --- | --- |
| Top-level functions, including CommonJS factory | 25 | 1,198 / 0 / 0 | 100% / 100% | 783 / 0 / 0 | 152 / 0 / 0 |
| Types, interfaces and classes | 13 | 568 / 0 / 0 | 100% / 100% | 256 / 0 / 0 | 30 / 0 / 0 |
| Methods, including prototype/private/overloaded | 14 | 187 / 0 / 1 | 100% / 99.468% | 156 / 0 / 1 | 48 / 0 / 1 |
| Properties, including dependency-mediated store members | 11 | 445 / 0 / 0 | 100% / 100% | 0 / 0 / 0 | 0 / 0 / 0 |
| React components/hooks | 5 | 327 / 0 / 0 | 100% / 100% | 293 / 0 / 0 | 33 / 0 / 0 |
| Variables/constants | 3 | 39 / 0 / 0 | 100% / 100% | 0 / 0 / 0 | 0 / 0 / 0 |
| Getter | 1 | 2 / 0 / 0 | 100% / 100% | 0 / 0 / 0 | 0 / 0 / 0 |

Zero invocation denominators mean not applicable, not a measured 100%.

### Dependencies installed versus absent

Express dependencies were installed with `npm install --ignore-scripts`; p-limit and the scratch oracle used `bun install --ignore-scripts`. Skyplate's installed main checkout was left untouched; an isolated source copy supplied the absent-dependencies run. Query's declared pnpm installation was attempted with `pnpm install --ignore-scripts`, but installed pnpm 12.3.4 rejected `pnpm-workspace.yaml` at `lockfile.includeResolutionSettings`. Its requested packageManager was 12.18.0. I stopped that installation line. Installed Query accuracy is not run.

| Repository/state | TS/JS files | Symbols | Stored refs | Unresolved candidates | Pass wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skyplate absent | 227 | 4,767 | 27,803 | 13,360 | 784 ms |
| Skyplate installed | 227 | 4,767 | 29,363 | 592 | 1,575 ms |
| Query absent | 2,223 | 8,662 | 39,463 | 100,071 | 3,049 ms |
| Express absent | 142 | 407 | 2,119 | 12,167 | 405 ms |
| Express installed | 142 | 407 | 2,119 | 12,149 | 252 ms |
| p-limit absent | 6 | 38 | 139 | 252 | 66 ms |
| p-limit installed | 6 | 38 | 139 | 116 | 122 ms |

These are single runs, some overlapping independent work, not controlled performance comparisons. Installing Express's dependencies does not supply a reliable inferred type for its dynamic request/response objects; its in-repo symbol counts barely improve.

Against the **installed** oracle, the same 26 selected Skyplate declarations without dependencies retained 142 of 375 references, 48 of 59 invocations, and 30 of 36 caller edges: recall 37.867%, 81.356%, and 83.333%, respectively, all with zero false positives. The eight postselected store members account for all 233 lost sampled references. `ViewerState.selection` goes 58 → 0, `report` 33 → 0, `select` 29 → 0, and `symbols` 28 → 0. This is a dependency-stress result, not an estimate that all fresh clones have 38% recall.

The per-environment uninstalled language service also missed those members, which is why a naive within-environment oracle comparison would misleadingly report 100% agreement. Express and p-limit's selected symbols had the same results before and after installation.

### Semantics probes

`probes.ts` creates a strict scratch project, calls the full pipeline, and saves all rows. Final run: 34 analyzed files, 105 symbols, 71 references, zero unresolved, seven host files. `workspace-probe.ts` separately exercises a solution config, shared base, project references and a path alias.

| Construct | Observed result |
| --- | --- |
| Interface/base dispatch | Direct interface call recorded; override links recorded. A Root → Middle → Base → Leaf chain loses `dispatch` when querying Base.run or Leaf.run impact. |
| Callback / event / array / alias values | `.map(cb)`, `setTimeout(cb)`, and `const f = cb` record reads. `f()` is not propagated back. No runtime callback graph. DOM event dispatch was not executed. |
| JSX invocation | Component JSX is kind `jsx`; interface props get attribute-write rows. Identical type-literal props have no member symbols or references. |
| Decorator | `@dec` produces a call from Decorated to dec. |
| Getters/setters | Read selects getter, assignment selects setter. Both declarations retained. |
| `new` / arrow class field | Class and explicit constructor get new rows; arrow field is a method and its invocation resolves. |
| Tagged templates / optional calls | `tag` template invocation and `cb?.()` become call rows. |
| call/apply/bind | Target function is read; indirect invocation is not attributed to it. |
| `export *`, named re-export rename, default | TS consumers through the star/rename/default resolve to original declarations. Star itself has no per-export reference row. |
| `export =`, require, require destructuring | CTS export= and CJS binding/call probes resolve. |
| Namespace import / dynamic import | `ns.original()` and `(await import(...)).extra()` resolve to the exported functions. |
| Declaration merging | Interface parts and namespace remain separate symbol IDs. Type use names the first interface; the second part can have zero references while its member is used. Name lookup for Merged is ambiguous. |
| Overloads | Three declarations form one function symbol positioned on the first signature. Implementation extent and params retained. |
| Object-literal methods | `object.method` and `object.arrow` have no symbols. Only reads of object remain; its consumer has no recorded callees for those invocations. |
| Destructuring rename | Both `{prop: renamed}` and `{prop}` retain the read of Binding.prop. |
| `typeof x` type query | Resolves the value declaration rather than the same-named type. |
| Module augmentation / ambient declarations | Augmented member and ambient global reference resolve. Class and augmented interface each get the relevant type-use row. |
| JS through JSDoc | JSDoc import type resolves Binding and body `b.prop` resolves Binding.prop. |
| Workspace, source condition, symlink | Symlinked package exporting source via the source condition resolves sourceFn and its call. |
| Workspace, dist declarations | A sibling package exporting only dist declarations leaves the source distFn unused with zero refs. The declaration file is outside the analyzed symbol set; unresolved remains zero. No declaration-map/source rebinding is performed. |
| Path alias + project references | Two files assigned to their two configs, no duplicates, two cross-project import/call rows, zero unresolved. Solution/base correctly skipped. |
| Vue/Svelte/Astro | Direct import protection works. Star, renamed barrel and local exported alias protection fails; live host-only exports stay flagged unused. No template-level symbol extraction. |
| Nested locals/complexity | Inner function absent; its branch increases outer complexity. An uncalled arrow with a branch makes neverRunsCallback complexity 2. |

### Scale and freshness

I generated chain projects with one exported function per file, one import and call to its predecessor. This is intentionally simpler than a production framework or a types-heavy generic library. Times cover `analyzeTypeScript`, including compiler creation/planning, declaration/reference passes and tables. After the first run I edited one file and reran the entire pass in the same Bun host process.

| Eligible files | Resolved refs | Initial pass | After one-file edit | `/usr/bin/time -l` max RSS | Bun host high-water after second run |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 198 | 46.4 ms | 34.7 ms | 62.8 MiB | 41.2 MiB |
| 1,000 | 1,998 | 137.6 ms | 119.3 ms | 130.9 MiB | 103.0 MiB |
| 5,000 | 9,998 | 493.2 ms | 455.3 ms | 363.9 MiB | 279.9 MiB |
| 20,000 | 39,998 | 1,724.1 ms | 1,623.8 ms | 761.3 MiB | 451.4 MiB |
| 20,001, default cap | None | 1.1 ms to skip | 0.4 ms to skip | 44.0 MiB | 25.3 MiB |

The OS value is the command's reported resource-accounting maximum resident set, including native-child accounting. It is not a sampled simultaneous sum of the Bun and compiler processes. The host number comes from Bun `process.resourceUsage().maxRSS` in KiB and is a high-water mark across both runs. Logs and raw timing output are `scale*.json` and `scale*-time.txt`. No claim about a real 20,000-file monorepo's time follows from this synthetic chain.

One-file reanalysis remained full work: 20,000 files and 39,998 references were revisited. Faster second runs reflect warm state/OS caches, not incremental compiler snapshots. Above the cap, all TS/JS symbols disappear rather than only the excess files.

For partial failure I monkey-patched the scratch process's Checker.getSymbolAtLocation to throw only in `bad/tsconfig.json`. The good project retained its reference. Both projects still reported one file analyzed; bad's declarations remained eligible for normal unused analysis. The pipeline saved a warning, but zero references were not tagged incomplete. This is fault injection, not an observed spontaneous native-compiler crash.

I also ran the existing TS test file with TMPDIR inside scratch: **54 pass, zero fail, 711 assertions**. Full test suite, typecheck, browser checks and production builds were not run because no product code changed.

## Defects

### D1. Type-literal and ordinary object members are missing

Severity: high for rename/signature/move work. Size: M.

Evidence: [src/core/ts/declarations.ts:188](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L188) descends interface members; [src/core/ts/declarations.ts:193](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L193) only adds the type alias. [src/core/ts/declarations.ts:245](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L245) handles function initializers but [src/core/ts/declarations.ts:251](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L251) does not descend ordinary object literals. [src/core/ts/resolve.ts:266](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/resolve.ts#L266) drops checker declarations absent from the declaration store.

Minimal repro: `type P = { label: string; run(): void }; function C(p: P) { return p.label }; const o = { m() {} }; o.m();`. See `probes/jsx.tsx` and `probes/object.ts`.

Expected: discoverable P.label/P.run/o.m, with their references and editable call sites. Actual: none exists; interface equivalents have rows. The object call disappears from the caller's callee list; zero unresolved does not reveal the omission.

Fix: traverse type literals and object literals with explicit synthetic/declared parents, preserving binder handles for member identities. Add callable members of function-valued property signatures too. Measure equivalent interface/type-alias and class/object patterns as paired tests, including JSX attributes.

### D2. Host files through barrels and aliases can produce false dead-export advice

Severity: high for delete/hide advice. Size: M.

Evidence: [src/core/ts/hosts.ts:23](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/hosts.ts#L23) documents the missing forms. Export matching uses declaration names at [src/core/ts/hosts.ts:79](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/hosts.ts#L79) and [src/core/ts/hosts.ts:85](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/hosts.ts#L85), so exported names that differ are lost.

Minimal repro: `a.ts: export function live(){}`; `barrel.ts: export * from './a'`; Vue script imports live from barrel and calls it. A second repro uses `export { live as exposed }` and a Svelte import of exposed. A third uses a local exported alias. See `probes/host-value.ts`, `probes/host-rename-value.ts` and `probes/host-local-alias.ts` with their host importers.

Expected: preserve exported identity and mark each host consumer. Actual: all three live exports retain unusedExport; hostUses contains only the direct control import elsewhere in the fixture. These private nonentry files can be classified unreferenced.

Fix: persist the compiler's exported-name → target-symbol mapping per module, including star expansion and default aliases. Reuse it for host matching and public API reachability. Do not infer aliases from original declaration names.

### D3. Impact loses callers beyond the immediate base

Severity: high for signature-change impact. Size: S/M.

Evidence: [src/shared/calls.ts:209](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L209) follows immediate bases only; [src/mcp/query.ts:917](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L917) uses those edges without recursively traversing the base family. The generated override links themselves exist.

Minimal repro: Root.run, Middle extends Root and redeclares run, Base implements Middle, Leaf overrides Base.run; `dispatch(x: Root) { x.run() }; dispatch(new Leaf())`.

Expected: querying Leaf.run or Base.run explains the possible dispatch caller through the family, distinct from a proven direct invocation. Actual: `impact_depth: 3` returns zero symbols for Leaf.run/Base.run. Middle.run finds dispatch through Root.run. See `probe-queries.json`.

Fix: walk the complete base-member closure with a cycle guard and provenance; preserve possible-dispatch versus direct-call labels. Test chains, diamonds, static/private exclusions and interface redeclarations. Increasing impact depth alone must not leave this case empty.

### D4. Partial compiler failure keeps normal unused/impact assertions

Severity: high for delete advice. Size: M.

Evidence: [src/core/ts/index.ts:194](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L194) catches batch resolution failure; [src/core/ts/index.ts:174](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/index.ts#L174) still builds tables. [src/shared/schema.ts:696](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/schema.ts#L696) gives projects only config/files/ms. [src/core/ts/tables.ts:98](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L98) assigns unused flags regardless of reference-pass completeness.

Minimal repro: two one-file configs, each with an exported function and an exported value calling it. Inject an exception into only bad's checker lookup; `failure-cap.ts` records the exact injection.

Expected: good results survive, bad project and dependent negatives are explicitly incomplete; delete recommendations are withheld. Actual: two analyzed files, six symbols, one reference, zero unresolved, four unused exports. Both configs report files=1. A general report warning is retained, but there is no structured incomplete status on symbols/queries and no suppression of false negatives. See `partial-failure.json`.

Fix: propagate pass/project/file completion and failed batch counts into schema and MCP answers. Negative assertions require complete coverage of possible consumers. Retain partial positive edges and explain their provenance.

### D5. MCP cannot page through all stored locations

Severity: high for a large rename/signature edit. Size: S.

Evidence: [src/mcp/query.ts:970](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L970) limits locations to max(5×limit, 50). [src/mcp/server.ts:89](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/server.ts#L89) caps limit at 500. [src/mcp/server.ts:423](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/server.ts#L423) has no reference offset/cursor parameter.

Minimal repro: one exported many() and 3,000 top-level invocations. Call `symbol {name:'many', limit:500}`, then repeat with offset:2500.

Expected: all 3,000 positions obtainable with stable paging. Actual: total=stored=3,000, only the first 2,500 returned, more=500. The unknown offset is silently stripped and the same prefix returns. The final 500 are inaccessible through symbol. See `pagination-mcp.json`.

Fix: separate `references` paging from aggregate symbol summary with cursor, file/kind filters, ranges and source context. Validate unknown selector keys, or clearly explain the accepted parameter. Existing hierarchy arrays need independent paging too.

### D6. Reference truncation changes semantic classifications downstream

Severity: medium/high for seam and deletion recommendations. Size: M.

Evidence: totals/flags/calls are correctly computed before truncation in [src/core/ts/tables.ts:45](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/tables.ts#L45). However [src/mcp/query.ts:1485](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/mcp/query.ts#L1485) derives interface use from the truncated rows, and [src/shared/calls.ts:274](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/shared/calls.ts#L274) derives residual use from those rows.

Minimal repro A: lib/a.ts exports api; consumer.ts calls it. Compare seam('lib') at maxRefs=100 and maxRefs=0. Expected interface remains one symbol, or answer explicitly incomplete. Actual interface changes 1 → 0, uses/callers/files all 1 → 0, although aggregate edges are preserved. See `seam-cap.json`.

Minimal repro B: an exported self-recursive function at those caps. Expected unused class stays used-in-own-file. Actual it changes to unreferenced despite symbols.refs remaining 1. See `cap-recursion.json`. This recursion-only function may be runtime dead anyway; the defect is that the stated classification changes solely because locations were capped.

Fix: compute/store sufficient module/test/own-file use aggregates before capping, or calculate seam classification from uncapped edges plus file ownership. Preserve a pre-cap nonwiring/self-use mask. Counts based on retained locations must say partial.

### D7. An unrelated ancestor node_modules suppresses dependency absence

Severity: medium/high because missing types can erase whole interfaces. Size: S/M.

Evidence: [src/core/pipeline.ts:209](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/pipeline.ts#L209) recurses to any ancestor and treats the mere existence of node_modules as success, without resolving declared packages.

Minimal repro: scratch parent has only the independently installed TypeScript oracle. A nested fresh package declares React and imports useState, but has no React or local installation. See `missing-deps/index.ts` and `missing-deps.json`.

Expected: distinguish missing declared dependency/type resolution from a completed installation. Actual: zero references, two unresolved identifiers, no uninstalledManifests stat and no warning. Parent node_modules exists, but it contains no React. This is not a hypothetical case; the full pipeline reproduced it.

Fix: report failed package resolution from compiler/import resolution, plus manifest-install evidence. At minimum check relevant package entries at the applicable workspace root instead of directory existence. Separately report successfully resolved but intentionally omitted declarations.

### D8. JS prototype methods can exist with empty reference lists

Severity: medium/high for CommonJS refactoring. Size: M/L.

Evidence: [src/core/ts/declarations.ts:465](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L465) explicitly notes the binding limit, although the subsequent TS expando path helps typed assignments. Express View.lookup is extracted as a method, but `this.lookup(fileName)` at upstream lib/view.js:94 has no row. TypeScript 5.9 findReferences finds that call. Source excerpt remains in `external-evidence.md`; the failing location is in both Express oracle outputs.

Minimal repro: `function V() { this.lookup('x') }; V.prototype.lookup = function lookup(x) { return x }; new V();`.

Expected: return the statically knowable constructor-this/prototype call, or flag this method's reference analysis unsupported. Actual in the real repository: recorded method, refs=0, callers=0. The standalone three-line V repro also produces lookup refs=0; its retained result is prototype-probe.json.

Fix: first inspect whether the TS7 API exposes the needed prototype/property relation and add a focused adapter. If it does not, add conservative same-prototype/constructor-this binding with explicit provenance; avoid global method-name matching. Keep dynamic request/response call resolution a separate, harder feature.

### D9. Nested function decisions inflate the enclosing function's complexity

Severity: medium for hotspot/relay ranking. Size: S if omission remains policy; M if locals become symbols.

Evidence: [src/core/ts/references.ts:123](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/references.ts#L123) changes fn only on recorded scopes. It walks omitted function bodies under the outer function's counter. [src/core/ts/declarations.ts:4](https://github.com/jonjaques/skyplate/blob/f0f874f82700ec5e5c62beef457e74de95d5841d/src/core/ts/declarations.ts#L4) deliberately omits their declarations.

Minimal repro: `function outer(){ const neverCalled = () => { if (x) return 1; return 2 }; return 0 }`.

Expected: outer direct-body complexity 1, with inner complexity separately accounted or explicitly excluded. Actual: outer complexity 2. See `probes/nested-complexity.ts`.

Fix: reset complexity attribution at every function boundary; create local callable symbols if desired. Keep containment complexity as a distinct aggregate instead of presenting it as the callable body's own McCabe count.

## Ceilings

These are deliberate modeling limits rather than necessarily defects.

1. **This is a static declaration/use index.** Callback registration, dataflow aliases, bind/call/apply and event dispatch are reads unless the syntactic invocation names the declaration. Union properties can name several possible targets. There is no points-to analysis, control-flow path, effect graph or execution proof.
2. **No local refactoring scope.** Locals, parameters, anonymous callbacks and closures have no lookup identity. Ten test callbacks calling a function may collapse to one synthetic module caller. This loses which individual test exercises it.
3. **No positional compiler service.** The MCP has no definition-at-position, type-at-position, implementation-at-position, diagnostics, rename edits, signature-help or code-action tool. Searching a printed name cannot resolve a local name, import alias or overload at an editing cursor.
4. **No external API/type graph.** External package symbols are omitted. Calls whose values flow through missing package types disappear. Workspace imports resolving to ignored dist declarations do not rebound to source or declaration maps. A low unresolved count does not catch this.
5. **Coverage is a file/config ownership choice.** One project owns each file; alternate builds/customConditions can bind that same source differently. Root aggregate oracle agreement does not establish correctness under every project configuration.
6. **No stable cross-refresh handles.** IDs follow sorted file/declaration order and change after insertions. There is no source hash or required snapshot version in symbol selectors, so an agent should re-resolve IDs after refresh.
7. **Unused means no observed in-repo consumer.** Entry/public API protection is conservative and file-based. Framework discovery, string registries, generated consumers and outside users remain outside the proof. Private export deletion is unsafe when the corresponding consumer analysis is incomplete.
8. **Printed signatures are for reading.** Clipping, overload flattening, alias names and erased generic substitutions prevent reliable mechanical signature-change planning.
9. **Freshness is full rebuild.** Warm small-project runs are fast, but edits re-open the compiler and revisit all owned files. The 20,000-file cutoff removes the whole symbol layer by default.

### Fitness for an editing agent

| Task | Needed for safe work | What today's answers supply | Missing |
| --- | --- | --- | --- |
| Rename | Position-based identity; all aliases/declarations/uses; exact spans; complete snapshot | Named declaration, many compiler-resolved refs with line/column; source can be read | Locals/params, missing members/host aliases, all pages, rename semantics for shorthand and exported names, versioned edit plan |
| Change signature | Resolved overload/generics, argument mapping, implementations, call context, type errors | Counts, clipped signature, direct invocation list, one-level base callers | Structured parameters, overload selection, higher-order calls, complete inherited family, diagnostics and validation |
| Move | Import/export rewrite sites, alias/path/package boundaries, declaration source maps | File import graph and symbol references/impact | Export-name identity, source/dist rebinding, package condition variants, planned edits |
| Delete | Complete positive/negative coverage, entry/dynamic/public consumers, tests | Four unused-export classes, entry flags, host direct protection, observed refs | Coverage gating; host barrels; runtime registries; reliable incomplete/capped-result semantics |
| Implement a fitting feature | Nearby examples/types, module contract, consumers, tests, compiler feedback | Search, source, seams/interface, direct heritage and dependency graph | Type queries, precise implementation search, test-case identity, diagnostics, concise task-specific evidence bundles |

A practical next product could remain read-only: emit a versioned refactoring evidence bundle with exact editable sites, the complete type/implementation family, identified tests, diagnostics and coverage reasons. That would give an editing agent a defensible starting point without having Skyplate mutate code.

## Frontier

Ranked by expected agent benefit divided by implementation effort. Sizes are estimates, not measured implementation plans. Success measures are proposed acceptance criteria.

| Rank | Change | Impact / effort | How to measure success |
| --- | --- | --- | --- |
| 1 | Coverage-aware negative answers and diagnostics, fixing D4/D7 | Very high / M | Inject one project/batch failure and one missing workspace dependency; preserve positive results but emit zero confident dead-export/hide verdicts for affected coverage. Every zero-result query explains excluded/unresolved/failed sources. |
| 2 | Complete reference paging and editing context, fixing D5 | Very high / S/M | Fetch all 3,000/30,000 locations exactly once with cursors; include end spans, kind, source hash and surrounding statement. No inaccessible `more` tail. |
| 3 | Record type-literal and object members, fixing D1 | Very high / M | Equivalent interface/type and class/object fixtures yield the same member reference recall. Expand real samples to at least 100 props/methods and gate ≥99% precision/recall on supported static forms. |
| 4 | Persist exported names/aliases/star mappings, fixing D2 | Very high / M | Every direct/default/alias/star/namespace host fixture is protected under multiple barrel levels. Compare unused exports with independent export-resolution ground truth; zero false-dead fixtures. |
| 5 | Complete implementation/member families and inheritance impact, fixing D3 | High / S/M | Arbitrary-depth chains and diamonds return dispatch callers with direct/possible provenance; no static/private cross-links or duplicate locations. |
| 6 | Versioned position-based compiler queries | Very high / M | Definition/type/implementation/diagnostics at every probe cursor matches the native compiler. Stale source hashes are rejected. Named aliases and local parameters work without guessed identifiers. |
| 7 | Keep compact semantic aggregates independent of stored locations, fixing D6 | High / M | Every seam/unused count/classification remains invariant across reference caps from zero to uncapped. Only location completeness changes. |
| 8 | Project-aware incremental snapshots and stable symbol identities | High / L | On a real 20k-file repo, one-file changes avoid full reparse/recheck where compiler dependencies permit; measure p50/p95 query-to-fresh latency and peak combined RSS. IDs for unchanged symbols stay stable. |
| 9 | Local callable/test identities plus selective higher-order propagation | High / L | Distinguish named/anonymous local functions and individual test cases. On manually labeled callback/array/event/alias cases, report possible versus proven calls separately; measure precision before optimizing recall. |
| 10 | Source/dist/declaration-map and framework-host adapters | High / L | Workspace source and built/declaration-map installs identify the same logical implementation. Vue/Svelte/Astro script/template positions map to source; compare each host's references with its language service. |

CommonJS prototype binding should accompany rank 3 or rank 9 as a targeted supported pattern. Begin with Express View's constructor/prototype relationship, not speculative global property-name matching. Nested complexity, D9, can be corrected independently as a small fix.

## Friction log

1. Used the skill's temporary stdio recipe with the checkout's installed MCP client, no registration/settings changes. `open {watch:false, wait_seconds:120}` finished in about 1.51 s. `search_symbols`, `symbol`, `seams`, `seam`, and `close` ran. Full structured outputs and freshness fields are preserved in `mcp.jsonl`; no stale result was observed.
2. `symbol {name:'run', limit:3}` returned a useful ambiguity error: eight matches, IDs and source paths, with advice to narrow path/kind. Good behavior; no guessed result.
3. I tried `symbol {path:'src/core/ts/index.ts', line:53}`. It returned only `pass a symbol id or name`. The useful missing capability is symbol/definition at cursor; the schema does not take line. I fell back to source reading and rg for AST coverage.
4. I guessed `seams {path:'src/core/ts', limit:5}`. The unsupported path was silently discarded, and the tool returned globally ranked modules. The first row was viewer/charts, not the requested directory. `seam {path:...}` was the correct single-selection tool. Unknown keys should fail rather than silently alter a research question.
5. `symbol` references advertise more, but there is no reference offset. The dedicated 3,000-site experiment confirmed a repeat with offset returns the same prefix. I needed direct table access for full measurements.
6. The combined symbol answer is useful for orientation but returns summary, caller/callee lists, type uses, references and impact together. Small requests returned several KB; large selectors require manual budget control. Independent paged reference/caller queries would make edit planning cheaper.
7. Search ranks declarations well but cannot find omitted object/type members, a local helper, or a parameter. For these I used rg/AST inspection and scratch fixtures.
8. The MCP exposes interface/test-file signals, but no test-case identity or compiler diagnostics. I used the actual TS test runner and an independent compiler service rather than interpreting interface counts as validation.
9. The installed pnpm rejected Query's workspace YAML, so the installed-monorepo measurement is not run. `query-install.log` preserves the error. No config edits, manager migration or permission workaround was attempted.
10. Context7 library resolution succeeded. The fetched 5.9.3 docs returned mostly old harness baseline snippets, including an example explicitly marked as having compilation errors. I checked the installed language-service API and executed the oracle instead of relying on that example. No outside survey was performed here; that is [prior-art.md](prior-art.md).
11. Early oracle iterations needed alias and declaration normalization. I fixed the scratch harness, reran it, and retained the final oracle scripts/results. The final Express factory trace distinguishes an oracle limitation from the one verified Skyplate miss.

Not run: Query with dependencies installed; a separate deployed React application outside the Query monorepo; runtime/browser execution, real 20k/50k repositories, heap sampling, cold-cache repetitions, native tsgo LSP oracle, framework language-service adapters, full suite/typecheck/build. Tests ran only the existing TS file. Fault injection models one resolution failure, not every native process/I/O failure.

Cleanup: all three public clones, their installed dependencies, the copied absent-dependency Skyplate tree, and generated scale source trees were deleted. Retained notes, scripts, small fixtures and JSON evidence are now in [evals/typescript/](../../../evals/typescript/). The repository was left clean and no started process remains running.

