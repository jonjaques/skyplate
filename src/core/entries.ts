/**
 * Entry points: files that something outside the import graph runs or loads, as the
 * repository itself declares them.
 *
 *   findEntries(paths, readText) → Map<path, source>      source: why it is an entry
 *
 * A file nothing imports is either dead or an entry, and the graph alone cannot tell which.
 * Guessing from names ("main.ts", "index.ts") is wrong both ways, and a repository usually
 * says outright what its entries are. Sources, most explicit first:
 *
 *   package.json main / module / browser / bin / exports   the package's declared surface
 *   package.json scripts                                   files a script runs (node x.mjs,
 *                                                          tsx y.ts, --config z.ts)
 *   knip.json(c) entry, at the root and per workspace      the repository's own list, when it
 *                                                          keeps one for knip
 *   *.config.{js,cjs,mjs,ts,cts,mts}                       tool configs: the tool finds them
 *                                                          by that name, so the name is the
 *                                                          declaration
 *   *.d.ts                                                 ambient declarations (env.d.ts):
 *                                                          tsconfig `include` hands them to
 *                                                          the compiler for the whole program,
 *                                                          and nothing ever imports them
 *   .github/workflows/*.yml, .github/actions/<x>/action.yml files a CI `run:` step runs
 *   .claude/settings(.local).json, .codex/hooks.json       files an agent hook command runs
 *   t3.json                                                files a T3 Code project script runs
 *
 * Commands are read for the files they name, with the project-root spellings hooks use
 * ($CLAUDE_PROJECT_DIR, $(git rev-parse --show-toplevel), $PWD) taken as the root, since a
 * hook runs there. Not read, on purpose: a path passed to spawn / execFile in code (it is
 * relative to a working directory the code does not state, and usually assembled with join,
 * so reading it would be guessing), and free-form build files (Makefile, justfile), which
 * need their own parsers and variables to say anything reliable.
 *
 * Paths a manifest names but the repository does not hold (`main: "dist/index.js"`, built
 * output) are skipped: only files in the analysis can be entries. knip.ts / knip.config.ts
 * are code, not data, so they are not read (they are tool configs themselves).
 *
 * Pure over (paths, readText), like readManifests, so tests need no filesystem.
 */

import type { EntrySource } from "../shared/schema";
import { parseJsonc } from "./facts";

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, rel: string) => {
  const parts = (dir ? `${dir}/${rel}` : rel).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
};

const TOOL_CONFIG = /(?:^|\/)[^/]+\.config\.(?:c|m)?[jt]s$/;
// What a command can run: JavaScript and TypeScript, and the shell and Python scripts hooks,
// CI steps and project scripts run as often.
const SCRIPT_FILE = /\.(?:(?:c|m)?[jt]sx?|sh|bash|zsh|py)$/;
const HOOK_CONFIGS = [".claude/settings.json", ".claude/settings.local.json", ".codex/hooks.json"];
const ROOT_SPELLINGS = /"?\$(?:\{?(?:CLAUDE_PROJECT_DIR|PWD)\}?|\(git rev-parse --show-toplevel\))"?\//g;
const KNIP_CONFIGS = ["knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc"];

/**
 * The commands of a GitHub Actions file's `run:` steps, one-line and block scalars alike, and
 * the `working-directory` values it sets. Read line by line, not as YAML: a step's command is
 * all that is wanted, and a full YAML parser is not a dependency worth taking for it.
 */
function workflowRuns(text: string): { commands: string[]; dirs: string[] } {
  const commands: string[] = [];
  const dirs: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const wd = /^\s*(?:-\s+)?working-directory:\s*["']?([^"'#\s]+)/.exec(lines[i]!);
    if (wd) dirs.push(wd[1]!);
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const column = m[1]!.length + (m[2]?.length ?? 0);
    const rest = m[3]!.replace(/\s+#.*$/, "");
    if (!/^[|>][+-]?\d*$/.test(rest.trim())) {
      commands.push(rest);
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() !== "" && line.length - line.trimStart().length <= column) break;
      body.push(line.trim());
      i = j;
    }
    commands.push(body.join("\n"));
  }
  return { commands, dirs };
}

/** Every `command` string under a `hooks` key, however deep (Claude Code and Codex nest them). */
function hookCommands(value: unknown, inHooks = false, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) hookCommands(v, inHooks, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (inHooks && k === "command" && typeof v === "string") out.push(v);
      else hookCommands(v, inHooks || k === "hooks", out);
    }
  }
  return out;
}

