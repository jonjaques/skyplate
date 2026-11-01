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
 *   `rev-list --count HEAD`. When root is a subdirectory, `-- .` picks the commits, widened by
 *   the outside paths of files that were moved in (renameSources), and the total is counted
 *   with the same pathspec so the two numbers mean the same thing. Paths stay repo-relative
 *   (no --relative, which would hide the outside paths); History keys files by prefix + path.
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
 *   and `shallow` are both set, and GitResult.warnings says so in words; it also carries the
 *   commit cap, a skipped rename detection, and moved-in files that could not be followed.
 *
 * - Excluded files (GitInput.exclude: lockfiles, generated, vendored) keep their FileGit and
 *   stay in every history view, but count toward no author's `owned`, form no coupling pair
 *   and leave the truck factor's model.
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
import { LOG_DATE, LOG_FORMAT, LogParser, MergeFilesParser, RenamePairsParser } from "./git/stream";

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
  // stderr is matched for the rename-limit warning, and git ships translations (Homebrew's
  // prints "Warnung: genaue Erkennung für Umbenennungen …" under de_DE). Nothing parsed from
  // stdout depends on the locale: -z paths are raw bytes, %u/%H are numeric, and
  // --encoding=UTF-8 fixes the message encoding.
  env.LC_ALL = "C";
  return env;
}

/**
 * Exhaustive rename detection compares every unpaired deleted file with every unpaired added
 * one, and git skips it when that matrix exceeds limit² (default 1000): a reorganization that
 * moves and edits more files than that loses every moved file's history. The cost is
 * quadratic (one commit moving and editing 5,000 files: 2.4 s; 10,000: 8.9 s; git 2.56 on
 * Apple Silicon), so the cap is raised rather than removed: 0 would mean unlimited, and one
 * vendored-tree swap could then stall the walk for minutes.
 */
const RENAME_LIMIT = 10_000;

/**
 * `-c` overrides applied to every command; see the module header for the first two.
 * diff.relative=false pins every pass to repo-relative paths, which History keys on, against
 * a user's diff.relative=true — as config rather than --no-relative, which only exists from
 * git 2.28 and would make older gits reject the whole command. The rename limit is pinned
 * too, so a user's own (lower) diff.renameLimit cannot change results.
 */
const SAFE_CONFIG = [
  "-c",
  "log.follow=false",
  "-c",
  "log.showSignature=false",
  "-c",
  "diff.relative=false",
  "-c",
  `diff.renameLimit=${RENAME_LIMIT}`,
];

/**
 * Printed once per command (not per commit) when any commit's matrix was still too large, so
 * the warning it becomes cannot say how many commits were affected.
 */
const RENAME_SKIPPED = /exhaustive rename detection was skipped/;

