/**
 * Incremental parser for `git log -z --numstat --format=<LOG_FORMAT>` output.
 *
 * Fed decoded text in whatever chunks the pipe delivers; emits one RawCommit at a time, so a
 * 100k-commit history is never held as one string. Tested by test/git.test.ts.
 *
 * Why `-z` instead of the text numstat the task sketch started from: the text form prints
 * renames as "old => new", "dir/{old => new}/f" and "{lib => }/x", which is ambiguous the
 * moment a filename itself contains " => " or braces, and it C-quotes any path with a tab,
 * newline, quote or backslash. Under -z git prints both sides of a rename as separate
 * NUL-terminated paths and never quotes, so there is nothing to un-brace or un-escape.
 *
 * The byte layout, as observed with git 2.56 (and unchanged since numstat gained -z):
 *
 *   \x1e<hash>\0<at>\0<aN>\0<aE>\0<ad>\0<parents>\0<subject>\0    header: 7 tokens
 *   \n<added>\t<deleted>\t<path>\0                                first change ("\n" once)
 *   <added>\t<deleted>\t<path>\0                                  further changes
 *   <added>\t<deleted>\t\0<old path>\0<new path>\0                a rename: empty path field
 *
 * Binary files show "-" for both counts. Merges and empty commits are a bare header; which
 * files a merge itself changed comes from a separate, much smaller pass (MergeFilesParser).
 *
 * Header fields are NUL-separated because NUL is the one byte none of them can hold. They
 * used to be split on \x1f, on the theory that a stray separator could only land in the
 * subject; but git accepts control bytes in an author name too, and one \x1f there
 * shifted every later field (author "Ev <il>", the weekday read from the email, the commit
 * gone from the punchcard). A token that opens with \x1e only starts a header when no header
 * fields are still owed, so a name or subject beginning with \x1e cannot open a phantom one.
 */

/**
 * Starts every header. A numstat token never opens with it: those open with a digit, "-", or
 * the one "\n" -z puts before a commit's first change.
 */
const RECORD = 0x1e;
/** Tokens after the \x1e<hash> one: at, aN, aE, ad, parents, subject. */
const HEADER_FIELDS = 6;

/**
 * %aN/%aE apply .mailmap. %ad is rendered with `--date=format:%u %H`, which git formats in the
 * commit's own recorded zone (unlike `format-local:`), giving the author's local weekday
 * (1 = Monday) and hour for the punchcard without any time-zone arithmetic here. %P (parent
 * hashes) lets history.ts tell a parallel branch from a later re-creation of a path.
 */
export const LOG_FORMAT = "%x1e%H%x00%at%x00%aN%x00%aE%x00%ad%x00%P%x00%s";
export const LOG_DATE = "format:%u %H";

export interface RawChange {
  /** Post-image path: the new name when this is a rename. */
  path: string;
  /** Pre-image path, present only for renames. */
  from?: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface RawCommit {
  /** Full object name (40 hex for SHA-1 repos, 64 for SHA-256). */
  hash: string;
  /** Author time, unix seconds. */
  time: number;
  name: string;
  email: string;
  /** Author-local weekday 0 = Monday … 6 = Sunday, and hour 0-23; -1 when unparseable. */
  weekday: number;
  hour: number;
  /** Parent hashes, space-separated as %P prints them ("" for a root commit). */
  parents: string;
  subject: string;
  changes: RawChange[];
}

export class LogParser {
  private carry = "";
  private current: RawCommit | null = null;
  /** A rename's numstat token is followed by two path tokens: old (2 pending), new (1). */
  private renamePending = 0;
  private renameChange: RawChange | null = null;
  /** Header tokens still owed after "\x1e<hash>"; collected in `fields` until it is 0. */
  private headerPending = 0;
  private fields: string[] = [];

  constructor(private readonly emit: (commit: RawCommit) => void) {}

  push(text: string): void {
    if (text.length === 0) return;
    const parts = (this.carry + text).split("\0");
    // The last piece has no terminator yet; it is completed by the next chunk.
    this.carry = parts.pop() ?? "";
    for (const part of parts) this.token(part);
  }

  end(): void {
    if (this.carry.length > 0) this.token(this.carry);
    this.carry = "";
    this.flush();
  }

  private flush(): void {
    if (this.current) this.emit(this.current);
    this.current = null;
    this.renamePending = 0;
    this.renameChange = null;
  }

  private finishHeader(): void {
    this.current = parseHeader(this.fields);
    this.fields = [];
    this.headerPending = 0;
  }

