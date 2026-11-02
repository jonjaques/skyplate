/// <reference path="./d3-force-3d.d.ts" />
/**
 * 3D positions for the import-graph layout. Written once by the analyzer so the viewer never
 * runs this simulation (a 20k-node force layout in the browser is seconds of jank on every open).
 *
 *   computeLayout(input) → Layouts       (pure; runs on a pool worker in the pipeline)
 *
 * The galaxy's default layout, the cosmic web of the directory tree, is not computed here for
 * the report: the viewer computes it (src/shared/web.ts) for whichever gravity the reader picks.
 * This module computes the default web too, only to anchor the graph to it.
 *
 * ── Graph ──
 *
 * d3-force-3d over code edges (links, Barnes-Hut many-body) with a weak pull toward each file's
 * direction in the default web, so a region's import cluster lands on its region's side and the
 * morph between the two layouts stays legible. Files with no code edges are not simulated (they
 * have nothing to be pulled toward): each region's unconnected files gather in a flat disc just
 * outside the connected core, on the region's side. The result is scaled to the web's radius so
 * the camera framing holds across the morph.
 *
 * Deterministic: bodies are added in file-id order, jitter comes from a fixed-seed PRNG, and the
 * simulation's tick count depends on the graph size alone (never on elapsed time).
 */

import { forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimNode } from "d3-force-3d";
import type { Layouts } from "../shared/schema";
import { computeWeb, DEFAULT_GRAVITY, type WebInput } from "../shared/web";

export interface LayoutInput {
  fileCount: number;
  /** Directory id per file. */
  fileDir: number[];
  /** Directory tree: parent (-1 for the root), direct child directories and files. */
  dirParent: number[];
  dirDirs: number[][];
  dirFiles: number[][];
  /** Distinct, non-self code edges (no doc links). */
  from: number[];
  to: number[];
  /** Direct importers and PageRank per file: the default gravity's measures (see web.ts). */
  fanIn: number[];
  rank: number[];
}

// ─── Tuning ──────────────────────────────────────────────────────────────────────────────────

