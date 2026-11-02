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
 * Layouts are two slots, `from` and `to`, that the star shader mixes by `morph` (0 → 1). Every
 * change of layout or gravity bakes the current mix into `from` and loads the new target into
 * `to`, so a change made mid-flight starts from where the stars actually are instead of
 * snapping back to a fixed pair. Webs are computed here (src/shared/web.ts), once per gravity,
 * and cached; the import graph ships in the report.
 *
 * Why a class and not hooks: the per-frame path (morph, uniforms, picking, label placement)
 * must not allocate or go through React. A plain object with typed arrays does that, and the
 * React components become thin wiring around it.
 */

import * as THREE from "three";
import type { CameraControls } from "@react-three/drei";
import type { Model } from "../model/indices";
import { HOLOTYPE } from "../lib/colors";
import { filesUnder } from "../model/indices";
import type { LayoutMode } from "../state/store";
import { computeWeb, DEFAULT_GRAVITY, STAR_SPACING, webInputFromReport, type Gravity, type Web, type WebClusters, type WebFilaments, type WebInput } from "../../shared/web";
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

/** A rectangle on the plate, CSS px from its top-left corner. */
export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A region name's box on the plate; `pinned` for the open drawer's, which never steps aside. */
export interface RegionLabelRect extends PlateRect {
  pinned?: boolean;
}

/**
 * Frame listener order. The overlays share the plate and must agree within one frame (with
 * frameloop "demand" a label that waits for the next frame may never get one):
 *   REGIONS   region labels work out where they would sit and publish it
 *   LABELS    specimen labels place themselves around those, then publish their rects and leaders
 *   YIELD     region labels a specimen label or its leader still touches move below or beside
 *             their star, or step aside when those spots are taken too
 */
export const FRAME_ORDER = { REGIONS: 0, LABELS: 1, YIELD: 2 } as const;

/** Plate edges covered by chrome (title, legend, scrubber), in CSS px. Framing keeps clear of them. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The region (index into engine.regions) a directory belongs to, or -1. */
export function regionOfDir(engine: GalaxyEngine, dir: number): number {
  const dirs = engine.model.report.dirs;
  let d = dir;
  while (d > 0 && dirs[d]!.parent > 0) d = dirs[d]!.parent;
  return engine.regionByDir.get(d) ?? -1;
}

/**
 * Flash files the scrubber is near. Past this many touched at once, each flash is scaled down by
 * √(FLASH_BUDGET / touched), so the plate's total flash grows with the square root of the files
 * touched instead of in step with them: a window that touched 800 files flashes each at half
 * strength. A young project touches most of itself every few weeks, and at full strength every
 * week of its history read as one white burst.
 */
const FLASH_BUDGET = 200;
/** The scale-down never goes below this: a busy week's flash is quieter, never gone. */
const FLASH_FLOOR = 0.4;

/** Per-star flash scale for a week that touched `touched` files (1 when under the budget). */
export function flashScale(touched: number): number {
  return touched <= FLASH_BUDGET ? 1 : Math.max(FLASH_FLOOR, Math.sqrt(FLASH_BUDGET / touched));
}

/**
 * Home elevation above the horizontal. A web has no plane to look down on, and from high up its
 * nearer clusters hide the ones behind them; a low oblique angle shows the most knots side by
 * side and still gives each one some depth.
 */
const HOME_ELEVATION = THREE.MathUtils.degToRad(24);
const WORLD_UP = new THREE.Vector3(0, 0, 1);

/** One layout's geometry, as the slots hold it. */
interface Slot {
  layout: LayoutMode;
  gravity: Gravity;
  positions: Float32Array;
  /** Per directory: sphere center (stride 3) and radius. */
  dirCenter: Float32Array;
  dirRadius: Float32Array;
  /** Region label anchors, stride 3 (see regionAnchor). */
  anchors: Float32Array;
  /** Filament Béziers, stride 9, in the default web's strand order (see filaments.ts). */
  curves: Float32Array;
}

const SECONDS_PER_DAY = 86400;
/** Morph time constant (s). Exponential approach: damped, no overshoot, ~0.8 s to settle. */
const MORPH_TAU = 0.2;
const PICK_CELL = 24;

/**
 * The home camera direction (target → camera) for a web: the horizontal bearing that sees the
 * web broadside (perpendicular to its widest horizontal spread, from a principal-axis fit), at
 * HOME_ELEVATION. Computed once from the default web, so a gravity switch never swings the
 * camera; the plate is wider than it is tall, and a web seen end-on stacked its superclusters
 * behind one another.
 */
