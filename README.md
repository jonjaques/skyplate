<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/skyplate-lockup-dark.svg" />
    <img src="docs/brand/skyplate-lockup-light.svg" alt="Skyplate" width="297" height="54" />
  </picture>
</p>

Point Skyplate at any project and get a static report folder: a 3D plate of every file, a
statistics dashboard, a source reader, and TypeScript code intelligence where picking a
function lights up every file that calls it.

The name comes from astronomical photographic plates: the sky recorded on glass, then
catalogued. Skyplate does that to a codebase. The plate is a cosmic web of the directory tree:
directories are clusters of stars nested inside their parents, strung together by filaments
that stand for the imports between them. A Gravity control picks what pulls files to the center
of their clusters (dependencies, complexity, hotspots, churn, recent change or size), and the
Imports view rearranges every file by the import graph alone.

Skyplate runs on [Bun](https://bun.sh) 1.4 or later. It is published to npm, but it is not a
Node program: the CLI is TypeScript that Bun runs directly, using Bun's workers and file APIs,
so `npx` under Node will not run it.

```sh
bunx skyplate ~/code/some-project     # writes ./some-project.skyplate/
bun add -g skyplate                   # or install the `skyplate` command
```

Open `some-project.skyplate/index.html` straight from disk, or serve it:

```sh
skyplate serve some-project.skyplate --open
```

The folder is self-contained and static, so it can be zipped, attached, or dropped on any
static host. Run `skyplate --help` for every option. The ones people reach for:

| Option | What it does |
| --- | --- |
| `-o, --out <dir>` | where to write the report (default `./<project>.skyplate`) |
| `--open` | serve the finished report and open it |
| `--no-source` | embed no file contents, for reports you share |
| `--redact-paths` | leave the absolute project path out of the report |
| `--no-git` / `--no-symbols` | skip history / skip TypeScript analysis |
| `--exclude <glob>` | leave paths out (gitignore syntax, repeatable) |

Skyplate was called starchart before its first release. It still replaces a report folder an
earlier starchart run wrote, and still leaves `*.starchart/` folders inside a project out of the
analysis.

## For coding agents

`skyplate mcp` is an [MCP](https://modelcontextprotocol.io) server that hands an agent the same
analysis without writing a report: point it at any directory and it analyzes it in memory,
watches it, and re-analyzes after files change. It can also read an existing report folder,
and build and serve new ones.

```sh
claude mcp add skyplate -s user -- bunx skyplate mcp     # Claude Code
codex mcp add skyplate -- bunx skyplate mcp              # Codex
```

Its tools answer the questions the report does: `overview`, `findings`, `files` (filter and
rank by any measure), `file` and `dir` records, `search_symbols` and `symbol` (callers with call
sites, callees, the type hierarchy, every reference, change impact), `graph` (dependents, import
paths, cycles, module coupling, hubs), `history` (authors, commits, co-change, activity,
ownership), `seams` and `seam` (modules measured at their interfaces: what code outside actually
uses, what could be hidden, what only tests reach, relays, co-change no import explains),
`dependencies` and `read_source`. `build_report` and `serve_report` write and serve
a report folder; builds go to the user cache directory unless told otherwise, never into the
project. Paths given after `mcp` are opened at startup, and `--refresh on_change` re-analyzes
after every burst of edits rather than on the next question.

For runtime impact, pass `runtime_only: true` to `graph`'s `dependents`, `dependencies` or
`path` view to omit explicit type-only imports. `seams` supports `offset` and `limit` for
module rankings. Pass a ranked row's `selector` to `seam` to keep the same module membership
and depth; a plain `seam { path }` measures the entire directory recursively. Entry-point and
published-package exports are protected from suggestions to hide them, even when used locally.
Ranked file counts use the same own production files as the drilldown, with tests counted
separately. Hidden coupling counts co-change pairs with no import path within four hops in
either direction, using the same classification in both tools. These are leads for source
inspection; dependency injection and required registries can explain missing import paths.

Successful calls include `structuredContent.data` for scripts as well as readable text.
`structuredContent.freshnessNote` explains when a result uses an older analysis. From a
checkout, run `bun /absolute/path/to/skyplate/bin/skyplate.ts mcp` to use that checkout's tools.
The [skyplate skill](.agents/skills/skyplate/SKILL.md#is-the-server-attached) includes a temporary
stdio-client recipe for local dogfooding without persistent MCP registration.

Three agent skills come with it, in [`.agents/skills`](.agents/skills):

| Skill | For |
| --- | --- |
| [`skyplate`](.agents/skills/skyplate/SKILL.md) | when and how to use the tools |
| [`skyplate-architecture-review`](.agents/skills/skyplate-architecture-review/SKILL.md) | a measured architecture review: modules ranked, code read behind the strongest signals, deepening candidates in an HTML report with the evidence (run it by name) |
| [`skyplate-deepen`](.agents/skills/skyplate-deepen/SKILL.md) | the deep-module vocabulary tied to what `seam` counts, design-it-twice for one module, and a before/after re-measure |

The two design skills adapt Matt Pocock's `improve-codebase-architecture` and `codebase-design`
([mattpocock/skills](https://github.com/mattpocock/skills), MIT). Install all three with
`npx skills add jonjaques/skyplate`.

## What it measures

- **Every file, classified.** All ~800 GitHub Linguist languages and formats by filename,
  extension, content heuristics, shebang, modeline and magic numbers, sorted into code, tests,
  docs, config, data, notebooks, media and binaries, with generated, vendored and
  secret-looking files flagged. Secret-looking files are never embedded.
- **Size and complexity.** Code, comment and blank lines from a string- and comment-aware
  scanner, plus keyword-based complexity, nesting depth, functions and TODOs.
- **Structure.** Imports resolved for 30+ languages (tsconfig paths, workspace packages, Go
  modules, Python packages, Rust modules…), PageRank, import cycles and module coupling.
- **History.** One streaming git pass that follows renames: churn, ownership, co-change
  coupling, weekly activity, growth, hotspots (churn × complexity) and the truck factor.
- **Code intelligence.** For TypeScript and JavaScript, the TypeScript 7 compiler provides
  symbols, every resolved reference with its kind (call, new, JSX, type, import…), the call
  graph, implementations, and unused exports.
- **Findings.** Plain-language observations backed by the numbers, each naming the files or
  people involved.

## Development

From a checkout, `bun install` and then `bun run skyplate <path>` runs the CLI from source; the
first run builds the viewer template into `dist/viewer` (or run `bun run build`).

```sh
bun dev                                         # viewer with hot reload on :4317, serving .skyplate/dev
bun run skyplate <path> --out .skyplate/dev     # point the dev server at a real report
bun test                                        # analyzer, pipeline, CLI, MCP and viewer-logic tests
bun run skyplate mcp <path>                     # the MCP server on stdio, from source
bun check                                       # typecheck (TypeScript 7)
bun scripts/brand.ts                            # regenerate the mark, wordmark and favicon
```

`bun run report:dev` writes a report of Skyplate itself into `.skyplate/dev`.

## License

Skyplate is licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE) for the
copyright and attributions.

`src/core/languages/linguist.generated.ts` is generated from GitHub Linguist's language data
(MIT; the notice is in the file's header). Regenerate it with `bun scripts/gen-languages.ts`.

Every report carries the viewer bundle, so sharing a report redistributes Skyplate and the
open-source packages and fonts bundled into it. Each report folder therefore ships `LICENSE`,
`NOTICE` and `THIRD_PARTY_NOTICES` beside its `index.html`, and the bundled scripts open with a
one-line license banner. [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) lists every bundled package
with its version and license text; `bun run build` regenerates it from what the bundles actually
contain (`scripts/third-party-notices.ts`), so it changes only when they do.
