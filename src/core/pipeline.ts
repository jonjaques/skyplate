/**
 * analyzeProject: one project directory in, one complete Report out (plus the code-symbol
 * tables and embedded source the site writer needs).
 *
 *   const result = await analyzeProject(root, options, onProgress);
 *   await writeSite(result, out);                 // src/core/site.ts
 *
 * Order, and what overlaps what:
 *
 *   walk → detect ─┬→ measure (pool) → imports → graph → layout (pool worker) ─┐
 *                  ├→ git history (git subprocess) ──────────────────────────────┼→ merge, stats,
 *                  └→ TypeScript (tsgo subprocess) ──────────────────────────────┘  findings
 *
 * Git and TypeScript are the slow phases and both need each file's language up front (git for
 * language churn and its exclude list, TypeScript to pick and skip files), so detection runs
 * as its own fast pass first (~20 µs a file, spread over the pool) and both start the moment it
 * ends, instead of after the full measurement. Their JavaScript halves (log parsing, AST walks)
 * share the main thread, which is why the per-file work and the layout run on workers: the
 * main thread stays free to drain git's and tsgo's pipes.
 *
 * Contracts: src/core/contracts.ts (modules), src/shared/schema.ts (the report).
 * Verify:    bun test test/pipeline.test.ts && bun check src/core/pipeline.ts
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Detection, ImportResolution, RawImport } from "./contracts";
import type { ExtractedImport } from "./imports/extract";
import { applyHostImports, type HostImport } from "./ts/hosts";
import {
  SCHEMA_VERSION,
  type Category,
  type CodeSymbols,
  type DirRecord,
  type EdgeKind,
  type ExternalDependency,
  type FileRecord,
  type GitSummary,
  type LanguageSummary,
  type Layouts,
  type Manifest,
  type Report,
  type SourceIndex,
} from "../shared/schema";
import { walkProject } from "./walk";
import { getLanguage } from "./languages/registry";
import { readManifests, readProjectInfo } from "./manifests";
import { createResolver } from "./imports/resolve";
import { analyzeGraph } from "./graph";
import { mineGit } from "./git";
import { analyzeTypeScript } from "./ts";
import { WorkerPool, defaultPoolSize } from "./pool";
import type { DetectJob, MeasureJob, MeasureResult, WorkerResponse } from "./worker";
import type { LayoutInput } from "./layout";
import { computeStats, isOwnCode, MIN_HISTORY } from "./stats";
import { buildFindings } from "./findings";
import { assetUrl, chooseEmbedded, chunkUrl, DEFAULT_MAX_SOURCE_FILE, DEFAULT_MAX_SOURCE_TOTAL, planChunks } from "./site";

// ─── Options and progress ────────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  includeIgnored: boolean;
  /** Extra gitignore-syntax patterns to leave out. */
  exclude: string[];
  git: boolean;
  /** Embed file contents (and copy image previews). */
  source: boolean;
  /** Run the TypeScript analysis. */
  symbols: boolean;
  maxCommits: number;
  maxSourceFile: number;
  maxSourceTotal: number;
  tsMaxFiles: number;
  tsMaxRefs: number;
  /**
   * Omit project.root, and replace the root wherever else a report or symbol string quotes it
   * (warnings carry subprocess errors, which name the directory they ran in). Embedded file
   * contents stay as written: rewriting them would show a reader text the file does not hold,
   * and --no-source is the way to leave them out.
   */
  redactPaths: boolean;
  /** Files larger than this are line-counted by streaming, not measured. */
  maxReadBytes: number;
  /** Worker threads; defaults to available cores − 1. */
  workers: number;
}

export const DEFAULT_OPTIONS: AnalyzeOptions = {
  includeIgnored: false,
  exclude: [],
  git: true,
  source: true,
  symbols: true,
  maxCommits: 20_000,
  maxSourceFile: DEFAULT_MAX_SOURCE_FILE,
  maxSourceTotal: DEFAULT_MAX_SOURCE_TOTAL,
  tsMaxFiles: 20_000,
  tsMaxRefs: 600_000,
  redactPaths: false,
  maxReadBytes: 8 * 1024 * 1024,
  workers: 0,
};

export type Phase =
  | "walk"
  | "detect"
  | "files"
  | "git"
  | "typescript"
  | "imports"
  | "graph"
  | "layout"
  | "stats"
  | "findings";

export interface ProgressEvent {
  phase: Phase;
  status: "start" | "update" | "done" | "skip";
  done?: number;
  total?: number;
  /** One-line detail: a count summary on "done", a module's own message on "update". */
  message?: string;
  /** Wall time of the phase, on "done". */
  ms?: number;
}

export interface AnalysisResult {
  report: Report;
  symbols?: CodeSymbols;
  /** Embedded text by file id, and which ids go in each source chunk. */
  sources: Map<number, string>;
  chunks: number[][];
  /** Absolute path per file id, for the site writer's asset copies. Never written out. */
  abs: string[];
  /**
   * The analyzed root, realpath'd. Never written out (project.root is the written copy, and
   * --redact-paths drops it); the site writer uses it to refuse an output folder that is the
   * project or contains it.
   */
  root: string;
}

