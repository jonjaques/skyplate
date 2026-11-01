/// <reference path="./d3-force-3d.d.ts" />
/**
 * 3D positions for every file: the "tree" galaxy from the directory hierarchy and the "graph"
 * layout from the import graph. Written once by the analyzer so the viewer never runs a
 * simulation (a 20k-node force layout in the browser is seconds of jank on every open).
 *
 *   computeLayout(input) → Layouts       (pure; runs on a pool worker in the pipeline)
 *
 * ── Tree: a barred-spiral reading of the directory tree ──
 *
 *   core     the root's own files, with the small top-level directories (.github, .vscode…)
 *            packed around them as star clusters, all in one lens at the center
 *   arms     each sizeable top-level directory is one spiral arm, starting at the core's rim
 *
 * An earlier version circle-packed the whole tree and twisted the flat pack into a spiral. It
 * stayed truthful, but it read as a twisted pie: a filled disc has no arms, and with no gaps
 * between regions nothing says "galaxy". Arms need empty lanes between them, so each arm now
 * gets its own band.
 *
 * Arm geometry. Arms are logarithmic spirals (pitch PITCH) that start at radius r0. Arm k owns
 * an angular sector Δθ_k ∝ √weight of the *spiral-shifted* angle ψ = θ − ln(r/r0)/tan(pitch);
 * those sectors partition the plane at every radius, so arms can never overlap however long
 * they run. Inside its sector an arm fills a band whose real width grows like √r, slower
 * than the sector (which grows like r): arms crowd into the bulge near the core and open dark
 * lanes toward the rim. The band's length then follows from its area, which is proportional
 * to the files it holds, so a big directory is a long, broad arm and a small one a short stub.
 *
 * Inside an arm. The region's subtree is laid out as a treemap (order-preserving binary
 * splits) in a straight "unrolled" rectangle, x along the arm and y across it. Each leaf is a
 * bead: one directory's own files, circle-packed. Beads sit in the cells, and the rectangle is
 * then bent onto the spiral through log-polar coordinates, which are conformal, so beads stay
 * round instead of shearing. Every directory is a treemap cell, hence one contiguous patch of
 * the arm, and its subdirectories nest inside it.
 *
 * Centrality runs inward. Siblings are ordered by how many imports point into them, so each
 * arm's most depended-on code sits at its inner end against the bulge and leaf material
 * (fixtures, docs, tests) trails out toward the rim; inside a bead the most-imported files take
 * the center of the pack. Distance from the core along an arm is a measured fact, not decor.
 *
 * Depth. The disc is thick at the core and thin at the rim, each bead has its own height in it,
 * and a gentle warp lifts the outer disc on one side and drops it on the other, as real discs
 * do, so the galaxy has volume when orbited instead of reading as a printed sheet.
 *
 * ── Graph ──
 *
 * d3-force-3d over code edges (links, Barnes-Hut many-body) with a weak pull toward each file's
 * direction in the tree, so a region's import cluster lands on its region's side and the morph
 * between the two layouts stays legible. Files with no code edges are not simulated (they have
 * nothing to be pulled toward): each region's unconnected files gather in a flat disc just
 * outside the connected core, on the region's side. The result is scaled to the
 * tree's radius so the camera framing holds across the morph.
 *
 * Deterministic: every order is a sort with id tie-breaks, d3's pack uses its own seeded LCG,
 * jitter comes from a fixed-seed PRNG consumed in a fixed order, and the simulation's tick
 * count depends on the graph size alone (never on elapsed time).
 */

import { hierarchy, packEnclose, packSiblings, treemap, treemapBinary, type HierarchyNode, type HierarchyRectangularNode } from "d3";
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimNode } from "d3-force-3d";
import type { Layouts } from "../shared/schema";

export interface LayoutInput {
  fileCount: number;
  /** Directory id per file. */
  fileDir: number[];
  /** Total lines per file (0 for binaries). */
  lines: number[];
  /** Directory tree: parent (-1 for the root), depth, direct child directories and files. */
  dirParent: number[];
  dirDepth: number[];
  dirDirs: number[][];
  dirFiles: number[][];
  /** Distinct, non-self code edges (no doc links). */
  from: number[];
  to: number[];
}

// ─── Tuning ──────────────────────────────────────────────────────────────────────────────────

