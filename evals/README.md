# Evals

Rerunnable measurements of Skyplate, the evidence behind every number in
[docs/roadmap](../docs/roadmap/README.md). Each directory has its own README with what it
measures, its inputs (public repositories at recorded commits), the exact commands, how long a
run takes, and what the method does not establish.

| Eval | Question | Study |
| --- | --- | --- |
| [adoption/](adoption/) | Do coding agents call Skyplate unprompted when it is attached, on which prompts, and are their answers right? | [agent-adoption.md](../docs/roadmap/research/agent-adoption.md) |
| [typescript/](typescript/) | Are TypeScript and JavaScript references, calls and unused verdicts right against an independent language service, and what do probes and injected faults do? | [typescript-symbols.md](../docs/roadmap/research/typescript-symbols.md) |
| [structure/](structure/) | Are imports, entries, dependencies, metrics and history right on seven public repositories in nine languages, and what does each phase cost? | [structure-and-history.md](../docs/roadmap/research/structure-and-history.md) |
| [first-answer/](first-answer/) | How long does a cold MCP server take to answer on a large repository? | [roadmap](../docs/roadmap/README.md#where-it-stands) |
| [benchmark/](benchmark/) | Does `skyplate bench` stay anonymous and valid, and does a skeleton rebuild a repository? | [docs/benchmark.md](../docs/benchmark.md) |

## Conventions

- **Results are dated and never overwritten.** A rerun goes in `results/<date>/` beside the
  earlier ones, so a change can be read against its baseline. Update the roadmap's numbers from
  the new results.
- **Corpora are cloned outside the repository**, at the commit the README records, and nothing
  is ever written into a corpus or into this checkout. Every script writes only to an `--out`
  directory that must not exist yet.
- **`fixtures/` are inputs, not our code.** Some are broken on purpose (a failing tsconfig, a
  missing package, foreign syntax), so `tsconfig.json` excludes `evals/**/fixtures`. Everything
  else here typechecks with `bun check`. No file here matches `bun test`'s discovery patterns,
  so the test suite never runs an eval.
- **Nothing private is committed.** The repository is public. Agent transcripts stay out of it
  because they carry the measuring machine's environment; what is committed is the derived
  per-session table, grades and summaries. Benchmarks from private repositories are anonymous
  by construction ([docs/benchmark.md](../docs/benchmark.md)), and only benchmarks of public
  repositories are kept here as samples.
- **One pass is a count, not a rate.** Say how many passes, on how many repositories, beside
  every number.
