/**
 * The galaxy's runtime: one per mounted GalaxyView.
 *
 * React owns *what* is shown (selection, encodings, filters live in the store); the engine owns
 * *how* it reaches the GPU and the overlay. It holds the star geometry (one BufferGeometry, one
 * draw call, attributes rewritten in place, never rebuilt per interaction), the morph between
 * layouts, screen-space picking, and a per-frame bus that the HTML overlay (specimen labels,
 * region labels) subscribes to, so labels move with the camera through refs and transforms
 * instead of a React render per frame.
 *
 * Why a class and not hooks: the per-frame path (morph, uniforms, picking, label placement)
 * must not allocate or go through React. A plain object with typed arrays does that, and the
 * React components become thin wiring around it.
 */

import * as THREE from "three";
import type { CameraControls } from "@react-three/drei";
import type { Model } from "../model/indices";
import { filesUnder } from "../model/indices";
import { HOLOTYPE } from "../lib/colors";
import { STAR_FRAGMENT, STAR_VERTEX } from "./shaders";
import { buildFacts, type Facts } from "./facts";

export interface Region {
  /** Index into Engine.regions (also the aRegion attribute value). */
  index: number;
  /** Top-level directory id, or 0 for the root's own files. */
  dir: number;
  name: string;
  files: Int32Array;
}

export interface FrameInfo {
  camera: THREE.PerspectiveCamera;
  /** Plate size in CSS pixels. */
  width: number;
  height: number;
  /** Seconds since mount. */
  clock: number;
  morph: number;
}

export type FrameListener = (info: FrameInfo) => void;

const SECONDS_PER_DAY = 86400;
/** Morph time constant (s). Exponential approach: damped, no overshoot, ~0.8 s to settle. */
const MORPH_TAU = 0.2;
const PICK_CELL = 24;

export class GalaxyEngine {
  readonly model: Model;
  readonly n: number;
  readonly radius: number;
  readonly facts: Facts;

  readonly tree: Float32Array;
  readonly graph: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly emph: Float32Array;
  readonly mark: Float32Array;
  readonly born: Float32Array;
  readonly flash: Float32Array;
  readonly regionOf: Float32Array;
  readonly depth: Float32Array;

  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly regions: Region[];
  /** Region index per top-level directory id (and 0 for the root). */
  readonly regionByDir = new Map<number, number>();

  /** Days since the first commit for unix time `t`. */
  readonly dayOf: (t: number) => number;

  morph = 0;
  morphTarget = 0;
  clock = 0;
  reducedMotion = false;
  /** Set while something animates on its own (pulses, breathing, playback), to keep frames coming. */
  animating = new Set<string>();

  camera: THREE.PerspectiveCamera | null = null;
  controls: CameraControls | null = null;
  width = 1;
  height = 1;
  invalidate: () => void = () => {};

  /** A selected file's moons: symbol ids, their screen positions (CSS px, stride 2), the file. */
  moonSymbols: number[] = [];
  moonScreen = new Float32Array(0);
  moonFile = -1;
  hoverMoon = -1;

  private listeners = new Set<FrameListener>();
  private holotypeMarks: Float32Array;

  // Picking cache: screen positions at the last projection, bucketed into a grid.
  private sx: Float32Array;
  private sy: Float32Array;
  private sr: Float32Array; //   pick radius (CSS px)
  private sw: Float32Array; //   clip w (distance), for depth tie-breaks; ≤ 0 when behind
  private gridStart = new Int32Array(0);
  private gridItems: Int32Array;
  private gridCols = 0;
  private gridRows = 0;
  private projKey = "";
  private lastMatrix = new Float32Array(16);
  private projMorph = -1;

