/**
 * The MCP server's state: what is open, what is running, what is being served.
 *
 * Two kinds of project:
 *   live     a directory, analyzed in memory by the same pipeline the CLI runs, and watched,
 *            so a question after an edit can be answered from a fresh analysis
 *   report   a report folder the CLI (or a build here) wrote, read back as the viewer reads it
 *
 * Analyses run one at a time, in a queue. Each one already spreads over every core (the
 * worker pool) and holds a full report in memory, so two side by side would not finish
 * sooner, they would only double the peak memory and make both slower.
 *
 * Freshness, and why it is lazy by default. A live project is watched (fs.watch, recursive),
 * and a change to a file the analysis covered, or to a folder it listed, marks the snapshot
 * stale. With refresh "on_read" (the default) nothing runs until a question arrives: the
 * question starts the re-analysis, waits a little for it, and otherwise answers from the stale
 * snapshot and says so. Re-analyzing on every save instead ("on_change") keeps the CPU busy
 * for as long as an agent is editing, which on a large repository is the whole session.
 * Changes under node_modules, .git internals other than HEAD and refs (a commit moves those),
 * and report folders are ignored: building a report into the project must not make the
 * project look changed.
 *
 * Nothing here writes into an analyzed project. Builds default to a per-project folder in the
 * user's cache directory, and writeSite still refuses to replace anything that is not a
 * report (src/core/site.ts).
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PHASE_LABEL, type CliPhase } from "../cli/progress";
import { isReportDir, openInBrowser, startServer, type StaticServer } from "../cli/serve";
import { slug } from "../cli/main";
import { analyzeProject, DEFAULT_OPTIONS, type AnalysisResult, type AnalyzeOptions, type ProgressEvent } from "../core/pipeline";
import { detectFile } from "../core/languages/detect";
import { checkOutput, outputPlacement, realPath, reportExcludes, viewerIsStale, writeSite } from "../core/site";
import type { CodeSymbols, Report } from "../shared/schema";
import { QueryError } from "./query";
import { isReportFolder, readReportFolder, reportMtime } from "./report";
import { duration } from "./text";

// ─── Snapshots ───────────────────────────────────────────────────────────────────────────────

export type SourceText = { text: string; origin: "disk" | "report"; changed?: boolean } | { reason: string };

/** One analysis (or one read of a report folder): what every question is answered from. */
export interface Snapshot {
  report: Report;
  /** Code intelligence; a report folder loads data/symbols.js on first use. */
  symbols(): Promise<CodeSymbols | undefined>;
  /** A file's text: from disk for a live project (what it holds now), embedded for a report. */
  text(file: number): Promise<SourceText>;
  /** The analysis behind a live snapshot, kept so a build can write it without redoing it. */
  result?: AnalysisResult;
  /** Effective requested options for this snapshot, including after a failed refresh. */
  options?: string;
  /** When the analysis began (ms): a change after this makes the snapshot stale. */
  startedAt: number;
  finishedAt: number;
  /** Report folders: data/report.js's mtime when read, to notice a rebuild in place. */
  mtimeMs?: number;
  /** Paths of every file and directory the analysis covered, for the watcher's filter. */
  known: Set<string>;
}

/** Files over this are not read back for a source request; nothing reads 16 MB of one file. */
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

function liveSnapshot(result: AnalysisResult, startedAt: number): Snapshot {
  const report = result.report;
  return {
    report,
    symbols: async () => result.symbols,
    async text(id) {
      const f = report.files[id];
      if (!f) return { reason: "no such file" };
      if (f.secret) return { reason: "looks like it holds credentials, so its contents are never shown" };
      if (f.binary) return { reason: "binary file" };
      const abs = result.abs[id]!;
      try {
        // The walker skips links. A saved file or its parent may have become one since then;
        // following it here could read credentials that were never part of the analysis.
        const st = lstatSync(abs);
        if (!st.isFile() || realpathSync(abs) !== abs) return { reason: "file was replaced or redirected since the analysis; reanalyze before reading it" };
        if (st.size > MAX_TEXT_BYTES) return { reason: `${Math.round(st.size / 1024 / 1024)} MB; too large to read here` };
        const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer());
        if (bytes.length > MAX_TEXT_BYTES) return { reason: "file grew beyond the source read limit" };
        // A previously harmless .npmrc or certificate may now hold a credential. Classify the
        // bytes we return, not just the snapshot's old flags.
        const current = detectFile(f.path, bytes.subarray(0, 8192), bytes.length <= 8192);
        if (current.secret) return { reason: "looks like it holds credentials, so its contents are never shown" };
        if (current.binary) return { reason: "binary file" };
        return { text: new TextDecoder().decode(bytes), origin: "disk", changed: st.mtimeMs > startedAt || undefined };
      } catch {
        return { reason: "no longer on disk (deleted or moved since the analysis)" };
      }
    },
    result,
    startedAt,
    finishedAt: Date.now(),
    known: knownPaths(report),
  };
}

