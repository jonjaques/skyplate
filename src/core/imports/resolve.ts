/**
 * Import resolution: specifier → repo file id, external package, or nothing.
 *
 * `createResolver` builds every index once (path → id, directory → files, basename → files)
 * and each ecosystem's tables lazily on first use (tsconfig paths, workspace packages, Python
 * module roots, go.mod modules, Cargo crates, JVM package suffixes, PSR-4 prefixes), so a
 * lookup is a handful of Map probes and never a scan over all paths.
 *
 * Package-like targets (a Go package, a Java wildcard import, a Terraform module directory)
 * name a directory, not a file, while the contract returns one file id. Those resolve to a
 * representative file — the one named after the directory when it exists — and carry the
 * directory's other files in `also` (capped), which callers that want package-level edges can
 * read. See contractIssues in the module report.
 */

import { builtinModules } from "node:module";
import type { CreateResolver, ImportResolution, RawImport, ResolveContext } from "../contracts";
import { parseJsonc } from "../facts";

/** A resolution to a package directory: the representative file plus its siblings. */
export type PackageResolution = { file: number; also: number[] };

const ALSO_CAP = 16;
const UNRESOLVED: ImportResolution = { unresolved: true };
const ext = (name: string, ecosystem: string): ImportResolution => ({ external: { name, ecosystem } });

// ─── Paths ───────────────────────────────────────────────────────────────────────────────────

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Join and normalize POSIX segments; undefined when the result would leave the repo. */
function join(dir: string, rel: string): string | undefined {
  const out: string[] = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

function commonPrefixDepth(a: string, b: string): number {
  if (!a || !b) return 0;
  const x = a.split("/");
  const y = b.split("/");
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return k;
}

// ─── Repository index ────────────────────────────────────────────────────────────────────────

class RepoIndex {
  readonly byPath = new Map<string, number>();
  readonly dirFiles = new Map<string, number[]>();
  readonly byBase = new Map<string, number[]>();
  readonly dirs = new Set<string>();

  constructor(readonly paths: string[]) {
    if (paths.length) this.dirs.add(""); // the root is a directory too (`require("..")`)
    paths.forEach((p, id) => {
      this.byPath.set(p, id);
      const d = dirname(p);
      let list = this.dirFiles.get(d);
      if (!list) {
        list = [];
        this.dirFiles.set(d, list);
        for (let a = d; a && !this.dirs.has(a); a = dirname(a)) this.dirs.add(a);
      }
      list.push(id);
      const b = basename(p);
      const same = this.byBase.get(b);
      if (same) same.push(id);
      else this.byBase.set(b, [id]);
    });
  }

  file(p: string | undefined): number | undefined {
    return p === undefined ? undefined : this.byPath.get(p);
  }

  /**
   * The file whose path ends with `spec` (as whole segments), closest to `from`: deepest shared
   * directory prefix first, then shortest path. One basename lookup, then a filter.
   */
  suffix(spec: string, from: string, accept?: (path: string) => boolean): number | undefined {
    const clean = spec.replace(/^(?:\.\/)+/, "");
    const cands = this.byBase.get(basename(clean));
    if (!cands) return undefined;
    const tail = "/" + clean;
    const fromDir = dirname(from);
    let best: number | undefined;
    let bestScore = -1;
    let bestLen = Infinity;
    for (const id of cands) {
      const p = this.paths[id]!;
      if (p !== clean && !p.endsWith(tail)) continue;
      if (accept && !accept(p)) continue;
      const score = commonPrefixDepth(dirname(p), fromDir);
      if (score > bestScore || (score === bestScore && p.length < bestLen)) {
        best = id;
        bestScore = score;
        bestLen = p.length;
      }
    }
    return best;
  }

  /** A package directory as a resolution: representative file + capped siblings. */
  directory(dir: string, accept: (path: string) => boolean): PackageResolution | undefined {
    const ids = (this.dirFiles.get(dir) ?? []).filter((id) => accept(this.paths[id]!));
    if (ids.length === 0) return undefined;
    const stem = basename(dir);
    const named = ids.find((id) => basename(this.paths[id]!).replace(/\.[^.]+$/, "") === stem);
    const main = ids.find((id) => /^(?:main|index|mod|lib|init)\.[^.]+$/.test(basename(this.paths[id]!)));
    const rep = named ?? main ?? ids.find((id) => !basename(this.paths[id]!).startsWith("doc.")) ?? ids[0]!;
    return { file: rep, also: ids.filter((id) => id !== rep).slice(0, ALSO_CAP) };
  }
}

function readJson(ctx: ResolveContext, path: string): Record<string, unknown> | undefined {
  const text = ctx.readText(path);
  if (text === undefined) return undefined;
  const v = parseJsonc(text);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

const inNodeModules = (p: string) => p.startsWith("node_modules/") || p.includes("/node_modules/");

// ─── JavaScript / TypeScript ─────────────────────────────────────────────────────────────────

const JS_EXTS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".json", ".css", ".scss"];
// ESM TypeScript writes the extension of the emitted file: `./x.js` means `./x.ts`.
const TS_FOR_JS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};
// Source-ish conditions first: we want the file in the repo, not the published build.
const CONDITIONS = ["source", "development", "style", "sass", "import", "module", "browser", "node", "default", "require", "types", "typings"];
// Build-output roots a package.json may point at; mapped back to src/ when the build isn't checked in.
const BUILD_DIRS = /^(?:dist|lib|build|out|esm|cjs|es|types|dts|module)\//;

const NODE_BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("bun:")).map((m) => m.replace(/^node:/, "")));

interface PackageInfo {
  dir: string;
  json: Record<string, unknown>;
}

interface PathMapping {
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
  base: string;
}

interface TsConfig {
  baseUrl?: string;
  mappings?: PathMapping[];
}

/** npm package name of a bare specifier ("@scope/name/sub" → "@scope/name"). */
export function npmName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
}

class JsResolver {
  private packages = new Map<string, PackageInfo>();
  private nearestPkgCache = new Map<string, PackageInfo | null>();
  private configDirs = new Map<string, string[]>();
  private configCache = new Map<string, TsConfig | null>();
  private nearestConfigCache = new Map<string, TsConfig[]>();

  constructor(
    private ctx: ResolveContext,
    private idx: RepoIndex,
  ) {
    for (const p of idx.paths) {
      if (inNodeModules(p)) continue;
      const b = basename(p);
      if (b === "package.json") {
        const json = readJson(ctx, p);
        const dir = dirname(p);
        if (!json) continue;
        this.nearestPkgCache.set(dir, { dir, json });
        const name = typeof json.name === "string" ? json.name : undefined;
        // Duplicate names (fixtures copying a real package) resolve to the shallowest copy.
        const prev = name ? this.packages.get(name) : undefined;
        if (name && (!prev || dir.length < prev.dir.length)) this.packages.set(name, { dir, json });
      } else if (/^(?:tsconfig|jsconfig)(?:[.-][\w.-]*)?\.json$/.test(b)) {
        const d = dirname(p);
        const list = this.configDirs.get(d);
        if (list) list.push(p);
        else this.configDirs.set(d, [p]);
      }
    }
    for (const list of this.configDirs.values()) {
      // tsconfig.json first: it is what editors and tsc pick; the rest only add mappings.
      list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }
    function rank(p: string) {
      const b = basename(p);
      return b === "tsconfig.json" ? 0 : b === "jsconfig.json" ? 1 : 2;
    }
  }

