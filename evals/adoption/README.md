# Agent adoption eval

This eval measures whether coding agents choose Skyplate's MCP tools while investigating an
unfamiliar repository. Before deciding to look, an agent only sees the server instructions
and the tool and skill descriptions. Adoption is measured as revealed preference: which tools
it actually calls, how early it calls them, and whether its answer meets a rubric written
before the sessions. Descriptions that sound useful do not establish that agents use them.

Ten prompts target Vite. Eight ask for repository investigation; two controls request a
one-line correction or a direct read of a known file. None names Skyplate, MCP or a tool.
Each prompt gets a fresh headless process and a fresh stdio server, sequentially. The two
arms are `codex exec` and `claude -p`. Correctness grades remain separate from tool adoption.

## Files

- `harness/run.ts` runs sessions, probes cold-open latency and generates summaries.
- `harness/selfcheck.ts` checks synthetic event parsing, summary regeneration, output
  isolation, the chart and a fake server's pending-to-ready transition. It launches no agents.
  Its name deliberately stays outside Bun's test discovery patterns.
- `harness/parse.ts`, `summary.ts` and `paths.ts` hold event parsing, aggregation and output checks.
- `harness/chart.ts` generates a standalone HTML chart with an equivalent data table.
- `harness/prompts.json` contains the pinned target, unchanged prompts and grading rubric.
  `investigation.json` and `investigation-history.json` retain independent grading evidence.
- `surface.ts` lists the MCP tools over stdio with the installed client SDK. It opens no project.
- `results/2026-11-16/` preserves sanitized observations and reviews for three runs. Each
  `results.json` is a per-session table with arm, prompt id, exit status, elapsed seconds,
  provider-reported tokens, ordered tool names, first Skyplate position, call count and grade.
  No transcript is required to regenerate its summary.

## Rerun

Use Bun 1.4 or newer and installed, authenticated Codex and Claude Code CLIs. The historical
versions were Codex CLI 0.166.0 and Claude Code 2.1.322. Model and effort used CLI defaults;
record current versions and observed models when comparing. The runner takes executable
paths only from PATH or `--codex BIN` / `--claude BIN`. It does not search app installations
or read account configuration files. A login or nested-session refusal ends that arm.

Run these preparation commands from the Skyplate repository root. Preparation writes only
to a new workspace outside the source tree. The eval itself installs nothing.

```sh
ROOT="$PWD"
WORK="$(mktemp -d)"
VITE_REF=9a8d1a98922c5e445e8a618b8c27f84c63b9fbff
REF=HEAD # Replace with the Skyplate commit being evaluated.

git init "$WORK/vite"
git -C "$WORK/vite" remote add origin https://github.com/vitejs/vite.git
git -C "$WORK/vite" fetch --depth=1000 origin "$VITE_REF"
git -C "$WORK/vite" switch --detach FETCH_HEAD
git -C "$WORK/vite" rev-parse HEAD
git -C "$WORK/vite" rev-list --count HEAD

mkdir "$WORK/skyplate"
git archive "$REF" | tar -x -C "$WORK/skyplate"
(cd "$WORK/skyplate" && bun install --frozen-lockfile)
PIN="$(git rev-parse "$REF")"

bun "$ROOT/evals/adoption/surface.ts" "$WORK/skyplate" > "$WORK/surface.json"
bun "$ROOT/evals/adoption/harness/run.ts" \
  --skyplate "$WORK/skyplate" --skyplate-ref "$PIN" --repo "$WORK/vite" \
  --arms codex --out "$WORK/codex"
bun "$ROOT/evals/adoption/harness/run.ts" \
  --skyplate "$WORK/skyplate" --skyplate-ref "$PIN" --repo "$WORK/vite" \
  --arms claude --out "$WORK/claude"
bun "$ROOT/evals/adoption/harness/run.ts" \
  --skyplate "$WORK/skyplate" --skyplate-ref "$PIN" --repo "$WORK/vite" \
  --arms codex --codex-repository-instructions --out "$WORK/codex-with-instruction"
```

