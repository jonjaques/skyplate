/**
 * The cosmic web: where every file sits in the default galaxy, for one choice of "gravity".
 *
 *   computeWeb(input, gravity) → Web      pure and deterministic; no DOM, no three.js
 *
 * Both sides run it. The viewer computes a web when a report opens and again for each gravity
 * the reader picks (it never ships in the report, so a gravity switch costs no download); the
 * analyzer computes the default one to anchor the import-graph layout, so the Web ↔ Imports
 * morph keeps each region on its side.
 *
 * ── Structure: large-scale structure read off the directory tree ──
 *
 *   supercluster   a top-level directory (and the root's own files, at the heart)
 *   cluster        its children
 *   group          their children, and so on down
 *   galaxy         one directory's own files: a clump, its children orbiting it as satellites
 *   star           a file
 *
 * Every directory's files therefore fill one contiguous neighborhood, and nested directories
 * nest in space. The spiral this replaced bent the tree into arms; it was truthful, but the
 * arms were decor (a disc has no depth, and an arm's curve said nothing about the code). A web
 * puts the distance between two things to work: siblings that import each other sit together,
 * and import coupling between clusters is drawn as the filaments.
 *
 * Placement runs in two passes.
 *
 *   Bottom-up (sizes). Each directory arranges its own clump and its children's spheres with a
 *   small 3D relaxation (relax below): collision by radius plus a gap, springs between siblings
 *   that import each other, and the gravity pull toward the parent's center. Its subtree's
 *   bounding sphere is then measured, not guessed. Top-down sizing was tried on paper first: a
 *   sphere estimated from its children's volumes needs a packing slack, and the slack compounds
 *   per level, so a 30-deep chain came out 1.3^30 times too big.
 *
 *   Top-down (orientation). Each directory's arrangement is then turned, rigidly, so the
 *   children coupled to code outside it face that code (a package that leans on apps/game sits
 *   on the side of packages facing apps). A rotation rather than a force: it cannot change the
 *   extents the first pass measured, so no subtree can be pushed into a neighbor's space.
 *
 * Inside a clump, files follow a Plummer profile on a slightly ellipsoidal, seeded axis frame:
 * a dense core and a sparse halo, the heaviest files at the core.
 *
 * ── Gravity ──
 *
 * The reader chooses what has mass (Gravity). A file's mass is its quantile rank among files
 * with a nonzero value of that measure, so one 9,000-commit file cannot flatten everyone else;
 * zero or missing is massless. Mass does three things, none of which moves a file out of its
 * directory's neighborhood (the truth rule):
 *   (a) inside every clump the heaviest files sink to the core and light ones form the halo;
 *   (b) at every level, a sibling's pull toward its parent's center grows with its summed mass
 *       share, so the heaviest supercluster drifts to the heart of the web;
 *   (c) heavy clumps are denser, light ones more diffuse.
 * Seed directions never depend on mass, so switching gravity moves things mostly inward and
 * outward along their own bearing, which is what makes the morph legible.
 *
 * ── Filaments and bridge files ──
 *
 * Clusters (depth-2 directories, a depth-1 directory with no subdirectories, plus the root's
 * own files and each supercluster's own files) are the web's nodes; code edges between their
 * files are its coupling. The skeleton is the maximum spanning forest on coupling plus each
 * node's strongest one or two further links above a floor; a cluster nothing imports and that
 * imports nothing floats alone in a void, as it should. A file whose edges mostly cross along
 * one filament (a bridge file) leans out along it, at most LEAN_MAX of the way and never more
 * than LEAN_REACH radii of its own directory, so the strands leave their clusters through real
 * stars and the web shows where code actually crosses. That lean is the one exception to the
 * truth rule, and it is bounded in absolute terms, not only as a share of the strand.
 *
 * ── Shapes that would break it, handled on purpose ──
 *
 *   - A huge flat directory (thousands of files side by side) is split into knots of
 *     KNOT_SIZE files in name order, strung on springs to their name neighbors, so it reads as
 *     a curled strand of knots rather than one featureless ball.
 *   - A directory with no files of its own and a single child adds no level of structure
 *     (src/main/java/com/…): the child sits at its center, so wrapper chains cost no space.
 *   - A deep chain of small directories steps off in a seeded direction at every level, so 30
 *     levels coil like a random walk rather than running out as a needle.
 *   - A directory with thousands of children (DefinitelyTyped's types/) relaxes them on a
 *     hierarchical collision grid, linear in the siblings; the pairwise sweep it outgrew froze
 *     the main thread for 2.7 s at 20,000 of them.
 *
 * Deterministic: seeds are a fixed-seed PRNG hashed from directory ids, every aggregation is a
 * sort with id tie-breaks, relaxations run fixed tick counts, so the same report and gravity
 * give identical positions on every run, and in every JavaScript engine: the trigonometry, roots
 * and lengths go through dmath.ts and plain arithmetic, never Math.sin, cbrt, pow or hypot,
 * which engines are allowed to round differently (V8 and JSC disagreed on all of them, and the
 * relaxation grew one bit into 2% of the radius). Checked by hashing the output under node and Bun.
 */

import { dcbrt, dcos, droot, dsin, datan2 } from "./dmath";
import type { Report } from "./schema";

// ─── Gravity ─────────────────────────────────────────────────────────────────────────────────

/** What has mass in the web. */
export type Gravity = "dependencies" | "complexity" | "hotspots" | "churn" | "recent" | "size";

export const GRAVITIES: readonly Gravity[] = ["dependencies", "complexity", "hotspots", "churn", "recent", "size"];
export const DEFAULT_GRAVITY: Gravity = "dependencies";
/** Modes that read git history; a report without it cannot weigh by them. */
export const GRAVITY_NEEDS_GIT: ReadonlySet<Gravity> = new Set<Gravity>(["hotspots", "churn", "recent"]);

/** Per-file measures gravity reads. A missing array weighs every file at zero. */
export interface WebMetrics {
  /** Direct importers (FileRecord.fanIn). */
  fanIn: ArrayLike<number>;
  /** PageRank, max 1 (FileRecord.rank): breaks ties between files with equal importers. */
  rank: ArrayLike<number>;
  complexity?: ArrayLike<number>;
  /** FileRecord.hotspot: normalized churn × complexity. */
  hotspot?: ArrayLike<number>;
  /** FileGit.commits, 0 when the file has no history. */
  commits?: ArrayLike<number>;
  /** FileGit.modified (unix seconds), 0 when the file has no history. */
  modified?: ArrayLike<number>;
  /** Code lines (FileRecord.code). */
  code?: ArrayLike<number>;
}

export interface WebInput {
  fileCount: number;
  /** Directory id per file. */
  fileDir: ArrayLike<number>;
  /** Directory tree: parent (-1 for the root, which is id 0), direct child dirs and files. */
  dirParent: ArrayLike<number>;
  dirDirs: readonly (readonly number[])[];
  dirFiles: readonly (readonly number[])[];
  /** Distinct, non-self code edges (doc links excluded), importer → imported. */
  from: ArrayLike<number>;
  to: ArrayLike<number>;
  metrics: WebMetrics;
}

/**
 * Each file's mass under `gravity`: its quantile rank (0-1] among files with a nonzero value,
 * ties sharing a rank; 0 for zero or missing. Quantiles, not raw values, because every one of
 * these measures is heavy-tailed: by raw commits one lockfile would hold all the mass.
 */
export function gravityMass(metrics: WebMetrics, gravity: Gravity, n: number): Float32Array {
  const value = new Float64Array(n);
  const pick = (a: ArrayLike<number> | undefined) => {
    if (a) for (let i = 0; i < n; i++) value[i] = Math.max(0, a[i] ?? 0);
  };
  switch (gravity) {
    case "dependencies": {
      // Direct importers, the holotype rule's measure; PageRank (≤ 1) only orders files with
      // the same importer count, and a file nothing imports stays massless whatever its rank.
      for (let i = 0; i < n; i++) {
        const fan = metrics.fanIn[i] ?? 0;
        value[i] = fan > 0 ? fan + 0.5 * Math.min(1, Math.max(0, metrics.rank[i] ?? 0)) : 0;
      }
      break;
    }
    case "complexity":
      pick(metrics.complexity);
      break;
    case "hotspots":
      pick(metrics.hotspot);
      break;
    case "churn":
      pick(metrics.commits);
      break;
    case "recent":
      // Later modification time is heavier: the quantile of the timestamp is exactly "how
      // recently, relative to the rest".
      pick(metrics.modified);
      break;
    case "size":
      pick(metrics.code);
      break;
  }
  return quantileMass(value);
}

/** Quantile rank among nonzero values, ties averaged, in (0, 1]; zeros stay 0. */
function quantileMass(value: Float64Array): Float32Array {
  const n = value.length;
  const out = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (value[i]! > 0) count++;
  if (count === 0) return out;
  const sorted = new Float64Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) if (value[i]! > 0) sorted[k++] = value[i]!;
  sorted.sort();
  for (let i = 0; i < n; i++) {
    const v = value[i]!;
    if (v <= 0) continue;
    const lo = lowerBound(sorted, v);
    const hi = upperBound(sorted, v);
    out[i] = ((lo + hi - 1) / 2 + 1) / count;
  }
  return out;
}

function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ─── Output ──────────────────────────────────────────────────────────────────────────────────

export interface WebClusters {
  /** The directory each cluster is. */
  dir: Int32Array;
  /**
   * 1 when the cluster is only that directory's own files (the root's, or a supercluster's own
   * files beside its subdirectories); 0 when it is the directory's whole subtree.
   */
  own: Uint8Array;
  /** Centroid of its files before bridge files lean, stride 3. */
  center: Float32Array;
}

export interface WebFilaments {
  /** Cluster indices at each end, a < b. */
  a: Int32Array;
  b: Int32Array;
  /** File → file code edges between the two clusters, both directions. */
  coupling: Int32Array;
  /** log(1 + coupling) / log(1 + strongest coupling), in (0, 1]. */
  weight: Float32Array;
  /**
   * Quadratic Bézier per filament, stride 9: p0 (cluster a's end), control, p2 (cluster b's end).
   * Each end is the centroid of the files on that side that carry the strand's edges, not of the
   * whole cluster: a cluster with groups of its own has its centroid in the void between them,
   * and vite's strands into packages/vite all converged on empty space.
   */
  curve: Float32Array;
}

