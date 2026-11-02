/**
 * Hover intent: which star, group or moon the reader means, as opposed to whichever one the
 * pointer happens to be crossing.
 *
 * Committing a hover is expensive for the reader's eye, not the CPU: a specimen card, a group's
 * envelope, lit lanes and dimmed neighbors all arrive at once. Committed on every pick (as the
 * plate did before), a sweep across a dense cluster flashed a dozen cards in half a second. So
 * a candidate commits only once the pointer has settled on it, the way menus and tooltips wait
 * for intent:
 *
 *   dwell       the pointer has stayed on one candidate for dwellMs while its smoothed speed is
 *               under slowPxPerMs, or it has stopped there (no movement for stopMs)
 *   warm        while a hover is up, and for warmWindowMs after it ends, the dwell drops to
 *               warmDwellMs, so scanning a cluster star by star feels fluid (tooltips do this)
 *   grace       the committed hover survives leaveGraceMs after the pointer slips off it, and
 *               coming back within that time cancels the leave
 *   hysteresis  the committed star's pick radius is STICKY_RADIUS times larger and its distance
 *               counts STICKY_PX less (see pickScore), so a 1-2 px jitter between dense
 *               neighbors cannot steal it
 *   rank        a candidate that ranks below the committed one (a group, behind a star) waits
 *               out the grace before taking over: scanning star by star through a cluster
 *               otherwise flashed the cluster's envelope in every gap between two stars
 *   touch, pen  never hover: there is no pointer to rest, and a tap selects instead
 *
 * Pure: it is driven by pointer samples and the times they carry (an injected clock), and owns
 * no timers. The caller asks nextDeadline() when to call tick() if no further sample arrives,
 * which is how a pointer that stops dead still commits. Unit tests drive it with a fake clock
 * (src/viewer/galaxy/hoverIntent.test.ts).
 */

export type PointerKind = "mouse" | "pen" | "touch";

/** One pointer position at time `t` (ms, any monotonic clock). */
export interface HoverSample {
  x: number;
  y: number;
  t: number;
  pointer: PointerKind;
}

/**
 * The tunables (HOVER_TUNING), chosen by hand on inertialref (1.5k files) in the dev server with
 * scripted pointer runs: sweeps at 0.6-1.5 px/ms (no commits), scans at 0.12-0.2 px/ms through a
 * dense core (a card per star, every 60-140 ms, no group flashes), a 1 px jitter at the midpoint
 * of 6 px pairs (one commit, no flips), and exits toward the plate's edge (the card held for the
 * grace, nothing crossed on the way committed). The reasons are beside each value.
 */
export interface HoverTuning {
  /**
   * A cold candidate must hold the pointer this long. 75 ms is under the ~100 ms at which a
   * response stops feeling immediate, yet a sweep at 600 px/s spends only ~23 ms on a 14 px
   * pick disc, so it never commits.
   */
  dwellMs: number;
  /** Handoff dwell while warm: one or two frames, enough to skip stars crossed mid-step. */
  warmDwellMs: number;
  /** How long after a hover ends the plate stays warm (tooltips use 300-500 ms). */
  warmWindowMs: number;
  /**
   * How long a committed hover outlives the pointer leaving it. Long enough to cross the
   * 2-4 px gap between neighbors or to overshoot a small star and come back; short enough
   * that the card does not linger once the reader has moved on.
   */
  leaveGraceMs: number;
  /**
   * Speed (CSS px per ms) under which the pointer counts as slow. Pointing movements decelerate
   * into their target well below 0.3 px/ms; a sweep across the plate runs at 1-3 px/ms. Measured
   * at 0.35: a steady 0.3 px/ms scan through a dense core committed once, a 0.6 px/ms sweep
   * across a supercluster not at all.
   */
  slowPxPerMs: number;
  /** Time constant of the speed smoothing: long enough to ride out one jerky frame. */
  speedTauMs: number;
  /** No movement for this long means the pointer has stopped, whatever its last speed. */
  stopMs: number;
}

export const HOVER_TUNING: HoverTuning = {
  dwellMs: 75,
  warmDwellMs: 30,
  warmWindowMs: 450,
  leaveGraceMs: 200,
  slowPxPerMs: 0.35,
  speedTauMs: 45,
  stopMs: 50,
};

