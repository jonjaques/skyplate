/**
 * The tool surface: what an agent sees in tools/list, and how each call becomes a query.
 *
 *   createServer(workspace)     one McpServer per connection, over a shared Workspace
 *
 * Design rules for the tools, and why:
 * - Few tools, each one question with parameters, rather than one tool per view: every tool
 *   costs context in every turn of every session the server is attached to.
 * - Every query tool takes `project` and works without it when one project is open, so the
 *   common case (one repository) never repeats a path. A directory path not yet open is opened
 *   on the spot.
 * - Long work never blocks past `wait_seconds`. Every client puts its own deadline on a tool
 *   call (Codex's tool_timeout_sec, for one), and an analysis of a large repository takes
 *   minutes, so a call that runs out of time returns the job's state, and `status` waits for
 *   it. Progress notifications go out while waiting when the client asked for them.
 * - Failures a caller can fix (an unknown path, an ambiguous name) are tool errors that say
 *   what to pass instead, never protocol errors: the model reads them and retries.
 */

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod";
import pkg from "../../package.json" with { type: "json" };
import { parseSize } from "../cli/args";
import type { Severity, SymbolKind } from "../shared/schema";
import {
  CATEGORY_NAMES,
  dependencies,
  dir,
  file,
  FILE_FLAGS,
  FILE_SORTS,
  fileId,
  files,
  findings,
  graph,
  GRAPH_VIEWS,
  history,
  HISTORY_VIEWS,
  overview,
  QueryError,
  resolveSymbol,
  SEAM_SORTS,
  seam,
  seams,
  searchSymbols,
  symbol,
  SYMBOL_SORTS,
  symbolsInRange,
} from "./query";
import { render } from "./text";
import type { AnalysisOverrides, Project, Snapshot, Workspace } from "./workspace";

const SYMBOL_KINDS = [
  "function",
  "method",
  "constructor",
  "getter",
  "setter",
  "property",
  "variable",
  "class",
  "interface",
  "type",
  "enum",
  "namespace",
  "component",
  "hook",
  "module",
] as const satisfies readonly SymbolKind[];

const SEVERITIES = ["critical", "warning", "notice", "info"] as const satisfies readonly Severity[];

/** How long a long-running tool waits before answering with the job's state. */
const LONG_WAIT_S = 45;
/** How long a question waits for a refresh of stale data before answering from the old one. */
const QUERY_WAIT_S = 20;
const MAX_SOURCE_LINES = 400;

const INSTRUCTIONS = `Skyplate measures a codebase: every file classified and sized, the import graph, git history (churn, ownership, co-change, hotspots), and for TypeScript and JavaScript the compiler's symbols, references and call graph.

Start with open: a project directory is analyzed live, in memory, and watched for changes; a Skyplate report folder is read as written. It returns the overview. Then: files, file and dir for the measured tree; search_symbols and symbol for code intelligence (callers, callees, impact); graph for imports; history for git; seams and seam to measure modules at their interfaces (for design reviews); dependencies; findings; read_source. build_report writes a shareable report folder and serve_report serves it over http.

Every query tool takes an optional project (id or path); with one project open it can be left out. Paths are repo-relative; lines are 1-based.`;

// ─── Shared parameters ───────────────────────────────────────────────────────────────────────

const project = z.string().optional().describe("Project id or path (from open or status). Optional when one project is open; a directory path that is not open yet is opened first.");
const waitSeconds = (n: number) => z.number().min(0).max(600).optional().describe(`Seconds to wait for running work before answering with its state (default ${n})`);
const limit = (n: number) => z.number().int().min(1).max(500).optional().describe(`Rows to return (default ${n})`);

const analysisShape = {
  git: z.boolean().optional().describe("Read git history: churn, ownership, co-change, hotspots (default true)"),
  symbols: z.boolean().optional().describe("Run the TypeScript/JavaScript compiler pass for symbols, references and calls (default true)"),
  include_ignored: z.boolean().optional().describe("Include files git or .gitignore would ignore (default false)"),
  exclude: z.array(z.string()).optional().describe("Paths to leave out, gitignore syntax"),
  max_commits: z.number().int().min(1).optional().describe("Newest commits to analyze (default 20000)"),
  ts_max_files: z.number().int().min(0).optional().describe("Skip the compiler pass above this many TS/JS files (default 20000)"),
};