  constructor(model: Model) {
    this.model = model;
    const report = model.report;
    const n = (this.n = model.fileCount);
    this.radius = Math.max(report.layout.radius.tree, report.layout.radius.graph, 1);
    this.facts = buildFacts(model);

    this.tree = Float32Array.from(report.layout.tree);
    this.graph = Float32Array.from(report.layout.graph);
    this.color = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.emph = new Float32Array(n).fill(1);
    this.mark = new Float32Array(n);
    this.born = new Float32Array(n);
    this.flash = new Float32Array(n);
    this.regionOf = new Float32Array(n);
    this.depth = new Float32Array(n).fill(-1);

    const first = report.git?.first ?? 0;
    this.dayOf = (t: number) => (t - first) / SECONDS_PER_DAY;
    for (let i = 0; i < n; i++) {
      const c = model.created[i]!;
      this.born[i] = Number.isNaN(c) ? -1e6 : this.dayOf(c);
    }

    // Regions: the root's files (the bulge) and each top-level directory, largest first.
    const top = (report.dirs[0]?.dirs ?? []).filter((d) => report.dirs[d]!.totalFiles > 0);
    top.sort((a, b) => report.dirs[b]!.totalFiles - report.dirs[a]!.totalFiles || a - b);
    this.regions = [];
    const rootFiles = report.dirs[0]?.files ?? [];
    if (rootFiles.length > 0) {
      this.regions.push({ index: 0, dir: 0, name: "Root files", files: Int32Array.from(rootFiles) });
      this.regionByDir.set(0, 0);
    }
    for (const d of top) {
      const index = this.regions.length;
      this.regions.push({ index, dir: d, name: report.dirs[d]!.name, files: filesUnder(model, d) });
      this.regionByDir.set(d, index);
    }
    for (let i = 0; i < n; i++) this.regionOf[i] = this.regionByDir.get(model.topDir[i]!) ?? 0;

    this.holotypeMarks = new Float32Array(n);
    for (const f of model.holotypes) this.holotypeMarks[f] = 1;
    this.mark.set(this.holotypeMarks);

    const g = (this.geometry = new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(this.tree, 3));
    g.setAttribute("aGraph", new THREE.BufferAttribute(this.graph, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aEmph", new THREE.BufferAttribute(this.emph, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aMark", new THREE.BufferAttribute(this.mark, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aBorn", new THREE.BufferAttribute(this.born, 1));
    g.setAttribute("aFlash", new THREE.BufferAttribute(this.flash, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aRegion", new THREE.BufferAttribute(this.regionOf, 1));
    g.setAttribute("aDepth", new THREE.BufferAttribute(this.depth, 1).setUsage(THREE.DynamicDrawUsage));
    // Both layouts share one bounding sphere; frustum culling must not drop the whole cloud
    // mid-morph because the sphere was computed from the tree positions alone.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.2);

    const R = this.radius;
    this.material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMorph: { value: 0 },
        uSizeScale: { value: 1000 },
        // Star sizes as fractions of the galaxy radius: framed whole, the smallest file is a
        // ~2 px point and the largest ~12 px, and zooming in grows them like real distance.
        uBaseSize: { value: R * 0.0042 },
        uSizeRange: { value: R * 0.02 },
        uMinPx: { value: 1.6 },
        uMaxPx: { value: 40 },
        uHover: { value: -1 },
        uSelected: { value: -1 },
        uHoverRegion: { value: -1 },
        uTimeOn: { value: 0 },
        uTime: { value: 0 },
        uClock: { value: 0 },
        uRippleStart: { value: -1 },
        uMotion: { value: 1 },
        uHolotype: { value: new THREE.Color(HOLOTYPE) },
      },
    });

    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sr = new Float32Array(n);
    this.sw = new Float32Array(n);
    this.gridItems = new Int32Array(n);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.listeners.clear();
  }

  // ─── Attribute updates (in place; flagged for upload) ──────────────────────────────────────

  touch(name: "aColor" | "aSize" | "aEmph" | "aMark" | "aFlash" | "aDepth"): void {
    (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.invalidate();
  }

  /** Holotype rings plus, optionally, the breathing definition marker on one file. */
  setDefinitionMarker(file: number | null): void {
    this.mark.set(this.holotypeMarks);
    if (file !== null) this.mark[file] = 2;
    this.touch("aMark");
  }

  setDepth(depth: Int8Array | null): void {
    if (depth) for (let i = 0; i < this.n; i++) this.depth[i] = depth[i]!;
    else this.depth.fill(-1);
    this.touch("aDepth");
  }

  uniform<T>(name: string, value: T): void {
    const u = this.material.uniforms[name];
    if (u && u.value !== value) {
      u.value = value;
      this.invalidate();
    }
  }

  /** History scrubber position (unix seconds) or null for HEAD. */
  setTime(time: number | null): void {
    const git = this.model.report.git;
    this.flash.fill(0);
    if (time === null || !git) {
      this.uniform("uTimeOn", 0);
      this.touch("aFlash");
      return;
    }
    this.uniform("uTimeOn", 1);
    this.uniform("uTime", this.dayOf(time));
    // Commits are newest first. Flash files touched in the three weeks up to T, fading with age.
    const window = 21 * SECONDS_PER_DAY;
    const times = git.commits.time;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! > time) lo = mid + 1;
      else hi = mid;
    }
    for (let c = lo; c < times.length && times[c]! >= time - window; c++) {
      const strength = 1 - (time - times[c]!) / window;
      for (const f of git.commits.files[c]!) if (strength > this.flash[f]!) this.flash[f] = strength;
    }
    this.touch("aFlash");
  }

  // ─── Positions ─────────────────────────────────────────────────────────────────────────────

  /** A file's position at the current morph. */
  filePos(i: number, out: THREE.Vector3, morph = this.morph): THREE.Vector3 {
    const t = this.tree;
    const g = this.graph;
    const k = i * 3;
    return out.set(t[k]! + (g[k]! - t[k]!) * morph, t[k + 1]! + (g[k + 1]! - t[k + 1]!) * morph, t[k + 2]! + (g[k + 2]! - t[k + 2]!) * morph);
  }

  /** Bounding sphere of a set of files at the layout the morph is heading to. */
  sphereOf(files: ArrayLike<number>, minRadius = this.radius * 0.06): THREE.Sphere {
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    if (files.length === 0) return new THREE.Sphere(c, this.radius);
    for (let k = 0; k < files.length; k++) c.add(this.filePos(files[k]!, v, this.morphTarget));
    c.multiplyScalar(1 / files.length);
    let r = 0;
    for (let k = 0; k < files.length; k++) r = Math.max(r, this.filePos(files[k]!, v, this.morphTarget).distanceTo(c));
    return new THREE.Sphere(c, Math.max(r * 1.08, minRadius));
  }

  // ─── Camera ────────────────────────────────────────────────────────────────────────────────

  /** Frame the whole collection from the default three-quarter view. */
  home(animate: boolean): void {
    const c = this.controls;
    if (!c) return;
    const R = this.radius;
    const transition = animate && !this.reducedMotion;
    void c.setLookAt(0, -R * 1.45, R * 1.25, 0, 0, 0, transition);
    void c.fitToSphere(new THREE.Sphere(new THREE.Vector3(), R * 0.82), transition);
  }

  fly(sphere: THREE.Sphere): void {
    const c = this.controls;
    if (!c) return;
    // camera-controls eases with a critically damped spring (smoothDamp): no overshoot.
    void c.fitToSphere(sphere, !this.reducedMotion);
  }

  // ─── Frame bus ─────────────────────────────────────────────────────────────────────────────

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    this.invalidate();
    return () => this.listeners.delete(listener);
  }

