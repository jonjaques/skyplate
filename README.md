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

Three tools are sized for the moments an agent is in, each one bounded answer that names its
follow-up:

| Tool | The moment | What comes back |
| --- | --- | --- |
| `map_codebase` | sizing up an unfamiliar repository, or one subtree | directories several levels deep as a tree: size, languages, entry points, most-used exports, hottest file, git attention |
| `locate_code` | "where does rate limiting live?" | directories and files ranked for a concept, with the evidence for each: path, symbol, doc comment, commit subject, package, a line of source |
| `change_impact` | before a rename, move, deletion or refactor; and with `working_tree: true`, after editing | dependents and compiler users by module, test candidates, files that usually change with these, owners, cycle and public-API warnings; after an edit, the declarations the uncommitted diff changed, what is missing from it, and exports left unused |

The first call can be the question itself. With no project open, the server uses the directory
it was started in when that is a project (a git repository or a recognizable manifest; never
a home directory or a filesystem root), and any tool takes `project: "/abs/path"`. A first
analysis answers in two steps: files, imports and the graph come first (about two seconds on
a 32,000-file repository), so `map_codebase`, `locate_code`, `files`, `dir`, `graph` and
`read_source` answer from that structure pass, with a note, while git history and the compiler
pass finish.

The rest answer the questions the report does: `overview`, `findings`, `files` (filter and
rank by any measure), `file` and `dir` records, `search_symbols` and `symbol` (callers with call
sites, callees, the type hierarchy, every reference, paged, and change impact), `graph`
(dependents, import paths, cycles, module coupling, hubs), `history` (authors, commits,
co-change, activity, ownership), `seams` and `seam` (modules measured at their interfaces: what
code outside actually uses, what could be hidden, what only tests reach, relays, co-change no
import explains), `dependencies` and `read_source`. `build_report` and `serve_report` write and
serve a report folder; builds go to the user cache directory unless told otherwise, never into
the project. Paths given after `mcp` are opened at startup, and `--refresh on_change` re-analyzes
after every burst of edits rather than on the next question. An argument a tool does not take
is an error that lists the ones it does, not a silently different question.

To make it a habit in one repository, paste this into its `AGENTS.md` or `CLAUDE.md`. It
matters more than it looks: in a one-pass measurement on a 3,000-file repository, Codex called
Skyplate on none of eight task prompts from the tool descriptions alone and on all eight with
this instruction, while Claude Code used it on six from the descriptions alone
([the record](docs/roadmap/research/agent-adoption.md)).

> Before exploring unfamiliar or large areas, use Skyplate `map_codebase` and `locate_code`
> to choose directories and files, then read the strongest evidence. Before a rename, move,
> deletion or refactor, use `change_impact` for dependents, test candidates and co-change.
> After editing, call `change_impact` with `working_tree: true` and run the required checks.
> Preserve freshness warnings; static test candidates are not proof of coverage.

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
The [skyplate skill](.agents/skills/skyplate/SKILL.md#temporary-stdio-client) includes a temporary
stdio-client recipe for local dogfooding without persistent MCP registration.

Three agent skills come with it, in [`.agents/skills`](.agents/skills):

| Skill | For |
| --- | --- |
| [`skyplate`](.agents/skills/skyplate/SKILL.md) | finding the right code before reading it, the change loop (before and after an edit), and what the numbers mean |
| [`skyplate-architecture-review`](.agents/skills/skyplate-architecture-review/SKILL.md) | a measured architecture review: modules ranked, code read behind the strongest signals, deepening candidates in an HTML report with the evidence (run it by name) |
| [`skyplate-deepen`](.agents/skills/skyplate-deepen/SKILL.md) | the deep-module vocabulary tied to what `seam` counts, design-it-twice for one module, and a before/after re-measure |

The two design skills adapt Matt Pocock's `improve-codebase-architecture` and `codebase-design`
([mattpocock/skills](https://github.com/mattpocock/skills), MIT). Install all three with
`npx skills add jonjaques/skyplate`.

## On a repository you cannot share

When Skyplate is slow, wrong or failing on private code, `skyplate bench` measures one analysis
and writes two local files you can read in full before deciding to hand them back:

```sh
skyplate bench ~/code/private-project    # benchmark.json and benchmark.md, in your cache directory
```

They hold numbers and words from Skyplate's own vocabulary only: what each phase cost, how
imports and the compiler pass resolved per language, which caps cut something short, how large
and slow the agent-facing answers were, and coded anomalies that each name the Skyplate source
file to start in. No path, file name, identifier, code, author, commit, package name or date.
Counts are rounded up to a power of two, and a validator rejects any string outside the
shipped vocabulary before anything is written. Nothing is uploaded. `--skeleton` additionally
keeps the exact shape of the directory tree and import graph as anonymous ids, so a maintainer
can rebuild a synthetic repository of the same shape (`skyplate bench synth`); that is more
revealing, and off by default. An agent can make the same files with the MCP server's
`benchmark` tool, which adds how the tools were used in that session.
[docs/benchmark.md](docs/benchmark.md) is the privacy contract, every field, and what each
anomaly code points at. To hand one back, paste `benchmark.md` into a
[Share a benchmark](https://github.com/jonjaques/skyplate/issues/new?template=benchmark.yml)
issue.

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

How accurate each of these is, what is known to be wrong, and what comes next are in
[the roadmap](docs/roadmap/README.md), with [known defects](docs/roadmap/defects.md) and
[planned enhancements](docs/roadmap/enhancements.md) kept apart.

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

The measurements behind the roadmap are rerunnable from [`evals/`](evals/): agent adoption,
TypeScript accuracy against an independent language service, structure and history on seven
repositories in nine languages, the first answer on a large repository, and the benchmark's privacy checks.

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
