---
name: skyplate-deepen
description: Before restructuring a module, changing its interface or making it testable, measure its callers and seam with Skyplate. Design a smaller interface around existing behavior, preserve contracts, then compare the same measurements after the refactor. Use for deepening shallow modules, choosing a seam, and verifying an interface change. Needs the Skyplate MCP server.
---

# Deepen one module

1. If the location is unclear, use `locate_code { query, project }` and
   `map_codebase { path, project }`. Read the relevant code and domain glossary/ADRs.
2. Save `seam { path, project }` and `change_impact { paths: [path], project }` before
   editing. For a ranked candidate, pass its `seams` selector unchanged to `seam`.
3. Read [the design vocabulary and evidence](references/design.md) for the terms module,
   interface, implementation, depth, seam, adapter, leverage and locality. It also explains
   dependency categories, test contracts, misleading measurements and the credited process.
4. Read the interface rows, relays, tests that reach internals and both sides of co-change
   pairs. Describe the concrete friction. Measurements alone do not justify a refactor.
5. Sketch alternatives under different constraints and choose the one that concentrates
   complexity behind the smallest useful interface. Preserve determinism, precision,
   performance and CPU/GPU parity tests. Implement within the user's authorized scope.
6. Compare the same seam selector after editing. `change_impact { working_tree: true }`
   reviews the uncommitted diff: changed declarations, users outside it, missing co-change
   partners and exports left unused. Deleted files are only listed; search for their former
   importers. Run required checks and the
   relevant tests, using the repository's test commands.

Report measured before/after interface size, callers, crossing cycles and any orphaned
exports, with freshness notes. Co-change and commit spread cannot show the improvement
until later commits exist. Test candidates measure static use, not runtime coverage.

The supporting reference retains the design principles, attribution and MIT license adapted
from Matt Pocock's `codebase-design` skill.