/** One frame at 60 Hz (ms): the interval assumed for the first movement after a rest. */
const FRAME_MS = 1000 / 60;

/** The committed star's pick radius grows by this factor: slipping a little off it keeps it. */
export const STICKY_RADIUS = 1.5;
/**
 * And its distance to the pointer counts this many px less when it competes with a neighbor.
 * The enlarged radius alone moves the boundary between two stars by a tenth of their spacing:
 * measured on a dense core of inertialref, a 1 px jitter at the midpoint of a 6 px pair still
 * handed the card back and forth about ten times a second.
 */
export const STICKY_PX = 3;

/**
 * A star's pick score for a pointer `d` px from it with pick radius `r` (lower wins, Infinity
 * means out of reach). The committed star competes with its reach enlarged and its distance
 * discounted, which moves the boundary between it and a neighbor toward the neighbor: between
 * two stars 6 px apart the switch happens 4.9 px out instead of at 3, so jitter around the
 * midpoint keeps the card where it is, while a step onto the neighbor still takes it.
 */
export function pickScore(d: number, r: number, sticky: boolean): number {
  if (!sticky) return d > r ? Infinity : d / r;
  const reach = r * STICKY_RADIUS;
  return d > reach ? Infinity : Math.max(0, d - STICKY_PX) / reach;
}