  /** Called once per rendered frame from inside the Canvas, before the scene renders. */
  tick(camera: THREE.PerspectiveCamera, width: number, height: number, dpr: number, delta: number): void {
    this.camera = camera;
    this.width = width;
    this.height = height;
    this.clock += Math.min(delta, 0.1);

    if (this.morph !== this.morphTarget) {
      if (this.reducedMotion) this.morph = this.morphTarget;
      else {
        this.morph += (this.morphTarget - this.morph) * (1 - Math.exp(-Math.min(delta, 0.1) / MORPH_TAU));
        if (Math.abs(this.morphTarget - this.morph) < 0.002) this.morph = this.morphTarget;
      }
    }
    const u = this.material.uniforms;
    u.uMorph!.value = this.morph;
    u.uClock!.value = this.clock;
    u.uMotion!.value = this.reducedMotion ? 0 : 1;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    u.uSizeScale!.value = (height * dpr) / (2 * Math.tan(fov / 2));
    u.uMinPx!.value = 1.6 * dpr;
    u.uMaxPx!.value = 40 * dpr;

    camera.updateMatrixWorld();
    const info: FrameInfo = { camera, width, height, clock: this.clock, morph: this.morph };
    for (const l of this.listeners) l(info);

    if (this.morph !== this.morphTarget || this.animating.size > 0) this.invalidate();
  }

  // ─── Picking ───────────────────────────────────────────────────────────────────────────────