/** Leaf circle radius per √weight, with weights √lines + 1: a typical file is 6–15 units across. */
const UNIT = 3;
/** Spiral pitch (radians). ~20° is a classic Sb spiral; lower winds tighter and thinner. */
const PITCH = 0.36;
/** The longest arm ends at this multiple of r0: about 270° of winding at PITCH. */
const ARM_REACH = 6;
/** Share of its sector an arm's band fills at r0; it falls off as r0/r toward the rim. */
const ARM_FILL = 0.86;
/** A top-level directory is an arm when it holds at least this share of the files… */
const ARM_SHARE = 0.025;
/** …and at least this many files. Smaller ones become globular clusters. */
const ARM_MIN_FILES = 6;
const MAX_ARMS = 9;
/** Treemap cell area per bead area: circles in rectangles plus padding. */
const CELL_SLACK = 1.45;
/** Gap between sibling cells, in world units, by depth inside the arm. */
const PADDING = [10, 6, 4, 2.5, 1.5];
/** Disc half-thickness at the core and at the rim, as fractions of the disc radius. */
const THICK_CORE = 0.055;
const THICK_RIM = 0.01;
/** Warp amplitude at the rim, as a fraction of the disc radius. */
const WARP = 0.05;
/** Core lens flattening: half-height over radius. A ball read as a cluster stuck on the disc. */
const BULGE_FLAT = 0.42;

const LINK_DISTANCE = 30;
const CHARGE = -30;
/** Pull toward the file's tree direction (scaled into simulation units). Weak: it orients the
 * import clusters without holding them in place. */
const ANCHOR = 0.012;
/** The connected core fills this share of the final radius; unconnected clouds ring it. */
const CORE_SHARE = 0.68;
/**
 * Ticks scale with 1/n: one tick costs ~4-6 µs per node (114 ms at 20k nodes, 3D Barnes-Hut,
 * measured on an M-series Mac), so 800k/n holds a 20k-file graph near 4.5 s. The cap is well
 * under d3's default 300: the bodies start from a sensible arrangement, and at 275 ticks vite's
 * 2.9k files spent 3.0 s here, longer than its whole git history took, for a picture 120 ticks
 * already gives.
 */
const TICK_BUDGET = 800_000;
const MAX_TICKS = 120;
const MIN_TICKS = 12;

// ─── PRNG ────────────────────────────────────────────────────────────────────────────────────

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

const round2 = (x: number) => Math.round(x * 100) / 100;

// ─── Shared measures ─────────────────────────────────────────────────────────────────────────

interface Measures {
  weight: Float64Array; //    per file: √lines + 1
  inDeg: Int32Array; //       per file: code edges pointing at it
  dirWeight: Float64Array; // per dir, recursive
  dirFiles: Int32Array; //    per dir, recursive file count
  dirIn: Float64Array; //     per dir, recursive in-degree
  /** Dirs in pre-order (parents before children), from the root. */
  preorder: number[];
}

