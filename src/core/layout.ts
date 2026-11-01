/// <reference path="./d3-force-3d.d.ts" />
/**
 * 3D positions for every file: the "tree" galaxy from the directory hierarchy and the "graph"
 * layout from the import graph. Written once by the analyzer so the viewer never runs a
 * simulation (a 20k-node force layout in the browser is seconds of jank on every open).
 *
 *   computeLayout(input) → Layouts       (pure; runs on a pool worker in the pipeline)
 *
 * Tree: hierarchical circle packing (d3-hierarchy), so every directory is one contiguous disc
 * and its subdirectories nest inside it. The flat pack is then twisted into a logarithmic
 * spiral (angle += K·ln(1 + r/r0)): the twist is a continuous bijection of the plane, so discs
 * shear into spiral arms but never overlap or split, and a directory stays one cluster. A thin
 * z thickness that shrinks toward the rim gives the bulge-and-disc profile, and small
 * per-directory z offsets keep sibling clusters from reading as one sheet when seen edge on.
 *
 * Graph: d3-force-3d over code edges (links, Barnes-Hut many-body) plus a weak pull toward each
 * file's tree position. Without that pull, the import clusters fly apart into a featureless
 * shell; with it they gather across directories but stay registered with the galaxy, and
 * files with no imports keep their place, so the two layouts morph into each other.
 *
 * Deterministic: the pack uses d3's seeded LCG, the jitter here a fixed-seed PRNG consumed in
 * file-id order, and the simulation's tick count is a function of the graph size alone (never
 * of elapsed time), so re-running on the same tree gives the same picture.
 */

import { hierarchy, pack, type HierarchyCircularNode, type HierarchyNode } from "d3";
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

/** Leaf radius per √weight. With weights √lines + 1 a typical file is 6–15 units across. */
const UNIT = 3;
/** Gap between sibling circles; shrinks with depth so deep trees do not balloon. */
const PADDING = [14, 8, 5, 3, 2];
/** Spiral twist: rim rotates ~1.5 rad against the core. More reads as a whirlpool. */
const TWIST = 0.75;
const TWIST_CORE = 0.15;
/** Half-thickness at the core and at the rim, as fractions of the galaxy radius. */
const THICK_CORE = 0.07;
const THICK_RIM = 0.012;
/** Per-directory z offset at depth 1, as a fraction of the local thickness. */
const DIR_OFFSET = 0.6;

const LINK_DISTANCE = 30;
const CHARGE = -30;
/** Pull toward the tree position. Strong enough to hold isolated files, weak enough that an
 * import cluster can still gather across directories. */
const ANCHOR = 0.04;
/**
 * Ticks scale with 1/n: one tick costs ~4-6 µs per node (114 ms at 20k nodes, 3D Barnes-Hut,
 * measured on an M-series Mac), so 800k/n holds a 20k-file graph near 4.5 s. The cap is well
 * under d3's default 300 because the bodies start at their tree positions, not at random, and
 * the anchor settles them early: at 275 ticks vite's 2.9k files spent 3.0 s here, longer than
 * its whole git history took, for a picture 120 ticks already gives.
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

// ─── Tree (galaxy) ───────────────────────────────────────────────────────────────────────────

interface Datum {
  dir: number; //  directory id, or -1 for a file
  file: number; // file id, or -1 for a directory
}

function treeLayout(input: LayoutInput): { tree: Float64Array; centers: Float64Array; radii: Float64Array; radius: number } {
  const n = input.fileCount;
  const dirCount = input.dirParent.length;
  const tree = new Float64Array(n * 3);
  const centers = new Float64Array(dirCount * 3);
  const radii = new Float64Array(dirCount);
  if (n === 0 || dirCount === 0) return { tree, centers, radii, radius: 0 };

  const root = hierarchy<Datum>({ dir: 0, file: -1 }, (d) =>
    d.dir < 0
      ? undefined
      : [
          ...input.dirDirs[d.dir]!.map((dir) => ({ dir, file: -1 })),
          ...input.dirFiles[d.dir]!.map((file) => ({ dir: -1, file })),
        ],
  );
  root
    .sum((d) => (d.file >= 0 ? Math.sqrt(Math.max(0, input.lines[d.file] ?? 0)) + 1 : 0))
    // Largest first packs tightest; ids break ties so equal weights never depend on sort
    // stability.
    .sort((a, b) => b.value! - a.value! || key(a) - key(b));
  const packed = pack<Datum>()
    .radius((d) => Math.sqrt(d.value!) * UNIT)
    .padding((d) => PADDING[Math.min(d.depth, PADDING.length - 1)]!)(root);

  const R = Math.max(packed.r, 1);
  const cx = packed.x;
  const cy = packed.y;
  const twist = (x: number, y: number): [number, number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx) + TWIST * Math.log1p(r / (TWIST_CORE * R));
    return [r * Math.cos(a), r * Math.sin(a), r];
  };
  const thickness = (r: number) => R * (THICK_RIM + (THICK_CORE - THICK_RIM) * Math.exp((-3 * r) / R));

  // Directories first, parents before children, so each offset builds on its parent's.
  const dirZ = new Float64Array(dirCount);
  const rand = prng(0x5ec7a7);
  const nodes: HierarchyCircularNode<Datum>[] = [];
  packed.eachBefore((node) => nodes.push(node));
  for (const node of nodes) {
    const d = node.data.dir;
    if (d < 0) continue;
    const [x, y, r] = twist(node.x, node.y);
    const parent = input.dirParent[d]!;
    const depth = input.dirDepth[d]!;
    dirZ[d] = parent < 0 ? 0 : dirZ[parent]! + (rand() * 2 - 1) * DIR_OFFSET * thickness(r) / depth;
    centers[d * 3] = round2(x);
    centers[d * 3 + 1] = round2(y);
    centers[d * 3 + 2] = round2(dirZ[d]!);
    radii[d] = round2(node.r);
  }
  let radius = 0;
  for (const node of nodes) {
    const f = node.data.file;
    if (f < 0) continue;
    const [x, y, r] = twist(node.x, node.y);
    // Sum of two uniforms: a soft triangular profile, densest at the midplane.
    const z = dirZ[input.fileDir[f]!]! + (rand() + rand() - 1) * thickness(r);
    tree[f * 3] = round2(x);
    tree[f * 3 + 1] = round2(y);
    tree[f * 3 + 2] = round2(z);
    radius = Math.max(radius, Math.hypot(x, y, z));
  }
  return { tree, centers, radii, radius: round2(radius) };
}

const key = (n: HierarchyNode<Datum>) => (n.data.file >= 0 ? n.data.file : 1e9 + n.data.dir);

// ─── Graph (force) ───────────────────────────────────────────────────────────────────────────

interface Body extends SimNode {
  tx: number;
  ty: number;
  tz: number;
}

export function forceTicks(nodes: number): number {
  return Math.max(MIN_TICKS, Math.min(MAX_TICKS, Math.round(TICK_BUDGET / Math.max(1, nodes))));
}

/**
 * Only files with at least one code edge are simulated; the rest keep their tree position,
 * which is exactly where the anchor force would hold them anyway. Simulating them costs the
 * same per node as the connected core: linguist (4,329 files, 123 connected) spent 1.7 s here
 * moving files that have nothing to be pulled toward.
 */