export interface Web {
  gravity: Gravity;
  /** [x, y, z] per file, stride 3. */
  positions: Float32Array;
  /** Per directory: center of its subtree's sphere, stride 3, and a radius that contains every file beneath it. */
  dirCenter: Float32Array;
  dirRadius: Float32Array;
  clusters: WebClusters;
  /** Cluster index per file. */
  fileCluster: Int32Array;
  filaments: WebFilaments;
  /** How far each file leans along its filament, as a share of the filament's length (0 = not a bridge file). */
  lean: Float32Array;
  /** Per-file mass under this gravity (gravityMass). */
  mass: Float32Array;
  /** Largest distance of any file from the origin (the web's center). */
  radius: number;
}

// ─── Tuning ──────────────────────────────────────────────────────────────────────────────────

/** Clump radius per cube root of its file count, in world units (a 1,000-file clump is ~70 across). */
const CLUMP_UNIT = 3.4;
/**
 * Plummer profile: the clump spans enclosed-mass fractions Q0…QMAX. QMAX < 1 because the profile
 * has no edge. At 0.9 the half-mass radius was a third of the extent, and the additive halos of
 * the crowded core summed to a white blob with no visible halo around it; at 0.82 the core still
 * reads as the brightest part, and the halo as stars.
 */
const Q0 = 0.02;
const QMAX = 0.82;
/**
 * Typical distance between neighboring files inside a clump, in world units. A clump's radius
 * grows with the cube root of its file count, so its density, and this spacing, is the same at
 * every size (measured: median nearest neighbor 3.2 on inertialref at CLUMP_UNIT 3.4). The viewer
 * sizes stars from it rather than from the web's radius: a web is mostly void, so a star sized
 * as a share of the radius came out twice as wide as the gap to its neighbor, and every clump
 * summed to one white blob.
 */
export const STAR_SPACING = CLUMP_UNIT * 0.95;
/** Radial jitter, so shells of equal-mass files do not read as rings. */
const R_JITTER = 0.18;
/** Clump density by mean mass: the heaviest clumps shrink to DENSE_HEAVY of their size, the lightest grow to DENSE_LIGHT. */
const DENSE_HEAVY = 0.74;
const DENSE_LIGHT = 1.3;
/** Space a file's own glow needs at a clump's rim, so neighbors' halos do not merge. */
const FILE_PAD = 1.2;

/** Own files past which a directory is split into knots (see the header). */
const FLAT_SPLIT = 600;
const KNOT_SIZE = 220;

/**
 * Gap between sibling spheres, as a share of their mean radius, by the parent's depth: wide
 * voids between superclusters, groups packed closer, galaxies within a group nearly touching.
 * That gradient is what makes the hierarchy readable as large-scale structure at a glance.
 */
const GAP_K = [0.5, 0.36, 0.26, 0.18, 0.13];
const GAP_MIN = 2;
/** Pull toward the parent's center: a floor every sibling feels, plus the mass-share term (gravity b). */
const PULL_BASE = 0.02;
const PULL_MASS = 0.2;
/** Spring strength between siblings that import each other, at the strongest coupling. */
const COUPLE_K = 0.06;
/** Spring between a huge directory's knots and their name neighbors (see FLAT_SPLIT). */
const KNOT_CHAIN = 0.05;
/** Fraction of an overlap resolved per collision pass. */
const COLLIDE = 0.7;
/** Pure-collision passes after the relaxation, so no two siblings are left overlapping. */
const SETTLE_PASSES = 24;

/** Rigid turn toward coupled code elsewhere: the share of the full alignment applied, and the deepest level it runs at. */
const EXT_PULL = 0.65;
const EXT_MAX_DEPTH = 4;
const ROT_ITERS = 5;

/** Filaments: further links per node beyond the spanning forest, and the floors they must clear. */
const EXTRA_LINKS = 2;
const EXTRA_MIN = 3;
const EXTRA_REL = 0.2;
/** How far a filament bows off its chord, as a share of its length. */
const BOW = 0.16;

/** Bridge files: the largest lean (share of the filament), the cross share where leaning starts, the edges it needs. */
const LEAN_MAX = 0.36;
const LEAN_SHARE = 0.5;
const LEAN_MIN_EDGES = 2;
/**
 * And the lean's absolute reach, in radii of the file's own directory (its subtree's sphere, never
 * less than LEAN_FLOOR). A share of the strand alone has no bound on a long strand: on vite, eight
 * playground/legacy configs leaned 300 units (about 95 star spacings) into the void toward the
 * root files, and the directory grew to 8.6 times its own size, so selecting it framed a sliver
 * across the whole plate. Bounding by the cluster's radius instead still let a two-file test
 * directory inside playground/css lean 90 units out, 19 times its size. Capped by its own
 * directory, a bridge file streams off that directory's rim along the strand and stays visibly
 * part of it, and every group's outline stays within a few times its members' own spread.
 */
const LEAN_REACH = 1.5;
/** The smallest reach a bridge file gets (world units, about three star spacings), so a one- or two-file directory's bridge still visibly leans. */
const LEAN_FLOOR = 10;

// ─── Small math ──────────────────────────────────────────────────────────────────────────────

/** mulberry32: tiny, fast, and the same sequence on every platform. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A well-mixed 32-bit seed from a few integers. */
function hash(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x & 0xffff), 0x01000193);
    h = Math.imul(h ^ (x >>> 16), 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Uniform random rotation (Shoemake) as a row-major 3×3 matrix, from three uniforms. */
function randomRotation(u1: number, u2: number, u3: number, out: Float64Array, o = 0): void {
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  const x = s1 * dsin(2 * Math.PI * u2);
  const y = s1 * dcos(2 * Math.PI * u2);
  const z = s2 * dsin(2 * Math.PI * u3);
  const w = s2 * dcos(2 * Math.PI * u3);
  quatToMatrix(x, y, z, w, out, o);
}

function quatToMatrix(x: number, y: number, z: number, w: number, out: Float64Array, o = 0): void {
  out[o] = 1 - 2 * (y * y + z * z);
  out[o + 1] = 2 * (x * y - z * w);
  out[o + 2] = 2 * (x * z + y * w);
  out[o + 3] = 2 * (x * y + z * w);
  out[o + 4] = 1 - 2 * (x * x + z * z);
  out[o + 5] = 2 * (y * z - x * w);
  out[o + 6] = 2 * (x * z - y * w);
  out[o + 7] = 2 * (y * z + x * w);
  out[o + 8] = 1 - 2 * (x * x + y * y);
}

/** c = a × b for row-major 3×3 matrices stored at offsets. */
function matMul(a: Float64Array, ao: number, b: Float64Array, bo: number, c: Float64Array, co: number): void {
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) {
      c[co + r * 3 + k] = a[ao + r * 3]! * b[bo + k]! + a[ao + r * 3 + 1]! * b[bo + 3 + k]! + a[ao + r * 3 + 2]! * b[bo + 6 + k]!;
    }
  }
}

/** The R2 low-discrepancy sequence (generalized golden ratio): even coverage, uncorrelated with index order. */
const R2A = 0.7548776662466927;
const R2B = 0.5698402909980532;

/**
 * Length of a 2D or 3D vector. Math.hypot is one of the builtins the spec lets each engine
 * approximate in its own way, and inside the relaxation a last-bit difference grows: the same
 * report laid out in node (V8) and Bun (JSC) differed by up to 2% of the web's radius for some
 * gravities (measured). A square root of a sum of squares is correctly rounded everywhere.
 */
function len3(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}

// ─── computeWeb ──────────────────────────────────────────────────────────────────────────────