  resolve(from: string, raw: string, kind: RawImport["kind"]): ImportResolution {
    let spec = raw;
    // Loader prefixes (`raw-loader!./x`) and Vite / webpack queries (`./a.svg?raw`, `#hash`).
    if (spec.includes("!")) spec = spec.slice(spec.lastIndexOf("!") + 1);
    if (!spec.startsWith("#")) spec = spec.replace(/[?#].*$/, "");
    if (!spec) return UNRESOLVED;
    if (spec.startsWith("node:")) return ext(npmName(spec.slice(5)), "node");
    if (spec.startsWith("bun:")) return ext(spec, "bun");
    if (spec.startsWith("npm:")) return ext(npmName(spec.slice(4).replace(/@[^/]*$/, "")), "npm");
    if (spec.startsWith("jsr:")) return ext(npmName(spec.slice(4).replace(/(?<=.)@[^/]*$/, "")), "jsr");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec)) return ext(spec, "url");
    const fromDir = dirname(from);

    // Triple-slash path references are relative even without "./".
    if (kind === "reference" && /\.(?:[cm]?[jt]sx?|d\.ts)$/.test(spec) && !spec.startsWith(".")) spec = `./${spec}`;
    if (kind === "reference" && !spec.startsWith(".")) {
      const ws = this.workspace(spec);
      if (ws) return ws;
      return ext(spec === "node" ? "@types/node" : npmName(spec), "npm");
    }

    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
      return this.found(this.probe(join(fromDir, spec)));
    }
    if (spec.startsWith("/")) return this.found(this.rootRelative(fromDir, spec, (p) => this.probe(p)));
    if (spec.startsWith("#")) {
      const pkg = this.nearestPackage(fromDir);
      const imports = pkg?.json.imports;
      if (pkg && imports && typeof imports === "object") {
        for (const target of matchSubpath(imports as Record<string, unknown>, spec)) {
          const hit = target.startsWith(".") ? this.probeTarget(pkg.dir, target) : undefined;
          if (hit !== undefined) return { file: hit };
          if (!target.startsWith(".")) return this.resolve(from, target, kind);
        }
      }
      // Not a package import: `#/x` is also a common tsconfig `paths` alias, tried below.
    }

    for (const cfg of this.configsFor(fromDir)) {
      const hit = this.viaConfig(cfg, spec);
      if (hit !== undefined) return { file: hit };
    }

