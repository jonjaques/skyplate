/**
 * walkProject: the list of files a report covers, with size and mtime, sorted by path.
 *
 * Three modes:
 *   git      Root is inside a work tree: git itself says which files belong to the project
 *            (`ls-files --cached --others --exclude-standard`), so .gitignore, nested ignores,
 *            .git/info/exclude and the global excludes file all apply exactly as git applies
 *            them. Reimplementing those rules is how walkers end up listing node_modules.
 *   plain    No git: walk the filesystem honoring every .gitignore in the tree plus a short
 *            list of directories nobody wants in a report (node_modules, .venv, caches).
 *   all      includeIgnored: walk the filesystem skipping only VCS metadata.
 * opts.exclude applies in every mode, after the mode's own rules.
 *
 * Symlinks are never followed (a link to / or to a sibling checkout would multiply the walk)
 * and count as ignored, as do sockets, FIFOs and unreadable entries.
 */

import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { WalkOptions, WalkProject, WalkResult, WalkedFile } from "./contracts";

/** Parallel filesystem calls in flight. Enough to hide latency on SSDs and network mounts,
 * few enough to stay far from the default open-file limit (256 on macOS). */
const CONCURRENCY = 64;

const VCS_DIRS = new Set([".git", ".hg", ".svn"]);
const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".DS_Store",
  ".idea",
  ".cache",
]);

// ─── Bounded concurrency ─────────────────────────────────────────────────────────────────────

/** Map `items` through `fn` with at most `limit` calls in flight, preserving order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ─── git ─────────────────────────────────────────────────────────────────────────────────────

async function git(root: string, args: string[]): Promise<{ ok: boolean; out: Uint8Array; err: string }> {
  try {
    const proc = Bun.spawn(["git", "-C", root, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      // A report must never take the index lock out from under the user's own git session.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).bytes(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, out, err };
  } catch (e) {
    // git is not installed (spawn ENOENT).
    return { ok: false, out: new Uint8Array(), err: String(e) };
  }
}

/** Split `-z` output. Paths are UTF-8 bytes; decoding non-UTF-8 names yields U+FFFD, and the
 * later lstat of such a path fails, so it is counted as unreadable rather than mangled. */
function splitNul(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return [];
  const text = new TextDecoder().decode(bytes);
  const parts = text.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

async function isGitWorkTree(root: string): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.ok && new TextDecoder().decode(r.out).trim() === "true";
}

// ─── Filesystem walk ─────────────────────────────────────────────────────────────────────────

interface Rules {
  /** Directory the .gitignore sits in, relative to root, "" or ending in "/". */
  base: string;
  ig: Ignore;
}

/**
 * Gitignore precedence across nested files: the deepest .gitignore with an opinion about a
 * path decides it, so a child's "!keep.log" overrides a parent's "*.log". Each file's rules
 * are tested against the path relative to that file's directory, as git does.
 */
function gitignored(chain: readonly Rules[], rel: string, dir: boolean): boolean {
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i]!;
    if (!rel.startsWith(r.base)) continue;
    const sub = rel.slice(r.base.length) + (dir ? "/" : "");
    const t = r.ig.test(sub);
    if (t.ignored) return true;
    if (t.unignored) return false;
  }
  return false;
}