type AnalysisArgs = {
  git?: boolean;
  symbols?: boolean;
  include_ignored?: boolean;
  exclude?: string[];
  max_commits?: number;
  ts_max_files?: number;
  source?: boolean;
  redact_paths?: boolean;
  max_source_file?: string;
  max_source_total?: string;
};

function overrides(a: AnalysisArgs): AnalysisOverrides | undefined {
  const o: AnalysisOverrides = {};
  if (a.git !== undefined) o.git = a.git;
  if (a.symbols !== undefined) o.symbols = a.symbols;
  if (a.include_ignored !== undefined) o.includeIgnored = a.include_ignored;
  if (a.exclude !== undefined) o.exclude = a.exclude;
  if (a.max_commits !== undefined) o.maxCommits = a.max_commits;
  if (a.ts_max_files !== undefined) o.tsMaxFiles = a.ts_max_files;
  if (a.source !== undefined) o.source = a.source;
  if (a.redact_paths !== undefined) o.redactPaths = a.redact_paths;
  try {
    if (a.max_source_file !== undefined) o.maxSourceFile = parseSize(a.max_source_file, "max_source_file");
    if (a.max_source_total !== undefined) o.maxSourceTotal = parseSize(a.max_source_total, "max_source_total");
  } catch (e) {
    throw new QueryError(e instanceof Error ? e.message : String(e));
  }
  return Object.keys(o).length ? o : undefined;
}

