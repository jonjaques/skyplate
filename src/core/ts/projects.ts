/**
 * Which compiler projects to open, and which project owns each file.
 *
 * A monorepo's configs overlap: a root tsconfig and an app's tsconfig can both include a
 * package's sources (the app reaches them through workspace imports). Each file is analyzed
 * once, by one owning project, so its references are not counted twice; references made from
 * other projects into it still resolve, because declarations are matched by file and node
 * index, not by project.
 */

import type { ChildProcess } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { API, type Project, type Snapshot } from "typescript/unstable/async";
import type { TsInput } from "../contracts";

export interface OwnedProject {
  /** Repo-relative config path, "" for the inferred project. */
  config: string;
  project: Project;
  /** Owned file ids, ascending. */
  files: number[];
}

export interface Plan {
  snapshot: Snapshot;
  projects: OwnedProject[];
}

const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const FAMILY = new Set(["typescript", "tsx", "javascript", "jsx"]);
const IN_NODE_MODULES = /(?:^|\/)node_modules\//;
const CONFIG_NAME = /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/i;
const PRIMARY_NAME = /^(?:tsconfig|jsconfig)\.json$/i;

/**
 * TS/JS files to analyze, by file id. The extension decides, unless the language detector
 * says otherwise: a Qt Linguist `.ts` file is XML, not TypeScript. Minified bundles are left
 * out because nobody navigates them by symbol and one can hold more identifiers than a
 * project's real sources.
 */
export function findCandidates(input: TsInput): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.paths.length; i++) {
    const p = input.paths[i]!;
    if (!SOURCE_EXT.test(p) || IN_NODE_MODULES.test(p) || /\.min\.[cm]?js$/i.test(p)) continue;
    // TsInput.skip: generated, vendored and minified files, as the detector flagged them.
    if (input.skip?.[i]) continue;
    const lang = input.languages[i];
    if (lang && !FAMILY.has(lang)) continue;
    out.push(i);
  }
  return out;
}

export interface Screened {
  /** Absolute paths of the configs to open, sorted. */
  open: string[];
  /**
   * Absolute paths of configs whose `extends` chain is circular or runs into a cycle. tsgo
   * never answers a request that loads one (measured: no reply to openProjects after 15 s nor
   * to openFiles after 8 s, both processes idle), and it loads one not only when asked to open
   * it but whenever a file below it is opened, because each opened file's ancestors are
   * searched for a config. So these are hidden from the compiler altogether (see Compiler),
   * not merely left unopened.
   */
  hidden: string[];
}

/**
 * Configs worth opening. Two kinds are dropped because opening them analyzes the wrong thing:
 * - bases: `tsconfig.base.json` that other configs extend. With no `include` of its own it
 *   would pull in every file under its directory with options meant for no particular one.
 * - solutions: `"files": []` plus `references`, which compile nothing themselves.
 * `tsconfig.json` / `jsconfig.json` are kept even when extended: editors treat them as real.
 * A third kind is dropped because opening it hangs the compiler: see Screened.hidden.
 */
export function screenConfigs(root: string, configs: string[], log: (m: string) => void): Screened {
  const parsed = new Map<string, Record<string, unknown>>();
  const extended = new Set<string>();
  for (const rel of configs) {
    if (IN_NODE_MODULES.test(rel) || !CONFIG_NAME.test(basename(rel))) continue;
    const abs = resolve(root, rel);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch (e) {
      log(`TypeScript: skipping ${rel}: ${message(e)}`);
      continue;
    }
    const json = parseConfig(text);
    parsed.set(abs, json);
    for (const e of extendsSpecs(json)) {
      if (e.startsWith(".") || isAbsolute(e)) extended.add(extendsPath(abs, e) ?? resolve(dirname(abs), e));
    }
  }
  const hidden = circularConfigs([...parsed.keys()], (abs) => parsed.get(abs));
  const out: string[] = [];
  for (const [abs, json] of parsed) {
    const name = basename(abs);
    if (hidden.has(abs)) {
      log(`TypeScript: skipping ${relative(root, abs)}: its "extends" chain is circular, which the compiler cannot open`);
      continue;
    }
    if (extended.has(abs) && !PRIMARY_NAME.test(name)) {
      log(`TypeScript: skipping ${relative(root, abs)} (a base config other configs extend)`);
      continue;
    }
    if (Array.isArray(json.files) && json.files.length === 0 && !json.include) {
      log(`TypeScript: skipping ${relative(root, abs)} (a solution config with no files of its own)`);
      continue;
    }
    out.push(abs);
  }
  return { open: out.sort(), hidden: [...hidden].sort() };
}