export function computeWeb(input: WebInput, gravity: Gravity = DEFAULT_GRAVITY): Web {
  const n = input.fileCount;
  const D = input.dirParent.length;
  const mass = gravityMass(input.metrics, gravity, n);
  const positions = new Float32Array(n * 3);
  const dirCenter = new Float32Array(D * 3);
  const dirRadius = new Float32Array(D);
  const emptyFilaments: WebFilaments = {
    a: new Int32Array(0),
    b: new Int32Array(0),
    coupling: new Int32Array(0),
    weight: new Float32Array(0),
    curve: new Float32Array(0),
  };
  if (n === 0 || D === 0) {
    return {
      gravity,
      positions,
      dirCenter,
      dirRadius,
      clusters: { dir: new Int32Array(0), own: new Uint8Array(0), center: new Float32Array(0) },
      fileCluster: new Int32Array(n),
      filaments: emptyFilaments,
      lean: new Float32Array(n),
      mass,
      radius: 0,
    };
  }

  // ── Tree measures ──
  const depth = new Int32Array(D);
  const preorder = new Int32Array(D);
  let pc = 0;
  {
    const stack = [0];
    while (stack.length > 0) {
      const d = stack.pop()!;
      preorder[pc++] = d;
      const kids = input.dirDirs[d]!;
      for (let i = kids.length - 1; i >= 0; i--) {
        depth[kids[i]!] = depth[d]! + 1;
        stack.push(kids[i]!);
      }
    }
  }
  const total = new Int32Array(D);
  const massSum = new Float64Array(D);
  for (let f = 0; f < n; f++) massSum[input.fileDir[f]!] = massSum[input.fileDir[f]!]! + mass[f]!;
  for (let d = 0; d < D; d++) total[d] = input.dirFiles[d]!.length;
  for (let i = pc - 1; i > 0; i--) {
    const d = preorder[i]!;
    const p = input.dirParent[d]!;
    total[p] = total[p]! + total[d]!;
    massSum[p] = massSum[p]! + massSum[d]!;
  }
  // Children that hold files, in the tree's own (path) order.
  const kids: number[][] = new Array(D);
  for (let d = 0; d < D; d++) kids[d] = input.dirDirs[d]!.filter((c) => total[c]! > 0);
  // Levels: every directory of depth k before any of depth k + 1, preorder within a level.
  let maxDepth = 0;
  for (let i = 0; i < pc; i++) maxDepth = Math.max(maxDepth, depth[preorder[i]!]!);
  const levelOrder = new Int32Array(pc);
  {
    const counts = new Int32Array(maxDepth + 2);
    for (let i = 0; i < pc; i++) counts[depth[preorder[i]!]! + 1]!++;
    for (let k = 0; k <= maxDepth; k++) counts[k + 1]! += counts[k]!;
    for (let i = 0; i < pc; i++) levelOrder[counts[depth[preorder[i]!]!]!++] = preorder[i]!;
  }

  // ── Units: each directory's own files as one clump, or as knots when it is huge and flat ──
  const unitDirList: number[] = [];
  const unitKnot: number[] = []; //   knot index within its directory, -1 for a core
  const dirUnitStart = new Int32Array(D + 1);
  const unitOfFile = new Int32Array(n);
  for (let d = 0; d < D; d++) {
    dirUnitStart[d] = unitDirList.length;
    const own = input.dirFiles[d]!;
    if (own.length === 0) continue;
    if (own.length <= FLAT_SPLIT) {
      const u = unitDirList.length;
      unitDirList.push(d);
      unitKnot.push(-1);
      for (const f of own) unitOfFile[f] = u;
    } else {
      // Name order: file ids follow the walker's path sort, so a knot is a run of neighbors by
      // name (fixtures-a…, fixtures-b…), which is something a reader can recognize.
      const sorted = Int32Array.from(own).sort();
      const k = Math.ceil(sorted.length / KNOT_SIZE);
      for (let j = 0; j < k; j++) {
        const u = unitDirList.length;
        unitDirList.push(d);
        unitKnot.push(j);
        const a = Math.floor((j * sorted.length) / k);
        const b = Math.floor(((j + 1) * sorted.length) / k);
        for (let i = a; i < b; i++) unitOfFile[sorted[i]!] = u;
      }
    }
  }
  dirUnitStart[D] = unitDirList.length;
  const U = unitDirList.length;
  const unitDir = Int32Array.from(unitDirList);
  /** Node ids: a directory's id, or D + unit. */
  const NODE = D + U;

  // Files grouped by unit, heaviest first, ids breaking ties: one sort of composite keys.
  const massLevel = new Float64Array(n);
  for (let f = 0; f < n; f++) massLevel[f] = Math.round(mass[f]! * 2 * n);
  const unitFiles = new Int32Array(n);
  const unitFileStart = new Int32Array(U + 1);
  {
    const span = (2 * n + 1) * n;
    const keys = new Float64Array(n);
    for (let f = 0; f < n; f++) keys[f] = unitOfFile[f]! * span + (2 * n - massLevel[f]!) * n + f;
    keys.sort();
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      const f = key % n;
      unitFiles[i] = f;
      unitFileStart[unitOfFile[f]! + 1]!++;
    }
    for (let u = 0; u < U; u++) unitFileStart[u + 1]! += unitFileStart[u]!;
  }

  // ── Coupling: code edges aggregated by unit pair, then attributed to the level they cross at ──
  const E = Math.min(input.from.length, input.to.length);
  const pairU: number[] = [];
  const pairV: number[] = [];
  const pairW: number[] = [];
  {
    const keys = new Float64Array(E);
    let m = 0;
    for (let e = 0; e < E; e++) {
      const a = unitOfFile[input.from[e]!]!;
      const b = unitOfFile[input.to[e]!]!;
      if (a === b) continue;
      keys[m++] = a < b ? a * U + b : b * U + a;
    }
    const used = keys.subarray(0, m).sort();
    for (let i = 0; i < m; ) {
      let j = i;
      while (j < m && used[j] === used[i]) j++;
      const key = used[i]!;
      const a = Math.floor(key / U);
      pairU.push(a);
      pairV.push(key - a * U);
      pairW.push(j - i);
      i = j;
    }
  }
  // Sibling springs, grouped by the directory whose children they join.
  const sibL: number[] = [];
  const sibA: number[] = [];
  const sibB: number[] = [];
  const sibW: number[] = [];
  // Pulls toward coupled code outside a directory, for the top-down turn.
  const extD: number[] = [];
  const extItem: number[] = [];
  const extT: number[] = [];
  const extW: number[] = [];
  {
    const chainU: number[] = [];
    const chainV: number[] = [];
    const ancestry = (d: number, out: number[]) => {
      out.length = depth[d]! + 1;
      for (let x = d; x >= 0; x = input.dirParent[x]!) out[depth[x]!] = x;
    };
    for (let p = 0; p < pairU.length; p++) {
      const u = pairU[p]!;
      const v = pairV[p]!;
      const w = pairW[p]!;
      const du = unitDir[u]!;
      const dv = unitDir[v]!;
      ancestry(du, chainU);
      ancestry(dv, chainV);
      let l = 0;
      const lim = Math.min(chainU.length, chainV.length);
      while (l + 1 < lim && chainU[l + 1] === chainV[l + 1]) l++;
      const L = chainU[l]!;
      const nodeOf = (chain: number[], d: number, unit: number) => (d === L ? D + unit : chain[l + 1]!);
      sibL.push(L);
      sibA.push(nodeOf(chainU, du, u));
      sibB.push(nodeOf(chainV, dv, v));
      sibW.push(w);
      // Each side: every directory strictly below L on its branch turns toward the other side.
      const side = (chain: number[], dSelf: number, unit: number, other: number[], dOther: number) => {
        if (dOther === L) return; // the other end is an ancestor's own files: that is gravity's job
        for (let k = l + 1; k < chain.length; k++) {
          const d = chain[k]!;
          if (depth[d]! > EXT_MAX_DEPTH) break;
          const item = d === dSelf ? D + unit : chain[k + 1]!;
          const t = other[Math.min(other.length - 1, k)]!;
          extD.push(d);
          extItem.push(item);
          extT.push(t);
          extW.push(w);
        }
      };
      side(chainU, du, u, chainV, dv);
      side(chainV, dv, v, chainU, du);
    }
  }
  const sibIndex = csr(D, sibL);
  const extIndex = csr(D, extD);

  // ── Clumps: each unit's files on a Plummer profile ──
  const local = new Float64Array(n * 3); // file offset from its unit's center, in its directory's frame
  const unitRadius = new Float64Array(U);
  const unitMass = new Float64Array(U);
  {
    const rot = new Float64Array(9);
    for (let u = 0; u < U; u++) {
      const s = unitFileStart[u]!;
      const e = unitFileStart[u + 1]!;
      const count = e - s;
      let mSum = 0;
      for (let i = s; i < e; i++) mSum += mass[unitFiles[i]!]!;
      unitMass[u] = mSum;
      const rand = prng(hash(unitDir[u]!, unitKnot[u]! + 7, 0x5eed));
      if (count === 1) {
        unitRadius[u] = FILE_PAD * 2;
        continue;
      }
      const dense = DENSE_LIGHT - (DENSE_LIGHT - DENSE_HEAVY) * (mSum / count);
      const extent = CLUMP_UNIT * dcbrt(count) * dense;
      const a = extent / plummer(QMAX);
      // Seeded axis ratios and orientation, volume-preserving, so no two clumps read as the
      // same ball.
      const ay = 0.72 + 0.23 * rand();
      const az = 0.55 + 0.3 * rand();
      const norm = 1 / dcbrt(ay * az);
      randomRotation(rand(), rand(), rand(), rot);
      const phase = rand();
      let max = 0;
      for (let i = s; i < e; i++) {
        const k = i - s;
        const q = Q0 + ((QMAX - Q0) * (k + 0.5)) / count;
        const r = a * plummer(q) * (1 + R_JITTER * (rand() - 0.5));
        const uu = (0.5 + phase + k * R2A) % 1;
        const vv = (0.5 + k * R2B) % 1;
        const z = 1 - 2 * uu;
        const rho = Math.sqrt(Math.max(0, 1 - z * z));
        const phi = 2 * Math.PI * vv;
        const x = r * rho * dcos(phi) * norm;
        const y = r * rho * dsin(phi) * ay * norm;
        const zz = r * z * az * norm;
        const f = unitFiles[i]!;
        const lx = rot[0]! * x + rot[1]! * y + rot[2]! * zz;
        const ly = rot[3]! * x + rot[4]! * y + rot[5]! * zz;
        const lz = rot[6]! * x + rot[7]! * y + rot[8]! * zz;
        local[f * 3] = lx;
        local[f * 3 + 1] = ly;
        local[f * 3 + 2] = lz;
        max = Math.max(max, len3(lx, ly, lz));
      }
      unitRadius[u] = max + FILE_PAD;
    }
  }

  // ── Bottom-up: arrange each directory's units and children, measure its sphere ──
  const nodePos = new Float64Array(NODE * 3); //  a node's sphere center in its parent directory's frame
  const sphereC = new Float64Array(D * 3); //    a directory's subtree sphere, in its own frame
  const sphereR = new Float64Array(D);
  const localIndex = new Int32Array(NODE).fill(-1);
  const relaxer = new Relaxer();
  for (let i = pc - 1; i >= 0; i--) {
    const d = preorder[i]!;
    if (total[d] === 0) continue;
    const ids: number[] = [];
    for (let u = dirUnitStart[d]!; u < dirUnitStart[d + 1]!; u++) ids.push(D + u);
    for (const c of kids[d]!) ids.push(c);
    const m = ids.length;
    const radius = (id: number) => (id >= D ? unitRadius[id - D]! : sphereR[id]!);
    const files = (id: number) => (id >= D ? unitFileStart[id - D + 1]! - unitFileStart[id - D]! : total[id]!);
    const nodeMass = (id: number) => (id >= D ? unitMass[id - D]! : massSum[id]!);
    const isCore = (id: number) => id >= D && unitKnot[id - D] === -1;
    if (m === 1) {
      nodePos[ids[0]! * 3] = nodePos[ids[0]! * 3 + 1] = nodePos[ids[0]! * 3 + 2] = 0;
    } else {
      relaxer.reset(m);
      let maxMass = 0;
      for (const id of ids) maxMass = Math.max(maxMass, nodeMass(id));
      ids.forEach((id, k) => {
        localIndex[id] = k;
        relaxer.add(k, radius(id), maxMass > 0 ? nodeMass(id) / maxMass : 0, files(id), id, isCore(id));
      });
      // One spring per sibling pair, carrying the pair's summed coupling. Many unit pairs map
      // to the same two siblings (every file pair between two subtrees does), and adding a
      // spring for each stacked hundreds of them into a stiffness the integration could not
      // hold: positions ran off to 1e46 within twenty ticks.
      const pairSum = new Map<number, number>();
      for (let s = sibIndex.start[d]!; s < sibIndex.start[d + 1]!; s++) {
        const p = sibIndex.items[s]!;
        const a = localIndex[sibA[p]!]!;
        const b = localIndex[sibB[p]!]!;
        if (a < 0 || b < 0 || a === b) continue;
        const key = a < b ? a * m + b : b * m + a;
        pairSum.set(key, (pairSum.get(key) ?? 0) + sibW[p]!);
      }
      for (const key of [...pairSum.keys()].sort((x, y) => x - y)) relaxer.couple(Math.floor(key / m), key % m, pairSum.get(key)!);
      // A huge directory's knots hang on their name neighbors (see FLAT_SPLIT).
      for (let u = dirUnitStart[d]! + 1; u < dirUnitStart[d + 1]!; u++) if (unitKnot[u]! > 0) relaxer.chain(localIndex[D + u - 1]!, localIndex[D + u]!);
      relaxer.run(GAP_K[Math.min(depth[d]!, GAP_K.length - 1)]!, hash(d, 0x0b5e));
      ids.forEach((id, k) => {
        nodePos[id * 3] = relaxer.x[k * 3]!;
        nodePos[id * 3 + 1] = relaxer.x[k * 3 + 1]!;
        nodePos[id * 3 + 2] = relaxer.x[k * 3 + 2]!;
        localIndex[id] = -1;
      });
    }
    enclose(ids, nodePos, radius, sphereC, d, sphereR);
  }

  // ── Top-down: turn each arrangement toward its outside coupling, compose the transforms ──
  const P = new Float64Array(D * 3); // a directory's sphere center, absolute
  const Q = new Float64Array(D * 9); // its frame's rotation, absolute (row-major)
  const g = new Float64Array(NODE * 3); // desired bearings, scratch, by node id
  const q = new Float64Array(9);
  Q[0] = Q[4] = Q[8] = 1;
  // P is known once a directory's parent has been processed; level order guarantees that for
  // every directory at or above the one being turned.
  const known = new Uint8Array(D);
  known[0] = 1;
  const marked = new Uint8Array(NODE);
  for (let i = 0; i < pc; i++) {
    const d = levelOrder[i]!;
    if (total[d] === 0) continue;
    const oX = sphereC[d * 3]!;
    const oY = sphereC[d * 3 + 1]!;
    const oZ = sphereC[d * 3 + 2]!;
    if (d !== 0) {
      const par = input.dirParent[d]!;
      // q = turn toward coupled code outside, in the parent's frame: Q_d = Q_parent · q.
      q.fill(0);
      q[0] = q[4] = q[8] = 1;
      const s0 = extIndex.start[d]!;
      const s1 = extIndex.start[d + 1]!;
      if (s1 > s0) {
        const touched: number[] = [];
        for (let s = s0; s < s1; s++) {
          const p = extIndex.items[s]!;
          const t = extT[p]!;
          if (!known[t]) continue;
          let dx = P[t * 3]! - P[d * 3]!;
          let dy = P[t * 3 + 1]! - P[d * 3 + 1]!;
          let dz = P[t * 3 + 2]! - P[d * 3 + 2]!;
          const len = len3(dx, dy, dz);
          if (len < 1e-6) continue;
          const w = extW[p]! / len;
          dx *= w;
          dy *= w;
          dz *= w;
          // Into the parent's frame (Qᵀ · v): the turn is applied before the parent's rotation.
          const qo = par * 9;
          const lx = Q[qo]! * dx + Q[qo + 3]! * dy + Q[qo + 6]! * dz;
          const ly = Q[qo + 1]! * dx + Q[qo + 4]! * dy + Q[qo + 7]! * dz;
          const lz = Q[qo + 2]! * dx + Q[qo + 5]! * dy + Q[qo + 8]! * dz;
          const item = extItem[p]!;
          if (!marked[item]) {
            marked[item] = 1;
            touched.push(item);
          }
          g[item * 3] = g[item * 3]! + lx;
          g[item * 3 + 1] = g[item * 3 + 1]! + ly;
          g[item * 3 + 2] = g[item * 3 + 2]! + lz;
        }
        if (touched.length > 0) {
          touched.sort((a, b) => a - b);
          solveTurn(touched, nodePos, g, oX, oY, oZ, q);
          for (const item of touched) {
            g[item * 3] = g[item * 3 + 1] = g[item * 3 + 2] = 0;
            marked[item] = 0;
          }
        }
      }
      matMul(Q, par * 9, q, 0, Q, d * 9);
    }
    const qo = d * 9;
    const px = P[d * 3]!;
    const py = P[d * 3 + 1]!;
    const pz = P[d * 3 + 2]!;
    const toAbs = (x: number, y: number, z: number, out: Float64Array, o: number) => {
      const lx = x - oX;
      const ly = y - oY;
      const lz = z - oZ;
      out[o] = px + Q[qo]! * lx + Q[qo + 1]! * ly + Q[qo + 2]! * lz;
      out[o + 1] = py + Q[qo + 3]! * lx + Q[qo + 4]! * ly + Q[qo + 5]! * lz;
      out[o + 2] = pz + Q[qo + 6]! * lx + Q[qo + 7]! * ly + Q[qo + 8]! * lz;
    };
    for (const c of kids[d]!) {
      toAbs(nodePos[c * 3]!, nodePos[c * 3 + 1]!, nodePos[c * 3 + 2]!, P, c * 3);
      known[c] = 1;
    }
    const cu = new Float64Array(3);
    for (let u = dirUnitStart[d]!; u < dirUnitStart[d + 1]!; u++) {
      const id = D + u;
      toAbs(nodePos[id * 3]!, nodePos[id * 3 + 1]!, nodePos[id * 3 + 2]!, cu, 0);
      for (let k = unitFileStart[u]!; k < unitFileStart[u + 1]!; k++) {
        const f = unitFiles[k]!;
        const x = local[f * 3]!;
        const y = local[f * 3 + 1]!;
        const z = local[f * 3 + 2]!;
        positions[f * 3] = cu[0]! + Q[qo]! * x + Q[qo + 1]! * y + Q[qo + 2]! * z;
        positions[f * 3 + 1] = cu[1]! + Q[qo + 3]! * x + Q[qo + 4]! * y + Q[qo + 5]! * z;
        positions[f * 3 + 2] = cu[2]! + Q[qo + 6]! * x + Q[qo + 7]! * y + Q[qo + 8]! * z;
      }
    }
  }

  // ── Clusters ──
  const fileCluster = new Int32Array(n);
  const clusterOfDir = new Int32Array(D * 2).fill(-1); // [whole, own] per directory
  const clusterKey = (dir: number): [number, number] => {
    const k = depth[dir]!;
    if (k >= 2) {
      let c = dir;
      while (depth[c]! > 2) c = input.dirParent[c]!;
      return [c, 0];
    }
    if (k === 1) return [dir, kids[dir]!.length > 0 ? 1 : 0];
    return [0, 1];
  };
  for (let f = 0; f < n; f++) {
    const [c, own] = clusterKey(input.fileDir[f]!);
    clusterOfDir[c * 2 + own] = 0;
  }
  const clusterDirList: number[] = [];
  const clusterOwnList: number[] = [];
  for (let i = 0; i < pc; i++) {
    const d = preorder[i]!;
    for (const own of [1, 0]) {
      if (clusterOfDir[d * 2 + own] === 0) {
        clusterOfDir[d * 2 + own] = clusterDirList.length;
        clusterDirList.push(d);
        clusterOwnList.push(own);
      }
    }
  }
  const C = clusterDirList.length;
  const clusterCenter = new Float32Array(C * 3);
  {
    const sum = new Float64Array(C * 3);
    const cnt = new Float64Array(C);
    for (let f = 0; f < n; f++) {
      const [c, own] = clusterKey(input.fileDir[f]!);
      const k = clusterOfDir[c * 2 + own]!;
      fileCluster[f] = k;
      sum[k * 3] = sum[k * 3]! + positions[f * 3]!;
      sum[k * 3 + 1] = sum[k * 3 + 1]! + positions[f * 3 + 1]!;
      sum[k * 3 + 2] = sum[k * 3 + 2]! + positions[f * 3 + 2]!;
      cnt[k]!++;
    }
    for (let k = 0; k < C; k++) for (let j = 0; j < 3; j++) clusterCenter[k * 3 + j] = sum[k * 3 + j]! / Math.max(1, cnt[k]!);
  }

  // ── Filaments ──
  const filaments = buildFilaments(input, E, fileCluster, C, clusterCenter, positions);

  // ── Bridge files ──
  const lean = leanBridges(input, E, fileCluster, clusterCenter, filaments, positions, sphereR);

  // ── Directory spheres (after the lean, so they really contain every file) ──
  for (let i = 0; i < pc; i++) {
    const d = preorder[i]!;
    if (total[d] === 0) {
      const p = input.dirParent[d]!;
      if (p >= 0) for (let j = 0; j < 3; j++) P[d * 3 + j] = P[p * 3 + j]!;
    }
    for (let j = 0; j < 3; j++) dirCenter[d * 3 + j] = P[d * 3 + j]!;
  }
  let radius = 0;
  for (let f = 0; f < n; f++) {
    const x = positions[f * 3]!;
    const y = positions[f * 3 + 1]!;
    const z = positions[f * 3 + 2]!;
    radius = Math.max(radius, len3(x, y, z));
    for (let d = input.fileDir[f]!; d >= 0; d = input.dirParent[d]!) {
      const r = len3(x - dirCenter[d * 3]!, y - dirCenter[d * 3 + 1]!, z - dirCenter[d * 3 + 2]!) + FILE_PAD;
      if (r > dirRadius[d]!) dirRadius[d] = r;
    }
  }

  return {
    gravity,
    positions,
    dirCenter,
    dirRadius,
    clusters: { dir: Int32Array.from(clusterDirList), own: Uint8Array.from(clusterOwnList), center: clusterCenter },
    fileCluster,
    filaments,
    lean,
    mass,
    radius,
  };
}

