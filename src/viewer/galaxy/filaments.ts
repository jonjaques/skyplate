/**
 * Geometry for the web's filaments: every strand between coupled clusters in one LineSegments.
 *
 * The strand set is the default web's (src/shared/web.ts): it depends on import coupling alone,
 * so every gravity shares it and only the endpoints move. Each strand is sampled along its
 * Bézier in both of the engine's slots, so it follows the morph exactly as the stars do, and is
 * rebuilt whenever the engine retargets.
 *
 * Which strands light up is decided in the shader from depth-first file ranges (Model.dirStart
 * and dirEnd): a cluster is one contiguous range, so is any group at any depth, and "this strand
 * touches that group" is two interval tests. Hovering a group uploads two numbers, not a buffer.
 */

import * as THREE from "three";
import type { Target } from "../state/store";
import type { GalaxyEngine } from "./engine";

/** Segments per strand: smooth at plate scale, cheap at a few hundred strands. */
const STEPS = 20;
/**
 * Strands add up where they cross (the blend is additive). A fixed strength that reads as a
 * whisper at fifty strands turned vite's web into a gray haze; past this many, every strand
 * dims with the square root of the count.
 */
const STRAND_BUDGET = 90;

/** A cluster's depth-first file range [lo, hi): its own files only, or its whole subtree. */
function clusterRange(engine: GalaxyEngine, dir: number, own: boolean): [number, number] {
  const m = engine.model;
  const lo = m.dirStart[dir]!;
  return [lo, own ? lo + m.report.dirs[dir]!.files.length : m.dirEnd[dir]!];
}

export function buildFilamentGeometry(engine: GalaxyEngine): { geometry: THREE.BufferGeometry; gain: number } | null {
  const fil = engine.filaments;
  const F = fil.a.length;
  if (F === 0) return null;
  const clusters = engine.clusters;
  const from = engine.curves("from");
  const to = engine.curves("to");
  const verts = F * STEPS * 2;
  const pos = new Float32Array(verts * 3);
  const tpos = new Float32Array(verts * 3);
  const tAttr = new Float32Array(verts);
  const weight = new Float32Array(verts);
  const range = new Float32Array(verts * 4);
  let v = 0;
  const put = (i: number, t: number) => {
    const u = 1 - t;
    for (let j = 0; j < 3; j++) {
      pos[v * 3 + j] = u * u * from[i * 9 + j]! + 2 * u * t * from[i * 9 + 3 + j]! + t * t * from[i * 9 + 6 + j]!;
      tpos[v * 3 + j] = u * u * to[i * 9 + j]! + 2 * u * t * to[i * 9 + 3 + j]! + t * t * to[i * 9 + 6 + j]!;
    }
    tAttr[v] = t;
    weight[v] = fil.weight[i]!;
    const a = fil.a[i]!;
    const b = fil.b[i]!;
    const ra = clusterRange(engine, clusters.dir[a]!, clusters.own[a] === 1);
    const rb = clusterRange(engine, clusters.dir[b]!, clusters.own[b] === 1);
    range[v * 4] = ra[0];
    range[v * 4 + 1] = ra[1];
    range[v * 4 + 2] = rb[0];
    range[v * 4 + 3] = rb[1];
    v++;
  };
  for (let i = 0; i < F; i++) {
    for (let s = 0; s < STEPS; s++) {
      put(i, s / STEPS);
      put(i, (s + 1) / STEPS);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aTo", new THREE.BufferAttribute(tpos, 3));
  g.setAttribute("aT", new THREE.BufferAttribute(tAttr, 1));
  g.setAttribute("aWeight", new THREE.BufferAttribute(weight, 1));
  g.setAttribute("aRange", new THREE.BufferAttribute(range, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), engine.radius * 1.3);
  return { geometry: g, gain: Math.min(1, Math.sqrt(STRAND_BUDGET / F)) };
}

const NONE: [number, number] = [-1, -1];

/**
 * The file ranges whose strands light up: the hovered group, the selected group (or a selected
 * file's cluster), and the open drawer. The root is never one: its range is everything.
 */
export function filamentRanges(
  engine: GalaxyEngine,
  { hover, selection, focusDir }: { hover: Target | null; selection: Target | null; focusDir: number | null },
): { hover: [number, number]; selection: [number, number]; focus: [number, number]; any: boolean } {
  const m = engine.model;
  const dirRange = (d: number): [number, number] => (d > 0 ? [m.dirStart[d]!, m.dirEnd[d]!] : NONE);
  const h = hover?.kind === "dir" ? dirRange(hover.id) : NONE;
  let sel = NONE;
  if (selection?.kind === "dir") sel = dirRange(selection.id);
  else if (selection?.kind === "file") {
    const k = engine.fileCluster[selection.id];
    if (k !== undefined) {
      const c = engine.clusters;
      const r = clusterRange(engine, c.dir[k]!, c.own[k] === 1);
      // A selected root file's cluster is the root's own files; that range is still small.
      sel = r;
    }
  }
  const f = focusDir !== null ? dirRange(focusDir) : NONE;
  return { hover: h, selection: sel, focus: f, any: h[0] >= 0 || sel[0] >= 0 || f[0] >= 0 };
}