    const ws = this.workspace(spec);
    if (ws) return ws;
    const name = npmName(spec);
    if (NODE_BUILTINS.has(name) || NODE_BUILTINS.has(spec)) return ext(name, "node");
    // `@/x`, `~/x`, `#x`, `$lib`: aliases configured somewhere we cannot see (a bundler config),
    // never npm package names.
    if (name.startsWith("@/") || name === "@" || /^[~#$]/.test(name)) return UNRESOLVED;
    return ext(name, "npm");
  }

  private found(id: number | undefined): ImportResolution {
    return id === undefined ? UNRESOLVED : { file: id };
  }

  /** Workspace package by name → its source file, or undefined when the name isn't local. */
  workspace(spec: string): ImportResolution | undefined {
    const name = npmName(spec);
    const pkg = this.packages.get(name);
    if (!pkg) return undefined;
    const sub = spec.slice(name.length).replace(/^\//, "");
    const hit = this.packageEntry(pkg, sub);
    return hit === undefined ? UNRESOLVED : { file: hit };
  }

  private packageEntry(pkg: PackageInfo, sub: string): number | undefined {
    const exportsField = pkg.json.exports;
    if (exportsField !== undefined) {
      for (const target of matchExports(exportsField, sub ? `./${sub}` : ".")) {
        const hit = this.probeTarget(pkg.dir, target);
        if (hit !== undefined) return hit;
      }
    }
    if (!sub) {
      for (const field of ["source", "module", "main", "types", "typings", "browser"]) {
        const v = pkg.json[field];
        if (typeof v === "string") {
          const hit = this.probeTarget(pkg.dir, v);
          if (hit !== undefined) return hit;
        }
      }
      return this.probe(join(pkg.dir, "src/index")) ?? this.probe(join(pkg.dir, "index"));
    }
    return this.probe(join(pkg.dir, sub)) ?? this.probe(join(pkg.dir, `src/${sub}`)) ?? this.probeTarget(pkg.dir, sub);
  }

  /** A package.json target path → existing file, mapping build output back to source. */
  private probeTarget(dir: string, target: string): number | undefined {
    const rel = target.replace(/^\.\//, "");
    const full = join(dir, rel);
    const direct = this.idx.file(full) ?? this.probe(full);
    if (direct !== undefined) return direct;
    // ./dist/node/index.js → src/node/index.(ts|tsx|js…); one or two build-dir levels deep.
    let src = rel;
    for (let k = 0; k < 2 && BUILD_DIRS.test(src); k++) src = src.replace(BUILD_DIRS, "");
    if (src === rel) return undefined;
    const stem = src.replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$/, "");
    return this.probe(join(dir, `src/${stem}`)) ?? this.probe(join(dir, stem));
  }

  /** Exact file, TS-for-JS swap, extension probing, then directory index. */
  probe(p: string | undefined): number | undefined {
    if (p === undefined) return undefined;
    const idx = this.idx;
    const exact = idx.file(p);
    if (exact !== undefined) return exact;
    const dot = p.lastIndexOf(".");
    if (dot > p.lastIndexOf("/")) {
      const swaps = TS_FOR_JS[p.slice(dot)];
      if (swaps) {
        const stem = p.slice(0, dot);
        for (const e of swaps) {
          const hit = idx.file(stem + e);
          if (hit !== undefined) return hit;
        }
      }
    }
    if (p) {
      for (const e of JS_EXTS) {
        const hit = idx.file(p + e);
        if (hit !== undefined) return hit;
      }
    }
    if (idx.dirs.has(p)) {
      const index = p ? `${p}/index` : "index";
      for (const e of JS_EXTS) {
        const hit = idx.file(index + e);
        if (hit !== undefined) return hit;
      }
      const pkg = this.nearestPkgCache.get(p);
      if (pkg) {
        for (const field of ["source", "module", "main"]) {
          const v = pkg.json[field];
          if (typeof v === "string") {
            const hit = idx.file(join(p, v));
            if (hit !== undefined) return hit;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * A root-relative path (`/src/main.ts`, `/favicon.svg`) the way a dev server reads it: from
   * the page's own directory up to its package root (Vite's root is index.html's directory),
   * then the repo root; at each level the path itself, then under `public/`, which Vite and most
   * static-site tools serve at `/`.
   */
  rootRelative(fromDir: string, spec: string, probe: (p: string | undefined) => number | undefined): number | undefined {
    const pkg = this.nearestPackage(fromDir);
    const levels: string[] = [];
    for (let d = fromDir; ; d = dirname(d)) {
      levels.push(d);
      if (d === "" || (pkg && d === pkg.dir)) break;
    }
    if (levels[levels.length - 1] !== "") levels.push("");
    for (const d of levels) {
      const hit = probe(join(d, spec)) ?? probe(join(d, `public${spec}`));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  nearestPackage(dir: string): PackageInfo | undefined {
    const seen: string[] = [];
    let d: string | undefined = dir;
    let found: PackageInfo | undefined;
    for (;;) {
      const cached = this.nearestPkgCache.get(d);
      if (cached !== undefined) {
        found = cached ?? undefined;
        break;
      }
      seen.push(d);
      if (d === "") break;
      d = dirname(d);
    }
    for (const s of seen) this.nearestPkgCache.set(s, found ?? null);
    return found;
  }

  /** The tsconfig/jsconfig files of the nearest directory that has any, fully loaded. */
  private configsFor(dir: string): TsConfig[] {
    const cached = this.nearestConfigCache.get(dir);
    if (cached) return cached;
    let result: TsConfig[] = [];
    for (let d = dir; ; d = dirname(d)) {
      const list = this.configDirs.get(d);
      if (list) {
        result = list.map((p) => this.loadConfig(p, 0)).filter((c): c is TsConfig => !!c && !!(c.baseUrl !== undefined || c.mappings));
        break;
      }
      if (d === "") break;
    }
    this.nearestConfigCache.set(dir, result);
    return result;
  }

  /**
   * compilerOptions.baseUrl / paths after following `extends` (relative files, workspace
   * packages; a string or an array). `baseUrl` is relative to the config that sets it; `paths`
   * to baseUrl when there is one, else to the config that sets `paths` (TypeScript ≥ 4.1).
   */
  private loadConfig(path: string, depth: number): TsConfig | null {
    const cached = this.configCache.get(path);
    if (cached !== undefined) return cached;
    if (depth > 8) return null;
    this.configCache.set(path, null); // cycle guard
    const json = readJson(this.ctx, path);
    if (!json) return null;
    const dir = dirname(path);
    let merged: TsConfig = {};
    const ext = json.extends;
    for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
      if (typeof e !== "string") continue;
      const parentPath = this.configPath(dir, e);
      const parent = parentPath ? this.loadConfig(parentPath, depth + 1) : null;
      if (parent) merged = { ...merged, ...parent };
    }
    const opts = (json.compilerOptions ?? {}) as Record<string, unknown>;
    if (typeof opts.baseUrl === "string") merged.baseUrl = join(dir, opts.baseUrl) ?? "";
    if (opts.paths && typeof opts.paths === "object") {
      const base = merged.baseUrl ?? dir;
      const mappings: PathMapping[] = [];
      for (const [key, targets] of Object.entries(opts.paths as Record<string, unknown>)) {
        if (!Array.isArray(targets)) continue;
        const star = key.indexOf("*");
        mappings.push({
          prefix: star < 0 ? key : key.slice(0, star),
          suffix: star < 0 ? "" : key.slice(star + 1),
          wildcard: star >= 0,
          targets: targets.filter((t): t is string => typeof t === "string"),
          base,
        });
      }
      // TypeScript picks the pattern with the longest prefix.
      mappings.sort((a, b) => b.prefix.length - a.prefix.length);
      merged.mappings = mappings;
    } else if (merged.mappings && typeof opts.baseUrl === "string") {
      // Inherited paths stay relative to the baseUrl that is now in effect.
      merged.mappings = merged.mappings.map((m) => ({ ...m, base: merged.baseUrl! }));
    }
    this.configCache.set(path, merged);
    return merged;
  }

  private configPath(dir: string, spec: string): string | undefined {
    const withJson = (p: string) => (p.endsWith(".json") ? p : this.idx.file(p + ".json") !== undefined ? p + ".json" : `${p}/tsconfig.json`);
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const p = join(spec.startsWith("/") ? "" : dir, spec);
      return p === undefined ? undefined : withJson(p);
    }
    const name = npmName(spec);
    const pkg = this.packages.get(name);
    if (!pkg) return undefined; // a published base config in node_modules; not in the walk
    const sub = spec.slice(name.length).replace(/^\//, "");
    return sub ? withJson(join(pkg.dir, sub) ?? sub) : join(pkg.dir, "tsconfig.json");
  }

  private viaConfig(cfg: TsConfig, spec: string): number | undefined {
    for (const m of cfg.mappings ?? []) {
      let star: string;
      if (m.wildcard) {
        if (!spec.startsWith(m.prefix) || !spec.endsWith(m.suffix) || spec.length < m.prefix.length + m.suffix.length) continue;
        star = spec.slice(m.prefix.length, spec.length - m.suffix.length);
      } else if (spec === m.prefix) star = "";
      else continue;
      for (const t of m.targets) {
        const hit = this.probe(join(m.base, t.replace("*", star)));
        if (hit !== undefined) return hit;
      }
    }
    if (cfg.baseUrl !== undefined) return this.probe(join(cfg.baseUrl, spec));
    return undefined;
  }
}

/** Condition-ordered string targets of an exports/imports value. */
function conditionTargets(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) conditionTargets(v, out, depth + 1);
  else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const c of CONDITIONS) if (c in obj) conditionTargets(obj[c], out, depth + 1);
    for (const [k, v] of Object.entries(obj)) if (!CONDITIONS.includes(k)) conditionTargets(v, out, depth + 1);
  }
  return out;
}

/** Targets for `key` in a subpath map ({"./x": …, "./*": …} or {"#a": …}), longest pattern first. */
function matchSubpath(map: Record<string, unknown>, key: string): string[] {
  if (key in map) return conditionTargets(map[key]);
  let best: string | undefined;
  let star = "";
  for (const k of Object.keys(map)) {
    const i = k.indexOf("*");
    if (i < 0) continue;
    const pre = k.slice(0, i);
    const post = k.slice(i + 1);
    if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length && (!best || pre.length > best.indexOf("*"))) {
      best = k;
      star = key.slice(pre.length, key.length - post.length);
    }
  }
  return best ? conditionTargets(map[best]).map((t) => t.replaceAll("*", star)) : [];
}

function matchExports(exportsField: unknown, subpath: string): string[] {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) return subpath === "." ? conditionTargets(exportsField) : [];
  if (!exportsField || typeof exportsField !== "object") return [];
  const obj = exportsField as Record<string, unknown>;
  const isSubpathMap = Object.keys(obj).some((k) => k.startsWith("."));
  if (!isSubpathMap) return subpath === "." ? conditionTargets(obj) : [];
  return matchSubpath(obj, subpath);
}

// ─── CSS ─────────────────────────────────────────────────────────────────────────────────────

const CSS_EXTS = [".scss", ".sass", ".css", ".less", ".styl", ".pcss"];
const SASS_BUILTINS = /^sass:/;

function resolveCss(idx: RepoIndex, js: () => JsResolver, from: string, spec: string): ImportResolution {
  if (SASS_BUILTINS.test(spec)) return ext(spec.slice(5) ? "sass" : spec, "sass");
  if (spec.startsWith("~")) return js().resolve(from, spec.slice(1), "import");
  const clean = spec.replace(/[?#].*$/, "");
  const fromDir = dirname(from);
  const base = clean.startsWith("/") ? join("", clean) : join(fromDir, clean);
  const hit = cssProbe(idx, base);
  if (hit !== undefined) return { file: hit };
  if (clean.startsWith(".") || clean.startsWith("/")) return UNRESOLVED;
  // Bare: tsconfig aliases and packages, as a bundler would.
  return js().resolve(from, clean, "import");
}

function cssProbe(idx: RepoIndex, p: string | undefined): number | undefined {
  if (p === undefined) return undefined;
  const exact = idx.file(p);
  if (exact !== undefined) return exact;
  const dir = dirname(p);
  const base = basename(p);
  for (const e of CSS_EXTS) {
    // Sass partials: `@use "vars"` finds `_vars.scss`.
    const hit = idx.file(p + e) ?? idx.file(join(dir, `_${base}${e}`));
    if (hit !== undefined) return hit;
  }
  for (const e of CSS_EXTS) {
    const hit = idx.file(`${p}/_index${e}`) ?? idx.file(`${p}/index${e}`);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// ─── Links (HTML, Markdown, CSS url()) ───────────────────────────────────────────────────────

function resolveLink(idx: RepoIndex, js: () => JsResolver, from: string, spec: string): ImportResolution {
  const fromDir = dirname(from);
  const tryPath = (p: string | undefined) => {
    if (p === undefined) return undefined;
    const exact = idx.file(p);
    if (exact !== undefined) return exact;
    // A link to a directory means its index page or README.
    if (idx.dirs.has(p)) {
      for (const n of ["index.html", "README.md", "readme.md", "index.md", "README", "README.rst"]) {
        const hit = idx.file(p ? `${p}/${n}` : n);
        if (hit !== undefined) return hit;
      }
    }
    // Docs sites (VitePress, Docusaurus, MkDocs) link the built page: `/guide/x.html` or
    // `/guide/x` is the source `guide/x.md`.
    const stem = p.replace(/\.html?$/, "");
    return idx.file(stem + ".md") ?? idx.file(stem + ".mdx") ?? (stem !== p ? undefined : idx.file(p + ".html"));
  };
  if (spec.startsWith("/")) {
    const hit = js().rootRelative(fromDir, spec, (p) => tryPath(p) ?? (/\.[cm]?[jt]sx?$/.test(spec) ? js().probe(p) : undefined));
    return hit === undefined ? UNRESOLVED : { file: hit };
  }
  const p = join(fromDir, spec);
  const hit = tryPath(p) ?? js().probe(p);
  return hit === undefined ? UNRESOLVED : { file: hit };
}

// ─── Python ──────────────────────────────────────────────────────────────────────────────────

// sys.stdlib_module_names (3.14) plus modules removed since 3.11, which older code still imports.
const PY_STDLIB = new Set(
  (
    "__future__ abc aifc annotationlib antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 " +
    "cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall compression concurrent configparser contextlib " +
    "contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum " +
    "errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip " +
    "hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging " +
    "lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers " +
    "opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile " +
    "profiling pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched " +
    "secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 ssl stat statistics string " +
    "stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time " +
    "timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv " +
    "warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo _thread"
  ).split(" "),
);

interface PyModule {
  id: number;
  root: string;
}

class PythonResolver {
  private modules = new Map<string, PyModule[]>();

  constructor(private idx: RepoIndex) {
    const pkgDirs = new Set<string>();
    for (const p of idx.paths) {
      const b = basename(p);
      if (b === "__init__.py" || b === "__init__.pyi") pkgDirs.add(dirname(p));
    }
    idx.paths.forEach((p, id) => {
      if (!/\.(?:py|pyi|pyx)$/.test(p)) return;
      // A module's import root is the first ancestor that is not itself a package.
      let root = dirname(p);
      while (root && pkgDirs.has(root)) root = dirname(root);
      const rel = root ? p.slice(root.length + 1) : p;
      let dotted = rel.replace(/\.(?:py|pyi|pyx)$/, "").replaceAll("/", ".");
      if (dotted.endsWith(".__init__")) dotted = dotted.slice(0, -9);
      if (dotted === "__init__") return;
      const list = this.modules.get(dotted);
      if (list) list.push({ id, root });
      else this.modules.set(dotted, [{ id, root }]);
    });
  }

  resolve(from: string, spec: string): ImportResolution {
    if (spec.startsWith(".")) return this.relative(from, spec);
    const top = spec.split(".")[0]!;
    const fromDir = dirname(from);
    const exact = this.modules.get(spec);
    const local = exact && this.pick(exact, fromDir, true);
    if (local !== undefined) return { file: local };
    if (PY_STDLIB.has(top)) return ext(top, "python-stdlib");
    if (exact) return { file: this.pick(exact, fromDir, false)! };
    // `import pkg.missing` or a compiled extension: the deepest package that does exist.
    const parts = spec.split(".");
    for (let k = parts.length - 1; k >= 1; k--) {
      const cands = this.modules.get(parts.slice(0, k).join("."));
      if (cands) return { file: this.pick(cands, fromDir, false)! };
    }
    return ext(top, "pypi");
  }

  /** Prefer a module whose import root contains the importer; `sameRootOnly` makes it strict. */
  private pick(cands: PyModule[], fromDir: string, sameRootOnly: boolean): number | undefined {
    let best: PyModule | undefined;
    for (const c of cands) {
      const contains = c.root === "" || fromDir === c.root || fromDir.startsWith(c.root + "/");
      if (contains && (!best || c.root.length > best.root.length)) best = c;
    }
    if (best) return best.id;
    if (sameRootOnly) return undefined;
    return cands.reduce((a, b) => (this.idx.paths[a.id]!.length <= this.idx.paths[b.id]!.length ? a : b)).id;
  }

  private relative(from: string, spec: string): ImportResolution {
    const dots = /^\.+/.exec(spec)![0].length;
    let base: string | undefined = dirname(from);
    for (let k = 1; k < dots && base !== undefined; k++) base = base === "" ? undefined : dirname(base);
    if (base === undefined) return UNRESOLVED;
    const rest = spec.slice(dots).replaceAll(".", "/");
    const idx = this.idx;
    const probe = (p: string) =>
      idx.file(`${p}.py`) ?? idx.file(`${p}/__init__.py`) ?? idx.file(`${p}.pyi`) ?? idx.file(`${p}/__init__.pyi`) ?? idx.file(`${p}.pyx`);
    if (rest) {
      const hit = probe(base ? `${base}/${rest}` : rest);
      if (hit !== undefined) return { file: hit };
    }
    // `from . import name` where name lives in __init__.py.
    const init = idx.file(base ? `${base}/__init__.py` : "__init__.py") ?? idx.file(base ? `${base}/__init__.pyi` : "__init__.pyi");
    return init === undefined ? UNRESOLVED : { file: init };
  }
}

// ─── Go ──────────────────────────────────────────────────────────────────────────────────────

const isGoSource = (p: string) => p.endsWith(".go") && !p.endsWith("_test.go");

class GoResolver {
  private modules: { path: string; dir: string }[] = [];
  private requires: string[] = [];

  constructor(
    ctx: ResolveContext,
    private idx: RepoIndex,
  ) {
    for (const p of idx.paths) {
      if (basename(p) !== "go.mod" || p.includes("/vendor/")) continue;
      const text = ctx.readText(p) ?? "";
      const mod = /^module\s+(\S+)/m.exec(text)?.[1];
      if (mod) this.modules.push({ path: mod.replace(/^"|"$/g, ""), dir: dirname(p) });
      for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[^\s]+)\s+v[\w.+-]+/gm)) this.requires.push(m[1]!);
    }
    this.modules.sort((a, b) => b.path.length - a.path.length);
    this.requires.sort((a, b) => b.length - a.length);
  }

  /**
   * Go imports name packages, which are directories. The edge goes to a representative file
   * (the one named after the directory, else the first non-test file) and the rest of the
   * package's non-test files ride along in `also`, so callers can draw package-level fan-out.
   */
  resolve(from: string, spec: string): ImportResolution {
    for (const m of this.modules) {
      if (spec !== m.path && !spec.startsWith(m.path + "/")) continue;
      const dir = join(m.dir, spec.slice(m.path.length + 1));
      const pkg = dir === undefined ? undefined : this.idx.directory(dir, isGoSource);
      return pkg ?? UNRESOLVED;
    }
    // Vendored dependencies resolve into the repo like local packages.
    for (let d = dirname(from); ; d = dirname(d)) {
      const vendored = this.idx.dirs.has(join(d, "vendor") ?? "") ? this.idx.directory(join(d, `vendor/${spec}`) ?? "", isGoSource) : undefined;
      if (vendored) return vendored;
      if (d === "") break;
    }
    const first = spec.split("/")[0]!;
    if (!first.includes(".")) return ext(spec, "go-stdlib");
    const req = this.requires.find((r) => spec === r || spec.startsWith(r + "/"));
    if (req) return ext(req, "go");
    const parts = spec.split("/");
    const n = /^(?:github\.com|gitlab\.com|bitbucket\.org|golang\.org|go\.googlesource\.com)$/.test(first) ? 3 : 2;
    return ext(parts.slice(0, n).join("/"), "go");
  }
}

// ─── Rust ────────────────────────────────────────────────────────────────────────────────────

const RUST_STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);

interface Crate {
  dir: string;
  root: number | undefined; // lib.rs, else main.rs
}

class RustResolver {
  private crates = new Map<string, Crate>(); // by normalized name (`-` → `_`)
  private manifestDirs = new Set<string>();
  private nearestCache = new Map<string, string | null>();

  constructor(
    ctx: ResolveContext,
    private idx: RepoIndex,
  ) {
    for (const p of idx.paths) {
      if (basename(p) !== "Cargo.toml") continue;
      const dir = dirname(p);
      this.manifestDirs.add(dir);
      const text = ctx.readText(p) ?? "";
      let manifest: Record<string, unknown> = {};
      try {
        manifest = Bun.TOML.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      const pkg = manifest.package as Record<string, unknown> | undefined;
      const lib = manifest.lib as Record<string, unknown> | undefined;
      const name = (typeof lib?.name === "string" ? lib.name : undefined) ?? (typeof pkg?.name === "string" ? pkg.name : undefined);
      if (!name) continue;
      const libPath = typeof lib?.path === "string" ? join(dir, lib.path) : undefined;
      const root = idx.file(libPath) ?? idx.file(join(dir, "src/lib.rs")) ?? idx.file(join(dir, "src/main.rs"));
      this.crates.set(name.replaceAll("-", "_"), { dir, root });
    }
  }

  private crateDir(from: string): string | undefined {
    const start = dirname(from);
    const cached = this.nearestCache.get(start);
    if (cached !== undefined) return cached ?? undefined;
    let found: string | undefined;
    for (let d = start; ; d = dirname(d)) {
      if (this.manifestDirs.has(d)) {
        found = d;
        break;
      }
      if (d === "") break;
    }
    this.nearestCache.set(start, found ?? null);
    return found;
  }

  /** Crate roots: lib.rs, main.rs, build.rs, and each file directly in bin/, tests/, examples/, benches/. */
  private isCrateRoot(path: string): boolean {
    const crate = this.crateDir(path) ?? "";
    const rel = crate ? path.slice(crate.length + 1) : path;
    return /^(?:src\/(?:lib|main)\.rs|build\.rs|src\/bin\/[^/]+\.rs|src\/bin\/[^/]+\/main\.rs|(?:tests|examples|benches)\/[^/]+\.rs|(?:tests|examples|benches)\/[^/]+\/main\.rs)$/.test(rel);
  }

  /** Directory holding the child modules of the module defined in `path`. */
  private childDir(path: string): string {
    const b = basename(path);
    if (b === "mod.rs" || this.isCrateRoot(path)) return dirname(path);
    return path.slice(0, -3);
  }

  /** The module file that owns `dir` (inverse of childDir), for `super::` and fallbacks. */
  private ownerOf(dir: string, crateRoot: number | undefined): number | undefined {
    const idx = this.idx;
    const own = idx.file(`${dir}.rs`) ?? idx.file(`${dir}/mod.rs`);
    if (own !== undefined) return own;
    if (crateRoot !== undefined && dirname(idx.paths[crateRoot]!) === dir) return crateRoot;
    return idx.file(`${dir}/lib.rs`) ?? idx.file(`${dir}/main.rs`);
  }

  private walk(dir: string, segs: string[]): { file: number | undefined; used: number } {
    let file: number | undefined;
    let used = 0;
    let d = dir;
    for (const s of segs) {
      const hit = this.idx.file(`${d}/${s}.rs`) ?? this.idx.file(`${d}/${s}/mod.rs`);
      if (hit === undefined) break;
      file = hit;
      d = `${d}/${s}`;
      used++;
    }
    return { file, used };
  }

  private rootOf(from: string): number | undefined {
    if (this.isCrateRoot(from)) return this.idx.file(from);
    const dir = this.crateDir(from);
    return this.idx.file(join(dir ?? "", "src/lib.rs")) ?? this.idx.file(join(dir ?? "", "src/main.rs"));
  }

  resolve(from: string, spec: string, kind: RawImport["kind"]): ImportResolution {
    const fromId = this.idx.file(from);
    if (kind === "include") {
      // `mod x;` → x.rs or x/mod.rs next to (or under) the declaring module.
      const dir = this.childDir(from);
      const hit = this.idx.file(`${dir}/${spec}.rs`) ?? this.idx.file(`${dir}/${spec}/mod.rs`);
      return hit === undefined ? UNRESOLVED : { file: hit };
    }
    const segs = spec.split("::").filter(Boolean);
    const first = segs[0];
    if (!first) return UNRESOLVED;
    const root = this.rootOf(from);
    let start: string;
    let owner: number | undefined;
    let rest: string[];
    if (first === "crate") {
      if (root === undefined) return UNRESOLVED;
      start = dirname(this.idx.paths[root]!);
      owner = root;
      rest = segs.slice(1);
    } else if (first === "self" || first === "super") {
      let dir = this.childDir(from);
      let k = 0;
      owner = fromId;
      if (first === "self") k = 1;
      while (segs[k] === "super") {
        dir = dirname(dir);
        owner = this.ownerOf(dir, root);
        k++;
      }
      start = dir;
      rest = segs.slice(k);
    } else if (RUST_STD.has(first)) {
      return ext(first, "rust-stdlib");
    } else {
      const crate = this.crates.get(first);
      // 2018 uniform paths: a child module of the current module shadows a crate name.
      const childDir = this.childDir(from);
      const local = this.walk(childDir, [first]);
      if (local.file !== undefined) {
        start = childDir;
        owner = fromId;
        rest = segs;
      } else if (crate && crate.root !== undefined) {
        start = dirname(this.idx.paths[crate.root]!);
        owner = crate.root;
        rest = segs.slice(1);
      } else return ext(first, "cargo");
    }
    const walked = this.walk(start, rest);
    const file = walked.file ?? owner;
    return file === undefined ? UNRESOLVED : { file };
  }
}

// ─── JVM ─────────────────────────────────────────────────────────────────────────────────────

const isJvm = (p: string) => /\.(?:java|kt|kts|scala|sc|groovy)$/.test(p);

/** Dotted directory suffixes (≤ 8 segments) → directories holding at least one accepted file. */
function dirSuffixIndex(idx: RepoIndex, accept: (p: string) => boolean): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [dir, ids] of idx.dirFiles) {
    if (!dir || !ids.some((id) => accept(idx.paths[id]!))) continue;
    const segs = dir.split("/");
    for (let k = segs.length - 1; k >= Math.max(0, segs.length - 8); k--) {
      const key = segs.slice(k).join(".");
      const list = index.get(key);
      if (list) list.push(dir);
      else index.set(key, [dir]);
    }
  }
  return index;
}

function closestDir(dirs: string[], from: string): string {
  const fromDir = dirname(from);
  return dirs.reduce((a, b) => (commonPrefixDepth(b, fromDir) > commonPrefixDepth(a, fromDir) ? b : a));
}

class JvmResolver {
  private classes = new Map<string, number[]>();
  private packages: Map<string, string[]>;

  constructor(private idx: RepoIndex) {
    // Every dotted suffix of the path (up to 8 segments), because the source root (src/main/
    // java, app/src/main/kotlin, …) is unknown and a fully-qualified name matches one suffix.
    idx.paths.forEach((p, id) => {
      if (!isJvm(p)) return;
      const segs = p.replace(/\.[^.]+$/, "").split("/");
      for (let k = segs.length - 1; k >= Math.max(0, segs.length - 8); k--) {
        const key = segs.slice(k).join(".");
        const list = this.classes.get(key);
        if (list) list.push(id);
        else this.classes.set(key, [id]);
      }
    });
    this.packages = dirSuffixIndex(idx, isJvm);
  }

  resolve(from: string, spec: string): ImportResolution {
    const wildcard = /\.[*_]$/.test(spec);
    const name = spec.replace(/\.[*_]$/, "");
    if (wildcard) {
      const dirs = this.packages.get(name);
      if (dirs) {
        const pkg = this.idx.directory(closestDir(dirs, from), isJvm);
        if (pkg) return pkg;
      }
      // `import a.b.C.*` (members of a class) falls through to the class lookup.
    }
    const parts = name.split(".");
    // Static imports and nested classes name members below the file: shorten until a file matches.
    for (let k = parts.length; k >= 2; k--) {
      const cands = this.classes.get(parts.slice(0, k).join("."));
      if (cands) return { file: closest(this.idx, cands, from) };
    }
    const first = parts[0]!;
    if (/^(?:java|javax|jdk|sun)$/.test(first) || name.startsWith("com.sun.")) return ext(parts.slice(0, 2).join("."), "java-stdlib");
    if (first === "kotlin") return ext(parts.slice(0, 2).join("."), "kotlin-stdlib");
    if (first === "scala") return ext(parts.slice(0, 2).join("."), "scala-stdlib");
    if (first === "android" || first === "dalvik") return ext(parts.slice(0, 2).join("."), "android");
    const n = /^(?:com|org|net|io|dev|edu|gov|co|me|app|ai|tech|xyz|de|uk|fr|ch|nl|ru|cn|jp)$/.test(first) ? 3 : 2;
    return ext(parts.slice(0, n).join("."), "maven");
  }
}

function closest(idx: RepoIndex, cands: number[], from: string): number {
  const fromDir = dirname(from);
  let best = cands[0]!;
  let score = -1;
  for (const id of cands) {
    const s = commonPrefixDepth(dirname(idx.paths[id]!), fromDir);
    if (s > score || (s === score && idx.paths[id]!.length < idx.paths[best]!.length)) {
      best = id;
      score = s;
    }
  }
  return best;
}

// ─── C / C++ ─────────────────────────────────────────────────────────────────────────────────

const C_STD_HEADERS = new Set(
  (
    "assert.h complex.h ctype.h errno.h fenv.h float.h inttypes.h iso646.h limits.h locale.h math.h setjmp.h signal.h stdalign.h stdarg.h " +
    "stdatomic.h stdbool.h stddef.h stdint.h stdio.h stdlib.h stdnoreturn.h string.h tgmath.h threads.h time.h uchar.h wchar.h wctype.h " +
    "unistd.h fcntl.h dirent.h pthread.h sys/types.h sys/stat.h sys/time.h sys/socket.h sys/wait.h sys/mman.h sys/ioctl.h netinet/in.h " +
    "arpa/inet.h netdb.h poll.h termios.h dlfcn.h windows.h"
  ).split(" "),
);

function resolveC(idx: RepoIndex, from: string, spec: string): ImportResolution {
  if (spec.startsWith("<") && spec.endsWith(">")) {
    const inner = spec.slice(1, -1);
    // No extension (<vector>) or a standard header: the toolchain's, even if a same-named file
    // exists somewhere in the repo.
    if (C_STD_HEADERS.has(inner) || !/\.[a-z]+$/i.test(inner)) return ext(inner, "system");
    const hit = idx.suffix(inner, from);
    return hit === undefined ? ext(inner, "system") : { file: hit };
  }
  if (!spec.includes(".") && !spec.includes("/")) return ext(spec, "system"); // @import Foundation
  const rel = idx.file(join(dirname(from), spec));
  if (rel !== undefined) return { file: rel };
  const hit = idx.suffix(spec, from);
  return hit === undefined ? UNRESOLVED : { file: hit };
}

// ─── PHP, Ruby, and the rest ─────────────────────────────────────────────────────────────────

class PhpResolver {
  private prefixes: { prefix: string; dirs: string[] }[] = [];

  constructor(ctx: ResolveContext, idx: RepoIndex) {
    for (const p of idx.paths) {
      if (basename(p) !== "composer.json" || p.includes("vendor/")) continue;
      const json = readJson(ctx, p);
      for (const section of [json?.autoload, json?.["autoload-dev"]]) {
        const psr4 = (section as Record<string, unknown> | undefined)?.["psr-4"];
        if (!psr4 || typeof psr4 !== "object") continue;
        for (const [prefix, dirs] of Object.entries(psr4 as Record<string, unknown>)) {
          const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d): d is string => typeof d === "string").map((d) => join(dirname(p), d) ?? "");
          this.prefixes.push({ prefix: prefix.replace(/\\+$/, ""), dirs: list });
        }
      }
    }
    this.prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  resolve(idx: RepoIndex, from: string, spec: string): ImportResolution {
    if (spec.includes("/") || /\.(?:php|inc|phtml)$/.test(spec)) {
      const hit = idx.file(join(dirname(from), spec)) ?? idx.file(join("", spec)) ?? idx.suffix(spec, from);
      return hit === undefined ? UNRESOLVED : { file: hit };
    }
    const ns = spec.replace(/^\\/, "");
    for (const { prefix, dirs } of this.prefixes) {
      if (ns !== prefix && !ns.startsWith(prefix + "\\")) continue;
      const rest = ns.slice(prefix.length + 1).replaceAll("\\", "/");
      for (const d of dirs) {
        const hit = idx.file(join(d, `${rest}.php`) ?? "");
        if (hit !== undefined) return { file: hit };
      }
    }
    const hit = idx.suffix(`${ns.replaceAll("\\", "/")}.php`, from);
    if (hit !== undefined) return { file: hit };
    const parts = ns.split("\\");
    return ext(parts.slice(0, 2).join("\\"), "composer");
  }
}

const RUBY_STDLIB = new Set(
  "abbrev base64 benchmark bigdecimal cgi coverage csv date delegate digest English erb etc fcntl fiddle fileutils find forwardable getoptlong io/console ipaddr irb json logger matrix minitest monitor net/http net/https objspace observer open-uri open3 openssl optparse ostruct pathname pp prettyprint prime pstore psych racc rdoc readline reline resolv ripper securerandom set shellwords singleton socket stringio strscan syslog tempfile test/unit time timeout tmpdir tsort un uri weakref yaml zlib".split(" "),
);

function resolveRuby(idx: RepoIndex, from: string, spec: string): ImportResolution {
  const withRb = spec.endsWith(".rb") ? spec : `${spec}.rb`;
  if (spec.startsWith(".")) {
    const hit = idx.file(join(dirname(from), withRb)) ?? idx.file(join(dirname(from), spec));
    return hit === undefined ? UNRESOLVED : { file: hit };
  }
  // The load path is lib/ by convention (plus test/ and spec/ for helpers).
  const hit = idx.suffix(withRb, from, (p) => /(?:^|\/)(?:lib|test|spec|app)\//.test(p) || p === withRb);
  if (hit !== undefined) return { file: hit };
  if (RUBY_STDLIB.has(spec) || RUBY_STDLIB.has(spec.split("/")[0]!)) return ext(spec.split("/")[0]!, "ruby-stdlib");
  return ext(spec.split("/")[0]!, "gem");
}

/** Relative to the file, then the repo root, then by path suffix. */
function resolvePathLike(idx: RepoIndex, from: string, spec: string, exts: string[] = [""]): number | undefined {
  for (const base of [dirname(from), ""]) {
    for (const e of exts) {
      const hit = idx.file(join(base, spec + e));
      if (hit !== undefined) return hit;
    }
  }
  if (spec.startsWith("../")) return undefined;
  for (const e of exts) {
    const hit = idx.suffix(spec + e, from);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const ELIXIR_STDLIB = new Set("Kernel Enum Map List String Integer Float Atom Tuple Keyword Agent Application Code Process GenServer Supervisor Task Registry DynamicSupervisor Logger IO File Path System Stream Regex Date DateTime NaiveDateTime Time Calendar URI Base Access Protocol Macro Module Record Exception ExUnit Mix EEx IEx Inspect Bitwise Range MapSet Port Node Function Version".split(" "));

function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
}

// ─── Dispatch ────────────────────────────────────────────────────────────────────────────────

const JS_LANGS = new Set(["javascript", "typescript", "tsx", "glimmer-js", "glimmer-ts", "mdx", "vue", "svelte", "astro", "html", "ejs", "handlebars"]);
const CSS_LANGS = new Set(["css", "scss", "sass", "less", "stylus", "postcss"]);
const PY_LANGS = new Set(["python", "cython", "starlark"]);
const JVM_LANGS = new Set(["java", "kotlin", "scala", "groovy", "gradle-kotlin-dsl"]);
const C_LANGS = new Set(["c", "c++", "objective-c", "objective-c++", "cuda", "metal", "hlsl", "glsl"]);

export const createResolver: CreateResolver = (ctx) => {
  const idx = new RepoIndex(ctx.paths);
  const lazy = <T>(make: () => T) => {
    let v: T | undefined;
    return () => (v ??= make());
  };
  const js = lazy(() => new JsResolver(ctx, idx));
  const py = lazy(() => new PythonResolver(idx));
  const go = lazy(() => new GoResolver(ctx, idx));
  const rust = lazy(() => new RustResolver(ctx, idx));
  const jvm = lazy(() => new JvmResolver(idx));
  const php = lazy(() => new PhpResolver(ctx, idx));
  const csDirs = lazy(() => dirSuffixIndex(idx, (p) => p.endsWith(".cs")));
  const pubspecs = lazy(() => {
    const names = new Map<string, string>();
    for (const p of ctx.paths) {
      if (basename(p) !== "pubspec.yaml") continue;
      const name = /^name:\s*(\S+)/m.exec(ctx.readText(p) ?? "")?.[1];
      if (name) names.set(name, dirname(p));
    }
    return names;
  });
  const fileOr = (id: number | undefined, fallback: ImportResolution = UNRESOLVED): ImportResolution => (id === undefined ? fallback : { file: id });

  return (fromFile, imp, languageId) => {
    const from = ctx.paths[fromFile];
    if (from === undefined) return UNRESOLVED;
    const spec = imp.spec;
    if (imp.kind === "link") return resolveLink(idx, js, from, spec);
    if (CSS_LANGS.has(languageId)) return resolveCss(idx, js, from, spec);
    if (JS_LANGS.has(languageId)) {
      const r = js().resolve(from, spec, imp.kind);
      // Component <style> blocks import Sass partials by bare name; give them a CSS look.
      if (!("file" in r) && (languageId === "vue" || languageId === "svelte" || languageId === "astro")) {
        const css = cssProbe(idx, join(dirname(from), spec));
        if (css !== undefined) return { file: css };
      }
      return r;
    }
    if (PY_LANGS.has(languageId)) return py().resolve(from, spec);
    if (languageId === "go") return go().resolve(from, spec);
    if (languageId === "rust") return rust().resolve(from, spec, imp.kind);
    if (JVM_LANGS.has(languageId)) return jvm().resolve(from, spec);
    if (C_LANGS.has(languageId)) return resolveC(idx, from, spec);
    if (languageId === "php") return php().resolve(idx, from, spec);
    if (languageId === "ruby" || languageId === "crystal") return resolveRuby(idx, from, spec);

    switch (languageId) {
      case "c#": {
        // Namespaces mirror folders by convention, minus the root namespace when the project
        // folder carries it (MyApp.Api/Services ↔ MyApp.Api.Services, or Services alone).
        const parts = spec.split(".");
        const dirs = csDirs().get(spec) ?? (parts.length > 1 ? csDirs().get(parts.slice(1).join(".")) : undefined);
        const dir = dirs ? idx.directory(closestDir(dirs, from), (p) => p.endsWith(".cs")) : undefined;
        if (dir) return dir;
        return ext(parts.slice(0, parts[0] === "System" || parts[0] === "Microsoft" ? 1 : 2).join("."), parts[0] === "System" || parts[0] === "Microsoft" ? "dotnet" : "nuget");
      }
      case "swift": {
        const dir = idx.directory(`Sources/${spec}`, (p) => p.endsWith(".swift"));
        return dir ?? ext(spec.split(".")[0]!, "swift");
      }
      case "dart": {
        if (spec.startsWith("dart:")) return ext(spec.slice(5), "dart-stdlib");
        const pkg = /^package:([^/]+)\/(.+)$/.exec(spec);
        if (pkg) {
          const dir = pubspecs().get(pkg[1]!);
          return dir === undefined ? ext(pkg[1]!, "pub") : fileOr(idx.file(join(dir, `lib/${pkg[2]}`)));
        }
        return fileOr(idx.file(join(dirname(from), spec)));
      }
      case "elixir": {
        const parts = spec.split(".");
        if (ELIXIR_STDLIB.has(parts[0]!)) return ext(parts[0]!, "elixir-stdlib");
        const path = parts.map(snake).join("/");
        return fileOr(idx.suffix(`${path}.ex`, from) ?? idx.suffix(`${path}.exs`, from), ext(snake(parts[0]!), "hex"));
      }
      case "haskell":
      case "elm":
      case "purescript": {
        const e = languageId === "haskell" ? [".hs", ".lhs"] : languageId === "elm" ? [".elm"] : [".purs"];
        const path = spec.replaceAll(".", "/");
        for (const x of e) {
          const hit = idx.suffix(path + x, from);
          if (hit !== undefined) return { file: hit };
        }
        return ext(spec, languageId === "haskell" ? "hackage" : languageId);
      }
      case "lua":
      case "luau": {
        const path = spec.replaceAll(".", "/");
        return fileOr(resolvePathLike(idx, from, path, [".lua", "/init.lua", ".luau"]), ext(spec.split(".")[0]!, "luarocks"));
      }
      case "perl": {
        if (/\.p[lm]$/.test(spec)) return fileOr(resolvePathLike(idx, from, spec));
        const hit = idx.suffix(`${spec.replaceAll("::", "/")}.pm`, from);
        if (hit !== undefined) return { file: hit };
        // Lowercase names are pragmas (strict, warnings, utf8, lib…).
        return /^[a-z]/.test(spec) ? ext(spec, "perl-stdlib") : ext(spec, "cpan");
      }
      case "julia": {
        if (imp.kind === "include") return fileOr(resolvePathLike(idx, from, spec));
        const name = spec.replace(/^\.+/, "").split(".")[0]!;
        return fileOr(idx.suffix(`src/${name}.jl`, from), spec.startsWith(".") ? UNRESOLVED : ext(name, "julia"));
      }
      case "r":
        return imp.kind === "include" ? fileOr(resolvePathLike(idx, from, spec)) : ext(spec, "cran");
      case "zig":
        if (spec === "std" || spec === "builtin" || spec === "root") return ext(spec, "zig-stdlib");
        return spec.endsWith(".zig") || spec.endsWith(".zon") ? fileOr(idx.file(join(dirname(from), spec))) : ext(spec, "zig");
      case "nix": {
        if (spec.startsWith("<")) return ext(spec.slice(1, -1).split("/")[0]!, "nix");
        const p = join(dirname(from), spec);
        return fileOr(idx.file(p) ?? idx.file(p === undefined ? undefined : `${p}/default.nix`));
      }
      case "protocol-buffer": {
        if (spec.startsWith("google/protobuf/")) return ext("google/protobuf", "protobuf");
        return fileOr(resolvePathLike(idx, from, spec), ext(spec, "protobuf"));
      }
      case "hcl": {
        if (!spec.startsWith(".")) return ext(spec.replace(/\?.*$/, ""), "terraform");
        const dir = join(dirname(from), spec);
        return (dir !== undefined ? idx.directory(dir, (p) => p.endsWith(".tf")) : undefined) ?? UNRESOLVED;
      }
      case "dockerfile":
        return ext(spec.replace(/@sha256:.*$/, "").replace(/:[^/:]+$/, ""), "docker");
      case "cmake":
        return fileOr(resolvePathLike(idx, from, spec, ["", ".cmake"]), /^[A-Z]/.test(spec) ? ext(spec, "cmake") : UNRESOLVED);
      default:
        // Shell `source`, Makefile `include`, and anything else path-shaped.
        return fileOr(resolvePathLike(idx, from, spec));
    }
  };
};
