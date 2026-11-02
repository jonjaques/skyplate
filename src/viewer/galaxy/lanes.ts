/**
 * Geometry for lanes: import edges and symbol arcs, built as one LineSegments per group.
 *
 * Each lane carries the engine's from- and to-slot endpoints so it follows the morph in the
 * vertex shader (and is rebuilt whenever the engine retargets), plus t (0 at the importer or
 * referencing file, 1 at the dependency or definition), which the fragment shader turns into
 * direction: brightness, drifting dashes, pulses.
 */

import * as THREE from "three";
import { neighbors, type Model } from "../model/indices";
import { LANE_FRAGMENT, LANE_VERTEX } from "./shaders";

export const LANE_STYLE = { import: 0, call: 1, other: 2, callee: 3, all: 4, implementation: 5, dispatch: 6 } as const;

/**
 * Gain on a test file's arc. The arc keeps its style (a test that calls still pulses), so what
 * says "test" is strength alone, and it has to be a big step: the blend is additive, and a hub's
 * test arcs can outnumber its production arcs two to one (101 to 55 for one vector helper), so
 * a mild cut would still leave the tests the brighter half of the fan.
 */
export const TEST_GAIN = 0.38;

/**
 * Importer lanes drawn for one selected file. A hub imported from 251 files drew 251 additive
 * lanes: a white starburst that ran off the plate and through the legend, with no single lane
 * readable. Past this many, the most depended-on importers keep their lanes, every importer's
 * star stays lit, and the legend says how many lanes were left out.
 */
export const IMPORTER_LANE_CAP = 60;

export interface SelectionLaneSet {
  imports: number[];
  /** Importers that get a lane, most depended-on first. */
  importers: number[];
  /** Importers whose lane was left out (their stars stay lit). */
  hiddenImporters: number;
  totalImporters: number;
}

/** Which lanes a selected file draws; shared by the scene and the label placement. */
export function selectionLanes(model: Model, file: number): SelectionLaneSet {
  const imports = [...neighbors(model.imports, file)];
  const all = [...neighbors(model.importedBy, file)];
  const files = model.report.files;
  const importers =
    all.length <= IMPORTER_LANE_CAP ? all : all.sort((a, b) => files[b]!.rank - files[a]!.rank || a - b).slice(0, IMPORTER_LANE_CAP);
  return { imports, importers, hiddenImporters: all.length - importers.length, totalImporters: all.length };
}

/** How far a symbol's reference arcs bow, per unit of span (see Lane.lift and bowNormal). */
export const ARC_LIFT = 0.32;
/** Arcs drawn per symbol: past a few hundred they fog the stars they connect. */
export const ARC_CAP = 600;

/**
 * The direction a curved lane bows: world up (+z, the camera's up), less its component along the
 * chord. In the disc this replaced, arcs simply rose along +z off the plane. A web has no plane,
 * and straight +z failed for a chord that is itself nearly vertical (the control point slid
 * along the line and the arc came out straight). Bowing toward up-perpendicular keeps every
 * arc a visible curve, keeps a symbol's callers rising over the web as a canopy instead of
 * threading through the knots between them, and keeps "arcs go up on the plate" true from the
 * oblique views the camera uses, which the label placement relies on (the definition's tag hangs
 * below its star). A near-vertical chord bows outward, away from the web's center, instead.
 */
export function bowNormal(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return out.set(0, 0, 1);
  const cz = dz / len;
  if (Math.abs(cz) < 0.94) {
    // up − (up·ĉ)ĉ
    out.set((-cz * dx) / len, (-cz * dy) / len, 1 - cz * cz);
  } else {
    // Outward from the center at the chord's midpoint, made perpendicular to the chord.
    out.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    if (out.lengthSq() < 1e-9) out.set(1, 0, 0);
    out.normalize();
    const along = (out.x * dx + out.y * dy + out.z * dz) / len;
    out.set(out.x - (along * dx) / len, out.y - (along * dy) / len, out.z - (along * dz) / len);
  }
  return out.normalize();
}

const apexNormal = new THREE.Vector3();
/**
 * Where a lane with `lift` peaks: a quadratic bezier's apex sits halfway to its control point,
 * so framing a symbol's neighborhood can include the arcs, not just their ends.
 */
export function laneApex(a: THREE.Vector3, b: THREE.Vector3, lift: number, out: THREE.Vector3): THREE.Vector3 {
  const d = a.distanceTo(b);
  bowNormal(a, b, apexNormal);
  out.addVectors(a, b).multiplyScalar(0.5);
  out.addScaledVector(apexNormal, d * lift * 0.5);
  return out;
}

export interface Lane {
  from: number;
  to: number;
  style: number;
  /** 0-1 strength (call count, log-scaled). */
  weight: number;
  /** Bow the lane into a curve (see bowNormal): 0 is straight, positive bows up, negative down. */
  lift: number;
  /** Overall strength multiplier, 1 when omitted (TEST_GAIN for a test file's arc). */
  gain?: number;
}

/** Segments per curved lane: smooth at plate scale, cheap at hundreds of arcs. */
const ARC_STEPS = 22;

/** Lanes between files, with both of the engine's slots (`from`, `to`) as endpoints. */
export function buildLaneGeometry(from: Float32Array, to: Float32Array, lanes: readonly Lane[]): THREE.BufferGeometry {
  let segs = 0;
  for (const l of lanes) segs += l.lift === 0 ? 1 : ARC_STEPS;
  const pos = new Float32Array(segs * 6);
  const gpos = new Float32Array(segs * 6);
  const tAttr = new Float32Array(segs * 2);
  const style = new Float32Array(segs * 2);
  const weight = new Float32Array(segs * 2);
  const len = new Float32Array(segs * 2);
  const gain = new Float32Array(segs * 2);

  let v = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ga = new THREE.Vector3();
  const gb = new THREE.Vector3();
  const gc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const gp = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const control = (p0: THREE.Vector3, p2: THREE.Vector3, lift: number, out: THREE.Vector3) => {
    const d = p0.distanceTo(p2);
    bowNormal(p0, p2, nrm);
    out.addVectors(p0, p2).multiplyScalar(0.5);
    out.addScaledVector(nrm, d * lift);
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
    gain[v] = l.gain ?? 1;
    v++;
  };
  for (const l of lanes) {
    a.fromArray(from, l.from * 3);
    b.fromArray(from, l.to * 3);
    ga.fromArray(to, l.from * 3);
    gb.fromArray(to, l.to * 3);
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
  g.setAttribute("aTo", new THREE.BufferAttribute(gpos, 3));
  g.setAttribute("aT", new THREE.BufferAttribute(tAttr, 1));
  g.setAttribute("aStyle", new THREE.BufferAttribute(style, 1));
  g.setAttribute("aWeight", new THREE.BufferAttribute(weight, 1));
  g.setAttribute("aLen", new THREE.BufferAttribute(len, 1));
  g.setAttribute("aGain", new THREE.BufferAttribute(gain, 1));
  g.computeBoundingSphere();
  return g;
}

export const LANE_INK = "#dfe8ee";
export const LANE_INK_2 = "#f2dfb4";

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
      uInk: { value: new THREE.Color(LANE_INK) },
      // Implementations get a second, warmer ink (bone, not a series hue and nowhere near
      // holotype red), so "implements it" reads apart from "calls it" even where they cross.
      uInk2: { value: new THREE.Color(LANE_INK_2) },
    },
  });
}
