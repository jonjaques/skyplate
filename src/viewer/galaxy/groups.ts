/**
 * Groups on the plate: the directories a reader can hover and select at every level of the web,
 * from superclusters down to the smallest subgroup, and the geometry that outlines them.
 *
 * All of it is pure (plain arrays in, numbers and strings out) so it can be tested without a
 * WebGL context; the engine supplies projected star positions and the overlay draws the result.
 *
 *   envelopeHull        convex hull of a group's projected members, filtered and capped
 *   envelopePath        that hull padded and rounded (its Minkowski sum with a disc), as SVG
 *   hullContains        is a plate point inside the padded hull
 *   deepestGroup        the deepest directory whose envelope holds the pointer and is big enough
 *   walkUp              Escape's next level: symbol, its file, its directory, ..., nothing
 *   selectionTrail      the breadcrumb from the project down to the selection
 *   groupLabel          a group's name, with single-child chains spelled out
 */

import type { CodeSymbols, Report } from "../../shared/schema";
import type { Target } from "../state/store";

// ─── Hull ────────────────────────────────────────────────────────────────────────────────────

/**
 * At most this many points go into the hull sort. Most groups are smaller and are hulled
 * exactly; a supercluster of 20k files first drops every point inside the polygon of its
 * extremes (which cannot be on the hull), and only if more than this survive is the rest
 * sampled, the extremes always kept.
 */
export const HULL_CAP = 1500;
/** Directions probed for extreme points before filtering. */
const EXTREME_DIRS = 16;
/** Floats an envelopeHull output buffer needs: every vertex it can return, as x, y pairs. */
export const HULL_FLOATS = (HULL_CAP + EXTREME_DIRS + 1) * 2;
const DIR_X = Float64Array.from({ length: EXTREME_DIRS }, (_, k) => Math.cos((k / EXTREME_DIRS) * Math.PI * 2));
const DIR_Y = Float64Array.from({ length: EXTREME_DIRS }, (_, k) => Math.sin((k / EXTREME_DIRS) * Math.PI * 2));

/** Reusable buffers for envelopeHull, sized to the largest group seen so far. */
export class HullScratch {
  idx = new Int32Array(0);
  keep = new Int32Array(0);
  chain = new Int32Array(0);
  ext = new Int32Array(EXTREME_DIRS);
  poly = new Float32Array(EXTREME_DIRS * 2 + 2);
  ensure(n: number): void {
    if (this.idx.length >= n) return;
    const size = Math.max(n, this.idx.length * 2, 64);
    this.idx = new Int32Array(size);
    this.keep = new Int32Array(size);
    this.chain = new Int32Array(size + 1);
  }
}

const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

/** Does point a come before point b (by x, then y, then index)? */
function before(xs: ArrayLike<number>, ys: ArrayLike<number>, a: number, b: number): boolean {
  const ax = xs[a]!;
  const bx = xs[b]!;
  if (ax !== bx) return ax < bx;
  const ay = ys[a]!;
  const by = ys[b]!;
  return ay !== by ? ay < by : a < b;
}

/** Shell's gaps (Ciura's, extended): few enough passes for 1500 points, no recursion. */
const GAPS = [1750, 701, 301, 132, 57, 23, 10, 4, 1];

/**
 * Sort idx[0..m) by position, in place. A typed array's own sort with a comparator copied the
 * array and boxed a number per comparison: the envelope of a turning camera sorts up to 1500
 * points a frame, and that made 12 MB of garbage in 3 s (measured with a heap sampling profile).
 */
function sortByPosition(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: Int32Array, m: number): void {
  for (const gap of GAPS) {
    for (let i = gap; i < m; i++) {
      const v = idx[i]!;
      let j = i;
      while (j >= gap && before(xs, ys, v, idx[j - gap]!)) {
        idx[j] = idx[j - gap]!;
        j -= gap;
      }
      idx[j] = v;
    }
  }
}

/**
 * Monotone chain over the points listed in `idx[0..m)` (indices into xs/ys); writes the hull to
 * `out` as x, y pairs and returns its vertex count. The order has positive signed area: counter-
 * clockwise with y up, so on the y-down plate it runs clockwise, and the inside is where
 * cross(edge, point) > 0. Collinear points are dropped.
 */