function knownPaths(report: Report): Set<string> {
  const known = new Set<string>();
  for (const d of report.dirs) known.add(d.path);
  for (const f of report.files) known.add(f.path);
  return known;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────────────────────

export type JobKind = "analyze" | "load" | "build";
export type JobEvent = ProgressEvent | { phase: "write"; status: "start" | "done"; ms?: number; message?: string };

interface PhaseState {
  status: string;
  done?: number;
  total?: number;
  message?: string;
  ms?: number;
}

let jobSeq = 0;

export class Job {
  readonly id = `job-${++jobSeq}`;
  state: "queued" | "running" | "done" | "failed" = "queued";
  readonly createdAt = Date.now();
  startedAt?: number;
  endedAt?: number;
  error?: string;
  result?: Record<string, unknown>;
  readonly phases = new Map<string, PhaseState>();
  readonly done: Promise<void>;
  private settle!: () => void;
  private listeners = new Set<(line: string) => void>();

  constructor(
    readonly kind: JobKind,
    readonly label: string,
    readonly project?: string,
  ) {
    this.done = new Promise((r) => (this.settle = r));
  }

  get settled(): boolean {
    return this.state === "done" || this.state === "failed";
  }

  start(): void {
    this.state = "running";
    this.startedAt = Date.now();
  }

  event(e: JobEvent): void {
    const prev = this.phases.get(e.phase);
    this.phases.set(e.phase, {
      status: e.status,
      ...("done" in e && e.done !== undefined ? { done: e.done } : {}),
      ...("total" in e && e.total !== undefined ? { total: e.total } : prev?.total !== undefined ? { total: prev.total } : {}),
      ...(e.message ? { message: e.message } : {}),
      ...(e.ms !== undefined ? { ms: e.ms } : {}),
    });
    // Updates arrive per batch (hundreds on a large repository); listeners hear phase changes.
    if (e.status === "update") return;
    const label = PHASE_LABEL[e.phase as CliPhase] ?? e.phase;
    const line = e.status === "start" ? `${label}…` : `${label}: ${e.message ?? e.status}${e.ms !== undefined ? ` (${duration(e.ms)})` : ""}`;
    for (const l of this.listeners) l(line);
  }

  finish(result?: Record<string, unknown>): void {
    this.state = "done";
    this.endedAt = Date.now();
    if (result) this.result = result;
    this.settle();
  }

  fail(e: unknown): void {
    this.state = "failed";
    this.endedAt = Date.now();
    this.error = e instanceof Error ? e.message : String(e);
    this.settle();
  }

  on(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  view() {
    const running = [...this.phases]
      .filter(([, p]) => p.status === "start" || p.status === "update")
      .map(([phase, p]) => `${PHASE_LABEL[phase as CliPhase] ?? phase}${p.total ? ` ${p.done ?? 0}/${p.total}` : ""}`);
    const end = this.endedAt ?? Date.now();
    return {
      job: this.id,
      kind: this.kind,
      label: this.label,
      project: this.project,
      state: this.state,
      elapsed: this.startedAt ? duration(end - this.startedAt) : undefined,
      running: running.length ? running : undefined,
      error: this.error,
      result: this.result,
    };
  }
}

// ─── Projects ────────────────────────────────────────────────────────────────────────────────

export type RefreshMode = "on_read" | "on_change" | "manual";

/** The analysis options a live project or a build may set; the rest are DEFAULT_OPTIONS. */
export type AnalysisOverrides = Partial<
  Pick<AnalyzeOptions, "includeIgnored" | "exclude" | "git" | "symbols" | "source" | "maxCommits" | "tsMaxFiles" | "maxSourceFile" | "maxSourceTotal" | "redactPaths">
>;

export class Project {
  snapshot?: Snapshot;
  /** The newest analysis or load, running or finished. */
  job?: Job;
  changedAt = 0;
  changes = 0;
  lastChange?: string;
  watcher?: FSWatcher;
  watchNote?: string;
  closed = false;
  lastBuild?: string;
  /** Debounce timer for refresh "on_change". */
  timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly id: string,
    readonly kind: "live" | "report",
    readonly path: string,
    public options: AnalysisOverrides,
    public refresh: RefreshMode,
  ) {}

  get stale(): boolean {
    if (!this.snapshot) return false;
    if (this.kind === "report") return reportMtime(this.path) !== this.snapshot.mtimeMs;
    return this.changedAt > this.snapshot.startedAt;
  }

  get busy(): boolean {
    return !!this.job && !this.job.settled;
  }

  view() {
    const s = this.snapshot;
    return {
      id: this.id,
      kind: this.kind,
      path: this.path,
      name: s?.report.project.name,
      state: this.busy ? (s ? "refreshing" : "analyzing") : s ? (this.stale ? "stale" : "ready") : this.job?.state === "failed" ? "failed" : "idle",
      files: s?.report.totals.files,
      analyzed: s ? new Date(s.finishedAt).toISOString() : undefined,
      generated: this.kind === "report" ? s?.report.generatedAt : undefined,
      changesSince: this.kind === "live" && this.stale ? { count: this.changes, last: this.lastChange } : undefined,
      watching: this.kind === "live" ? (this.watcher ? this.refresh : `no (${this.watchNote ?? "not started"})`) : undefined,
      job: this.busy || this.job?.state === "failed" ? this.job!.view() : undefined,
      lastBuild: this.lastBuild,
    };
  }
}

/**
 * A change worth re-analyzing for: a path the analysis covered, a new entry in a folder it
 * listed, or HEAD and refs moving (a commit, a checkout). Everything else (node_modules, build
 * output in an ignored folder, .git's object store, report folders) would re-run an analysis
 * that comes out the same.
 */
export function relevantChange(rel: string, known: Set<string> | undefined, git: boolean): boolean {
  const parts = rel.split("/");
  if (parts[parts.length - 1] === ".DS_Store") return false;
  if (parts[0] === ".git") return git && (rel === ".git/HEAD" || rel === ".git/packed-refs" || rel.startsWith(".git/refs/"));
  // Report folders and their staging siblings (".x.skyplate.tmp-…", ".x.skyplate.old-…").
  if (parts.some((p) => p === "node_modules" || /\.(?:skyplate|starchart)(?:\.(?:tmp|old)-.*)?$/.test(p))) return false;
  if (!known) return true; // first analysis still running: anything may matter
  if (known.has(rel)) return true;
  return known.has(parts.slice(0, -1).join("/"));
}

// ─── Workspace ───────────────────────────────────────────────────────────────────────────────

/** Default build folder: per project, in the user cache directory, never inside the project. */
export function defaultReportDir(root: string, name: string): string {
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Caches")
      : process.platform === "win32"
        ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
        : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  // The root's hash keeps two projects that share a name (every "app", "web", "api") apart.
  const tag = createHash("sha1").update(root).digest("hex").slice(0, 8);
  return join(base, "skyplate", "reports", `${slug(name) || "project"}-${tag}.skyplate`);
}

const KEYS: (keyof AnalysisOverrides)[] = ["includeIgnored", "exclude", "git", "symbols", "source", "maxCommits", "tsMaxFiles", "maxSourceFile", "maxSourceTotal", "redactPaths"];

/** The overrides that differ from DEFAULT_OPTIONS, for comparing two requests. */
function effective(o: AnalysisOverrides): string {
  const full: AnalyzeOptions = { ...DEFAULT_OPTIONS, ...o };
  return JSON.stringify(KEYS.map((k) => full[k]));
}

/** A debounce for "on_change": one burst of saves, one analysis. */
const SETTLE_MS = 1500;

export class Workspace {
  private readonly projects = new Map<string, Project>();
  private readonly jobs: Job[] = [];
  private readonly servers = new Map<string, StaticServer>();
  /** Report folders this server wrote, kept out of every later analysis of a project holding one. */
  private readonly outs = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  // ── Lookup ──

  list() {
    return {
      projects: [...this.projects.values()].map((p) => p.view()),
      jobs: this.jobs.slice(-10).map((j) => j.view()),
      servers: [...this.servers].map(([dir, s]) => ({ dir, url: s.url })),
    };
  }

  job(id: string): Job {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new QueryError(`no job "${id}"; status lists recent jobs`);
    return job;
  }

  /** The project a tool argument names: an id, a path, or nothing when exactly one is open. */
  resolve(ref?: string): Project {
    if (ref === undefined || ref === "") {
      if (this.projects.size === 1) return this.projects.values().next().value!;
      if (this.projects.size === 0) throw new QueryError("no project is open; call open with a project directory or a report folder");
      throw new QueryError(`${this.projects.size} projects are open; pass project as one of: ${[...this.projects.keys()].join(", ")}`);
    }
    const byId = this.projects.get(ref);
    if (byId) return byId;
    const path = realPath(resolve(ref));
    for (const p of this.projects.values()) if (p.path === path) return p;
    throw new QueryError(`no open project "${ref}"; open lists ids, or pass a directory path to open it`);
  }

  /** resolve(), opening a directory path that is not open yet. */
  async ensure(ref?: string): Promise<Project> {
    try {
      return this.resolve(ref);
    } catch (e) {
      if (ref && existsSync(ref) && statSync(ref).isDirectory()) return this.open(ref);
      throw e;
    }
  }

  // ── Opening ──

  async open(pathIn: string, opts: { options?: AnalysisOverrides; refresh?: RefreshMode; reanalyze?: boolean; watch?: boolean } = {}): Promise<Project> {
    const abs = resolve(pathIn);
    if (!existsSync(abs)) throw new QueryError(`path not found: ${pathIn}`);
    if (!statSync(abs).isDirectory()) throw new QueryError(`not a directory: ${pathIn}`);
    const path = realPath(abs);
    const existing = [...this.projects.values()].find((p) => p.path === path);
    if (existing) {
      let rerun = !!opts.reanalyze;
      const options = { ...existing.options, ...opts.options };
      if (existing.kind === "live" && opts.options && effective(options) !== effective(existing.options)) {
        existing.options = options;
        rerun = true;
      }
      if (opts.refresh) existing.refresh = opts.refresh;
      if (existing.kind === "live") {
        if (opts.watch === false) {
          existing.watcher?.close();
          existing.watcher = undefined;
          clearTimeout(existing.timer);
          existing.watchNote = "disabled";
        } else if (opts.watch === true && !existing.watcher) this.watch(existing);
      }
      // A running analysis already captured its options. Queue another run rather than label
      // its old result as an analysis with the newly requested settings.
      if (rerun) this.start(existing, "reanalyze");
      return existing;
    }
    const kind = (await isReportFolder(path)) ? "report" : "live";
    // Another tool call can finish opening the same path while the report probe awaits I/O.
    if ([...this.projects.values()].some((p) => p.path === path)) return this.open(path, opts);
    const project = new Project(this.uniqueId(path), kind, path, opts.options ?? {}, opts.refresh ?? "on_read");
    this.projects.set(project.id, project);
    if (kind === "live" && opts.watch !== false) this.watch(project);
    this.start(project, "open");
    return project;
  }

  private uniqueId(path: string): string {
    const base = slug(basename(path)) || "project";
    let id = base;
    for (let n = 2; this.projects.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  private track(job: Job): Job {
    this.jobs.push(job);
    if (this.jobs.length > 50) this.jobs.splice(0, this.jobs.length - 50);
    return job;
  }

  private enqueue(job: Job, work: () => Promise<Record<string, unknown> | void>): void {
    const run = async () => {
      job.start();
      try {
        job.finish((await work()) ?? undefined);
      } catch (e) {
        job.fail(e);
      }
    };
    this.queue = this.queue.then(run, run);
  }

  /** Start (re)reading a project: an analysis for a live one, a folder read for a report. */
  private start(p: Project, reason: string): Job {
    if (p.kind === "report") {
      const job = this.track(new Job("load", `${reason} ${p.path}`, p.id));
      p.job = job;
      // Reading a folder is I/O, not an analysis, so it does not wait behind the queue.
      job.start();
      readReportFolder(p.path).then(
        (folder) => {
          if (!p.closed) {
            p.snapshot = {
              report: folder.report,
              symbols: () => folder.symbols(),
              text: async (id) => {
                const r = await folder.text(id);
                return "text" in r ? { text: r.text, origin: "report" as const } : r;
              },
              startedAt: job.startedAt!,
              finishedAt: Date.now(),
              mtimeMs: folder.mtimeMs,
              known: new Set(),
            };
          }
          job.finish({ files: folder.report.totals.files, generated: folder.report.generatedAt });
        },
        (e) => job.fail(e),
      );
      return job;
    }
    const job = this.track(new Job("analyze", `${reason} ${p.path}`, p.id));
    p.job = job;
    this.enqueue(job, async () => {
      if (p.closed) return { skipped: "project closed" };
      const startedAt = Date.now();
      // Changes seen before this run are what it picks up; ones during it still count after.
      const seen = p.changes;
      const options = p.options;
      const exclude = this.excludesFor(p.path, options.exclude ?? []);
      const result = await analyzeProject(p.path, { ...options, exclude }, (e) => job.event(e));
      if (p.closed) return { skipped: "project closed" };
      p.snapshot = liveSnapshot(result, startedAt);
      p.snapshot.options = effective(options);
      p.changes -= seen;
      if (p.refresh === "on_change" && p.stale) this.schedule(p);
      return { files: result.report.totals.files, ms: result.report.timings.total };
    });
    return job;
  }

  /** reportExcludes for `root`, plus every report folder this server has written inside it. */
  private excludesFor(root: string, exclude: string[], out?: string): string[] {
    const all = new Set(reportExcludes(root, out, exclude));
    for (const o of this.outs) for (const x of reportExcludes(root, o, [])) all.add(x);
    return [...all];
  }

  // ── Watching ──

  private watch(p: Project): void {
    try {
      p.watcher = watch(p.path, { recursive: true }, (_event, filename) => {
        const rel = filename ? String(filename).split(sep).join("/") : undefined;
        if (rel !== undefined && !relevantChange(rel, p.snapshot?.known, p.options.git !== false)) return;
        p.changedAt = Date.now();
        p.changes++;
        p.lastChange = rel ?? "(unnamed change)";
        if (p.refresh === "on_change") this.schedule(p);
      });
      p.watcher.on("error", (e) => {
        p.watchNote = `watch failed: ${e.message}`;
        p.watcher?.close();
        p.watcher = undefined;
      });
    } catch (e) {
      // Recursive watching is not available everywhere (and a huge tree can exhaust inotify
      // watches on Linux); the project still works, it just cannot tell when it went stale.
      p.watchNote = `watch unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private schedule(p: Project): void {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (p.closed) return;
      if (p.busy) p.job!.done.then(() => p.stale && this.schedule(p));
      else if (p.stale) this.start(p, "change");
    }, SETTLE_MS);
  }

  // ── Waiting ──

  /** Wait up to `ms` for a job; true when it settled. Progress lines go to `onLine`. */
  async wait(job: Job, ms: number, onLine?: (line: string) => void, signal?: AbortSignal): Promise<boolean> {
    if (job.settled) return true;
    const off = onLine ? job.on(onLine) : () => {};
    try {
      return await new Promise<boolean>((done) => {
        const timer = setTimeout(() => finish(false), ms);
        const aborted = () => finish(false);
        const finish = (settled: boolean) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", aborted);
          done(settled);
        };
        job.done.then(() => finish(true));
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) finish(false);
      });
    } finally {
      off();
    }
  }

  /**
   * The snapshot to answer from, refreshing first when it is stale and the project refreshes
   * on read. Returns a note when the answer comes from older data than the project holds now,
   * and no snapshot at all while a first analysis is still running.
   */
  async ready(p: Project, ms: number, onLine?: (line: string) => void, signal?: AbortSignal): Promise<{ snapshot?: Snapshot; note?: string; job?: Job }> {
    if (!p.busy && p.stale && (p.kind === "report" || p.refresh === "on_read")) this.start(p, "refresh");
    if (p.busy) await this.wait(p.job!, ms, onLine, signal);
    if (!p.snapshot) {
      if (p.job?.state === "failed") throw new QueryError(`analysis of ${p.path} failed: ${p.job.error}`);
      return { job: p.job };
    }
    if (p.busy) return { snapshot: p.snapshot, note: `answered from the previous analysis; a refresh is still running (${p.job!.id}, ${p.job!.view().elapsed})`, job: p.job };
    if (p.job?.state === "failed") return { snapshot: p.snapshot, note: `the latest refresh failed (${p.job.error}); answered from the previous analysis` };
    if (p.stale) {
      const next = p.refresh === "on_change"
        ? "a re-analysis starts once the changes settle"
        : p.refresh === "on_read" ? "changes arrived during analysis; the next question refreshes again" : "refresh is manual: call open with reanalyze for fresh data";
      return { snapshot: p.snapshot, note: `${p.changes} change(s) since this analysis (last: ${p.lastChange}); ${next}` };
    }
    return { snapshot: p.snapshot };
  }

  // ── Builds and servers ──

  build(opts: { project?: Project; path?: string; out?: string; json?: boolean; options?: AnalysisOverrides; serve?: boolean; port?: number; openBrowser?: boolean }): Job {
    const p = opts.project;
    if (p?.kind === "report") throw new QueryError(`${p.id} is already a report folder; serve it, or build from the project directory${p.snapshot?.report.project.root ? ` (${p.snapshot.report.project.root})` : ""}`);
    const rootIn = p ? p.path : opts.path;
    if (!rootIn) throw new QueryError("build needs a project or a path");
    if (!existsSync(rootIn) || !statSync(rootIn).isDirectory()) throw new QueryError(`not a directory: ${rootIn}`);
    const root = realPath(resolve(rootIn));
    const options: AnalysisOverrides = { ...(p?.options ?? {}), ...(opts.options ?? {}) };
    const name = p?.snapshot?.report.project.name ?? basename(root);
    const out = opts.out ? resolve(opts.out) : defaultReportDir(root, name);
    // Refused now, not after the analysis: a bad folder should cost nothing.
    try {
      checkOutput(out, root);
    } catch (e) {
      throw new QueryError(e instanceof Error ? e.message : String(e));
    }
    const job = this.track(new Job("build", `build ${root} → ${out}`, p?.id));
    this.enqueue(job, async () => {
      const started = Date.now();
      const snap = p?.snapshot;
      // Decide when the queued build actually starts. Files or analysis settings can change
      // while another project is running, making the snapshot captured at request time stale.
      const reuse = !!(p && snap?.result && !p.stale && !p.busy && effective(options) === snap.options);
      let result: AnalysisResult;
      if (reuse) {
        result = snap!.result!;
      } else {
        const exclude = this.excludesFor(root, options.exclude ?? [], out);
        result = await analyzeProject(root, { ...options, exclude }, (e) => job.event(e));
      }
      job.event({ phase: "write", status: "start" });
      const site = await writeSite(result, out, { json: !!opts.json });
      job.event({ phase: "write", status: "done", ms: site.ms });
      if (outputPlacement(out, root) === "inside") this.outs.add(out);
      if (p) p.lastBuild = out;
      const served = opts.serve || opts.openBrowser ? this.serve(out, opts.port, !!opts.openBrowser) : undefined;
      return {
        out,
        index: join(out, "index.html"),
        bytes: site.bytes,
        reusedAnalysis: reuse || undefined,
        ms: Date.now() - started,
        url: served?.url,
        note: viewerIsStale() ? 'dist/viewer is older than src/viewer; run "bun run build" so reports get the current viewer' : undefined,
      };
    });
    return job;
  }

  serve(dirIn: string, port?: number, openBrowser = false): { dir: string; url: string; already?: boolean; opened?: boolean } {
    const dir = realPath(resolve(dirIn));
    if (!existsSync(dir) || !isReportDir(dir)) throw new QueryError(`no report in ${dirIn} (no index.html); build one first`);
    let server = this.servers.get(dir);
    const already = !!server;
    if (!server) {
      server = startServer(dir, port);
      this.servers.set(dir, server);
    }
    const opened = openBrowser ? openInBrowser(server.url) : undefined;
    return { dir, url: server.url, already: already || undefined, opened };
  }

  stopServing(dirIn?: string): string[] {
    const stopped: string[] = [];
    for (const [dir, s] of this.servers) {
      if (dirIn && dir !== realPath(resolve(dirIn)) && s.url !== dirIn) continue;
      s.stop();
      this.servers.delete(dir);
      stopped.push(s.url);
    }
    return stopped;
  }

  // ── Closing ──

  close(p: Project): void {
    p.closed = true;
    clearTimeout(p.timer);
    p.watcher?.close();
    p.watcher = undefined;
    p.snapshot = undefined;
    this.projects.delete(p.id);
  }

  shutdown(): void {
    for (const p of [...this.projects.values()]) this.close(p);
    this.stopServing();
  }
}