  private token(t: string): void {
    // Header fields and rename paths come first: both are arbitrary text and must not be
    // sniffed as a header or a numstat line.
    if (this.headerPending > 0) {
      this.fields.push(t);
      if (--this.headerPending === 0) this.finishHeader();
      return;
    }
    if (this.renamePending > 0 && this.renameChange) {
      if (this.renamePending === 2) this.renameChange.from = t;
      else this.renameChange.path = t;
      this.renamePending--;
      return;
    }
    if (t.charCodeAt(0) === RECORD) {
      this.flush();
      this.fields = [t.slice(1)];
      this.headerPending = HEADER_FIELDS;
      return;
    }
    const commit = this.current;
    if (!commit) return;
    // Numstat tokens start with a digit or "-", so dropping one leading newline is safe.
    const start = t.charCodeAt(0) === 10 ? 1 : 0;
    const tab1 = t.indexOf("\t", start);
    if (tab1 < 0) return;
    const tab2 = t.indexOf("\t", tab1 + 1);
    if (tab2 < 0) return;
    const binary = t.charCodeAt(start) === 45; // "-"
    const change: RawChange = {
      path: t.slice(tab2 + 1),
      added: binary ? 0 : toCount(t, start, tab1),
      deleted: binary ? 0 : toCount(t, tab1 + 1, tab2),
      binary,
    };
    commit.changes.push(change);
    if (change.path.length === 0) {
      this.renamePending = 2;
      this.renameChange = change;
    }
  }
}

/**
 * Parser for the merges pass: `git log --merges -c --name-only -z --format=%x1e%H`, i.e. per
 * merge, the paths whose merged result differs from *every* parent. Layout (git 2.56):
 *
 *   \x1e<hash>\0 \0 <path>\0 <path>\0 …        (an empty token follows the header)
 *
 * Paths are repo-relative (diff.relative=false is pinned; combined diffs ignore --relative
 * anyway), which is what History keys on.
 */
export class MergeFilesParser {
  private carry = "";
  private hash = "";
  private paths: string[] = [];

  constructor(private readonly emit: (hash: string, paths: string[]) => void) {}

  push(text: string): void {
    if (text.length === 0) return;
    const parts = (this.carry + text).split("\0");
    this.carry = parts.pop() ?? "";
    for (const t of parts) {
      if (t.charCodeAt(0) === RECORD) {
        this.flush();
        this.hash = t.slice(1).trim();
      } else if (t.length > 0 && t !== "\n" && this.hash) {
        // Defensive: no separator newline was observed under -c, but -z numstat has one.
        this.paths.push(t.charCodeAt(0) === 10 ? t.slice(1) : t);
      }
    }
  }

  end(): void {
    if (this.carry.length > 0) this.push("\0");
    this.flush();
  }

  private flush(): void {
    if (this.hash && this.paths.length > 0) this.emit(this.hash, this.paths);
    this.hash = "";
    this.paths = [];
  }
}

/**
 * Parser for the rename-sources pass: `git log -z -M --full-diff --diff-filter=R
 * --name-status --format=%x1e%H`, i.e. only the renames, with both sides repo-relative:
 *
 *   \x1e<hash>\0 \nR<score>\0 <old>\0 <new>\0  R<score>\0 <old>\0 <new>\0 …
 *
 * Tokens are taken positionally (status, then two paths), so a path that happens to start
 * with \x1e or look like "R100" is never mistaken for a header or a status.
 */
export class RenamePairsParser {
  private carry = "";
  /** 0: expecting a header or a status; 2: old path next; 1: new path next. */
  private pending = 0;
  private from = "";

  constructor(private readonly emit: (from: string, to: string) => void) {}

  push(text: string): void {
    if (text.length === 0) return;
    const parts = (this.carry + text).split("\0");
    this.carry = parts.pop() ?? "";
    for (const t of parts) {
      if (this.pending === 2) {
        this.from = t;
        this.pending = 1;
      } else if (this.pending === 1) {
        this.emit(this.from, t);
        this.pending = 0;
      } else if (t.charCodeAt(0) !== RECORD) {
        const status = t.charCodeAt(0) === 10 ? t.slice(1) : t;
        if (status.charCodeAt(0) === 82) this.pending = 2; // "R"; --diff-filter=R allows no other
      }
    }
  }

  end(): void {
    if (this.carry.length > 0) this.push("\0");
  }
}

/** Decimal digits in t[from, to) — hand-rolled because it runs once per numstat column. */
function toCount(t: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const d = t.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return n;
    n = n * 10 + d;
  }
  return n;
}

/** `f`: the hash (its \x1e already cut) and the HEADER_FIELDS tokens after it. */
function parseHeader(f: string[]): RawCommit {
  const date = f[4] ?? "";
  const weekday = date.charCodeAt(0) - 49; // "1" (Monday) → 0
  const hour = Number.parseInt(date.slice(2), 10);
  const valid = weekday >= 0 && weekday <= 6 && hour >= 0 && hour <= 23;
  return {
    hash: f[0] ?? "",
    time: Number.parseInt(f[1] ?? "0", 10) || 0,
    name: f[2] ?? "",
    email: f[3] ?? "",
    weekday: valid ? weekday : -1,
    hour: valid ? hour : -1,
    parents: f[5] ?? "",
    subject: f[6] ?? "",
    changes: [],
  };
}
