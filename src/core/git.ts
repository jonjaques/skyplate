/**
 * Git history mining: one streaming `git log --numstat` pass (plus a small merges-only pass),
 * turned into the report's GitSummary and a FileGit record per current file.
 *
 * Contract: MineGit in src/core/contracts.ts; shapes in src/shared/schema.ts.
 * Verify:   bun test test/git.test.ts && bun check src/core/git.ts
 * Helpers:  src/core/git/ — stream.ts (log parser), history.ts (rename-following
 *           accumulator), authors.ts (identity merge, bots), derive.ts (series, coupling,
 *           ownership, truck factor).
 *
 * Decisions that are easy to get wrong, and what breaks otherwise:
 *
 * - Pathspec only for subdirectories. At the repository root the log runs with no pathspec:
 *   `-- .` turns on history simplification, which drops TREESAME merges and empty commits
 *   (flask: 5,566 commits become 4,579), so analyzedCommits would never match
 *   `rev-list --count HEAD`. When root is a subdirectory, `--relative -- .` is required — the
 *   pathspec picks the commits, --relative rewrites paths to be root-relative — and the total
 *   is counted with the same pathspec so the two numbers mean the same thing.
 *
 * - Merges. `git log --numstat` prints no diff for a merge, and no lines are ever taken from
 *   one: the merged work is already counted in the commits that made it, and `-m` (or --cc,
 *   whose numstat falls back to the first parent: +7,889 entries on flask) would count it
 *   again. But a merge does *touch* the files whose result differs from every parent —
 *   conflict resolutions, evil merges, a `git subtree add` — and `git log -- <path>` lists it
 *   for exactly those. A merges-only pass (`--merges -c --name-only`, 0.03-0.14 s on the test
 *   repositories) supplies that set, and they count as zero-line touches: a commit for the
 *   file, its author, its coupling, never churn. Without it, express has four tracked files
 *   that only a merge ever wrote and would be reported as never seen by git.
 *
 * - Order. `--date-order` guarantees children before parents, which rename following needs
 *   (see history.ts); plain log order can emit a parent first when clocks are skewed. The
 *   commit table is then sorted newest-first by *author* time, the same clock `time`, weekly
 *   and the punchcard use, so a reader slicing by time never meets an out-of-order row.
 *
 * - Shallow clones. `rev-list --count` can only count what was fetched, so totalCommits ==
 *   analyzedCommits and the oldest fetched commit shows every file as newly added. `truncated`
 *   is set, and "truncated with analyzedCommits === totalCommits" is the shallow signal the
 *   pipeline can surface as a warning: GitResult has no warnings field of its own.
 *
 * - Config and environment isolation. User config can silently change what log prints:
 *   log.follow makes a single "." pathspec follow renames, log.showSignature splices GPG
 *   output into the stream, textconv runs arbitrary filters per blob. Those are forced off, and
 *   GIT_DIR-style variables inherited from a hook or wrapper are dropped so `-C root` decides
 *   the repository. Every command is read-only; GIT_OPTIONAL_LOCKS=0 keeps it that way.
 */

import type { GitInput, GitResult, MineGit } from "./contracts";
import type { Author, GitSummary } from "../shared/schema";
import { mergeIdentities } from "./git/authors";
import {
  coupling,
  fileAuthors,
  languageChurn,
  perFileGit,
  punchcard,
  truckFactor,
  weeklySeries,
} from "./git/derive";
import { History } from "./git/history";
import { LOG_DATE, LOG_FORMAT, LogParser, MergeFilesParser } from "./git/stream";

// ─── Running git ─────────────────────────────────────────────────────────────────────────────

const INHERITED_REPO_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
  "GIT_REPLACE_REF_BASE",
];

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of INHERITED_REPO_VARS) delete env[k];
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