function parseConfig(text: string): Record<string, unknown> {
  try {
    const value = Bun.JSONC.parse(text);
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {
    // The compiler copes with a malformed config better than we can; open it and let it.
  }
  return {};
}

function extendsSpecs(json: Record<string, unknown>): string[] {
  const ext = json.extends;
  return (Array.isArray(ext) ? ext : [ext]).filter((e): e is string => typeof e === "string");
}

/**
 * Where `extends: spec` in the config at `from` points, by the compiler's rules: a relative or
 * rooted path as written, with `.json` added only when the bare path does not exist; anything
 * else is looked up in node_modules of each ancestor (workspace packages are symlinked there,
 * which is how a cycle can run through one). Undefined when nothing is found.
 */
function extendsPath(from: string, spec: string): string | undefined {
  if (spec.startsWith("./") || spec.startsWith("../") || isAbsolute(spec)) {
    const target = resolve(dirname(from), spec);
    return isFile(target) || target.endsWith(".json") ? target : target + ".json";
  }
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const base = join(dir, "node_modules", spec);
    for (const c of [base, base + ".json", join(base, "tsconfig.json")]) if (isFile(c)) return c;
    if (dirname(dir) === dir) return undefined;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Configs on an `extends` cycle or with one somewhere down their chain. Targets outside the
 * given list (a base config the walker did not report) are read as the walk reaches them.
 */
function circularConfigs(starts: string[], known: (abs: string) => Record<string, unknown> | undefined): Set<string> {
  const state = new Map<string, "open" | "done">();
  const bad = new Set<string>();
  const load = (abs: string): Record<string, unknown> => {
    const k = known(abs);
    if (k) return k;
    try {
      return parseConfig(readFileSync(abs, "utf8"));
    } catch {
      return {};
    }
  };
  // Returns whether `abs` reaches a cycle; a node met again while still open closes one, and
  // every node on the way back up is marked, since opening any of them loads the cycle.
  const visit = (abs: string): boolean => {
    const s = state.get(abs);
    if (s === "open") return true;
    if (s === "done") return bad.has(abs);
    state.set(abs, "open");
    let reaches = false;
    for (const spec of extendsSpecs(load(abs))) {
      const target = extendsPath(abs, spec);
      if (target && visit(target)) reaches = true;
    }
    state.set(abs, "done");
    if (reaches) bad.add(abs);
    return reaches;
  };
  for (const abs of starts) visit(abs);
  return bad;
}

// ─── The compiler process ────────────────────────────────────────────────────────────────────

type SnapshotParams = NonNullable<Parameters<API["updateSnapshot"]>[0]>;

/**
 * How long one updateSnapshot may take before the compiler is presumed wedged. The slowest
 * real one measured was 5.8 s (a monorepo's 120 configs opened at once); the per-file term
 * keeps a much larger repository from being cut off mid-load, the floor keeps a slow disk
 * from tripping it.
 * Mutable so the tests can exercise the timeout path without waiting a minute.
 */
export const limits = { snapshotMs: (files: number) => 60_000 + 5 * files };

/**
 * The tsgo child behind the API, replaceable. A request it never answers leaves it unusable:
 * nothing more comes back on that connection, and API.close() itself first asks the server to
 * release each snapshot, so it never gets as far as closing stdin and the child outlives the
 * CLI. So a timed-out request kills the child outright and starts a fresh one.
 */
export class Compiler {
  api: API;
  /** Configs asked of the current child; a restart forgets them along with the child. */
  readonly opened = new Set<string>();
  private readonly options: ConstructorParameters<typeof API>[0];

  constructor(cwd: string, hidden: readonly string[]) {
    // Answering readFile for every file the compiler opens costs a round trip per file, so the
    // callback exists only when there is something to hide.
    const hide = new Set(hidden);
    for (const h of hidden) hide.add(realpathOr(h));
    this.options = hide.size ? { cwd, fs: { readFile: (f: string) => (hide.has(f) ? null : undefined) } } : { cwd };
    this.api = new API(this.options);
  }

  /** updateSnapshot, bounded. "timeout" means the child was replaced and every project with it. */
  async update(params: SnapshotParams, ms: number): Promise<Snapshot | "timeout"> {
    for (const c of params.openProjects ?? []) if (typeof c === "string") this.opened.add(c);
    const request = this.api.updateSnapshot(params);
    // Once the child is killed the abandoned request rejects; unobserved, that would surface
    // as an unhandled rejection.
    request.catch(() => {});
    const result = await bounded(request, ms);
    if (result !== TIMED_OUT) return result;
    this.restart();
    return "timeout";
  }

  restart(): void {
    kill(childOf(this.api));
    this.api = new API(this.options);
    this.opened.clear();
  }

  /** Close politely, bounded, then make sure the child is gone either way. */
  async close(log: (m: string) => void): Promise<void> {
    // The child is spawned on the first request and forgotten by close(); hold on to it first.
    const child = childOf(this.api);
    try {
      const closing = this.api.close();
      closing.catch(() => {});
      if ((await bounded(closing, 5000)) === TIMED_OUT) log("TypeScript: the compiler did not close within 5 s; stopped it");
    } catch (e) {
      log(`TypeScript: closing the compiler failed: ${message(e)}`);
    }
    kill(child);
  }
}

const TIMED_OUT: unique symbol = Symbol("timed out");

/**
 * The promise's value, or TIMED_OUT after `ms`. The timer is cleared, not just raced: a
 * pending one keeps Bun's event loop, and so the CLI, alive for its full length.
 */
async function bounded<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<typeof TIMED_OUT>((r) => (timer = setTimeout(() => r(TIMED_OUT), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The API keeps its child process private, and offers no way to stop one that hangs. */
function childOf(api: API): ChildProcess | undefined {
  return (api as unknown as { client?: { process?: ChildProcess } }).client?.process;
}

function kill(child: ChildProcess | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone between the check and the signal.
  }
}

/**
 * Open configs together; if one poisons the batch, retry one by one and drop the bad ones.
 * A config that times out costs the child, and the configs already opened in it, so those are
 * reopened at the end in whichever child survived.
 */
async function openConfigs(compiler: Compiler, configs: string[], root: string, ms: number, log: (m: string) => void): Promise<Snapshot | undefined> {
  try {
    const snap = await compiler.update({ openProjects: configs }, ms);
    if (snap !== "timeout") return snap;
    log(`TypeScript: opening ${configs.length} configs together got no answer in ${seconds(ms)}; retrying one at a time`);
  } catch (e) {
    log(`TypeScript: opening ${configs.length} configs together failed (${message(e)}); retrying one at a time`);
  }
  let snap: Snapshot | undefined;
  const good: string[] = [];
  let lost = false;
  for (const c of configs) {
    try {
      const s = await compiler.update({ openProjects: [c] }, ms);
      if (s === "timeout") {
        log(`TypeScript: skipping ${relative(root, c)}: the compiler did not answer in ${seconds(ms)} (failed)`);
        lost ||= good.length > 0;
        snap = undefined;
        continue;
      }
      snap = s;
      good.push(c);
    } catch (e) {
      log(`TypeScript: skipping ${relative(root, c)}: ${message(e)}`);
    }
  }
  if (lost) snap = await reopen(compiler, good, ms, log);
  return snap;
}

/** Open `configs` in a fresh child, after a restart dropped them. */
async function reopen(compiler: Compiler, configs: string[], ms: number, log: (m: string) => void): Promise<Snapshot | undefined> {
  if (!configs.length) return undefined;
  try {
    const snap = await compiler.update({ openProjects: configs }, ms);
    if (snap !== "timeout") return snap;
    log(`TypeScript: reopening ${configs.length} configs after a restart got no answer in ${seconds(ms)} (failed)`);
  } catch (e) {
    log(`TypeScript: reopening ${configs.length} configs after a restart failed: ${message(e)}`);
  }
  return undefined;
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const isInferred = (p: Project) => !p.configFileName.endsWith(".json");

export async function planProjects(
  compiler: Compiler,
  input: TsInput,
  root: string,
  candidates: number[],
  configs: string[],
  log: (m: string) => void,
): Promise<Plan | undefined> {
  const ms = limits.snapshotMs(candidates.length);
  const absOf = (id: number) => root + "/" + input.paths[id]!;
  const byAbs = new Map<string, number>();
  const byLower = new Map<string, number>();
  for (const id of candidates) {
    byAbs.set(absOf(id), id);
    byLower.set(absOf(id).toLowerCase(), id);
  }
  // Compiler file names are realpath'd but keep their case; fall back to a case-insensitive
  // match for case-insensitive file systems where a config spelled a directory differently.
  const idOf = (name: string) => byAbs.get(name) ?? byLower.get(name.toLowerCase());

  const contained = async (snap: Snapshot) => {
    const out = new Map<number, Project[]>();
    for (const p of snap.getProjects()) {
      let names: readonly string[];
      try {
        names = await p.program.getSourceFileNames();
      } catch (e) {
        log(`TypeScript: cannot list files of ${p.configFileName}: ${message(e)}`);
        continue;
      }
      for (const n of names) {
        const id = idOf(n);
        if (id === undefined) continue;
        const list = out.get(id);
        if (list) list.push(p);
        else out.set(id, [p]);
      }
    }
    return out;
  };

  let snap = configs.length ? await openConfigs(compiler, configs, root, ms, log) : undefined;
  let owners = snap ? await contained(snap) : new Map<number, Project[]>();

  // Files no config includes (a JS-only repo, scripts beside the sources, excluded tests) go to
  // the inferred project. tsgo first searches each file's ancestors for a config containing it,
  // exactly as an editor would, so a file may still land in a configured project here.
  const leftovers = candidates.filter((id) => !owners.has(id));
  if (leftovers.length) {
    // A config that opened no project stays registered and fails every later update with
    // "project not found for update", so release those first.
    const live = new Set(snap?.getProjects().map((p) => realpathOr(p.configFileName)) ?? []);
    const dead = [...compiler.opened].filter((c) => !live.has(realpathOr(c)));
    try {
      const s = await compiler.update({ openFiles: leftovers.map(absOf), closeProjects: dead }, ms);
      if (s === "timeout") {
        // Most likely a circular config the walker never listed, above or beside these files.
        // The restart took the configured projects with it; bring those back without them.
        log(`TypeScript: opening ${leftovers.length} files outside any config got no answer in ${seconds(ms)} (failed); leaving them out`);
        snap = await reopen(compiler, configs.filter((c) => live.has(realpathOr(c))), ms, log);
        owners = snap ? await contained(snap) : new Map();
      } else {
        snap = s;
        owners = await contained(snap);
      }
    } catch (e) {
      log(`TypeScript: opening ${leftovers.length} files outside any config failed: ${message(e)}`);
    }
  }
  if (!snap) return undefined;

  const assigned = new Map<Project, number[]>();
  for (const id of candidates) {
    const ps = owners.get(id);
    if (!ps) continue;
    const abs = absOf(id);
    let best = ps[0]!;
    for (let i = 1; i < ps.length; i++) if (compareOwners(ps[i]!, best, abs) < 0) best = ps[i]!;
    const list = assigned.get(best);
    if (list) list.push(id);
    else assigned.set(best, [id]);
  }

  const projects: OwnedProject[] = [];
  for (const p of snap.getProjects()) {
    const files = assigned.get(p);
    if (!files?.length) continue;
    projects.push({ config: isInferred(p) ? "" : relative(root, realpathOr(p.configFileName)), project: p, files });
  }
  // Configured projects in path order, the inferred one last: deterministic symbol ids.
  projects.sort((a, b) => (a.config === "" ? 1 : 0) - (b.config === "" ? 1 : 0) || (a.config < b.config ? -1 : a.config > b.config ? 1 : 0));
  return { snapshot: snap, projects };
}

/**
 * Negative when `a` should own the file at `abs` rather than `b`: the config whose directory is
 * the nearest ancestor wins (that is the config an editor would pick); a config that only
 * reaches the file through imports loses to one that includes it from above; the inferred
 * project loses to everything. Ties go to the primary name (`tsconfig.json` over
 * `tsconfig.app.json`), then to path order.
 */
function compareOwners(a: Project, b: Project, abs: string): number {
  const rank = (p: Project): [number, number] => {
    if (isInferred(p)) return [-2, 0];
    const dir = dirname(realpathOr(p.configFileName));
    const depth = abs.startsWith(dir + "/") ? dir.length : -1;
    return [depth, PRIMARY_NAME.test(basename(p.configFileName)) ? 1 : 0];
  };
  const [ad, an] = rank(a);
  const [bd, bn] = rank(b);
  if (ad !== bd) return bd - ad;
  if (an !== bn) return bn - an;
  return a.configFileName < b.configFileName ? -1 : a.configFileName > b.configFileName ? 1 : 0;
}

const realpaths = new Map<string, string>();
function realpathOr(p: string): string {
  let r = realpaths.get(p);
  if (r === undefined) {
    try {
      r = realpathSync(p);
    } catch {
      r = p;
    }
    realpaths.set(p, r);
  }
  return r;
}