function monotoneChain(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: Int32Array, m: number, chain: Int32Array, out: Float32Array): number {
  if (m === 0) return 0;
  sortByPosition(xs, ys, idx, m);
  const sorted = idx;
  let k = 0;
  for (let i = 0; i < m; i++) {
    const p = sorted[i]!;
    while (k >= 2 && cross(xs[chain[k - 2]!]!, ys[chain[k - 2]!]!, xs[chain[k - 1]!]!, ys[chain[k - 1]!]!, xs[p]!, ys[p]!) <= 0) k--;
    chain[k++] = p;
  }
  const lower = k + 1;
  for (let i = m - 2; i >= 0; i--) {
    const p = sorted[i]!;
    while (k >= lower && cross(xs[chain[k - 2]!]!, ys[chain[k - 2]!]!, xs[chain[k - 1]!]!, ys[chain[k - 1]!]!, xs[p]!, ys[p]!) <= 0) k--;
    chain[k++] = p;
  }
  // The last point repeats the first (except for a single point).
  const count = m === 1 ? 1 : k - 1;
  // Identical points collapse to one vertex: two stars drawn on the same pixel are one.
  let w = 0;
  for (let i = 0; i < count && w * 2 + 1 < out.length; i++) {
    const x = xs[chain[i]!]!;
    const y = ys[chain[i]!]!;
    if (w > 0 && out[(w - 1) * 2] === x && out[(w - 1) * 2 + 1] === y) continue;
    out[w * 2] = x;
    out[w * 2 + 1] = y;
    w++;
  }
  if (w > 1 && out[0] === out[(w - 1) * 2] && out[1] === out[(w - 1) * 2 + 1]) w--;
  return w;
}

/**
 * The convex hull of `n` plate points (xs, ys), written to `out` (x, y pairs, HULL_FLOATS long,
 * in monotoneChain's order); returns the vertex count. Exact up to
 * HULL_CAP points that could be on the hull; past that, a sample (see HULL_CAP).
 */
export function envelopeHull(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, out: Float32Array, scratch: HullScratch): number {
  if (n <= 0) return 0;
  scratch.ensure(n);
  const idx = scratch.idx;
  if (n <= HULL_CAP) {
    for (let i = 0; i < n; i++) idx[i] = i;
    return monotoneChain(xs, ys, idx, n, scratch.chain, out);
  }
  // Extremes in EXTREME_DIRS directions: their polygon is inside the hull, so a point strictly
  // inside it is not a hull vertex.
  const ext = scratch.ext;
  for (let k = 0; k < EXTREME_DIRS; k++) {
    let best = 0;
    let bestV = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const v = xs[i]! * DIR_X[k]! + ys[i]! * DIR_Y[k]!;
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    ext[k] = best;
  }
  for (let k = 0; k < EXTREME_DIRS; k++) idx[k] = ext[k]!;
  const poly = scratch.poly;
  const pm = monotoneChain(xs, ys, idx, EXTREME_DIRS, scratch.chain, poly);
  const keep = scratch.keep;
  let kept = 0;
  for (let i = 0; i < n; i++) {
    let inside = pm >= 3;
    for (let e = 0; inside && e < pm; e++) {
      const f = (e + 1) % pm;
      // Strictly inside means strictly left of every edge (see monotoneChain's orientation).
      // Points on an edge are kept: they may be hull vertices.
      if (cross(poly[e * 2]!, poly[e * 2 + 1]!, poly[f * 2]!, poly[f * 2 + 1]!, xs[i]!, ys[i]!) <= 0) inside = false;
    }
    if (!inside) keep[kept++] = i;
  }
  let m = kept;
  if (kept > HULL_CAP) {
    const stride = kept / HULL_CAP;
    m = 0;
    for (let j = 0; j < HULL_CAP; j++) idx[m++] = keep[Math.floor(j * stride)]!;
    for (let k = 0; k < EXTREME_DIRS; k++) idx[m++] = ext[k]!;
  } else {
    for (let j = 0; j < kept; j++) idx[j] = keep[j]!;
  }
  return monotoneChain(xs, ys, idx, m, scratch.chain, out);
}

/** Center and radius (half the larger side of its bounding box) of a hull. */
export function hullExtent(hull: ArrayLike<number>, count: number): { cx: number; cy: number; radius: number } {
  if (count === 0) return { cx: 0, cy: 0, radius: 0 };
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const x = hull[i * 2]!;
    const y = hull[i * 2 + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, radius: Math.max(x1 - x0, y1 - y0) / 2 };
}

