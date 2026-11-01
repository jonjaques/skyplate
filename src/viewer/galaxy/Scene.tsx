/**
 * Everything inside the Canvas: the frame bridge, camera, region outlines, lanes, symbol arcs,
 * the stars themselves and a selected file's moons.
 *
 * Draw calls, back to front: region outlines (one per region and layout), every-edge lanes
 * (one), selection lanes (one), symbol arcs (one), the definition knockout (one), stars (one),
 * moons (one). Geometry is built
 * when the thing it draws changes (a new selection, a new symbol), never per frame; per-frame
 * work is uniforms and the handful of moon positions.
 */

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PLATE } from "../lib/colors";
import { useViewer } from "../state/store";
import { traceContour } from "./contour";
import { regionOfDir, type GalaxyEngine } from "./engine";
import { ARC_CAP, ARC_LIFT, LANE_STYLE, buildLaneGeometry, makeLaneMaterial, selectionLanes, type Lane } from "./lanes";
import { KNOCKOUT_FRAGMENT, KNOCKOUT_VERTEX, MOON_FRAGMENT, MOON_VERTEX } from "./shaders";
import type { SymbolScene } from "./symbolScene";

export function Scene({ engine, symbolScene }: { engine: GalaxyEngine; symbolScene: SymbolScene | null }) {
  return (
    <>
      <FrameBridge engine={engine} />
      <CameraRig engine={engine} />
      <RegionOutlines engine={engine} />
      <AllLanes engine={engine} />
      <SelectionLanes engine={engine} />
      <SymbolArcs engine={engine} scene={symbolScene} />
      <DefinitionKnockout engine={engine} scene={symbolScene} />
      <points geometry={engine.geometry} material={engine.material} frustumCulled={false} renderOrder={5} />
      <Moons engine={engine} />
    </>
  );
}

// ─── Frame bridge ────────────────────────────────────────────────────────────────────────────

function FrameBridge({ engine }: { engine: GalaxyEngine }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    engine.invalidate = () => invalidate();
    invalidate();
  }, [engine, invalidate]);
  // Priority 0 (after camera-controls' update at -1). A positive priority would switch off
  // R3F's own rendering, which this scene relies on.
  useFrame((state, delta) => {
    engine.tick(state.camera as THREE.PerspectiveCamera, state.size.width, state.size.height, state.viewport.dpr, delta);
  });
  return null;
}

// ─── Camera ──────────────────────────────────────────────────────────────────────────────────

function CameraRig({ engine }: { engine: GalaxyEngine }) {
  const ref = useRef<CameraControls>(null);
  const get = useThree((s) => s.get);
  const R = engine.radius;
  useEffect(() => {
    engine.controls = ref.current;
    // The first frame has not run yet, so the engine does not know the plate's size; framing
    // against a 1×1 plate would fit nothing.
    const { size, camera } = get();
    engine.width = size.width;
    engine.height = size.height;
    engine.camera = camera as THREE.PerspectiveCamera;
    engine.frameInitial();
    return () => {
      engine.controls = null;
    };
  }, [engine, get]);
  return (
    <CameraControls
      ref={ref}
      makeDefault
      // Damped (critically, so no overshoot) and quick: the reader is mid-task.
      smoothTime={0.42}
      draggingSmoothTime={0.08}
      minDistance={R * 0.01}
      maxDistance={R * 6}
      dollyToCursor
      // The reader took the camera: stop re-framing on resize or layout switches.
      onControlStart={() => {
        engine.atHome = false;
      }}
    />
  );
}

// ─── Region outlines ─────────────────────────────────────────────────────────────────────────

const OUTLINE = new THREE.Color("#7f96b4");