function homeDirectionOf(pos: Float32Array): THREE.Vector3 {
  const n = pos.length / 3;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += pos[i * 3]!;
    my += pos[i * 3 + 1]!;
  }
  mx /= Math.max(1, n);
  my /= Math.max(1, n);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3]! - mx;
    const dy = pos[i * 3 + 1]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Major axis angle of the horizontal spread; the camera sits on the minor axis, south of it.
  const major = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = -Math.sin(major);
  let ay = Math.cos(major);
  if (ay > 0) {
    ax = -ax;
    ay = -ay;
  }
  const c = Math.cos(HOME_ELEVATION);
  return new THREE.Vector3(ax * c, ay * c, Math.sin(HOME_ELEVATION)).normalize();
}

/** Directory spheres from placed files: the centroid of each subtree and its farthest file. */
function dirSpheres(model: Model, pos: Float32Array): { centers: Float32Array; radii: Float32Array } {
  const dirs = model.report.dirs;
  const D = dirs.length;
  const centers = new Float32Array(D * 3);
  const radii = new Float32Array(D);
  for (let d = 0; d < D; d++) {
    const files = filesUnder(model, d);
    if (files.length === 0) continue;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < files.length; k++) {
      const i = files[k]! * 3;
      cx += pos[i]!;
      cy += pos[i + 1]!;
      cz += pos[i + 2]!;
    }
    cx /= files.length;
    cy /= files.length;
    cz /= files.length;
    let r = 0;
    for (let k = 0; k < files.length; k++) {
      const i = files[k]! * 3;
      r = Math.max(r, Math.hypot(pos[i]! - cx, pos[i + 1]! - cy, pos[i + 2]! - cz));
    }
    centers[d * 3] = cx;
    centers[d * 3 + 1] = cy;
    centers[d * 3 + 2] = cz;
    radii[d] = r;
  }
  return { centers, radii };
}

/**
 * The strands in the import-graph layout: straight, between the clusters' centroids there. They
 * fade out as the morph reaches the graph (the graph has no clusters to string together), but
 * travelling with their clusters keeps them from hanging in space while the stars leave.
 */
function graphCurves(web: Web, pos: Float32Array): Float32Array {
  const C = web.clusters.dir.length;
  const sum = new Float64Array(C * 3);
  const count = new Float64Array(C);
  for (let f = 0; f < web.fileCluster.length; f++) {
    const k = web.fileCluster[f]!;
    for (let j = 0; j < 3; j++) sum[k * 3 + j] = sum[k * 3 + j]! + pos[f * 3 + j]!;
    count[k]!++;
  }
  const fil = web.filaments;
  const out = new Float32Array(fil.a.length * 9);
  for (let i = 0; i < fil.a.length; i++) {
    const a = fil.a[i]!;
    const b = fil.b[i]!;
    for (let j = 0; j < 3; j++) {
      const pa = sum[a * 3 + j]! / Math.max(1, count[a]!);
      const pb = sum[b * 3 + j]! / Math.max(1, count[b]!);
      out[i * 9 + j] = pa;
      out[i * 9 + 3 + j] = (pa + pb) / 2;
      out[i * 9 + 6 + j] = pb;
    }
  }
  return out;
}

/**
 * Webs and their input per loaded model, shared by every engine on it: the Galaxy tab's plate
 * and the Source tab's side plate each mount an engine, and without this each recomputed every
 * web it showed (up to ~70 ms apiece at 50k files).
 */
const webCache = new WeakMap<Model, { input: WebInput; webs: Map<Gravity, Web> }>();

function webStore(model: Model): { input: WebInput; webs: Map<Gravity, Web> } {
  let c = webCache.get(model);
  if (!c) webCache.set(model, (c = { input: webInputFromReport(model.report), webs: new Map() }));
  return c;
}

function cloneSlot(s: Slot): Slot {
  return {
    ...s,
    positions: Float32Array.from(s.positions),
    dirCenter: Float32Array.from(s.dirCenter),
    dirRadius: Float32Array.from(s.dirRadius),
    anchors: Float32Array.from(s.anchors),
    curves: Float32Array.from(s.curves),
  };
}

export class GalaxyEngine {
  readonly model: Model;
  readonly n: number;
  readonly radius: number;
  readonly facts: Facts;

  /** Star positions the shader mixes: `from` at morph 0, `to` at morph 1 (attributes position, aTo). */
  readonly from: Float32Array;
  readonly to: Float32Array;
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