/**
 * Phase wall times. They overlap and do not add up to `total`: git and TypeScript run in the
 * background from the end of detection until their results are merged, alongside files,
 * imports, graph and layout. Each one answers "how long did this phase take", not "what share
 * of the run was it", which the overlap makes unanswerable per phase anyway.
 */
class Phases {
  readonly timings: Record<string, number> = {};
  private readonly started = new Map<Phase, number>();
  constructor(private readonly emit: (e: ProgressEvent) => void) {}
  start(phase: Phase, total?: number): void {
    this.started.set(phase, performance.now());
    this.emit({ phase, status: "start", ...(total !== undefined ? { total } : {}) });
  }
  update(phase: Phase, done?: number, total?: number, message?: string): void {
    this.emit({ phase, status: "update", ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}), ...(message ? { message } : {}) });
  }
  end(phase: Phase, message?: string): number {
    const ms = Math.round(performance.now() - (this.started.get(phase) ?? performance.now()));
    this.timings[phase] = ms;
    this.emit({ phase, status: "done", ms, ...(message ? { message } : {}) });
    return ms;
  }
  skip(phase: Phase, message: string): void {
    this.emit({ phase, status: "skip", message });
  }
}

const nf = new Intl.NumberFormat("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n === 1 ? one : many}`;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // A leading dot alone names a dotfile (".gitignore"), not an extension.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const parentOf = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

/**
 * package.json manifests that declare dependencies with nothing installed for them: no
 * node_modules in the manifest's folder or any folder above it, and no Yarn Plug'n'Play
 * manifest (.pnp.cjs) either. Node's resolution climbs past the project root, so the search
 * does too: a package analyzed on its own inside an installed monorepo is installed. A fresh
 * clone is the usual case, and it is invisible in the report otherwise: the checker resolves
 * nothing imported from a package, and the counts quietly drop.
 */
function uninstalledManifests(root: string, manifests: Manifest[]): number {
  const installed = new Map<string, boolean>();
  const look = (dir: string): boolean => {
    let hit = installed.get(dir);
    if (hit === undefined) {
      hit = existsSync(join(dir, "node_modules")) || existsSync(join(dir, ".pnp.cjs")) || existsSync(join(dir, ".pnp.js"));
      if (!hit && dirname(dir) !== dir) hit = look(dirname(dir));
      installed.set(dir, hit);
    }
    return hit;
  };
  let n = 0;
  for (const m of manifests) {
    if (m.kind === "package.json" && m.dependencies > 0 && !look(dirname(join(root, m.path)))) n++;
  }
  return n;
}

const CONFIG_FILE = /^(?:tsconfig|jsconfig)[\w.-]*\.json$/i;
const IN_NODE_MODULES = /(?:^|\/)node_modules\//;
const LINK: EdgeKind = "link";
/** Edge kinds by preference when one file pair is linked several ways: code beats a doc link. */
const KIND_ORDER: EdgeKind[] = ["import", "require", "include", "reference", "link"];

// ─── --redact-paths ──────────────────────────────────────────────────────────────────────────

/**
 * Every spelling of the root a message could quote: as given, realpath'd (what the walker and
 * every subprocess see), and with or without macOS's /private prefix, since /var, /tmp and
 * /etc are symlinks into /private and tools print whichever form they were handed.
 */
function rootSpellings(rootIn: string, root: string): string[] {
  const forms = new Set<string>();
  const add = (p: string) => {
    forms.add(p);
    if (p.startsWith("/private/")) forms.add(p.slice("/private".length));
    else if (/^\/(?:var|tmp|etc)\//.test(p)) forms.add(`/private${p}`);
  };
  add(root);
  add(resolve(rootIn));
  try {
    add(realpathSync(rootIn));
  } catch {
    // The walk already read it; a root that vanished since has nothing left to leak.
  }
  // "/" would match every path; a root that short has no private name to hide anyway.
  return [...forms].filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
}

/**
 * Replaces the root in every string under `value`, in place. A walk over the whole tree rather
 * than a list of known free-text fields, because the leak that prompted it came through a
 * field nobody thought of as a path (a git failure quoted in report.warnings), and the next
 * one would too. The trailing guard keeps "/src/app" from matching inside "/src/app2".
 */
function redactRoot(value: unknown, spellings: string[]): void {
  if (!spellings.length) return;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:${spellings.map(escape).join("|")})(?![\\w.-])`, "g");
  const fix = (s: string) => (spellings.some((p) => s.includes(p)) ? s.replace(pattern, "<project>") : s);
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (typeof x === "string") v[i] = fix(x);
        else if (x && typeof x === "object") stack.push(x);
      }
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        const x = o[k];
        if (typeof x === "string") o[k] = fix(x);
        else if (x && typeof x === "object") stack.push(x);
      }
    }
  }
}

/** Batches so each worker gets several (load balancing) without paying a message per file. */
function batches<T extends { id: number }>(items: T[], workers: number, bytesOf: (t: T) => number, maxBytes: number): T[][] {
  const per = Math.max(16, Math.min(256, Math.ceil(items.length / (workers * 8))));
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    const b = bytesOf(it);
    if (cur.length && (cur.length >= per || bytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ─── Directories ─────────────────────────────────────────────────────────────────────────────

/**
 * The directory tree from file paths. Ids are depth-first pre-order with children sorted by
 * name, root 0, so every subtree is a contiguous id range and a child's id always exceeds its
 * parent's (totals roll up in one reverse pass).
 */
function buildDirs(paths: string[], rootName: string): { dirs: DirRecord[]; fileDir: number[] } {
  const all = new Set<string>([""]);
  for (const p of paths) for (let d = parentOf(p); !all.has(d); d = parentOf(d)) all.add(d);
  const children = new Map<string, string[]>();
  for (const d of all) children.set(d, []);
  for (const d of all) if (d !== "") children.get(parentOf(d))!.push(d);
  const dirs: DirRecord[] = [];
  const idOf = new Map<string, number>();
  const stack: { path: string; parent: number; depth: number }[] = [{ path: "", parent: -1, depth: 0 }];
  while (stack.length) {
    const { path, parent, depth } = stack.pop()!;
    const id = dirs.length;
    idOf.set(path, id);
    dirs.push({
      id,
      path,
      name: path === "" ? rootName : path.slice(path.lastIndexOf("/") + 1),
      parent,
      depth,
      dirs: [],
      files: [],
      totalFiles: 0,
      totalBytes: 0,
      totalLines: 0,
      totalCode: 0,
      dominantLanguage: "",
    });
    if (parent >= 0) dirs[parent]!.dirs.push(id);
    const kids = children.get(path)!.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    // Pushed in reverse name order so they pop (and get ids) in name order.
    for (const k of kids) stack.push({ path: k, parent: id, depth: depth + 1 });
  }
  const fileDir = paths.map((p, f) => {
    const d = idOf.get(parentOf(p))!;
    dirs[d]!.files.push(f);
    return d;
  });
  return { dirs, fileDir };
}

function rollUpDirs(dirs: DirRecord[], files: FileRecord[]): void {
  for (const f of files) {
    const d = dirs[f.dir]!;
    d.totalFiles++;
    d.totalBytes += f.bytes;
    d.totalLines += f.lines;
    d.totalCode += f.code;
  }
  for (let id = dirs.length - 1; id > 0; id--) {
    const d = dirs[id]!;
    const p = dirs[d.parent]!;
    p.totalFiles += d.totalFiles;
    p.totalBytes += d.totalBytes;
    p.totalLines += d.totalLines;
    p.totalCode += d.totalCode;
  }
  // Dominant language: programming and markup languages first, so a directory of Python that
  // also holds one large JSON fixture is still a Python directory; data and prose only when
  // there is no code at all.
  const perDir = dirs.map(() => new Map<string, number>());
  const fallback = dirs.map(() => new Map<string, number>());
  for (const f of files) {
    if (f.code === 0) continue;
    const type = getLanguage(f.language)?.type;
    const target = type === "programming" || type === "markup" ? perDir : fallback;
    for (let d = f.dir; d >= 0; d = dirs[d]!.parent) {
      const m = target[d]!;
      m.set(f.language, (m.get(f.language) ?? 0) + f.code);
    }
  }
  const top = (m: Map<string, number>) => {
    let best = "";
    let max = 0;
    for (const [lang, code] of m) if (code > max || (code === max && lang < best)) [best, max] = [lang, code];
    return best;
  };
  dirs.forEach((d, i) => (d.dominantLanguage = top(perDir[i]!) || top(fallback[i]!)));
}

// ─── Languages ───────────────────────────────────────────────────────────────────────────────

/**
 * Seven categorical slots (0-6), "Other" (-1) for the rest: the seven languages with the most
 * code lines, whatever their type, counted over the files the viewer shows by default
 * (everything but vendored code; see `filters` in src/viewer/state/store.ts). The "text" and
 * "binary" fallbacks never get a slot: they mean "unrecognized", which is what Other already
 * says.
 *
 * The measure is the viewer's own on purpose. The language tray, the galaxy key and the
 * composition chart name the largest languages by code lines in view and color each by its
 * slot, so ranked by anything else a named language would be drawn gray beside smaller ones
 * in color. That is why this no longer weighs code + comment, and no longer leaves out
 * generated files and lockfiles: vite's pnpm-lock.yaml makes YAML 12,447 lines of its tray,
 * and with lockfiles left out YAML sat gray in Other while Vue, at 1,679, had a color.
 * Vendored code stays out because the viewer hides it until asked.
 *
 * Programming and markup languages used to claim the slots first, with data and prose only
 * filling what was left. On a TypeScript app with a docs folder that named HTML at 0.1% and
 * Shell under 0.1% while Markdown, the second-largest language at 44,071 lines, and JSON at
 * 15,216 were gray inside "14 others": the key stopped saying what the project is made of.
 */
function summarizeLanguages(files: FileRecord[]): LanguageSummary[] {
  const byId = new Map<string, LanguageSummary>();
  const weight = new Map<string, number>();
  for (const f of files) {
    let l = byId.get(f.language);
    if (!l) {
      const info = getLanguage(f.language);
      l = {
        id: f.language,
        name: info?.name ?? f.language,
        type: info?.type ?? "other",
        files: 0,
        bytes: 0,
        lines: 0,
        code: 0,
        comment: 0,
        blank: 0,
        slot: -1,
      };
      byId.set(f.language, l);
    }
    l.files++;
    l.bytes += f.bytes;
    l.lines += f.lines;
    l.code += f.code;
    l.comment += f.comment;
    l.blank += f.blank;
    if (!f.vendored) weight.set(f.language, (weight.get(f.language) ?? 0) + f.code);
  }
  [...byId.values()]
    .filter((l) => (weight.get(l.id) ?? 0) > 0 && l.id !== "text" && l.id !== "binary")
    .sort((a, b) => weight.get(b.id)! - weight.get(a.id)! || (a.id < b.id ? -1 : 1))
    .slice(0, 7)
    .forEach((l, i) => (l.slot = i));
  return [...byId.values()].sort(
    (a, b) => b.code + b.comment - (a.code + a.comment) || b.files - a.files || (a.id < b.id ? -1 : 1),
  );
}

// ─── Project name ────────────────────────────────────────────────────────────────────────────

/**
 * README title when it reads like a name (short, few words), else the root manifest's package
 * name, else the folder. The README goes first because manifests name packages, not projects:
 * vite's root package.json is "@vitejs/vite-monorepo", its README says "Vite".
 */
function projectName(root: string, files: FileRecord[], readme: string | undefined, rootManifestNames: string[]): string {
  const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
  const title = readme !== undefined ? files.find((f) => f.path === readme)?.facts?.title : undefined;
  if (title) {
    const t = clean(title);
    if (t && t.length <= 40 && t.split(/\s+/).length <= 4) return t;
  }
  for (const raw of rootManifestNames) {
    // go.mod names a module path; npm scopes are an owner, not the name.
    const name = clean(raw.replace(/\/v\d+$/, "").split("/").pop() ?? "");
    if (name) return name;
  }
  return basename(root) || "project";
}

// ─── analyzeProject ──────────────────────────────────────────────────────────────────────────

export async function analyzeProject(
  rootIn: string,
  options: Partial<AnalyzeOptions> = {},
  onProgress?: (e: ProgressEvent) => void,
): Promise<AnalysisResult> {
  const opts: AnalyzeOptions = { ...DEFAULT_OPTIONS, ...options };
  const totalStart = performance.now();
  const phases = new Phases((e) => {
    try {
      onProgress?.(e);
    } catch {
      // A broken progress sink must not take the analysis down.
    }
  });
  const warnings: string[] = [];

  // ── Walk ──
  phases.start("walk");
  const walk = await walkProject(rootIn, { includeIgnored: opts.includeIgnored, exclude: opts.exclude });
  const root = walk.root;
  const walked = walk.files;
  const n = walked.length;
  const paths = walked.map((f) => f.path);
  const abs = walked.map((f) => f.abs);
  warnings.push(...walk.warnings);
  phases.end("walk", plural(n, "file"));

  const pool = new WorkerPool(opts.workers > 0 ? opts.workers : defaultPoolSize());
  try {
    // ── Detect ──
    phases.start("detect", n);
    const detections = new Array<Detection>(n);
    const unreadable = new Set<number>();
    {
      const jobs: DetectJob[] = walked.map((f, id) => ({ id, abs: f.abs, path: f.path }));
      let done = 0;
      await Promise.all(
        batches(jobs, pool.size, () => 0, Infinity).map(async (batch) => {
          const res = await pool.run({ type: "detect", files: batch });
          if (res.type !== "detect") throw new Error("analysis worker answered a detect batch with " + res.type);
          for (const r of res.results) {
            detections[r.id] = r.detection;
            if (r.error) unreadable.add(r.id);
          }
          done += batch.length;
          phases.update("detect", done, n);
        }),
      );
    }
    phases.end("detect", plural(n, "file"));

    // ── Git and TypeScript, in the background ──
    const gitP = startGit(opts, walk.isGit, root, paths, detections, phases, warnings);
    const tsP = startTypeScript(opts, root, paths, detections, phases, warnings);

    // ── Measure ──
    const plan = opts.source
      ? chooseEmbedded(
          walked.map((f, id) => {
            const d = detections[id]!;
            return { id, path: f.path, bytes: f.bytes, category: d.category, binary: d.binary, secret: d.secret, generated: d.generated };
          }),
          opts.maxSourceFile,
          opts.maxSourceTotal,
        )
      : undefined;
    phases.start("files", n);
    const measured = new Array<MeasureResult>(n);
    const sources = new Map<number, string>();
    {
      const jobs: MeasureJob[] = walked.map((f, id) => ({ id, abs: f.abs, path: f.path, detection: detections[id]!, embed: plan?.embed[id] ?? false }));
      let done = 0;
      await Promise.all(
        batches(jobs, pool.size, (j) => Math.min(walked[j.id]!.bytes, opts.maxReadBytes), 8 * 1024 * 1024).map(async (batch) => {
          const res = await pool.run({ type: "measure", files: batch, maxRead: opts.maxReadBytes });
          if (res.type !== "measure") throw new Error("analysis worker answered a measure batch with " + res.type);
          for (const r of res.results) {
            if (r.text !== undefined) {
              sources.set(r.id, r.text);
              delete r.text;
            }
            measured[r.id] = r;
          }
          done += batch.length;
          phases.update("files", done, n);
        }),
      );
    }

    const files: FileRecord[] = new Array(n);
    const rawImports: RawImport[][] = new Array(n);
    const unmeasured: string[] = [];
    const unhashed: string[] = [];
    for (let id = 0; id < n; id++) {
      const m = measured[id]!;
      const d = detections[id]!;
      if (m.error) unreadable.add(id);
      if (m.unmeasured) (d.binary ? unhashed : unmeasured).push(paths[id]!);
      const name = paths[id]!.slice(paths[id]!.lastIndexOf("/") + 1);
      const rec: FileRecord = {
        id,
        path: paths[id]!,
        name,
        dir: 0,
        ext: extOf(name),
        language: d.language,
        category: d.category,
        detection: d.reason,
        bytes: walked[id]!.bytes,
        binary: d.binary,
        generated: d.generated,
        vendored: d.vendored,
        minified: m.minified,
        secret: d.secret,
        lines: m.lines,
        code: m.code,
        comment: m.comment,
        blank: m.blank,
        longestLine: m.longestLine,
        complexity: m.complexity,
        maxDepth: m.maxDepth,
        functions: m.functions,
        todos: m.todos,
        // Doc links are left out, as they are of the graph's statement counts below: a Markdown
        // page with 32 links is not a file with 32 imports, and the per-file numbers have to
        // add up to graph.resolved + external + unresolved (validateReport checks that).
        imports: m.imports.reduce((k, i) => (i.kind === LINK ? k : k + 1), 0),
        fanIn: 0,
        fanOut: 0,
        rank: 0,
        cycle: -1,
        hash: m.hash,
        hotspot: 0,
        src: -1,
      };
      if (m.facts) rec.facts = m.facts;
      if (opts.source) {
        const asset = assetUrl(id, rec.path, rec.category, rec.bytes, rec.secret);
        if (asset && !unreadable.has(id)) rec.asset = asset;
      }
      files[id] = rec;
      rawImports[id] = m.imports;
    }
    if (unreadable.size) {
      const sample = [...unreadable].slice(0, 3).map((id) => paths[id]).join(", ");
      warnings.push(`${plural(unreadable.size, "file")} could not be read and ${unreadable.size === 1 ? "is" : "are"} listed without measurements (${sample}${unreadable.size > 3 ? ", …" : ""})`);
    }
    const mb = Math.round(opts.maxReadBytes / (1024 * 1024));
    const some = (list: string[]) => `${list.slice(0, 3).join(", ")}${list.length > 3 ? ", …" : ""}`;
    if (unmeasured.length) {
      warnings.push(
        `${plural(unmeasured.length, "text file")} over ${mb} MB ${unmeasured.length === 1 ? "was" : "were"} line-counted but not measured (no comment, complexity or import analysis): ${some(unmeasured)}`,
      );
    }
    if (unhashed.length) {
      warnings.push(`${plural(unhashed.length, "binary file")} over ${mb} MB ${unhashed.length === 1 ? "was" : "were"} not hashed, so duplicate detection skips ${unhashed.length === 1 ? "it" : "them"}: ${some(unhashed)}`);
    }
    phases.end("files", `${plural(n, "file")}, ${plural(files.reduce((s, f) => s + f.lines, 0), "line")}`);

    // ── Directories, manifests, project info ──
    phases.start("imports");
    const readCache = new Map<string, string | undefined>();
    const pathIndex = new Map(paths.map((p, i) => [p, i]));
    const readText = (p: string): string | undefined => {
      if (readCache.has(p)) return readCache.get(p);
      const id = pathIndex.get(p);
      let text: string | undefined;
      // Credentials are never opened for content, by any module, for any reason.
      if (id !== undefined && !files[id]!.secret && !files[id]!.binary) {
        text = sources.get(id);
        if (text === undefined) {
          try {
            text = readFileSync(abs[id]!, "utf8");
          } catch {
            text = undefined;
          }
        }
      }
      readCache.set(p, text);
      return text;
    };
    const { manifests, dependencies } = readManifests(paths, readText);
    const info = readProjectInfo(paths, readText);
    const rootNames = manifests.filter((m) => !m.path.includes("/") && m.name).map((m) => m.name!);
    const name = projectName(root, files, info.readme, rootNames);
    const { dirs, fileDir } = buildDirs(paths, name);
    for (let id = 0; id < n; id++) files[id]!.dir = fileDir[id]!;
    rollUpDirs(dirs, files);

    // ── Imports → edges and externals ──
    const resolve = createResolver({ root, paths, manifests, readText });
    const pairKind = new Map<number, number>(); // from * n + to → index into KIND_ORDER
    const externals = new Map<string, ExternalDependency>();
    const importers = new Map<string, Set<number>>();
    for (const dep of dependencies) externals.set(`${dep.ecosystem}\0${dep.name}`, { ...dep, importers: 0 });
    let resolved = 0;
    let external = 0;
    let unresolved = 0;
    // Script imports in files the compiler never reads (Vue, Markdown, …), for hosts.ts.
    const hostImports: HostImport[] = [];
    let hostFiles = 0;
    const addEdge = (from: number, to: number, kind: EdgeKind) => {
      if (from === to || to < 0 || to >= n) return;
      const key = from * n + to;
      const k = KIND_ORDER.indexOf(kind);
      const prev = pairKind.get(key);
      if (prev === undefined || k < prev) pairKind.set(key, k);
    };
    for (let id = 0; id < n; id++) {
      const list = rawImports[id]!;
      if (!list.length) continue;
      const lang = files[id]!.language;
      let host = false;
      for (const imp of list) {
        let r: ImportResolution;
        try {
          r = resolve(id, imp, lang);
        } catch {
          r = { unresolved: true };
        }
        const names = (imp as ExtractedImport).names;
        if (names) host = true;
        // Doc links are edges, not import statements: they stay out of the counts, as they
        // stay out of the code graph.
        const counted = imp.kind !== LINK;
        if ("file" in r) {
          if (counted) resolved++;
          if (names?.length) hostImports.push({ from: id, to: r.file, line: imp.line, names });
          addEdge(id, r.file, imp.kind);
          for (const sib of r.also ?? []) addEdge(id, sib, imp.kind);
        } else if ("external" in r) {
          if (!counted) continue;
          external++;
          const key = `${r.external.ecosystem}\0${r.external.name}`;
          if (!externals.has(key)) {
            externals.set(key, { name: r.external.name, ecosystem: r.external.ecosystem, declaredIn: [], scope: "unknown", importers: 0 });
          }
          let set = importers.get(key);
          if (!set) importers.set(key, (set = new Set()));
          set.add(id);
        } else if (counted) unresolved++;
      }
      if (host) hostFiles++;
    }
    for (const [key, set] of importers) externals.get(key)!.importers = set.size;
    const edgeKeys = [...pairKind.keys()].sort((a, b) => a - b);
    const edges = { from: [] as number[], to: [] as number[], kind: [] as EdgeKind[] };
    const codeFrom: number[] = [];
    const codeTo: number[] = [];
    for (const key of edgeKeys) {
      const from = Math.floor(key / n);
      const to = key - from * n;
      const kind = KIND_ORDER[pairKind.get(key)!]!;
      edges.from.push(from);
      edges.to.push(to);
      edges.kind.push(kind);
      if (kind !== LINK) {
        codeFrom.push(from);
        codeTo.push(to);
      }
    }
    const externalList = [...externals.values()].sort(
      (a, b) => b.importers - a.importers || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.ecosystem < b.ecosystem ? -1 : 1),
    );
    phases.end("imports", `${plural(resolved + external + unresolved, "import")}, ${plural(edges.from.length, "edge")}`);

    // ── Graph ── (code edges only: docs linking each other would otherwise top PageRank and
    // form "cycles" that say nothing about how the code depends on itself)
    phases.start("graph");
    const g = analyzeGraph({
      fileCount: n,
      from: codeFrom,
      to: codeTo,
      fileDir,
      dirParent: dirs.map((d) => d.parent),
      dirDepth: dirs.map((d) => d.depth),
    });
    for (let id = 0; id < n; id++) {
      const f = files[id]!;
      f.fanIn = g.fanIn[id]!;
      f.fanOut = g.fanOut[id]!;
      f.rank = round4(g.rank[id]!);
      f.cycle = g.cycle[id]!;
    }
    phases.end("graph", `${plural(g.summary.connected, "connected file")}, ${plural(g.summary.cycles.length, "cycle")}`);

    // ── Layout, on a worker while git and TypeScript finish ──
    phases.start("layout");
    const layoutInput: LayoutInput = {
      fileCount: n,
      fileDir,
      lines: files.map((f) => f.lines),
      dirParent: dirs.map((d) => d.parent),
      dirDepth: dirs.map((d) => d.depth),
      dirDirs: dirs.map((d) => d.dirs),
      dirFiles: dirs.map((d) => d.files),
      from: codeFrom,
      to: codeTo,
    };
    const layoutP = pool.run({ type: "layout", input: layoutInput }).then((res: WorkerResponse): Layouts => {
      if (res.type !== "layout") throw new Error("analysis worker answered the layout job with " + res.type);
      phases.end("layout", plural(n, "position"));
      return res.layout;
    });
    // Awaited below, after git and TypeScript; without a handler attached now, a layout failure
    // during that wait would surface as an unhandled rejection instead of this run's error.
    layoutP.catch(() => {});

    // ── Wait for git and TypeScript ──
    const [gitResult, symbols] = await Promise.all([gitP, tsP]);

    if (symbols) {
      applyHostImports(symbols, hostImports, hostFiles);
      const uninstalled = uninstalledManifests(root, manifests);
      if (uninstalled > 0) {
        symbols.stats.uninstalledManifests = uninstalled;
        const { references, unresolved: missed } = symbols.stats;
        // Only when it shows: a few unresolved names are normal in plain JavaScript (property
        // reads on untyped objects) and say nothing about installation. vite, cloned without
        // installing, left 29,129 unresolved beside 25,857 resolved; installed projects run
        // around 3%.
        if (missed > 0 && missed >= 0.1 * (references + missed)) {
          warnings.push(
            `Dependencies are not installed (${plural(uninstalled, "package.json", "package.json files")} without node_modules), so TypeScript could not resolve ${nf.format(missed)} names, against ${nf.format(references)} it did. Reference and caller counts are lower bounds and some exports flagged unused may be used; install the dependencies and re-run for complete code intelligence.`,
          );
        }
      }
    }

    let git: GitSummary | undefined;
    if (gitResult) {
      git = gitResult.summary;
      warnings.push(...gitResult.warnings);
      gitResult.perFile.forEach((fg, id) => {
        if (fg && files[id]) files[id]!.git = fg;
      });
      // Recursive churn: each commit counts once per directory however many files it touched
      // there. Walking up stops at the first ancestor already stamped by this commit, since
      // everything above it was stamped on the same walk.
      const commits = new Array<number>(dirs.length).fill(0);
      const stamp = new Int32Array(dirs.length).fill(-1);
      git.commits.files.forEach((list, c) => {
        for (const f of list) {
          for (let d = files[f]?.dir ?? -1; d >= 0 && stamp[d] !== c; d = dirs[d]!.parent) {
            stamp[d] = c;
            commits[d]!++;
          }
        }
      });
      dirs.forEach((d, i) => (d.commits = commits[i]!));
      if (git.truncated) {
        warnings.push(
          `Growth and file ages start at the oldest ${git.shallow ? "fetched" : "analyzed"} commit, so the growth chart's line counts are relative to that point, not to the project's beginning.`,
        );
      }
    }

    // Hotspots (Tornhill): churn × complexity, log-damped so one 3,000-commit file does not
    // flatten everything else to zero, max-normalized to 0-1. Left at 0 below MIN_HISTORY
    // commits, the same rule the hotspot findings follow: with one commit every file's churn
    // is 1, and the viewer's hotspot chart and color mode would rank pure complexity as risk.
    if (git && git.analyzedCommits >= MIN_HISTORY) {
      let maxHot = 0;
      const hot = new Float64Array(n);
      for (const f of files) {
        if (!f.git || !isOwnCode(f)) continue;
        hot[f.id] = Math.log1p(f.git.commits) * Math.log1p(f.complexity);
        if (hot[f.id]! > maxHot) maxHot = hot[f.id]!;
      }
      if (maxHot > 0) for (const f of files) f.hotspot = round4(hot[f.id]! / maxHot);
    } else if (git) {
      const more = git.shallow ? " Fetch more history (git fetch --unshallow) for hotspots." : git.truncated ? " Raise --max-commits for hotspots." : "";
      warnings.push(
        `Hotspot scores are all 0: ${plural(git.analyzedCommits, "commit")} of history ${git.analyzedCommits === 1 ? "was" : "were"} analyzed, and churn says nothing below ${MIN_HISTORY}.${more}`,
      );
    }

    // ── Summaries ──
    phases.start("stats");
    const languageList = summarizeLanguages(files);
    const byCategory = new Map<Category, { category: Category; files: number; bytes: number; lines: number }>();
    for (const f of files) {
      let c = byCategory.get(f.category);
      if (!c) byCategory.set(f.category, (c = { category: f.category, files: 0, bytes: 0, lines: 0 }));
      c.files++;
      c.bytes += f.bytes;
      c.lines += f.lines;
    }
    const categories = [...byCategory.values()].sort((a, b) => b.files - a.files || (a.category < b.category ? -1 : 1));
    const stats = computeStats(files, git?.authors);
    phases.end("stats", `${plural(languageList.length, "language")}, ${plural(stats.duplicates.length, "duplicate set")}`);

    // ── Source chunks ──
    const chunks = opts.source ? planChunks(sources) : [];
    chunks.forEach((ids, c) => ids.forEach((id) => (files[id]!.src = c)));
    let source: SourceIndex | undefined;
    if (opts.source && plan) {
      source = {
        chunks: chunks.map((_, i) => chunkUrl(i)),
        embedded: sources.size,
        skipped: plan.skipped,
        maxFileBytes: opts.maxSourceFile,
        maxTotalBytes: opts.maxSourceTotal,
      };
    }

    const layout = await layoutP;
    const totals = {
      files: n,
      dirs: dirs.length,
      bytes: 0,
      lines: 0,
      code: 0,
      comment: 0,
      blank: 0,
      binaryFiles: 0,
      generatedFiles: 0,
      vendoredFiles: 0,
      ignored: walk.ignored,
      languages: languageList.length,
    };
    for (const f of files) {
      totals.bytes += f.bytes;
      totals.lines += f.lines;
      totals.code += f.code;
      totals.comment += f.comment;
      totals.blank += f.blank;
      if (f.binary) totals.binaryFiles++;
      if (f.generated) totals.generatedFiles++;
      if (f.vendored) totals.vendoredFiles++;
    }

    const report: Report = {
      schemaVersion: SCHEMA_VERSION,
      tool: { name: "starchart", version: pkg.version },
      generatedAt: new Date().toISOString(),
      timings: {},
      project: {
        name,
        ...(opts.redactPaths ? {} : { root }),
        ...(info.description ? { description: info.description } : {}),
        ...(info.readme ? { readme: info.readme } : {}),
        ...(info.license ? { license: info.license } : {}),
      },
      options: { git: opts.git, source: opts.source, includeIgnored: opts.includeIgnored, maxCommits: opts.maxCommits },
      totals,
      languages: languageList,
      categories,
      dirs,
      files,
      edges,
      graph: { ...g.summary, resolved, external, unresolved },
      externals: externalList,
      manifests,
      ...(git ? { git } : {}),
      stats,
      findings: [],
      layout,
      ...(source ? { source } : {}),
      ...(symbols
        ? { symbols: { url: "data/symbols.js", engine: symbols.engine, stats: symbols.stats } }
        : {}),
      warnings,
    };

    phases.start("findings");
    report.findings = buildFindings(report, symbols ?? undefined);
    phases.end("findings", plural(report.findings.length, "finding"));

    if (opts.redactPaths) {
      const spellings = rootSpellings(rootIn, root);
      redactRoot(report, spellings);
      // Printed types can name a file by absolute path (`typeof import("/abs/src/x")`).
      if (symbols) redactRoot(symbols, spellings);
    }

    report.timings = { ...phases.timings, total: Math.round(performance.now() - totalStart) };
    return { report, ...(symbols ? { symbols } : {}), sources, chunks, abs, root };
  } finally {
    // A throw above leaves git and tsgo running: neither module takes a cancellation signal
    // yet, so their subprocesses finish on their own (bin/starchart.ts exits on failure
    // rather than waiting for them).
    pool.close();
  }
}

// ─── Background phases ───────────────────────────────────────────────────────────────────────

function startGit(
  opts: AnalyzeOptions,
  isGit: boolean,
  root: string,
  paths: string[],
  detections: Detection[],
  phases: Phases,
  warnings: string[],
) {
  if (!opts.git) {
    phases.skip("git", "disabled (--no-git)");
    return Promise.resolve(null);
  }
  if (!isGit) {
    phases.skip("git", "not a git work tree");
    return Promise.resolve(null);
  }
  phases.start("git");
  return mineGit({
    root,
    paths,
    languages: detections.map((d) => d.language),
    maxCommits: opts.maxCommits,
    // Lockfiles, generated and vendored files stay in the history views but out of ownership,
    // coupling and the truck factor (see GitInput.exclude).
    exclude: detections.map((d) => d.category === "lockfile" || d.generated || d.vendored),
    onProgress: (done, total) => phases.update("git", done, total),
  }).then(
    (r) => {
      if (!r) {
        phases.end("git", "no history");
        return null;
      }
      phases.end("git", `${plural(r.summary.analyzedCommits, "commit")}, ${plural(r.summary.authors.length, "author")}`);
      return r;
    },
    (e: unknown) => {
      warnings.push(`Git history could not be read: ${errorMessage(e)}`);
      phases.end("git", "failed");
      return null;
    },
  );
}

/** TypeScript progress lines that are problems worth keeping, as opposed to running commentary. */
const TS_PROBLEM = /failed|exceed|dropped|cannot|could not/i;

function startTypeScript(
  opts: AnalyzeOptions,
  root: string,
  paths: string[],
  detections: Detection[],
  phases: Phases,
  warnings: string[],
): Promise<CodeSymbols | null> {
  if (!opts.symbols) {
    phases.skip("typescript", "disabled (--no-symbols)");
    return Promise.resolve(null);
  }
  phases.start("typescript");
  return analyzeTypeScript({
    root,
    paths,
    languages: detections.map((d) => d.language),
    isTest: detections.map((d) => d.category === "test"),
    // This starts before measurement, so the metrics' `minified` flag does not exist yet and
    // the detector's flags are all there is. They catch most bundles: *.min.js is generated by
    // name, and so is a .js/.css whose head averages over 110 characters a line. What slips
    // through is a bundle whose 8 KiB head is a short banner plus the start of one huge line
    // (the partial last line is left out of that average); it is analyzed, which costs tsgo
    // time and adds its symbols, but changes no file record.
    skip: detections.map((d) => d.generated || d.vendored),
    configs: paths.filter((p) => CONFIG_FILE.test(p.slice(p.lastIndexOf("/") + 1)) && !IN_NODE_MODULES.test(p)),
    maxFiles: opts.tsMaxFiles,
    maxRefs: opts.tsMaxRefs,
    onProgress: (m) => {
      if (TS_PROBLEM.test(m)) warnings.push(m);
      phases.update("typescript", undefined, undefined, m.replace(/^TypeScript: /, ""));
    },
  }).then(
    (s) => {
      phases.end("typescript", s ? `${plural(s.stats.symbols, "symbol")}, ${plural(s.stats.references, "reference")}` : "nothing to analyze");
      return s;
    },
    (e: unknown) => {
      warnings.push(`TypeScript analysis failed: ${errorMessage(e)}`);
      phases.end("typescript", "failed");
      return null;
    },
  );
}