/** Plummer radius (in units of the scale length) enclosing mass fraction q. */
function plummer(q: number): number {
  // q^(-2/3), as the square of 1 / ∛q.
  const c = 1 / dcbrt(q);
  return 1 / Math.sqrt(c * c - 1);
}

/** Group item indices by an integer key (counting sort): items of key k are items[start[k] .. start[k + 1]). */
function csr(keys: number, of: readonly number[]): { start: Int32Array; items: Int32Array } {
  const start = new Int32Array(keys + 1);
  for (const k of of) start[k + 1]!++;
  for (let k = 0; k < keys; k++) start[k + 1]! += start[k]!;
  const fill = start.slice(0, keys);
  const items = new Int32Array(of.length);
  for (let i = 0; i < of.length; i++) items[fill[of[i]!]!++] = i;
  return { start, items };
}

/**
 * A bounding sphere of spheres (Ritter, grown largest first, two passes): not minimal, but
 * within a few percent of it, deterministic, and linear in a chain, which is what keeps a deep
 * directory chain from inflating level by level.
 */
function enclose(
  ids: readonly number[],
  pos: Float64Array,
  radius: (id: number) => number,
  outC: Float64Array,
  d: number,
  outR: Float64Array,
): void {
  const order = [...ids].sort((a, b) => radius(b) - radius(a) || a - b);
  const first = order[0]!;
  let cx = pos[first * 3]!;
  let cy = pos[first * 3 + 1]!;
  let cz = pos[first * 3 + 2]!;
  let R = radius(first);
  for (let pass = 0; pass < 2; pass++) {
    for (const id of order) {
      const dx = pos[id * 3]! - cx;
      const dy = pos[id * 3 + 1]! - cy;
      const dz = pos[id * 3 + 2]! - cz;
      const dist = len3(dx, dy, dz);
      const reach = dist + radius(id);
      if (reach <= R) continue;
      const next = (R + reach) / 2;
      if (dist > 1e-9) {
        const k = (next - R) / dist;
        cx += dx * k;
        cy += dy * k;
        cz += dz * k;
      }
      R = next;
    }
  }
  outC[d * 3] = cx;
  outC[d * 3 + 1] = cy;
  outC[d * 3 + 2] = cz;
  outR[d] = R;
}