  /** Progress from the `from` slot to the `to` slot, 0 → 1. */
  morph = 1;
  /** The layout and gravity the `to` slot holds. */
  layout: LayoutMode;
  gravity: Gravity;
  /** Bumped on every retarget; geometry built from the slots (lanes, filaments) rebuilds on it. */
  version = 0;
  clock = 0;
  reducedMotion = false;
  /** Set while something animates on its own (pulses, breathing, playback), to keep frames coming. */
  animating = new Set<string>();

  camera: THREE.PerspectiveCamera | null = null;
  controls: CameraControls | null = null;
  width = 1;
  height = 1;
  invalidate: () => void = () => {};
  /**
   * Called once the camera controls exist. The view replaces it to frame whatever is already
   * selected (a shared link opens on its selection); by default, the whole collection.
   */
  frameInitial: () => void = () => this.home(false);
  /** Chrome insets, measured by the view (see GalaxyView); none until it says otherwise. */
  insets: () => Insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
  /**
   * The camera is still where home() put it. While true, a resize or a layout switch re-frames
   * the whole collection; once the reader orbits or a flight runs, the camera is theirs.
   */
  atHome = false;

  /** Region labels that would show this frame (published at FRAME_ORDER.REGIONS). */
  regionLabelRects: RegionLabelRect[] = [];
  /** Specimen labels placed this frame (published at FRAME_ORDER.LABELS). */
  labelRects: PlateRect[] = [];
  /** Their leaders, flat [x1, y1, x2, y2, …] from each pinned star to its label (FRAME_ORDER.LABELS). */
  labelLeaders: number[] = [];
  /** The symbol definition under the knockout disc, or -1. */
  definitionFile = -1;

  /** A selected file's moons: symbol ids, their screen positions (CSS px, stride 2), the file. */
  moonSymbols: number[] = [];
  moonScreen = new Float32Array(0);
  moonFile = -1;
  hoverMoon = -1;

  private listeners: { fn: FrameListener; order: number }[] = [];
  private retargetListeners = new Set<() => void>();
  private holotypeMarks: Float32Array;
  readonly webInput: WebInput;
  private webs: Map<Gravity, Web>;
  private graphSlot: Slot | null = null;
  private fromSlot: Slot;
  private toSlot: Slot;
  /** How much of each slot is the web (1) or the graph (0), for fading the filaments. */
  webFrom = 1;
  webTo = 1;
  /** Camera direction (target → camera) for the whole collection, fixed from the default web. */
  readonly homeDirection: THREE.Vector3;

  // Picking cache: screen positions at the last projection, bucketed into a grid.
  private sx: Float32Array;
  private sy: Float32Array;
  private sr: Float32Array; //   pick radius (CSS px)
  private sw: Float32Array; //   clip w (distance), for depth tie-breaks; ≤ 0 when behind
  private gridStart = new Int32Array(0);
  private gridItems: Int32Array;
  private gridCols = 0;
  private gridRows = 0;
  private sat = new Float32Array(0);
  private densityAge = 0;
  private projKey = "";
  private lastMatrix = new Float32Array(16);
  private projMorph = -1;

