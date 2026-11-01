/**
 * The log pass's accumulator: consumes RawCommits newest → oldest and keeps only what the
 * summary needs — commit columns, per-file totals, per-(file, identity) contributions, and
 * monthly lines added per language. git is never asked about a commit twice.
 *
 * ─── Rename following ───
 *
 * Walking newest → oldest, `alias` maps a historical path to the current file id it became
 * (or -1 for a dead lineage). A rename old → new seen in commit R means commits older than R
 * that touch `old` were really touching whatever `new` is now, so after R is processed:
 * alias(old) = resolve(new). Chains (a → b → c) compose for free because resolve(b) already
 * points at c's id by the time a → b is reached. A commit's renames are resolved against the
 * state *before* its own aliases apply, so a swap (a ↔ b in one commit) cannot see itself
 * half-applied. After R, `new` is marked dead: anything older touching that path was a
 * different file that used to live there — the same cut `git log --follow` makes.
 *
 * Two refinements, both found on the test repositories:
 *
 * - A rename whose target is dead now never overrides the old path's resolution. vite: a
 *   branch renamed rollupTypeCompat.d.ts to .d.mts, the merge kept .d.ts, and aliasing .d.ts
 *   to the dead .d.mts erased the live file's whole history.
 *
 * - Parallel branches. A walk in date order reaches a maintenance branch's edits to `CHANGES`
 *   *before* main's older rename CHANGES → CHANGES.rst (flask's 0.12.x releases), when that
 *   path resolves to nothing. Such touches are parked, compactly, as "pending". When a rename
 *   R later reveals where the path went, pending touches are adopted — unless their commit
 *   descends from R, because then the path was re-created after the rename and is a different
 *   file. Descent is decided from %P parents in one bounded backward scan, run only for
 *   renames that actually have pending touches.
 *
 * Paths arrive repo-relative, never cut to the analyzed root: when that root is a subdirectory,
 * a file moved into it from outside has its pre-move commits in the walk under the outside
 * path (see the subdirectory note in git.ts), and only a repo-relative alias can carry them to
 * the file. Current files are therefore keyed by `prefix + path`.
 *
 * Typed-array reads use `!`: every index below is a file id, commit index, slot or buffer
 * position that was bounds-checked where it was produced, and noUncheckedIndexedAccess cannot
 * see that.
 */

import { Identities } from "./authors";
import type { RawChange, RawCommit } from "./stream";

/** Per-(file, identity) slot key. 2^21 identities is ~70x the Linux kernel's author count. */
const IDENTITY_SPAN = 2 ** 21;

export class History {
  readonly fileCount: number;
  private readonly pathIndex = new Map<string, number>();
  private readonly alias = new Map<string, number>();
  readonly identities = new Identities();

  // ── Commit columns, in walk order ──
  readonly hash: string[] = [];
  readonly time: number[] = [];
  /** Raw identity id; mapped to the final author id once identities are merged. */
  readonly identity: number[] = [];
  /** Lines over every path in scope, including files that no longer exist. */
  readonly added: number[] = [];
  readonly deleted: number[] = [];
  /** Current file ids touched, deduplicated. */
  readonly files: number[][] = [];
  readonly subject: string[] = [];
  /** Author-local weekday * 24 + hour, or -1. */
  readonly punch: number[] = [];
  /** Paths the commit touched, current or not: the "too big to mean coupling" test uses it. */
  readonly width: number[] = [];
  /** %P strings, and full hash → walk index, for the descent test. */
  private readonly parents: string[] = [];
  private readonly indexOf = new Map<string, number>();

  // ── Per current file ──
  readonly fileCommits: Int32Array;
  readonly fileAdded: Float64Array;
  readonly fileDeleted: Float64Array;
  readonly fileFirst: Float64Array;
  readonly fileLast: Float64Array;
  /** Walk index of the oldest commit touching the file: its creator, for DOA's FA term. */
  readonly fileCreator: Int32Array;
  /** Commit index that last touched each file, to fold duplicate ids within one commit. */
  private readonly lastSeen: Int32Array;

  // ── Per (file, identity) ──
  private readonly slotOf = new Map<number, number>();
  readonly slotFile: number[] = [];
  readonly slotIdentity: number[] = [];
  readonly slotAdded: number[] = [];
  readonly slotCommits: number[] = [];

  // ── Language churn ──
  readonly languageIds: string[] = [];
  private readonly fileLanguage: Int32Array;
  /** UTC month key (year * 12 + month) → lines added per language index. */
  readonly churn = new Map<number, Float64Array>();
  private readonly horizon: number;

