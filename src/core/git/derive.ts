/**
 * Everything computed after the log pass: time series, coupling, ownership, truck factor.
 * Each function is linear (or k² per commit, k ≤ 30, for coupling) in what History stored, so
 * none of them revisits git.
 *
 * Index reads use `!` for the reason given at the top of history.ts.
 */

import type { CouplingPair, FileGit, GitSummary } from "../../shared/schema";
import { clampTime, monthKey, monthStart } from "./history";

const DAY = 86_400;
const WEEK = 7 * DAY;

/** Monday 00:00 UTC of the week containing t. Day 0 of the epoch was a Thursday. */
export function weekStart(t: number): number {
  const day = Math.floor(t / DAY);
  const sinceMonday = (((day + 3) % 7) + 7) % 7;
  return (day - sinceMonday) * DAY;
}

// ─── Weekly activity and growth ──────────────────────────────────────────────────────────────

export function weeklySeries(
  time: number[],
  author: ArrayLike<number>,
  added: number[],
  deleted: number[],
  /** Creation time of every current file that has history. */
  created: number[],
  horizon: number,
): { weekly: GitSummary["weekly"]; growth: GitSummary["growth"] } {
  if (time.length === 0) return { weekly: [], growth: [] };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of time) {
    const c = clampTime(t, horizon);
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  const first = weekStart(lo);
  const count = Math.round((weekStart(hi) - first) / WEEK) + 1;
  const commits = new Int32Array(count);
  const add = new Float64Array(count);
  const del = new Float64Array(count);
  const people: (Set<number> | undefined)[] = new Array(count);
  for (let i = 0; i < time.length; i++) {
    const w = Math.round((weekStart(clampTime(time[i]!, horizon)) - first) / WEEK);
    commits[w]!++;
    add[w]! += added[i]!;
    del[w]! += deleted[i]!;
    (people[w] ??= new Set()).add(author[i]!);
  }

  const births = created.map((t) => clampTime(t, horizon)).sort((a, b) => a - b);
  const weekly: GitSummary["weekly"] = [];
  const growth: GitSummary["growth"] = [];
  let net = 0;
  let born = 0;
  for (let w = 0; w < count; w++) {
    const start = first + w * WEEK;
    weekly.push({
      start,
      commits: commits[w]!,
      added: add[w]!,
      deleted: del[w]!,
      authors: people[w]?.size ?? 0,
    });
    net += add[w]! - del[w]!;
    while (born < births.length && births[born]! < start + WEEK) born++;
    growth.push({ start, lines: net, files: born });
  }
  return { weekly, growth };
}

// ─── Punchcard ───────────────────────────────────────────────────────────────────────────────

export function punchcard(punch: number[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const p of punch) if (p >= 0) grid[Math.floor(p / 24)]![p % 24]!++;
  return grid;
}

// ─── Language churn ──────────────────────────────────────────────────────────────────────────

export function languageChurn(
  time: number[],
  churn: Map<number, Float64Array>,
  languageIds: string[],
  horizon: number,
): GitSummary["languageChurn"] {
  if (time.length === 0) return { months: [], series: {} };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of time) {
    const k = monthKey(clampTime(t, horizon));
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const months: number[] = [];
  for (let k = lo; k <= hi; k++) months.push(monthStart(k));

  const series: Record<string, number[]> = {};
  languageIds.forEach((id, li) => {
    // "" is a file the caller could not classify; it has no Report.languages entry to key.
    if (id === "") return;
    let row: number[] | undefined;
    for (const [k, values] of churn) {
      const v = values[li]!;
      if (v === 0) continue;
      row ??= new Array<number>(months.length).fill(0);
      row[k - lo] = v;
    }
    // Languages that never gained a line (binary assets, untouched files) add only zeros.
    if (row) series[id] = row;
  });
  return { months, series };
}

// ─── Change coupling ─────────────────────────────────────────────────────────────────────────

export const COUPLING_MAX_FILES = 30; //  commits wider than this are sweeps, not coupling
export const COUPLING_MIN_SHARED = 3; //  below this a pair is coincidence
export const COUPLING_KEEP = 500;

interface Candidate extends CouplingPair {
  score: number;
}

/** Total order so the kept 500 do not depend on iteration order: score, shared, then ids. */
function better(x: Candidate, y: Candidate): boolean {
  if (x.score !== y.score) return x.score > y.score;
  if (x.shared !== y.shared) return x.shared > y.shared;
  if (x.a !== y.a) return x.a < y.a;
  return x.b < y.b;
}

/**
 * Pairs of files changed together (Tornhill's "temporal coupling"). Rather than a pair map
 * — millions of entries on a big monorepo — this walks an inverted index file → commits and
 * counts each file's partners in one reusable array, so memory stays O(files + touches).
 * Width is measured on every path a commit touched, deleted ones included: a 200-file sweep
 * is a sweep even if 180 of those files are gone now.
 */