// ─── Results ─────────────────────────────────────────────────────────────────────────────────

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const ok = (value: unknown, note?: string): CallToolResult => ({
  ...text(note ? `note: ${note}\n${render(value)}` : render(value)),
  // Scripts should not have to strip a human freshness warning before parsing an answer.
  structuredContent: { data: value, ...(note ? { freshnessNote: note } : {}) },
});
const failed = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Wrap a handler so every thrown error becomes a tool error the model can read. */
function guard<A>(fn: (args: A, ctx: ServerContext) => Promise<CallToolResult>) {
  return async (args: A, ctx: ServerContext): Promise<CallToolResult> => {
    try {
      return await fn(args, ctx);
    } catch (e) {
      if (e instanceof QueryError) return failed(e.message);
      return failed(`skyplate: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

/** A progress sink for a call that asked for progress, else undefined. */
function progress(ctx: ServerContext): ((line: string) => void) | undefined {
  const token = ctx.mcpReq._meta?.progressToken;
  if (token === undefined) return undefined;
  let n = 0;
  return (line) => {
    void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message: line } }).catch(() => {});
  };
}

const seconds = (s: number | undefined, fallback: number) => Math.round((s ?? fallback) * 1000);

// ─── Server ──────────────────────────────────────────────────────────────────────────────────

export function createServer(ws: Workspace): McpServer {
  const server = new McpServer({ name: "skyplate", version: pkg.version }, { instructions: INSTRUCTIONS });

  /** Run `fn` against a project's snapshot, or say the analysis is still running. */
  async function answer(
    ref: string | undefined,
    wait: number | undefined,
    ctx: ServerContext,
    fn: (snap: Snapshot, p: Project) => unknown | Promise<unknown>,
  ): Promise<CallToolResult> {
    const p = await ws.ensure(ref);
    const { snapshot, note, job } = await ws.ready(p, seconds(wait, QUERY_WAIT_S), progress(ctx), ctx.mcpReq.signal);
    if (!snapshot) {
      return ok({ project: p.id, state: "analyzing", job: job?.view(), next: "call status with project and wait_seconds, then ask again" });
    }
    return ok(await fn(snapshot, p), note);
  }

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  // ── Projects ──

  server.registerTool(
    "open",
    {
      title: "Open a project or report",
      description:
        "Open a project directory (analyzed live, in memory, and watched for changes) or a Skyplate report folder (read as written), and return its overview. Opening an open project returns it again; reanalyze forces a fresh analysis. Analysis options apply to live projects.",
      inputSchema: z.object({
        path: z.string().describe("Project directory or report folder"),
        reanalyze: z.boolean().optional().describe("Analyze again even if the snapshot looks current"),
        refresh: z
          .enum(["on_read", "on_change", "manual"])
          .optional()
          .describe("When a live project re-analyzes after files change: on the next question (on_read, default), soon after each burst of changes (on_change), or only on reanalyze (manual)"),
        watch: z.boolean().optional().describe("Watch the directory for changes (default true)"),
        ...analysisShape,
        wait_seconds: waitSeconds(LONG_WAIT_S),
      }),
      annotations: { ...readOnly, idempotentHint: true },
    },
    guard(async (a, ctx) => {
      const p = await ws.open(a.path, { options: overrides(a), refresh: a.refresh, reanalyze: a.reanalyze, watch: a.watch });
      if (p.job && !p.job.settled) await ws.wait(p.job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
      if (p.job?.state === "failed" && !p.snapshot) return failed(`could not open ${a.path}: ${p.job.error}`);
      if (!p.snapshot) return ok({ project: p.view(), next: "still analyzing; call status with wait_seconds, or ask a question with project set and it will wait" });
      return ok({ project: p.view(), overview: overview(p.snapshot.report) });
    }),
  );

  server.registerTool(
    "status",
    {
      title: "Projects, jobs and servers",
      description:
        "List open projects, recent jobs (analyses, builds) and running report servers. With job or project, wait up to wait_seconds for that work to finish and report it.",
      inputSchema: z.object({
        project: z.string().optional().describe("Project id or path to wait on"),
        job: z.string().optional().describe("Job id to wait on (from open or build_report)"),
        wait_seconds: waitSeconds(LONG_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard(async (a, ctx) => {
      if (a.job) {
        const job = ws.job(a.job);
        await ws.wait(job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
        return ok(job.view());
      }
      if (a.project) {
        const p = ws.resolve(a.project);
        if (p.job) await ws.wait(p.job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
        return ok(p.view());
      }
      return ok(ws.list());
    }),
  );

  server.registerTool(
    "close",
    {
      title: "Close a project",
      description: "Stop watching a project and drop its analysis from memory. Report servers keep running (serve_report stop ends them).",
      inputSchema: z.object({ project }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async (a) => {
      const p = ws.resolve(a.project);
      ws.close(p);
      return ok({ closed: p.id });
    }),
  );

  // ── The measured tree ──

  server.registerTool(
    "overview",
    {
      title: "Project overview",
      description:
        "Headline numbers for a project: size, languages, structure (imports, cycles, modules), git (authors, truck factor), code intelligence totals, top hotspots and hubs, the report's findings and warnings.",
      inputSchema: z.object({ project, wait_seconds: waitSeconds(QUERY_WAIT_S) }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => overview(s.report))),
  );

  server.registerTool(
    "findings",
    {
      title: "Findings",
      description:
        "The report's plain-language findings (hotspot concentration, truck factor, knowledge islands, cycles, very large or complex files, unused exports, duplicates…), each with the files, directories or authors it names.",
      inputSchema: z.object({
        project,
        severity: z.enum(SEVERITIES).optional().describe("Only this severity and worse (default info: all)"),
        id: z.string().optional().describe("One finding by id"),
        files_per_finding: z.number().int().min(1).max(500).optional().describe("Files listed per finding (default 10)"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => findings(s.report, { severity: a.severity, id: a.id, limitFiles: a.files_per_finding }))),
  );

  server.registerTool(
    "files",
    {
      title: "Find and rank files",
      description:
        "List files, filtered and sorted by any measure: size, complexity, hotspot (churn × complexity), PageRank, fan-in/out, commits, recency. Generated and vendored files are left out unless asked for. Rows give language, lines, complexity, hotspot, rank, commits and owner.",
      inputSchema: z.object({
        project,
        path: z.string().optional().describe('A directory (everything under it), a file, or a glob such as "src/**/*.test.ts"'),
        query: z.string().optional().describe("Fuzzy path search, ranked like the viewer's command palette"),
        language: z.string().optional().describe('Language name or id, e.g. "TypeScript", "go"'),
        category: z.enum(CATEGORY_NAMES as [string, ...string[]]).optional().describe("A category (code, test, docs, config, build, data…) or a group (asset, markup)"),
        flag: z
          .enum(FILE_FLAGS)
          .optional()
          .describe("Only files with this property; unimported = code no file imports and nothing declares an entry point (dead-file candidates); entry = declared entry points (package main/bin/exports, files scripts run, knip entries, tool configs); single_owner = one author wrote ≥90%"),
        owner: z.string().optional().describe("Files whose main author matches this name or email"),
        include_generated: z.boolean().optional(),
        include_vendored: z.boolean().optional(),
        sort: z.enum(FILE_SORTS).optional().describe("Largest first; default path order, or relevance with query"),
        limit: limit(30),
        offset: z.number().int().min(0).optional(),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, (s) =>
        files(s.report, {
          path: a.path,
          query: a.query,
          language: a.language,
          category: a.category,
          flag: a.flag,
          owner: a.owner,
          includeGenerated: a.include_generated,
          includeVendored: a.include_vendored,
          sort: a.sort,
          limit: a.limit,
          offset: a.offset,
        }),
      ),
    ),
  );

  server.registerTool(
    "file",
    {
      title: "Everything about one file",
      description:
        "One file's full record: size and complexity, imports and importers, cycle membership, git history (owner, contributors, recent commits, files that change with it), duplicates, the symbols it declares, and findings that name it.",
      inputSchema: z.object({
        project,
        path: z.string().describe("Repo-relative path (absolute paths under the project root work too)"),
        limit: limit(25),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => file(s.report, await s.symbols(), a.path, { limit: a.limit }))),
  );

  server.registerTool(
    "dir",
    {
      title: "Everything about one directory",
      description:
        "A directory's totals, languages, module coupling (afferent, efferent, instability), main owners, hottest files and hubs, child directories and files ranked by code, and findings inside it.",
      inputSchema: z.object({
        project,
        path: z.string().optional().describe('Repo-relative directory; "" or omitted is the project root'),
        limit: limit(30),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => dir(s.report, a.path ?? "", { limit: a.limit }))),
  );

  // ── Code intelligence ──

  server.registerTool(
    "search_symbols",
    {
      title: "Search symbols",
      description:
        "Find TypeScript/JavaScript declarations by name (fuzzy; Class.method works) or list them by kind, path, export status or reference count. Rows carry the id that symbol takes. Unused exports: exported, and nothing outside its file references it.",
      inputSchema: z.object({
        project,
        query: z.string().optional().describe("Name to search for"),
        kind: z.enum(SYMBOL_KINDS).optional(),
        path: z.string().optional().describe("Only symbols declared in this file, directory or glob"),
        exported: z.boolean().optional().describe("Only exported symbols"),
        unused_exports: z.boolean().optional().describe("Only exports nothing outside their own file references"),
        unused_kind: z
          .enum(["unreferenced", "used-in-own-file", "entry-export", "public-api"])
          .optional()
          .describe("Only unused exports of this kind (implies unused_exports); rows carry the kind as a flag, except used-in-own-file"),
        include_tests: z.boolean().optional().describe("Include symbols declared in test files (default true)"),
        sort: z.enum(SYMBOL_SORTS).optional().describe("Default relevance with query, else refs"),
        limit: limit(30),
        offset: z.number().int().min(0).optional().describe("Skip this many rows, to page past limit"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, async (s) =>
        searchSymbols(s.report, await s.symbols(), {
          query: a.query,
          kind: a.kind,
          path: a.path,
          exported: a.exported,
          unusedExports: a.unused_exports,
          unusedKind: a.unused_kind,
          includeTests: a.include_tests,
          sort: a.sort,
          limit: a.limit,
          offset: a.offset,
        }),
      ),
    ),
  );

  server.registerTool(
    "symbol",
    {
      title: "Everything about one symbol",
      description:
        "One declaration from the compiler's view: signature, doc, callers (with call sites), what it calls, types it uses, extends/implements in both directions, callers that reach it through an interface or base method, members, every reference by file, and optionally its change impact (transitive callers). Name it by id, or by name narrowed with path or kind.",
      inputSchema: z.object({
        project,
        id: z.number().int().min(0).optional().describe("Symbol id from search_symbols or another symbol result"),
        name: z.string().optional().describe('Name, or "Class.member"'),
        path: z.string().optional().describe("Narrow a name to a file, directory or glob"),
        kind: z.enum(SYMBOL_KINDS).optional().describe("Narrow a name to a kind"),
        references: z.boolean().optional().describe("List references by file (default true)"),
        impact_depth: z.number().int().min(0).max(6).optional().describe("Also follow callers this many levels out: what a change here can reach (default 0, off)"),
        limit: limit(20),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, async (s) => {
        const S = await s.symbols();
        const id = resolveSymbol(s.report, S, { id: a.id, name: a.name, path: a.path, kind: a.kind });
        return symbol(s.report, S, id, { limit: a.limit, references: a.references, impactDepth: a.impact_depth });
      }),
    ),
  );

  // ── Seams (module design) ──

  server.registerTool(
    "seams",
    {
      title: "Rank modules for a design review",
      description:
        "Every review module (the analyzer's directory modules split for review, or directories at depth) with the signals a deepening review starts from: implementation mass, hotspot, interface as used (symbols code outside uses), exports that could be hidden, symbols only tests reach (tests past the interface), relays (functions that are one call), import fan-in/out, commit spread across modules, co-change with no import (hidden coupling), cycles across. Sorted by one signal; no composite score. Pass a row's selector to seam to preserve its membership.",
      inputSchema: z.object({
        project,
        depth: z.number().int().min(1).max(20).optional().describe("Measure directories at this depth instead of the adaptive review modules"),
        sort: z.enum(SEAM_SORTS).optional().describe("Default hotspot (with history), else code"),
        limit: limit(25),
        offset: z.number().int().min(0).optional().describe("Skip this many module rows, to page past limit"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => seams(s.report, await s.symbols(), { depth: a.depth, sort: a.sort, limit: a.limit, offset: a.offset }))),
  );

  server.registerTool(
    "seam",
    {
      title: "Measure one module at its seam",
      description:
        "One ranked module or recursive path (a directory, file or glob) measured where its interface lives: implementation (code, complexity), the interface as used with outside call sites, callers and files per symbol, exports used only inside, symbols only tests reach, relays (deletion-test candidates), interfaces it declares and their adapters (implementations, test doubles marked), imports and cycles crossing it, and locality: how often its commits stay inside, what changes with it, and co-change pairs with no import between them.",
      inputSchema: z.object({
        project,
        path: z.string().describe("A directory, file or glob; with scope module, the path from a seams row's selector"),
        scope: z.enum(["path", "module"]).optional().describe("Default path expands directories recursively. Module preserves the ranked membership from seams, excluding separately selected children."),
        depth: z.number().int().min(1).max(20).optional().describe("With scope module, the same depth passed to seams; omit for its adaptive review partition"),
        limit: limit(20),
        offset: z.number().int().min(0).optional().describe("Skip this many interface rows, to page past limit"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => seam(s.report, await s.symbols(), a.path, { scope: a.scope, depth: a.depth, limit: a.limit, offset: a.offset }))),
  );

  // ── Structure and history ──

  server.registerTool(
    "graph",
    {
      title: "Import graph",
      description:
        "Questions about the file import graph. dependents / dependencies: files that transitively import, or are imported by, a file, directory or glob (with depth). path: the shortest import chain from path to to. cycles: runtime import cycles, largest first (optionally touching path); loops closed only by `import type` are counted apart and listed with include_type_only. modules: directory-level coupling and instability. hubs: the most depended-on files by PageRank.",
      inputSchema: z.object({
        project,
        view: z.enum(GRAPH_VIEWS),
        path: z.string().optional().describe("The file, directory or glob the view is about (the start, for path)"),
        to: z.string().optional().describe("For path: the file to reach"),
        depth: z.number().int().min(1).max(50).optional().describe("For dependents / dependencies: levels to follow (default 3)"),
        include_type_only: z.boolean().optional().describe("For cycles: also list loops closed only by type-only imports, with the edges that close them"),
        runtime_only: z.boolean().optional().describe("For dependents, dependencies and path: skip type-only imports (default false, all code imports)"),
        limit: limit(40),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => graph(s.report, { view: a.view, path: a.path, to: a.to, depth: a.depth, limit: a.limit, includeTypeOnly: a.include_type_only, runtimeOnly: a.runtime_only }))),
  );

  server.registerTool(
    "history",
    {
      title: "Git history",
      description:
        "What git says about the project. summary: range, authors, truck factor, recent weeks. authors: who, how much, when. commits: filtered by path, author, date, conventional type or subject text. coupling: files that change together (degree = shared commits / commits of the less-changed file). activity: weekly commits and growth, lines added per language. ownership: who owns the code under a path, and who has touched it.",
      inputSchema: z.object({
        project,
        view: z.enum(HISTORY_VIEWS),
        path: z.string().optional().describe("Limit to a file, directory or glob"),
        author: z.string().optional().describe("Author name or email substring"),
        since: z.string().optional().describe("YYYY-MM-DD, or 30d / 12w / 6m / 1y back from now"),
        until: z.string().optional().describe("YYYY-MM-DD, or 30d / 12w / 6m / 1y back from now"),
        query: z.string().optional().describe("For commits: subject text"),
        type: z.string().optional().describe('For commits: conventional-commit type, e.g. "fix"'),
        weeks: z.number().int().min(1).max(520).optional().describe("For activity: weeks to show (default 26)"),
        limit: limit(30),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, (s) =>
        history(s.report, { view: a.view, path: a.path, author: a.author, since: a.since, until: a.until, query: a.query, type: a.type, weeks: a.weeks, limit: a.limit }),
      ),
    ),
  );

  server.registerTool(
    "dependencies",
    {
      title: "External dependencies",
      description:
        "Manifests and the external packages they declare or the code imports, with how many files import each. unused: declared but never imported (tools run from scripts, type packages and plugins land here too). undeclared: imported but declared in no manifest, runtime built-ins and standard libraries left out. builtin: those built-ins (node:fs, Python's json, C headers…).",
      inputSchema: z.object({
        project,
        ecosystem: z.string().optional().describe('e.g. "npm", "pypi", "go", "cargo"'),
        scope: z.enum(["runtime", "dev", "peer", "optional", "build", "unknown"]).optional(),
        filter: z.enum(["unused", "undeclared", "builtin"]).optional(),
        query: z.string().optional().describe("Package name substring"),
        limit: limit(50),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard((a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => dependencies(s.report, { ecosystem: a.ecosystem, scope: a.scope, filter: a.filter, query: a.query, limit: a.limit }))),
  );

  server.registerTool(
    "read_source",
    {
      title: "Read a file",
      description:
        "A file's text with line numbers, and the symbols declared in those lines. A live project reads the file as it is on disk now; a report folder reads what it embedded. Files that look like credentials are never shown.",
      inputSchema: z.object({
        project,
        path: z.string(),
        start_line: z.number().int().min(1).optional().describe("First line, 1-based (default 1)"),
        end_line: z.number().int().min(1).optional().describe(`Last line (default start + 199; at most ${MAX_SOURCE_LINES} lines per call)`),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard(async (a, ctx) => {
      if (a.end_line !== undefined && a.end_line < (a.start_line ?? 1)) return failed("end_line must be at least start_line");
      const p = await ws.ensure(a.project);
      const { snapshot, note } = await ws.ready(p, seconds(a.wait_seconds, QUERY_WAIT_S), progress(ctx), ctx.mcpReq.signal);
      if (!snapshot) return ok({ project: p.id, state: "analyzing", next: "call status with project and wait_seconds, then ask again" });
      const id = fileId(snapshot.report, a.path);
      const f = snapshot.report.files[id]!;
      const got = await snapshot.text(id);
      if ("reason" in got) return failed(`${f.path}: ${got.reason}`);
      const lines = got.text.split(/\r?\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const from = Math.min(a.start_line ?? 1, Math.max(lines.length, 1));
      const to = Math.min(a.end_line ?? from + 199, from + MAX_SOURCE_LINES - 1, lines.length);
      const width = String(to).length;
      const head = [
        `${f.path} · lines ${from}-${to} of ${lines.length} · ${got.origin === "disk" ? "from disk" : "embedded in the report"}`,
        ...(note ? [`note: ${note}`] : []),
        ...(got.changed ? ["note: changed since the analysis; symbol positions may be off"] : []),
      ];
      const declared = symbolsInRange(snapshot.report, await snapshot.symbols(), id, from, to);
      if (declared) head.push(`declared here: ${declared.join("; ")}`);
      const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width)}  ${l}`);
      const tail = to < lines.length ? [`… ${lines.length - to} more lines; continue with start_line ${to + 1}`] : [];
      return {
        ...text([...head, "", ...body, ...tail].join("\n")),
        structuredContent: {
          data: {
            path: f.path, startLine: from, endLine: to, totalLines: lines.length,
            source: lines.slice(from - 1, to).join("\n"), origin: got.origin,
            changedSinceAnalysis: !!got.changed, declarations: declared,
          },
          ...(note ? { freshnessNote: note } : {}),
        },
      };
    }),
  );

  // ── Building and serving ──

  server.registerTool(
    "build_report",
    {
      title: "Build a report folder",
      description:
        "Write a Skyplate report folder (the 3D plate, dashboard, explorer and source reader; opens by double-clicking index.html). Reuses a current live analysis when the options match, else analyzes. Defaults to a per-project folder in the user cache directory; never writes into the project unless out says so, and only replaces a folder that is empty or already a report. Runs as a job: returns its state after wait_seconds.",
      inputSchema: z.object({
        project,
        path: z.string().optional().describe("A project directory to build without opening it"),
        out: z.string().optional().describe("Report folder to write (default: <user cache>/skyplate/reports/<name>-<hash>.skyplate)"),
        json: z.boolean().optional().describe("Also write data/report.json"),
        source: z.boolean().optional().describe("Embed file contents (default true; false for reports you share)"),
        redact_paths: z.boolean().optional().describe("Leave the absolute project path out of the report"),
        max_source_file: z.string().optional().describe('Largest file to embed, e.g. "512k"'),
        max_source_total: z.string().optional().describe('Total embedded source, e.g. "64m"'),
        ...analysisShape,
        serve: z.boolean().optional().describe("Serve the finished report on localhost"),
        open_browser: z.boolean().optional().describe("Serve it and open it in the user's browser"),
        port: z.number().int().min(0).max(65535).optional(),
        wait_seconds: waitSeconds(LONG_WAIT_S),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    guard(async (a, ctx) => {
      let p: Project | undefined;
      if (a.path === undefined || a.project !== undefined) p = await ws.ensure(a.project);
      else {
        try {
          p = ws.resolve(a.path);
        } catch {
          p = undefined; // a directory nobody opened: build it directly
        }
      }
      const job = ws.build({ project: p, path: p ? undefined : a.path, out: a.out, json: a.json, options: overrides(a), serve: a.serve, port: a.port, openBrowser: a.open_browser });
      const done = await ws.wait(job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
      if (job.state === "failed") return failed(`build failed: ${job.error}`);
      return ok(done ? job.view() : { ...job.view(), next: `still running; call status with job "${job.id}" and wait_seconds` });
    }),
  );

  server.registerTool(
    "serve_report",
    {
      title: "Serve a report folder",
      description:
        "Serve a report folder over http on localhost (no-cache, so a rebuild shows on reload) and return its URL; optionally open it in the user's browser. dir defaults to the project's own folder (a report) or its last build. stop ends one server, or all of them.",
      inputSchema: z.object({
        project,
        dir: z.string().optional().describe("Report folder to serve"),
        port: z.number().int().min(0).max(65535).optional().describe("Default 4747, or any free port"),
        open_browser: z.boolean().optional(),
        stop: z.boolean().optional().describe("Stop serving dir (or every report, without dir) instead"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async (a) => {
      if (a.stop) return ok({ stopped: ws.stopServing(a.dir) });
      let target = a.dir;
      if (!target) {
        const p = ws.resolve(a.project);
        target = p.kind === "report" ? p.path : p.lastBuild;
        if (!target) throw new QueryError(`${p.id} has no report yet; build_report first, or pass dir`);
      }
      return ok(ws.serve(target, a.port, !!a.open_browser));
    }),
  );

  return server;
}
