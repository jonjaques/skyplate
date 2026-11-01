/**
 * readManifests: every package manifest in the walk, parsed into Manifest records and one
 * merged list of declared external dependencies. readProjectInfo: the root README's first
 * prose paragraph and a license guess.
 *
 * Parsing is deliberately shallow and forgiving: TOML, YAML and JSON go through Bun's parsers,
 * the formats that are really programs (Gemfile, mix.exs, Package.swift, build.gradle) through
 * line patterns that read the conventional forms and nothing more. A manifest that will not
 * parse is skipped, never thrown: one broken fixture must not cost a report its dependency
 * table.
 *
 * Dependencies on packages the repository itself declares (pnpm/yarn workspaces, Cargo path
 * dependencies, "workspace:*" ranges) are dropped. They are internal edges, and the import
 * graph already shows them as files; listing them again as externals would double-count.
 */

import type { ExternalDependency, Manifest } from "../shared/schema";
import type { ReadManifests, ReadProjectInfo } from "./contracts";

type Scope = ExternalDependency["scope"];

interface Declared {
  name: string;
  version?: string;
  scope: Scope;
  /** Ecosystem override for manifests that mix them (environment.yml pip entries, deno). */
  ecosystem?: string;
}

interface Parsed {
  kind: string;
  ecosystem: string;
  name?: string;
  version?: string;
  license?: string;
  deps: Declared[];
}

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** Groups that, by near-universal convention, hold development tooling rather than features. */
const DEV_GROUP = /^(?:dev|develop|development|test|tests|testing|lint|linting|docs?|typing|types|typecheck|ci|bench|benchmark|format|style|qa|check)(?:[-_].*)?$/i;

// Scopes from strongest to weakest: a package declared runtime anywhere is a runtime dependency.
const SCOPE_RANK: Record<Scope, number> = { runtime: 0, peer: 1, optional: 2, build: 3, dev: 4, unknown: 5 };

/** PEP 503 normalization, so "Jinja2", "jinja2" and "jinja_2"-style spellings merge. */
const normalizePy = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** "requests[socks]>=2.0 ; python_version<'3.8'" → { name: "requests", version: ">=2.0" } */
function pep508(spec: string): { name: string; version?: string } | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(spec);
  if (!m) return undefined;
  let rest = m[2]!.split(";")[0]!.trim();
  if (rest.startsWith("@")) rest = ""; // direct reference: "pkg @ https://…"
  rest = rest.replace(/^\((.*)\)$/, "$1").trim();
  return { name: normalizePy(m[1]!), ...(rest ? { version: rest } : {}) };
}

// ─── JavaScript: package.json, deno.json ─────────────────────────────────────────────────────

/** Resolves pnpm "catalog:" ranges against pnpm-workspace.yaml, when the repo has one. */
type Catalogs = Map<string, Map<string, string>>;

const NPM_SECTIONS: [string, Scope][] = [
  ["dependencies", "runtime"],
  ["devDependencies", "dev"],
  ["peerDependencies", "peer"],
  ["optionalDependencies", "optional"],
];

function npmLicense(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  if (isObj(v)) return str(v.type);
  if (Array.isArray(v)) {
    const ids = v.map(npmLicense).filter((x): x is string => !!x);
    return ids.length ? ids.join(" OR ") : undefined;
  }
  return undefined;
}

