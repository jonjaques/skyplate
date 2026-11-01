/**
 * Which compiler projects to open, and which project owns each file.
 *
 * A monorepo's configs overlap: a root tsconfig and an app's tsconfig can both include a
 * package's sources (the app reaches them through workspace imports). Each file is analyzed
 * once, by one owning project, so its references are not counted twice; references made from
 * other projects into it still resolve, because declarations are matched by file and node
 * index, not by project.
 */

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { API, Project, Snapshot } from "typescript/unstable/async";
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
    const lang = input.languages[i];
    if (lang && !FAMILY.has(lang)) continue;
    out.push(i);
  }
  return out;
}

/**
 * Configs worth opening. Two kinds are dropped because opening them analyzes the wrong thing:
 * - bases: `tsconfig.base.json` that other configs extend. With no `include` of its own it
 *   would pull in every file under its directory with options meant for no particular one.
 * - solutions: `"files": []` plus `references`, which compile nothing themselves.
 * `tsconfig.json` / `jsconfig.json` are kept even when extended: editors treat them as real.
 */
export function screenConfigs(root: string, configs: string[], log: (m: string) => void): string[] {
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
    let json: Record<string, unknown> = {};
    try {
      const value = Bun.JSONC.parse(text);
      if (value && typeof value === "object") json = value as Record<string, unknown>;
    } catch {
      // The compiler copes with a malformed config better than we can; open it and let it.
    }
    parsed.set(abs, json);
    const ext = json.extends;
    for (const e of Array.isArray(ext) ? ext : [ext]) {
      if (typeof e !== "string" || !(e.startsWith(".") || isAbsolute(e))) continue;
      const target = resolve(dirname(abs), e);
      extended.add(target.endsWith(".json") ? target : target + ".json");
    }
  }
  const out: string[] = [];
  for (const [abs, json] of parsed) {
    const name = basename(abs);
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
  return out.sort();
}

/** Open configs together; if one poisons the batch, retry one by one and drop the bad ones. */
async function openConfigs(api: API, configs: string[], root: string, log: (m: string) => void): Promise<Snapshot | undefined> {
  try {
    return await api.updateSnapshot({ openProjects: configs });
  } catch (e) {
    log(`TypeScript: opening ${configs.length} configs together failed (${message(e)}); retrying one at a time`);
  }
  let snap: Snapshot | undefined;
  for (const c of configs) {
    try {
      snap = await api.updateSnapshot({ openProjects: [c] });
    } catch (e) {
      log(`TypeScript: skipping ${relative(root, c)}: ${message(e)}`);
    }
  }
  return snap;
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const isInferred = (p: Project) => !p.configFileName.endsWith(".json");

export async function planProjects(
  api: API,
  input: TsInput,
  root: string,
  candidates: number[],
  log: (m: string) => void,
): Promise<Plan | undefined> {
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

  const configs = screenConfigs(root, input.configs, log);
  let snap = configs.length ? await openConfigs(api, configs, root, log) : undefined;
  let owners = snap ? await contained(snap) : new Map<number, Project[]>();

  // Files no config includes (a JS-only repo, scripts beside the sources, excluded tests) go to
  // the inferred project. tsgo first searches each file's ancestors for a config containing it,
  // exactly as an editor would, so a file may still land in a configured project here.
  const leftovers = candidates.filter((id) => !owners.has(id));
  if (leftovers.length) {
    // A config that opened no project stays registered and fails every later update with
    // "project not found for update", so release those first.
    const live = new Set(snap?.getProjects().map((p) => realpathOr(p.configFileName)) ?? []);
    const dead = configs.filter((c) => !live.has(realpathOr(c)));
    try {
      snap = await api.updateSnapshot({ openFiles: leftovers.map(absOf), closeProjects: dead });
      owners = await contained(snap);
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