function RegionOutlines({ engine }: { engine: GalaxyEngine }) {
  const group = useMemo(() => new THREE.Group(), []);
  const lines = useRef<{ tree: THREE.LineSegments; graph: THREE.LineSegments; region: number }[]>([]);
  const focusDir = useViewer((s) => s.focusDir);
  const focusRegion = focusDir === null ? -1 : regionOfDir(engine, focusDir);

  useEffect(() => {
    // Tracing runs after first paint: the stars come first, outlines a beat later.
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      const cell = engine.radius / 75;
      for (const region of engine.regions) {
        if (region.files.length < 3) continue;
        const make = (pos: Float32Array) => {
          const seg = traceContour({ pos, files: region.files, cell });
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(seg, 3));
          const m = new THREE.LineBasicMaterial({ color: OUTLINE, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
          const l = new THREE.LineSegments(g, m);
          l.frustumCulled = false;
          l.renderOrder = 1;
          group.add(l);
          return l;
        };
        lines.current.push({ tree: make(engine.tree), graph: make(engine.graph), region: region.index });
      }
      engine.invalidate();
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      for (const l of lines.current) {
        for (const s of [l.tree, l.graph]) {
          s.geometry.dispose();
          (s.material as THREE.Material).dispose();
          group.remove(s);
        }
      }
      lines.current = [];
    };
  }, [engine, group]);

  useFrame(() => {
    const hover = engine.material.uniforms.uHoverRegion!.value as number;
    const m = engine.morph;
    for (const l of lines.current) {
      // Outlines are a whisper at rest (eleven of them at once is already a lot of line) and
      // speak up for the region under the pointer or the open drawer.
      const lit = l.region === hover ? 0.7 : l.region === focusRegion ? 0.45 : hover >= 0 || focusRegion >= 0 ? 0.06 : 0.13;
      (l.tree.material as THREE.LineBasicMaterial).opacity = lit * (1 - m);
      (l.graph.material as THREE.LineBasicMaterial).opacity = lit * m;
      l.tree.visible = m < 0.999;
      l.graph.visible = m > 0.001;
    }
  });
  return <primitive object={group} />;
}


// ─── Lanes ───────────────────────────────────────────────────────────────────────────────────

function useLaneSync(engine: GalaxyEngine, material: THREE.ShaderMaterial) {
  useFrame(() => {
    material.uniforms.uMorph!.value = engine.morph;
    material.uniforms.uClock!.value = engine.clock;
    material.uniforms.uMotion!.value = engine.reducedMotion ? 0 : 1;
  });
  useEffect(() => () => material.dispose(), [material]);
}

function LaneObject({ geometry, material, order }: { geometry: THREE.BufferGeometry | null; material: THREE.ShaderMaterial; order: number }) {
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={order} />;
}

/** Every code edge, very faint, in one draw call (edges mode "all"). */
function AllLanes({ engine }: { engine: GalaxyEngine }) {
  const mode = useViewer((s) => s.edges);
  const material = useMemo(() => makeLaneMaterial(1), []);
  useLaneSync(engine, material);
  const geometry = useMemo(() => {
    if (mode !== "all") return null;
    const e = engine.model.report.edges;
    const lanes: Lane[] = [];
    for (let k = 0; k < e.from.length; k++) {
      if (e.kind[k] === "link") continue;
      lanes.push({ from: e.from[k]!, to: e.to[k]!, style: LANE_STYLE.all, weight: 0, lift: 0 });
    }
    // Lanes add up (the blend is additive), so a fixed opacity that reads as a whisper at a few
    // hundred edges became a white web over the stars at a few thousand. Opacity falls with
    // the square root of the count; hubs, where many lanes meet, still come up brighter.
    material.uniforms.uOpacity!.value = Math.min(1, Math.sqrt(500 / Math.max(1, lanes.length)));
    return buildLaneGeometry(engine.tree, engine.graph, lanes);
  }, [engine, mode, material]);
  useEffect(() => engine.invalidate(), [engine, geometry]);
  return <LaneObject geometry={geometry} material={material} order={2} />;
}

