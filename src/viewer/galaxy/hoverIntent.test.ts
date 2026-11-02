/**
 * Hover intent with a fake clock: the pointer is a list of timed samples, the candidate under it
 * comes from a toy picker over stars on a line, and nothing waits on real time.
 *
 *   bun test src/viewer/galaxy/hoverIntent.test.ts
 */

import { describe, expect, test } from "bun:test";
import { HOVER_TUNING, HoverIntent, pickScore, type PointerKind } from "./hoverIntent";

const T = HOVER_TUNING;

/** Stars on the x axis every `gap` px, pick radius 7 px (the plate's floor). */
function picker(gap: number, count: number) {
  const r = 7;
  return (x: number, y: number, sticky: number | null): number | null => {
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < count; i++) {
      const s = pickScore(Math.hypot(x - i * gap, y), r, i === sticky);
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  };
}

/** Drive the machine the way the plate does: one sample per 16 ms frame, ticks at its deadlines. */
function drive(intent: HoverIntent<number>, pick: ReturnType<typeof picker>, path: { x: number; y: number; t: number }[], pointer: PointerKind = "mouse") {
  const commits: { t: number; target: number | null }[] = [];
  let last: number | null = intent.committed;
  const note = (t: number, c: number | null) => {
    if (c !== last) commits.push({ t, target: c });
    last = c;
  };
  for (const p of path) {
    // Ticks due before this sample run first, as the plate's timer would fire them.
    for (let d = intent.nextDeadline(); d !== null && d < p.t; d = intent.nextDeadline()) {
      const before = d;
      note(d, intent.tick(d));
      if (intent.nextDeadline() === before) break;
    }
    note(p.t, intent.sample({ ...p, pointer }, pick(p.x, p.y, intent.committed)));
  }
  return { commits, flush(until: number) {
    for (let d = intent.nextDeadline(); d !== null && d <= until; d = intent.nextDeadline()) {
      const before = d;
      note(d, intent.tick(d));
      if (intent.nextDeadline() === before) break;
    }
    return commits;
  } };
}

/** A straight move from (x0, 0) to (x1, 0) at `speed` px/ms, sampled every 16 ms. */
function sweep(x0: number, x1: number, speed: number, t0 = 0, y = 0) {
  const out: { x: number; y: number; t: number }[] = [];
  const dur = Math.abs(x1 - x0) / speed;
  for (let t = 0; t <= dur; t += 16) out.push({ x: x0 + (x1 - x0) * (t / dur), y, t: t0 + t });
  return out;
}

/** The pointer held at (x, y) from t0 to t1, with a sample every frame (as a resting mouse jitters none). */
function hold(x: number, t0: number, t1: number, y = 0) {
  const out: { x: number; y: number; t: number }[] = [];
  for (let t = t0; t <= t1; t += 16) out.push({ x, y, t });
  return out;
}