/** Every string leaf of a package.json `exports` / `bin` / `browser` value, conditions included. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) leaves(v, out);
  return out;
}

/** File-like words in a script command: `node scripts/a.mjs && tsx --config=x.config.ts b.ts`. */
function scriptFiles(command: string): string[] {
  return command
    .replace(ROOT_SPELLINGS, "")
    .split(/\s+|&&|\|\||;|\|/)
    .map((w) => w.replace(/^--[\w-]+=/, "").replace(/^["']|["']$/g, ""))
    .filter((w) => w && !w.startsWith("-") && !w.includes("$") && SCRIPT_FILE.test(w));
}

/**
 * The entry files of published packages: main / module / browser / exports targets of every
 * package.json that does not say `"private": true`. Their exports, and whatever they re-export,
 * are API for consumers outside the repository, so an export nothing here uses is not dead
 * there. `bin` is left out: an executable is run, not imported.
 */
export function publishedEntries(paths: readonly string[], readText: (path: string) => string | undefined): Set<string> {
  const have = new Set(paths);
  const out = new Set<string>();
  for (const path of paths) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readText(path) ?? "");
    } catch {
      continue;
    }
    if (!pkg || typeof pkg !== "object" || pkg.private === true) continue;
    const dir = parentOf(path);
    const targets = [...leaves(pkg.main), ...leaves(pkg.module), ...leaves(typeof pkg.browser === "string" ? pkg.browser : undefined), ...leaves(pkg.exports)];
    for (const target of targets) {
      const full = join(dir, target);
      if (!/[*?[{]/.test(full)) {
        if (have.has(full)) out.add(full);
        continue;
      }
      const glob = new Bun.Glob(full);
      for (const p of paths) if (glob.match(p)) out.add(p);
    }
  }
  return out;
}

export function findEntries(paths: readonly string[], readText: (path: string) => string | undefined): Map<string, EntrySource> {
  const have = new Set(paths);
  const entries = new Map<string, EntrySource>();
  const mark = (path: string, source: EntrySource) => {
    if (have.has(path) && !entries.has(path)) entries.set(path, source);
  };
  const markGlob = (dir: string, pattern: string, source: EntrySource, except: Bun.Glob[] = []) => {
    const pat = join(dir, pattern.replace(/!$/, "")); // knip's production-mode marker
    if (!/[*?[{]/.test(pat)) return except.some((g) => g.match(pat)) ? undefined : mark(pat, source);
    const glob = new Bun.Glob(pat);
    for (const p of paths) if (glob.match(p) && !except.some((g) => g.match(p))) mark(p, source);
  };

  for (const path of paths) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readText(path) ?? "");
    } catch {
      continue;
    }
    if (!pkg || typeof pkg !== "object") continue;
    const dir = parentOf(path);
    for (const field of ["main", "module"] as const) if (typeof pkg[field] === "string") mark(join(dir, pkg[field] as string), "package main");
    if (typeof pkg.browser === "string") mark(join(dir, pkg.browser), "package main");
    for (const target of leaves(pkg.bin)) mark(join(dir, target), "package bin");
    // `"./*": "./src/*.ts"` patterns become globs; plain targets are paths.
    for (const target of leaves(pkg.exports)) markGlob(dir, target, "package exports");
    if (pkg.scripts && typeof pkg.scripts === "object") {
      for (const command of Object.values(pkg.scripts as Record<string, unknown>)) {
        if (typeof command !== "string") continue;
        // A script runs in its package's directory, so its paths are relative to that.
        for (const file of scriptFiles(command)) mark(join(dir, file), "package script");
      }
    }
  }

  for (const name of KNIP_CONFIGS) {
    if (!have.has(name)) continue;
    const config = parseJsonc(readText(name) ?? "") as Record<string, unknown> | undefined;
    if (!config || typeof config !== "object") continue;
    const entryOf = (c: unknown): string[] => {
      const e = (c as { entry?: unknown } | undefined)?.entry;
      return typeof e === "string" ? [e] : Array.isArray(e) ? e.filter((x): x is string => typeof x === "string") : [];
    };
    // `!pattern` in a list removes what the list's other patterns match, as knip reads it.
    const apply = (dir: string, patterns: string[]) => {
      const except = patterns.filter((p) => p.startsWith("!")).map((p) => new Bun.Glob(join(dir, p.slice(1))));
      for (const pattern of patterns) if (!pattern.startsWith("!")) markGlob(dir, pattern, "knip entry", except);
    };
    apply("", entryOf(config));
    const workspaces = config.workspaces as Record<string, unknown> | undefined;
    if (workspaces && typeof workspaces === "object") {
      // Every directory, not only those holding files: a workspace like packages/p has only
      // subfolders at its top.
      const dirs = new Set<string>();
      for (const p of paths) for (let d = parentOf(p); d && !dirs.has(d); d = parentOf(d)) dirs.add(d);
      for (const [key, ws] of Object.entries(workspaces)) {
        const matched = key === "." ? [""] : /[*?[{]/.test(key) ? [...dirs].filter((d) => new Bun.Glob(key).match(d)) : [key];
        for (const dir of matched) apply(dir, entryOf(ws));
      }
    }
    break; // knip reads the first config it finds, in this order
  }

  for (const path of paths) {
    if (!/^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(path)) continue;
    const { commands, dirs } = workflowRuns(readText(path) ?? "");
    for (const command of commands) {
      for (const file of scriptFiles(command)) {
        mark(join("", file), "workflow step");
        for (const dir of dirs) mark(join(dir, file), "workflow step");
      }
    }
  }

  for (const name of HOOK_CONFIGS) {
    if (!have.has(name)) continue;
    const config = parseJsonc(readText(name) ?? "");
    for (const command of hookCommands(config)) for (const file of scriptFiles(command)) mark(join("", file), "agent hook");
  }

  if (have.has("t3.json")) {
    const config = parseJsonc(readText("t3.json") ?? "") as { scripts?: { command?: unknown }[] } | undefined;
    for (const script of Array.isArray(config?.scripts) ? config.scripts : []) {
      if (typeof script?.command === "string") for (const file of scriptFiles(script.command)) mark(join("", file), "t3 script");
    }
  }

  for (const path of paths) {
    if (TOOL_CONFIG.test(path)) mark(path, "tool config");
    else if (path.endsWith(".d.ts")) mark(path, "type declarations");
  }
  return entries;
}