/**
 * The rotation that turns items (at pos[id] − o, in the parent's frame) toward their desired
 * bearings g[id], scaled to EXT_PULL of the full turn. Newton-like steps on the torque; exact
 * for one item, and a few iterations settle several.
 */
function solveTurn(items: readonly number[], pos: Float64Array, g: Float64Array, ox: number, oy: number, oz: number, out: Float64Array): void {
  // Quaternion (x, y, z, w) accumulated from axis-angle steps.
  let qx = 0;
  let qy = 0;
  let qz = 0;
  let qw = 1;
  const m = new Float64Array(9);
  for (let it = 0; it < ROT_ITERS; it++) {
    quatToMatrix(qx, qy, qz, qw, m);
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let dot = 0;
    for (const id of items) {
      const lx = pos[id * 3]! - ox;
      const ly = pos[id * 3 + 1]! - oy;
      const lz = pos[id * 3 + 2]! - oz;
      const len = len3(lx, ly, lz);
      if (len < 1e-9) continue;
      const rx = (m[0]! * lx + m[1]! * ly + m[2]! * lz) / len;
      const ry = (m[3]! * lx + m[4]! * ly + m[5]! * lz) / len;
      const rz = (m[6]! * lx + m[7]! * ly + m[8]! * lz) / len;
      const gx = g[id * 3]!;
      const gy = g[id * 3 + 1]!;
      const gz = g[id * 3 + 2]!;
      tx += ry * gz - rz * gy;
      ty += rz * gx - rx * gz;
      tz += rx * gy - ry * gx;
      dot += rx * gx + ry * gy + rz * gz;
    }
    const tl = len3(tx, ty, tz);
    if (tl < 1e-12) break;
    const angle = datan2(tl, dot);
    if (angle < 1e-5) break;
    const s = dsin(angle / 2) / tl;
    const ax = tx * s;
    const ay = ty * s;
    const az = tz * s;
    const aw = dcos(angle / 2);
    // q ← step · q
    const nx = aw * qx + ax * qw + ay * qz - az * qy;
    const ny = aw * qy - ax * qz + ay * qw + az * qx;
    const nz = aw * qz + ax * qy - ay * qx + az * qw;
    const nw = aw * qw - ax * qx - ay * qy - az * qz;
    qx = nx;
    qy = ny;
    qz = nz;
    qw = nw;
  }
  // Partial turn: scale the rotation's angle.
  if (qw < 0) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
    qw = -qw;
  }
  // acos(qw) for the unit quaternion, from both of its parts (there is no deterministic acos).
  const half = datan2(len3(qx, qy, qz), qw);
  const sinHalf = dsin(half);
  if (sinHalf < 1e-9) {
    quatToMatrix(0, 0, 0, 1, out);
    return;
  }
  const h2 = half * EXT_PULL;
  const k = dsin(h2) / sinHalf;
  quatToMatrix(qx * k, qy * k, qz * k, dcos(h2), out);
}

// ─── Relaxation ──────────────────────────────────────────────────────────────────────────────

/**
 * One directory's arrangement: its units (the core at the origin, held there) and children's
 * spheres, settled by a fixed number of ticks of velocity-Verlet with decaying alpha, the way
 * d3-force runs, then collision passes so nothing is left overlapping. Written here rather than
 * driving d3-force-3d per directory: thousands of tiny simulations spent more on setup than on
 * ticks, and the shared module would have pulled d3's timer and dispatch into the viewer for
 * nothing.
 */
class Relaxer {
  m = 0;
  x = new Float64Array(0);
  private v = new Float64Array(0);
  private r = new Float64Array(0);
  private pull = new Float64Array(0);
  private size = new Float64Array(0);
  private key = new Float64Array(0);
  private fixed = new Uint8Array(0);
  private links: number[] = [];
  private order = new Int32Array(0);
  // The collision grid (collideGrid), for directories with many children: each item's level and
  // cell, each level's cell size, count and box, and the cells' item lists. Kept between
  // directories and grown as needed.
  private level = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private items = new Int32Array(0);
  private cellX = new Int32Array(0);
  private cellY = new Int32Array(0);
  private cellZ = new Int32Array(0);
  private cellStart = new Int32Array(0);
  private cell = new Float64Array(MAX_LEVELS);
  private levelCount = new Int32Array(MAX_LEVELS);
  private box = new Int32Array(MAX_LEVELS * 6);
  private levels = 0;

  reset(m: number): void {
    this.m = m;
    if (this.x.length < m * 3) {
      const cap = Math.max(m, 16);
      this.x = new Float64Array(cap * 3);
      this.v = new Float64Array(cap * 3);
      this.r = new Float64Array(cap);
      this.pull = new Float64Array(cap);
      this.size = new Float64Array(cap);
      this.key = new Float64Array(cap);
      this.fixed = new Uint8Array(cap);
      this.order = new Int32Array(cap);
      this.level = new Int32Array(cap);
      this.cellOf = new Int32Array(cap);
      this.items = new Int32Array(cap);
      this.cellX = new Int32Array(cap);
      this.cellY = new Int32Array(cap);
      this.cellZ = new Int32Array(cap);
    }
    this.x.fill(0, 0, m * 3);
    this.v.fill(0, 0, m * 3);
    this.fixed.fill(0, 0, m);
    this.links.length = 0;
  }

  add(k: number, radius: number, massShare: number, files: number, key: number, core: boolean): void {
    this.r[k] = radius;
    this.pull[k] = massShare;
    this.size[k] = files;
    this.key[k] = key;
    this.fixed[k] = core ? 1 : 0;
  }

  /** Raw coupling (edge count); normalized against the strongest at run time. */
  couple(a: number, b: number, w: number): void {
    this.links.push(a, b, w);
  }

  /** A fixed-strength link (a knot to its name neighbor). */
  chain(a: number, b: number): void {
    this.links.push(a, b, -1);
  }

