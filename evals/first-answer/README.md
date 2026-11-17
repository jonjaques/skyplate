# First-answer timing

`run.ts` starts a new Skyplate MCP process from this checkout and asks `map_codebase`
before any explicit open. It records process-start-to-first-useful-map time, each tool's
call latency, the first `locate_code` result, partial-answer notes, and whether history is
still analyzing. It then waits for full readiness unless `--stop-after-first true` is set.
Finally it closes stdin and records the server's exit code, shutdown time, stderr byte
count, and any forced termination. It kills only its own child if shutdown exceeds five
seconds. Output is `timing.json` in a new external `--out` directory.

This measures whether structure can answer an agent while history and compiler work
continue. A partial answer has file/language/import/graph facts but incomplete history and
symbols. A fast `locate_code` after the map measures reuse of that server's structure, not
an independent cold open. The default query is `source`; the historical Kubernetes query
was `scheduler preemption`. Content scanning is disabled in both cases.

## Rerun

From the repository root, with `WORK` an existing directory outside this checkout:

```sh
bun evals/first-answer/run.ts --project . --query 'benchmark privacy' --timeout-seconds 60 --out "$WORK/first-answer-small"
```

For the public Kubernetes input, use the recorded structure corpus commit:

```sh
python3 -I evals/structure/clone.py --name kubernetes --out "$WORK/kubernetes-input"
bun evals/first-answer/run.ts --project "$WORK/kubernetes-input/repository" --query 'scheduler preemption' --timeout-seconds 1200 --out "$WORK/first-answer-kubernetes"
```

That helper fetches https://github.com/kubernetes/kubernetes.git at
`074eb5db5bbe70923fd2d0af4dc2d0091a539253` with depth 50. Keep its `input.json` alongside the
timing result. The original first-answer clone's commit was not retained, so this is a
documented replacement input, not a claim to reconstruct the exact earlier clone. The
structure study reported 32,005 files and 18,070 commits at this recorded commit. The
separate first-answer study reported 32,016 files and 17,521 commits. Those runs cannot
be equated just because both clones used depth 50.

The default deadline is 900 seconds for the whole measurement. Requests use the remaining
deadline. Status waits are one second while analysis runs. Full readiness is the first
status observation of a completed analysis, so `fullReadyObservedMs` is an upper bound
on completion time. It is not a sum of phase times. A failed analysis, protocol error,
deadline, or unclean shutdown produces a nonzero exit and retains the available evidence.
A completed snapshot can already be stale if the input changes during analysis;
`firstStatus` preserves that state instead of waiting for a permanently quiet working tree.

## Results and duration

`results/2026-11-16/kubernetes.json` transcribes the historical summary. A cold server's
first map arrived at 6.2 seconds before scaling the structure grace, then at 2.1 seconds
after scaling it. The subsequent locate call took 24 ms. The map was partial, history was
still running, and shutdown was reported clean. Neither run was repeated on Kubernetes
during packaging. The retained `staged.ts` client did not wait for full analysis, and no
raw timing log or analyzer commit accompanied it. Full completion time and both original
commit identities remain unknown rather than inferred from the structure study.

`results/2026-11-17/skyplate.json` records the required small rerun. The first map arrived
1,663 ms after process start, its call took 1,607 ms, locate took 5.4 ms, and full readiness
was observed at 1,670 ms. Both answers were complete. The server exited zero after stdin
closed, with no stderr and no forced kill. This is a small changed working tree, so these
numbers do not verify the Kubernetes latency target or estimate its full analysis time.
The result records analyzer/input HEAD and runtime, but uncommitted eval files also
contributed to the analyzed input.

The final client was also run on the pinned Requests clone. `results/2026-11-17/requests.json`
records a first map at 300 ms, locate at 1.8 ms, completed analysis, and clean shutdown.

Cold means a fresh server process and in-memory workspace. Operating-system caches,
filesystem cache, dependencies, concurrent workload, and thermal state are uncontrolled.
No persistent cache is erased. The client asks for bounded answers and omits response
contents and local absolute paths from its saved summary. It creates no report or dev
server and does not write into the analyzed repository.

No S-series accuracy defect is asserted by this timing eval. It measures the latency
behind the staged-analysis proposal and the observation that history can dominate an
otherwise usable structure answer. The original full-history Kubernetes CLI took about
509 seconds in a separate structure run; that number is not a measured completion time
for the first-answer experiment.