function parsePackageJson(text: string, catalogs: Catalogs): Parsed {
  const j = parseJson(text);
  if (!isObj(j)) throw new Error("not an object");
  const deps: Declared[] = [];
  const seen = new Set<string>();
  for (const [section, scope] of NPM_SECTIONS) {
    const s = j[section];
    if (!isObj(s)) continue;
    for (const [key, raw] of Object.entries(s)) {
      let name = key;
      let version = str(raw);
      // Local protocols point at the repo's own packages (or a sibling checkout): internal.
      if (version && /^(?:workspace|link|file|portal):/.test(version)) continue;
      if (version?.startsWith("catalog:")) {
        const cat = version.slice(8) || "default";
        version = catalogs.get(cat)?.get(key);
      } else if (version?.startsWith("npm:")) {
        // Alias: "string-width-cjs": "npm:string-width@^4" installs string-width.
        const m = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.+))?$/.exec(version);
        if (m) {
          name = m[1]!;
          version = m[2];
        }
      }
      // peerDependencies usually repeat a devDependency; the first (stronger) section wins.
      if (seen.has(name)) continue;
      seen.add(name);
      deps.push({ name, scope, ...(version ? { version } : {}) });
    }
  }
  const license = npmLicense(j.license);
  return {
    kind: "package.json",
    ecosystem: "npm",
    ...(str(j.name) ? { name: str(j.name) } : {}),
    ...(str(j.version) ? { version: str(j.version) } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

function parseCatalogs(text: string): Catalogs {
  const y = Bun.YAML.parse(text);
  const out: Catalogs = new Map();
  if (!isObj(y)) return out;
  const add = (name: string, v: unknown) => {
    if (!isObj(v)) return;
    const m = new Map<string, string>();
    for (const [k, ver] of Object.entries(v)) if (str(ver)) m.set(k, str(ver)!);
    out.set(name, m);
  };
  add("default", y.catalog);
  if (isObj(y.catalogs)) for (const [k, v] of Object.entries(y.catalogs)) add(k, v);
  return out;
}

function parseDeno(text: string): Parsed {
  const j = Bun.JSONC.parse(text);
  if (!isObj(j)) throw new Error("not an object");
  const deps: Declared[] = [];
  if (isObj(j.imports)) {
    for (const raw of Object.values(j.imports)) {
      const spec = str(raw);
      const m = spec && /^(jsr|npm):((?:@[^/@]+\/)?[^@/]+)(?:@([^/]+))?/.exec(spec);
      // URL and relative imports have no package identity to report.
      if (!m) continue;
      deps.push({ name: m[2]!, ecosystem: m[1]!, scope: "runtime", ...(m[3] ? { version: m[3] } : {}) });
    }
  }
  const license = str(j.license);
  return {
    kind: "deno.json",
    ecosystem: "jsr",
    ...(str(j.name) ? { name: str(j.name) } : {}),
    ...(str(j.version) ? { version: str(j.version) } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

// ─── Rust: Cargo.toml ────────────────────────────────────────────────────────────────────────

const CARGO_SECTIONS: [string, Scope][] = [
  ["dependencies", "runtime"],
  ["dev-dependencies", "dev"],
  ["dev_dependencies", "dev"],
  ["build-dependencies", "build"],
  ["build_dependencies", "build"],
];

function cargoDeps(table: unknown, scope: Scope, workspaceVersions: Map<string, string>, out: Declared[]) {
  if (!isObj(table)) return;
  for (const [key, v] of Object.entries(table)) {
    if (typeof v === "string") {
      out.push({ name: key, version: v, scope });
      continue;
    }
    if (!isObj(v)) continue;
    // A path dependency is a crate in this repository (a workspace member or a sibling).
    if (typeof v.path === "string") continue;
    const name = str(v.package) ?? key;
    const version = str(v.version) ?? (v.workspace === true ? workspaceVersions.get(key) : undefined);
    out.push({ name, scope: v.optional === true && scope === "runtime" ? "optional" : scope, ...(version ? { version } : {}) });
  }
}

/** What a workspace root lets its members inherit with `key.workspace = true`. */
interface CargoWorkspace {
  version?: string;
  license?: string;
  deps: Map<string, string>;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

/** Nearest workspace root at or above a manifest's directory. */
function cargoWorkspaceFor(path: string, roots: Map<string, CargoWorkspace>): CargoWorkspace | undefined {
  for (let dir = dirOf(path); ; dir = dirOf(dir.slice(0, -1))) {
    const ws = roots.get(dir);
    if (ws) return ws;
    if (dir === "") return undefined;
  }
}

function parseCargo(text: string, path: string, roots: Map<string, CargoWorkspace>): Parsed {
  const t = Bun.TOML.parse(text) as Record<string, unknown>;
  const pkg = isObj(t.package) ? t.package : {};
  const ws = isObj(t.workspace) ? t.workspace : undefined;
  const wsDeps: Declared[] = [];
  if (ws) {
    // Manifests are parsed shallowest first, so a root registers before its members read it.
    const wsPkg = isObj(ws.package) ? ws.package : {};
    cargoDeps(ws.dependencies, "runtime", new Map(), wsDeps);
    roots.set(dirOf(path), {
      ...(str(wsPkg.version) ? { version: str(wsPkg.version) } : {}),
      ...(str(wsPkg.license) ? { license: str(wsPkg.license) } : {}),
      deps: new Map(wsDeps.filter((d) => d.version).map((d) => [d.name, d.version!])),
    });
  }
  const inherited = cargoWorkspaceFor(path, roots);
  const wsVersions = inherited?.deps ?? new Map<string, string>();

  const deps: Declared[] = [];
  for (const [section, scope] of CARGO_SECTIONS) cargoDeps(t[section], scope, wsVersions, deps);
  if (isObj(t.target)) {
    for (const target of Object.values(t.target)) {
      if (!isObj(target)) continue;
      for (const [section, scope] of CARGO_SECTIONS) cargoDeps(target[section], scope, wsVersions, deps);
    }
  }
  // A virtual workspace root declares versions for its members; those are the repo's
  // dependencies even though no [dependencies] table names them here.
  if (deps.length === 0) deps.push(...wsDeps);

  const fromWorkspace = (v: unknown, key: "version" | "license") =>
    isObj(v) && v.workspace === true ? inherited?.[key] : ws ? roots.get(dirOf(path))?.[key] : undefined;
  const version = str(pkg.version) ?? fromWorkspace(pkg.version, "version");
  const license = str(pkg.license) ?? fromWorkspace(pkg.license, "license");
  return {
    kind: "Cargo.toml",
    ecosystem: "cargo",
    ...(str(pkg.name) ? { name: str(pkg.name) } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

// ─── Go: go.mod ──────────────────────────────────────────────────────────────────────────────

function parseGoMod(text: string): Parsed {
  const deps: Declared[] = [];
  let name: string | undefined;
  let inRequire = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (inRequire) {
      if (line.startsWith(")")) {
        inRequire = false;
        continue;
      }
      goRequire(line, deps);
      continue;
    }
    const mod = /^module\s+"?([^\s"]+)"?/.exec(line);
    if (mod) {
      name = mod[1];
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      continue;
    }
    const single = /^require\s+(.+)$/.exec(line);
    if (single) goRequire(single[1]!, deps);
  }
  return { kind: "go.mod", ecosystem: "go", ...(name ? { name } : {}), deps };
}

function goRequire(line: string, out: Declared[]) {
  // "// indirect" requirements are transitive pins go records for reproducible builds, the
  // same information a lockfile holds; reporting them as declared would flag every one of
  // them as "declared but never imported".
  if (/\/\/\s*indirect\b/.test(line)) return;
  const m = /^"?([^\s"]+)"?\s+(v[^\s]+)/.exec(line);
  if (m) out.push({ name: m[1]!, version: m[2]!, scope: "runtime" });
}

// ─── Python: pyproject.toml, requirements*.txt, Pipfile, setup.cfg, environment.yml ─────────

function pyList(v: unknown, scope: Scope, out: Declared[]) {
  if (!Array.isArray(v)) return;
  for (const item of v) {
    if (typeof item !== "string") continue; // {include-group = "…"} tables
    const d = pep508(item);
    if (d) out.push({ ...d, scope });
  }
}

function poetryDeps(v: unknown, scope: Scope, out: Declared[]) {
  if (!isObj(v)) return;
  for (const [key, spec] of Object.entries(v)) {
    if (key.toLowerCase() === "python") continue; // the interpreter constraint, not a package
    if (isObj(spec) && typeof spec.path === "string") continue;
    const version = typeof spec === "string" ? spec : isObj(spec) ? str(spec.version) : undefined;
    out.push({ name: normalizePy(key), scope, ...(version && version !== "*" ? { version } : {}) });
  }
}

function pyLicense(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  // PEP 621's legacy {text = "…"} form often holds the whole license text; keep short ids only.
  if (isObj(v) && typeof v.text === "string" && v.text.length <= 60) return str(v.text);
  return undefined;
}

function parsePyproject(text: string): Parsed {
  const t = Bun.TOML.parse(text) as Record<string, unknown>;
  const deps: Declared[] = [];
  const project = isObj(t.project) ? t.project : {};
  pyList(project.dependencies, "runtime", deps);
  if (isObj(project["optional-dependencies"])) {
    for (const [group, list] of Object.entries(project["optional-dependencies"])) {
      pyList(list, DEV_GROUP.test(group) ? "dev" : "optional", deps);
    }
  }
  if (isObj(t["dependency-groups"])) {
    for (const list of Object.values(t["dependency-groups"])) pyList(list, "dev", deps);
  }
  const buildSystem = isObj(t["build-system"]) ? t["build-system"] : {};
  pyList(buildSystem.requires, "build", deps);

  const tool = isObj(t.tool) ? t.tool : {};
  const poetry = isObj(tool.poetry) ? tool.poetry : {};
  poetryDeps(poetry.dependencies, "runtime", deps);
  poetryDeps(poetry["dev-dependencies"], "dev", deps);
  if (isObj(poetry.group)) {
    for (const [group, g] of Object.entries(poetry.group)) {
      if (isObj(g)) poetryDeps(g.dependencies, group === "main" ? "runtime" : "dev", deps);
    }
  }
  const uv = isObj(tool.uv) ? tool.uv : {};
  pyList(uv["dev-dependencies"], "dev", deps);
  const pdm = isObj(tool.pdm) ? tool.pdm : {};
  if (isObj(pdm["dev-dependencies"])) for (const list of Object.values(pdm["dev-dependencies"])) pyList(list, "dev", deps);

  const name = str(project.name) ?? str(poetry.name);
  const version = str(project.version) ?? str(poetry.version);
  const license = pyLicense(project.license) ?? str(poetry.license);
  return {
    kind: "pyproject.toml",
    ecosystem: "pypi",
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

function parseRequirements(text: string, path: string): Parsed | undefined {
  // pip-compile and uv export write fully pinned transitive closures: lockfiles in a .txt.
  if (/autogenerated by (?:pip-compile|uv)/i.test(text.slice(0, 600))) return undefined;
  const scope: Scope = /(?:^|[\/_.-])(?:dev|test|tests|testing|lint|docs?|ci|typing)(?:[\/_.-]|$)/i.test(path) ? "dev" : "runtime";
  const deps: Declared[] = [];
  for (const raw of text.replace(/\\\r?\n/g, " ").split("\n")) {
    const line = raw.replace(/(?:^|\s)#.*$/, "").trim();
    // Options (-r, -c, -e, --index-url) and bare URLs/paths name no package.
    if (!line || line.startsWith("-") || line.includes("://") || /^[./~]/.test(line)) continue;
    const d = pep508(line.replace(/\s--\S+.*$/, ""));
    if (d) deps.push({ ...d, scope });
  }
  return { kind: "requirements.txt", ecosystem: "pypi", deps };
}

function parsePipfile(text: string): Parsed {
  const t = Bun.TOML.parse(text) as Record<string, unknown>;
  const deps: Declared[] = [];
  poetryDeps(t.packages, "runtime", deps);
  poetryDeps(t["dev-packages"], "dev", deps);
  return { kind: "Pipfile", ecosystem: "pypi", deps };
}

/** Minimal INI reader for setup.cfg: sections, keys, and indented continuation lines. */
function parseIni(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let section = new Map<string, string>();
  out.set("", section);
  let key: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*[#;]/.test(line) || !line.trim()) continue;
    const sec = /^\[([^\]]+)\]\s*$/.exec(line);
    if (sec) {
      section = new Map();
      out.set(sec[1]!.trim(), section);
      key = undefined;
      continue;
    }
    if (/^\s/.test(line) && key) {
      section.set(key, `${section.get(key) ?? ""}\n${line.trim()}`);
      continue;
    }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!.trim();
      section.set(key, kv[2]!.trim());
    }
  }
  return out;
}

function parseSetupCfg(text: string): Parsed {
  const ini = parseIni(text);
  const meta = ini.get("metadata");
  const options = ini.get("options");
  const deps: Declared[] = [];
  const list = (v: string | undefined, scope: Scope) => {
    if (!v) return;
    for (const item of v.split(/\n|;(?=\s*[A-Za-z])/)) {
      const d = item.trim() && pep508(item.trim());
      if (d) deps.push({ ...d, scope });
    }
  };
  list(options?.get("install_requires"), "runtime");
  list(options?.get("setup_requires"), "build");
  list(options?.get("tests_require"), "dev");
  const extras = ini.get("options.extras_require");
  if (extras) for (const [group, v] of extras) list(v, DEV_GROUP.test(group) ? "dev" : "optional");
  const name = meta?.get("name");
  const version = meta?.get("version");
  const license = meta?.get("license");
  return {
    kind: "setup.cfg",
    ecosystem: "pypi",
    ...(name ? { name } : {}),
    // "attr: pkg.__version__" is a pointer, not a version.
    ...(version && !version.startsWith("attr:") && !version.startsWith("file:") ? { version } : {}),
    ...(license && license.length <= 60 ? { license } : {}),
    deps,
  };
}

/** Conda specs: "numpy=1.21", "conda-forge::pytorch>=2", "python". */
function parseEnvironmentYml(text: string): Parsed {
  const y = Bun.YAML.parse(text);
  if (!isObj(y)) throw new Error("not a mapping");
  const deps: Declared[] = [];
  const list = Array.isArray(y.dependencies) ? y.dependencies : [];
  for (const item of list) {
    if (typeof item === "string") {
      const m = /^(?:[\w.-]+::)?([A-Za-z0-9][\w.-]*)\s*(.*)$/.exec(item.trim());
      if (!m || m[1] === "python" || m[1] === "pip") continue;
      const version = m[2]!.trim().replace(/^=(?!=)/, "==");
      deps.push({ name: m[1]!.toLowerCase(), scope: "runtime", ...(version ? { version } : {}) });
    } else if (isObj(item) && Array.isArray(item.pip)) {
      for (const spec of item.pip) {
        const d = typeof spec === "string" && !spec.startsWith("-") ? pep508(spec) : undefined;
        if (d) deps.push({ ...d, scope: "runtime", ecosystem: "pypi" });
      }
    }
  }
  return { kind: "environment.yml", ecosystem: "conda", ...(str(y.name) ? { name: str(y.name) } : {}), deps };
}

// ─── Ruby: Gemfile, *.gemspec ────────────────────────────────────────────────────────────────

/** All quoted strings in a Ruby argument list, in order. */
const rubyStrings = (s: string) => [...s.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]!);

function parseGemfile(text: string): Parsed {
  const deps: Declared[] = [];
  // Every block opener pushes a frame so that "end" pops the right one; only `group` frames
  // carry scope. Conditionals count as blocks because they also close with "end".
  const frames: (string[] | null)[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const group = /^group\s+(.+?)\s+do\b/.exec(line);
    if (group) {
      frames.push([...group[1]!.matchAll(/:(\w+)|["'](\w+)["']/g)].map((m) => m[1] ?? m[2]!));
      continue;
    }
    if (/^end\b/.test(line)) {
      frames.pop();
      continue;
    }
    const gem = /^gem\s*\(?\s*["']([^"']+)["']\s*(.*)$/.exec(line);
    if (gem) {
      // Drop a trailing modifier (`gem 'byebug' if RUBY_VERSION >= '2.2'`): its strings are
      // a Ruby version test, not a gem requirement.
      const rest = gem[2]!.replace(/(?:^|\s+)(?:if|unless)\s+.*$/, "");
      const versions = rubyStrings(rest.split(/\b\w+:/)[0]!).filter((v) => /\d/.test(v));
      const inline = /\bgroups?:\s*\[?([^\]\n]+)/.exec(rest)?.[1];
      const groups = [
        ...frames.flatMap((f) => f ?? []),
        ...(inline ? [...inline.matchAll(/:(\w+)/g)].map((m) => m[1]!) : []),
      ];
      // Any group but :default/:production is tooling (development, test, debug, rubocop...).
      const dev = groups.some((g) => g !== "default" && g !== "production");
      deps.push({ name: gem[1]!, scope: dev ? "dev" : "runtime", ...(versions.length ? { version: versions.join(", ") } : {}) });
      continue;
    }
    if (/\bdo(?:\s*\|[^|]*\|)?$/.test(line) || /^(?:if|unless|case|begin|while|until)\b/.test(line)) frames.push(null);
  }
  return { kind: "Gemfile", ecosystem: "gem", deps };
}

function parseGemspec(text: string): Parsed {
  const deps: Declared[] = [];
  for (const m of text.matchAll(/\.add_(runtime_|development_)?dependency\s*\(?\s*["']([^"']+)["']([^\n]*)/g)) {
    const versions = rubyStrings(m[3]!).filter((v) => /\d/.test(v));
    deps.push({
      name: m[2]!,
      scope: m[1] === "development_" ? "dev" : "runtime",
      ...(versions.length ? { version: versions.join(", ") } : {}),
    });
  }
  const name = /\.name\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
  const version = /\.version\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
  const license = /\.licenses?\s*=\s*\[?\s*["']([^"']+)["']/.exec(text)?.[1];
  return {
    kind: "gemspec",
    ecosystem: "gem",
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

// ─── PHP: composer.json ──────────────────────────────────────────────────────────────────────

function parseComposer(text: string): Parsed {
  const j = parseJson(text);
  if (!isObj(j)) throw new Error("not an object");
  const deps: Declared[] = [];
  for (const [section, scope] of [
    ["require", "runtime"],
    ["require-dev", "dev"],
  ] as const) {
    const s = j[section];
    if (!isObj(s)) continue;
    for (const [name, v] of Object.entries(s)) {
      // Platform requirements (php itself, extensions, system libraries) are not packages.
      if (name === "php" || /^(?:ext|lib)-/.test(name) || !name.includes("/")) continue;
      deps.push({ name, scope, ...(str(v) ? { version: str(v) } : {}) });
    }
  }
  const license = npmLicense(j.license);
  return {
    kind: "composer.json",
    ecosystem: "composer",
    ...(str(j.name) ? { name: str(j.name) } : {}),
    ...(str(j.version) ? { version: str(j.version) } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

// ─── JVM: pom.xml, build.gradle(.kts), libs.versions.toml ────────────────────────────────────

const xmlTag = (s: string, tag: string) => new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(s)?.[1];
const stripBlocks = (s: string, tag: string) => s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "g"), "");

function parsePom(text: string): Parsed {
  const xml = text.replace(/<!--[\s\S]*?-->/g, "");
  const props = new Map<string, string>();
  const propBlock = /<properties>([\s\S]*?)<\/properties>/.exec(xml)?.[1] ?? "";
  for (const m of propBlock.matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1]!, m[2]!);
  const resolve = (v: string | undefined) => v?.replace(/\$\{([^}]+)\}/g, (all, k: string) => props.get(k) ?? all);

  // dependencyManagement pins versions without depending; build and reporting hold plugins.
  const body = ["dependencyManagement", "build", "reporting", "parent", "profiles"].reduce(stripBlocks, xml);
  const deps: Declared[] = [];
  for (const m of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const d = m[1]!;
    const g = xmlTag(d, "groupId");
    const a = xmlTag(d, "artifactId");
    if (!g || !a) continue;
    const scopeTag = xmlTag(d, "scope");
    if (scopeTag === "import") continue;
    const scope: Scope =
      scopeTag === "test" ? "dev" : scopeTag === "provided" ? "build" : xmlTag(d, "optional") === "true" ? "optional" : "runtime";
    const version = resolve(xmlTag(d, "version"));
    deps.push({ name: `${g}:${a}`, scope, ...(version ? { version } : {}) });
  }
  // The project's own coordinates: the first top-level ones once nested blocks are removed.
  const top = stripBlocks(body, "dependencies");
  const group = xmlTag(top, "groupId") ?? xmlTag(/<parent>([\s\S]*?)<\/parent>/.exec(xml)?.[1] ?? "", "groupId");
  const artifact = xmlTag(top, "artifactId");
  const version = resolve(xmlTag(top, "version"));
  const license = xmlTag(/<licenses>([\s\S]*?)<\/licenses>/.exec(xml)?.[1] ?? "", "name");
  return {
    kind: "pom.xml",
    ecosystem: "maven",
    ...(artifact ? { name: group ? `${group}:${artifact}` : artifact } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

const GRADLE_CONFIG =
  /^\s*(implementation|api|compile|compileOnly|runtimeOnly|runtime|testImplementation|testCompileOnly|testRuntimeOnly|testCompile|androidTestImplementation|debugImplementation|releaseImplementation|kapt|ksp|annotationProcessor|classpath|testFixturesImplementation|developmentOnly|integrationTestImplementation|compileOnlyApi)\b\s*\(?\s*(?:(?:platform|enforcedPlatform)\s*\(\s*)?(.*)$/;

function gradleScope(config: string): Scope {
  if (/^(?:test|androidTest|integrationTest|testFixtures)/.test(config) || config === "developmentOnly") return "dev";
  if (/^(?:compileOnly|annotationProcessor|kapt|ksp|classpath)/.test(config)) return "build";
  return "runtime";
}

function parseGradle(text: string, path: string): Parsed {
  const deps: Declared[] = [];
  for (const raw of text.split("\n")) {
    const m = GRADLE_CONFIG.exec(raw);
    if (!m) continue;
    const scope = gradleScope(m[1]!);
    const rest = m[2]!;
    const coord = /^["']([^"':\s]+):([^"':\s]+)(?::([^"'@\s]+))?(?:@\w+)?["']/.exec(rest);
    if (coord) {
      deps.push({ name: `${coord[1]}:${coord[2]}`, scope, ...(coord[3] ? { version: coord[3] } : {}) });
      continue;
    }
    // Map notation: group: 'g', name: 'a', version: 'v'
    const g = /group\s*[:=]\s*["']([^"']+)["']/.exec(rest)?.[1];
    const a = /name\s*[:=]\s*["']([^"']+)["']/.exec(rest)?.[1];
    const v = /version\s*[:=]\s*["']([^"']+)["']/.exec(rest)?.[1];
    if (g && a) deps.push({ name: `${g}:${a}`, scope, ...(v ? { version: v } : {}) });
    // `libs.foo.bar` catalog references resolve in libs.versions.toml, read separately.
  }
  const group = /^\s*group\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
  const version = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
  return {
    kind: path.endsWith(".kts") ? "build.gradle.kts" : "build.gradle",
    ecosystem: "maven",
    ...(group ? { name: group } : {}),
    ...(version ? { version } : {}),
    deps,
  };
}

function parseVersionCatalog(text: string): Parsed {
  const t = Bun.TOML.parse(text) as Record<string, unknown>;
  const versions = isObj(t.versions) ? t.versions : {};
  const ver = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (isObj(v) && typeof v.ref === "string") return str(versions[v.ref]);
    if (isObj(v)) return str(v.strictly) ?? str(v.require) ?? str(v.prefer);
    return undefined;
  };
  const deps: Declared[] = [];
  if (isObj(t.libraries)) {
    for (const lib of Object.values(t.libraries)) {
      let name: string | undefined;
      let version: string | undefined;
      if (typeof lib === "string") {
        const [g, a, v] = lib.split(":");
        if (g && a) name = `${g}:${a}`;
        version = v;
      } else if (isObj(lib)) {
        name = str(lib.module) ?? (str(lib.group) && str(lib.name) ? `${lib.group}:${lib.name}` : undefined);
        version = ver(lib.version);
      }
      // A catalog names what may be used, not how; the build files decide scope.
      if (name) deps.push({ name, scope: "unknown", ...(version ? { version } : {}) });
    }
  }
  return { kind: "libs.versions.toml", ecosystem: "maven", deps };
}

// ─── .NET: *.csproj, packages.config ─────────────────────────────────────────────────────────

const xmlAttr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1];

function parseMsbuild(text: string, path: string, central: Map<string, string>): Parsed {
  const xml = text.replace(/<!--[\s\S]*?-->/g, "");
  const deps: Declared[] = [];
  for (const m of xml.matchAll(/<(PackageReference|PackageVersion|DotNetCliToolReference)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const attrs = m[2]!;
    const name = xmlAttr(attrs, "Include") ?? xmlAttr(attrs, "Update");
    if (!name) continue;
    const version = xmlAttr(attrs, "Version") ?? xmlAttr(attrs, "VersionOverride") ?? (m[3] ? xmlTag(m[3], "Version") : undefined) ?? central.get(name);
    // PrivateAssets="all" keeps a package out of consumers: analyzers, source generators,
    // build tooling. CLI tool references are tooling by definition.
    const privateAll = /all/i.test(xmlAttr(attrs, "PrivateAssets") ?? (m[3] ? (xmlTag(m[3], "PrivateAssets") ?? "") : ""));
    const scope: Scope = m[1] === "DotNetCliToolReference" || privateAll ? "dev" : m[1] === "PackageVersion" ? "unknown" : "runtime";
    deps.push({ name, scope, ...(version ? { version } : {}) });
  }
  const file = basename(path);
  const name = xmlTag(xml, "PackageId") ?? xmlTag(xml, "AssemblyName") ?? (file.includes("proj") ? file.replace(/\.[^.]+$/, "") : undefined);
  const version = xmlTag(xml, "Version");
  const license = xmlTag(xml, "PackageLicenseExpression");
  return {
    kind: file.endsWith(".props") ? "Directory.Packages.props" : (file.split(".").pop() ?? "csproj"),
    ecosystem: "nuget",
    ...(name ? { name } : {}),
    ...(version && !version.includes("$(") ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

function parsePackagesConfig(text: string): Parsed {
  const deps: Declared[] = [];
  for (const m of text.matchAll(/<package\b([^>]*?)\/?>/g)) {
    const id = xmlAttr(m[1]!, "id");
    if (!id) continue;
    const version = xmlAttr(m[1]!, "version");
    const dev = xmlAttr(m[1]!, "developmentDependency") === "true";
    deps.push({ name: id, scope: dev ? "dev" : "runtime", ...(version ? { version } : {}) });
  }
  return { kind: "packages.config", ecosystem: "nuget", deps };
}

// ─── Dart, Elixir, Swift, C++ ────────────────────────────────────────────────────────────────

function parsePubspec(text: string): Parsed {
  const y = Bun.YAML.parse(text);
  if (!isObj(y)) throw new Error("not a mapping");
  const deps: Declared[] = [];
  for (const [section, scope] of [
    ["dependencies", "runtime"],
    ["dev_dependencies", "dev"],
  ] as const) {
    const s = y[section];
    if (!isObj(s)) continue;
    for (const [name, v] of Object.entries(s)) {
      // SDK packages (flutter: {sdk: flutter}) ship with the toolchain; path ones are local.
      if (isObj(v) && (v.sdk !== undefined || v.path !== undefined)) continue;
      const version = typeof v === "string" ? v : typeof v === "number" ? String(v) : isObj(v) ? str(v.version) : undefined;
      deps.push({ name, scope, ...(version ? { version } : {}) });
    }
  }
  return {
    kind: "pubspec.yaml",
    ecosystem: "pub",
    ...(str(y.name) ? { name: str(y.name) } : {}),
    ...(y.version !== undefined && y.version !== null ? { version: String(y.version) } : {}),
    deps,
  };
}

function parseMixExs(text: string): Parsed {
  const deps: Declared[] = [];
  // Only tuples inside `defp deps` are dependencies; `{:ok, value}` elsewhere is just code.
  const start = /\bdefp?\s+deps\b[^\n]*\n/.exec(text);
  if (start) {
    const rest = text.slice(start.index + start[0].length);
    const end = /^\s{0,4}end\b/m.exec(rest);
    const body = end ? rest.slice(0, end.index) : rest;
    for (const m of body.matchAll(/\{\s*:(\w+)\s*(?:,\s*"([^"]*)")?([^}]*)\}/g)) {
      const opts = m[3] ?? "";
      if (/\bpath:/.test(opts) || /\bin_umbrella:\s*true/.test(opts)) continue;
      const dev = /\bonly:\s*(?::(?:dev|test)\b|\[\s*:(?:dev|test))/.test(opts) || /\bruntime:\s*false/.test(opts);
      deps.push({ name: m[1]!, scope: dev ? "dev" : "runtime", ...(m[2] ? { version: m[2] } : {}) });
    }
  }
  const app = /\bapp:\s*:(\w+)/.exec(text)?.[1];
  const version = /\bversion:\s*"([^"]+)"/.exec(text)?.[1];
  return { kind: "mix.exs", ecosystem: "hex", ...(app ? { name: app } : {}), ...(version ? { version } : {}), deps };
}

function parsePackageSwift(text: string): Parsed {
  const deps: Declared[] = [];
  for (const m of text.matchAll(/\.package\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g)) {
    const args = m[1]!;
    const url = /url:\s*"([^"]+)"/.exec(args)?.[1];
    const id = /id:\s*"([^"]+)"/.exec(args)?.[1];
    if (!url && !id) continue; // .package(path:) is a local package
    const name = id ?? url!.replace(/\.git$/, "").replace(/\/+$/, "").split("/").pop()!;
    const version =
      /(?:from|exact):\s*"([^"]+)"/.exec(args)?.[1] ?? /"([^"]+)"\s*\.\.[.<]/.exec(args)?.[1] ?? /(?:branch|revision):\s*"([^"]+)"/.exec(args)?.[1];
    deps.push({ name, scope: "runtime", ...(version ? { version } : {}) });
  }
  const name = /Package\s*\(\s*name:\s*"([^"]+)"/.exec(text)?.[1];
  return { kind: "Package.swift", ecosystem: "swiftpm", ...(name ? { name } : {}), deps };
}

function parseVcpkg(text: string): Parsed {
  const j = parseJson(text);
  if (!isObj(j)) throw new Error("not an object");
  const deps: Declared[] = [];
  if (Array.isArray(j.dependencies)) {
    for (const d of j.dependencies) {
      if (typeof d === "string") deps.push({ name: d, scope: "runtime" });
      else if (isObj(d) && str(d.name)) {
        const version = str(d["version>="]);
        deps.push({ name: str(d.name)!, scope: d.host === true ? "build" : "runtime", ...(version ? { version: `>=${version}` } : {}) });
      }
    }
  }
  const version = str(j.version) ?? str(j["version-string"]) ?? str(j["version-semver"]) ?? str(j["version-date"]);
  const license = str(j.license);
  return {
    kind: "vcpkg.json",
    ecosystem: "vcpkg",
    ...(str(j.name) ? { name: str(j.name) } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    deps,
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────────────────────

interface Context {
  catalogs: Catalogs;
  centralNuget: Map<string, string>;
  cargoWorkspaces: Map<string, CargoWorkspace>;
}

type Parser = (text: string, path: string, ctx: Context) => Parsed | undefined;

function parserFor(path: string): Parser | undefined {
  const name = basename(path);
  switch (name) {
    case "package.json":
      return (t, _p, c) => parsePackageJson(t, c.catalogs);
    case "deno.json":
    case "deno.jsonc":
      return parseDeno;
    case "Cargo.toml":
      return (t, p, c) => parseCargo(t, p, c.cargoWorkspaces);
    case "go.mod":
      return parseGoMod;
    case "pyproject.toml":
      return parsePyproject;
    case "Pipfile":
      return parsePipfile;
    case "setup.cfg":
      return parseSetupCfg;
    case "environment.yml":
    case "environment.yaml":
      return parseEnvironmentYml;
    case "Gemfile":
    case "gems.rb":
      return parseGemfile;
    case "composer.json":
      return parseComposer;
    case "pom.xml":
      return parsePom;
    case "build.gradle":
    case "build.gradle.kts":
      return parseGradle;
    case "libs.versions.toml":
      return parseVersionCatalog;
    case "packages.config":
      return parsePackagesConfig;
    case "Directory.Packages.props":
      return (t, p, c) => parseMsbuild(t, p, c.centralNuget);
    case "pubspec.yaml":
      return parsePubspec;
    case "mix.exs":
      return parseMixExs;
    case "Package.swift":
      return parsePackageSwift;
    case "vcpkg.json":
      return parseVcpkg;
  }
  if (name.endsWith(".gemspec")) return parseGemspec;
  if (/\.(?:cs|fs|vb)proj$/.test(name)) return (t, p, c) => parseMsbuild(t, p, c.centralNuget);
  if (/^requirements[\w.-]*\.(?:txt|in)$/.test(name) || /(?:^|\/)requirements\/[^/]+\.(?:txt|in)$/.test(path)) return parseRequirements;
  return undefined;
}

/**
 * Manifests of third-party code (installed packages, vendored gems) and test fixtures (fake
 * packages a test resolves against) describe someone else's dependencies, not the project's.
 */
const SKIP_DIR =
  /(?:^|\/)(?:node_modules|bower_components|jspm_packages|vendor|third[-_]?party|\.yarn|Pods|Carthage|site-packages|\.venv|venv|__tests__|__fixtures__|fixtures|testdata)\/|^[Ss]amples?\//;

const ECOSYSTEM_FOR_KIND_NAME = (p: Parsed, d: Declared) => d.ecosystem ?? p.ecosystem;

export const readManifests: ReadManifests = (paths, readText) => {
  const ctx: Context = { catalogs: new Map(), centralNuget: new Map(), cargoWorkspaces: new Map() };
  const workspace = paths.find((p) => p === "pnpm-workspace.yaml");
  if (workspace) {
    try {
      const t = readText(workspace);
      if (t) ctx.catalogs = parseCatalogs(t);
    } catch {
      // A malformed workspace file only costs catalog versions.
    }
  }

  // Shallowest first, so a root manifest's version wins when two declare the same package.
  const candidates = paths
    .filter((p) => !SKIP_DIR.test(p) && parserFor(p))
    .sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0));

  // Central package versions must be known before any project file reads them.
  for (const p of candidates) {
    if (basename(p) !== "Directory.Packages.props") continue;
    try {
      const t = readText(p);
      if (t) for (const d of parseMsbuild(t, p, new Map()).deps) if (d.version) ctx.centralNuget.set(d.name, d.version);
    } catch {
      // skip
    }
  }

  const parsed: { path: string; p: Parsed }[] = [];
  for (const path of candidates) {
    const text = readText(path);
    if (text === undefined) continue;
    try {
      const p = parserFor(path)!(text, path, ctx);
      if (p) parsed.push({ path, p });
    } catch {
      // Malformed manifest (a fixture, a template with placeholders): skip it.
    }
  }

  // Python names compare normalized ("Flask" the project, "flask" in its examples' deps).
  const internal = new Set<string>();
  for (const { p } of parsed) if (p.name) internal.add(`${p.ecosystem}\0${p.ecosystem === "pypi" ? normalizePy(p.name) : p.name}`);

  const merged = new Map<string, ExternalDependency>();
  const manifests: Manifest[] = [];
  for (const { path, p } of parsed) {
    let count = 0;
    for (const d of p.deps) {
      const ecosystem = ECOSYSTEM_FOR_KIND_NAME(p, d);
      const key = `${ecosystem}\0${d.name}`;
      if (internal.has(key)) continue;
      count++;
      const prior = merged.get(key);
      if (!prior) {
        merged.set(key, {
          name: d.name,
          ecosystem,
          ...(d.version ? { version: d.version } : {}),
          declaredIn: [path],
          scope: d.scope,
          importers: 0,
        });
        continue;
      }
      if (!prior.declaredIn.includes(path)) prior.declaredIn.push(path);
      if (SCOPE_RANK[d.scope] < SCOPE_RANK[prior.scope]) prior.scope = d.scope;
      if (prior.version === undefined && d.version) prior.version = d.version;
    }
    manifests.push({
      path,
      kind: p.kind,
      ecosystem: p.ecosystem,
      ...(p.name ? { name: p.name } : {}),
      ...(p.version ? { version: p.version } : {}),
      dependencies: count,
    });
  }

  manifests.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const dependencies = [...merged.values()].sort(
    (a, b) => (a.ecosystem < b.ecosystem ? -1 : a.ecosystem > b.ecosystem ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  for (const d of dependencies) d.declaredIn.sort();
  return { manifests, dependencies };
};

// ─── Project info: README ────────────────────────────────────────────────────────────────────

const README_ORDER = [".md", ".markdown", ".mdown", ".rst", ".adoc", ".asciidoc", ".org", ".txt", ""];

function pickReadme(paths: string[]): string | undefined {
  let best: string | undefined;
  let bestRank = Infinity;
  for (const p of paths) {
    if (p.includes("/")) continue;
    const m = /^readme(\.[a-z]+)?$/i.exec(p);
    if (!m) continue;
    const rank = README_ORDER.indexOf((m[1] ?? "").toLowerCase());
    const r = rank < 0 ? README_ORDER.length : rank;
    if (r < bestRank) {
      best = p;
      bestRank = r;
    }
  }
  return best;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "—", ndash: "–", hellip: "…", copy: "©" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Inline Markdown (and the HTML READMEs embed) to plain text. */
function inlineToText(s: string): string {
  return decodeEntities(
    s
      // reStructuredText first: its hyperlinks contain <url>, which the HTML pass would eat.
      .replace(/`([^`<]+?)\s*<[^>]+>`_{1,2}/g, "$1")
      .replace(/\|[\w -]+\|_{0,2}/g, "")
      .replace(/:\w+:`([^`]+)`/g, "$1")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "") // reference images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1") // reference links
      .replace(/\[([^\]]+)\](?!\()/g, "$1") // shortcut references
      .replace(/<(https?:[^>]+)>/g, "$1")
      .replace(/`+([^`]+)`+/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isProse(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 20) return false;
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  // Languages written without spaces (Chinese, Japanese) still count as prose.
  return words >= 4 || !/\s/.test(text);
}

/**
 * First prose paragraph. Prose inside raw HTML blocks (<div align=center>, <kbd>) is a banner
 * far more often than a description (logos' alt text, sponsor callouts, "now with T-shirts"),
 * so a Markdown paragraph anywhere wins over HTML prose before it; HTML prose is the fallback
 * for READMEs that put their tagline only in a centered <p>.
 */
function firstParagraph(text: string, rst: boolean): string | undefined {
  let t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  t = t.replace(/^---\n[\s\S]*?\n---\n/, ""); // front matter
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, ""); // fenced code
  let htmlFallback: string | undefined;
  for (const block of t.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const first = lines[0]!.trim();
    const html = /^<[a-z][\w-]*[\s>/]/i.test(first) || /^<\/[a-z]/i.test(first);
    if (/^#{1,6}(?:\s|$)/.test(first)) continue; // ATX heading
    if (lines.length >= 2 && /^[=\-~^"'`#*+]{3,}\s*$/.test(lines[1]!.trim()) && lines.length === 2) continue; // setext / RST title
    if (lines.every((l) => /^[=\-~^"'`#*+_]{3,}\s*$/.test(l.trim()) || /^\s*[-*_](?:\s*[-*_]){2,}\s*$/.test(l))) continue; // rules
    if (/^<h[1-6]\b/i.test(first)) continue;
    if (lines.every((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l))) continue; // lists
    if (lines.every((l) => /^\s*\|/.test(l))) continue; // tables
    if (lines.every((l) => /^\s*\[[^\]]+\]:\s*\S/.test(l))) continue; // link definitions
    if (lines.every((l) => /^ {4}|^\t/.test(l))) continue; // indented code
    if (rst && /^\.\.\s/.test(first)) continue; // directives, comments, substitutions
    if (rst && lines.every((l) => /^\s*:\w[^:]*:/.test(l))) continue; // field lists
    const body = lines
      .filter((l) => !/^\s*\[[^\]]+\]:\s*\S/.test(l))
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .join(" ");
    const plain = inlineToText(body);
    if (!isProse(plain)) continue;
    if (!html) return plain;
    htmlFallback ??= plain;
  }
  return htmlFallback;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

// ─── Project info: license ───────────────────────────────────────────────────────────────────

/** Ordered: more specific texts first (AGPL and LGPL both contain "GENERAL PUBLIC LICENSE"). */
const LICENSE_TEXTS: [RegExp, string | ((t: string) => string)][] = [
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, (t) => (/Version 2\.1/i.test(t) ? "LGPL-2.1" : "LGPL-3.0")],
  [/GNU LIBRARY GENERAL PUBLIC LICENSE/i, "LGPL-2.0"],
  [/GNU GENERAL PUBLIC LICENSE/i, (t) => (/Version 3/i.test(t) ? "GPL-3.0" : /Version 2/i.test(t) ? "GPL-2.0" : "GPL")],
  [/Mozilla Public License,? (?:Version|v\.?) ?2\.0/i, "MPL-2.0"],
  [/Apache License,?\s+Version 2\.0|Licensed under the Apache License/i, "Apache-2.0"],
  [/Eclipse Public License - v 2\.0|Eclipse Public License,? Version 2\.0/i, "EPL-2.0"],
  [/Eclipse Public License - v 1\.0/i, "EPL-1.0"],
  [/Boost Software License - Version 1\.0/i, "BSL-1.0"],
  [/This is free and unencumbered software released into the public domain/i, "Unlicense"],
  [/CC0 1\.0 Universal|Creative Commons Zero/i, "CC0-1.0"],
  [/DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE/i, "WTFPL"],
  [/The Artistic License 2\.0/i, "Artistic-2.0"],
  [/European Union Public Licen[cs]e/i, "EUPL-1.2"],
  [/Business Source License/i, "BUSL-1.1"],
  [/Elastic License 2\.0/i, "Elastic-2.0"],
  [/Server Side Public License/i, "SSPL-1.0"],
  [/Permission is hereby granted, free of charge, to any person obtaining a copy/i, "MIT"],
  // ISC and 0BSD share the grant; ISC adds the notice condition.
  [
    /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted/i,
    (t) => (/provided that the above copyright notice and this permission notice appear in all copies/i.test(t) ? "ISC" : "0BSD"),
  ],
  [
    /Redistribution and use in source and binary forms/i,
    (t) =>
      /Neither the name|names? of (?:its|the) contributors may be used/i.test(t)
        ? "BSD-3-Clause"
        : /advertising materials/i.test(t)
          ? "BSD-4-Clause"
          : "BSD-2-Clause",
  ],
  [/This software is provided 'as-is', without any express or implied\s+warranty/i, "Zlib"],
];

function guessLicense(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ");
  for (const [re, id] of LICENSE_TEXTS) if (re.test(t)) return typeof id === "string" ? id : id(t);
  return undefined;
}

const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense)(?:[-_.][\w.-]+)?$/i;

/** SPDX-ish normalization of a manifest's free-text license field. */
function normalizeLicenseField(v: string): string | undefined {
  const s = v.trim();
  if (!s || /^see license/i.test(s)) return undefined;
  const aliases: Record<string, string> = {
    "apache 2.0": "Apache-2.0",
    "apache-2": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    bsd: "BSD-3-Clause",
    "new bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "mit license": "MIT",
    gpl: "GPL",
    gplv2: "GPL-2.0",
    gplv3: "GPL-3.0",
    "mpl 2.0": "MPL-2.0",
  };
  return aliases[s.toLowerCase()] ?? s;
}

function manifestLicense(paths: string[], readText: (p: string) => string | undefined): string | undefined {
  for (const p of ["package.json", "Cargo.toml", "pyproject.toml", "composer.json", "deno.json", "deno.jsonc"]) {
    if (!paths.includes(p)) continue;
    const text = readText(p);
    if (!text) continue;
    try {
      const parsed = parserFor(p)!(text, p, { catalogs: new Map(), centralNuget: new Map(), cargoWorkspaces: new Map() });
      const l = parsed?.license && normalizeLicenseField(parsed.license);
      if (l) return l;
    } catch {
      // malformed root manifest: no license from it
    }
  }
  const gemspec = paths.find((p) => !p.includes("/") && p.endsWith(".gemspec"));
  if (gemspec) {
    const text = readText(gemspec);
    const l = text && parseGemspec(text).license;
    if (l) return normalizeLicenseField(l);
  }
  return undefined;
}

export const readProjectInfo: ReadProjectInfo = (paths, readText) => {
  const out: { description?: string; readme?: string; license?: string } = {};

  const readme = pickReadme(paths);
  if (readme) {
    out.readme = readme;
    const text = readText(readme);
    if (text) {
      const para = firstParagraph(text, /\.rst$/i.test(readme));
      if (para) out.description = truncate(para, 400);
    }
  }

  // License text first: it is the legal grant. Several license files (LICENSE-MIT and
  // LICENSE-APACHE) mean a choice, which the manifest's SPDX expression states exactly when
  // it exists; otherwise they are joined with OR, the usual meaning of shipping both.
  const files = paths.filter((p) => !p.includes("/") && LICENSE_FILE.test(p));
  const ids = new Set<string>();
  let unrecognized = false;
  for (const f of files) {
    const text = readText(f);
    if (!text) continue;
    const id = guessLicense(text);
    if (id) ids.add(id);
    else unrecognized = true;
  }
  if (ids.size === 1) out.license = [...ids][0]!;
  else {
    const declared = manifestLicense(paths, readText);
    if (declared) out.license = declared;
    else if (ids.size > 1) out.license = [...ids].sort().join(" OR ");
    // A license file exists but matches no known text: say so rather than guess.
    else if (unrecognized) out.license = "Other";
  }
  return out;
};