export function coupling(
  fileCount: number,
  files: number[][],
  width: number[],
  fileCommits: Int32Array,
): CouplingPair[] {
  const eligible: number[] = [];
  const perFile = new Int32Array(fileCount + 1);
  for (let c = 0; c < files.length; c++) {
    if (width[c]! > COUPLING_MAX_FILES || files[c]!.length < 2) continue;
    eligible.push(c);
    for (const f of files[c]!) perFile[f + 1]!++;
  }
  for (let f = 0; f < fileCount; f++) perFile[f + 1]! += perFile[f]!;
  const start = perFile.slice();
  const index = new Int32Array(perFile[fileCount]!);
  for (const c of eligible) for (const f of files[c]!) index[start[f]!++] = c;

  const heap: Candidate[] = [];
  const shared = new Int32Array(fileCount);
  const partners: number[] = [];
  for (let a = 0; a < fileCount; a++) {
    const from = perFile[a]!;
    const to = perFile[a + 1]!;
    if (to - from < COUPLING_MIN_SHARED) continue;
    for (let i = from; i < to; i++) {
      for (const b of files[index[i]!]!) {
        if (b <= a || perFile[b + 1]! - perFile[b]! < COUPLING_MIN_SHARED) continue;
        if (shared[b] === 0) partners.push(b);
        shared[b]!++;
      }
    }
    for (const b of partners) {
      const s = shared[b]!;
      shared[b] = 0;
      if (s < COUPLING_MIN_SHARED) continue;
      const degree = s / Math.min(fileCommits[a]!, fileCommits[b]!);
      offer(heap, { a, b, shared: s, degree, score: s * degree });
    }
    partners.length = 0;
  }
  heap.sort((x, y) => (better(x, y) ? -1 : better(y, x) ? 1 : 0));
  return heap.map(({ a, b, shared: s, degree }) => ({ a, b, shared: s, degree: round4(degree) }));
}

/** Bounded min-heap keyed on `better`: the root is the weakest pair kept so far. */
function offer(heap: Candidate[], c: Candidate): void {
  if (heap.length < COUPLING_KEEP) {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!better(heap[p]!, heap[i]!)) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
    return;
  }
  if (!better(c, heap[0]!)) return;
  heap[0] = c;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let worst = i;
    if (l < heap.length && better(heap[worst]!, heap[l]!)) worst = l;
    if (r < heap.length && better(heap[worst]!, heap[r]!)) worst = r;
    if (worst === i) break;
    [heap[worst], heap[i]] = [heap[i]!, heap[worst]!];
    i = worst;
  }
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

// ─── Per-file contributions by final author ──────────────────────────────────────────────────

/**
 * History keeps one slot per (file, raw identity); merging identities can fold several slots
 * into one author. This regroups them as a CSR table: file f's rows are
 * [start[f], start[f + 1]), one per distinct author, in O(slots).
 */
export interface FileAuthors {
  start: Int32Array;
  author: Int32Array;
  added: Float64Array;
  commits: Int32Array;
}

export function fileAuthors(
  fileCount: number,
  slotFile: number[],
  slotIdentity: number[],
  slotAdded: number[],
  slotCommits: number[],
  groupOf: Int32Array,
  authorCount: number,
): FileAuthors {
  const slots = slotFile.length;
  const bucket = new Int32Array(fileCount + 1);
  for (let s = 0; s < slots; s++) bucket[slotFile[s]! + 1]!++;
  for (let f = 0; f < fileCount; f++) bucket[f + 1]! += bucket[f]!;
  const cursor = bucket.slice();
  const order = new Int32Array(slots);
  for (let s = 0; s < slots; s++) order[cursor[slotFile[s]!]!++] = s;

  const start = new Int32Array(fileCount + 1);
  const author = new Int32Array(slots);
  const added = new Float64Array(slots);
  const commits = new Int32Array(slots);
  const stamp = new Int32Array(authorCount).fill(-1);
  const row = new Int32Array(authorCount);
  let n = 0;
  for (let f = 0; f < fileCount; f++) {
    start[f] = n;
    for (let i = bucket[f]!; i < bucket[f + 1]!; i++) {
      const s = order[i]!;
      const a = groupOf[slotIdentity[s]!]!;
      if (stamp[a] !== f) {
        stamp[a] = f;
        row[a] = n;
        author[n] = a;
        n++;
      }
      added[row[a]!]! += slotAdded[s]!;
      commits[row[a]!]! += slotCommits[s]!;
    }
  }
  start[fileCount] = n;
  return {
    start,
    author: author.subarray(0, n),
    added: added.subarray(0, n),
    commits: commits.subarray(0, n),
  };
}

// ─── Ownership ───────────────────────────────────────────────────────────────────────────────

export interface FileTotals {
  commits: Int32Array;
  added: Float64Array;
  deleted: Float64Array;
  first: Float64Array;
  last: Float64Array;
}

/**
 * Owner = most lines added among humans; ties go to more commits, then the lower (more
 * active) author id. A file only bots ever touched is owned by its top bot, so every file
 * with history has an owner. Ownership is the owner's share of added lines — or of commits
 * when nobody added a line (binary assets, files that only ever shrank).
 */