  // ── Pending touches: paths that resolved to nothing when walked ──
  // Every edit to a since-deleted file lands here, so it is a flat typed buffer (16 bytes a
  // touch) with a per-path linked list, not an object per touch.
  private readonly pendingPath = new Map<string, number>();
  private pendingHead: number[] = [];
  private pending = new Int32Array(4 * 1024); // [commit, added, deleted, next] per touch
  private pendingCount = 0;
  private scanCache: { r: number; lo: number; out: Uint8Array } | null = null;
  /** Touches adopted through a later rename; reported by tests and the proof runs. */
  adopted = 0;

  /** `prefix`: the analyzed root's path inside the repository, "" or ending in "/". */
  constructor(paths: string[], languages: string[], horizon: number, prefix = "") {
    const n = paths.length;
    this.fileCount = n;
    this.horizon = horizon;
    paths.forEach((p, i) => this.pathIndex.set(prefix + p, i));
    this.fileCommits = new Int32Array(n);
    this.fileAdded = new Float64Array(n);
    this.fileDeleted = new Float64Array(n);
    this.fileFirst = new Float64Array(n).fill(Infinity);
    this.fileLast = new Float64Array(n).fill(-Infinity);
    this.fileCreator = new Int32Array(n).fill(-1);
    this.lastSeen = new Int32Array(n).fill(-1);

    const langIndex = new Map<string, number>();
    this.fileLanguage = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const id = languages[i] ?? "";
      let li = langIndex.get(id);
      if (li === undefined) {
        li = this.languageIds.length;
        langIndex.set(id, li);
        this.languageIds.push(id);
      }
      this.fileLanguage[i] = li;
    }
  }

  get commitCount(): number {
    return this.hash.length;
  }

  private resolve(path: string): number {
    const a = this.alias.get(path);
    if (a !== undefined) return a;
    return this.pathIndex.get(path) ?? -1;
  }

  /**
   * `mergePaths`: for a merge, the files its result changed relative to every parent. They
   * count as touches with zero lines — the lines were already counted in the commits being
   * merged — which is the same rule `git log -- <path>` uses to decide a merge touched a path.
   */
  add(c: RawCommit, mergePaths?: string[]): void {
    const ci = this.hash.length;
    const who = this.identities.add(c.name, c.email);
    const t = c.time;
    this.hash.push(c.hash.slice(0, 10));
    this.time.push(t);
    this.identity.push(who);
    this.subject.push(c.subject);
    this.punch.push(c.weekday >= 0 ? c.weekday * 24 + c.hour : -1);
    this.parents.push(c.parents);
    this.indexOf.set(c.hash, ci);
    const files: number[] = [];
    this.files.push(files);

    const changes: RawChange[] = mergePaths
      ? mergePaths.map((path) => ({ path, added: 0, deleted: 0, binary: false }))
      : c.changes;
    let added = 0;
    let deleted = 0;
    let renames: { from: string; to: string; id: number }[] | undefined;
    for (const ch of changes) {
      added += ch.added;
      deleted += ch.deleted;
      const f = this.resolve(ch.path);
      if (ch.from !== undefined) (renames ??= []).push({ from: ch.from, to: ch.path, id: f });
      if (f >= 0) {
        // Two historical paths can land on one current file in the same commit; that is
        // still one commit touching it, so only its lines are added again.
        const first = this.lastSeen[f] !== ci;
        this.lastSeen[f] = ci;
        this.touch(ci, f, ch.added, ch.deleted, first);
      } else if (!this.alias.has(ch.path)) {
        // Unknown, not known-dead: a later rename may still say where this path went.
        this.park(ch.path, ci, ch.added, ch.deleted);
      }
    }
    this.added.push(added);
    this.deleted.push(deleted);
    this.width.push(changes.length);

    if (renames) {
      for (const r of renames) this.alias.set(r.to, -1);
      // A rename into a path that is dead now says nothing about where `from` went, so it
      // must not cut `from` loose (the vite case in the header). Leaving it alone also
      // matches --follow when a renamed file is later deleted and its old name reused.
      for (const r of renames) {
        if (r.id < 0) continue;
        this.alias.set(r.from, r.id);
        this.adopt(r.from, r.id, ci);
      }
    }
  }

  /** One commit's contribution to one current file. `first` = new for this (commit, file). */
  private touch(ci: number, f: number, added: number, deleted: number, first: boolean): void {
    const who = this.identity[ci]!;
    const key = f * IDENTITY_SPAN + who;
    let slot = this.slotOf.get(key);
    if (slot === undefined) {
      slot = this.slotFile.length;
      this.slotOf.set(key, slot);
      this.slotFile.push(f);
      this.slotIdentity.push(who);
      this.slotAdded.push(0);
      this.slotCommits.push(0);
    }
    this.slotAdded[slot]! += added;
    this.fileAdded[f]! += added;
    this.fileDeleted[f]! += deleted;
    const t = this.time[ci]!;
    if (added > 0) this.churnRow(t)[this.fileLanguage[f]!]! += added;
    if (!first) return;
    this.files[ci]!.push(f);
    this.slotCommits[slot]!++;
    this.fileCommits[f]!++;
    if (t < this.fileFirst[f]!) this.fileFirst[f] = t;
    if (t > this.fileLast[f]!) this.fileLast[f] = t;
    // Walk index grows toward the past, so the largest index touching f is its oldest commit.
    if (ci > this.fileCreator[f]!) this.fileCreator[f] = ci;
  }

  private churnRow(t: number): Float64Array {
    const key = monthKey(clampTime(t, this.horizon));
    let row = this.churn.get(key);
    if (!row) {
      row = new Float64Array(this.languageIds.length);
      this.churn.set(key, row);
    }
    return row;
  }

  // ── Pending touches ──

  private park(path: string, ci: number, added: number, deleted: number): void {
    let p = this.pendingPath.get(path);
    if (p === undefined) {
      p = this.pendingHead.length;
      this.pendingPath.set(path, p);
      this.pendingHead.push(-1);
    }
    if ((this.pendingCount + 1) * 4 > this.pending.length) {
      const grown = new Int32Array(this.pending.length * 2);
      grown.set(this.pending);
      this.pending = grown;
    }
    const at = this.pendingCount++;
    const o = at * 4;
    this.pending[o] = ci;
    this.pending[o + 1] = added;
    this.pending[o + 2] = deleted;
    this.pending[o + 3] = this.pendingHead[p]!;
    this.pendingHead[p] = at;
  }

  /** Rename R (walk index `r`) says `path` became file `f`: claim its parallel-branch edits. */
  private adopt(path: string, f: number, r: number): void {
    const p = this.pendingPath.get(path);
    if (p === undefined || this.pendingHead[p]! < 0) return;
    const touches: number[] = [];
    let lo = r;
    for (let at = this.pendingHead[p]!; at >= 0; at = this.pending[at * 4 + 3]!) {
      touches.push(at);
      lo = Math.min(lo, this.pending[at * 4]!);
    }
    this.pendingHead[p] = -1;
    const scan = this.descendantsOf(r, lo);
    for (const at of touches) {
      const ci = this.pending[at * 4]!;
      if (scan.out[ci - scan.lo]) continue; // the path was re-created after R: another file
      this.touch(
        ci,
        f,
        this.pending[at * 4 + 1]!,
        this.pending[at * 4 + 2]!,
        !this.files[ci]!.includes(f),
      );
      this.adopted++;
    }
  }

  /**
   * For walk indexes lo ≤ c < r: does c descend from r? --date-order puts every descendant of
   * r before it, and every parent after its child, so one scan from r - 1 down to lo decides
   * each commit from its already-decided parents. Parents older than r cannot lead back to it.
   */
  private descendantsOf(r: number, lo: number): { lo: number; out: Uint8Array } {
    // A directory move renames hundreds of paths in one commit; scan once per rename commit.
    const cached = this.scanCache;
    if (cached && cached.r === r && cached.lo <= lo) return cached;
    const out = new Uint8Array(r - lo);
    for (let c = r - 1; c >= lo; c--) {
      for (const hash of this.parents[c]!.split(" ")) {
        const p = this.indexOf.get(hash);
        if (p === undefined || p > r) continue;
        if (p === r || out[p - lo]) {
          out[c - lo] = 1;
          break;
        }
      }
    }
    this.scanCache = { r, lo, out };
    return this.scanCache;
  }
}

// ─── Time helpers shared with derive.ts ──────────────────────────────────────────────────────

/**
 * Bucketed series run continuously from the first to the last commit, so one commit dated in
 * 2099 (a broken clock, a crafted object) would otherwise add thousands of empty weeks. Times
 * are pinned into [epoch, now + a week] for bucketing only; the commit table keeps the truth.
 */
export function clampTime(t: number, horizon: number): number {
  return t < 0 ? 0 : t > horizon ? horizon : t;
}

export function monthKey(t: number): number {
  const d = new Date(t * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function monthStart(key: number): number {
  return Date.UTC(Math.floor(key / 12), key % 12, 1) / 1000;
}