/**
 * `-c` overrides applied to every command; see the module header for the first two. The main
 * pass asks for --relative explicitly; diff.relative=false pins the merges pass to
 * repo-relative paths (its prefix is cut in stream.ts) — as config rather than --no-relative,
 * which only exists from git 2.28 and would make older gits reject the whole command.
 */
const SAFE_CONFIG = [
  "-c",
  "log.follow=false",
  "-c",
  "log.showSignature=false",
  "-c",
  "diff.relative=false",
];

async function git(root: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "-C", root, ...SAFE_CONFIG, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: gitEnv(),
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { ok: code === 0, out };
}

// ─── Remote URL scrubbing ────────────────────────────────────────────────────────────────────

/**
 * A report is something people share, and remotes routinely carry credentials:
 * `https://x-access-token:ghp_…@github.com/o/r`, `https://oauth2:glpat-…@gitlab.com/…`, or a
 * token as the bare username. All userinfo goes, the ssh user included, along with any query
 * or fragment (some hosts accept `?private_token=`). Local-path remotes return undefined: they
 * name a directory on the author's disk, which links nowhere for a reader and leaks a path the
 * report's --redact-paths would otherwise have hidden.
 */
export function scrubRemote(url: string): string | undefined {
  const u = url.trim();
  if (u.length === 0) return undefined;
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(u);
  if (full) {
    const scheme = full[1]!.toLowerCase();
    if (scheme === "file") return undefined;
    const authority = full[2]!;
    const host = authority.slice(authority.lastIndexOf("@") + 1);
    return host.length > 0 ? `${scheme}://${host}${full[3]}` : undefined;
  }
  // scp-like "user@host:path". A one-letter "host" is a Windows drive ("C:\repo").
  const scp = /^(?:[^@/]*@)?([^/:@]+):(.*)$/.exec(u);
  if (scp && scp[1]!.length > 1) return `${scp[1]}:${scp[2]}`;
  return undefined;
}

async function readRemote(root: string): Promise<string | undefined> {
  let r = await git(root, ["remote", "get-url", "origin"]);
  if (!r.ok) {
    const names = await git(root, ["remote"]);
    const first = names.ok ? names.out.split("\n").find((s) => s.trim().length > 0) : undefined;
    if (!first) return undefined;
    r = await git(root, ["remote", "get-url", first.trim()]);
    if (!r.ok) return undefined;
  }
  return scrubRemote(r.out.split("\n")[0] ?? "");
}

// ─── Commit subjects ─────────────────────────────────────────────────────────────────────────

const SUBJECT_MAX = 120;

export function truncateSubject(s: string): string {
  if (s.length <= SUBJECT_MAX) return s;
  let cut = SUBJECT_MAX - 1;
  // Never split a surrogate pair: half an emoji renders as a replacement box.
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return s.slice(0, cut) + "…";
}

/** "feat(ui)!: x" → "feat". The type must start with a letter so "2024: notes" is not one. */
const CONVENTIONAL = /^([A-Za-z]\w*)(?:\([^()]*\))?!?:/;

export function commitType(subject: string): string {
  const m = CONVENTIONAL.exec(subject);
  return m ? m[1]!.toLowerCase() : "";
}

// ─── mineGit ─────────────────────────────────────────────────────────────────────────────────

const PROGRESS_EVERY = 250;