function measure(input: LayoutInput): Measures {
  const n = input.fileCount;
  const dirCount = input.dirParent.length;
  const weight = new Float64Array(n);
  for (let f = 0; f < n; f++) weight[f] = Math.sqrt(Math.max(0, input.lines[f] ?? 0)) + 1;
  const inDeg = new Int32Array(n);
  for (const t of input.to) inDeg[t]!++;

  const preorder: number[] = [];
  const stack = dirCount > 0 ? [0] : [];
  while (stack.length > 0) {
    const d = stack.pop()!;
    preorder.push(d);
    const kids = input.dirDirs[d]!;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  const dirWeight = new Float64Array(dirCount);
  const dirFiles = new Int32Array(dirCount);
  const dirIn = new Float64Array(dirCount);
  for (let i = preorder.length - 1; i >= 0; i--) {
    const d = preorder[i]!;
    for (const f of input.dirFiles[d]!) {
      dirWeight[d] = dirWeight[d]! + weight[f]!;
      dirFiles[d]!++;
      dirIn[d] = dirIn[d]! + inDeg[f]!;
    }
    for (const c of input.dirDirs[d]!) {
      dirWeight[d] = dirWeight[d]! + dirWeight[c]!;
      dirFiles[d] = dirFiles[d]! + dirFiles[c]!;
      dirIn[d] = dirIn[d]! + dirIn[c]!;
    }
  }
  return { weight, inDeg, dirWeight, dirFiles, dirIn, preorder };
}

// ─── Beads: one directory's own files, circle-packed ─────────────────────────────────────────

interface Bead {
  dir: number;
  files: number[];
  /** Pack positions relative to the enclosing circle's center. */
  px: Float64Array;
  py: Float64Array;
  /** Enclosing radius. */
  r: number;
  /** In-degree of its files, for ordering siblings. */
  inDeg: number;
}

/**
 * Pack a set of files as circles of radius √weight·UNIT. The most-imported files go first, and
 * d3's sibling packing places the first circles at the center and spirals outward, so the
 * files everything depends on sit in the middle of their bead.
 */
function makeBead(dir: number, fileIds: readonly number[], m: Measures): Bead {
  const files = [...fileIds].sort((a, b) => m.inDeg[b]! - m.inDeg[a]! || m.weight[b]! - m.weight[a]! || a - b);
  const circles = files.map((f) => ({ x: 0, y: 0, r: Math.sqrt(m.weight[f]!) * UNIT }));
  packSiblings(circles);
  const enclose = packEnclose(circles) ?? { x: 0, y: 0, r: UNIT };
  const px = new Float64Array(files.length);
  const py = new Float64Array(files.length);
  let inDeg = 0;
  for (let i = 0; i < files.length; i++) {
    px[i] = circles[i]!.x - enclose.x;
    py[i] = circles[i]!.y - enclose.y;
    inDeg += m.inDeg[files[i]!]!;
  }
  return { dir, files, px, py, r: Math.max(enclose.r, UNIT), inDeg };
}

// ─── Tree (galaxy) ───────────────────────────────────────────────────────────────────────────

type Node = { kind: "dir"; dir: number } | { kind: "bead"; bead: Bead } | { kind: "group"; dir: number; beads: Bead[] };

interface ArmUnit {
  /** The directory the arm draws (a top-level directory, or a child of a split one). */
  dir: number;
  /** Top-level region it belongs to, for keeping split regions' arms adjacent. */
  region: number;
  weight: number;
}

function treeLayout(input: LayoutInput, m: Measures): { tree: Float64Array; radius: number } {
  const n = input.fileCount;
  const tree = new Float64Array(n * 3);
  if (n === 0 || input.dirParent.length === 0) return { tree, radius: 0 };
  const rand = prng(0x5ec7a7);
  const tanP = Math.tan(PITCH);
  const sinP = Math.sin(PITCH);
  const cosP = Math.cos(PITCH);

  // ── Classify the root's children into arms and clusters ──
  const minArm = Math.max(ARM_MIN_FILES, ARM_SHARE * n);
  const byWeight = (a: number, b: number) => m.dirWeight[b]! - m.dirWeight[a]! || a - b;
  const regions = input.dirDirs[0]!.filter((d) => m.dirFiles[d]! > 0).sort(byWeight);
  let units: ArmUnit[] = regions
    .filter((d) => m.dirFiles[d]! >= minArm)
    .slice(0, MAX_ARMS)
    .map((d) => ({ dir: d, region: d, weight: m.dirWeight[d]! }));
  const clusterDirs: number[] = regions.filter((d) => !units.some((u) => u.dir === d));
  const extraBeads: Bead[] = []; // a split region's own files, laid out as a cluster

  // One arm is a lopsided galaxy (a repo that is all `src/` plus root files). Split that region
  // one level: its sizeable children become adjacent arms, so the region stays one contiguous
  // sector, and its own files float as a cluster beside them.
  if (units.length === 1) {
    const only = units[0]!.dir;
    const kids = input.dirDirs[only]!.filter((d) => m.dirFiles[d]! >= ARM_MIN_FILES).sort(byWeight).slice(0, MAX_ARMS);
    if (kids.length >= 2) {
      units = kids.map((d) => ({ dir: d, region: only, weight: m.dirWeight[d]! }));
      const rest = input.dirDirs[only]!.filter((d) => m.dirFiles[d]! > 0 && !kids.includes(d)).sort(byWeight);
      clusterDirs.push(...rest);
      if (input.dirFiles[only]!.length > 0) extraBeads.push(makeBead(only, input.dirFiles[only]!, m));
    }
  }

  // ── Core: the root's own files as the bulge, the small regions packed around it ──
  // Small top-level directories (.github, scripts, .vscode…) used to float as globular
  // clusters out in the halo. That left the middle of the galaxy its darkest part, a ring of
  // empty space between a few root files and the arms' inner ends, which is the opposite of
  // how a galaxy reads. Packed around the root files instead, they make a bright, dense core
  // the arms emerge from, and each cluster is still one contiguous patch.
  const bulge = input.dirFiles[0]!.length > 0 ? makeBead(0, input.dirFiles[0]!, m) : null;
  const clusters: Bead[][] = [];
  for (const d of clusterDirs) {
    // A cluster is its subtree packed hierarchically: subdirectories stay contiguous discs.
    const beads: Bead[] = [];
    const stack = [d];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      if (input.dirFiles[dir]!.length > 0) beads.push(makeBead(dir, input.dirFiles[dir]!, m));
      for (const c of [...input.dirDirs[dir]!].reverse()) if (m.dirFiles[c]! > 0) stack.push(c);
    }
    clusters.push(beads);
  }
  for (const b of extraBeads) clusters.push([b]);
  const clusterRadius: number[] = [];
  const clusterLayouts = clusters.map((beads) => {
    const circles = beads.map((b) => ({ x: 0, y: 0, r: b.r + PADDING[2]! }));
    packSiblings(circles);
    const enc = packEnclose(circles) ?? { x: 0, y: 0, r: UNIT };
    clusterRadius.push(enc.r);
    return circles.map((c) => ({ x: c.x - enc.x, y: c.y - enc.y }));
  });
  // The bulge goes first, so front-chain packing puts it in the middle and wraps the clusters
  // around it, largest first.
  const coreOrder = clusters.map((_, j) => j).sort((a, b) => clusterRadius[b]! - clusterRadius[a]! || a - b);
  const coreCircles = [
    ...(bulge ? [{ x: 0, y: 0, r: bulge.r + PADDING[1]! }] : []),
    ...coreOrder.map((j) => ({ x: 0, y: 0, r: clusterRadius[j]! + PADDING[1]! })),
  ];
  if (coreCircles.length > 0) packSiblings(coreCircles);
  const coreEnc = coreCircles.length > 0 ? (packEnclose(coreCircles) ?? { x: 0, y: 0, r: 0 }) : { x: 0, y: 0, r: 0 };
  const rBulge = coreEnc.r;

  // ── Arms: hierarchy, cell areas, sectors ──
  // Built twice. The first pass sizes the bands; the second splits any directory whose single
  // bead is wider than its band into adjacent chunk beads under one group node, so it stays
  // contiguous. Without the split, a flat directory of 500 files (linguist's vendor licenses)
  // was squeezed into a long cigar by its narrow arm.
  const totalSqrt = units.reduce((s, u) => s + Math.sqrt(u.weight), 0);
  const sector = new Map(units.map((u) => [u.dir, (2 * Math.PI * Math.sqrt(u.weight)) / Math.max(totalSqrt, 1e-9)]));
  const buildArm = (dir: number, maxBeadR: number): HierarchyNode<Node> => {
    const root = hierarchy<Node>({ kind: "dir", dir }, (node) => {
      if (node.kind === "bead") return undefined;
      if (node.kind === "group") return node.beads.map((bead) => ({ kind: "bead", bead }) as Node);
      const d = node.dir;
      const kids: Node[] = [];
      const own = input.dirFiles[d]!;
      if (own.length > 0) {
        const bead = makeBead(d, own, m);
        if (bead.r <= maxBeadR || own.length < 2) kids.push({ kind: "bead", bead });
        else {
          // Chunks in the bead's own order (most-imported first), each small enough to fit.
          const chunks = Math.min(own.length, Math.ceil((bead.r / maxBeadR) ** 2));
          const size = Math.ceil(own.length / chunks);
          const beads: Bead[] = [];
          for (let i = 0; i < bead.files.length; i += size) beads.push(makeBead(d, bead.files.slice(i, i + size), m));
          kids.push({ kind: "group", dir: d, beads });
        }
      }
      for (const c of input.dirDirs[d]!) if (m.dirFiles[c]! > 0) kids.push({ kind: "dir", dir: c });
      return kids;
    });
    root.sum((node) => (node.kind === "bead" ? Math.PI * node.bead.r * node.bead.r * CELL_SLACK : 0));
    const central = (node: Node) =>
      node.kind === "bead" ? node.bead.inDeg : node.kind === "group" ? node.beads.reduce((s, b) => s + b.inDeg, 0) : m.dirIn[node.dir]!;
    const id = (node: Node) => (node.kind === "dir" ? node.dir : -1 - (node.kind === "bead" ? node.bead.dir : node.dir));
    // Most depended-on first: binary treemaps keep order, so it lands at the arm's inner end.
    // Chunks of one group keep their own order (they are already sorted by centrality).
    root.sort((a, b) =>
      a.parent?.data.kind === "group" ? 0 : central(b.data) - central(a.data) || b.value! - a.value! || id(a.data) - id(b.data),
    );
    return root;
  };

  // Each arm is a band of constant real width W = ARM_FILL·Δθ·sin p·r0, the perpendicular room
  // its sector has at r0. Constant width keeps the unrolled rectangle undistorted (a band that
  // widened outward squashed every bead near the core), and because the sector keeps widening
  // the lanes between arms open toward the rim. Length is area / W, so the arm reaches
  // r0 + L·sin p; r0 is chosen so the longest arm reaches ARM_REACH·r0:
  //   L·sin p = A / (ARM_FILL·Δθ·r0) = (ARM_REACH − 1)·r0  ⇒  r0² = A / (ARM_FILL·Δθ·(ARM_REACH − 1)).
  const maxSector = Math.max(0, ...units.map((u) => sector.get(u.dir)!));
  // The band's inner edge dips below r0 by e^(−W/2r0·cos p); keep it clear of the bulge.
  const dip = Math.exp(-0.5 * ARM_FILL * maxSector * sinP * cosP);
  const rootOfArm = new Map<number, HierarchyNode<Node>>();
  // Areas are padded: treemap padding eats into cells, and cells into beads.
  const areaOf = (dir: number) => rootOfArm.get(dir)!.value! * 1.12;
  const solveR0 = () => {
    let r = 0;
    for (const u of units) r = Math.max(r, Math.sqrt(areaOf(u.dir) / (ARM_FILL * sector.get(u.dir)! * (ARM_REACH - 1))));
    return Math.max(r, (rBulge * 1.08) / dip, UNIT * 4);
  };
  for (const u of units) rootOfArm.set(u.dir, buildArm(u.dir, Number.POSITIVE_INFINITY));
  let r0 = solveR0();
  // Chunks never shrink below a few files' worth: a band too narrow for one file is better
  // served by a long bead than by a string of single-file beads.
  const minChunkR = Math.sqrt(40) * UNIT * 2;
  for (const u of units) rootOfArm.set(u.dir, buildArm(u.dir, Math.max(minChunkR, 0.5 * ARM_FILL * sector.get(u.dir)! * sinP * r0 * 0.9)));
  r0 = solveR0();

  // Arm order around the circle: groups (regions) alternate large and small so big arms are
  // spread out; a split region's arms stay adjacent so it remains one sector.
  const groups = new Map<number, ArmUnit[]>();
  for (const u of units) (groups.get(u.region) ?? groups.set(u.region, []).get(u.region)!).push(u);
  const groupList = [...groups.values()];
  const alternated: ArmUnit[][] = [];
  for (let i = 0, j = groupList.length - 1; i <= j; i++, j--) {
    alternated.push(groupList[i]!);
    if (i !== j) alternated.push(groupList[j]!);
  }
  const ordered = alternated.flat();

  let discR = rBulge;
  let theta = rand() * 2 * Math.PI;
  const pendingArms: {
    unit: ArmUnit;
    psi: number;
    span: number;
    rEnd: number;
  }[] = [];
  for (const u of ordered) {
    const span = sector.get(u.dir)!;
    const rEnd = r0 + areaOf(u.dir) / (ARM_FILL * span * r0);
    pendingArms.push({ unit: u, psi: theta + span / 2, span, rEnd });
    discR = Math.max(discR, rEnd);
    theta += span;
  }

  const thickness = (r: number) => discR * (THICK_RIM + (THICK_CORE - THICK_RIM) * Math.exp((-2.5 * r) / discR));
  const warpPhase = rand() * 2 * Math.PI;
  const warp = (r: number, th: number) => {
    const u = Math.max(0, r / discR - 0.45) / 0.55;
    return WARP * discR * u * u * Math.sin(th - warpPhase);
  };

  for (const arm of pendingArms) {
    const root = rootOfArm.get(arm.unit.dir)!;
    // Unrolled rectangle in real units: x is arc length along the arm (r = r0 + x·sin p), y the
    // position across it.
    const width = ARM_FILL * arm.span * sinP * r0;
    const length = areaOf(arm.unit.dir) / width;
    const laid = treemap<Node>()
      .tile(treemapBinary)
      .size([length, width])
      // Chunks of one directory get no gap between them: they are one patch, not siblings.
      .paddingInner((node) =>
        node.data.kind === "group" ? 0 : Math.min(PADDING[Math.min(node.depth, PADDING.length - 1)]!, Math.sqrt(node.value!) * 0.08),
      )
      .round(false)(root);
    // Arms emerge thin from the bulge and thin out at their tips instead of ending square, the
    // way real arms do; only the across offset is scaled, so order and contiguity are kept.
    const smooth = (t: number) => {
      const u = Math.min(1, Math.max(0, t));
      return u * u * (3 - 2 * u);
    };
    const taper = (x: number) => (0.6 + 0.4 * smooth(x / (0.1 * length))) * (1 - 0.55 * smooth((x - 0.72 * length) / (0.28 * length)));
    const toWorld = (x: number, y: number): [number, number, number] => {
      const rc = r0 + Math.max(0, x) * sinP;
      const thc = arm.psi + Math.log(rc / r0) / tanP;
      // Offset perpendicular to the spiral in log-polar coordinates, where the map to the plane
      // is conformal, so a bead bends with the arm but keeps its shape.
      const delta = ((y - width / 2) * taper(x)) / rc;
      const r = rc * Math.exp(delta * cosP);
      const th = thc - delta * sinP;
      return [r * Math.cos(th), r * Math.sin(th), r];
    };
    laid.each((node: HierarchyRectangularNode<Node>) => {
      if (node.data.kind !== "bead") return;
      const bead = node.data.bead;
      const cx = (node.x0 + node.x1) / 2;
      const cy = (node.y0 + node.y1) / 2;
      // Stretch the pack to its cell (an ellipse when the cell is long), so the arm reads as
      // one continuous band of knots rather than beads rattling in oversized boxes. Cells are
      // sized from the bead's own area, so the stretch stays near 1 either way.
      const hx = Math.max(0, (node.x1 - node.x0) / 2) * 0.94;
      const hy = Math.max(0, (node.y1 - node.y0) / 2) * 0.94;
      // The floor keeps a bead from collapsing to a line (or a point) when padding crushed a
      // thin cell; it may then overlap its neighbor slightly, which reads far better than
      // files stacked on one spot.
      const sx = Math.max(0.35, Math.min(1.2, hx / bead.r));
      const sy = Math.max(0.35, Math.min(1.2, hy / bead.r));
      // Whatever slack is left becomes a random offset inside the cell, which breaks up the
      // rows a binary treemap leaves without letting a bead leave its cell. A crushed cell has
      // no slack, so its bead gets a small nudge instead: several crushed cells in one thin
      // strip share a center, and without it their beads would land on one another.
      const crushed = hx < bead.r * 0.35 || hy < bead.r * 0.35;
      const jx = rand() - 0.5;
      const jy = rand() - 0.5;
      const cxj = cx + (crushed ? jx * bead.r : jx * 1.6 * Math.max(0, hx - bead.r * sx));
      const cyj = cy + (crushed ? jy * bead.r : jy * 1.6 * Math.max(0, hy - bead.r * sy));
      const [bx, by, br] = toWorld(cxj, cyj);
      const zc = (rand() * 2 - 1) * 0.5 * thickness(br) + warp(br, Math.atan2(by, bx));
      for (let i = 0; i < bead.files.length; i++) {
        const f = bead.files[i]!;
        const [x, y, r] = toWorld(cxj + bead.px[i]! * sx, cyj + bead.py[i]! * sy);
        const local = Math.min(bead.r * Math.min(sx, sy) * 0.5, thickness(r));
        tree[f * 3] = x;
        tree[f * 3 + 1] = y;
        tree[f * 3 + 2] = zc + (rand() + rand() - 1) * local;
      }
    });
  }

  // ── Core placement: a lens, thick in the middle and thin at its rim ──
  // Every file in the core gets its height from the lens profile at its distance from the
  // center, so the bulge has volume when orbited, and the clusters ride its surface.
  const lens = (x: number, y: number) => {
    const d = Math.hypot(x, y) / Math.max(rBulge, 1e-9);
    return Math.sqrt(Math.max(0, 1 - d * d)) * rBulge * BULGE_FLAT;
  };
  const placeCore = (bead: Bead, ox: number, oy: number) => {
    for (let i = 0; i < bead.files.length; i++) {
      const f = bead.files[i]!;
      const x = ox + bead.px[i]!;
      const y = oy + bead.py[i]!;
      tree[f * 3] = x;
      tree[f * 3 + 1] = y;
      tree[f * 3 + 2] = (rand() + rand() - 1) * lens(x, y);
    }
  };
  let ci = 0;
  if (bulge) {
    const c = coreCircles[ci++]!;
    placeCore(bulge, c.x - coreEnc.x, c.y - coreEnc.y);
  }
  for (const j of coreOrder) {
    const c = coreCircles[ci++]!;
    clusters[j]!.forEach((bead, k) => {
      const bc = clusterLayouts[j]![k]!;
      placeCore(bead, c.x - coreEnc.x + bc.x, c.y - coreEnc.y + bc.y);
    });
  }
  let radius = 0;
  for (let f = 0; f < n; f++) {
    tree[f * 3] = round2(tree[f * 3]!);
    tree[f * 3 + 1] = round2(tree[f * 3 + 1]!);
    tree[f * 3 + 2] = round2(tree[f * 3 + 2]!);
    radius = Math.max(radius, Math.hypot(tree[f * 3]!, tree[f * 3 + 1]!, tree[f * 3 + 2]!));
  }
  return { tree, radius: round2(radius) };
}