  run(gapK: number, seed: number): void {
    const m = this.m;
    const { x, v, r, pull, size, key, fixed, links } = this;
    const rand = prng(seed);
    const gap = (i: number, j: number) => GAP_MIN + gapK * 0.5 * (r[i]! + r[j]!);

    // ── Seed ──
    // Directions: a Fibonacci sphere in size order (largest first, keys breaking ties), turned
    // by a seeded rotation. Distance: just clear of the core, plus a share of the shell the
    // siblings need, smaller for heavier ones. Direction never depends on mass, so a gravity
    // switch moves a sibling in or out along its own bearing.
    let core = -1;
    for (let k = 0; k < m; k++) if (fixed[k]) core = k;
    const movable: number[] = [];
    for (let k = 0; k < m; k++) if (k !== core) movable.push(k);
    movable.sort((a, b) => size[b]! - size[a]! || key[a]! - key[b]!);
    const byPull = [...movable].sort((a, b) => pull[b]! - pull[a]! || size[b]! - size[a]! || key[a]! - key[b]!);
    const pullRank = new Float64Array(m);
    byPull.forEach((k, i) => (pullRank[k] = movable.length > 1 ? i / (movable.length - 1) : 0));
    const rot = new Float64Array(9);
    randomRotation(rand(), rand(), rand(), rot);
    let vol = 0;
    for (const k of movable) {
      const s = r[k]! * (1 + gapK * 0.5) + GAP_MIN;
      vol += s * s * s;
    }
    const shell = dcbrt(vol / 0.3);
    const coreR = core >= 0 ? r[core]! : 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    movable.forEach((k, i) => {
      const t = movable.length === 1 ? 0.5 : i / (movable.length - 1);
      const zz = 1 - 2 * (0.05 + 0.9 * t);
      const rho = Math.sqrt(Math.max(0, 1 - zz * zz));
      const a = (i * golden) % (2 * Math.PI);
      const dx = rho * dcos(a);
      const dy = rho * dsin(a);
      const ux = rot[0]! * dx + rot[1]! * dy + rot[2]! * zz;
      const uy = rot[3]! * dx + rot[4]! * dy + rot[5]! * zz;
      const uz = rot[6]! * dx + rot[7]! * dy + rot[8]! * zz;
      const dist = (core >= 0 ? coreR + r[k]! + gap(core, k) : r[k]! * 0.5) + shell * (0.06 + 0.6 * pullRank[k]!);
      x[k * 3] = ux * dist;
      x[k * 3 + 1] = uy * dist;
      x[k * 3 + 2] = uz * dist;
    });

    // ── Ticks ──
    let maxW = 0;
    for (let i = 2; i < links.length; i += 3) maxW = Math.max(maxW, links[i]!);
    const ticks = m <= 24 ? 90 : m <= 200 ? 60 : 40;
    const decay = 1 - droot(0.002, ticks);
    if (m > GRID_MIN) this.prepareGrid(gapK);
    let alpha = 1;
    for (let t = 0; t < ticks; t++) {
      // Pull toward the parent's center (gravity b).
      for (const k of movable) {
        const s = (PULL_BASE + PULL_MASS * pull[k]!) * alpha;
        v[k * 3] = v[k * 3]! - x[k * 3]! * s;
        v[k * 3 + 1] = v[k * 3 + 1]! - x[k * 3 + 1]! * s;
        v[k * 3 + 2] = v[k * 3 + 2]! - x[k * 3 + 2]! * s;
      }
      // Springs between siblings that import each other, toward touching distance.
      for (let i = 0; i < links.length; i += 3) {
        const a = links[i]!;
        const b = links[i + 1]!;
        const w = links[i + 2]!;
        const k = w < 0 ? KNOT_CHAIN : COUPLE_K * Math.sqrt(w / Math.max(maxW, 1));
        const dx = x[b * 3]! - x[a * 3]!;
        const dy = x[b * 3 + 1]! - x[a * 3 + 1]!;
        const dz = x[b * 3 + 2]! - x[a * 3 + 2]!;
        const dist = len3(dx, dy, dz) || 1e-9;
        const rest = r[a]! + r[b]! + gap(a, b);
        if (dist <= rest) continue;
        const f = (((dist - rest) / dist) * k * alpha) / (fixed[a] || fixed[b] ? 1 : 2);
        if (!fixed[a]) {
          v[a * 3] = v[a * 3]! + dx * f;
          v[a * 3 + 1] = v[a * 3 + 1]! + dy * f;
          v[a * 3 + 2] = v[a * 3 + 2]! + dz * f;
        }
        if (!fixed[b]) {
          v[b * 3] = v[b * 3]! - dx * f;
          v[b * 3 + 1] = v[b * 3 + 1]! - dy * f;
          v[b * 3 + 2] = v[b * 3 + 2]! - dz * f;
        }
      }
      for (const k of movable) {
        v[k * 3] = v[k * 3]! * 0.6;
        v[k * 3 + 1] = v[k * 3 + 1]! * 0.6;
        v[k * 3 + 2] = v[k * 3 + 2]! * 0.6;
        x[k * 3] = x[k * 3]! + v[k * 3]!;
        x[k * 3 + 1] = x[k * 3 + 1]! + v[k * 3 + 1]!;
        x[k * 3 + 2] = x[k * 3 + 2]! + v[k * 3 + 2]!;
      }
      this.collide(gapK, COLLIDE);
      alpha *= 1 - decay;
    }
    for (let p = 0; p < SETTLE_PASSES; p++) if (!this.collide(gapK, 1)) break;
  }

  /** Push overlapping pairs apart. Returns whether anything moved. */
  private collide(gapK: number, strength: number): boolean {
    return this.m > GRID_MIN ? this.collideGrid(gapK, strength) : this.collideSweep(gapK, strength);
  }

  /**
   * Sweep and prune along x, for the few siblings most directories have. Its window is the
   * largest sibling's reach, so a single big sibling widens it for everyone, and it is O(m²) once
   * the siblings fill a ball: 20,000 one-file directories under one parent took 2.7 s in this
   * sweep, 98% of the web's time (measured). Past GRID_MIN siblings, collideGrid runs instead.
   */
  private collideSweep(gapK: number, strength: number): boolean {
    const m = this.m;
    const { x, r, fixed, order } = this;
    let maxR = 0;
    for (let k = 0; k < m; k++) {
      order[k] = k;
      maxR = Math.max(maxR, r[k]!);
    }
    // Insertion sort: the order changes little between ticks, so this is near linear.
    for (let i = 1; i < m; i++) {
      const k = order[i]!;
      const xk = x[k * 3]!;
      let j = i - 1;
      while (j >= 0 && x[order[j]! * 3]! > xk) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = k;
    }
    let moved = false;
    for (let i = 0; i < m; i++) {
      const a = order[i]!;
      const reachA = r[a]! + maxR + GAP_MIN + gapK * 0.5 * (r[a]! + maxR);
      for (let j = i + 1; j < m; j++) {
        const b = order[j]!;
        if (x[b * 3]! - x[a * 3]! > reachA) break;
        if (this.resolve(a, b, gapK, strength)) moved = true;
      }
    }
    return moved;
  }

  /** Each item's grid level, once per run: the radii do not change while it runs. */
  private prepareGrid(gapK: number): void {
    const m = this.m;
    const { r, level, cell, levelCount } = this;
    // Two items overlap when their distance is under reach[a] + reach[b] (see resolve's `need`).
    const reachOf = (k: number) => (1 + gapK * 0.5) * r[k]! + GAP_MIN * 0.5;
    let base = Number.POSITIVE_INFINITY;
    for (let k = 0; k < m; k++) base = Math.min(base, reachOf(k));
    base = Math.max(base, 1e-6);
    levelCount.fill(0);
    let top = 0;
    for (let k = 0; k < m; k++) {
      // The smallest power-of-two multiple of the base that holds this reach, by doubling: Math.log2
      // is one of the builtins engines may round differently, and the web must not depend on that.
      const reach = reachOf(k);
      let L = 0;
      let c = base;
      while (c < reach && L < MAX_LEVELS - 1) {
        c *= 2;
        L++;
      }
      level[k] = L;
      levelCount[L]!++;
      if (L > top) top = L;
    }
    this.levels = top + 1;
    // A level's items reach at most half a cell, so any pair that can touch lies within one cell
    // of each other on every axis.
    for (let L = 0, c = 2 * base; L <= top; L++, c *= 2) cell[L] = c;
  }

