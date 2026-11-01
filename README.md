# starchart

Point it at any project and get a static report folder: a 3D galaxy map of every file, a
statistics dashboard, a source reader, and TypeScript code intelligence where picking a
function lights up every file that calls it.

```sh
bun install
bun run build                          # build the viewer template once (dist/viewer)
bun run starchart ~/code/some-project  # writes ./some-project.starchart/
```

Open `some-project.starchart/index.html` straight from disk, or serve it:

```sh
bun run starchart serve some-project.starchart --open
```

The folder is self-contained and static, so it can be zipped, attached, or dropped on any
static host. Run `bun run starchart --help` for every option. The ones people reach for:

| Option | What it does |
| --- | --- |
| `-o, --out <dir>` | where to write the report (default `./<project>.starchart`) |
| `--open` | serve the finished report and open it |
| `--no-source` | embed no file contents, for reports you share |
| `--redact-paths` | leave the absolute project path out of the report |
| `--no-git` / `--no-symbols` | skip history / skip TypeScript analysis |
| `--exclude <glob>` | leave paths out (gitignore syntax, repeatable) |

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

```sh
bun dev                                  # viewer with hot reload on :4317, serving .starchart/dev
bun run starchart <path> --out .starchart/dev   # point the dev server at a real report
bun test                                 # analyzer, pipeline, CLI and viewer-logic tests
bun check                                # typecheck (TypeScript 7)
```

`bun run report:dev` writes a report of starchart itself into `.starchart/dev`.

## License notes

`src/core/languages/linguist.generated.ts` is generated from GitHub Linguist's language data
(MIT). Regenerate it with `bun scripts/gen-languages.ts`.