/**
 * Directory centers and radii from the placed files: centroid of every descendant, and the
 * distance to the farthest one plus its circle. The viewer frames a drawer's bounding sphere
 * with these and draws region geometry around them, so they describe where the files really
 * are, whatever shape the layout gave the directory.
 */
function dirGeometry(input: LayoutInput, m: Measures, pos: Float64Array): { centers: Float64Array; radii: Float64Array } {
  const dirCount = input.dirParent.length;
  const centers = new Float64Array(dirCount * 3);
  const radii = new Float64Array(dirCount);
  const count = new Float64Array(dirCount);
  for (let f = 0; f < input.fileCount; f++) {
    for (let d = input.fileDir[f]!; d >= 0; d = input.dirParent[d]!) {
      centers[d * 3] = centers[d * 3]! + pos[f * 3]!;
      centers[d * 3 + 1] = centers[d * 3 + 1]! + pos[f * 3 + 1]!;
      centers[d * 3 + 2] = centers[d * 3 + 2]! + pos[f * 3 + 2]!;
      count[d]!++;
    }
  }
  for (let d = 0; d < dirCount; d++) {
    const c = Math.max(1, count[d]!);
    centers[d * 3] = centers[d * 3]! / c;
    centers[d * 3 + 1] = centers[d * 3 + 1]! / c;
    centers[d * 3 + 2] = centers[d * 3 + 2]! / c;
  }
  for (let f = 0; f < input.fileCount; f++) {
    const leaf = Math.sqrt(m.weight[f]!) * UNIT;
    for (let d = input.fileDir[f]!; d >= 0; d = input.dirParent[d]!) {
      const r = Math.hypot(pos[f * 3]! - centers[d * 3]!, pos[f * 3 + 1]! - centers[d * 3 + 1]!, pos[f * 3 + 2]! - centers[d * 3 + 2]!) + leaf;
      if (r > radii[d]!) radii[d] = r;
    }
  }
  for (let i = 0; i < centers.length; i++) centers[i] = round2(centers[i]!);
  for (let d = 0; d < dirCount; d++) radii[d] = round2(radii[d]!);
  return { centers, radii };
}

