/**
 * Geometry for lanes: import edges and symbol arcs, built as one LineSegments per group.
 *
 * Each lane carries both layouts' endpoints so it follows the tree/graph morph in the vertex
 * shader, plus t (0 at the importer or referencing file, 1 at the dependency or definition),
 * which the fragment shader turns into direction: brightness, drifting dashes, pulses.
 */

import * as THREE from "three";
import { LANE_FRAGMENT, LANE_VERTEX } from "./shaders";

export const LANE_STYLE = { import: 0, call: 1, other: 2, callee: 3, all: 4 } as const;

/** How far a symbol's reference arcs bow off the disc, per unit of span (see Lane.lift). */
export const ARC_LIFT = 0.32;
/** Arcs drawn per symbol: past a few hundred they fog the stars they connect. */
export const ARC_CAP = 600;

/**
 * Where a lane with `lift` peaks: a quadratic bezier's apex sits halfway to its control point,
 * so framing a symbol's neighborhood can include the arcs, not just their ends.
 */
export function laneApex(a: THREE.Vector3, b: THREE.Vector3, lift: number, out: THREE.Vector3): THREE.Vector3 {
  const d = a.distanceTo(b);
  out.addVectors(a, b).multiplyScalar(0.5);
  out.z += d * lift * 0.5;
  return out;
}

export interface Lane {
  from: number;
  to: number;
  style: number;
  /** 0-1 strength (call count, log-scaled). */
  weight: number;
  /** Lift the lane off the disc as a curve: 0 is straight, positive bows up, negative down. */
  lift: number;
}

/** Segments per curved lane: smooth at plate scale, cheap at hundreds of arcs. */
const ARC_STEPS = 22;

export function buildLaneGeometry(tree: Float32Array, graph: Float32Array, lanes: readonly Lane[]): THREE.BufferGeometry {
  let segs = 0;
  for (const l of lanes) segs += l.lift === 0 ? 1 : ARC_STEPS;
  const pos = new Float32Array(segs * 6);
  const gpos = new Float32Array(segs * 6);
  const tAttr = new Float32Array(segs * 2);
  const style = new Float32Array(segs * 2);
  const weight = new Float32Array(segs * 2);
  const len = new Float32Array(segs * 2);

  let v = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ga = new THREE.Vector3();
  const gb = new THREE.Vector3();
  const gc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const gp = new THREE.Vector3();
  const control = (from: THREE.Vector3, to: THREE.Vector3, lift: number, out: THREE.Vector3) => {
    const d = from.distanceTo(to);
    out.addVectors(from, to).multiplyScalar(0.5);
    out.z += d * lift;
    return out;
  };
  const bez = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, t: number, out: THREE.Vector3) => {
    const u = 1 - t;
    return out.set(
      u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
    );
  };
  const put = (tp: THREE.Vector3, gpv: THREE.Vector3, t: number, l: Lane, length: number) => {
    pos[v * 3] = tp.x;
    pos[v * 3 + 1] = tp.y;
    pos[v * 3 + 2] = tp.z;
    gpos[v * 3] = gpv.x;
    gpos[v * 3 + 1] = gpv.y;
    gpos[v * 3 + 2] = gpv.z;
    tAttr[v] = t;
    style[v] = l.style;
    weight[v] = l.weight;
    len[v] = length;
    v++;
  };
  for (const l of lanes) {
    a.fromArray(tree, l.from * 3);
    b.fromArray(tree, l.to * 3);
    ga.fromArray(graph, l.from * 3);
    gb.fromArray(graph, l.to * 3);
    const length = Math.max(a.distanceTo(b), ga.distanceTo(gb)) * (l.lift === 0 ? 1 : 1 + Math.abs(l.lift) * 0.6);
    if (l.lift === 0) {
      put(a, ga, 0, l, length);
      put(b, gb, 1, l, length);
      continue;
    }
    control(a, b, l.lift, c);
    control(ga, gb, l.lift, gc);
    for (let s = 0; s < ARC_STEPS; s++) {
      const t0 = s / ARC_STEPS;
      const t1 = (s + 1) / ARC_STEPS;
      put(bez(a, c, b, t0, p), bez(ga, gc, gb, t0, gp), t0, l, length);
      put(bez(a, c, b, t1, p), bez(ga, gc, gb, t1, gp), t1, l, length);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aGraph", new THREE.BufferAttribute(gpos, 3));
  g.setAttribute("aT", new THREE.BufferAttribute(tAttr, 1));
  g.setAttribute("aStyle", new THREE.BufferAttribute(style, 1));
  g.setAttribute("aWeight", new THREE.BufferAttribute(weight, 1));
  g.setAttribute("aLen", new THREE.BufferAttribute(len, 1));
  g.computeBoundingSphere();
  return g;
}

export function makeLaneMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LANE_VERTEX,
    fragmentShader: LANE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMorph: { value: 0 },
      uClock: { value: 0 },
      uMotion: { value: 1 },
      uOpacity: { value: opacity },
      // Plate ink: lanes are hairlines in the label stock's color, never a data color.
      uInk: { value: new THREE.Color("#dfe8ee") },
    },
  });
}
