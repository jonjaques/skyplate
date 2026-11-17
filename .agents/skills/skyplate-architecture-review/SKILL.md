---
name: skyplate-architecture-review
description: When asked where to refactor or for an architecture review, use Skyplate to map the codebase and rank modules by change, interface size, test access and co-change. Read the strongest evidence, propose measured deepening candidates, and compare their callers and risks. Needs the Skyplate MCP server.
disable-model-invocation: true
---

# Find refactors worth doing

1. `map_codebase { project }` sizes the repository. If the task names a feature, use
   `locate_code { query }` to find the neighborhood first. Read its glossary and ADRs.
2. `seams {}` ranks measured candidates. Compare hotspot, hidden coupling, tests reaching
   internals and commit spread. Shortlist areas where several signals agree. One signal is
   a lead, not proof that a refactor would help.
3. Pass each row's `selector` unchanged to `seam`; keep those results as the baseline.
   `change_impact { paths: [path] }` joins dependents, test candidates, owners and warnings.
4. Read the actual interface, callers, test assertions and co-change pairs. Use the
   `skyplate-deepen` vocabulary. Preserve algorithm contracts, determinism, precision and
   CPU/GPU parity tests. Check composition and dynamic registration before treating
   co-change without imports as hidden coupling.
5. Grade candidates as strong, worth exploring or speculative. Explain the concrete
   friction, the proposed seam, affected callers and how the change would be verified.
   Compare alternatives before recommending an interface change.
6. Present the evidence in the format the user requested. For the full review workflow,
   including the HTML report and discussion of a chosen candidate, read
   [the review procedure](references/review.md) and [the report scaffold](REPORT.md).
   Report building writes to the cache, not the analyzed repository.
7. After an implemented change, compare the same seam selector and call
   `change_impact { working_tree: true }` for the declarations the diff changed, their
   users outside it, missing co-change partners and exports left unused. Deleted files are
   only listed; search for their former importers. Then run the repository's required checks.

Preserve freshness notes and limitations. Static test candidates are not runtime coverage;
co-change and spread need future commits before they can demonstrate an improvement.
The `skyplate-deepen` supporting reference retains the credited principles and MIT license
adapted from Matt Pocock's `improve-codebase-architecture` and `codebase-design` skills.