  constructor(model: Model, initial: { layout: LayoutMode; gravity: Gravity } = { layout: "web", gravity: DEFAULT_GRAVITY }) {
    this.model = model;
    const report = model.report;
    const n = (this.n = model.fileCount);
    this.facts = buildFacts(model);
    const store = webStore(model);
    this.webInput = store.input;
    this.webs = store.webs;
    // Sizes, the camera's reach and the shared bounding sphere come from the default web and the
    // graph (which the analyzer fitted to it), not from the current gravity: a gravity switch
    // would otherwise resize every star.
    const base = this.web(DEFAULT_GRAVITY);
    this.radius = Math.max(base.radius, report.layout.radius, 1);
    this.homeDirection = homeDirectionOf(base.positions);

    this.layout = initial.layout;
    this.gravity = initial.gravity;
    this.toSlot = this.slotOf(initial.layout, initial.gravity);
    this.fromSlot = cloneSlot(this.toSlot);
    this.webFrom = this.webTo = initial.layout === "web" ? 1 : 0;
    this.from = this.fromSlot.positions;
    this.to = this.toSlot.positions;
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
    // Region anchors need the regions, which need the model; fill both slots' now.
    this.fromSlot.anchors = this.anchorsOf(this.fromSlot.positions);
    this.toSlot.anchors = Float32Array.from(this.fromSlot.anchors);

    const g = (this.geometry = new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(this.from, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aTo", new THREE.BufferAttribute(this.to, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aEmph", new THREE.BufferAttribute(this.emph, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aMark", new THREE.BufferAttribute(this.mark, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aBorn", new THREE.BufferAttribute(this.born, 1));
    g.setAttribute("aFlash", new THREE.BufferAttribute(this.flash, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aRegion", new THREE.BufferAttribute(this.regionOf, 1));
    g.setAttribute("aDepth", new THREE.BufferAttribute(this.depth, 1).setUsage(THREE.DynamicDrawUsage));
    // Every layout shares one bounding sphere; frustum culling must not drop the whole cloud
    // mid-morph because the sphere was computed from one slot's positions alone.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.3);

    this.material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMorph: { value: 1 },
        uSizeScale: { value: 1000 },
        // Star sizes in units of the spacing between neighbors in a clump (see STAR_SPACING):
        // the smallest file is a third of a gap wide and the largest about one and a half, so a
        // clump resolves into stars when zoomed in, and zooming grows them like real distance.
        // Sized from the radius instead, a web's voids made every star too wide for its clump.
        uBaseSize: { value: STAR_SPACING * 0.34 },
        uSizeRange: { value: STAR_SPACING * 1.5 },
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
    this.listeners = [];
    this.retargetListeners.clear();
  }

  // ─── Layouts ───────────────────────────────────────────────────────────────────────────────

  /** The web for a gravity, computed on first use and cached (a few ms to ~70 ms at 50k files). */
  web(gravity: Gravity): Web {
    let w = this.webs.get(gravity);
    if (!w) this.webs.set(gravity, (w = computeWeb(this.webInput, gravity)));
    return w;
  }

  /** The web the layout is heading to, or null while the import graph is the target. */
  get targetWeb(): Web | null {
    return this.layout === "web" ? this.web(this.gravity) : null;
  }

  /** The web's strands (shared by every gravity: they depend on import coupling alone). */
  get filaments(): WebFilaments {
    return this.web(DEFAULT_GRAVITY).filaments;
  }

  /** The web's clusters, the nodes the filaments join, and the cluster of each file. */
  get clusters(): WebClusters {
    return this.web(DEFAULT_GRAVITY).clusters;
  }

  get fileCluster(): Int32Array {
    return this.web(DEFAULT_GRAVITY).fileCluster;
  }

  /** Filament curves in one slot, stride 9. */
  curves(slot: "from" | "to"): Float32Array {
    return slot === "from" ? this.fromSlot.curves : this.toSlot.curves;
  }

  private slotOf(layout: LayoutMode, gravity: Gravity): Slot {
    if (layout === "web") {
      const w = this.web(gravity);
      return {
        layout,
        gravity,
        positions: Float32Array.from(w.positions),
        dirCenter: w.dirCenter,
        dirRadius: w.dirRadius,
        anchors: new Float32Array(0),
        curves: w.filaments.curve,
      };
    }
    if (!this.graphSlot) {
      const positions = Float32Array.from(this.model.report.layout.graph);
      const { centers, radii } = dirSpheres(this.model, positions);
      this.graphSlot = { layout, gravity, positions, dirCenter: centers, dirRadius: radii, anchors: new Float32Array(0), curves: graphCurves(this.web(DEFAULT_GRAVITY), positions) };
    }
    return { ...this.graphSlot, gravity, positions: Float32Array.from(this.graphSlot.positions) };
  }

  /**
   * Head for a layout (and, in the web, a gravity). The current mix is baked into `from`, so the
   * morph starts wherever the stars are, even mid-flight. Reduced motion snaps.
   */
  setTarget(layout: LayoutMode, gravity: Gravity): void {
    if (layout === this.layout && (layout === "graph" || gravity === this.gravity)) {
      this.gravity = gravity;
      return;
    }
    const k = this.morph;
    const f = this.fromSlot;
    const t = this.toSlot;
    const mix = (a: Float32Array, b: Float32Array) => {
      for (let i = 0; i < a.length; i++) a[i] = a[i]! + (b[i]! - a[i]!) * k;
    };
    mix(this.from, this.to);
    // The slots' directory arrays may be shared with a cached web; mix into fresh copies.
    const dirCenter = Float32Array.from(f.dirCenter);
    const dirRadius = Float32Array.from(f.dirRadius);
    const curves = Float32Array.from(f.curves);
    mix(dirCenter, t.dirCenter);
    mix(dirRadius, t.dirRadius);
    mix(curves, t.curves);
    mix(f.anchors, t.anchors);
    this.fromSlot = { ...f, dirCenter, dirRadius, curves };
    this.webFrom = this.webFrom + (this.webTo - this.webFrom) * k;

    const next = this.slotOf(layout, gravity);
    this.to.set(next.positions);
    next.positions = this.to;
    next.anchors = this.anchorsOf(this.to);
    this.toSlot = next;
    this.layout = layout;
    this.gravity = gravity;
    this.webTo = layout === "web" ? 1 : 0;
    this.morph = this.reducedMotion ? 1 : 0;
    this.material.uniforms.uMorph!.value = this.morph;
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aTo") as THREE.BufferAttribute).needsUpdate = true;
    this.projMorph = -1;
    this.version++;
    for (const l of this.retargetListeners) l();
    this.invalidate();
  }

  /** Called after every retarget (useSyncExternalStore-shaped: returns the unsubscribe). */
  onRetarget(listener: () => void): () => void {
    this.retargetListeners.add(listener);
    return () => this.retargetListeners.delete(listener);
  }

  /**
   * A directory's sphere at the current morph (or `at` = 1 for where it is heading): writes the
   * center, returns the radius. In the web it is the subtree's measured sphere; in the import
   * graph, the centroid of its files and the farthest of them.
   */
  dirSphere(dir: number, out: THREE.Vector3, at = this.morph): number {
    const a = this.fromSlot;
    const b = this.toSlot;
    const k = dir * 3;
    out.set(
      a.dirCenter[k]! + (b.dirCenter[k]! - a.dirCenter[k]!) * at,
      a.dirCenter[k + 1]! + (b.dirCenter[k + 1]! - a.dirCenter[k + 1]!) * at,
      a.dirCenter[k + 2]! + (b.dirCenter[k + 2]! - a.dirCenter[k + 2]!) * at,
    );
    return a.dirRadius[dir]! + (b.dirRadius[dir]! - a.dirRadius[dir]!) * at;
  }

  /** Where a region's name is pinned at the current morph (see anchorsOf). */
  regionAnchor(region: number, out: THREE.Vector3, at = this.morph): THREE.Vector3 {
    const a = this.fromSlot.anchors;
    const b = this.toSlot.anchors;
    const k = region * 3;
    return out.set(a[k]! + (b[k]! - a[k]!) * at, a[k + 1]! + (b[k + 1]! - a[k + 1]!) * at, a[k + 2]! + (b[k + 2]! - a[k + 2]!) * at);
  }

  /** How much of the plate is the web right now (1) rather than the import graph (0). */
  get webness(): number {
    return this.webFrom + (this.webTo - this.webFrom) * this.morph;
  }

  /**
   * Each region's label anchor in one layout: the member nearest the centroid of its files. A
   * supercluster's centroid often falls in the void between its clusters, and a name floating
   * there pointed at nothing; pinned to a member, it sits on the supercluster's own stars.
   */
  private anchorsOf(pos: Float32Array): Float32Array {
    const out = new Float32Array(this.regions.length * 3);
    for (const r of this.regions) {
      const files = r.files;
      if (files.length === 0) continue;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < files.length; k++) {
        const i = files[k]! * 3;
        cx += pos[i]!;
        cy += pos[i + 1]!;
        cz += pos[i + 2]!;
      }
      cx /= files.length;
      cy /= files.length;
      cz /= files.length;
      let best = files[0]!;
      let bestD = Infinity;
      for (let k = 0; k < files.length; k++) {
        const i = files[k]! * 3;
        const d = (pos[i]! - cx) ** 2 + (pos[i + 1]! - cy) ** 2 + (pos[i + 2]! - cz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = files[k]!;
        }
      }
      out[r.index * 3] = pos[best * 3]!;
      out[r.index * 3 + 1] = pos[best * 3 + 1]!;
      out[r.index * 3 + 2] = pos[best * 3 + 2]!;
    }
    return out;
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
    this.definitionFile = file ?? -1;
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
    let touched = 0;
    for (let i = 0; i < this.n; i++) if (this.flash[i]! > 0) touched++;
    const k = flashScale(touched);
    if (k < 1) for (let i = 0; i < this.n; i++) this.flash[i] = this.flash[i]! * k;
    this.touch("aFlash");
  }

  // ─── Positions ─────────────────────────────────────────────────────────────────────────────

  /** A file's position at the current morph, or at `morph` = 1 for where it is heading. */
  filePos(i: number, out: THREE.Vector3, morph = this.morph): THREE.Vector3 {
    const a = this.from;
    const b = this.to;
    const k = i * 3;
    return out.set(a[k]! + (b[k]! - a[k]!) * morph, a[k + 1]! + (b[k + 1]! - a[k + 1]!) * morph, a[k + 2]! + (b[k + 2]! - a[k + 2]!) * morph);
  }

  /** Bounding sphere of a set of files at the layout the morph is heading to. */
  sphereOf(files: ArrayLike<number>, minRadius = this.radius * 0.06): THREE.Sphere {
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    if (files.length === 0) return new THREE.Sphere(c, this.radius);
    for (let k = 0; k < files.length; k++) c.add(this.filePos(files[k]!, v, 1));
    c.multiplyScalar(1 / files.length);
    let r = 0;
    for (let k = 0; k < files.length; k++) r = Math.max(r, this.filePos(files[k]!, v, 1).distanceTo(c));
    return new THREE.Sphere(c, Math.max(r * 1.08, minRadius));
  }

  // ─── Camera ────────────────────────────────────────────────────────────────────────────────

  /**
   * Fit a set of files (all of them when null) into the plate's free area, seen along
   * `direction` (unit, target → camera). Returns where the camera should look and from how far,
   * plus the focal offset that moves the picture clear of the chrome.
   *
   * camera-controls' fitToSphere was used first. A sphere is the wrong shape for most subjects:
   * a cluster strung along a filament projects as a long ellipse, so a sphere fitted to the
   * plate's height left a third of the width empty, and it ignored the title and scrubber,
   * which sat on top of stars.
   * Instead this fits the files' actual projected extent: a binary search on distance (the
   * projection is perspective, so near and far files scale differently), with the target moved
   * to the middle of what is visible so orbiting pivots around the picture, not beside it.
   */
  framePose(files: ArrayLike<number> | null, direction: THREE.Vector3, minRadius: number, extra: readonly number[] = [], pad = 0) {
    const camera = this.camera;
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const ins = this.insets();
    const tanV = Math.tan(THREE.MathUtils.degToRad((camera?.fov ?? 40) / 2));
    const tanH = tanV * (W / H);
    // The free rectangle in normalized device coordinates (−1…1), with a little air.
    const x0 = -1 + (2 * ins.left) / W;
    const x1 = 1 - (2 * ins.right) / W;
    const y0 = -1 + (2 * ins.bottom) / H;
    const y1 = 1 - (2 * ins.top) / H;
    const freeW = Math.max(0.2, x1 - x0) * 0.94;
    const freeH = Math.max(0.2, y1 - y0) * 0.94;

    const back = direction.clone().normalize();
    const right = new THREE.Vector3().crossVectors(WORLD_UP, back);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();

    // Positions in the layout the morph is heading to; a stride keeps 50k-file reports cheap.
    const count = files ? files.length : this.n;
    const stride = Math.max(1, Math.ceil(count / 12000));
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k += stride) {
      this.filePos(files ? files[k]! : k, v, 1);
      pts.push(v.x, v.y, v.z);
    }
    // Points that are not files but must be in view too (the apexes of a symbol's arcs).
    for (let k = 0; k + 2 < extra.length; k += 3) pts.push(extra[k]!, extra[k + 1]!, extra[k + 2]!);
    const m = pts.length / 3;
    const target = new THREE.Vector3();
    if (m === 0) return { target, distance: this.radius * 2, focal: [0, 0] as [number, number] };
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let k = 0; k < m; k++) {
      v.fromArray(pts, k * 3);
      lo.min(v);
      hi.max(v);
    }
    target.addVectors(lo, hi).multiplyScalar(0.5);

    // NDC extents of the points from distance D along `back`, centered on `target`.
    const extents = (D: number) => {
      let ax = Infinity;
      let bx = -Infinity;
      let ay = Infinity;
      let by = -Infinity;
      for (let k = 0; k < m; k++) {
        const dx = pts[k * 3]! - target.x;
        const dy = pts[k * 3 + 1]! - target.y;
        const dz = pts[k * 3 + 2]! - target.z;
        const w = D - (dx * back.x + dy * back.y + dz * back.z);
        if (w <= D * 0.02) return null; // behind or at the lens: too close
        const sx = (dx * right.x + dy * right.y + dz * right.z) / (w * tanH);
        const sy = (dx * up.x + dy * up.y + dz * up.z) / (w * tanV);
        // Each point is a disc of radius `pad`: a star's halo (and a group's envelope around
        // its members) runs outside the star itself, and fitting the stars alone clipped both at
        // the edges of a phone-width plate.
        const px = pad / (w * tanH);
        const py = pad / (w * tanV);
        if (sx - px < ax) ax = sx - px;
        if (sx + px > bx) bx = sx + px;
        if (sy - py < ay) ay = sy - py;
        if (sy + py > by) by = sy + py;
      }
      return { ax, bx, ay, by };
    };
    const fits = (D: number) => {
      const e = extents(D);
      return !!e && e.bx - e.ax <= freeW && e.by - e.ay <= freeH;
    };
    const span = Math.max(hi.distanceTo(lo), minRadius * 2, 1e-3);
    // A sphere of minRadius must fit too, so a single file is shown with some surroundings.
    const minD = minRadius / Math.sin(Math.atan(Math.min(tanV * freeH, tanH * freeW) / 2));
    let D = minD;
    for (let pass = 0; pass < 3; pass++) {
      let a = minD;
      let b = Math.max(minD * 2, span * 8);
      if (!fits(a)) {
        for (let i = 0; i < 28; i++) {
          const mid = (a + b) / 2;
          if (fits(mid)) b = mid;
          else a = mid;
        }
        D = b;
      } else D = a;
      // Re-center the target on the visible middle, then fit again from there.
      const e = extents(D);
      if (!e) break;
      target.addScaledVector(right, ((e.ax + e.bx) / 2) * D * tanH).addScaledVector(up, ((e.ay + e.by) / 2) * D * tanV);
    }
    // The free rectangle's center, as a camera shift. camera-controls moves the camera by
    // −focal.y along its up axis, so a positive y lifts the picture.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return { target, distance: D, focal: [-cx * D * tanH, cy * D * tanV] as [number, number] };
  }

  /** Move the camera to a pose from framePose, eased (critically damped, no overshoot) unless asked not to. */
  private applyPose(pose: ReturnType<GalaxyEngine["framePose"]>, direction: THREE.Vector3, animate: boolean): void {
    const c = this.controls;
    if (!c) return;
    const transition = animate && !this.reducedMotion;
    const p = pose.target.clone().addScaledVector(direction, pose.distance);
    void c.setLookAt(p.x, p.y, p.z, pose.target.x, pose.target.y, pose.target.z, transition);
    void c.setFocalOffset(pose.focal[0], pose.focal[1], 0, transition);
    this.invalidate();
  }

  /** World margin around stars that keeps their halos (and a group's envelope) in frame. */
  get outlinePad(): number {
    return this.radius * 0.035;
  }

  /** Frame the whole collection from the home direction. */
  home(animate: boolean): void {
    if (!this.controls) return;
    const dir = this.homeDirection;
    this.applyPose(this.framePose(null, dir, this.radius * 0.1, [], this.outlinePad), dir, animate);
    this.atHome = true;
  }

  /** Fly to a set of files, keeping the current viewing direction. */
  fly(files: ArrayLike<number>, minRadius = this.radius * 0.06, extra: readonly number[] = [], animate = true, pad = 0): void {
    const c = this.controls;
    if (!c || files.length === 0) return;
    const dir = new THREE.Vector3();
    c.getPosition(dir);
    const t = new THREE.Vector3();
    c.getTarget(t);
    dir.sub(t);
    if (dir.lengthSq() < 1e-9) dir.copy(this.homeDirection);
    dir.normalize();
    this.applyPose(this.framePose(files, dir, minRadius, extra, pad), dir, animate);
    this.atHome = false;
  }

  // ─── Frame bus ─────────────────────────────────────────────────────────────────────────────

  /** Run `listener` on every rendered frame, after every listener of a lower `order`. */
  onFrame(listener: FrameListener, order = 0): () => void {
    const entry = { fn: listener, order };
    // Stable by order: listeners of one order keep their registration order.
    const at = this.listeners.findIndex((l) => l.order > order);
    if (at < 0) this.listeners.push(entry);
    else this.listeners.splice(at, 0, entry);
    this.invalidate();
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  /** Called once per rendered frame from inside the Canvas, before the scene renders. */
  tick(camera: THREE.PerspectiveCamera, width: number, height: number, dpr: number, delta: number): void {
    this.camera = camera;
    const resized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    // The plate changed size (window resize, the record column toggled): keep the whole
    // collection framed if the reader has not taken the camera.
    if (resized && this.atHome) this.home(false);
    this.clock += Math.min(delta, 0.1);

    if (this.morph !== 1) {
      if (this.reducedMotion) this.morph = 1;
      else {
        this.morph += (1 - this.morph) * (1 - Math.exp(-Math.min(delta, 0.1) / MORPH_TAU));
        if (1 - this.morph < 0.002) this.morph = 1;
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
    for (const l of this.listeners) l.fn(info);

    if (this.morph !== 1 || this.animating.size > 0) this.invalidate();
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
    const t = this.from;
    const g = this.to;
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
    // Summed-area table of star counts per cell (before the counts become offsets), so label
    // placement can ask "how many stars would this card cover" in constant time.
    const sat = new Float32Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) {
      let rowSum = 0;
      for (let c = 0; c < cols; c++) {
        rowSum += start[c + r * cols + 1]!;
        sat[c + 1 + (r + 1) * (cols + 1)] = sat[c + 1 + r * (cols + 1)]! + rowSum;
      }
    }
    this.sat = sat;
    for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
    const fill = start.slice(0, cols * rows);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i]!;
      if (c >= 0) this.gridItems[fill[c]!++] = i;
    }
    this.gridStart = start;
  }

  /**
   * Re-project for density queries, at most every few frames while the camera moves: label
   * placement can live with a slightly stale picture, and projecting 50k stars every frame of
   * an orbit would spend the frame budget on something nobody sees.
   */
  refreshDensity(): void {
    if (++this.densityAge < 6 && this.sat.length > 0) return;
    this.densityAge = 0;
    this.project();
  }

  /** Stars inside a plate rectangle (CSS px), counted by whole grid cells, from the last projection. */
  starsIn(x: number, y: number, w: number, h: number): number {
    const sat = this.sat;
    if (sat.length === 0) return 0;
    const cols = this.gridCols;
    const rows = this.gridRows;
    const c0 = Math.max(0, Math.min(cols, Math.floor(x / PICK_CELL)));
    const c1 = Math.max(0, Math.min(cols, Math.ceil((x + w) / PICK_CELL)));
    const r0 = Math.max(0, Math.min(rows, Math.floor(y / PICK_CELL)));
    const r1 = Math.max(0, Math.min(rows, Math.ceil((y + h) / PICK_CELL)));
    const S = cols + 1;
    return sat[c1 + r1 * S]! - sat[c0 + r1 * S]! - sat[c1 + r0 * S]! + sat[c0 + r0 * S]!;
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

  /**
   * Keyboard stepping: the star the arrow keys reach from `from` in screen direction (dx, dy),
   * or -1 when nothing lies that way. Candidates sit within 60° of the direction; the nearest
   * wins, with sideways distance counting double so a press goes where it points. Dimmed and
   * not-yet-created stars are skipped, so the keys walk what the plate is showing. From no star
   * (-1), it starts at the lit star nearest the plate's middle.
   */
  step(from: number, dx: number, dy: number): number {
    this.project();
    const W = this.width;
    const H = this.height;
    const timeOn = (this.material.uniforms.uTimeOn!.value as number) > 0.5;
    const tNow = this.material.uniforms.uTime!.value as number;
    const onPlate = (i: number) =>
      this.sw[i]! > 0 && this.sx[i]! >= 0 && this.sy[i]! >= 0 && this.sx[i]! <= W && this.sy[i]! <= H && !(timeOn && this.born[i]! > tNow);
    const lit = (i: number) => this.emph[i]! >= 0.3;
    let best = -1;
    let bestScore = Infinity;
    if (from < 0 || !onPlate(from)) {
      for (let i = 0; i < this.n; i++) {
        if (!onPlate(i) || !lit(i)) continue;
        const d = Math.hypot(this.sx[i]! - W / 2, this.sy[i]! - H / 2);
        if (d < bestScore) {
          bestScore = d;
          best = i;
        }
      }
      return best;
    }
    const ox = this.sx[from]!;
    const oy = this.sy[from]!;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (let i = 0; i < this.n; i++) {
      if (i === from || !onPlate(i) || !lit(i)) continue;
      const vx = this.sx[i]! - ox;
      const vy = this.sy[i]! - oy;
      const along = vx * ux + vy * uy;
      if (along <= 2) continue;
      const side = Math.abs(vx * uy - vy * ux);
      if (side > along * 1.73) continue; // outside the 60° cone
      const score = along + side * 2;
      if (score < bestScore) {
        bestScore = score;
        best = i;
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