function graphLayout(input: LayoutInput, tree: Float64Array): { graph: Float64Array; radius: number } {
  const n = input.fileCount;
  const graph = Float64Array.from(tree);
  const radiusOf = () => {
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(graph[i * 3]!, graph[i * 3 + 1]!, graph[i * 3 + 2]!));
    return round2(r);
  };
  if (n === 0 || input.from.length === 0) return { graph, radius: radiusOf() };

  const slot = new Int32Array(n).fill(-1);
  const bodies: Body[] = [];
  const add = (f: number) => {
    if (slot[f]! >= 0) return slot[f]!;
    const x = tree[f * 3]!;
    const y = tree[f * 3 + 1]!;
    const z = tree[f * 3 + 2]!;
    slot[f] = bodies.length;
    bodies.push({ index: bodies.length, x, y, z, tx: x, ty: y, tz: z });
    return slot[f]!;
  };
  // Bodies in file-id order, so the simulation (and its seeded jiggle) sees the same sequence
  // on every run.
  const touched = new Uint8Array(n);
  for (let k = 0; k < input.from.length; k++) {
    touched[input.from[k]!] = 1;
    touched[input.to[k]!] = 1;
  }
  for (let f = 0; f < n; f++) if (touched[f]) add(f);
  const links = input.from.map((s, k) => ({ source: slot[s]!, target: slot[input.to[k]!]! }));
  const m = bodies.length;
  const ticks = forceTicks(m);
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

  // Charge pushes the connected core's centroid off its anchors' centroid; shift it back, so
  // the core stays registered with the files that did not move.
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const b of bodies) {
    dx += b.x! - b.tx;
    dy += b.y! - b.ty;
    dz += b.z! - b.tz;
  }
  dx /= m;
  dy /= m;
  dz /= m;
  for (let f = 0; f < n; f++) {
    const i = slot[f]!;
    if (i < 0) continue;
    const b = bodies[i]!;
    graph[f * 3] = round2(b.x! - dx);
    graph[f * 3 + 1] = round2(b.y! - dy);
    graph[f * 3 + 2] = round2(b.z! - dz);
  }
  return { graph, radius: radiusOf() };
}

// ─── computeLayout ───────────────────────────────────────────────────────────────────────────

export function computeLayout(input: LayoutInput): Layouts {
  const t = treeLayout(input);
  const g = graphLayout(input, t.tree);
  return {
    tree: Array.from(t.tree),
    graph: Array.from(g.graph),
    dirCenters: Array.from(t.centers),
    dirRadius: Array.from(t.radii),
    radius: { tree: t.radius, graph: g.radius },
  };
}