export const mineGit: MineGit = async (input: GitInput): Promise<GitResult | null> => {
  const { root } = input;
  if (!Bun.which("git")) return null;

  let probe: { ok: boolean; out: string };
  try {
    probe = await git(root, [
      "rev-parse",
      "--is-inside-work-tree",
      "--is-shallow-repository",
      "--show-prefix",
    ]);
  } catch {
    return null; // spawn failed: git vanished between which() and here, or root is unreadable
  }
  if (!probe.ok) return null;
  const [inside, shallowFlag, prefix = ""] = probe.out.split("\n");
  if (inside !== "true") return null;
  const shallow = shallowFlag === "true";
  // "HEAD --" ends the revision list, so a file named HEAD cannot make the argument ambiguous.
  const scope = prefix.length > 0 ? ["HEAD", "--", "."] : ["HEAD", "--"];

  const headP = git(root, ["rev-parse", "-q", "--verify", "HEAD"]);
  const branchP = git(root, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const remoteP = readRemote(root);
  const head = await headP;
  const hasCommits = head.ok;
  const countP = hasCommits
    ? git(root, ["rev-list", "--count", ...scope])
    : Promise.resolve({ ok: false, out: "" });

  const cap =
    Number.isFinite(input.maxCommits) && input.maxCommits > 0 ? Math.floor(input.maxCommits) : 0;
  const horizon = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const history = new History(input.paths, input.languages, horizon);

  let totalCommits = 0;
  if (hasCommits) {
    const limit = cap > 0 ? [`-n${cap}`] : [];

    // Merges first (a fraction of a second even on vite), so the main walk can fold each
    // merge's own files in at the right point of the rename-alias timeline. The count (a
    // history walk of its own under a pathspec) overlaps it, so progress has a real total.
    const mergeFiles = new Map<string, string[]>();
    await streamGit(
      root,
      [
        "log",
        "--merges",
        "-c",
        "--name-only",
        "-z",
        "--no-color",
        "--date-order",
        "--format=%x1e%H",
        ...limit,
        ...scope,
      ],
      new MergeFilesParser(prefix, (hash, paths) => mergeFiles.set(hash, paths)),
    );
    const counted = await countP;
    totalCommits = counted.ok ? Number.parseInt(counted.out, 10) || 0 : 0;
    const expected =
      cap > 0 && totalCommits > 0 ? Math.min(cap, totalCommits) : totalCommits || cap;

    const parser = new LogParser((c) => {
      history.add(c, c.changes.length === 0 ? mergeFiles.get(c.hash) : undefined);
      const done = history.commitCount;
      if (done % PROGRESS_EVERY === 0) input.onProgress?.(done, Math.max(expected, done));
    });
    await streamGit(
      root,
      [
        "log",
        "-z",
        "--numstat",
        "-M",
        "--relative",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--date-order",
        "--encoding=UTF-8",
        `--date=${LOG_DATE}`,
        `--format=${LOG_FORMAT}`,
        ...limit,
        ...scope,
      ],
      parser,
    );
    // A failed count (or a pathspec count of 0 racing a new commit) falls back to the walk.
    if (totalCommits === 0) totalCommits = history.commitCount;
    input.onProgress?.(history.commitCount, Math.max(expected, history.commitCount));
  }

  const branch = await branchP;
  return summarize(history, {
    branch: branch.ok ? branch.out.trim() : "HEAD", // detached: git's own spelling of it
    head: hasCommits ? head.out.trim().slice(0, 10) : "",
    remote: await remoteP,
    totalCommits,
    shallow,
    horizon,
  });
};

/** Runs one git command and feeds its stdout, decoded incrementally, to a parser. */
async function streamGit(
  root: string,
  args: string[],
  sink: { push(text: string): void; end(): void },
): Promise<void> {
  const proc = Bun.spawn(["git", "-C", root, ...SAFE_CONFIG, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  // Drained concurrently: rename-limit warnings arrive once per oversized commit, and a full
  // stderr pipe would stall git (and so stdout) on a large history.
  const stderr = new Response(proc.stderr).text();
  const decoder = new TextDecoder();
  try {
    for await (const chunk of proc.stdout) sink.push(decoder.decode(chunk, { stream: true }));
    sink.push(decoder.decode());
    sink.end();
  } finally {
    if (proc.exitCode === null) proc.kill();
  }
  const code = await proc.exited;
  if (code !== 0) {
    const why = (await stderr).trim().split("\n").at(-1) ?? "";
    throw new Error(`git ${args[0]} failed in ${root} (exit ${code})${why ? `: ${why}` : ""}`);
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────────────────────

interface Meta {
  branch: string;
  head: string;
  remote: string | undefined;
  totalCommits: number;
  shallow: boolean;
  horizon: number;
}

function summarize(h: History, meta: Meta): GitResult {
  const n = h.commitCount;
  const { groupOf, authors: merged } = mergeIdentities(h.identities);
  const bot = merged.map((a) => a.bot);
  const author = new Int32Array(n);
  for (let i = 0; i < n; i++) author[i] = groupOf[h.identity[i]!]!;

  // Author totals over every commit, deleted paths included.
  const authors: Author[] = merged.map((a, id) => ({
    id,
    name: a.name,
    email: a.email,
    commits: 0,
    added: 0,
    deleted: 0,
    first: Infinity,
    last: -Infinity,
    owned: 0,
    bot: a.bot,
  }));
  let first = Infinity;
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = authors[author[i]!]!;
    const t = h.time[i]!;
    a.commits++;
    a.added += h.added[i]!;
    a.deleted += h.deleted[i]!;
    if (t < a.first) a.first = t;
    if (t > a.last) a.last = t;
    if (t < first) first = t;
    if (t > last) last = t;
  }

  const table = fileAuthors(
    h.fileCount,
    h.slotFile,
    h.slotIdentity,
    h.slotAdded,
    h.slotCommits,
    groupOf,
    merged.length,
  );
  const perFile = perFileGit(
    {
      commits: h.fileCommits,
      added: h.fileAdded,
      deleted: h.fileDeleted,
      first: h.fileFirst,
      last: h.fileLast,
    },
    table,
    bot,
  );
  const creator = new Int32Array(h.fileCount).fill(-1);
  const created: number[] = [];
  perFile.forEach((g, f) => {
    if (!g) return;
    authors[g.owner]!.owned++;
    creator[f] = author[h.fileCreator[f]!]!;
    created.push(g.created);
  });

  // Commit table: newest first by author time; ties keep git's order (children first).
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (x, y) => h.time[y]! - h.time[x]! || x - y,
  );
  const commits: GitSummary["commits"] = {
    hash: [],
    time: [],
    author: [],
    added: [],
    deleted: [],
    files: [],
    subject: [],
    type: [],
  };
  for (const i of order) {
    const subject = h.subject[i]!;
    commits.hash.push(h.hash[i]!);
    commits.time.push(h.time[i]!);
    commits.author.push(author[i]!);
    commits.added.push(h.added[i]!);
    commits.deleted.push(h.deleted[i]!);
    commits.files.push(h.files[i]!.sort((a, b) => a - b));
    commits.subject.push(truncateSubject(subject));
    commits.type.push(commitType(subject));
  }

  const { weekly, growth } = weeklySeries(
    h.time,
    author,
    h.added,
    h.deleted,
    created,
    meta.horizon,
  );
  const summary: GitSummary = {
    branch: meta.branch,
    head: meta.head,
    ...(meta.remote ? { remote: meta.remote } : {}),
    totalCommits: meta.totalCommits,
    analyzedCommits: n,
    truncated: meta.shallow || n < meta.totalCommits,
    shallow: meta.shallow,
    first: n > 0 ? first : 0,
    last: n > 0 ? last : 0,
    authors,
    commits,
    weekly,
    punchcard: punchcard(h.punch),
    growth,
    languageChurn: languageChurn(h.time, h.churn, h.languageIds, meta.horizon),
    coupling: coupling(h.fileCount, h.files, h.width, h.fileCommits),
    truckFactor: truckFactor(
      table,
      creator,
      bot,
      authors.map((a) => a.commits),
    ),
  };
  const warnings: string[] = [];
  if (meta.shallow) {
    warnings.push(
      "This is a shallow clone, so history starts at the clone boundary: ages, creation dates and ownership reflect only the fetched commits.",
    );
  } else if (n < meta.totalCommits) {
    warnings.push(`History was capped at the newest ${n} of ${meta.totalCommits} commits.`);
  }
  return { summary, perFile, warnings };
}