// ─── Graph (force) ───────────────────────────────────────────────────────────────────────────

interface Body extends SimNode {
  tx: number;
  ty: number;
  tz: number;
}

export function forceTicks(nodes: number): number {
  return Math.max(MIN_TICKS, Math.min(MAX_TICKS, Math.round(TICK_BUDGET / Math.max(1, nodes))));
}

/** Top-level region per file: the root's child it sits under, or 0 for root files. */
function regionOf(input: LayoutInput): Int32Array {
  const out = new Int32Array(input.fileCount);
  for (let f = 0; f < input.fileCount; f++) {
    let d = input.fileDir[f]!;
    while (d > 0 && input.dirParent[d]! > 0) d = input.dirParent[d]!;
    out[f] = Math.max(0, d);
  }
  return out;
}

function graphLayout(input: LayoutInput, tree: Float64Array, treeRadius: number): { graph: Float64Array; radius: number } {
  const n = input.fileCount;
  const graph = Float64Array.from(tree);
  const radiusOf = () => {
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(graph[i * 3]!, graph[i * 3 + 1]!, graph[i * 3 + 2]!));
    return round2(r);
  };
  if (n === 0 || input.from.length === 0 || treeRadius <= 0) return { graph, radius: radiusOf() };

  // Bodies in file-id order, so the simulation (and its seeded jiggle) sees the same sequence
  // on every run.
  const touched = new Uint8Array(n);
  for (let k = 0; k < input.from.length; k++) {
    touched[input.from[k]!] = 1;
    touched[input.to[k]!] = 1;
  }
  const slot = new Int32Array(n).fill(-1);
  const bodies: Body[] = [];
  // Start in a ball the size the force balance settles to, with each file on its tree side.
  const simR = LINK_DISTANCE * Math.cbrt(Math.max(1, input.from.length)) * 1.3;
  const toSim = simR / treeRadius;
  for (let f = 0; f < n; f++) {
    if (!touched[f]) continue;
    const x = tree[f * 3]! * toSim;
    const y = tree[f * 3 + 1]! * toSim;
    const z = tree[f * 3 + 2]! * toSim * 4; // a little volume: the tree is a thin disc
    slot[f] = bodies.length;
    bodies.push({ index: bodies.length, x, y, z, tx: x, ty: y, tz: z });
  }
  const links = input.from.map((s, k) => ({ source: slot[s]!, target: slot[input.to[k]!]! }));
  const mCount = bodies.length;
  const ticks = forceTicks(mCount);
  const sim = forceSimulation<Body>(bodies, 3)
    .stop() // headless: no timer, ticks are driven below
    .randomSource(prng(0x6a09e667))
    .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
    .force("link", forceLink<Body>(links).distance(LINK_DISTANCE))
    .force("charge", forceManyBody<Body>().strength(CHARGE).theta(0.9))
    .force("x", forceX<Body>((d) => d.tx).strength(ANCHOR))
    .force("y", forceY<Body>((d) => d.ty).strength(ANCHOR))
    .force("z", forceZ<Body>((d) => d.tz).strength(ANCHOR));
  sim.tick(ticks);

  // Center the connected core and scale it to CORE_SHARE of the tree radius, using a high
  // percentile so one far-flung pair does not shrink everything else; the few beyond it are
  // pulled in to the rim of the core along their own direction.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const b of bodies) {
    cx += b.x!;
    cy += b.y!;
    cz += b.z!;
  }
  cx /= mCount;
  cy /= mCount;
  cz /= mCount;
  const dists = bodies.map((b) => Math.hypot(b.x! - cx, b.y! - cy, b.z! - cz)).sort((a, b) => a - b);
  const p98 = Math.max(dists[Math.floor((dists.length - 1) * 0.98)] ?? 1, 1e-6);
  const coreR = treeRadius * CORE_SHARE;
  const scale = coreR / p98;
  for (let f = 0; f < n; f++) {
    const i = slot[f]!;
    if (i < 0) continue;
    const b = bodies[i]!;
    let x = (b.x! - cx) * scale;
    let y = (b.y! - cy) * scale;
    let z = (b.z! - cz) * scale;
    const d = Math.hypot(x, y, z);
    if (d > coreR * 1.1) {
      // Compress the tail instead of clamping it, so outliers keep their order and never stack.
      const k = (coreR * (1.1 + 0.1 * Math.tanh((d - coreR * 1.1) / coreR))) / d;
      x *= k;
      y *= k;
      z *= k;
    }
    graph[f * 3] = x;
    graph[f * 3 + 1] = y;
    graph[f * 3 + 2] = z;
  }

  // Unconnected files: per region, a flat Vogel disc beside the core on the side where the
  // region's connected files went (or, for a region with none, the side it occupies in the
  // tree). A compacted copy of the region's tree shape was tried first; a long arm stayed long
  // and flung its copy far out, shrinking the core once the whole was fitted to the radius.
  const region = regionOf(input);
  const groups = new Map<number, { cx: number; cy: number; c: number; tx: number; ty: number; files: number[] }>();
  for (let f = 0; f < n; f++) {
    const g = region[f]!;
    let s = groups.get(g);
    if (!s) groups.set(g, (s = { cx: 0, cy: 0, c: 0, tx: 0, ty: 0, files: [] }));
    s.tx += tree[f * 3]!;
    s.ty += tree[f * 3 + 1]!;
    if (slot[f]! >= 0) {
      s.cx += graph[f * 3]!;
      s.cy += graph[f * 3 + 1]!;
      s.c++;
    } else s.files.push(f);
  }
  // Spacing: the core's typical neighbor distance, so the discs read at the core's density.
  const spacing = LINK_DISTANCE * scale * 0.55;
  const discs: { g: number; files: number[]; r: number; x: number; y: number }[] = [];
  for (const [g, s] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (s.files.length === 0) continue;
    let dx = s.c > 0 ? s.cx / s.c : s.tx;
    let dy = s.c > 0 ? s.cy / s.c : s.ty;
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // Root files have no side; give them one that is stable across runs.
      dx = 1;
      dy = 0;
      len = 1;
    }
    const r = spacing * Math.sqrt(s.files.length) * 0.9 + spacing;
    const out = coreR + r + spacing * 2;
    discs.push({ g, files: s.files, r, x: (dx / len) * out, y: (dy / len) * out });
  }
  // Relax overlapping discs apart, keeping each outside the core.
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!;
        const b = discs[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const need = a.r + b.r + spacing;
        if (dist >= need) continue;
        const push = (need - dist) / 2 / dist;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        moved = true;
      }
    }
    for (const d of discs) {
      const len = Math.hypot(d.x, d.y) || 1e-6;
      const min = coreR + d.r + spacing * 2;
      if (len < min) {
        d.x *= min / len;
        d.y *= min / len;
      }
    }
    if (!moved) break;
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const d of discs) {
    // Files in directory order, so a directory's files sit on neighboring turns of the disc.
    d.files.forEach((f, k) => {
      const rr = spacing * 0.9 * Math.sqrt(k + 0.5);
      const a = k * golden;
      graph[f * 3] = d.x + rr * Math.cos(a);
      graph[f * 3 + 1] = d.y + rr * Math.sin(a);
      graph[f * 3 + 2] = tree[f * 3 + 2]! * 0.5;
    });
  }

  // Same overall radius as the tree, so the camera framing holds across the morph.
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(graph[i * 3]!, graph[i * 3 + 1]!, graph[i * 3 + 2]!));
  const fit = r > 0 ? treeRadius / r : 1;
  for (let i = 0; i < graph.length; i++) graph[i] = round2(graph[i]! * fit);
  return { graph, radius: radiusOf() };
}

// ─── computeLayout ───────────────────────────────────────────────────────────────────────────

export function computeLayout(input: LayoutInput): Layouts {
  const m = measure(input);
  const t = treeLayout(input, m);
  const geo = dirGeometry(input, m, t.tree);
  const g = graphLayout(input, t.tree, t.radius);
  return {
    tree: Array.from(t.tree),
    graph: Array.from(g.graph),
    dirCenters: Array.from(geo.centers),
    dirRadius: Array.from(geo.radii),
    radius: { tree: t.radius, graph: g.radius },
  };
}