export class HoverIntent<T> {
  private committedTarget: T | null = null;
  private candidateTarget: T | null = null;
  /** When the current candidate came under the pointer. */
  private since = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = Number.NEGATIVE_INFINITY;
  /** Smoothed pointer speed at lastT, px/ms. */
  private speed = 0;
  /** The last sample's own speed (displacement over its interval), px/ms. */
  private inst = 0;
  /** When the pointer left the committed target, or -1 while it is on it. */
  private lostAt = -1;
  /** The plate stays warm until this time after a hover ends. */
  private warmUntil = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly same: (a: T, b: T) => boolean,
    readonly tune: HoverTuning = HOVER_TUNING,
    /** Precedence of a target (the plate: star and moon 1, group 0); see "rank" above. */
    private readonly rank: (t: T) => number = () => 0,
  ) {}

  /** The hover the plate should show (card, envelope, lit lanes), or null. */
  get committed(): T | null {
    return this.committedTarget;
  }

  /** What is under the pointer right now, committed or not (for the cheap immediate feedback). */
  get candidate(): T | null {
    return this.candidateTarget;
  }

  private eq(a: T | null, b: T | null): boolean {
    return a === b || (a !== null && b !== null && this.same(a, b));
  }

  /** Feed a pointer sample with the candidate under it; returns the committed hover. */
  sample(s: HoverSample, candidate: T | null): T | null {
    // Touch and pen never hover. A finger cannot rest on the glass without pressing it, and a
    // pen in proximity drifts; on both, a tap selects (the plate's click handler).
    if (s.pointer !== "mouse") {
      this.reset();
      return null;
    }
    const dt = s.t - this.lastT;
    if (!Number.isFinite(dt)) {
      // The first sample: no motion to measure yet.
      this.speed = this.inst = 0;
    } else if (dt > this.tune.speedTauMs * 8) {
      // The first sample after a rest. A still mouse sends nothing, so this displacement is the
      // first frame of a new movement, and it seeds the estimate. Reset to zero instead, the
      // smoothed speed needed three frames to pass slowPxPerMs, and a 0.5-0.6 px/ms sweep that
      // began on an open card handed it to the next star it crossed, which flashed for 200 ms
      // (measured, on the plate and with a fake clock).
      this.speed = this.inst = Math.hypot(s.x - this.lastX, s.y - this.lastY) / FRAME_MS;
    } else if (dt > 0) {
      const v = Math.hypot(s.x - this.lastX, s.y - this.lastY) / dt;
      this.inst = v;
      this.speed += (v - this.speed) * (1 - Math.exp(-dt / this.tune.speedTauMs));
    }
    this.lastX = s.x;
    this.lastY = s.y;
    this.lastT = s.t;
    if (!this.eq(candidate, this.candidateTarget)) {
      this.candidateTarget = candidate;
      this.since = s.t;
    }
    return this.evaluate(s.t);
  }

  /** Time passes with no new sample (the pointer is still); call at nextDeadline(). */
  tick(t: number): T | null {
    return this.evaluate(t);
  }

  /** The pointer left the plate, or went over chrome on top of it: grace, then let go. */
  leave(t: number): T | null {
    if (this.candidateTarget !== null) {
      this.candidateTarget = null;
      this.since = t;
    }
    return this.evaluate(t);
  }

  /** Drop everything at once (another view took the hover, a drag began, the plate unmounted). */
  reset(): void {
    this.committedTarget = null;
    this.candidateTarget = null;
    this.lostAt = -1;
    this.speed = this.inst = 0;
    this.lastT = Number.NEGATIVE_INFINITY;
  }

  /** Forget the committed hover without a grace period, keeping the pointer's motion. */
  forget(): void {
    this.committedTarget = null;
    this.lostAt = -1;
  }

  /** When tick() should next run if no sample arrives, or null when nothing is pending. */
  nextDeadline(): number | null {
    let next = Number.POSITIVE_INFINITY;
    const c = this.candidateTarget;
    if (c !== null && !this.eq(c, this.committedTarget)) {
      // Warmth is judged when the check runs, not now: a warm window that closes before the
      // short dwell is up leaves the full dwell to wait for (and a deadline that ignored that
      // would fire, fail, and fire again at once).
      const warmEnd = this.committedTarget !== null ? Number.POSITIVE_INFINITY : this.warmUntil;
      const quick = this.since + this.tune.warmDwellMs;
      const dwellDone = quick < warmEnd ? quick : this.since + this.tune.dwellMs;
      const settle = this.motion() <= this.tune.slowPxPerMs ? this.lastT : this.lastT + this.tune.stopMs;
      next = Math.max(dwellDone, settle, this.yieldsAt(c));
    }
    if (this.committedTarget !== null && this.lostAt >= 0) next = Math.min(next, this.lostAt + this.tune.leaveGraceMs);
    return Number.isFinite(next) ? next : null;
  }

  /**
   * Speed at time t: the last sample's motion, or 0 once no sample has come for stopMs. It does
   * not decay in between. Samples arrive once a frame while the pointer moves, and a decaying
   * estimate checked between two of them read a steady 0.6 px/ms sweep as slow enough to commit
   * (measured on the plate: a group committed 97 ms into a sweep).
   */
  speedAt(t: number): number {
    if (!Number.isFinite(this.lastT) || t - this.lastT >= this.tune.stopMs) return 0;
    return this.motion();
  }

  /**
   * The last sample's motion: the faster of its own speed and the smoothed one. The smoothing
   * rides out a jerky frame while the pointer decelerates into a target, where the smoothed value
   * is the higher; but it lags an accelerating sweep, and lagging is what let the first frames of
   * a sweep read as slow. The pointer is slow only when both say so.
   */
  private motion(): number {
    return Math.max(this.inst, this.speed);
  }

  /** When a lower-ranked candidate may take over from the committed target (0: any time). */
  private yieldsAt(c: T): number {
    const held = this.committedTarget;
    if (held === null || this.rank(c) >= this.rank(held) || this.lostAt < 0) return 0;
    return this.lostAt + this.tune.leaveGraceMs;
  }

  private warm(t: number): boolean {
    return this.committedTarget !== null || t < this.warmUntil;
  }

  private dwellAt(t: number): number {
    return this.warm(t) ? this.tune.warmDwellMs : this.tune.dwellMs;
  }

  private evaluate(t: number): T | null {
    const c = this.candidateTarget;
    const held = this.committedTarget;
    if (held !== null && c !== null && this.same(c, held)) {
      // Back on (or still on) the committed target: any leave is cancelled.
      this.lostAt = -1;
      return held;
    }
    if (held !== null && this.lostAt < 0) this.lostAt = t;
    if (c !== null && t - this.since >= this.dwellAt(t) && this.speedAt(t) <= this.tune.slowPxPerMs && t >= this.yieldsAt(c)) {
      this.committedTarget = c;
      this.lostAt = -1;
      return c;
    }
    if (held !== null && t - this.lostAt >= this.tune.leaveGraceMs) {
      this.committedTarget = null;
      this.lostAt = -1;
      this.warmUntil = t + this.tune.warmWindowMs;
    }
    return this.committedTarget;
  }
}