A checkout or prepared Git worktree with dependencies installed also works as `--skyplate`.
Use an immutable source while sessions run. `--skyplate-ref` records provenance for a Git
archive, which has no `.git`; it does not fetch or select a revision. The target intentionally
has no installed dependencies. The original clone had 3,007 tracked files and 3,230 reachable
commits. Its exact shallow boundary was not preserved. The procedure pins the same file
contents, but reachable history may differ. Record the actual history count and shallow
status, especially when comparing ownership and co-change answers. Git depth counts
generations, not total commits.

To compare against the old implementation, repeat preparation with
`REF=f0f874f82700ec5e5c62beef457e74de95d5841d` and new output directories. The later sessions
used an uncommitted snapshot of the tool changes that landed in `a2c5801`. That commit also
added three fixes after measurement: a `symbol` follow-up hint in `change_impact`, a
shallow-history owners note, and acceptance of `map_codebase` depth zero and token budgets
as low as 100. Its parent is the baseline, not a reproducible changed snapshot. Use `a2c5801`
as the nearest committed comparison, and disclose those differences.

`--arms codex,claude` runs both arms in one output. `--subset 03-rename,06-risk` selects
prompts. `--prompts FILE` overrides the default input beside the runner. `--cold-only` probes
the server without launching agents. Every `--out` must be absent, its parent must exist,
and it must be outside the analyzed repository and Skyplate checkout, including through
symlinked parents. Chart and summary commands also require new output directories.

Before running, record a short private description of relevant global instructions and
installed skills, the CLI versions, models and effort, target history depth, and whether
caches were warm. Global instructions and normal skill discovery remain in effect. Keep
their text private. This setup measures adoption in that environment, not an instruction-free
model. The optional instruction is delivered to Codex as per-invocation developer instructions.
It is not discovered from disk or scoped like an actual AGENTS.md. Its exact text is in the
instruction run's `results.json`.

## Grade and compare

Read each private final answer and the evidence it used. Grade against the corresponding
prompt's `goodAnswerMustContain` and the top-level rubric in `harness/prompts.json`. Inspect the
independent investigation inputs for sizing, rename and history checks. A failed startup is
ungraded. Save `grades.json` in the run's output directory, using this shape:

```json
{
  "codex": {
    "01-env": {
      "grade": "correct",
      "gradeReason": "All material requirements are supported by repository evidence."
    }
  }
}
```

Valid grades are `correct`, `partly` and `wrong`. Then regenerate a summary and chart:

```sh
bun "$ROOT/evals/adoption/harness/run.ts" \
  --summarize "$WORK/codex" --out "$WORK/codex-reviewed"
bun "$ROOT/evals/adoption/harness/chart.ts" \
  "$WORK/codex-reviewed/results.json" --out "$WORK/codex-chart"

bun "$ROOT/evals/adoption/harness/run.ts" \
  --summarize "$ROOT/evals/adoption/results/2026-11-16/baseline" \
  --out "$WORK/historical-summary"
bun "$ROOT/evals/adoption/harness/selfcheck.ts" --out "$WORK/selfcheck"
```

Summary generation works from the public records without transcripts or installed agent
CLIs. `--reparse` is only for a private run that still has its event and wire logs. It
rebuilds counters before summarizing and fails if transcripts are missing. Summaries count
completed sessions with exit zero, separating tasks and controls. Compare raw counts,
correctness, median tool calls and elapsed seconds against all three historical runs.

Positions start at one and include every observed tool invocation, including instruction and
skill reads. Multiple shell commands in one invocation count once. MCP handshakes do not count.
Parallel calls follow event observation order, not completion order. Repeated start/completion
events are deduplicated; plan updates count distinct states. Wire logs independently check
MCP call counts. Hidden CLI operations and unverified execution claims are not added to totals.
Tokens are provider-reported; cache accounting differs between providers and cost is not
estimated when absent.

## Results on 2026-11-16

| Arm | Run | Tasks using Skyplate / 8 | First tool | First three | Controls using Skyplate / 2 | Correct / partly / wrong |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Codex | baseline | 0 | 0 | 0 | 0 | 9 / 1 / 0 |
| Claude Code | baseline | 3 | 2 | 2 | 0 | 9 / 1 / 0 |
| Codex | changed | 0 | 0 | 0 | 0 | 10 / 0 / 0 |
| Claude Code | changed | 6 | 3 | 5 | 0 | 10 / 0 / 0 |
| Codex | changed with instruction | 8 | 0 | 8 | 0 | 10 / 0 / 0 |

