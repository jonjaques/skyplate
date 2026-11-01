/**
 * The galaxy plate: every file a star on dark glass, placed by the directory tree or the import
 * graph, colored and sized by the store's encodings, with specimen labels pinned on top.
 *
 *   <GalaxyView />          the Galaxy tab's plate: full chrome, region labels, scrubber
 *   <GalaxyView compact />  beside the source reader: title, reset, labels for the selection
 *
 * Fills its parent (position relative, 100% width and height) and talks only to the store:
 * it reads selection, focus, encodings, filters and time, and writes selection, focus and
 * hover back, so it agrees with every other view (product principle 2).
 */

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { PLATE } from "../lib/colors";
import { formatInt } from "../lib/format";
import { filesUnder, neighbors, type Model } from "../model/indices";
import { ensureSymbols } from "../state/loaders";
import { sameTarget, useHover, useViewer, type Target } from "../state/store";
import { PlateControls, PlateFilterChip, PlateLegend, PlateStatus, PlateTitle, type LegendPreview } from "./Chrome";
import { encodeColors, encodeEmphasis, encodeSizes } from "./encode";
import { GalaxyEngine } from "./engine";
import { SpecimenLabels } from "./Labels";
import { RegionLabels } from "./RegionLabels";
import { Scene } from "./Scene";
import { HistoryScrubber } from "./Scrubber";
import { ARC_CAP, ARC_LIFT, laneApex } from "./lanes";
import { buildSymbolScene, describeRelation, type SymbolScene } from "./symbolScene";

export function GalaxyView({ compact = false }: { compact?: boolean }) {
  const model = useViewer((s) => s.model);
  if (!model) {
    return (
      <div className="relative grid h-full w-full place-items-center bg-plate text-sm text-plate-muted">
        <p role="status">Charting the collection…</p>
      </div>
    );
  }
  if (model.fileCount === 0) {
    return (
      <div className="relative grid h-full w-full place-items-center bg-plate p-8 text-center text-sm text-plate-muted">
        <p>
          This project has no files to chart. starchart skips ignored and unreadable files; the about panel lists what was
          skipped.
        </p>
      </div>
    );
  }
  // A new report is a new galaxy: rebuild the engine rather than patching buffers.
  return <Plate key={model.report.generatedAt + model.fileCount} model={model} compact={compact} />;
}

