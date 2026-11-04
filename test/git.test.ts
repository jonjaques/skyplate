/**
 * Tests for src/core/git.ts and its helpers under src/core/git/.
 *
 * Fixture repositories are built in a temp directory with `git` itself, under an isolated
 * config (no global or system config: the developer's signing, hooks and aliases must not leak
 * in) and fixed author/committer dates, so every number asserted below is deterministic.
 *
 * Run: bun test test/git.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitType, mineGit, renameWarning, scrubRemote, truncateSubject } from "../src/core/git";
import {
  isBot,
  mergeIdentities,
  Identities,
  normalizeEmail,
  normalizeName,
} from "../src/core/git/authors";
import {
  coupling,
  degreeOfAuthorship,
  truckFactor,
  weekStart,
  type FileAuthors,
} from "../src/core/git/derive";
import {
  LogParser,
  MergeFilesParser,
  RenamePairsParser,
  type RawCommit,
} from "../src/core/git/stream";
import type { GitResult } from "../src/core/contracts";

// ─── Fixture plumbing ────────────────────────────────────────────────────────────────────────

const TMP = mkdtempSync(join(tmpdir(), "skyplate-git-test-"));
const ISOLATED = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: TMP,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

interface Who {
  name: string;
  email: string;
}
const ALICE: Who = { name: "Alice Liddell", email: "alice@example.com" };
const ALICE_WORK: Who = { name: "Alice Liddell", email: "ALICE@Work.Example" }; // merged by name
const BOBBY: Who = { name: "bobby", email: "bobby@old.example" }; //              mailmapped to Bob
const BOB: Who = { name: "Bob Builder", email: "bob@example.com" };
const BOT: Who = {
  name: "dependabot[bot]",
  email: "49699333+dependabot[bot]@users.noreply.github.com",
};

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...ISOLATED, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function write(repo: string, path: string, content: string | Uint8Array): void {
  const abs = join(repo, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

const lines = (n: number, tag = "line"): string =>
  Array.from({ length: n }, (_, i) => `${tag} ${i + 1}\n`).join("");

/** Stages everything and commits as `who` at `date` (ISO 8601 with offset). */
function commit(repo: string, who: Who, date: string, message: string, extra: string[] = []): void {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", message, ...extra], {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

function merge(repo: string, who: Who, date: string, branch: string, message: string): void {
  git(repo, ["merge", "-q", "--no-ff", "--no-edit", "-m", message, branch], {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

function trackedPaths(repo: string): string[] {
  return git(repo, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
}

const LANG: Record<string, string> = {
  ts: "typescript",
  md: "markdown",
  json: "json",
  txt: "text",
  png: "binary",
};
const languageOf = (p: string): string => LANG[p.split(".").pop() ?? ""] ?? "text";

// ─── The main fixture ────────────────────────────────────────────────────────────────────────
//
// Dates (UTC unless noted) and what each commit exercises:
//   c1  Mon 2024-01-01 09:00  Alice       initial import; gone.txt (deleted later), CHANGES
//   c2  Tue 2024-01-02 23:30 -05:00 bobby  mailmapped author; local weekday/hour ≠ UTC
//   c3  Wed 2024-01-03        Alice@work   rename src/old-name.ts → lib/new-name.ts (+1 line)
//   c4  Mon 2024-01-08        Bob          pure rename lib/new-name.ts → lib/final.ts; binary
//   c5  Tue 2024-01-09        dependabot   bot touches package.json
//   c6  Wed 2024-01-10 09:00  Bob (side)   side branch edit
//   c7  Wed 2024-01-10 10:00  Alice        README + a.ts (3rd shared commit → coupling)
//   c8  Thu 2024-01-11        Alice        clean --no-ff merge: no files of its own
//   c9  Mon 2024-01-15        Alice        delete gone.txt; rename lib/final.ts → final.ts
//   c10 Tue 2024-01-16        Bob          a 33-path sweep (too wide to count as coupling)
//   c11 Wed 2024-01-17 09:00  Bob (side2)  conflicting edit to src/b.ts
//   c12 Wed 2024-01-17 10:00  Alice        conflicting edit to src/b.ts
//   c13 Thu 2024-01-18        Alice        conflicted merge, resolved, plus evil.txt
//   c14 Mon 2024-01-22        Alice        rename CHANGES → CHANGES.md on main
//   c15 Tue 2024-01-23        Bob (maint)  maint edits CHANGES, dated after c14
//   c16 Wed 2024-01-24        Alice        merge maint (git carries the edit to CHANGES.md)
//   c17 Thu 2024-01-25        Alice        a 150+ char conventional subject
//   c18 Mon 2024-03-04        Alice        six weeks later: zero-filled weeks in between

const D = {
  c1: "2024-01-01T09:00:00+00:00",
  c2: "2024-01-02T23:30:00-05:00",
  c3: "2024-01-03T10:00:00+00:00",
  c4: "2024-01-08T12:00:00+00:00",
  c5: "2024-01-09T08:00:00+00:00",
  c6: "2024-01-10T09:00:00+00:00",
  c7: "2024-01-10T10:00:00+00:00",
  c8: "2024-01-11T09:00:00+00:00",
  c9: "2024-01-15T09:00:00+00:00",
  c10: "2024-01-16T09:00:00+00:00",
  c11: "2024-01-17T09:00:00+00:00",
  c12: "2024-01-17T10:00:00+00:00",
  c13: "2024-01-18T09:00:00+00:00",
  c14: "2024-01-22T09:00:00+00:00",
  c15: "2024-01-23T09:00:00+00:00",
  c16: "2024-01-24T09:00:00+00:00",
  c17: "2024-01-25T09:00:00+00:00",
  c18: "2024-03-04T09:00:00+00:00",
};
const LONG_SUBJECT = "perf(parser)!: " + "make the tokenizer faster ".repeat(6);
const TOKEN = "s3cret-token-value";

let REPO = "";
let PATHS: string[] = [];
let RESULT: GitResult;
const progress: [number, number][] = [];

function buildMainFixture(): string {
  const repo = join(TMP, "main");
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  write(repo, ".mailmap", "Bob Builder <bob@example.com> bobby <bobby@old.example>\n");
  write(repo, "src/a.ts", lines(10, "a"));
  write(repo, "src/b.ts", lines(5, "b"));
  write(repo, "README.md", lines(3, "readme"));
  write(repo, "gone.txt", lines(4, "gone"));
  write(repo, "package.json", '{\n  "name": "x",\n  "version": "1.0.0"\n}\n');
  write(repo, "CHANGES", lines(2, "change"));
  commit(repo, ALICE, D.c1, "feat(core): initial import");

  write(repo, "src/a.ts", lines(9, "a") + "a ten\na eleven\n"); // +2 -1
  write(repo, "src/old-name.ts", lines(4, "old"));
  commit(repo, BOBBY, D.c2, "fix: tweak a");

  mkdirSync(join(repo, "lib"), { recursive: true });
  git(repo, ["mv", "src/old-name.ts", "lib/new-name.ts"]);
  appendFileSync(join(repo, "lib/new-name.ts"), "old 5\n"); // 80% similar: still a rename
  appendFileSync(join(repo, "README.md"), "readme 4\n");
  appendFileSync(join(repo, "src/a.ts"), "a twelve\n");
  commit(repo, ALICE_WORK, D.c3, "refactor!: move old-name into lib");

  git(repo, ["mv", "lib/new-name.ts", "lib/final.ts"]);
  write(repo, "logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3, 0, 255]));
  commit(repo, BOB, D.c4, "chore(assets): rename again and add a logo");

  write(repo, "package.json", '{\n  "name": "x",\n  "version": "1.0.1"\n}\n');
  commit(repo, BOT, D.c5, "build(deps): bump version");

  git(repo, ["checkout", "-q", "-b", "side"]);
  appendFileSync(join(repo, "src/b.ts"), "b side\n");
  commit(repo, BOB, D.c6, "test: side change");
  git(repo, ["checkout", "-q", "main"]);
  appendFileSync(join(repo, "README.md"), "readme 5\n");
  appendFileSync(join(repo, "src/a.ts"), "a thirteen\n");
  commit(repo, ALICE, D.c7, "docs: readme and a");
  merge(repo, ALICE, D.c8, "side", "Merge branch 'side'");

  rmSync(join(repo, "gone.txt"));
  git(repo, ["mv", "lib/final.ts", "final.ts"]);
  commit(repo, ALICE, D.c9, "chore: remove gone, hoist final");

  for (let i = 0; i <= 30; i++)
    write(repo, `sweep/f${String(i).padStart(2, "0")}.txt`, `sweep ${i}\n`);
  appendFileSync(join(repo, "src/a.ts"), "a fourteen\n");
  appendFileSync(join(repo, "README.md"), "readme 6\n");
  commit(repo, BOB, D.c10, "feat: sweep");

  git(repo, ["checkout", "-q", "-b", "side2"]);
  write(
    repo,
    "src/b.ts",
    "B side two\n" + lines(5, "b").split("\n").slice(1).join("\n") + "b side\n",
  );
  commit(repo, BOB, D.c11, "fix: b on side2");
  git(repo, ["checkout", "-q", "main"]);
  write(repo, "src/b.ts", "B main\n" + lines(5, "b").split("\n").slice(1).join("\n") + "b side\n");
  commit(repo, ALICE, D.c12, "fix: b on main");
  // An identity is passed even though a conflicted merge writes no commit: git checks for one
  // before it starts. macOS invents one from the hostname, Linux refuses, and the refusal also
  // exits non-zero, so without it CI never merged side2 at all and c13 lost a parent. Hence
  // MERGE_HEAD, not the exit code, is what proves the merge stopped on the conflict.
  const r = Bun.spawnSync(["git", "merge", "-q", "--no-ff", "side2"], {
    cwd: repo,
    env: { ...ISOLATED, GIT_COMMITTER_NAME: ALICE.name, GIT_COMMITTER_EMAIL: ALICE.email },
  });
  expect(r.exitCode).not.toBe(0); // the conflict is the point
  // A file check rather than `rev-parse -q --verify MERGE_HEAD`: that either prints a hash or
  // exits non-zero with -q silencing stderr, so git() threw "failed: " with nothing after it.
  expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
  write(
    repo,
    "src/b.ts",
    "B merged\n" + lines(5, "b").split("\n").slice(1).join("\n") + "b side\n",
  );
  write(repo, "evil.txt", "only the merge ever wrote this\n");
  commit(repo, ALICE, D.c13, "Merge branch 'side2'");

  git(repo, ["checkout", "-q", "-b", "maint"]);
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["mv", "CHANGES", "CHANGES.md"]);
  commit(repo, ALICE, D.c14, "refactor: rename CHANGES");
  git(repo, ["checkout", "-q", "maint"]);
  appendFileSync(join(repo, "CHANGES"), "change 3 from maint\n");
  commit(repo, BOB, D.c15, "docs: changelog on maint");
  git(repo, ["checkout", "-q", "main"]);
  merge(repo, ALICE, D.c16, "maint", "Merge branch 'maint'");

  appendFileSync(join(repo, "src/a.ts"), "a fifteen\n");
  commit(repo, ALICE, D.c17, LONG_SUBJECT);
  appendFileSync(join(repo, "README.md"), "readme 7\n");
  commit(repo, ALICE, D.c18, "docs: much later");

  git(repo, [
    "remote",
    "add",
    "origin",
    `https://deploy:${TOKEN}@example.com/org/repo.git?private_token=${TOKEN}`,
  ]);
  write(repo, "notes.local", "untracked\n"); // in paths, never committed
  return repo;
}

beforeAll(async () => {
  REPO = buildMainFixture();
  PATHS = [...trackedPaths(REPO), "notes.local"].sort();
  const r = await mineGit({
    root: REPO,
    paths: PATHS,
    languages: PATHS.map(languageOf),
    maxCommits: 10_000,
    onProgress: (done, total) => progress.push([done, total]),
  });
  if (!r) throw new Error("mineGit returned null for a git repository");
  RESULT = r;
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const id = (p: string): number => {
  const i = PATHS.indexOf(p);
  if (i < 0) throw new Error(`fixture path missing: ${p}`);
  return i;
};
const fileGit = (p: string) => RESULT.perFile[id(p)];
const authorNamed = (name: string) => RESULT.summary.authors.find((a) => a.name === name);
/** Row of the commit table whose subject starts with `s`. */
const row = (s: string): number => {
  const i = RESULT.summary.commits.subject.findIndex((x) => x.startsWith(s));
  if (i < 0) throw new Error(`no commit "${s}"`);
  return i;
};

// ─── Repository facts ────────────────────────────────────────────────────────────────────────

describe("repository facts", () => {
  test("counts every commit, including merges", () => {
    const total = Number(git(REPO, ["rev-list", "--count", "HEAD"]).trim());
    expect(total).toBe(18);
    expect(RESULT.summary.totalCommits).toBe(total);
    expect(RESULT.summary.analyzedCommits).toBe(total);
    expect(RESULT.summary.truncated).toBe(false);
  });

  test("branch, 10-char head, first/last", () => {
    const s = RESULT.summary;
    expect(s.branch).toBe("main");
    expect(s.head).toBe(git(REPO, ["rev-parse", "HEAD"]).trim().slice(0, 10));
    expect(s.first).toBe(unix(D.c1));
    expect(s.last).toBe(unix(D.c18));
  });

  test("remote keeps host and path but never credentials or query", () => {
    expect(RESULT.summary.remote).toBe("https://example.com/org/repo.git");
    expect(JSON.stringify(RESULT)).not.toContain(TOKEN);
  });

  test("progress reaches the total", () => {
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual([18, 18]);
  });
});

// ─── Authors ─────────────────────────────────────────────────────────────────────────────────

describe("authors", () => {
  test("same name across emails merges; email is lowercased", () => {
    const alice = authorNamed("Alice Liddell")!;
    expect(alice).toBeDefined();
    expect(RESULT.summary.authors.filter((a) => a.name === "Alice Liddell")).toHaveLength(1);
    expect(alice.commits).toBe(11); // 10 as alice@example.com + 1 as ALICE@Work.Example
    expect(alice.email).toBe("alice@example.com");
    expect(alice.id).toBe(0); // most commits first
  });

  test(".mailmap is applied: bobby is Bob Builder", () => {
    const bob = authorNamed("Bob Builder")!;
    expect(bob.email).toBe("bob@example.com");
    expect(bob.commits).toBe(6); // c2 (as bobby), c4, c6, c10, c11, c15
    expect(RESULT.summary.authors.some((a) => a.name === "bobby")).toBe(false);
  });

  test("bots are flagged and never own human-touched files", () => {
    const bot = authorNamed("dependabot[bot]")!;
    expect(bot.bot).toBe(true);
    expect(bot.owned).toBe(0);
    expect(fileGit("package.json")!.owner).toBe(authorNamed("Alice Liddell")!.id);
    expect(fileGit("package.json")!.authors).toBe(2);
  });

  test("owned counts sum to the files with history", () => {
    const owned = RESULT.summary.authors.reduce((s, a) => s + a.owned, 0);
    expect(owned).toBe(RESULT.perFile.filter(Boolean).length);
  });
});

// ─── Per-file history ────────────────────────────────────────────────────────────────────────

describe("per-file history", () => {
  test("follows a chain of renames to the current path", () => {
    // src/old-name.ts (c2) → lib/new-name.ts (c3) → lib/final.ts (c4) → final.ts (c9)
    const g = fileGit("final.ts")!;
    expect(g.commits).toBe(4);
    expect(g.added).toBe(5); //    4 by Bob in c2, 1 by Alice in c3; the renames add nothing
    expect(g.created).toBe(unix(D.c2));
    expect(g.modified).toBe(unix(D.c9));
    expect(g.owner).toBe(authorNamed("Bob Builder")!.id);
    expect(g.ownership).toBe(0.8);
    expect(g.authors).toBe(2);
  });

  test("binary files are touches with zero lines", () => {
    const g = fileGit("logo.png")!;
    expect(g).toMatchObject({ commits: 1, added: 0, deleted: 0, ownership: 1 });
    expect(g.owner).toBe(authorNamed("Bob Builder")!.id);
  });

  test("untracked paths have no history", () => {
    expect(fileGit("notes.local")).toBeUndefined();
  });

  test("a parallel branch's edit under the old name follows the rename", () => {
    // c1 created CHANGES, c14 renamed it, c15 (maint, dated after c14) edited the old name,
    // c16's merge result differs from both parents.
    const g = fileGit("CHANGES.md")!;
    expect(g.commits).toBe(4);
    expect(g.added).toBe(3);
    const t = RESULT.summary.commits;
    expect(t.files[row("docs: changelog on maint")]).toContain(id("CHANGES.md"));
  });

  test("a file only a merge ever wrote still has history", () => {
    const g = fileGit("evil.txt")!;
    expect(g.commits).toBe(1);
    expect(g.added).toBe(0); // merges carry no lines; see the merge-handling note in git.ts
    expect(g.created).toBe(unix(D.c13));
  });

  test("src/a.ts matches git log --numstat", () => {
    const raw = git(REPO, ["log", "--format=", "--numstat", "--", "src/a.ts"])
      .split("\n")
      .filter(Boolean);
    const added = raw.reduce((s, l) => s + Number(l.split("\t")[0]), 0);
    const deleted = raw.reduce((s, l) => s + Number(l.split("\t")[1]), 0);
    const g = fileGit("src/a.ts")!;
    expect(g.commits).toBe(raw.length);
    expect(g.added).toBe(added);
    expect(g.deleted).toBe(deleted);
  });
});

// ─── Commit table ────────────────────────────────────────────────────────────────────────────

describe("commit table", () => {
  test("newest first, 10-char hashes, parallel columns", () => {
    const t = RESULT.summary.commits;
    expect(t.hash).toHaveLength(18);
    for (const k of ["time", "author", "added", "deleted", "files", "subject", "type"] as const) {
      expect(t[k]).toHaveLength(18);
    }
    expect(t.hash.every((h) => /^[0-9a-f]{10}$/.test(h))).toBe(true);
    for (let i = 1; i < t.time.length; i++) expect(t.time[i]!).toBeLessThanOrEqual(t.time[i - 1]!);
  });

  test("conventional-commit types", () => {
    const t = RESULT.summary.commits;
    expect(t.type[row("feat(core)")]).toBe("feat");
    expect(t.type[row("refactor!:")]).toBe("refactor");
    expect(t.type[row("build(deps)")]).toBe("build");
    expect(t.type[row("Merge branch 'side'")]).toBe("");
    expect(t.type[row("perf(parser)")]).toBe("perf");
  });

  test("subjects are capped at 120 characters", () => {
    const s = RESULT.summary.commits.subject[row("perf(parser)")]!;
    expect(LONG_SUBJECT.length).toBeGreaterThan(120);
    expect(s).toHaveLength(120);
    expect(s.endsWith("…")).toBe(true);
  });

  test("a clean merge has no files and no lines", () => {
    const t = RESULT.summary.commits;
    const i = row("Merge branch 'side'");
    expect(t.files[i]).toEqual([]);
    expect(t.added[i]).toBe(0);
    expect(t.deleted[i]).toBe(0);
  });

  test("a conflicted merge lists the files it resolved, with zero lines", () => {
    const t = RESULT.summary.commits;
    const i = row("Merge branch 'side2'");
    expect(t.files[i]).toEqual([id("evil.txt"), id("src/b.ts")].sort((a, b) => a - b));
    expect(t.added[i]).toBe(0);
  });

  test("deleted files are dropped from files but kept in line totals", () => {
    const t = RESULT.summary.commits;
    const i = row("chore: remove gone");
    expect(t.files[i]).toEqual([id("final.ts")]);
    expect(t.deleted[i]).toBe(4); // gone.txt's four lines
    const first = row("feat(core)");
    // a.ts, b.ts, README, gone.txt, package.json, CHANGES, .mailmap
    expect(t.added[first]).toBe(10 + 5 + 3 + 4 + 4 + 2 + 1);
  });
});

// ─── Time series ─────────────────────────────────────────────────────────────────────────────

describe("time series", () => {
  test("weekly buckets are Monday 00:00 UTC, continuous and zero-filled", () => {
    const w = RESULT.summary.weekly;
    expect(w[0]!.start).toBe(unix("2024-01-01T00:00:00Z"));
    expect(w.at(-1)!.start).toBe(unix("2024-03-04T00:00:00Z"));
    for (let i = 1; i < w.length; i++) expect(w[i]!.start - w[i - 1]!.start).toBe(7 * 86_400);
    expect(w.reduce((s, x) => s + x.commits, 0)).toBe(18);
    expect(w.filter((x) => x.commits === 0).length).toBe(5); // Jan 29 … Feb 26
    expect(w[0]!.authors).toBe(2); // Alice and Bob (as bobby)
  });

  test("punchcard is author-local and Monday-first", () => {
    const p = RESULT.summary.punchcard;
    expect(p).toHaveLength(7);
    expect(p.every((r) => r.length === 24)).toBe(true);
    expect(p[1]![23]).toBe(1); // c2: Tuesday 23:30 at -05:00 (Wednesday 04:30 UTC)
    expect(p[2]![4]).toBe(0);
    expect(p.flat().reduce((s, x) => s + x, 0)).toBe(18);
  });

  test("growth accumulates net lines and counts files as they appear", () => {
    const s = RESULT.summary;
    const net =
      s.commits.added.reduce((a, b) => a + b, 0) - s.commits.deleted.reduce((a, b) => a + b, 0);
    expect(s.growth).toHaveLength(s.weekly.length);
    expect(s.growth.at(-1)!.lines).toBe(net);
    expect(s.growth.at(-1)!.files).toBe(RESULT.perFile.filter(Boolean).length);
    expect(s.growth[0]!.files).toBeLessThan(s.growth.at(-1)!.files);
  });

  test("language churn is monthly, continuous, keyed by language id", () => {
    const c = RESULT.summary.languageChurn;
    expect(c.months).toEqual([
      unix("2024-01-01T00:00:00Z"),
      unix("2024-02-01T00:00:00Z"),
      unix("2024-03-01T00:00:00Z"),
    ]);
    expect(c.series.typescript![0]).toBeGreaterThan(0);
    expect(c.series.typescript![1]).toBe(0);
    expect(c.series.markdown![2]).toBe(1); // c18's README line
    expect(c.series.binary).toBeUndefined(); // never gains a line
  });
});

// ─── Coupling and truck factor ───────────────────────────────────────────────────────────────

describe("coupling and truck factor", () => {
  test("co-changed pair found; the wide sweep is ignored", () => {
    const a = id("README.md");
    const b = id("src/a.ts");
    const pair = RESULT.summary.coupling.find(
      (c) => c.a === Math.min(a, b) && c.b === Math.max(a, b),
    );
    // c1, c3, c7 share both; c10 also does, but touches 33 paths.
    expect(pair).toMatchObject({ shared: 3, degree: 0.6 }); // 3 / min(5 README commits, 6 a.ts)
    const sweep = id("sweep/f00.txt");
    expect(RESULT.summary.coupling.some((c) => c.a === sweep || c.b === sweep)).toBe(false);
  });

  test("truck factor follows authorship of files, not commits, and skips the bot", () => {
    // Bob's 31-file sweep makes him sole author (DOA 4.555) of 33 of the 40 files; Alice, with
    // twice his commits, authors 7. Removing Bob alone orphans 33/40 > 50%.
    const tf = RESULT.summary.truckFactor;
    expect(tf.value).toBe(1);
    expect(tf.authors).toEqual([authorNamed("Bob Builder")!.id]);
  });

  test("excluded files keep their history but leave owned, coupling and truck factor", async () => {
    // Stand-ins for generated/vendored files: the sweep, and README (half of the one pair).
    const exclude = PATHS.map((p) => p.startsWith("sweep/") || p === "README.md");
    const r = (await mineGit({
      root: REPO,
      paths: PATHS,
      languages: PATHS.map(languageOf),
      maxCommits: 10_000,
      exclude,
    }))!;
    const s = r.summary;
    const by = (name: string) => s.authors.find((a) => a.name === name)!;
    // History views are untouched.
    expect(r.perFile[id("README.md")]).toEqual(fileGit("README.md"));
    expect(s.commits).toEqual(RESULT.summary.commits);
    expect(s.authors.map((a) => a.commits)).toEqual(RESULT.summary.authors.map((a) => a.commits));
    // The remaining 8 files: Alice owns and authors 6, Bob final.ts (DOA 4.366) and logo.png.
    expect([by("Alice Liddell").owned, by("Bob Builder").owned]).toEqual([6, 2]);
    expect(s.coupling).toEqual([]);
    expect(s.truckFactor).toEqual({ value: 1, authors: [by("Alice Liddell").id] });
  });
});

// ─── Scope, caps and odd repositories ────────────────────────────────────────────────────────

describe("scope and edge cases", () => {
  test("maxCommits caps the walk and marks it truncated", async () => {
    const r = (await mineGit({
      root: REPO,
      paths: PATHS,
      languages: PATHS.map(languageOf),
      maxCommits: 3,
    }))!;
    expect(r.summary.analyzedCommits).toBe(3);
    expect(r.summary.totalCommits).toBe(18);
    expect(r.summary.truncated).toBe(true);
    expect(r.summary.commits.hash).toHaveLength(3);
  });

  test("a subdirectory root gets root-relative paths and its own commit count", async () => {
    const root = join(REPO, "src");
    const paths = ["a.ts", "b.ts"];
    const r = (await mineGit({
      root,
      paths,
      languages: ["typescript", "typescript"],
      maxCommits: 0,
    }))!;
    const expected = Number(git(root, ["rev-list", "--count", "HEAD", "--", "."]).trim());
    expect(r.summary.totalCommits).toBe(expected);
    expect(r.summary.analyzedCommits).toBe(expected);
    expect(r.perFile[0]!.commits).toBe(fileGit("src/a.ts")!.commits);
    // The conflicted merge resolved src/b.ts; combined diffs ignore --relative, so this only
    // passes if the prefix is cut correctly.
    expect(r.perFile[1]!.commits).toBe(fileGit("src/b.ts")!.commits);
  });

  test("not a repository → null", async () => {
    const dir = join(TMP, "plain");
    mkdirSync(dir);
    write(dir, "x.txt", "x\n");
    expect(
      await mineGit({ root: dir, paths: ["x.txt"], languages: ["text"], maxCommits: 10 }),
    ).toBeNull();
  });

  test("empty repository → a valid, empty summary", async () => {
    const dir = join(TMP, "empty");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "trunk"]);
    write(dir, "x.txt", "x\n");
    const r = (await mineGit({
      root: dir,
      paths: ["x.txt"],
      languages: ["text"],
      maxCommits: 10,
    }))!;
    expect(r).not.toBeNull();
    expect(r.summary).toMatchObject({
      branch: "trunk",
      head: "",
      totalCommits: 0,
      analyzedCommits: 0,
      truncated: false,
    });
    expect(r.summary.weekly).toEqual([]);
    expect(r.summary.punchcard.flat().every((x) => x === 0)).toBe(true);
    expect(r.summary.truckFactor).toEqual({ value: 0, authors: [] });
    expect(r.perFile).toEqual([undefined]);
  });

  test("shallow clone is analyzed and flagged truncated", async () => {
    const dir = join(TMP, "shallow");
    git(TMP, ["clone", "-q", "--depth", "1", `file://${REPO}`, dir]);
    const paths = trackedPaths(dir);
    const r = (await mineGit({
      root: dir,
      paths,
      languages: paths.map(languageOf),
      maxCommits: 100,
    }))!;
    expect(r.summary.analyzedCommits).toBe(1);
    expect(r.summary.totalCommits).toBe(1);
    expect(r.summary.truncated).toBe(true); // truncated with analyzed === total: the shallow signal
    expect(r.perFile.every((g) => g?.commits === 1)).toBe(true);
  });

  test("detached HEAD reports HEAD as the branch", async () => {
    const dir = join(TMP, "detached");
    git(TMP, ["clone", "-q", `file://${REPO}`, dir]);
    git(dir, ["checkout", "-q", "--detach", "HEAD~1"]);
    const r = (await mineGit({ root: dir, paths: [], languages: [], maxCommits: 0 }))!;
    expect(r.summary.branch).toBe("HEAD");
    expect(r.summary.analyzedCommits).toBe(17);
  });

  test("a branch's rename that the merge undid does not cut the file's history", async () => {
    // vite's rollupTypeCompat.d.ts: a branch renamed it to .d.mts, the merge kept .d.ts.
    const dir = join(TMP, "undone-rename");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    write(dir, "types.d.ts", lines(8, "type"));
    commit(dir, ALICE, "2024-02-01T09:00:00Z", "add types");
    git(dir, ["checkout", "-q", "-b", "esm"]);
    git(dir, ["mv", "types.d.ts", "types.d.mts"]);
    commit(dir, BOB, "2024-02-02T09:00:00Z", "rename to mts");
    git(dir, ["checkout", "-q", "main"]);
    appendFileSync(join(dir, "types.d.ts"), "type 9\n");
    commit(dir, ALICE, "2024-02-03T09:00:00Z", "extend types");
    git(dir, ["merge", "-q", "--no-ff", "--no-commit", "esm"], {
      GIT_AUTHOR_NAME: "x",
      GIT_AUTHOR_EMAIL: "x@x",
      // A committer too: Linux git will not invent one from the hostname (see buildMainFixture).
      GIT_COMMITTER_NAME: "x",
      GIT_COMMITTER_EMAIL: "x@x",
    });
    git(dir, ["mv", "types.d.mts", "types.d.ts"]);
    commit(dir, ALICE, "2024-02-04T09:00:00Z", "Merge branch 'esm', keeping .d.ts");
    const r = (await mineGit({
      root: dir,
      paths: ["types.d.ts"],
      languages: ["typescript"],
      maxCommits: 0,
    }))!;
    expect(r.perFile[0]).toMatchObject({ added: 9, created: unix("2024-02-01T09:00:00Z") });
  });

  test("control bytes in an author name or subject do not shift other fields", async () => {
    const dir = join(TMP, "ctrl");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    write(dir, "a.txt", "a\n");
    const subject = "\x1esubj\x1fwith\x1eseps";
    commit(dir, { name: "Ev\x1fil", email: "e@x.com" }, "2024-02-06T14:00:00+00:00", subject);
    const r = (await mineGit({ root: dir, paths: ["a.txt"], languages: ["text"], maxCommits: 0 }))!;
    expect(r.summary.authors.map((a) => [a.name, a.email])).toEqual([["Ev\x1fil", "e@x.com"]]);
    expect(r.summary.commits.subject).toEqual([subject]);
    expect(r.summary.punchcard[1]![14]).toBe(1); // Tuesday 14:00: the date field was read
    expect(r.summary.punchcard.flat().reduce((s, x) => s + x, 0)).toBe(1);
  });

  test("a move of more files than git's default rename limit still follows them", async () => {
    // 1,100 files moved to new names and edited in one commit: past diff.renameLimit's 1,000,
    // git skips exhaustive detection and every move becomes a delete plus an add.
    const dir = join(TMP, "bigmove");
    const N = 1100;
    // Every line unique to its file: with "file 1 …" vs "file 11 …" git paired 14 of the
    // 1,100 with the wrong partner, which is git's similarity guess, not what is under test.
    const body = (i: number): string =>
      Array.from({ length: 8 }, (_, k) => `${i}.${k} ${(i * 7919 + k * 104_729) % 1_000_003}\n`)
        .join("");
    mkdirSync(join(dir, "old"), { recursive: true });
    git(dir, ["init", "-q", "-b", "main"]);
    for (let i = 0; i < N; i++) write(dir, `old/f${i}.txt`, body(i));
    commit(dir, ALICE, "2024-02-01T09:00:00Z", "create");
    mkdirSync(join(dir, "new"));
    for (let i = 0; i < N; i++) {
      rmSync(join(dir, `old/f${i}.txt`));
      write(dir, `new/g${i}.txt`, body(i) + `moved ${i}\n`);
    }
    commit(dir, BOB, "2024-02-02T09:00:00Z", "move and touch all");
    const paths = trackedPaths(dir);
    const r = (await mineGit({
      root: dir,
      paths,
      languages: paths.map(() => "text"),
      maxCommits: 0,
    }))!;
    expect(r.warnings).toEqual([]);
    expect(r.perFile.every((g) => g?.commits === 2 && g.added === 9)).toBe(true);
    expect(r.perFile[0]!.created).toBe(unix("2024-02-01T09:00:00Z"));
  });

  test("git's skipped-rename warning, as git prints it, becomes a report warning", () => {
    // Real stderr: two edited moves in one commit under a limit of 1 (a 2 × 2 matrix), with
    // LC_ALL=C as in mineGit, since git ships translations of this message.
    const dir = join(TMP, "renamelimit");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    write(dir, "a.txt", lines(6, "alpha"));
    write(dir, "b.txt", lines(6, "beta"));
    commit(dir, ALICE, "2024-02-01T09:00:00Z", "add");
    rmSync(join(dir, "a.txt"));
    rmSync(join(dir, "b.txt"));
    write(dir, "c.txt", lines(6, "alpha") + "moved\n");
    write(dir, "d.txt", lines(6, "beta") + "moved\n");
    commit(dir, ALICE, "2024-02-02T09:00:00Z", "move both");
    const r = Bun.spawnSync(
      ["git", "-c", "diff.renameLimit=1", "log", "-M", "--numstat", "--format=%h", "HEAD"],
      { cwd: dir, env: { ...ISOLATED, LC_ALL: "C" }, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = r.stderr.toString();
    expect(stderr).toContain("rename detection was skipped");
    expect(renameWarning(stderr)).toContain("history of files moved in them starts at the move");
    expect(renameWarning("")).toBeUndefined();
  });

  test("a subdirectory root follows files moved in from elsewhere in the repository", async () => {
    // older/o.txt → other/o.txt (outside) → pkg/o.txt: two rounds of rename sources.
    const dir = join(TMP, "movein");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    write(dir, "older/o.txt", lines(6, "o"));
    write(dir, "pkg/a.txt", lines(3, "a"));
    commit(dir, ALICE, "2024-02-01T09:00:00Z", "init");
    appendFileSync(join(dir, "older/o.txt"), "o 7\n");
    commit(dir, ALICE, "2024-02-02T09:00:00Z", "edit outside");
    mkdirSync(join(dir, "other"));
    git(dir, ["mv", "older/o.txt", "other/o.txt"]);
    commit(dir, BOB, "2024-02-03T09:00:00Z", "move once, still outside");
    git(dir, ["mv", "other/o.txt", "pkg/o.txt"]);
    appendFileSync(join(dir, "pkg/o.txt"), "o 8\n");
    commit(dir, BOB, "2024-02-04T09:00:00Z", "move into pkg and edit");
    write(dir, "unrelated.txt", "x\n");
    commit(dir, BOB, "2024-02-05T09:00:00Z", "outside only, never in scope");

    const whole = (await mineGit({
      root: dir,
      paths: ["pkg/a.txt", "pkg/o.txt", "unrelated.txt"],
      languages: ["text", "text", "text"],
      maxCommits: 0,
    }))!;
    const sub = (await mineGit({
      root: join(dir, "pkg"),
      paths: ["a.txt", "o.txt"],
      languages: ["text", "text"],
      maxCommits: 0,
    }))!;
    // Author ids are ranks by commit count, and the outside-only commit shifts them, so the
    // owner is compared by name.
    const ownerName = (r: GitResult) => r.summary.authors[r.perFile[1]!.owner]!.name; // o.txt
    expect({ ...sub.perFile[1]!, owner: 0 }).toEqual({ ...whole.perFile[1]!, owner: 0 });
    expect(sub.perFile[1]).toMatchObject({
      commits: 4,
      added: 8,
      ownership: 0.875,
      created: unix("2024-02-01T09:00:00Z"),
    });
    // The move is a rename again, so Bob is credited with one line of o.txt, not all eight.
    expect(ownerName(sub)).toBe(ALICE.name);
    expect(ownerName(whole)).toBe(ALICE.name);
    expect(sub.summary.totalCommits).toBe(4); // the outside-only commit stays out
    expect(sub.summary.analyzedCommits).toBe(4);
    expect(sub.warnings).toEqual([]);
  });

  test("a renamed-away path that is re-created later is a different file", async () => {
    // a.txt → b.txt (R); later a new a.txt is created and deleted. b.txt must not inherit it.
    const dir = join(TMP, "recreate");
    mkdirSync(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    write(dir, "a.txt", lines(6, "orig"));
    commit(dir, ALICE, "2024-02-01T09:00:00Z", "add a");
    git(dir, ["mv", "a.txt", "b.txt"]);
    commit(dir, ALICE, "2024-02-02T09:00:00Z", "rename a to b");
    write(dir, "a.txt", lines(3, "imposter"));
    commit(dir, BOB, "2024-02-03T09:00:00Z", "new a");
    rmSync(join(dir, "a.txt"));
    commit(dir, BOB, "2024-02-04T09:00:00Z", "drop a");
    const r = (await mineGit({ root: dir, paths: ["b.txt"], languages: ["text"], maxCommits: 0 }))!;
    expect(r.perFile[0]).toMatchObject({ commits: 2, added: 6, deleted: 0 });
  });
});

// ─── Helper units ────────────────────────────────────────────────────────────────────────────

describe("log parser", () => {
  const SAMPLE =
    "\x1e" +
    "a".repeat(40) +
    "\x001704099600\0Alice\0alice@x\x001 09\0" +
    "b".repeat(40) +
    "\0feat: one\0" +
    "\n3\t1\tsrc/x.ts\0-\t-\tlogo.png\0" +
    "0\t0\t\0dir/old name.ts\0dir/new => name.ts\0" +
    "\x1e" +
    "b".repeat(40) +
    "\x001704013200\0Bob\0bob@x\x007 23\0\0Merge it\0";

  function parseAll(chunks: string[]): RawCommit[] {
    const out: RawCommit[] = [];
    const p = new LogParser((c) => out.push(c));
    for (const c of chunks) p.push(c);
    p.end();
    return out;
  }

  test("headers, numstat, binary and rename tokens", () => {
    const [a, b] = parseAll([SAMPLE]);
    expect(a).toMatchObject({
      time: 1704099600,
      name: "Alice",
      weekday: 0,
      hour: 9,
      subject: "feat: one",
    });
    expect(a!.changes).toEqual([
      { path: "src/x.ts", added: 3, deleted: 1, binary: false },
      { path: "logo.png", added: 0, deleted: 0, binary: true },
      { path: "dir/new => name.ts", from: "dir/old name.ts", added: 0, deleted: 0, binary: false },
    ]);
    expect(b).toMatchObject({
      weekday: 6,
      hour: 23,
      parents: "",
      subject: "Merge it",
      changes: [],
    });
  });

  test("identical result however the stream is chunked", () => {
    const whole = parseAll([SAMPLE]);
    for (const size of [1, 2, 3, 7, 64]) {
      const chunks: string[] = [];
      for (let i = 0; i < SAMPLE.length; i += size) chunks.push(SAMPLE.slice(i, i + size));
      expect(parseAll(chunks)).toEqual(whole);
    }
  });

  test("separator bytes inside header fields stay in their field", () => {
    // Under \x1f-separated fields, a \x1f in the name shifted email, date and subject; and a
    // field opening with \x1e must not be taken for the next commit's header.
    const [c, next] = parseAll([
      "\x1e" + "c".repeat(40) + "\x001704099600\0Ev\x1fil\0e@x.com\x002 14\0\0" +
        "\x1esubj\x1fwith\x1eseps\0\n1\t0\ta.txt\0" +
        "\x1e" + "d".repeat(40) + "\x001704013200\0\x1eRS\0r@x\x003 08\0\0s\0",
    ]);
    expect(c).toMatchObject({
      name: "Ev\x1fil",
      email: "e@x.com",
      weekday: 1,
      hour: 14,
      subject: "\x1esubj\x1fwith\x1eseps",
      changes: [{ path: "a.txt", added: 1, deleted: 0, binary: false }],
    });
    expect(next).toMatchObject({ name: "\x1eRS", email: "r@x", weekday: 2, hour: 8 });
  });

  test("merge-file lists stay repo-relative; clean merges emit nothing", () => {
    const got: [string, string[]][] = [];
    const p = new MergeFilesParser((h, paths) => got.push([h, paths]));
    p.push("\x1eabc\0\0sub/c.txt\0sub/evil.txt\0\x1edef\0\0");
    p.end();
    expect(got).toEqual([["abc", ["sub/c.txt", "sub/evil.txt"]]]);
  });

  test("rename pairs are read positionally, whatever the paths look like", () => {
    const got: [string, string][] = [];
    const p = new RenamePairsParser((from, to) => got.push([from, to]));
    const text =
      "\x1eabc\0\nR100\0other/o.txt\0pkg/o.txt\0R087\0R100\0\x1eodd\0" +
      "\x1edef\0\nR050\0a b\0pkg/c\0";
    for (let i = 0; i < text.length; i += 5) p.push(text.slice(i, i + 5));
    p.end();
    expect(got).toEqual([
      ["other/o.txt", "pkg/o.txt"],
      ["R100", "\x1eodd"],
      ["a b", "pkg/c"],
    ]);
  });
});

describe("authors helpers", () => {
  test("bot detection without tripping on real names", () => {
    for (const [n, e] of [
      ["dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"],
      ["Renovate Bot", "bot@renovateapp.com"],
      ["github-actions[bot]", "x@users.noreply.github.com"],
      ["GitHub Action", "action@github.com"],
      ["jade-bot", "someone@example.com"],
      ["pre-commit-ci[bot]", "x@y"],
      ["ImgBotApp", "ImgBotHelp@gmail.com"],
    ] as const) {
      expect(isBot(n, e.toLowerCase())).toBe(true);
    }
    for (const [n, e] of [
      ["Lowell Abbott", "lowell.abbott@gmail.com"],
      ["Henré Botha", "henrebotha@gmail.com"],
      ["Travis Harmon", "harmtrav@gmail.com"],
      ["Boy Steven", "stevenprobot@gmail.com"],
      ["Marc Hernandez Cabot", "noviluni@gmail.com"],
      ["Jon", "jon@bot.example.com"],
    ] as const) {
      expect(isBot(n, e)).toBe(false);
    }
  });

  test("email and name normalization", () => {
    expect(normalizeEmail(" 123+Octo@users.noreply.github.com ")).toBe(
      "octo@users.noreply.github.com",
    );
    expect(normalizeEmail("Octo@Example.COM")).toBe("octo@example.com");
    expect(normalizeName("José  O'Neil")).toBe(normalizeName("jose oneil"));
  });

  test("placeholder names and bots never merge with people", () => {
    const ids = new Identities();
    ids.add("root", "a@one");
    ids.add("root", "b@two");
    ids.add("Sam Lee", "sam@home");
    ids.add("Sam Lee", "sam@work");
    ids.add("renovate[bot]", "bot1@x");
    const { authors, groupOf } = mergeIdentities(ids);
    expect(authors).toHaveLength(4); // root ×2 separate, Sam merged, the bot
    expect(groupOf[2]).toBe(groupOf[3]);
    expect(groupOf[0]).not.toBe(groupOf[1]);
  });

  /** Adds `count` commits by name <email>; returns the identity id. */
  const commits = (ids: Identities, name: string, email: string, count: number): number => {
    let id = -1;
    for (let i = 0; i < count; i++) id = ids.add(name, email);
    return id;
  };

  test("a stray name cannot pull a large identity into someone else's", () => {
    // vite: green@sapphi.red (1,476 commits) has 2 under "andrew"; andywangsy has 46.
    const ids = new Identities();
    const green = commits(ids, "翠", "a@x", 1000);
    commits(ids, "andrew", "a@x", 2);
    const andrew = commits(ids, "andrew", "b@y", 46);
    const { authors, groupOf } = mergeIdentities(ids);
    expect(authors).toHaveLength(2);
    expect(groupOf[green]).not.toBe(groupOf[andrew]);
    expect(authors.map((a) => a.commits)).toEqual([1002, 46]);
  });

  test("a name used ten times or more still merges, however small its share", () => {
    // The same address's 17 "sapphi-red" commits (1%) are what join it to the noreply one.
    const ids = new Identities();
    const main = commits(ids, "翠 / green", "a@x", 1459);
    commits(ids, "sapphi-red", "a@x", 17);
    const noreply = commits(ids, "sapphi-red", "1+sapphi-red@users.noreply.github.com", 448);
    // And a quarter of an identity's commits is enough on its own.
    const jeff = commits(ids, "ydcjeff", "j@x", 3);
    commits(ids, "Jeff Yang", "j@x", 1);
    const jeffToo = commits(ids, "Jeff Yang", "j@y", 1);
    const { groupOf } = mergeIdentities(ids);
    expect(groupOf[main]).toBe(groupOf[noreply]);
    expect(groupOf[jeff]).toBe(groupOf[jeffToo]);
  });

  test("a capitalized one-word name never merges; a handle and a CJK name do", () => {
    const ids = new Identities();
    const pairs = [
      ["Alex", "alex@one", "Alex", "a16@two"], //            five different people in vite
      ["Владимир", "v@one", "Владимир", "v@two"], //       Cyrillic spaces its words too
      ["patak", "m@one", "patak", "583075+patak-dev@users.noreply.github.com"],
      ["sun0day", "s@one", "sun0day", "s@two"],
      ["OneNail", "o@one", "OneNail", "o@two"],
      ["김정환", "k@one", "김정환", "k@two"],
      ["Mergify", "m@bot", "Mergify", "m2@bot"], //        bots: a product name, not a person
    ] as const;
    const merged = pairs.map(([n1, e1, n2, e2]) => {
      const a = ids.add(n1, e1);
      const b = ids.add(n2, e2);
      return [a, b] as const;
    });
    const { groupOf } = mergeIdentities(ids);
    expect(merged.map(([a, b]) => groupOf[a] === groupOf[b])).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("derive helpers", () => {
  test("weekStart is Monday 00:00 UTC, including before the epoch's Thursday", () => {
    expect(weekStart(unix("2024-01-07T23:59:59Z"))).toBe(unix("2024-01-01T00:00:00Z"));
    expect(weekStart(unix("2024-01-08T00:00:00Z"))).toBe(unix("2024-01-08T00:00:00Z"));
    expect(weekStart(0)).toBe(unix("1969-12-29T00:00:00Z"));
  });

  test("degree of authorship matches Avelino et al.", () => {
    expect(degreeOfAuthorship(1, 1, 0)).toBeCloseTo(3.293 + 1.098 + 0.164, 10);
    expect(degreeOfAuthorship(0, 2, 9)).toBeCloseTo(3.293 + 0.328 - 0.321 * Math.log(10), 10);
  });

  test("truck factor: greedy removal until more than half the files are orphaned", () => {
    // Four files; author 0 created and solely wrote files 0-2; author 1 wrote file 3.
    const table: FileAuthors = {
      start: Int32Array.from([0, 1, 2, 3, 4]),
      author: Int32Array.from([0, 0, 0, 1]),
      added: Float64Array.from([10, 10, 10, 10]),
      commits: Int32Array.from([3, 3, 3, 3]),
    };
    const tf = truckFactor(table, Int32Array.from([0, 0, 0, 1]), [false, false], [9, 3]);
    expect(tf).toEqual({ value: 1, authors: [0] }); // 3 of 4 files orphaned after one removal
    // Same files, but author 0 is a bot: its files leave the model, author 1 is all that is left.
    const botTf = truckFactor(table, Int32Array.from([0, 0, 0, 1]), [true, false], [9, 3]);
    expect(botTf).toEqual({ value: 1, authors: [1] });
  });

  test("coupling keeps pairs with ≥ 3 shared commits and skips wide commits", () => {
    const files = [
      [0, 1],
      [0, 1],
      [0, 1, 2],
      [0, 2],
      [0, 2],
      Array.from({ length: 40 }, (_, i) => i % 3),
    ];
    const width = [2, 2, 3, 2, 2, 31];
    const pairs = coupling(3, files, width, Int32Array.from([6, 3, 3]));
    expect(pairs).toEqual([
      { a: 0, b: 1, shared: 3, degree: 1 },
      { a: 0, b: 2, shared: 3, degree: 1 },
    ]);
  });
});

describe("subjects and remotes", () => {
  test("conventional types", () => {
    expect(commitType("feat(ui)!: x")).toBe("feat");
    expect(commitType("Fix: y")).toBe("fix");
    expect(commitType("wip: z")).toBe("wip");
    expect(commitType("Merge pull request #1 from a/b")).toBe("");
    expect(commitType("2024: notes")).toBe("");
    expect(commitType('Revert "feat: x"')).toBe("");
  });

  test("truncation never splits a surrogate pair", () => {
    const s = "a".repeat(118) + "😀" + "tail";
    const t = truncateSubject(s);
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toContain("\ud83d…");
  });

  test("credentials never survive", () => {
    expect(scrubRemote("https://x-access-token:ghp_abc@github.com/o/r.git")).toBe(
      "https://github.com/o/r.git",
    );
    expect(scrubRemote("https://ghp_abc@github.com/o/r")).toBe("https://github.com/o/r");
    expect(scrubRemote("ssh://git@host.example:2222/o/r.git")).toBe(
      "ssh://host.example:2222/o/r.git",
    );
    expect(scrubRemote("git@github.com:o/r.git")).toBe("github.com:o/r.git");
    expect(scrubRemote("https://gitlab.com/o/r.git?private_token=abc#frag")).toBe(
      "https://gitlab.com/o/r.git",
    );
    expect(scrubRemote("/Users/someone/repos/r.git")).toBeUndefined();
    expect(scrubRemote("file:///Users/someone/r.git")).toBeUndefined();
    expect(scrubRemote("C:\\repos\\r.git")).toBeUndefined();
  });

  test("an unencoded '/', '?' or '#' in a password fails closed instead of leaking", () => {
    // Each of these once came back holding the user and some or all of the secret.
    for (const u of [
      "https://user:ab/cdFAKE@host/x.git",
      "https://user:ab?cdFAKE@host/x.git",
      "https://user:ab#cdFAKE@host/x.git",
      "https://ab?cdFAKE@host/x.git", //    bare token: "https://ab"
      "https://ab/cdFAKE@host/x.git", //    bare token: host "ab", secret in the path
      "user:a/bFAKE@host:path/r.git", //    scp-like: host "user", secret in the path
    ]) {
      const got = scrubRemote(u);
      expect(got ?? "").not.toContain("FAKE");
      expect(got ?? "").not.toContain("ab");
    }
    // Still kept: a password with "@" in it, a port, an IPv6 literal, scp with a password.
    expect(scrubRemote("https://u:p@ss@host.example/x")).toBe("https://host.example/x");
    expect(scrubRemote("ssh://git:pw@host:2222/o/r")).toBe("ssh://host:2222/o/r");
    expect(scrubRemote("https://[::1]:8080/x.git")).toBe("https://[::1]:8080/x.git");
    expect(scrubRemote("user:pw@host.example:o/r.git")).toBe("host.example:o/r.git");
  });
});