/** Distance from (x, y) to the segment (ax, ay)–(bx, by). */
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Is (x, y) inside the hull (as envelopeHull orders it) padded by `pad` px? */
export function hullContains(hull: ArrayLike<number>, count: number, x: number, y: number, pad: number): boolean {
  if (count === 0) return false;
  if (count >= 3) {
    let inside = true;
    for (let e = 0; inside && e < count; e++) {
      const f = (e + 1) % count;
      if (cross(hull[e * 2]!, hull[e * 2 + 1]!, hull[f * 2]!, hull[f * 2 + 1]!, x, y) < 0) inside = false;
    }
    if (inside) return true;
  }
  if (count === 1) return Math.hypot(x - hull[0]!, y - hull[1]!) <= pad;
  for (let e = 0; e < count; e++) {
    const f = (e + 1) % count;
    if (segmentDistance(x, y, hull[e * 2]!, hull[e * 2 + 1]!, hull[f * 2]!, hull[f * 2 + 1]!) <= pad) return true;
  }
  return false;
}

/** Where traceEnvelope draws: a canvas 2D context fits it as is. */
export interface EnvelopeSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  /** An arc of radius r around (cx, cy) from angle a0 to a1, clockwise on the y-down plate. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number): void;
  closePath(): void;
}

/**
 * The hull padded by `pad` px with rounded corners: each edge pushed out along its normal,
 * joined by arcs of radius `pad` around the vertices. That is the hull's Minkowski sum with a
 * disc, so it is smooth (no corner pokes out where a lone outlier made a spike) and stays
 * exactly `pad` clear of every member. Drawn into a sink rather than built as a string, so the
 * overlay can trace it straight onto a canvas on every frame the camera turns without making
 * garbage.
 */
export function traceEnvelope(hull: ArrayLike<number>, count: number, pad: number, sink: EnvelopeSink): void {
  if (count === 0) return;
  if (count === 1) {
    sink.moveTo(hull[0]! + pad, hull[1]!);
    sink.arc(hull[0]!, hull[1]!, pad, 0, Math.PI * 2);
    sink.closePath();
    return;
  }
  // Outward normal of edge e (from vertex e to e + 1): the inside is on the edge's left in the
  // hull's orientation, so outward is (dy, -dx), normalized. The hull runs clockwise on the
  // y-down plate, and so does every corner arc, from one edge's normal to the next one's.
  for (let e = 0; e < count; e++) {
    const g = (e + 1) % count;
    const h = (e + 2) % count;
    let dx = hull[g * 2]! - hull[e * 2]!;
    let dy = hull[g * 2 + 1]! - hull[e * 2 + 1]!;
    // sqrt, not Math.hypot: hypot is a builtin call that boxes its result, every edge, every frame.
    let len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    if (e === 0) sink.moveTo(hull[0]! + nx * pad, hull[1]! + ny * pad);
    sink.lineTo(hull[g * 2]! + nx * pad, hull[g * 2 + 1]! + ny * pad);
    dx = hull[h * 2]! - hull[g * 2]!;
    dy = hull[h * 2 + 1]! - hull[g * 2 + 1]!;
    len = Math.sqrt(dx * dx + dy * dy) || 1;
    const a0 = Math.atan2(ny, nx);
    let a1 = Math.atan2(-dx / len, dy / len);
    if (a1 < a0) a1 += Math.PI * 2;
    sink.arc(hull[g * 2]!, hull[g * 2 + 1]!, pad, a0, a1);
  }
  sink.closePath();
}

/** The same outline as an SVG path string (tests, and anything that wants markup). */
export function envelopePath(hull: ArrayLike<number>, count: number, pad: number): string {
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = "";
  traceEnvelope(hull, count, pad, {
    moveTo: (x, y) => void (d += `M${f(x)} ${f(y)}`),
    lineTo: (x, y) => void (d += `L${f(x)} ${f(y)}`),
    arc: (cx, cy, r, a0, a1) => {
      // SVG cannot draw a full turn as one arc; two halves.
      const turns = a1 - a0 >= Math.PI * 2 - 1e-9 ? [a0 + Math.PI, a1] : [a1];
      let from = a0;
      for (const to of turns) {
        d += `A${f(r)} ${f(r)} 0 ${to - from > Math.PI ? 1 : 0} 1 ${f(cx + Math.cos(to) * r)} ${f(cy + Math.sin(to) * r)}`;
        from = to;
      }
    },
    closePath: () => void (d += "Z"),
  });
  return d;
}

// ─── Picking ─────────────────────────────────────────────────────────────────────────────────

/**
 * A group must look at least this big on the plate (hull radius, CSS px) to be pickable.
 * Smaller ones are a few stars apart at most, and the star under the pointer is the better
 * answer; zoomed out, this leaves the superclusters, and zooming in brings subgroups in.
 */
export const MIN_GROUP_PX = 24;
/** The committed group's envelope reaches this much further when picking (hysteresis). */
export const GROUP_STICKY_PX = 8;

