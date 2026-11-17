# Changelog

What changed for people and agents using Skyplate. Earlier versions are described in their
[GitHub releases](https://github.com/jonjaques/skyplate/releases). Defect and enhancement IDs
refer to [docs/roadmap](docs/roadmap/README.md).

## 0.3.0 (unreleased)

The package is at `0.3.0-rc.0` on the release branch and is not published.

### Added

- **Three task tools for agents**, registered first so hosts that show only tool names still
  surface them:
  - `map_codebase` maps a repository or subtree several levels deep in one bounded answer:
    size, languages, entry points, used exports, hotspots and git attention, with small
    branches collapsed;
  - `locate_code` ranks the directories and files where a concept lives, from paths, symbols,
    doc comments, commit subjects, packages and a bounded source scan, with the evidence for
    each;
  - `change_impact` gives the blast radius of a planned change (dependents, compiler users,
    test candidates, co-change, owners, warnings), and with `working_tree: true` reviews the
    uncommitted diff against `HEAD`.
- **`skyplate bench <path>`** and the MCP `benchmark` tool write an anonymous measurement of one
  analysis: phase timings, import resolution per language, compiler coverage, caps that took
  effect, answer sizes and latencies, coded anomalies, and the session's tool usage. Every value
  is a number, a boolean or a string from a closed vocabulary, validated before anything is
  written. `--skeleton` adds the anonymous tree and import graph, and
  `skyplate bench synth` rebuilds a synthetic repository from it. See
  [docs/benchmark.md](docs/benchmark.md).
- **Every list an answer cuts can be read to its end.** `files`, `search_symbols`, `symbol`
  (its reference locations), `seams`, `seam`, `graph`, `history` and `dependencies` all take
  `offset` and return `nextOffset` while `more` rows remain. `symbol` used to stop at 2,500
  locations (T5), and `graph`, `history` and `dependencies` could not page at all (M4). A
  `graph` cycles answer that holds one cycle lists all its members.
- **A "Share a benchmark" issue form**, the return path for a benchmark its owner chooses to
  send (E12).
- **`edges.packages` in the Report**: for each import of a package directory, how many member
  files it stands for and how many got an edge (optional; older reports still load). Answers
  from `file`, `graph` and `change_impact` say when a list rests on a capped projection (S2).
- **The roadmap**, [defects](docs/roadmap/defects.md) and
  [enhancements](docs/roadmap/enhancements.md), with the studies behind them, and
  [evals/](evals/) to rerun every number.

### Changed

- **An argument a tool does not take is now an error** that lists the ones it does. It used to
  be dropped, which answered a different question without saying so (M1). A client that sends
  extra arguments will see the error. Every call rejected for its arguments is counted in the
  benchmark's session usage.
- **The MCP server computes the viewer's layout only when it writes a report.** No answer
  reads it; a full MCP analysis of a synthetic 6,000-file tree took 94% less time.
- **A first analysis answers in two steps.** A structure pass (no history, symbols or layout)
  answers `map_codebase`, `locate_code`, `overview`, `files`, `file`, `dir`, `graph`,
  `dependencies` and `read_source`, with a note, while the full analysis runs. On a cold
  32k-file repository the first answer took 2.1 s instead of waiting for history.
- **No `open` needed first.** With no project open, tools use the server's working directory
  when it is a project.
- **Instructions, tool descriptions and the three skills lead with the moment** an agent is in
  (about to search, about to rename, done editing), and answers end with a hint at the next
  call. The project README has a five-line instruction for `AGENTS.md` or `CLAUDE.md`; in a
  one-pass measurement it took Codex from none of eight task prompts to all eight.
- **Answers on a shallow clone say** that owners, co-change and churn may be weak evidence (M3).
- **`token_budget`** accepts values down to 100, and `map_codebase` accepts `depth: 0` (M2).

### Fixed

- Impact through inherited members follows the whole base chain, with a cycle guard, instead
  of one level (T3).
- "Dependencies installed" means the declared packages resolve along Node's search path, not
  that some ancestor directory has a `node_modules`; a package nested in an unrelated install
  now warns that its types are missing (T7).
- A nested function's decisions no longer count toward the enclosing function's complexity
  (T9).
- Python imports under `if TYPE_CHECKING:` are type-only edges, so they close no runtime cycle
  (S3).
- An extensionless `#include <header>` the repository holds resolves to it instead of being
  called a system header (S8).
