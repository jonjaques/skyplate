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
import type { ToolRecorder } from "../core/bench";
import type { Severity, SymbolKind } from "../shared/schema";
import {
  CATEGORY_NAMES,
  changeImpact,
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
  locateCode,
  mapCodebase,
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
import { workingTreeChanges } from "./changes";
import { budgetLists, fitBudget, render } from "./text";
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

const INSTRUCTIONS = `Exploring a large or unfamiliar repository? Use map_codebase to size directories and locate_code to find where a feature lives. Before a rename, move, deletion or refactor, use change_impact for callers, dependents, test candidates, owners and co-change; after editing, change_impact with working_tree: true reviews the uncommitted diff before you say done. For features, locate related code and read the strongest matches before choosing a design.

Ask the question first: project accepts an id or directory/report path and auto-opens paths. With none open, a marked server working directory is used; never a home or filesystem root. A first analysis of a large repository answers map_codebase, locate_code, files, dir and graph in seconds from its structure pass, with a note, while git history and symbols finish; other tools return a status hint until then. Preserve freshness notes. Follow next hints and use bounded results. Paths are repo-relative, lines 1-based. Queries never edit the project. Compiler evidence covers TS/JS; test candidates are static use, not coverage. Check dynamic consumers with exact searches and verify behavior with tests.`;

// ─── Shared parameters ───────────────────────────────────────────────────────────────────────

const project = z.string().optional().describe("Project id or directory/report path; auto-opens paths. Omit for the only open project, or a marked server working directory.");
const waitSeconds = (n: number) => z.number().min(0).max(600).optional().describe(`Seconds to wait for running work before answering with its state (default ${n})`);
const limit = (n: number) => z.number().int().min(1).max(500).optional().describe(`Rows to return (default ${n})`);
// The floor is low on purpose: in a measured session an agent asked for 300 and lost a call to
// a validation error. A small budget cuts rows; it never drops totals or the follow-up.
const tokenBudget = z.number().int().min(100).max(12000).optional().describe("Approximate response tokens, estimated as characters / 4 (default 1800); cuts rows, preserves totals and next.");

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

/**
 * A tool's arguments. zod strips keys it does not know, so `seams { path: "src/core" }` ranked
 * the whole project and `symbol { offset: 2500 }` returned its first page again, each as if the
 * argument had been honored. An unknown key is an error that names the real ones, which is what
 * lets the caller fix the call instead of trusting a wrong answer.
 *
 * The same moment is recorded as usage. The SDK rejects the call before any handler runs, so
 * this error map is the only place the server sees it, and "agents keep passing `path` to
 * seams" is exactly what a benchmark from the field should be able to say (as a count against
 * the tool: the key itself is the caller's text and is not kept).
 */
function argsFor(usage: ToolRecorder) {
  return function toolArgs<T extends z.ZodRawShape>(tool: string, shape: T) {
    const known = Object.keys(shape).join(", ");
    return z.strictObject(shape, {
      error: (iss) => {
        if (iss.code !== "unrecognized_keys") return undefined;
        usage.record({ tool, durationMs: 0, responseBytes: 0, errorCode: "invalid_parameters", parameterKeys: ["unknown_parameter"] });
        return `unknown argument ${iss.keys.map((k) => `"${k}"`).join(", ")}; this tool takes: ${known}`;
      },
    });
  };
}

// ─── Results ─────────────────────────────────────────────────────────────────────────────────

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const ok = (value: unknown, note?: string): CallToolResult => ({
  ...text(note ? `note: ${note}\n${render(value)}` : render(value)),
  // Scripts should not have to strip a human freshness warning before parsing an answer.
  structuredContent: { data: value, ...(note ? { freshnessNote: note } : {}) },
});
const failed = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * Wrap a handler so every thrown error becomes a tool error the model can read, every answer
 * with an obvious follow-up names it, and every call is counted (Workspace.usage). One wrapper
 * for all tools, so none of the three can be forgotten on a new one.
 */
function guarded(usage: ToolRecorder) {
  return function guard<A>(name: string, fn: (args: A, ctx: ServerContext) => Promise<CallToolResult>) {
    const run = async (args: A, ctx: ServerContext): Promise<{ result: CallToolResult; errorCode?: string }> => {
      try {
        const result = await fn(args, ctx);
        const payload = result.structuredContent as { data?: unknown; freshnessNote?: string } | undefined;
        const data = payload?.data;
        // A failure the handler returned (not threw) is one the caller can fix, like a QueryError.
        if (result.isError) return { result, errorCode: "query_error" };
        if (name === "read_source" || !data || typeof data !== "object" || Array.isArray(data)) return { result };
        const a = args as Record<string, unknown>;
        const d = data as Record<string, any>;
        const next = d.next ?? followUp(name, a, d);
        if (!next || typeof next !== "object") return { result };
        if (a.project && next.arguments) next.arguments = { project: a.project, ...next.arguments };
        let value = { ...d, next };
        // The hint (and the project it carries) is part of the answer, so the budget is checked
        // once more with it in place.
        const lists = budgetLists(d);
        if (d.budget && lists) value = fitBudget(value, lists, d.budget.requested);
        return { result: ok(value, payload?.freshnessNote) };
      } catch (e) {
        if (e instanceof QueryError) return { result: failed(e.message), errorCode: "query_error" };
        return { result: failed(`skyplate ${name}: ${e instanceof Error ? e.message : String(e)}`), errorCode: "error" };
      }
    };
    return async (args: A, ctx: ServerContext): Promise<CallToolResult> => {
      const started = performance.now();
      const { result, errorCode } = await run(args, ctx);
      const text = result.content.reduce((n, c) => n + (c.type === "text" ? Buffer.byteLength(c.text) : 0), 0);
      // Keys only: an argument's value is the user's and never reaches the recorder.
      usage.record({ tool: name, durationMs: performance.now() - started, responseBytes: text, errorCode, parameterKeys: Object.keys((args as object | undefined) ?? {}) });
      return result;
    };
  };
}

/** Only suggest a concrete record the answer actually returned; do not invent another task. */
function followUp(name: string, args: Record<string, unknown>, data: Record<string, any>) {
  switch (name) {
    case "open": return data.project?.state === "ready" || data.project?.partial ? { tool: "map_codebase", arguments: { project: data.project.id } } : undefined;
    case "overview": return { tool: "map_codebase", arguments: {} };
    case "files": return data.files?.[0] ? { tool: "file", arguments: { path: data.files[0].path } } : undefined;
    case "file": return { tool: "read_source", arguments: { path: data.path, start_line: 1, end_line: 80 } };
    case "dir": return { tool: "map_codebase", arguments: { path: args.path ?? "" } };
    case "search_symbols": return data.symbols?.[0] ? { tool: "symbol", arguments: { id: data.symbols[0].id } } : undefined;
    case "symbol": {
      const match = /^(.*):(\d+)$/.exec(data.at ?? "");
      return match ? { tool: "read_source", arguments: { path: match[1], start_line: Number(match[2]), end_line: Math.min(data.endLine, Number(match[2]) + 79) } } : undefined;
    }
    case "seams": return data.rows?.[0] ? { tool: "seam", arguments: data.rows[0].selector } : undefined;
    case "seam": return { tool: "change_impact", arguments: { paths: [args.path] } };
    default: return undefined;
  }
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
  const guard = guarded(ws.usage);
  const toolArgs = argsFor(ws.usage);

  /** Run `fn` against a project's snapshot, or say the analysis is still running. */
  async function answer(
    ref: string | undefined,
    wait: number | undefined,
    ctx: ServerContext,
    fn: (snap: Snapshot, p: Project) => unknown | Promise<unknown>,
    /**
     * "structure" for a question files, imports and the graph can answer: during a first
     * analysis it is answered from the structure pass, with a note, instead of waiting for git
     * history and the compiler (workspace.ts STRUCTURE_GRACE_MS).
     */
    needs: "structure" | "all" = "all",
  ): Promise<CallToolResult> {
    const p = await ws.ensure(ref);
    const { snapshot, note, job } = await ws.ready(p, seconds(wait, QUERY_WAIT_S), progress(ctx), ctx.mcpReq.signal, needs);
    if (!snapshot) {
      return ok({ project: p.id, state: "analyzing", job: job?.view(), next: { tool: "status", arguments: { project: p.id, wait_seconds: LONG_WAIT_S }, then: "repeat the question" } });
    }
    return ok(await fn(snapshot, p), note);
  }

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  // ── Task-sized answers ──
  // Registered first: a host that defers tool schemas lists names in this order, and these are
  // the three the instructions send a new session to.

  server.registerTool(
    "map_codebase",
    {
      title: "Which directories matter for this task?",
      description:
        "Before exploring or refactoring, map a repository or subtree several levels deep in one bounded answer: directory size, languages, entry points, used exports, hotspots and git attention. Collapses small branches. Replaces repeated tree/ls listings; read source for behavior.",
      inputSchema: toolArgs("map_codebase", {
        project,
        path: z.string().optional().describe("Subtree, default root"),
        depth: z.number().int().min(0).max(10).optional().describe("Levels below path (default 3); 0 is the directory alone"),
        min_files: z.number().int().min(0).max(1000).optional().describe("Collapse smaller directories (default 5)"),
        token_budget: tokenBudget,
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("map_codebase", (a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, async (s) => mapCodebase(s.report, await s.symbols(), { path: a.path, depth: a.depth, minFiles: a.min_files, tokenBudget: a.token_budget }), "structure"),
    ),
  );

  server.registerTool(
    "locate_code",
    {
      title: "Find where a feature lives",
      description:
        'Where is "rate limiting" or "invoice pdf" implemented? One call ranks directories and files by path terms, symbols, doc comments, declared packages and what a text search cannot see: the files touched by commits whose subject mentions the terms. Evidence is given for each match. Also scans bounded source for contents and verified package imports. Literal terms, not embeddings. Excludes secret, generated and vendored files.',
      inputSchema: toolArgs("locate_code", {
        project,
        query: z.string().min(1).max(300).describe("A concept or a few terms; every term is matched literally"),
        path: z.string().optional().describe("Limit to this directory, file or glob"),
        content: z.boolean().optional().describe("Scan up to 200 files / 2 MiB for content and package imports, strongest leads first (default true); partial coverage is reported"),
        limit: limit(8),
        token_budget: tokenBudget,
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("locate_code", (a, ctx) =>
      answer(
        a.project,
        a.wait_seconds,
        ctx,
        async (s) =>
          locateCode(
            s.report,
            await s.symbols(),
            { query: a.query, path: a.path, limit: a.limit, tokenBudget: a.token_budget },
            a.content === false ? undefined : { read: (id) => s.text(id), signal: ctx.mcpReq.signal },
          ),
        "structure",
      ),
    ),
  );

  server.registerTool(
    "change_impact",
    {
      title: "What can this change reach, and what did my edits touch?",
      description:
        "Before a rename, move, deletion or refactor, get a blast radius briefing for files and/or symbols in one call instead of a round of searches: dependents and compiler users by module, test candidates, files that usually change together, owners, cycles, public API and hotspot warnings. After editing, pass working_tree: true to review the uncommitted diff before saying done: the declarations it changed, callers and dependents outside it, tests to run, files that usually change with these and are missing from it, exports left unused. Static evidence, not coverage; external/dynamic consumers may be missing.",
      inputSchema: toolArgs("change_impact", {
        project,
        paths: z.array(z.string()).max(100).optional().describe("Files, directories or globs being changed"),
        symbols: z
          .array(z.strictObject({ id: z.number().int().min(0).optional(), name: z.string().optional(), path: z.string().optional() }))
          .max(100)
          .optional()
          .describe("Exact symbol ids or names narrowed by path"),
        working_tree: z.boolean().optional().describe("Use the uncommitted changes against HEAD as the selection (live git projects); combines with paths and symbols"),
        depth: z.number().int().min(1).max(6).optional().describe("Dependent/caller hops (default 3)"),
        limit: limit(10),
        token_budget: tokenBudget,
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("change_impact", (a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, async (s, p) => {
        if (a.working_tree && p.kind !== "live") throw new QueryError("working_tree needs a live project: a report folder has no working tree. Pass paths or symbols instead.");
        const workingTree = a.working_tree ? await workingTreeChanges(p.path) : undefined;
        return changeImpact(s.report, await s.symbols(), { paths: a.paths, symbols: a.symbols, workingTree, depth: a.depth, limit: a.limit, tokenBudget: a.token_budget });
      }),
    ),
  );

  // ── Projects ──

  server.registerTool(
    "open",
    {
      title: "Choose a project or saved report",
      description: "Choose a repository or report and get its overview. Live projects are analyzed and watched; reports are read as saved. Use explicit analysis options here, or pass project to a question to open it automatically. Long work returns a job after wait_seconds.",
      inputSchema: toolArgs("open", {
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
    guard("open", async (a, ctx) => {
      const p = await ws.open(a.path, { options: overrides(a), refresh: a.refresh, reanalyze: a.reanalyze, watch: a.watch });
      if (p.job && !p.job.settled) await ws.wait(p.job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
      if (p.job?.state === "failed" && !p.snapshot) return failed(`could not open ${a.path}: ${p.job.error}`);
      if (!p.snapshot) return ok({ project: p.view(), next: "still analyzing; call status with wait_seconds, or ask a question with project set and it will wait" });
      // Outlasted the wait with its structure pass in hand: that overview is worth having now.
      const note = p.snapshot.partial
        ? "structure pass only: git history and compiler symbols are still being analyzed. map_codebase, locate_code, files, dir, graph and read_source answer now; symbol, seams, history and change_impact wait for the rest"
        : undefined;
      return ok({ project: p.view(), overview: overview(p.snapshot.report) }, note);
    }),
  );

  server.registerTool(
    "status",
    {
      title: "Is the analysis ready?",
      description: "Check open projects, analysis/build jobs and report servers. Pass project or job to wait up to wait_seconds; resume the original question when ready.",
      inputSchema: toolArgs("status", {
        project: z.string().optional().describe("Project id or path to wait on"),
        job: z.string().optional().describe("Job id to wait on (from open or build_report)"),
        wait_seconds: waitSeconds(LONG_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("status", async (a, ctx) => {
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
      title: "Release a project from memory",
      description: "Finished with a repository? Stop watching it and release its analysis. Report servers keep running until serve_report stop.",
      inputSchema: toolArgs("close", { project }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard("close", async (a) => {
      const p = ws.resolve(a.project);
      ws.close(p);
      return ok({ closed: p.id });
    }),
  );

  // ── The measured tree ──

  server.registerTool(
    "overview",
    {
      title: "Size up the repository and its risks",
      description: "How large is this repository, and where is risk concentrated? Return size, languages, hotspots, import hubs, cycles, ownership, compiler totals and warnings. Use map_codebase for a directory map.",
      inputSchema: toolArgs("overview", { project, wait_seconds: waitSeconds(QUERY_WAIT_S) }),
      annotations: readOnly,
    },
    guard("overview", (a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => overview(s.report), "structure")),
  );

  server.registerTool(
    "findings",
    {
      title: "Find risks worth investigating",
      description: "What deserves attention before a refactor? Return measured findings with evidence paths: hotspots, ownership gaps, cycles, large files, unused exports and duplicates. Findings are leads to inspect, not instructions to delete code.",
      inputSchema: toolArgs("findings", {
        project,
        severity: z.enum(SEVERITIES).optional().describe("Only this severity and worse (default info: all)"),
        id: z.string().optional().describe("One finding by id"),
        files_per_finding: z.number().int().min(1).max(500).optional().describe("Files listed per finding (default 10)"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("findings", (a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => findings(s.report, { severity: a.severity, id: a.id, limitFiles: a.files_per_finding }))),
  );

  server.registerTool(
    "files",
    {
      title: "Find files by name, size or risk",
      description: "Find and rank files by path, language, owner, complexity, churn, hotspot or imports. Use flags for entry points, cycles and dead-file candidates. Excludes generated/vendor files by default. Use locate_code when you know a concept rather than a filename.",
      inputSchema: toolArgs("files", {
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
    guard("files", (a, ctx) =>
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
        "structure",
      ),
    ),
  );

  server.registerTool(
    "file",
    {
      title: "Inspect a file and its neighborhood",
      description: "Before editing a known file, get its imports, dependents, symbols, owners, recent commits, co-change, cycles and findings. Use read_source for implementation and change_impact for a combined change briefing.",
      inputSchema: toolArgs("file", {
        project,
        path: z.string().describe("Repo-relative path (absolute paths under the project root work too)"),
        limit: limit(25),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("file", (a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => file(s.report, await s.symbols(), a.path, { limit: a.limit }), "structure")),
  );

  server.registerTool(
    "dir",
    {
      title: "Inspect a directory and its main files",
      description: "Which files matter inside this directory? Return size, languages, owners, hotspots, hubs, child sizes and module coupling. Use map_codebase for several levels in one bounded answer.",
      inputSchema: toolArgs("dir", {
        project,
        path: z.string().optional().describe('Repo-relative directory; "" or omitted is the project root'),
        limit: limit(30),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("dir", (a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => dir(s.report, a.path ?? "", { limit: a.limit }), "structure")),
  );

  // ── Code intelligence ──

  server.registerTool(
    "search_symbols",
    {
      title: "Find declarations or unused exports",
      description: "Find TS/JS symbols by name, path, kind or export/reference status; return ids for symbol. For dead code, unused_exports finds exports with no measured outside-file use; unused_kind separates unreferenced, internal use, entry exports and public API. Check dynamic consumers before deletion.",
      inputSchema: toolArgs("search_symbols", {
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
    guard("search_symbols", (a, ctx) =>
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
      title: "Find callers, references and rename impact",
      description: "Who calls or references this TS/JS declaration, and what would a rename or signature change affect? Compiler-resolved, so unlike a text search it follows import aliases and re-exports and leaves out comments, strings and other symbols with the same name. Return signature, doc, call sites, every reference by file (paged), inheritance, members and callers through base methods. impact_depth follows transitive users. Select by id or exact name narrowed by path/kind.",
      inputSchema: toolArgs("symbol", {
        project,
        id: z.number().int().min(0).optional().describe("Symbol id from search_symbols or another symbol result"),
        name: z.string().optional().describe('Name, or "Class.member"'),
        path: z.string().optional().describe("Narrow a name to a file, directory or glob"),
        kind: z.enum(SYMBOL_KINDS).optional().describe("Narrow a name to a kind"),
        references: z.boolean().optional().describe("List references by file (default true)"),
        impact_depth: z.number().int().min(0).max(6).optional().describe("Also follow callers this many levels out: what a change here can reach (default 0, off)"),
        references_offset: z.number().int().min(0).optional().describe("Skip this many reference locations: pass a previous answer's references.nextOffset to page through every site"),
        limit: limit(20),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("symbol", (a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, async (s) => {
        const S = await s.symbols();
        const id = resolveSymbol(s.report, S, { id: a.id, name: a.name, path: a.path, kind: a.kind });
        return symbol(s.report, S, id, { limit: a.limit, references: a.references, referencesOffset: a.references_offset, impactDepth: a.impact_depth });
      }),
    ),
  );

  // ── Seams (module design) ──

  server.registerTool(
    "seams",
    {
      title: "Find modules worth refactoring",
      description: "Where would a refactor help? Rank modules by hotspot, interface size, tests reaching internals, relays, commit spread, cycles or co-change without a measured import path. No composite quality score. Pass each selector unchanged to seam for the same membership.",
      inputSchema: toolArgs("seams", {
        project,
        depth: z.number().int().min(1).max(20).optional().describe("Measure directories at this depth instead of the adaptive review modules"),
        sort: z.enum(SEAM_SORTS).optional().describe("Default hotspot (with history), else code"),
        limit: limit(25),
        offset: z.number().int().min(0).optional().describe("Skip this many module rows, to page past limit"),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("seams", (a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => seams(s.report, await s.symbols(), { depth: a.depth, sort: a.sort, limit: a.limit, offset: a.offset }))),
  );

  server.registerTool(
    "seam",
    {
      title: "Measure a module before and after a refactor",
      description: "Is this module hiding complexity behind its interface? Measure implementation, outside users, exports that could be hidden, internal exports, test access, relays, adapters, crossing imports/cycles and co-change. Accepts a seams selector or recursive path. Remeasure the same selector after editing.",
      inputSchema: toolArgs("seam", {
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
    guard("seam", (a, ctx) => answer(a.project, a.wait_seconds, ctx, async (s) => seam(s.report, await s.symbols(), a.path, { scope: a.scope, depth: a.depth, limit: a.limit, offset: a.offset }))),
  );

  // ── Structure and history ──

  server.registerTool(
    "graph",
    {
      title: "Trace dependents, import paths or cycles",
      description: "What depends on this code? Follow imports or dependents, find the shortest import path, list cycles, rank hubs or inspect module coupling. Type-only imports count as coupling; runtime_only skips them. cycles lists runtime loops; include_type_only adds type-closed loops.",
      inputSchema: toolArgs("graph", {
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
    guard("graph", (a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => graph(s.report, { view: a.view, path: a.path, to: a.to, depth: a.depth, limit: a.limit, includeTypeOnly: a.include_type_only, runtimeOnly: a.runtime_only }), "structure")),
  );

  server.registerTool(
    "history",
    {
      title: "Find owners and files that change together",
      description: "Who knows this code, why did it change, and what usually changes with it? Query git summary, authors, filtered commit subjects, coupling, weekly activity or ownership. coupling degree is shared commits divided by the less-changed file's commits; it is evidence, not a dependency.",
      inputSchema: toolArgs("history", {
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
    guard("history", (a, ctx) =>
      answer(a.project, a.wait_seconds, ctx, (s) =>
        history(s.report, { view: a.view, path: a.path, author: a.author, since: a.since, until: a.until, query: a.query, type: a.type, weeks: a.weeks, limit: a.limit }),
      ),
    ),
  );

  server.registerTool(
    "dependencies",
    {
      title: "Check external packages and unused dependencies",
      description: "Which external packages are declared or imported? Return manifests and package counts. unused may include CLI tools, type packages and plugins; undeclared excludes runtime built-ins and standard libraries; builtin lists those separately. Inspect scripts before removing a dependency.",
      inputSchema: toolArgs("dependencies", {
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
    guard("dependencies", (a, ctx) => answer(a.project, a.wait_seconds, ctx, (s) => dependencies(s.report, { ecosystem: a.ecosystem, scope: a.scope, filter: a.filter, query: a.query, limit: a.limit }), "structure")),
  );

  server.registerTool(
    "read_source",
    {
      title: "Read the implementation at a useful line",
      description: "Read a known file range with line numbers and declarations, avoiding whole-file reads. Live projects read current disk contents; reports return embedded source. Secret files are never shown. At most 400 lines per call.",
      inputSchema: toolArgs("read_source", {
        project,
        path: z.string(),
        start_line: z.number().int().min(1).optional().describe("First line, 1-based (default 1)"),
        end_line: z.number().int().min(1).optional().describe(`Last line (default start + 199; at most ${MAX_SOURCE_LINES} lines per call)`),
        wait_seconds: waitSeconds(QUERY_WAIT_S),
      }),
      annotations: readOnly,
    },
    guard("read_source", async (a, ctx) => {
      if (a.end_line !== undefined && a.end_line < (a.start_line ?? 1)) return failed("end_line must be at least start_line");
      const p = await ws.ensure(a.project);
      const { snapshot, note } = await ws.ready(p, seconds(a.wait_seconds, QUERY_WAIT_S), progress(ctx), ctx.mcpReq.signal, "structure");
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
      title: "Create a report to share or inspect",
      description: "Need a report for a person? Write the plate, charts, explorer and source reader, reusing current analysis. Defaults to the user cache; explicit out chooses another location and may replace an existing report. Set source false and redact_paths true for sharing. Returns a job after wait_seconds.",
      inputSchema: toolArgs("build_report", {
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
    guard("build_report", async (a, ctx) => {
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
      title: "View or stop serving a saved report",
      description: "View a built report over localhost HTTP and get its URL; optionally open the browser. dir defaults to the project report or last build. stop ends the named server, or all report servers without dir.",
      inputSchema: toolArgs("serve_report", {
        project,
        dir: z.string().optional().describe("Report folder to serve"),
        port: z.number().int().min(0).max(65535).optional().describe("Default 4747, or any free port"),
        open_browser: z.boolean().optional(),
        stop: z.boolean().optional().describe("Stop serving dir (or every report, without dir) instead"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard("serve_report", async (a) => {
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

  server.registerTool(
    "benchmark",
    {
      title: "Write an anonymous benchmark to hand back to Skyplate's maintainers",
      description:
        "Is Skyplate slow, wrong or failing on a repository that cannot be shared? Measure one analysis and write a local JSON and Markdown file holding only numbers and Skyplate's own vocabulary: phase timings, resolution rates, caps that took effect, answer sizes, coded anomalies and this session's tool usage. No path, name, code, author or date. Nothing is uploaded: tell the user where the files are, and let them read benchmark.md and decide whether to share. Analyzes the project again; returns a job after wait_seconds.",
      inputSchema: toolArgs("benchmark", {
        project,
        out: z.string().optional().describe("A new folder for benchmark.json and benchmark.md (default: <user cache>/skyplate/benchmarks/benchmark-<random>); never inside the project"),
        skeleton: z
          .boolean()
          .optional()
          .describe("Also keep the exact shape of the directory tree and import graph as anonymous ids, so a maintainer can rebuild a synthetic repository of the same shape. More revealing than the default: ask the user first"),
        wait_seconds: waitSeconds(LONG_WAIT_S),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard("benchmark", async (a, ctx) => {
      const p = await ws.ensure(a.project);
      const job = ws.benchmark({ project: p, out: a.out, skeleton: a.skeleton });
      const done = await ws.wait(job, seconds(a.wait_seconds, LONG_WAIT_S), progress(ctx), ctx.mcpReq.signal);
      if (job.state === "failed") return failed(`benchmark failed: ${job.error}`);
      return ok(done ? job.view() : { ...job.view(), next: `still running; call status with job "${job.id}" and wait_seconds` });
    }),
  );

  return server;
}
