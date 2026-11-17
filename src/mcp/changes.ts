/**
 * What the working tree changed against HEAD: the selection behind `change_impact { working_tree }`.
 *
 *   workingTreeChanges(root)     files changed, added, renamed, untracked and deleted, with the
 *                                lines each tracked file gained or rewrote
 *
 * An agent that has just edited does not know its own diff as a list: it knows what it meant to
 * change. Asking git is the only honest source, and the changed lines are what turn "these
 * files" into "these declarations" (query.ts maps a range onto the symbols that span it).
 *
 * Three commands, all read-only, all scoped to the project directory with `--relative` so a
 * project that is a subdirectory of its repository gets its own paths back:
 * - `diff --name-status -z` is the list. -z paths are raw bytes, so a name with a quote, a tab
 *   or a non-ASCII letter arrives as it is on disk.
 * - `diff -U0` is the line ranges. Its `+++ b/path` headers are C-quoted for unusual names, so a
 *   path found there and not in the list is ignored: that file keeps no ranges and is treated
 *   as changed throughout, which over-reports rather than misses.
 * - `ls-files --others --exclude-standard` is what git does not track yet and does not ignore.
 *
 * Deleted files are named and nothing more. The current analysis no longer holds them, so who
 * imported them is not something this snapshot can say; a remaining import shows up as an
 * unresolved one, and as a failing build.
 */

import { gitEnv } from "../core/git";
import { QueryError } from "./query";

export interface ChangedFile {
  /** Project-relative path as it is now. */
  path: string;
  status: "modified" | "added" | "renamed" | "untracked";
  /** For a rename: where it was at HEAD. */
  from?: string;
  /** 1-based inclusive line ranges, in the file as it is now, that the diff added or rewrote. Absent: the whole file. */
  ranges?: [number, number][];
}

export interface WorkingTree {
  files: ChangedFile[];
  /** Paths at HEAD that are gone from the working tree. */
  deleted: string[];
}

async function git(root: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "-C", root, "-c", "core.quotePath=false", ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: gitEnv() });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { ok: code === 0, out };
}

/** Line ranges per path from `git diff -U0`: each hunk's `+start,count`, count 0 meaning lines were only removed there. */
export function parseHunks(diff: string): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  let ranges: [number, number][] | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.startsWith("+++ b/") ? line.slice(6) : undefined;
      ranges = path === undefined ? undefined : [];
      if (path !== undefined) out.set(path, ranges!);
    } else if (ranges && line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // A pure deletion has no new lines; the declaration that lost them spans the line it
      // happened at (or the one before, when the cut was at the very top).
      ranges.push(count === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + count - 1]);
    }
  }
  return out;
}

export async function workingTreeChanges(root: string): Promise<WorkingTree> {
  if (!Bun.which("git")) throw new QueryError("working_tree needs git on PATH; pass paths or symbols instead");
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head.ok) throw new QueryError("working_tree compares against HEAD, and this project has no commit yet (or is not a git repository); pass paths or symbols instead");
  const [names, hunks, others] = await Promise.all([
    git(root, ["diff", "--relative", "--name-status", "-z", "-M", "HEAD", "--"]),
    git(root, ["diff", "--relative", "--no-color", "--no-ext-diff", "-M", "-U0", "HEAD", "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (!names.ok) throw new QueryError("git could not compare the working tree with HEAD; pass paths or symbols instead");
  const ranges = hunks.ok ? parseHunks(hunks.out) : new Map<string, [number, number][]>();
  const files: ChangedFile[] = [];
  const deleted: string[] = [];
  const parts = names.out.split("\0");
  for (let i = 0; i + 1 < parts.length; ) {
    const code = parts[i++]!;
    if (code[0] === "R" || code[0] === "C") {
      const from = parts[i++]!;
      const path = parts[i++]!;
      // A copy leaves its source in place; only the new file changed.
      files.push({ path, status: code[0] === "R" ? "renamed" : "added", ...(code[0] === "R" ? { from } : {}), ranges: ranges.get(path) });
    } else {
      const path = parts[i++]!;
      if (code[0] === "D") deleted.push(path);
      // A file added to the index is new in full; -U0 says so as one hunk, which is the same thing.
      else files.push({ path, status: code[0] === "A" ? "added" : "modified", ranges: code[0] === "A" ? undefined : ranges.get(path) });
    }
  }
  if (others.ok) for (const path of others.out.split("\0")) if (path) files.push({ path, status: "untracked" });
  return { files, deleted };
}