describe("hover intent", () => {
  test("a fast sweep across a row of stars commits nothing", () => {
    const pick = picker(12, 40);
    const intent = new HoverIntent<number>((a, b) => a === b);
    // 1.5 px/ms: a brisk move across the plate, crossing a star every 8 ms.
    const run = drive(intent, pick, sweep(0, 470, 1.5));
    expect(run.commits).toEqual([]);
    expect(intent.committed).toBeNull();
  });

  test("dwelling on a star commits it once the dwell has passed", () => {
    const pick = picker(30, 3);
    const intent = new HoverIntent<number>((a, b) => a === b);
    // Approach star 1 slowly and rest on it.
    const run = drive(intent, pick, [...sweep(10, 30, 0.1), ...hold(30, 216, 400)]);
    expect(run.commits.length).toBe(1);
    expect(run.commits[0]!.target).toBe(1);
    // Not before the dwell: the star came under the pointer at x = 23 (7 px out).
    const arrived = ((23 - 10) / 0.1);
    expect(run.commits[0]!.t).toBeGreaterThanOrEqual(arrived - 16 + T.dwellMs);
  });

  test("a pointer that stops dead on a star commits it without further samples", () => {
    const pick = picker(30, 3);
    const intent = new HoverIntent<number>((a, b) => a === b);
    // Fast in, then nothing: no samples at all after t = 48.
    const run = drive(intent, pick, sweep(-60, 60, 2.5).filter((p) => p.x <= 61));
    const commits = run.flush(1000);
    expect(commits.map((c) => c.target)).toEqual([2]);
    expect(commits[0]!.t).toBeLessThan(48 + T.dwellMs + T.stopMs + 1);
  });

  test("a steady sweep inside one big group commits nothing until the pointer stops", () => {
    // One candidate under the whole path, as a supercluster's envelope is. A speed estimate that
    // decayed between frames once read this 0.6 px/ms sweep as slow and committed at 97 ms.
    const group = () => 7;
    const intent = new HoverIntent<number>((a, b) => a === b);
    const path = sweep(0, 300, 0.6);
    const run = drive(intent, group, path);
    expect(run.commits).toEqual([]);
    const last = path.at(-1)!.t;
    expect(run.flush(last + 500)).toEqual([{ t: last + T.stopMs, target: 7 }]);
  });

  test("slowing over a star commits it while still moving", () => {
    const pick = picker(40, 3);
    const intent = new HoverIntent<number>((a, b) => a === b);
    // 0.15 px/ms across star 1's 14 px disc: about 93 ms on it.
    const run = drive(intent, pick, sweep(25, 55, 0.15));
    expect(run.commits[0]?.target).toBe(1);
  });

  test("warm: once a card is up, a slow step to the neighbor hands off with the short dwell", () => {
    const pick = picker(14, 5);
    const intent = new HoverIntent<number>((a, b) => a === b);
    const first = drive(intent, pick, hold(14, 0, 200));
    expect(first.commits.map((c) => c.target)).toEqual([1]);
    // Step to star 2 at a scanning pace (0.2 px/ms) and rest.
    const step = sweep(14, 28, 0.2, 216);
    const run = drive(intent, pick, [...step, ...hold(28, step.at(-1)!.t + 16, 600)]);
    const handoff = run.commits.find((c) => c.target === 2)!;
    expect(handoff).toBeDefined();
    // Star 2 takes over at x = 23.6, where the sticky star's handicap moves the boundary.
    expect(handoff.t - (216 + (23.6 - 14) / 0.2)).toBeLessThan(T.dwellMs);
    // The card never went away between the two.
    expect(run.commits.some((c) => c.target === null)).toBe(false);
  });

  test("cold, the same step waits for the full dwell", () => {
    const pick = picker(14, 5);
    const intent = new HoverIntent<number>((a, b) => a === b);
    const step = sweep(14, 28, 0.2, 0);
    const run = drive(intent, pick, [...step, ...hold(28, step.at(-1)!.t + 16, 600)]);
    // Star 1 was under the pointer from t = 0 but at speed; whatever commits, it is not
    // before the cold dwell.
    expect(run.commits[0]!.t).toBeGreaterThanOrEqual(T.dwellMs);
  });

  test("leave grace: slipping off and back keeps the hover; staying off lets it go", () => {
    const pick = picker(100, 2);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(0, 0, 200));
    expect(intent.committed).toBe(0);
    // Off into the void for less than the grace, then back.
    const back = drive(intent, pick, [...hold(30, 216, 216 + T.leaveGraceMs - 40), ...hold(0, 216 + T.leaveGraceMs - 24, 600)]);
    expect(back.commits).toEqual([]);
    expect(intent.committed).toBe(0);
    // Off for good: released once the grace is up, not before.
    const away = drive(intent, pick, hold(40, 616, 700));
    const done = away.flush(2000);
    expect(done).toEqual([{ t: 616 + T.leaveGraceMs, target: null }]);
  });

  test("leaving the plate releases after the grace too", () => {
    const pick = picker(100, 2);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(0, 0, 200));
    expect(intent.leave(220)).toBe(0);
    expect(intent.nextDeadline()).toBe(220 + T.leaveGraceMs);
    expect(intent.tick(220 + T.leaveGraceMs - 1)).toBe(0);
    expect(intent.tick(220 + T.leaveGraceMs)).toBeNull();
  });

  test("hysteresis: a 1 px jitter at the midpoint between dense neighbors keeps the committed star", () => {
    const pick = picker(8, 2); // stars at x = 0 and x = 8
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(3, 0, 200));
    expect(intent.committed).toBe(0);
    const jitter: { x: number; y: number; t: number }[] = [];
    for (let k = 0; k < 40; k++) jitter.push({ x: k % 2 === 0 ? 3.5 : 4.5, y: 0, t: 216 + k * 16 });
    const run = drive(intent, pick, jitter);
    run.flush(2000);
    expect(run.commits).toEqual([]);
    expect(intent.committed).toBe(0);
    // Without the sticky radius the same jitter flips the pick at every sample.
    let flips = 0;
    let prev = -1;
    for (const p of jitter) {
      const s0 = pickScore(Math.abs(p.x - 0), 7, false);
      const s1 = pickScore(Math.abs(p.x - 8), 7, false);
      const plain = s0 <= s1 ? 0 : 1;
      if (prev >= 0 && plain !== prev) flips++;
      prev = plain;
    }
    expect(flips).toBeGreaterThan(30);
  });

  test("hysteresis holds a 2 px jitter between neighbors 10 px apart", () => {
    const pick = picker(10, 2);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(2, 0, 200));
    const jitter: { x: number; y: number; t: number }[] = [];
    for (let k = 0; k < 40; k++) jitter.push({ x: k % 2 === 0 ? 3 : 7, y: 0, t: 216 + k * 16 });
    const run = drive(intent, pick, jitter);
    run.flush(2000);
    expect(run.commits).toEqual([]);
    expect(intent.committed).toBe(0);
  });

  test("a deliberate move onto the neighbor still takes the hover from the sticky star", () => {
    const pick = picker(8, 2);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(0, 0, 200));
    drive(intent, pick, hold(8, 216, 500));
    expect(intent.committed).toBe(1);
  });

  test("a group behind the gaps between stars does not interrupt a slow scan", () => {
    // Stars every 20 px (14 px discs, 6 px gaps) inside a group (id 100) that holds the gaps.
    const stars = picker(20, 7);
    const pick = (x: number, y: number, sticky: number | null) => stars(x, y, sticky) ?? 100;
    const ranked = () => new HoverIntent<number>((a, b) => a === b, T, (t) => (t === 100 ? 0 : 1));
    // 0.12 px/ms: slow enough to commit each star in turn, and 50 ms in each gap.
    const path = sweep(0, 126, 0.12);
    const flat = drive(new HoverIntent<number>((a, b) => a === b), pick, path).commits.map((c) => c.target);
    expect(flat).toContain(100); // without ranks, the group flashes in the gaps
    const intent = ranked();
    const targets = drive(intent, pick, path).commits.map((c) => c.target);
    expect(targets.filter((t) => t !== 100).length).toBeGreaterThan(4);
    expect(targets).not.toContain(100);
    // Resting in a gap long enough does bring the group up, once the star's grace is over.
    const rest = drive(intent, pick, hold(140 + 21, 2000, 2600));
    rest.flush(3000);
    expect(intent.committed).toBe(100);
  });

  test("touch and pen never hover", () => {
    const pick = picker(30, 3);
    for (const pointer of ["touch", "pen"] as const) {
      const intent = new HoverIntent<number>((a, b) => a === b);
      const run = drive(intent, pick, hold(30, 0, 600), pointer);
      run.flush(2000);
      expect(run.commits).toEqual([]);
      expect(intent.committed).toBeNull();
      expect(intent.nextDeadline()).toBeNull();
    }
  });

  test("a touch sample drops a mouse hover at once", () => {
    const pick = picker(30, 3);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(30, 0, 200));
    expect(intent.committed).toBe(1);
    expect(intent.sample({ x: 30, y: 0, t: 220, pointer: "touch" }, 1)).toBeNull();
  });

  test("the deadline never asks for a tick that cannot change anything", () => {
    const pick = picker(14, 5);
    const intent = new HoverIntent<number>((a, b) => a === b);
    drive(intent, pick, hold(14, 0, 200));
    // Let it go and come back as the warm window closes: every deadline must make progress.
    const off = drive(intent, pick, hold(200, 216, 300));
    off.flush(216 + T.leaveGraceMs + T.warmWindowMs - 10);
    intent.sample({ x: 28, y: 0, t: 216 + T.leaveGraceMs + T.warmWindowMs - 20, pointer: "mouse" }, 2);
    let guard = 0;
    for (let d = intent.nextDeadline(); d !== null && guard < 10; d = intent.nextDeadline(), guard++) intent.tick(d);
    expect(guard).toBeLessThan(10);
    expect(intent.committed).toBe(2);
  });
});