/** The selected file's imports and importers. */
function SelectionLanes({ engine }: { engine: GalaxyEngine }) {
  const mode = useViewer((s) => s.edges);
  const selection = useViewer((s) => s.selection);
  const material = useMemo(() => makeLaneMaterial(1), []);
  useLaneSync(engine, material);
  const fileId = selection?.kind === "file" ? selection.id : -1;
  const geometry = useMemo(() => {
    if (mode === "none" || fileId < 0) return null;
    const lanes: Lane[] = [];
    const set = selectionLanes(engine.model, fileId);
    // t runs importer → dependency, so direction reads the same for both kinds of neighbor.
    for (const t of set.imports) lanes.push({ from: fileId, to: t, style: LANE_STYLE.import, weight: 1, lift: 0 });
    for (const s of set.importers) lanes.push({ from: s, to: fileId, style: LANE_STYLE.import, weight: 1, lift: 0 });
    // Lanes add up where they meet (the blend is additive), so many lanes into one hub burned
    // a white knot over the selected star. The same square-root falloff the every-edge view uses.
    material.uniforms.uOpacity!.value = Math.min(1, Math.sqrt(40 / Math.max(1, lanes.length)));
    return lanes.length > 0 ? buildLaneGeometry(engine.tree, engine.graph, lanes) : null;
  }, [engine, mode, fileId, material]);
  useEffect(() => {
    if (geometry) engine.animating.add("lanes");
    else engine.animating.delete("lanes");
    engine.invalidate();
    return () => {
      engine.animating.delete("lanes");
    };
  }, [engine, geometry]);
  return <LaneObject geometry={geometry} material={material} order={3} />;
}

/** A selected symbol's arcs: references in (calls pulse, implementations solid, other uses dashed), callees out. */
function SymbolArcs({ engine, scene }: { engine: GalaxyEngine; scene: SymbolScene | null }) {
  const material = useMemo(() => makeLaneMaterial(1), []);
  useLaneSync(engine, material);
  const geometry = useMemo(() => {
    if (!scene) return null;
    const lanes: Lane[] = [];
    let max = 1;
    for (const a of scene.arcs) max = Math.max(max, a.calls + a.impl + a.other);
    for (const a of scene.arcs.slice(0, ARC_CAP)) {
      const weight = Math.log1p(a.calls + a.impl + a.other) / Math.log1p(max);
      // An implementer that also calls it is drawn as an implementation: that is the rarer
      // and more structural fact, and the hover card lists the calls beside it.
      const style = a.implementation ? LANE_STYLE.implementation : a.calls > 0 ? LANE_STYLE.call : LANE_STYLE.other;
      lanes.push({ from: a.file, to: scene.defFile, style, weight, lift: ARC_LIFT });
    }
    for (const c of scene.callees.slice(0, 120)) lanes.push({ from: scene.defFile, to: c.file, style: LANE_STYLE.callee, weight: 0.3, lift: -0.22 });
    return lanes.length > 0 ? buildLaneGeometry(engine.tree, engine.graph, lanes) : null;
  }, [engine, scene]);
  useEffect(() => {
    if (scene) engine.animating.add("symbol");
    else engine.animating.delete("symbol");
    engine.invalidate();
    return () => {
      engine.animating.delete("symbol");
    };
  }, [engine, scene]);
  return <LaneObject geometry={geometry} material={material} order={4} />;
}

// ─── Definition knockout ─────────────────────────────────────────────────────────────────────

/** Knockout diameter in CSS px: wide enough to clear the arcs' last tenth around the ring. */
const KNOCKOUT_PX = 30;

/**
 * A plate-colored disc under the selected symbol's definition, drawn between the arcs and the
 * stars with normal blending. Everything else on the plate blends additively, which can only
 * brighten; without this, 155 arcs ending on one star summed to a white blob and the
 * definition ring the legend promises could not be seen at any zoom.
 */
function DefinitionKnockout({ engine, scene }: { engine: GalaxyEngine; scene: SymbolScene | null }) {
  const { points, geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: KNOCKOUT_VERTEX,
      fragmentShader: KNOCKOUT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      uniforms: { uPx: { value: KNOCKOUT_PX }, uPlate: { value: new THREE.Color(PLATE) } },
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 4.5;
    return { points: p, geometry: g, material: m };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    points.visible = !!scene;
    if (!scene) return;
    engine.filePos(scene.defFile, v);
    (geometry.getAttribute("position") as THREE.BufferAttribute).setXYZ(0, v.x, v.y, v.z);
    geometry.getAttribute("position").needsUpdate = true;
    material.uniforms.uPx!.value = KNOCKOUT_PX * state.viewport.dpr;
  });
  return <primitive object={points} />;
}

