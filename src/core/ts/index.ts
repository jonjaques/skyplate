/**
 * TypeScript / JavaScript code intelligence through the TypeScript 7 native compiler API.
 *
 *   analyzeTypeScript(input) → CodeSymbols | null
 *
 * Pipeline:
 *   1. plan      open every real tsconfig/jsconfig, then the leftover files as an inferred
 *                project; give each file one owning project (projects.ts)
 *   2. pass A    declarations → symbols, in file-id order, from each owner's AST
 *                (declarations.ts)
 *   3. pass B    per project: walk every node, batch identifiers through getSymbolAtLocation,
 *                follow aliases, map the checker's declarations back to our symbols
 *                (references.ts, resolve.ts)
 *   4. tables    sort, total, aggregate call edges, flag unused exports, cap (tables.ts)
 *
 * Pass A must finish before pass B resolves anything: a reference can name a declaration in
 * any file, including one later in the order. The client caches every AST it fetches, so both
 * passes keep dropping that cache (pass A every 256 files, pass B after every batch) and each
 * file is fetched twice. Measured: on a 1,083-file monorepo that costs ~0.1–0.3 s and saves
 * ~150 MB of peak memory; on a 12,600-file project, adding the pass A clearing alone took this
 * process's peak from 1.8 GB to 0.44 GB.
 *
 * Uses the async client: the sync one reads Node's `process.stdout._handle.fd`, which Bun does
 * not have, and crashes on start.
 *
 * Never throws. A compiler that will not start, a config that will not open, or a project that
 * fails halfway are reported through onProgress and the rest carries on.
 */

import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { API } from "typescript/unstable/async";
import type { CodeSymbols } from "../../shared/schema";
import type { AnalyzeTypeScript, TsInput } from "../contracts";
import { collectDeclarations } from "./declarations";
import { findCandidates, message, planProjects, type OwnedProject } from "./projects";
import { Batch, walkReferences } from "./references";
import { newProjectCache, resolveBatch, type ResolveState } from "./resolve";
import { RefStore, SymbolStore, type FileDecls } from "./store";
import { ts, type TsSourceFile } from "./syntax";
import { buildTables } from "./tables";

/**
 * Candidates per resolution batch. Not sensitive: on a 1,083-file monorepo 2k, 5k, 20k and 80k
 * all finished within ~0.5 s of each other (noise included), while peak memory rose with size
 * (~270 MB at 2k–5k, ~300 MB at 20k, ~390 MB at 80k). 20k keeps the round trips few.
 */
const BATCH = 20_000;

export const analyzeTypeScript: AnalyzeTypeScript = async (input) => {
  const started = performance.now();
  const log = (m: string) => {
    try {
      input.onProgress?.(m);
    } catch {
      // A broken progress sink must not take the analysis down with it.
    }
  };

  const candidates = findCandidates(input);
  if (!candidates.length) return null;
  if (candidates.length > input.maxFiles) {
    log(`TypeScript: skipped, ${candidates.length} TS/JS files exceed the limit of ${input.maxFiles} (raise maxFiles to analyze them)`);
    return null;
  }

  let root = input.root;
  try {
    root = realpathSync(input.root);
  } catch {
    // Keep the given root; files will simply fail to match and the result will be empty.
  }

  let api: API | undefined;
  try {
    api = new API({ cwd: root });
    const plan = await planProjects(api, input, root, candidates, log);
    if (!plan?.projects.length) {
      log("TypeScript: no project could be opened");
      return null;
    }
    const owned = plan.projects.reduce((n, p) => n + p.files.length, 0);
    log(`TypeScript: ${plan.projects.length} project(s), ${owned} files`);
    return await analyze(api, input, root, plan.projects, started, log);
  } catch (e) {
    log(`TypeScript: analysis failed: ${message(e)}`);
    return null;
  } finally {
    if (api) await closeQuietly(api, log);
  }
};