async function walkFilesystem(
  root: string,
  mode: "plain" | "all",
  exclude: Ignore | undefined,
  warnings: string[],
): Promise<{ paths: string[]; ignored: number }> {
  const paths: string[] = [];
  let ignored = 0;
  let unreadable = 0;

  const visit = async (rel: string, chain: readonly Rules[]): Promise<{ rel: string; chain: readonly Rules[] }[]> => {
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      unreadable++;
      return [];
    }
    const base = rel ? `${rel}/` : "";
    let rules = chain;
    if (mode === "plain" && entries.some((e) => e.name === ".gitignore" && e.isFile())) {
      try {
        const text = await readFile(join(abs, ".gitignore"), "utf8");
        rules = [...chain, { base, ig: ignore().add(text) }];
      } catch {
        unreadable++;
      }
    }
    const subdirs: { rel: string; chain: readonly Rules[] }[] = [];
    for (const e of entries) {
      const name = e.name;
      const path = base + name;
      if (e.isSymbolicLink()) {
        ignored++;
        continue;
      }
      const dir = e.isDirectory();
      if (!dir && !e.isFile()) {
        ignored++; // socket, FIFO, device
        continue;
      }
      // VCS metadata is not part of the project in any mode, so it is not counted as ignored.
      if (VCS_DIRS.has(name)) continue;
      if (mode === "plain" && (DEFAULT_EXCLUDES.has(name) || gitignored(rules, path, dir))) {
        ignored++;
        continue;
      }
      if (exclude?.ignores(dir ? `${path}/` : path)) {
        ignored++;
        continue;
      }
      if (dir) subdirs.push({ rel: path, chain: rules });
      else paths.push(path);
    }
    return subdirs;
  };

  // Breadth-first in waves: each level's directories are read in parallel, bounded. A shared
  // work queue (no per-level barrier) was tried and measured the same on a 1.3M-file pnpm
  // tree (~10 s either way): reading 160k directories takes ~3 s and the per-file lstat that
  // follows takes ~6 s regardless of concurrency above 64. The simpler form stays.
  let wave: { rel: string; chain: readonly Rules[] }[] = [{ rel: "", chain: [] }];
  while (wave.length) {
    const next = await mapLimit(wave, CONCURRENCY, (d) => visit(d.rel, d.chain));
    wave = next.flat();
  }
  if (unreadable) warnings.push(`${unreadable} director${unreadable === 1 ? "y" : "ies"} or ignore files could not be read`);
  return { paths, ignored: ignored + unreadable };
}

// ─── walkProject ─────────────────────────────────────────────────────────────────────────────

export const walkProject: WalkProject = async (rootIn: string, opts: WalkOptions): Promise<WalkResult> => {
  const root = await realpath(rootIn);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`not a directory: ${root}`);

  const warnings: string[] = [];
  const exclude = opts.exclude.length ? ignore().add(opts.exclude) : undefined;
  const isGit = await isGitWorkTree(root);

  let candidates: string[] = [];
  let ignored = 0;
  let listedByGit = false;

  if (isGit && !opts.includeIgnored) {
    const [listed, skipped] = await Promise.all([
      git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      // One entry per ignored directory, not per file inside it: counting node_modules file
      // by file would cost more than the rest of the walk. The figure is a floor.
      git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]),
    ]);
    if (listed.ok) {
      // Conflicted files appear once per stage under --cached; keep one of each.
      candidates = [...new Set(splitNul(listed.out))];
      ignored += skipped.ok ? splitNul(skipped.out).length : 0;
      listedByGit = true;
      if (candidates.length === 0) {
        // Root is itself gitignored (a build directory, say) or the repo is empty. The user
        // pointed at it on purpose, so walk it as a plain directory instead of reporting nothing.
        warnings.push("git lists no files under this directory; walked the filesystem instead");
        listedByGit = false;
        ignored = 0;
      }
    } else {
      warnings.push(`git ls-files failed (${listed.err.trim().split("\n")[0]}); walked the filesystem instead`);
    }
  }

  if (!listedByGit) {
    const mode = opts.includeIgnored ? "all" : "plain";
    const fs = await walkFilesystem(root, mode, exclude, warnings);
    candidates = fs.paths;
    ignored += fs.ignored;
  } else if (exclude) {
    const kept = candidates.filter((p) => !exclude.ignores(p));
    ignored += candidates.length - kept.length;
    candidates = kept;
  }

  // lstat every candidate: git lists symlinks and submodule gitlinks as entries, and tracked
  // files deleted from the working tree are still in the index.
  let missing = 0;
  let nested = 0;
  const stats = await mapLimit(candidates, CONCURRENCY, async (path): Promise<WalkedFile | undefined> => {
    // `--others` names an untracked nested repository as "dir/".
    if (path.endsWith("/")) {
      nested++;
      return undefined;
    }
    const abs = join(root, path);
    try {
      const s = await lstat(abs);
      if (s.isFile()) return { path, abs, bytes: s.size, mtimeMs: s.mtimeMs };
      if (s.isDirectory()) nested++; // submodule
      else ignored++; // symlink, socket, FIFO
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") missing++;
      else ignored++;
    }
    return undefined;
  });

  const files = stats.filter((f): f is WalkedFile => f !== undefined);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  ignored += nested;
  if (nested) warnings.push(`${nested} submodule${nested === 1 ? "" : "s"} or nested repositor${nested === 1 ? "y" : "ies"} skipped`);
  if (missing) warnings.push(`${missing} tracked file${missing === 1 ? " is" : "s are"} missing from the working tree`);

  return { root, files, isGit, ignored, warnings };
};
