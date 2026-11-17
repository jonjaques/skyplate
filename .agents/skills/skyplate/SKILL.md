---
name: skyplate
description: Before searching a large or unfamiliar codebase, find where a feature lives and which directories matter with Skyplate. Use for repository orientation, fitting a feature into the existing design, sizing up directories, before renaming, moving, deleting or refactoring code, and after editing to check what the uncommitted diff can break. Get a bounded map, ranked concept matches, callers, dependents, test candidates, owners and co-change evidence. Also use for unused exports, import cycles and Skyplate reports, and to write an anonymous benchmark when Skyplate itself is slow or wrong on a repository that cannot be shared. Needs the Skyplate MCP server or a local checkout for the temporary stdio recipe.
---

# Find the right code before reading it

Start with the question, using the `skyplate` MCP tools. Add `project: "/abs/repo"` if the
server has not opened the repository. Omit it for the only open project, or when the server's
working directory has a git/project marker. Home directories and filesystem roots never open
implicitly. A report folder also works, but answers describe its saved state.

## Explore

1. `map_codebase { project, token_budget: 1800 }` sizes the repository several levels deep,
   with languages, entry points, used exports and git attention. Narrow `path` to drill down.
   Parent totals include descendants. `collapsed` means children were folded into that row.
2. `locate_code { query: "invoice pdf", project }` ranks directories and files with the path,
   symbol, doc, commit and package evidence behind each. It matches literal terms, not meaning.
   Content/package-import scanning is capped at 200 files and 2 MiB; read `content.partial`.
   Use `content: false` for metadata alone. A commit match means it touched a file, not that
   the file implements the concept.
3. Read the strongest matches with `read_source { path, start_line, end_line }`, or your
   normal file tool. Follow `next` only when it advances the task. Use exact text search for
   strings, dynamic registrations and facts the analysis cannot resolve.

`token_budget` estimates tokens as characters / 4. `budget.omittedRows` says rows were cut;
totals survive. Narrow the subtree or raise the budget when useful.

## Change

1. Before a rename, move, deletion or refactor, call `change_impact { paths: ["src/billing"] }`
   or `change_impact { symbols: [{ name: "renderInvoice", path: "src/billing" }] }`.
   It joins dependents by module, compiler users, test candidates, owners, co-change and
   cycle/public-API warnings. Inspect the relevant callers and tests before editing.
2. For interface design, keep `seam { path }` as a baseline. Use `seams` to choose a module
   when the task is deciding where a refactor would help. Pass a ranked row's `selector`
   unchanged to `seam`; a plain path includes all descendants.
3. Before saying done, call `change_impact { working_tree: true }`. It reads the uncommitted
   diff against HEAD and returns the declarations it changed, their callers and dependents
   outside the diff, test candidates, the files that usually change with these and are
   missing from it, and exports in the changed files that nothing uses now. Deleted files
   are only listed: the analysis no longer holds them, so search for their former importers.
   Compare the same seam selector if an interface changed, then run the repository's
   required checks and the relevant test candidates.
4. For a rename, read every site: `symbol { name, limit }` lists references by file and
   returns `references.nextOffset` while more remain. Pass it back as `offset`.

Test candidates come from imports and references, not runtime coverage. Compiler evidence
covers TS/JS; dynamic and external consumers can be absent. Entry exports and public APIs are
not safe deletion candidates just because in-repo references are absent. Read the doc comment
and check dynamic consumers. [Detailed recipes](references/tool-recipes.md) explain unused
export classes, calls through bases, ownership, cycles and the measurement limits.

## Wait and freshness

A first analysis runs in two steps. Files, languages, imports and the graph come first (about
two seconds on a 32,000-file repository), so `map_codebase`, `locate_code`, `files`, `file`, `dir`, `graph`, `dependencies` and
`read_source` answer from that structure pass while git history and the compiler pass, which
can take minutes on a monorepo, are still running. Such an answer starts with a note saying
so and has no hotspots, owners, co-change or symbols yet: pass the note on, and ask again
later for those. `symbol`, `search_symbols`, `seams`, `history` and `change_impact` wait for
the whole analysis. If a result says `state: "analyzing"`, call
`status { project, wait_seconds: 45 }` and repeat the original question when ready. Do not
reopen it. A live project refreshes lazily after edits; preserve `freshnessNote` and do not
describe a stale result as current. `open` is for explicit options, e.g. `watch: false` or
`max_commits: 100`, not a required handshake before every question.

Successful calls return `structuredContent.data`. Preserve the full envelope, including
freshness notes. Every list an answer cuts says how many rows are left (`more`) and where the
next page starts (`nextOffset`); pass that back as `offset` to read on, in any tool. Secret files are never returned. Analysis does not write into the project.

## When Skyplate itself is slow, wrong or failing

On a repository that cannot be shared, `benchmark { project }` measures one analysis and
writes `benchmark.json` and `benchmark.md` to a new folder in the user's cache directory. They
hold numbers and Skyplate's own vocabulary only: phase timings, resolution rates, caps that
took effect, answer sizes, anomaly codes and this session's tool usage. No path, name, code,
author or date. Nothing is uploaded, and you must not upload or paste the files anywhere
yourself: tell the user where they are and that `benchmark.md` is the whole content, for them
to read and decide. Pass `skeleton: true` only after asking; it also keeps the exact shape of
the directory tree and import graph. Without the server: `bunx skyplate bench /abs/project`.

## Temporary stdio client

If the tools are absent, say so. For one-off work with a local Skyplate checkout and its
dependencies installed, use this recipe without changing MCP registration. Replace both
absolute paths. Keep related calls in this session; `finally` closes the server process.

```sh
bun --cwd /absolute/path/to/skyplate --eval '
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const client = new Client({ name: "skyplate-question", version: "1" });
try {
  await client.connect(new StdioClientTransport({
    command: "bun", args: [process.cwd() + "/bin/skyplate.ts", "mcp"],
  }));
  async function ask(name, args) {
    for (;;) {
      const r = await client.callTool({ name, arguments: args }, { timeout: 150000 });
      if (r.isError) throw new Error(JSON.stringify(r));
      const d = r.structuredContent?.data;
      if (d?.state !== "analyzing") return r;
      const status = await client.callTool({ name: "status", arguments: {
        project: d.project, wait_seconds: 45,
      } }, { timeout: 60000 });
      if (status.isError) throw new Error(JSON.stringify(status));
    }
  }
  console.log(JSON.stringify(await ask("locate_code", {
    project: "/absolute/path/to/project", query: "invoice pdf",
  })));
} finally { await client.close(); }
'
```

For persistent registration, use the host's MCP configuration with command `bunx skyplate mcp`
or `bun /absolute/path/to/skyplate/bin/skyplate.ts mcp`. Bun 1.4+ is required. To share a report,
`build_report { source: false, redact_paths: true }` writes to the user cache and returns its
path; `serve_report` optionally serves it locally.

## Team instruction snippet

Paste into the repository's AGENTS.md or CLAUDE.md:

> Before exploring unfamiliar or large areas, use Skyplate `map_codebase` and `locate_code`
> to choose directories and files, then read the strongest evidence. Before a rename, move,
> deletion or refactor, use `change_impact` for dependents, test candidates and co-change.
> After editing, call `change_impact` with `working_tree: true` and run the required checks.
> Preserve freshness warnings; static test candidates are not proof of coverage.