function Plate({ model, compact }: { model: Model; compact: boolean }) {
  const engine = useMemo(() => new GalaxyEngine(model), [model]);
  useEffect(() => () => engine.dispose(), [engine]);
  const container = useRef<HTMLDivElement>(null);

  const colorBy = useViewer((s) => s.colorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const layout = useViewer((s) => s.layout);
  const focusDir = useViewer((s) => s.focusDir);
  const filters = useViewer((s) => s.filters);
  const selection = useViewer((s) => s.selection);
  const time = useViewer((s) => s.time);
  const symbols = useViewer((s) => s.symbols);
  const symbolModel = useViewer((s) => s.symbolModel);
  const sourceFile = useViewer((s) => (compact ? (s.source?.file ?? -1) : -1));
  const select = useViewer((s) => s.select);
  const focus = useViewer((s) => s.focus);
  const hover = useHover((s) => s.hover);
  const setHover = useHover((s) => s.setHover);

  // ── Framing keeps clear of the chrome: elements tagged data-plate-inset claim an edge ──
  // Assigned during render, not in an effect: the Canvas mounts its scene (and the camera rig
  // frames the collection) on its own schedule, which can run before this component's effects.
  // The assignment is idempotent, and the function reads the DOM only when called.
  {
    engine.insets = () => {
      const el = container.current;
      const pad = compact ? 10 : 18;
      const out = { top: pad, right: pad, bottom: pad, left: pad };
      if (!el) return out;
      const base = el.getBoundingClientRect();
      el.querySelectorAll<HTMLElement>("[data-plate-inset]").forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.height === 0) return;
        if (c.dataset.plateInset === "top") out.top = Math.max(out.top, r.bottom - base.top + 8);
        else out.bottom = Math.max(out.bottom, base.bottom - r.top + 8);
      });
      return out;
    };
  }

  // ── Reduced motion: no flights, no morph tween, static pulses ──
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      engine.reducedMotion = mq.matches;
      engine.invalidate();
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [engine]);

  // ── Encodings → attributes (in place) ──
  useEffect(() => {
    encodeColors(model, colorBy, engine.color);
    engine.touch("aColor");
  }, [engine, model, colorBy]);
  useEffect(() => {
    encodeSizes(model, sizeBy, engine.size);
    engine.touch("aSize");
  }, [engine, model, sizeBy]);
  const firstLayout = useRef(true);
  useEffect(() => {
    engine.morphTarget = layout === "graph" ? 1 : 0;
    // A layout switch moves every star, so the camera re-frames whatever the reader is looking
    // at (the selection, the open drawer, or the whole collection) as one move with the morph.
    // Staying put would leave it aimed at where the subject used to be.
    if (!firstLayout.current) frameSubject(true);
    firstLayout.current = false;
    engine.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, layout]);
  useEffect(() => engine.setTime(time), [engine, time]);

  // ── Symbols: load on demand, build the neighborhood once both tables are in ──
  const symbolId = selection?.kind === "symbol" ? selection.id : -1;
  useEffect(() => {
    if (symbolId >= 0) void ensureSymbols();
  }, [symbolId]);
  // A selected file's moons need the tables too; fetch them when the browser is idle so the
  // click that selected the file never waits on a 5 MB script.
  const fileId = selection?.kind === "file" ? selection.id : -1;
  useEffect(() => {
    if (fileId < 0 || !model.report.symbols) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void ensureSymbols());
    return () => cancel(id);
  }, [fileId, model]);
  const scene = useMemo(() => {
    if (symbolId < 0 || !symbols || !symbolModel || symbolId >= symbols.symbols.name.length) return null;
    return buildSymbolScene(model, symbols, symbolModel, symbolId);
  }, [model, symbols, symbolModel, symbolId]);
  useEffect(() => {
    engine.setDefinitionMarker(scene ? scene.defFile : null);
    engine.setDepth(scene ? scene.depth : null);
    engine.uniform("uRippleStart", scene ? engine.clock : -1);
    if (scene) {
      engine.animating.add("ripple");
      const id = window.setTimeout(() => engine.animating.delete("ripple"), 1600);
      return () => {
        window.clearTimeout(id);
        engine.animating.delete("ripple");
      };
    }
  }, [engine, scene]);

  // ── Emphasis: filters, the open drawer, the selection, a previewed legend key ──
  // The state holds a predicate, so it is always set through an updater: handed to the setter
  // directly, React would call the predicate as one.
  const [preview, setPreview] = useState<LegendPreview>(null);
  useEffect(() => {
    encodeEmphasis(model, { focusDir, filters, selection, symbolLight: scene?.light ?? null, preview }, engine.emph);
    engine.touch("aEmph");
    // Beside the source reader, a symbol's scene lights every file that uses it, and none of
    // them said which one the reader has open; that file keeps the still selection ring.
    const here = selection?.kind === "symbol" && sourceFile >= 0 ? sourceFile : -1;
    engine.uniform("uSelected", selection?.kind === "file" ? selection.id : here);
  }, [engine, model, focusDir, filters, selection, scene, preview, sourceFile]);

  // ── Hover from anywhere (the explorer, the record, the plate itself) ──
  useEffect(() => {
    engine.uniform("uHover", hover?.kind === "file" ? hover.id : -1);
    if (hover?.kind === "dir") {
      const region = engine.regionByDir.get(hover.id);
      engine.uniform("uHoverRegion", region ?? -1);
    } else if (hover === null) engine.uniform("uHoverRegion", -1);
  }, [engine, hover]);

  // ── Camera flights ──
  // Clicking a star on the plate selects without moving the camera (the reader is already
  // looking at it); a selection made elsewhere (explorer, palette, record) flies to it.
  const plateSelection = useRef<Target | null>(null);
  const frameSelection = (target: Target | null, animate = true) => {
    if (!target) return engine.home(animate);
    const R = engine.radius;
    if (target.kind === "file") {
      // The file with every import and importer, however far they reach. Zooming in on a hub
      // alone sent its lanes off the plate on every side and through the legend; framed with
      // its neighbors, each lane starts and ends on screen, inside the free area.
      const near = [target.id, ...neighbors(model.imports, target.id), ...neighbors(model.importedBy, target.id)];
      engine.fly(near, R * 0.1, [], animate, near.length > 1 ? engine.outlinePad * 0.5 : 0);
    } else if (target.kind === "dir") {
      if (target.id === 0) engine.home(animate);
      else engine.fly(filesUnder(model, target.id), undefined, [], animate, engine.outlinePad);
    } else if (target.kind === "author") engine.fly(model.authorFiles[target.id] ?? [], undefined, [], animate);
    else if (target.kind === "symbol" && scene && scene.symbol === target.id) flyToScene(scene, animate);
    else engine.home(animate);
  };
  /** Frame what the reader is looking at: the selection, else the open drawer, else everything. */
  function frameSubject(animate: boolean) {
    const s = useViewer.getState();
    if (s.selection) frameSelection(s.selection, animate);
    else if (s.focusDir !== null && s.focusDir !== 0) engine.fly(filesUnder(model, s.focusDir), undefined, [], animate, engine.outlinePad);
    else if (engine.atHome || !engine.controls) engine.home(animate);
    else engine.fly(model.fileOrder, undefined, [], animate);
  }
  // The camera rig asks for this once its controls exist. A shared link (or a selection made
  // before the plate mounted) opens framed on its subject instead of the whole collection.
  engine.frameInitial = () => frameSubject(false);
  /** Frame a symbol's whole neighborhood: its files and the arcs rising between them. */
  const flyToScene = (s: SymbolScene, animate = true) => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const apex = new THREE.Vector3();
    const extra: number[] = [];
    engine.filePos(s.defFile, b, engine.morphTarget);
    for (const arc of s.arcs.slice(0, ARC_CAP)) {
      laneApex(engine.filePos(arc.file, a, engine.morphTarget), b, ARC_LIFT, apex);
      extra.push(apex.x, apex.y, apex.z);
    }
    engine.fly(s.frame, engine.radius * 0.12, extra, animate);
  };
  useEffect(() => {
    if (!selection || selection.kind === "symbol") return;
    if (sameTarget(selection, plateSelection.current)) return;
    frameSelection(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  useEffect(() => {
    if (scene && !sameTarget(selection, plateSelection.current)) flyToScene(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  const lastFocus = useRef<number | null>(focusDir);
  useEffect(() => {
    if (focusDir !== null && focusDir !== 0) engine.fly(filesUnder(model, focusDir), undefined, [], true, engine.outlinePad);
    else if (lastFocus.current !== null) engine.home(true);
    lastFocus.current = focusDir;
  }, [engine, model, focusDir]);

  // ── Resting labels the reader waved away (a click on empty plate) stay down until the next pick ──
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [selection, focusDir]);

  // ── Keyboard: Esc clears the selection, F frames it ──
  // Escape belongs to the Galaxy tab's plate only. The Source tab's side plate is visible too,
  // and its handler cleared the selection under the reader: the record jumped to the project
  // overview while the reader still showed the file, and the URL dropped it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]")) return;
      if (!container.current || container.current.offsetParent === null) return; // hidden tab
      if (e.key === "Escape" && !compact && useViewer.getState().selection) select(null);
      else if (e.key === "f" || e.key === "F") frameSelection(useViewer.getState().selection);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, scene, compact]);

  // ── Keyboard on the plate itself: arrows step between stars, Enter selects ──
  // The step lands on the hover store, so the stepped-to star gets the same card a pointer
  // would give it, and a live region reads that card's facts aloud.
  const cursor = useRef(-1);
  const [spoken, setSpoken] = useState("");
  const speak = (i: number) => {
    const f = model.report.files[i];
    if (!f) return setSpoken("");
    const why = scene && symbols ? describeRelation(scene, symbols, i) : null;
    const lang = model.languages.get(f.language)?.name ?? f.language;
    setSpoken(`${f.path}. ${lang}, ${formatInt(f.lines)} lines. ${why ?? engine.facts.det(i)}`);
  };
  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const onPlateKey = (e: ReactKeyboardEvent) => {
    if (e.target !== container.current || e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      const s = useViewer.getState().selection;
      const from = cursor.current >= 0 ? cursor.current : s?.kind === "file" ? s.id : -1;
      const next = engine.step(from, dir[0], dir[1]);
      if (next < 0) return;
      cursor.current = next;
      setHover({ kind: "file", id: next });
      speak(next);
    } else if (e.key === "Enter" && cursor.current >= 0) {
      e.preventDefault();
      plateSelection.current = { kind: "file", id: cursor.current };
      select({ kind: "file", id: cursor.current });
    }
  };
  const onPlateBlur = () => {
    if (cursor.current >= 0 && useHover.getState().hover?.kind === "file") setHover(null);
    cursor.current = -1;
  };

  // ── Pointer: hover, click, double-click ──
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const hoverFrame = useRef(0);
  const lastPoint = useRef({ x: 0, y: 0 });
  const [moonHover, setMoonHover] = useState(-1);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = container.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onCanvas = (e: { target: EventTarget }) => (e.target as HTMLElement).tagName === "CANVAS";

  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.buttons !== 0 || !onCanvas(e)) return;
    lastPoint.current = local(e);
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const { x, y } = lastPoint.current;
      const m = engine.pickMoon(x, y);
      if (m !== engine.hoverMoon) {
        engine.hoverMoon = m;
        setMoonHover(m);
        engine.invalidate();
      }
      const el = container.current;
      if (m >= 0) {
        if (el) el.style.cursor = "pointer";
        return;
      }
      const i = engine.pick(x, y);
      const current = useHover.getState().hover;
      if (i >= 0 && !(current?.kind === "file" && current.id === i)) setHover({ kind: "file", id: i });
      else if (i < 0 && current?.kind === "file") setHover(null);
      if (el) el.style.cursor = i >= 0 ? "pointer" : "";
    });
  };
  const onPointerLeave = () => {
    if (useHover.getState().hover?.kind === "file") setHover(null);
    if (engine.hoverMoon >= 0) {
      engine.hoverMoon = -1;
      setMoonHover(-1);
    }
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { ...local(e), t: performance.now() };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || !onCanvas(e) || e.button !== 0) return;
    const p = local(e);
    // A click, not the end of an orbit drag.
    if (Math.hypot(p.x - d.x, p.y - d.y) > 5 || performance.now() - d.t > 500) return;
    const m = engine.pickMoon(p.x, p.y);
    if (m >= 0) {
      const target: Target = { kind: "symbol", id: engine.moonSymbols[m]! };
      select(target);
      return;
    }
    const i = engine.pick(p.x, p.y);
    const target: Target | null = i >= 0 ? { kind: "file", id: i } : null;
    // Empty plate with nothing selected: the reader wants the resting labels out of the way.
    if (!target && !useViewer.getState().selection) setDismissed(true);
    plateSelection.current = target;
    select(target);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!onCanvas(e)) return;
    const p = local(e);
    const i = engine.pick(p.x, p.y);
    if (i < 0) return;
    const top = model.topDir[i]!;
    if (top > 0) focus(top);
  };

  const R = engine.radius;
  const hasHistory = !compact && !!model.report.git && model.report.git.weekly.length >= 2;
  return (
    <div
      ref={container}
      className="@container relative h-full w-full touch-none overflow-hidden bg-plate outline-none select-none focus-visible:ring-2 focus-visible:ring-plate-ink/60 focus-visible:ring-inset"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onPlateKey}
      onBlur={onPlateBlur}
      tabIndex={0}
      role="application"
      aria-roledescription="galaxy map"
      aria-label={`Galaxy map of ${model.report.project.name}: ${formatInt(model.fileCount)} files. Drag to orbit, scroll to zoom, click a star to select it. With the map focused, arrow keys step between stars and Enter selects one${compact ? "" : "; Escape clears the selection"}; F frames it. Command K finds any file by name.`}
    >
      <Canvas
        className="absolute inset-0"
        dpr={[1, 2]}
        frameloop="demand"
        flat
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: R * 0.002, far: R * 40, up: [0, 0, 1], position: [0, -R * 1.45, R * 1.25] }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(PLATE), 1)}
      >
        <Scene engine={engine} symbolScene={scene} />
      </Canvas>
      {!compact && <RegionLabels engine={engine} />}
      <SpecimenLabels engine={engine} compact={compact} scene={scene} dismissed={dismissed} />
      <MoonLabel engine={engine} index={moonHover} />
      <PlateTitle engine={engine} compact={compact} />
      <PlateFilterChip engine={engine} compact={compact} />
      {!compact && <PlateStatus />}
      <PlateLegend engine={engine} compact={compact} raised={hasHistory} scene={scene} onPreview={(p) => setPreview(() => p)} />
      <PlateControls engine={engine} compact={compact} />
      {hasHistory && <HistoryScrubber engine={engine} />}
      <p className="sr-only" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}

/** Name and kind of the moon under the pointer, riding beside it. */
function MoonLabel({ engine, index }: { engine: GalaxyEngine; index: number }) {
  const symbols = useViewer((s) => s.symbols);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (index < 0) return;
    return engine.onFrame(() => {
      const x = engine.moonScreen[index * 2];
      const y = engine.moonScreen[index * 2 + 1];
      if (el.current && x !== undefined && y !== undefined) el.current.style.transform = `translate3d(${Math.round(x + 10)}px, ${Math.round(y - 22)}px, 0)`;
    });
  }, [engine, index]);
  const s = engine.moonSymbols[index];
  if (index < 0 || s === undefined || !symbols) return null;
  return (
    <div
      ref={el}
      className="pointer-events-none absolute top-0 left-0 z-30 bg-white px-1.5 py-0.5 text-[11px] whitespace-nowrap text-[#15191c]"
      role="tooltip"
    >
      <span className="font-mono">{symbols.symbols.name[s]}</span> <span className="text-[#5d666d] italic">{symbols.symbols.kind[s]}</span>
    </div>
  );
}