async function analyze(
  api: API,
  input: TsInput,
  root: string,
  projects: OwnedProject[],
  started: number,
  log: (m: string) => void,
): Promise<CodeSymbols> {
  const absOf = (id: number) => root + "/" + input.paths[id]!;
  const store = new SymbolStore();
  const refs = new RefStore();
  const state: ResolveState = { store, refs, aliasTargets: new Map(), ours: new Map(), unresolved: 0 };
  const report = projects.map((p) => ({ config: p.config, files: 0, ms: 0 }));

  // ─── Pass A: declarations, in global file order so symbol ids follow file ids ────────────
  const owner = new Map<number, number>();
  projects.forEach((p, pi) => p.files.forEach((f) => owner.set(f, pi)));
  const order = [...owner.keys()].sort((a, b) => a - b);
  const decls = new Map<number, FileDecls>();
  const failedA = new Set<number>();
  let seen = 0;
  await prefetched(
    order,
    (id) => projects[owner.get(id)!]!.project.program.getSourceFile(absOf(id)),
    (id, sf, ms) => {
      const pi = owner.get(id)!;
      report[pi]!.ms += ms;
      // Pass A keeps no nodes, but the client caches every AST it fetches; without this the
      // whole repository's ASTs are alive at once by the end of the pass.
      if (++seen % 256 === 0) api.clearSourceFileCache();
      if (!sf) return;
      decls.set(id, collectDeclarations(ts(sf) as TsSourceFile, id, basename(input.paths[id]!), !!input.isTest[id], store));
      report[pi]!.files++;
    },
    (id, e) => {
      const pi = owner.get(id)!;
      if (!failedA.has(pi)) log(`TypeScript: reading ${input.paths[id]} failed: ${message(e)}`);
      failedA.add(pi);
    },
  );
  api.clearSourceFileCache();

  // ─── Pass B: references, one project at a time ───────────────────────────────────────────
  for (let pi = 0; pi < projects.length; pi++) {
    const p = projects[pi]!;
    const t = performance.now();
    const before = refs.length;
    try {
      await referencePass(api, p, decls, absOf, state, log);
    } catch (e) {
      log(`TypeScript: ${p.config || "inferred project"} failed partway: ${message(e)}`);
    }
    const ms = performance.now() - t;
    report[pi]!.ms = Math.round(report[pi]!.ms + ms);
    log(`TypeScript: ${p.config || "inferred project"}: ${report[pi]!.files} files, ${refs.length - before} references, ${Math.round(ms)} ms`);
  }

  const tables = buildTables(store, refs, input.paths.length, decls.values(), input.maxRefs);
  if (tables.truncated) log(`TypeScript: ${tables.truncated} references over the limit of ${input.maxRefs} were dropped`);
  return {
    engine: { name: "typescript", version: typescriptVersion() },
    projects: report,
    symbols: tables.symbols,
    refs: tables.refs,
    calls: tables.calls,
    fileRefStart: tables.fileRefStart,
    moduleSymbol: tables.moduleSymbol,
    stats: {
      files: decls.size,
      symbols: store.size,
      references: tables.refs.symbol.length,
      unresolved: state.unresolved,
      unusedExports: tables.unusedExports,
      truncated: tables.truncated,
      ms: Math.round(performance.now() - started),
    },
  };
}

async function referencePass(
  api: API,
  p: OwnedProject,
  decls: Map<number, FileDecls>,
  absOf: (id: number) => string,
  state: ResolveState,
  log: (m: string) => void,
): Promise<void> {
  const checker = p.project.checker;
  const cache = newProjectCache();
  let batch = new Batch();
  let inflight: Promise<void> | undefined;
  let failures = 0;
  // One batch resolves while the walk fills the next; a second flush waits for the first.
  const flush = async () => {
    const b = batch;
    batch = new Batch();
    if (inflight) await inflight;
    inflight = resolveBatch(b, checker, state, cache).catch((e) => {
      if (!failures++) log(`TypeScript: resolving references in ${p.config || "inferred project"} failed: ${message(e)}`);
    });
    // The walked files' ASTs are no longer needed; the batch keeps its own nodes alive.
    api.clearSourceFileCache();
  };
  const files = p.files.filter((id) => decls.has(id));
  await prefetched(
    files,
    (id) => p.project.program.getSourceFile(absOf(id)),
    async (id, sf) => {
      if (!sf) return;
      walkReferences(ts(sf) as TsSourceFile, decls.get(id)!, state.store, batch);
      if (batch.size >= BATCH) await flush();
    },
    (id, e) => {
      if (!failures++) log(`TypeScript: reading ${absOf(id)} failed: ${message(e)}`);
    },
  );
  await flush();
  await inflight;
}

/**
 * Fetch items with a few requests in flight while processing them strictly in order. Fetching
 * one file at a time leaves the connection idle during each walk.
 *
 * `ms` is the wall time item i cost: from the end of item i-1 to the end of item i, including
 * the wait for its fetch. Summing per-request durations instead would count the overlapping
 * prefetches several times over.
 */
async function prefetched<T>(
  ids: number[],
  fetch: (id: number) => Promise<T>,
  use: (id: number, value: T, ms: number) => void | Promise<void>,
  fail: (id: number, e: unknown) => void,
): Promise<void> {
  const AHEAD = 8;
  const pending: (Promise<{ ok: true; v: T } | { ok: false; e: unknown }> | undefined)[] = [];
  const start = (id: number) =>
    fetch(id).then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
  for (let i = 0; i < Math.min(AHEAD, ids.length); i++) pending.push(start(ids[i]!));
  let last = performance.now();
  for (let i = 0; i < ids.length; i++) {
    const r = await pending[i]!;
    pending[i] = undefined; // let the fetched AST go once used
    if (i + AHEAD < ids.length) pending.push(start(ids[i + AHEAD]!));
    if (r.ok) {
      const t = performance.now();
      await use(ids[i]!, r.v, t - last);
    } else {
      fail(ids[i]!, r.e);
    }
    last = performance.now();
  }
}

async function closeQuietly(api: API, log: (m: string) => void): Promise<void> {
  // Bounded: a wedged tsgo must not hang the report. The timer is cleared (not just raced)
  // because a pending one keeps Bun's event loop, and so the CLI, alive for its full length.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([api.close(), new Promise((r) => (timer = setTimeout(r, 5000)))]);
  } catch (e) {
    log(`TypeScript: closing the compiler failed: ${message(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

function typescriptVersion(): string {
  try {
    const path = Bun.fileURLToPath(import.meta.resolve("typescript/package.json"));
    return String((JSON.parse(readFileSync(path, "utf8")) as { version?: unknown }).version ?? "");
  } catch {
    return "";
  }
}