// ─── Moons ───────────────────────────────────────────────────────────────────────────────────

const MOON_CAP = 40;
/** Kinds drawn as solid moons (callables); the rest (types, values) are rings. */
const CALLABLE = new Set(["function", "method", "constructor", "getter", "setter", "component", "hook"]);

function Moons({ engine }: { engine: GalaxyEngine }) {
  const selection = useViewer((s) => s.selection);
  const symbols = useViewer((s) => s.symbols);
  const sm = useViewer((s) => s.symbolModel);
  const fileId = selection?.kind === "file" ? selection.id : -1;

  const moonList = useMemo(() => {
    if (fileId < 0 || !symbols || !sm) return [];
    const t = symbols.symbols;
    const out: number[] = [];
    for (let k = sm.symbolsInFile.offsets[fileId]!; k < sm.symbolsInFile.offsets[fileId + 1]!; k++) {
      const s = sm.symbolsInFile.targets[k]!;
      if (t.kind[s] === "module") continue;
      out.push(s);
    }
    // The most-referenced first, so a capped ring keeps the symbols people actually use.
    out.sort((a, b) => t.refs[b]! - t.refs[a]! || a - b);
    return out.slice(0, MOON_CAP);
  }, [fileId, symbols, sm]);

  const { geometry, material, points } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOON_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aKindTone", new THREE.BufferAttribute(new Float32Array(MOON_CAP), 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: MOON_VERTEX,
      fragmentShader: MOON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: 9 }, uHover: { value: -1 } },
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 6;
    return { geometry: g, material: m, points: p };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    const tone = geometry.getAttribute("aKindTone") as THREE.BufferAttribute;
    moonList.forEach((s, i) => tone.setX(i, CALLABLE.has(symbols!.symbols.kind[s]!) ? 1 : 0));
    tone.needsUpdate = true;
    geometry.setDrawRange(0, moonList.length);
    engine.moonSymbols = moonList;
    engine.moonScreen = new Float32Array(moonList.length * 2);
    engine.moonFile = fileId;
    if (moonList.length > 0) engine.animating.add("moons");
    else engine.animating.delete("moons");
    engine.invalidate();
    return () => {
      engine.animating.delete("moons");
      engine.moonSymbols = [];
      engine.moonFile = -1;
    };
  }, [engine, geometry, moonList, symbols, fileId]);

  const center = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const spin = useRef(0);
  useFrame((state, delta) => {
    const k = moonList.length;
    if (k === 0 || fileId < 0) return;
    const camera = state.camera as THREE.PerspectiveCamera;
    engine.filePos(fileId, center);
    // A ring facing the camera at a constant on-screen radius, so it reads at any zoom.
    const dist = camera.position.distanceTo(center);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const worldPerPx = (2 * Math.tan(fov / 2) * dist) / Math.max(1, state.size.height);
    const ringPx = 34 + Math.min(26, k * 1.2);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    // The ring turns slowly so moons do not sit on the same lanes forever, and holds still
    // while one is under the pointer: a moving target drifted a neighbor under the cursor
    // between hover and click.
    if (!engine.reducedMotion && engine.hoverMoon < 0) spin.current += Math.min(delta, 0.1) * 0.12;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + spin.current;
      // Two radii alternate so neighbors on a crowded ring do not touch.
      const r = ringPx * (i % 2 === 0 ? 1 : 1.22) * worldPerPx;
      p.copy(center).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      pos.setXYZ(i, p.x, p.y, p.z);
      p.project(camera);
      engine.moonScreen[i * 2] = (p.x + 1) * 0.5 * state.size.width;
      engine.moonScreen[i * 2 + 1] = (1 - p.y) * 0.5 * state.size.height;
    }
    pos.needsUpdate = true;
    material.uniforms.uPx!.value = 9 * state.viewport.dpr;
    material.uniforms.uHover!.value = engine.hoverMoon;
  });
  return <primitive object={points} />;
}