  /**
   * A hierarchical grid: each item sits in one cell of its own level's grid (cells twice the
   * largest reach on that level, so whatever it can touch there is in the 3 x 3 x 3 cells around
   * it), and also looks on every coarser level in use. A pass is linear in the siblings however
   * many there are and however their sizes spread: one huge sibling sits on a coarse level and no
   * longer widens everyone's search. On its own level an item looks at its own cell (pairs from
   * the lower index) and the 13 cells after it, so each pair is met once.
   *
   * The grids are dense arrays over each level's bounding box of cells. A hashed table was tried
   * first and spent ten times as long walking empty buckets (1.5 s against 0.1 s for 64 passes
   * over 20,000 siblings, measured). A box made huge by a few outliers is capped, and items
   * outside it are clamped onto its edge: clamping keeps neighboring cells neighbors, so it only
   * adds candidates, never loses one. Cells come from where the items were when the pass began;
   * items in index order and cells filled in index order make it as deterministic as the sweep.
   */
  private collideGrid(gapK: number, strength: number): boolean {
    const m = this.m;
    const { x, r, level, cell, levelCount, cellOf, items, cellX, cellY, cellZ, box } = this;
    const levels = this.levels;
    // Each item's cell on its own level, and each level's box.
    for (let L = 0; L < levels; L++) {
      box[L * 6] = box[L * 6 + 1] = box[L * 6 + 2] = 0x3fffffff;
      box[L * 6 + 3] = box[L * 6 + 4] = box[L * 6 + 5] = -0x3fffffff;
    }
    for (let k = 0; k < m; k++) {
      const L = level[k]!;
      const c = cell[L]!;
      const ix = (cellX[k] = Math.floor(x[k * 3]! / c));
      const iy = (cellY[k] = Math.floor(x[k * 3 + 1]! / c));
      const iz = (cellZ[k] = Math.floor(x[k * 3 + 2]! / c));
      const o = L * 6;
      if (ix < box[o]!) box[o] = ix;
      if (iy < box[o + 1]!) box[o + 1] = iy;
      if (iz < box[o + 2]!) box[o + 2] = iz;
      if (ix > box[o + 3]!) box[o + 3] = ix;
      if (iy > box[o + 4]!) box[o + 4] = iy;
      if (iz > box[o + 5]!) box[o + 5] = iz;
    }
    // Lay the levels' boxes out one after another, each padded by a cell so neighbors stay inside.
    let total = 0;
    for (let L = 0; L < levels; L++) {
      const o = L * 6;
      if (levelCount[L] === 0) continue;
      // The cap per axis, as an integer cube root by counting: Math.cbrt may round differently
      // from one engine to the next, and a different cap would reorder the pairs.
      const budget = GRID_CELLS_PER_ITEM * levelCount[L]! + 64;
      let cap = 4;
      while (cap * cap * cap < budget) cap++;
      for (let j = 0; j < 3; j++) {
        // A span past the cap keeps its middle; the rest is clamped onto the capped edges.
        const lo = box[o + j]!;
        const hi = box[o + 3 + j]!;
        if (hi - lo + 1 > cap) {
          const mid = lo + Math.floor((hi - lo) / 2);
          box[o + j] = mid - Math.floor(cap / 2);
          box[o + 3 + j] = box[o + j]! + cap - 1;
        }
      }
      dims[L * 3] = box[o + 3]! - box[o]! + 3;
      dims[L * 3 + 1] = box[o + 4]! - box[o + 1]! + 3;
      dims[L * 3 + 2] = box[o + 5]! - box[o + 2]! + 3;
      levelBase[L] = total;
      total += dims[L * 3]! * dims[L * 3 + 1]! * dims[L * 3 + 2]!;
      const sy = dims[L * 3 + 2]!;
      const sx = dims[L * 3 + 1]! * sy;
      for (let n = 0; n < 27; n++) neighbor[L * 27 + n] = OFF_X[n]! * sx + OFF_Y[n]! * sy + OFF_Z[n]!;
    }
    if (this.cellStart.length < total + 1) this.cellStart = new Int32Array(Math.max(total + 1, this.cellStart.length * 2));
    const start = this.cellStart;
    start.fill(0, 0, total + 1);
    const cellIndex = (L: number, ix: number, iy: number, iz: number) => {
      const o = L * 6;
      const cx = Math.min(box[o + 3]!, Math.max(box[o]!, ix)) - box[o]! + 1;
      const cy = Math.min(box[o + 4]!, Math.max(box[o + 1]!, iy)) - box[o + 1]! + 1;
      const cz = Math.min(box[o + 5]!, Math.max(box[o + 2]!, iz)) - box[o + 2]! + 1;
      return levelBase[L]! + (cx * dims[L * 3 + 1]! + cy) * dims[L * 3 + 2]! + cz;
    };
    // Counting sort into cells: counts, running ends, then filled backwards so each cell lists
    // its items in index order and start[id] ends up at its first.
    for (let k = 0; k < m; k++) {
      const id = cellIndex(level[k]!, cellX[k]!, cellY[k]!, cellZ[k]!);
      cellOf[k] = id;
      start[id]!++;
    }
    for (let id = 1; id < total; id++) start[id]! += start[id - 1]!;
    start[total] = m;
    for (let k = m - 1; k >= 0; k--) items[--start[cellOf[k]!]!] = k;
    const g = gapK * 0.5;
    const nb = neighbor;
    let moved = false;
    for (let a = 0; a < m; a++) {
      const La = level[a]!;
      const ra = r[a]!;
      for (let L = La; L < levels; L++) {
        if (levelCount[L] === 0) continue;
        const own = L === La;
        const c = cell[L]!;
        const at = own ? cellOf[a]! : cellIndex(L, Math.floor(x[a * 3]! / c), Math.floor(x[a * 3 + 1]! / c), Math.floor(x[a * 3 + 2]! / c));
        // On its own level, the half shell: the offsets from (0, 0, 0) on, in x-major order.
        for (let n = own ? 13 : 0; n < 27; n++) {
          const id = at + nb[L * 27 + n]!;
          const q1 = start[id + 1]!;
          for (let q = start[id]!; q < q1; q++) {
            const j = items[q]!;
            if (own && n === 13 && j <= a) continue;
            // a's position is read again for every candidate: a resolve just above may have moved it.
            const dx = x[j * 3]! - x[a * 3]!;
            const dy = x[j * 3 + 1]! - x[a * 3 + 1]!;
            const dz = x[j * 3 + 2]! - x[a * 3 + 2]!;
            const need = ra + r[j]! + GAP_MIN + g * (ra + r[j]!);
            if (dx * dx + dy * dy + dz * dz >= need * need) continue;
            if (this.resolve(a, j, gapK, strength)) moved = true;
          }
        }
      }
    }
    return moved;
  }

  /** Push one pair apart if it overlaps (the core never moves). Returns whether it did. */
  private resolve(a: number, b: number, gapK: number, strength: number): boolean {
    const { x, r, fixed } = this;
    if (fixed[a] && fixed[b]) return false;
    const dx = x[b * 3]! - x[a * 3]!;
    const dy = x[b * 3 + 1]! - x[a * 3 + 1]!;
    const dz = x[b * 3 + 2]! - x[a * 3 + 2]!;
    const need = r[a]! + r[b]! + GAP_MIN + gapK * 0.5 * (r[a]! + r[b]!);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= need * need) return false;
    let dist = Math.sqrt(d2);
    let nx = dx;
    let ny = dy;
    let nz = dz;
    if (dist < 1e-9) {
      // Coincident: separate along a direction fixed by the pair, never by chance.
      const h = hash(a, b);
      nx = ((h & 1023) / 1023) * 2 - 1;
      ny = (((h >>> 10) & 1023) / 1023) * 2 - 1;
      nz = 0.5;
      dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= 1e-6 / dist;
      ny *= 1e-6 / dist;
      nz *= 1e-6 / dist;
      dist = 1e-6;
    }
    const push = ((need - dist) / dist) * strength;
    const wa = fixed[a] ? 0 : fixed[b] ? 1 : 0.5;
    const wb = fixed[b] ? 0 : fixed[a] ? 1 : 0.5;
    x[a * 3] = x[a * 3]! - nx * push * wa;
    x[a * 3 + 1] = x[a * 3 + 1]! - ny * push * wa;
    x[a * 3 + 2] = x[a * 3 + 2]! - nz * push * wa;
    x[b * 3] = x[b * 3]! + nx * push * wb;
    x[b * 3 + 1] = x[b * 3 + 1]! + ny * push * wb;
    x[b * 3 + 2] = x[b * 3 + 2]! + nz * push * wb;
    return true;
  }
}

/** Siblings past which collision runs on the grid (collideGrid) instead of the sweep. */
const GRID_MIN = 64;
/** Grid levels at most (cell sizes double per level: 2^31 times the smallest is beyond any web). */
const MAX_LEVELS = 32;
/** Cells a level's grid may hold per item on it, before its box is capped (see collideGrid). */
const GRID_CELLS_PER_ITEM = 12;
/** Per-level grid dimensions and where each level's cells start, shared by every Relaxer pass. */
const dims = new Int32Array(MAX_LEVELS * 3);
const levelBase = new Int32Array(MAX_LEVELS);
/** Per level, the index offsets of the 27 cells around a cell. */
const neighbor = new Int32Array(MAX_LEVELS * 27);

/** The 27 cell offsets of a 3 x 3 x 3 neighborhood in x-major order; (0, 0, 0) is number 13. */
const OFF_X = Int32Array.from({ length: 27 }, (_, n) => Math.floor(n / 9) - 1);
const OFF_Y = Int32Array.from({ length: 27 }, (_, n) => (Math.floor(n / 3) % 3) - 1);
const OFF_Z = Int32Array.from({ length: 27 }, (_, n) => (n % 3) - 1);


// ─── Filaments ───────────────────────────────────────────────────────────────────────────────

function buildFilaments(input: WebInput, E: number, fileCluster: Int32Array, C: number, center: Float32Array, positions: Float32Array): WebFilaments {
  // Coupling per cluster pair, both directions, from one sort of pair keys.
  const keys = new Float64Array(E);
  let m = 0;
  for (let e = 0; e < E; e++) {
    const a = fileCluster[input.from[e]!]!;
    const b = fileCluster[input.to[e]!]!;
    if (a === b) continue;
    keys[m++] = a < b ? a * C + b : b * C + a;
  }
  const used = keys.subarray(0, m).sort();
  const pa: number[] = [];
  const pb: number[] = [];
  const pw: number[] = [];
  for (let i = 0; i < m; ) {
    let j = i;
    while (j < m && used[j] === used[i]) j++;
    const a = Math.floor(used[i]! / C);
    pa.push(a);
    pb.push(used[i]! - a * C);
    pw.push(j - i);
    i = j;
  }
  const P = pa.length;
  const keep = new Uint8Array(P);
  // Maximum spanning forest (Kruskal, strongest first, pair order breaking ties).
  const byWeight = Array.from({ length: P }, (_, i) => i).sort((x, y) => pw[y]! - pw[x]! || x - y);
  const parent = Int32Array.from({ length: C }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const p of byWeight) {
    const ra = find(pa[p]!);
    const rb = find(pb[p]!);
    if (ra === rb) continue;
    parent[ra] = rb;
    keep[p] = 1;
  }
  // Each node's strongest one or two further links, if they clear the floor.
  const incident: number[][] = Array.from({ length: C }, () => []);
  for (const p of byWeight) {
    incident[pa[p]!]!.push(p);
    incident[pb[p]!]!.push(p);
  }
  const extra = new Uint8Array(P);
  for (let c = 0; c < C; c++) {
    const list = incident[c]!;
    if (list.length === 0) continue;
    const floor = Math.max(EXTRA_MIN, EXTRA_REL * pw[list[0]!]!);
    let added = 0;
    for (const p of list) {
      if (added >= EXTRA_LINKS || pw[p]! < floor) break;
      if (keep[p]) continue;
      extra[p] = 1;
      added++;
    }
  }
  const chosen: number[] = [];
  for (let p = 0; p < P; p++) if (keep[p] || extra[p]) chosen.push(p);
  const F = chosen.length;
  // Each end's anchor: the centroid of the files on that side of the strand's edges, each file
  // counted once per edge (a hub that carries most of the coupling pulls the end onto itself).
  const indexOf = new Map<number, number>();
  chosen.forEach((p, i) => indexOf.set(pa[p]! * C + pb[p]!, i));
  const endSum = new Float64Array(F * 6);
  const endCount = new Float64Array(F * 2);
  for (let e = 0; e < E; e++) {
    const f = input.from[e]!;
    const g = input.to[e]!;
    const a = fileCluster[f]!;
    const b = fileCluster[g]!;
    if (a === b) continue;
    const i = indexOf.get(a < b ? a * C + b : b * C + a);
    if (i === undefined) continue;
    // Side 0 is the strand's lower cluster (its `a`), side 1 its `b`.
    const fa = a < b ? f : g;
    const fb = a < b ? g : f;
    for (let j = 0; j < 3; j++) {
      endSum[i * 6 + j] = endSum[i * 6 + j]! + positions[fa * 3 + j]!;
      endSum[i * 6 + 3 + j] = endSum[i * 6 + 3 + j]! + positions[fb * 3 + j]!;
    }
    endCount[i * 2]!++;
    endCount[i * 2 + 1]!++;
  }
  let maxC = 1;
  for (const p of chosen) maxC = Math.max(maxC, pw[p]!);
  const out: WebFilaments = {
    a: new Int32Array(F),
    b: new Int32Array(F),
    coupling: new Int32Array(F),
    weight: new Float32Array(F),
    curve: new Float32Array(F * 9),
  };
  chosen.forEach((p, i) => {
    const a = pa[p]!;
    const b = pb[p]!;
    out.a[i] = a;
    out.b[i] = b;
    out.coupling[i] = pw[p]!;
    out.weight[i] = Math.log1p(pw[p]!) / Math.log1p(maxC);
    const ca = Math.max(1, endCount[i * 2]!);
    const cb = Math.max(1, endCount[i * 2 + 1]!);
    const ax = endCount[i * 2]! > 0 ? endSum[i * 6]! / ca : center[a * 3]!;
    const ay = endCount[i * 2]! > 0 ? endSum[i * 6 + 1]! / ca : center[a * 3 + 1]!;
    const az = endCount[i * 2]! > 0 ? endSum[i * 6 + 2]! / ca : center[a * 3 + 2]!;
    const bx = endCount[i * 2 + 1]! > 0 ? endSum[i * 6 + 3]! / cb : center[b * 3]!;
    const by = endCount[i * 2 + 1]! > 0 ? endSum[i * 6 + 4]! / cb : center[b * 3 + 1]!;
    const bz = endCount[i * 2 + 1]! > 0 ? endSum[i * 6 + 5]! / cb : center[b * 3 + 2]!;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = len3(dx, dy, dz);
    // A gentle bow off the chord, in a direction fixed by the pair: a straight web reads as a
    // wiring diagram; strands with a little sag read as structure.
    const rand = prng(hash(a, b, 0xf11a));
    let hx = rand() * 2 - 1;
    let hy = rand() * 2 - 1;
    let hz = rand() * 2 - 1;
    // Perpendicular part of h, falling back to another axis when h is along the chord.
    if (len > 1e-9) {
      const along = (hx * dx + hy * dy + hz * dz) / (len * len);
      hx -= along * dx;
      hy -= along * dy;
      hz -= along * dz;
    }
    let hl = len3(hx, hy, hz);
    if (hl < 1e-6) {
      hx = -dy;
      hy = dx;
      hz = 0;
      hl = len3(hx, hy, hz) || 1;
    }
    const bow = (BOW * len * (0.6 + 0.4 * rand())) / hl;
    const c = out.curve;
    c[i * 9] = ax;
    c[i * 9 + 1] = ay;
    c[i * 9 + 2] = az;
    c[i * 9 + 3] = (ax + bx) / 2 + hx * bow;
    c[i * 9 + 4] = (ay + by) / 2 + hy * bow;
    c[i * 9 + 5] = (az + bz) / 2 + hz * bow;
    c[i * 9 + 6] = bx;
    c[i * 9 + 7] = by;
    c[i * 9 + 8] = bz;
  });
  return out;
}