export function perFileGit(
  totals: FileTotals,
  table: FileAuthors,
  bot: boolean[],
): (FileGit | undefined)[] {
  const out: (FileGit | undefined)[] = [];
  const n = totals.commits.length;
  for (let f = 0; f < n; f++) {
    const commits = totals.commits[f]!;
    if (commits === 0) {
      out.push(undefined);
      continue;
    }
    let human = -1;
    let any = -1;
    for (let i = table.start[f]!; i < table.start[f + 1]!; i++) {
      if (any < 0 || outranks(table, i, any)) any = i;
      if (!bot[table.author[i]!] && (human < 0 || outranks(table, i, human))) human = i;
    }
    const best = human >= 0 ? human : any;
    const added = totals.added[f]!;
    out.push({
      commits,
      added,
      deleted: totals.deleted[f]!,
      authors: table.start[f + 1]! - table.start[f]!,
      owner: table.author[best]!,
      ownership: round4(added > 0 ? table.added[best]! / added : table.commits[best]! / commits),
      created: totals.first[f]!,
      modified: totals.last[f]!,
    });
  }
  return out;
}

function outranks(t: FileAuthors, i: number, j: number): boolean {
  if (t.added[i] !== t.added[j]) return t.added[i]! > t.added[j]!;
  if (t.commits[i] !== t.commits[j]) return t.commits[i]! > t.commits[j]!;
  return t.author[i]! < t.author[j]!;
}

// ─── Truck factor ────────────────────────────────────────────────────────────────────────────

/**
 * Avelino, Passos, Hora, Valente, "A novel approach for estimating truck factors" (ICPC 2016).
 *
 *   DOA = 3.293 + 1.098·FA + 0.164·DL − 0.321·ln(1 + AC)
 *
 * FA = 1 when the author created the file (here: wrote its oldest analyzed commit), DL = their
 * commits to it, AC = everyone else's. An author "authors" a file when their DOA is > 0.75 of
 * the file's best and ≥ 3.293 in absolute terms. Then authors are removed greedily, most
 * authored files first, until more than half the files have nobody left.
 *
 * Bots are taken out of the model entirely rather than merely barred from authorship: a
 * dependabot that bumped a manifest forty times would otherwise push AC up and erase the
 * human who actually wrote it. Files no human ever touched carry no human knowledge to lose,
 * so they leave the denominator instead of counting as already orphaned.
 *
 * Every file with history is in scope; GitInput carries no generated/vendored flags, so
 * lockfiles and vendored trees count like code. Excluding them needs those flags in GitInput.
 */
export const DOA_THRESHOLD_ABS = 3.293;
export const DOA_THRESHOLD_NORM = 0.75;

export function degreeOfAuthorship(fa: number, dl: number, ac: number): number {
  return 3.293 + 1.098 * fa + 0.164 * dl - 0.321 * Math.log(1 + ac);
}

export function truckFactor(
  table: FileAuthors,
  /** Final author id of each file's creator, -1 for files without history. */
  creator: Int32Array,
  bot: boolean[],
  /** Author commit totals, for tie-breaks between authors owning equally many files. */
  authorCommits: number[],
): GitSummary["truckFactor"] {
  const fileCount = creator.length;
  const authored: number[][] = bot.map(() => []);
  const owners = new Int32Array(fileCount);
  let files = 0;
  let orphaned = 0;
  const doa: number[] = [];

  for (let f = 0; f < fileCount; f++) {
    let humanCommits = 0;
    for (let i = table.start[f]!; i < table.start[f + 1]!; i++) {
      if (!bot[table.author[i]!]) humanCommits += table.commits[i]!;
    }
    if (humanCommits === 0) continue;
    files++;
    let max = -Infinity;
    doa.length = 0;
    for (let i = table.start[f]!; i < table.start[f + 1]!; i++) {
      const a = table.author[i]!;
      if (bot[a]) {
        doa.push(-Infinity);
        continue;
      }
      const dl = table.commits[i]!;
      const v = degreeOfAuthorship(creator[f] === a ? 1 : 0, dl, humanCommits - dl);
      doa.push(v);
      if (v > max) max = v;
    }
    let k = 0;
    for (let i = table.start[f]!; i < table.start[f + 1]!; i++, k++) {
      const v = doa[k]!;
      if (v >= DOA_THRESHOLD_ABS && v / max > DOA_THRESHOLD_NORM) {
        authored[table.author[i]!]!.push(f);
        owners[f]!++;
      }
    }
    if (owners[f] === 0) orphaned++;
  }

  const order = authored
    .map((_, a) => a)
    .filter((a) => authored[a]!.length > 0)
    .sort(
      (x, y) =>
        authored[y]!.length - authored[x]!.length || authorCommits[y]! - authorCommits[x]! || x - y,
    );

  const removed: number[] = [];
  for (const a of order) {
    if (orphaned * 2 > files) break;
    removed.push(a);
    for (const f of authored[a]!) if (--owners[f]! === 0) orphaned++;
  }
  // Files nobody authors to begin with can already exceed half: that is a truck factor of 0.
  return { value: removed.length, authors: removed };
}