  /**
   * Project every star to the screen and bucket it into a grid, if the camera, the morph or
   * the size changed since the last projection. ~1-2 ms at 50k files; runs only on pointer
   * moves (never per frame), so an idle plate costs nothing.
   */
  private project(): void {
    const camera = this.camera;
    if (!camera) return;
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = m.elements;
    let same = this.projMorph === this.morph && this.projKey === `${this.width}x${this.height}`;
    for (let i = 0; same && i < 16; i++) if (this.lastMatrix[i] !== e[i]) same = false;
    if (same) return;
    this.lastMatrix.set(e);
    this.projMorph = this.morph;
    this.projKey = `${this.width}x${this.height}`;

    const W = this.width;
    const H = this.height;
    const n = this.n;
    const t = this.tree;
    const g = this.graph;
    const k = this.morph;
    const u = this.material.uniforms;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const scaleCss = H / (2 * Math.tan(fov / 2));
    const base = u.uBaseSize!.value as number;
    const range = u.uSizeRange!.value as number;
    const cols = (this.gridCols = Math.max(1, Math.ceil(W / PICK_CELL)));
    const rows = (this.gridRows = Math.max(1, Math.ceil(H / PICK_CELL)));
    const cellOf = new Int32Array(n);
    const start = new Int32Array(cols * rows + 1);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const x = t[j]! + (g[j]! - t[j]!) * k;
      const y = t[j + 1]! + (g[j + 1]! - t[j + 1]!) * k;
      const z = t[j + 2]! + (g[j + 2]! - t[j + 2]!) * k;
      const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      this.sw[i] = w;
      cellOf[i] = -1;
      if (w <= 0) continue;
      const sx = ((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w + 1) * 0.5 * W;
      const sy = (1 - (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w) * 0.5 * H;
      this.sx[i] = sx;
      this.sy[i] = sy;
      const px = Math.min(40, Math.max(1.6, ((base + this.size[i]! * range) * scaleCss) / w));
      this.sr[i] = Math.max(7, px * 0.5 + 3);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(sx / PICK_CELL))) + Math.min(rows - 1, Math.max(0, Math.floor(sy / PICK_CELL))) * cols;
      cellOf[i] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
    const fill = start.slice(0, cols * rows);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i]!;
      if (c >= 0) this.gridItems[fill[c]!++] = i;
    }
    this.gridStart = start;
  }

  /** The star under a plate point (CSS px), or -1. Receding stars lose ties to lit ones. */
  pick(x: number, y: number): number {
    this.project();
    if (this.gridStart.length === 0) return -1;
    const cols = this.gridCols;
    const rows = this.gridRows;
    const cx = Math.floor(x / PICK_CELL);
    const cy = Math.floor(y / PICK_CELL);
    const timeOn = (this.material.uniforms.uTimeOn!.value as number) > 0.5;
    const tNow = this.material.uniforms.uTime!.value as number;
    let best = -1;
    let bestScore = Infinity;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= rows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= cols) continue;
        const c = gx + gy * cols;
        for (let k = this.gridStart[c]!; k < this.gridStart[c + 1]!; k++) {
          const i = this.gridItems[k]!;
          if (timeOn && this.born[i]! > tNow) continue;
          const d = Math.hypot(this.sx[i]! - x, this.sy[i]! - y);
          const r = this.sr[i]!;
          if (d > r) continue;
          const score = (d / r) * (this.emph[i]! < 0.3 ? 2 : 1) + this.sw[i]! * 1e-9;
          if (score < bestScore) {
            bestScore = score;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** The moon under a plate point (index into moonSymbols), or -1. */
  pickMoon(x: number, y: number): number {
    let best = -1;
    let bestD = 9;
    for (let i = 0; i < this.moonSymbols.length; i++) {
      const d = Math.hypot(this.moonScreen[i * 2]! - x, this.moonScreen[i * 2 + 1]! - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Screen position of a file at the current frame (CSS px), or null when behind the camera. */
  screenOf(i: number, out: { x: number; y: number }, scratch: THREE.Vector3): boolean {
    const camera = this.camera;
    if (!camera) return false;
    this.filePos(i, scratch).applyMatrix4(camera.matrixWorldInverse);
    if (scratch.z >= 0) return false;
    scratch.applyMatrix4(camera.projectionMatrix);
    out.x = (scratch.x + 1) * 0.5 * this.width;
    out.y = (1 - scratch.y) * 0.5 * this.height;
    return true;
  }
}