const LINK_DISTANCE = 30;
const CHARGE = -30;
/** Pull toward the file's web direction (scaled into simulation units). Weak: it orients the
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

function graphLayout(input: LayoutInput, web: Float32Array, webRadius: number): Float64Array {
  const n = input.fileCount;
  const graph = Float64Array.from(web);
  if (n === 0 || input.from.length === 0 || webRadius <= 0) return graph;

  // Bodies in file-id order, so the simulation (and its seeded jiggle) sees the same sequence
  // on every run.
  const touched = new Uint8Array(n);
  for (let k = 0; k < input.from.length; k++) {
    touched[input.from[k]!] = 1;
    touched[input.to[k]!] = 1;
  }
  const slot = new Int32Array(n).fill(-1);
  const bodies: Body[] = [];
  // Start in a ball the size the force balance settles to, with each file on its web side.
  const simR = LINK_DISTANCE * Math.cbrt(Math.max(1, input.from.length)) * 1.3;
  const toSim = simR / webRadius;
  for (let f = 0; f < n; f++) {
    if (!touched[f]) continue;
    const x = web[f * 3]! * toSim;
    const y = web[f * 3 + 1]! * toSim;
    const z = web[f * 3 + 2]! * toSim;
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

  // Center the connected core and scale it to CORE_SHARE of the web's radius, using a high
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
  const coreR = webRadius * CORE_SHARE;
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
  // web), facing outward. A compacted copy of the region's own shape was tried first (for the
  // spiral layout this replaced); a long region stayed long and flung its copy far out,
  // shrinking the core once the whole was fitted to the radius.
  const region = regionOf(input);
  type Group = { c: number; cx: number; cy: number; cz: number; tx: number; ty: number; tz: number; files: number[] };
  const groups = new Map<number, Group>();
  for (let f = 0; f < n; f++) {
    const g = region[f]!;
    let s = groups.get(g);
    if (!s) groups.set(g, (s = { c: 0, cx: 0, cy: 0, cz: 0, tx: 0, ty: 0, tz: 0, files: [] }));
    s.tx += web[f * 3]!;
    s.ty += web[f * 3 + 1]!;
    s.tz += web[f * 3 + 2]!;
    if (slot[f]! >= 0) {
      s.cx += graph[f * 3]!;
      s.cy += graph[f * 3 + 1]!;
      s.cz += graph[f * 3 + 2]!;
      s.c++;
    } else s.files.push(f);
  }
  // Spacing: the core's typical neighbor distance, so the discs read at the core's density.
  const spacing = LINK_DISTANCE * scale * 0.55;
  const discs: { files: number[]; r: number; x: number; y: number; z: number }[] = [];
  for (const [, s] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (s.files.length === 0) continue;
    let dx = s.c > 0 ? s.cx / s.c : s.tx;
    let dy = s.c > 0 ? s.cy / s.c : s.ty;
    let dz = s.c > 0 ? s.cz / s.c : s.tz;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) {
      // Root files have no side; give them one that is stable across runs.
      dx = 1;
      dy = 0;
      dz = 0;
      len = 1;
    }
    const r = spacing * Math.sqrt(s.files.length) * 0.9 + spacing;
    const out = coreR + r + spacing * 2;
    discs.push({ files: s.files, r, x: (dx / len) * out, y: (dy / len) * out, z: (dz / len) * out });
  }
  // Relax overlapping discs apart (as spheres of their radius), keeping each outside the core.
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!;
        const b = discs[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const need = a.r + b.r + spacing;
        if (dist >= need) continue;
        const push = (need - dist) / 2 / dist;
        a.x -= dx * push;
        a.y -= dy * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.y += dy * push;
        b.z += dz * push;
        moved = true;
      }
    }
    for (const d of discs) {
      const len = Math.hypot(d.x, d.y, d.z) || 1e-6;
      const min = coreR + d.r + spacing * 2;
      if (len < min) {
        d.x *= min / len;
        d.y *= min / len;
        d.z *= min / len;
      }
    }
    if (!moved) break;
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const d of discs) {
    // The disc faces outward: its plane is perpendicular to the direction from the center.
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const nx = d.x / len;
    const ny = d.y / len;
    const nz = d.z / len;
    // u ⟂ n (n × up, or n × x when n is vertical), v = n × u.
    let ux = ny;
    let uy = -nx;
    let uz = 0;
    if (Math.hypot(ux, uy) < 1e-6) {
      ux = 0;
      uy = nz;
      uz = -ny;
    }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    // Files in directory order, so a directory's files sit on neighboring turns of the disc.
    d.files.forEach((f, k) => {
      const rr = spacing * 0.9 * Math.sqrt(k + 0.5);
      const a = k * golden;
      const c = Math.cos(a) * rr;
      const s = Math.sin(a) * rr;
      // A sliver of thickness, so the disc has volume when orbited edge-on.
      const t = ((k % 7) - 3) * spacing * 0.06;
      graph[f * 3] = d.x + ux * c + vx * s + nx * t;
      graph[f * 3 + 1] = d.y + uy * c + vy * s + ny * t;
      graph[f * 3 + 2] = d.z + uz * c + vz * s + nz * t;
    });
  }

  // Same overall radius as the web, so the camera framing holds across the morph.
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(graph[i * 3]!, graph[i * 3 + 1]!, graph[i * 3 + 2]!));
  const fit = r > 0 ? webRadius / r : 1;
  for (let i = 0; i < graph.length; i++) graph[i] = graph[i]! * fit;
  return graph;
}

// ─── computeLayout ───────────────────────────────────────────────────────────────────────────

/** The web's input from the analyzer's tables (the viewer builds the same from the report). */
export function webInputOf(input: LayoutInput): WebInput {
  return {
    fileCount: input.fileCount,
    fileDir: input.fileDir,
    dirParent: input.dirParent,
    dirDirs: input.dirDirs,
    dirFiles: input.dirFiles,
    from: input.from,
    to: input.to,
    metrics: { fanIn: input.fanIn, rank: input.rank },
  };
}

export function computeLayout(input: LayoutInput): Layouts {
  const web = computeWeb(webInputOf(input), DEFAULT_GRAVITY);
  const g = graphLayout(input, web.positions, web.radius);
  let radius = 0;
  const graph = new Array<number>(g.length);
  for (let i = 0; i < g.length; i++) graph[i] = round2(g[i]!);
  for (let f = 0; f < input.fileCount; f++) radius = Math.max(radius, Math.hypot(graph[f * 3]!, graph[f * 3 + 1]!, graph[f * 3 + 2]!));
  return { graph, radius: round2(radius) };
}