Claude Code with the instruction was not run. Claude Code's median tools per prompt fell
from 33 to 26.5. Codex used Skyplate within its first three calls on every task with the
instruction, after initial shell discovery. Neither agent used it on a control.

| Measurement | Tools | tools/list characters | Instructions characters |
| --- | ---: | ---: | ---: |
| Baseline | 18 | 26,582 | 882 |
| Reported after comparison | 22 | 33,241 | 1,156 |
| Captured changed session dump | 22 | 33,215 | 1,156 |

`surface.ts` uses `JSON.stringify(tools).length`, a compact tools array without the result
object or JSON-RPC envelope, and the instruction string's `.length`. Units are UTF-16 code
units. `results/2026-11-16/surface.json` keeps both the reported totals and recomputed dump
sizes, with per-tool description lengths from the session dumps. The captured changed dump
is 26 characters shorter than the reported later comparison. An earlier development snapshot
had 21 tools, 29,892 tools/list characters and 865 instruction characters; it was not used
for the changed sessions. A live checkout measurement while packaging this eval returned
22 tools, 33,241 tools/list characters and 1,156 instruction characters.

| Run | Completed sessions | Sum of session elapsed time | Claude Code reported cost, USD |
| --- | ---: | ---: | ---: |
| Baseline | 20 | 37.3 minutes | 10.10 |
| Changed | 20 | 39.3 minutes | 10.07 |
| Changed with instruction | 10 | 9.1 minutes | unavailable |

These 50 completed sessions took about 85.6 minutes in total, excluding preparation,
interrupted attempts and grading. Claude Code reported 20.17 USD across its 20 sessions.
Codex reported token usage but no dollar cost, so that figure is not the total experiment
cost. Ten minutes per session is the timeout, plus up to five seconds to terminate processes.
Budget roughly this duration for one pass; future models, caches and repositories can differ.

## Safety, publication and limits

Codex uses its read-only sandbox, ephemeral execution, approval policy `never` and
`--ignore-user-config` so the per-invocation MCP map does not merge unrelated account servers.
Authentication and execution-policy checks stay with the CLI. Claude Code uses strict MCP
configuration, read-only built-ins and allowed read commands, with no permission-mode
override. Its behavior also relies on the task instruction and existing permissions; it
has no equivalent OS sandbox here. The proxy preserves tool descriptions and schemas but
rejects `build_report`, `serve_report` and `benchmark`. No permission check is disabled,
and no environment variable is unset to evade nested-session detection.

The runner writes logs, configurations and per-session temporary files only under `--out`.
Provider-managed authentication and global CLI state remain the provider's responsibility.
Each session owns a separate process group; timeout, interruption and normal exit terminate
only processes started by that invocation. Do not stop processes by matching names or ports.
No target or Skyplate input file is edited by the runner. Inspect initial and final Git
status in a private run to detect unexpected writes or source drift.

Keep fresh run directories outside the repository. They contain environment-specific raw
transcripts, invocation arguments, MCP configs, session identifiers, temporary files and
instruction text. The local ignore rules are a backup, not a publication sanitizer. To publish
another run, construct a table using the same explicit fields as the historical `results.json`:
keep numeric token totals and ordered tool names; omit arguments, identifiers, stdout, stderr,
model metadata with environment fields and final answers. Review grade reasons as public prose.
A final answer may only be included after checking every path is repository-relative and all
machine-specific details are removed. This package omits all final answers.

The source archives, Vite clone, raw sessions, help output, configuration files, process records,
stopped inherited-config pilot, source-drift attempt and temporary risk tables are deliberately
absent. Only completed historical sessions are included. Their grades can be summarized again,
but cannot be independently re-audited without the private evidence. Public history evidence
contains Vite contributor names as repository data, not evaluator identity.

One pass per prompt, one repository, one reviewer's grades. These are counts, not rates or a
causal estimate of wording changes. Vite is TypeScript-heavy and analyzed in about 1.7 seconds;
the experiment says nothing about adoption during a slow first analysis. Dependencies were
absent, caches were not flushed, and global instructions influenced first choices. Working-tree
after-edit review was not exercised because the sessions were read-only.
