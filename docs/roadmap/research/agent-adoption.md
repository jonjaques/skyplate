# Do agents reach for it? A before and after

> Research behind the [roadmap](../README.md). Measured on 2026-11-16. The harness, prompts,
> grades and per-session results are in [evals/adoption/](../../../evals/adoption/), so the runs
> can be repeated. Raw transcripts are not: they carry the measuring machine's environment.

The question was whether a coding agent with Skyplate's MCP server attached actually calls it,
and whether rewording the tool surface changes that. This is what was observed, including
where the rewording did nothing.

## Method

- **Target:** [vitejs/vite](https://github.com/vitejs/vite) at `9a8d1a98`, 3,007 tracked
  files, 3,230 reachable commits, dependencies not installed. A cold `open` took 1.7 s.
- **Prompts:** ten, written and given grading notes before any session ran, none of which
  mentions Skyplate, MCP or a tool. Eight are tasks (locate a feature, size up directories, a
  rename, a refactor, a dead-code check, risk and ownership, an import cycle, tracing a message
  string) and two are controls where Skyplate should not be used (a one-line fix in a named
  file, reading one known file).
- **Sessions:** one fresh headless session per prompt, read-only, with a fresh server attached
  for that session only. Codex through `codex exec` in its read-only sandbox, user config
  ignored, CLI default model and effort. Claude Code through `claude -p` with read-only
  built-ins and the server's tools allowed. No permission check was turned off.
- **Runs:** `baseline` is commit `f0f874f`. `changed` is the tool surface described in
  [the roadmap](../README.md#030). `changed + instruction` adds the five-line
  instruction from the project README, delivered to Codex as per-invocation developer
  instructions, which is close to an `AGENTS.md` and not the same thing: it is not discovered
  from the filesystem and not scoped to a repository.

## Result

| Arm | Run | Used on task prompts (of 8) | First tool | Within first three | Used on controls (of 2) | Correct / partly / wrong |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Codex | baseline | 0 | 0 | 0 | 0 | 9 / 1 / 0 |
| Codex | changed | 0 | 0 | 0 | 0 | 10 / 0 / 0 |
| Codex | changed + instruction | 8 | 0 | 8 | 0 | 10 / 0 / 0 |
| Claude Code | baseline | 3 | 2 | 2 | 0 | 9 / 1 / 0 |
| Claude Code | changed | 6 | 3 | 5 | 0 | 10 / 0 / 0 |

Claude Code with the instruction was not run.

## What it shows

- **For Claude Code, the surface was enough to move it.** It newly used `change_impact` or
  `symbol` on the rename, refactor and dead-code prompts, and its sizing and risk prompts began
  with `locate_code` and `change_impact` where the baseline began with `open`. Its median tool
  calls per prompt went from 33 to 26.5.
- **For Codex, the surface did nothing and one instruction did everything.** With the same
  tools and descriptions it went from zero of eight to eight of eight, every time within its
  first three calls (after its own shell discovery), and never on a control. A team that wants
  Codex to use Skyplate has to say so in its `AGENTS.md`.
- **Neither agent misused it.** No control prompt drew a Skyplate call in any run.
- **Answers were used, then checked.** Agents followed the leads into source and usually
  confirmed them with a text search. On the rename prompt both got reach counts from
  `change_impact` and went back to a search for the exact sites, which is why a briefing for a
  named symbol now reports its reference count and points at `symbol`.
- **What still loses to a text search**, on Claude Code without the instruction: tracing an
  env-loading feature and tracing a message string. Both hand the agent an exact string, and
  Skyplate has no full-text index.

## What went wrong in the calls

Across 47 Skyplate calls in the three later runs, none returned "analyzing" and none was
rejected for an unknown argument. Three were rejected for values below a minimum
(`map_codebase` with `depth: 0` and with `token_budget: 300`); both are now accepted. On the
risk prompt, agents in two runs found with Git that ownership in a depth-limited clone was
attributed to the snapshot's author; the note on such answers now names owners.

## Limits

One session per prompt and arm. These are counts of what was observed, not rates and not a
causal estimate: a second pass could differ. One repository, TypeScript-heavy and small enough
to analyze in under two seconds, so nothing here measures behavior when the first analysis is
slow. Grades are one reviewer's, against notes written beforehand. The machine's own global
instructions and skills were in effect in every session, and they make Codex open with a shell
command and a skill read, which is why its literal first tool was never Skyplate. The after-edit review
(`change_impact { working_tree: true }`) was not exercised: sessions were read-only.