/**
 * The deepest group under the pointer. Starting from `top`, at each level the children whose
 * `score` is finite (the pointer is inside their envelope and they are big enough; lower is a
 * better fit) compete, the best one wins, and the search descends into its children. A
 * directory's subtree sits inside its own neighborhood (the web's truth rule), so a child whose
 * envelope misses the pointer cannot have a descendant that holds it, and the descent prunes it.
 */
export function deepestGroup(top: ArrayLike<number>, children: (dir: number) => ArrayLike<number>, score: (dir: number) => number): number {
  let found = -1;
  let level: ArrayLike<number> = top;
  for (let depth = 0; depth < 512; depth++) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let k = 0; k < level.length; k++) {
      const d = level[k]!;
      const s = score(d);
      if (s < bestScore || (s === bestScore && s < Number.POSITIVE_INFINITY && d < best)) {
        bestScore = s;
        best = d;
      }
    }
    if (best < 0) break;
    found = best;
    level = children(best);
  }
  return found;
}

// ─── Levels ──────────────────────────────────────────────────────────────────────────────────

type Dirs = Report["dirs"];

/**
 * Does ancestor `a` hold exactly the files of its descendant `b`? Then `a`'s only content is the
 * branch down to `b`: an ancestor's total can only equal a descendant's when it has nothing else.
 */
function sameMembers(dirs: Dirs, a: number, b: number): boolean {
  return dirs[a]!.totalFiles === dirs[b]!.totalFiles;
}

/** The directory above `dir` that looks different on the plate, or 0 (the root). */
export function parentGroup(dirs: Dirs, dir: number): number {
  let p = dirs[dir]?.parent ?? 0;
  // A parent whose only content is this child has the same members, the same envelope and the
  // same lit stars; stepping onto it would look like Escape did nothing.
  while (p > 0 && sameMembers(dirs, p, dir)) p = dirs[p]!.parent;
  return Math.max(0, p);
}

/**
 * Escape's next level up from a selection: a symbol goes to its file, a file to its directory,
 * a directory to the nearest ancestor that looks different, a top-level directory (or a root
 * file, or an author) to nothing.
 */
export function walkUp(report: Report, symbols: CodeSymbols | null, selection: Target | null): Target | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "symbol": {
      const file = symbols?.symbols.file[selection.id];
      return file === undefined ? null : { kind: "file", id: file };
    }
    case "file": {
      const dir = report.files[selection.id]?.dir ?? 0;
      return dir > 0 ? { kind: "dir", id: dir } : null;
    }
    case "dir": {
      const up = parentGroup(report.dirs, selection.id);
      return up > 0 ? { kind: "dir", id: up } : null;
    }
    case "author":
      return null;
  }
}

/** One step of the breadcrumb. A null target is the project itself (nothing selected). */
export interface Crumb {
  target: Target | null;
  label: string;
  /** Mono for path segments and symbols; the project name is set in the UI face. */
  mono: boolean;
}

/** project › packages › universe › src › file.ts › symbol, for the current selection. */
export function selectionTrail(report: Report, symbols: CodeSymbols | null, selection: Target | null): Crumb[] {
  if (!selection || selection.kind === "author") return [];
  const out: Crumb[] = [{ target: null, label: report.project.name, mono: false }];
  let file = -1;
  let dir = -1;
  if (selection.kind === "symbol") file = symbols?.symbols.file[selection.id] ?? -1;
  else if (selection.kind === "file") file = selection.id;
  else dir = selection.id;
  if (file >= 0) dir = report.files[file]?.dir ?? 0;
  const chain: number[] = [];
  for (let d = dir; d > 0; d = report.dirs[d]!.parent) chain.push(d);
  chain.reverse();
  for (const d of chain) out.push({ target: { kind: "dir", id: d }, label: report.dirs[d]!.name, mono: true });
  if (file >= 0) out.push({ target: { kind: "file", id: file }, label: report.files[file]!.name, mono: true });
  if (selection.kind === "symbol" && symbols) out.push({ target: selection, label: symbols.symbols.name[selection.id] ?? "", mono: true });
  return out;
}

/**
 * A group's name on the plate. A directory that is its parent's only content shares the
 * parent's envelope, and picking resolves to the deeper one; its tag spells out the chain
 * ("universe/src") so the reader still sees which package it is.
 */
export function groupLabel(dirs: Dirs, dir: number): string {
  let name = dirs[dir]!.name;
  let d = dir;
  let p = dirs[d]!.parent;
  while (p > 0 && sameMembers(dirs, p, d)) {
    name = `${dirs[p]!.name}/${name}`;
    d = p;
    p = dirs[p]!.parent;
  }
  return name;
}