/** A point on filament i's curve, t from its `a` end (0) to its `b` end (1). */
export function filamentPoint(f: WebFilaments, i: number, t: number, out: Float64Array | Float32Array | number[], o = 0): void {
  const c = f.curve;
  const u = 1 - t;
  for (let j = 0; j < 3; j++) out[o + j] = u * u * c[i * 9 + j]! + 2 * u * t * c[i * 9 + 3 + j]! + t * t * c[i * 9 + 6 + j]!;
}

/**
 * Move bridge files out along their filament. A file leans when more than LEAN_SHARE of its code
 * edges cross to other clusters along filaments, at least LEAN_MIN_EDGES of them; it leans along
 * the strand that carries most of them. How far grows with that cross share (and with the chosen
 * strand's part of it), up to LEAN_MAX of the filament or LEAN_REACH radii of its own directory,
 * whichever is shorter. Counting only the single busiest strand against all edges was tried
 * first: a file split between two neighbors never qualified, and inertialref's 1,465 files
 * produced nine bridge files, which left every strand empty.
 *
 * Its offset from its own cluster's center shrinks as it goes, so the leaning files form a stream
 * that tapers along the strand instead of a copy of the clump sliding sideways.
 */
function leanBridges(
  input: WebInput,
  E: number,
  fileCluster: Int32Array,
  center: Float32Array,
  fil: WebFilaments,
  positions: Float32Array,
  dirReach: Float64Array,
): Float32Array {
  const n = input.fileCount;
  const lean = new Float32Array(n);
  const F = fil.a.length;
  if (F === 0) return lean;
  const C = center.length / 3;
  const filamentOf = new Map<number, number>();
  for (let i = 0; i < F; i++) filamentOf.set(fil.a[i]! * C + fil.b[i]!, i);
  const degree = new Int32Array(n);
  const recKeys: number[] = [];
  for (let e = 0; e < E; e++) {
    const f = input.from[e]!;
    const g = input.to[e]!;
    degree[f]!++;
    degree[g]!++;
    const a = fileCluster[f]!;
    const b = fileCluster[g]!;
    if (a === b) continue;
    const i = filamentOf.get(a < b ? a * C + b : b * C + a);
    if (i === undefined) continue;
    recKeys.push(f * F + i, g * F + i);
  }
  const keys = Float64Array.from(recKeys).sort();
  const p = new Float64Array(3);
  for (let s = 0; s < keys.length; ) {
    // Runs of one (file, filament); keep each file's longest run, the lower filament on ties.
    const f = Math.floor(keys[s]! / F);
    let best = -1;
    let bestCount = 0;
    let cross = 0;
    while (s < keys.length && Math.floor(keys[s]! / F) === f) {
      let j = s;
      while (j < keys.length && keys[j] === keys[s]) j++;
      cross += j - s;
      if (j - s > bestCount) {
        bestCount = j - s;
        best = keys[s]! - f * F;
      }
      s = j;
    }
    if (best < 0 || cross < LEAN_MIN_EDGES) continue;
    const share = cross / Math.max(1, degree[f]!);
    if (share <= LEAN_SHARE) continue;
    const u = Math.min(1, (share - LEAN_SHARE) / (1 - LEAN_SHARE));
    // How far along its possible lean the file goes (0-1).
    const go = u * u * (3 - 2 * u) * Math.sqrt(bestCount / cross);
    const t = LEAN_MAX * go;
    const own = fileCluster[f]!;
    const fromA = fil.a[best] === own;
    // Where the file heads: out along the strand, its offset from the strand's own end on this
    // side shrinking as it goes, so the stream leaves the cluster where the strand does.
    const end = best * 9 + (fromA ? 0 : 6);
    filamentPoint(fil, best, fromA ? t : 1 - t, p);
    const keepOffset = 1 - 0.6 * go;
    const dx = p[0]! + (positions[f * 3]! - fil.curve[end]!) * keepOffset - positions[f * 3]!;
    const dy = p[1]! + (positions[f * 3 + 1]! - fil.curve[end + 1]!) * keepOffset - positions[f * 3 + 1]!;
    const dz = p[2]! + (positions[f * 3 + 2]! - fil.curve[end + 2]!) * keepOffset - positions[f * 3 + 2]!;
    // How far it gets there: at most `go` of its reach (LEAN_REACH radii of its own directory).
    // The bound is on the whole move, not only on the distance along the strand: the shrinking
    // offset alone dragged a file deep inside a big cluster most of the way to the strand's end,
    // 36 times its directory's size on a synthetic 3,000-file tree (measured).
    const move = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (move < 1e-9) continue;
    const reach = go * LEAN_REACH * Math.max(LEAN_FLOOR, dirReach[input.fileDir[f]!]!);
    const k = move > reach ? reach / move : 1;
    positions[f * 3] = positions[f * 3]! + dx * k;
    positions[f * 3 + 1] = positions[f * 3 + 1]! + dy * k;
    positions[f * 3 + 2] = positions[f * 3 + 2]! + dz * k;
    const c = fil.curve;
    const len = len3(c[best * 9 + 6]! - c[best * 9]!, c[best * 9 + 7]! - c[best * 9 + 1]!, c[best * 9 + 8]! - c[best * 9 + 2]!);
    lean[f] = Math.min(t, (move * k) / Math.max(len, 1e-9));
  }
  return lean;
}

// ─── Input from a report ─────────────────────────────────────────────────────────────────────

/** The web's input from a loaded report: code edges only (doc links stay out, as they do for the analyzer). */
export function webInputFromReport(report: Report): WebInput {
  const files = report.files;
  const n = files.length;
  const from: number[] = [];
  const to: number[] = [];
  const e = report.edges;
  for (let k = 0; k < e.from.length; k++) {
    if (e.kind[k] === "link") continue;
    from.push(e.from[k]!);
    to.push(e.to[k]!);
  }
  const hasGit = !!report.git;
  const fanIn = new Float64Array(n);
  const rank = new Float64Array(n);
  const complexity = new Float64Array(n);
  const hotspot = new Float64Array(n);
  const code = new Float64Array(n);
  const commits = hasGit ? new Float64Array(n) : undefined;
  const modified = hasGit ? new Float64Array(n) : undefined;
  const fileDir = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const f = files[i]!;
    fileDir[i] = f.dir;
    fanIn[i] = f.fanIn;
    rank[i] = f.rank;
    complexity[i] = f.complexity;
    hotspot[i] = f.hotspot;
    code[i] = f.code;
    if (commits && f.git) commits[i] = f.git.commits;
    if (modified && f.git) modified[i] = f.git.modified;
  }
  return {
    fileCount: n,
    fileDir,
    dirParent: report.dirs.map((d) => d.parent),
    dirDirs: report.dirs.map((d) => d.dirs),
    dirFiles: report.dirs.map((d) => d.files),
    from,
    to,
    metrics: { fanIn, rank, complexity, hotspot, code, ...(commits ? { commits } : {}), ...(modified ? { modified } : {}) },
  };
}