export function renameWarning(stderr: string): string | undefined {
  return RENAME_SKIPPED.test(stderr)
    ? "Git skipped rename detection in commits that moved too many files at once, so the history of files moved in them starts at the move."
    : undefined;
}

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
 *
 * It fails closed. A raw password pasted into a URL can hold an unencoded "/", "?" or "#"
 * (AWS CodeCommit's generated ones are base64), which ends the authority early: the "host"
 * left over is then "user:ab", and the secret sits in what looks like the path. So anything
 * whose host is not a plain host[:port], or with an "@" anywhere after it, is dropped rather
 * than guessed at. The field is display-only; losing an odd remote costs nothing.
 */
const HOST = /^(?:\[[0-9a-f:.]+\]|[\w.-]+)(?::\d*)?$/i;

export function scrubRemote(url: string): string | undefined {
  const u = url.trim();
  if (u.length === 0) return undefined;
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(u);
  if (full) {
    const scheme = full[1]!.toLowerCase();
    if (scheme === "file") return undefined;
    const authority = full[2]!;
    const host = authority.slice(authority.lastIndexOf("@") + 1);
    if (!HOST.test(host) || u.includes("@", scheme.length + 3 + authority.length)) {
      return undefined;
    }
    return `${scheme}://${host}${full[3]}`;
  }
  // scp-like "user@host:path". A one-letter "host" is a Windows drive ("C:\repo"). The user
  // part cannot hold a "/", so "user:a/b@host:path" parses as host "user" with the password
  // in the path, which is what the "@" check catches.
  const scp = /^(?:[^@/]*@)?([^/:@]+):(.*)$/.exec(u);
  if (scp && scp[1]!.length > 1 && HOST.test(scp[1]!) && !scp[2]!.includes("@")) {
    return `${scp[1]}:${scp[2]}`;
  }
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

  const headP = git(root, ["rev-parse", "-q", "--verify", "HEAD"]);
  const branchP = git(root, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const remoteP = readRemote(root);
  const head = await headP;
  const hasCommits = head.ok;

  const cap =
    Number.isFinite(input.maxCommits) && input.maxCommits > 0 ? Math.floor(input.maxCommits) : 0;
  const limit = cap > 0 ? [`-n${cap}`] : [];
  const horizon = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const history = new History(input.paths, input.languages, horizon, prefix);
  const warnings: string[] = [];

  // "HEAD --" ends the revision list, so a file named HEAD cannot make the argument ambiguous.
  let scope = ["HEAD", "--"];
  if (prefix.length > 0 && hasCommits) {
    const moved = await renameSources(root, prefix, limit);
    scope = ["HEAD", "--", ".", ...moved.sources.map((p) => `:(top,literal)${p}`)];
    if (!moved.complete) {
      warnings.push(
        "Not every file moved into this directory from elsewhere in the repository could be followed back, so for some of them history starts at the move.",
      );
    }
  }
  const countP = hasCommits
    ? git(root, ["rev-list", "--count", ...scope])
    : Promise.resolve({ ok: false, out: "" });

  let totalCommits = 0;
  if (hasCommits) {
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
      new MergeFilesParser((hash, paths) => mergeFiles.set(hash, paths)),
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
    const stderr = await streamGit(
      root,
      [
        "log",
        "-z",
        "--numstat",
        "-M",
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
    const skipped = renameWarning(stderr);
    if (skipped) warnings.push(skipped);
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
    exclude: input.exclude,
    warnings,
  });
};

/**
 * Files moved into a subdirectory root from elsewhere in the repository. A pathspec filters
 * the diff *before* rename detection, so under `-- .` the move of other/o.txt to pkg/o.txt is
 * an add: the file's history starts at the move and the mover is credited with every line
 * (vite's packages/vite: 21 such renames; bin/vite.js had 25 commits, not the 46 that
 * `git log --follow` and a root-level run both count). Adding each outside source to the
 * pathspec brings its earlier commits into the walk and makes the move a rename again, and
 * History's repo-relative aliases carry them to the current file. Walking the whole history
 * without a pathspec would do the same, at the cost of a root-level run (2.3 s against 1.6 s
 * on packages/vite) and of git's own commit selection, which totalCommits is counted with.
 *
 * This pass finds the sources: --full-diff keeps the pathspec's commit selection but diffs
 * the whole tree, and --diff-filter=R lists only renames (0.18 s on packages/vite, a quarter
 * of the main walk). A source may itself have been moved from further out (a chain of moves
 * is one round per hop), so the pass repeats with the widened pathspec until nothing new
 * turns up; past the round or size cap, the rest are left to the warning.
 *
 * The widened scope errs the other way in one corner: a later, unrelated file at a source's
 * old path enters the walk too, as commits that touch no current file.
 */
const MOVED_IN_ROUNDS = 4;
/** Pathspecs go on the command line: kept far below macOS's 1 MiB ARG_MAX, env included. */
const MOVED_IN_BYTES = 256 * 1024;

async function renameSources(
  root: string,
  prefix: string,
  limit: string[],
): Promise<{ sources: string[]; complete: boolean }> {
  const sources = new Set<string>();
  const inScope = (p: string): boolean => p.startsWith(prefix) || sources.has(p);
  let bytes = 0;
  for (let round = 0; round < MOVED_IN_ROUNDS; round++) {
    const found = new Set<string>();
    await streamGit(
      root,
      [
        "log",
        "-z",
        "-M",
        "--full-diff",
        "--diff-filter=R",
        "--name-status",
        "--no-color",
        "--format=%x1e%H",
        ...limit,
        "HEAD",
        "--",
        ".",
        ...[...sources].map((p) => `:(top,literal)${p}`),
      ],
      new RenamePairsParser((from, to) => {
        if (inScope(to) && !inScope(from)) found.add(from);
      }),
    );
    if (found.size === 0) return { sources: [...sources], complete: true };
    for (const p of found) {
      bytes += Buffer.byteLength(p) + 15; // ":(top,literal)" and the NUL that ends the arg
      if (bytes > MOVED_IN_BYTES) return { sources: [...sources], complete: false };
      sources.add(p);
    }
  }
  return { sources: [...sources], complete: false };
}

/**
 * Runs one git command and feeds its stdout, decoded incrementally, to a parser. Resolves to
 * the command's stderr, where the only non-fatal news (the rename-limit warning) arrives.
 */
async function streamGit(
  root: string,
  args: string[],
  sink: { push(text: string): void; end(): void },
): Promise<string> {
  const proc = Bun.spawn(["git", "-C", root, ...SAFE_CONFIG, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  // Drained concurrently: a full stderr pipe would stall git, and so stdout, until it exits.
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
  const err = await stderr;
  if (code !== 0) {
    const why = err.trim().split("\n").at(-1) ?? "";
    throw new Error(`git ${args[0]} failed in ${root} (exit ${code})${why ? `: ${why}` : ""}`);
  }
  return err;
}

// ─── Assembly ────────────────────────────────────────────────────────────────────────────────

interface Meta {
  branch: string;
  head: string;
  remote: string | undefined;
  totalCommits: number;
  shallow: boolean;
  horizon: number;
  exclude: readonly boolean[] | undefined;
  /** Raised while walking (rename limit, moved-in files not followed). */
  warnings: string[];
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
  const excluded = meta.exclude;
  perFile.forEach((g, f) => {
    if (!g) return;
    // Excluded files keep their own FileGit (the viewer still shows who touched a lockfile),
    // but owning one is not knowledge of the code, so it does not count toward `owned`.
    if (!excluded?.[f]) authors[g.owner]!.owned++;
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
    // Width is still measured on every touched path (h.width), so dropping excluded files
    // here cannot make a sweep look narrow enough to count as coupling.
    coupling: coupling(
      h.fileCount,
      excluded ? h.files.map((fs) => fs.filter((f) => !excluded[f])) : h.files,
      h.width,
      h.fileCommits,
    ),
    truckFactor: truckFactor(
      table,
      creator,
      bot,
      authors.map((a) => a.commits),
      excluded,
    ),
  };
  const warnings = [...meta.warnings];
  if (meta.shallow) {
    warnings.push(
      "This is a shallow clone, so history starts at the clone boundary: ages, creation dates and ownership reflect only the fetched commits.",
    );
  } else if (n < meta.totalCommits) {
    warnings.push(`History was capped at the newest ${n} of ${meta.totalCommits} commits.`);
  }
  return { summary, perFile, warnings };
}
