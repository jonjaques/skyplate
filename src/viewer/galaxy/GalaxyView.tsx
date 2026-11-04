/**
 * The galaxy plate: every file a star on dark glass, placed in the cosmic web of the directory
 * tree or by the import graph, colored and sized by the store's encodings, with specimen labels
 * pinned on top.
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
import { PlateControls, PlateCrumbs, PlateFilterChip, PlateLegend, PlateMarks, PlateStatus, PlateTitle, type LegendPreview } from "./Chrome";
import { PlateClicks } from "./clicks";
import { encodeColors, encodeEmphasis, encodeSizes } from "./encode";
import { GalaxyEngine } from "./engine";
import { GroupEnvelopes } from "./Envelopes";
import { walkUp } from "./groups";
import { HOVER_TUNING, HoverIntent, type PointerKind } from "./hoverIntent";
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
        <p role="status">Developing the plate…</p>
      </div>
    );
  }
  if (model.fileCount === 0) {
    return (
      <div className="relative grid h-full w-full place-items-center bg-plate p-8 text-center text-sm text-plate-muted">
        <p>
          This project has no files to chart. Skyplate skips ignored and unreadable files; the about panel lists what was
          skipped.
        </p>
      </div>
    );
  }
  // A new report is a new galaxy: rebuild the engine rather than patching buffers.
  return <Plate key={model.report.generatedAt + model.fileCount} model={model} compact={compact} />;
}

function Plate({ model, compact }: { model: Model; compact: boolean }) {
  // Built on the layout the store already holds, so a link to the import graph (or a gravity)
  // opens there instead of morphing to it on arrival.
  const engine = useMemo(() => {
    const s = useViewer.getState();
    return new GalaxyEngine(model, { layout: s.layout, gravity: s.gravity });
  }, [model]);
  useEffect(() => () => engine.dispose(), [engine]);
  const container = useRef<HTMLDivElement>(null);

  const colorBy = useViewer((s) => s.colorBy);
  const sizeBy = useViewer((s) => s.sizeBy);
  const layout = useViewer((s) => s.layout);
  const gravity = useViewer((s) => s.gravity);
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
  useEffect(() => {
    const moved = engine.version;
    engine.setTarget(layout, gravity);
    // A layout or gravity switch moves every star, so the camera re-frames whatever the reader
    // is looking at (the selection, the open drawer, or the whole collection) as one move with
    // the morph. Staying put would leave it aimed at where the subject used to be. A gravity
    // change while the graph is showing moves nothing, and frames nothing.
    if (engine.version !== moved) frameSubject(true);
    engine.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, layout, gravity]);
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

  // ── Hover from anywhere (the explorer, the record, the crumbs, the plate itself) ──
  // A hovered file is one uniform, a hovered group its depth-first range: no attribute uploads.
  useEffect(() => {
    engine.uniform("uHover", hover?.kind === "file" ? hover.id : -1);
    const [lo, hi] = hover?.kind === "dir" ? engine.hoverRange(hover.id) : [-1, -1];
    engine.setHotRange(lo, hi);
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
  function frameSubject(animate: boolean, everything: "home" | "here" = "here") {
    const s = useViewer.getState();
    if (s.selection) frameSelection(s.selection, animate);
    else if (s.focusDir !== null && s.focusDir !== 0) engine.fly(filesUnder(model, s.focusDir), undefined, [], animate, engine.outlinePad);
    else if (everything === "home" || engine.atHome || !engine.controls) engine.home(animate);
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
    engine.filePos(s.defFile, b, 1);
    for (const arc of [...s.arcs, ...s.dispatch].slice(0, ARC_CAP)) {
      laneApex(engine.filePos(arc.file, a, 1), b, ARC_LIFT, apex);
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

  // ── Keyboard: Esc walks up a level, F frames the selection ──
  // Escape belongs to the Galaxy tab's plate only. The Source tab's side plate is visible too,
  // and its handler cleared the selection under the reader: the record jumped to the project
  // overview while the reader still showed the file, and the URL dropped it.
  // Each press climbs one level (symbol, its file, its directory, ..., the supercluster, then
  // nothing; see walkUp), and the camera follows each level out. Clearing at once threw away
  // the reader's place: from a function, the way back to its package was a search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]")) return;
      if (!container.current || container.current.offsetParent === null) return; // hidden tab
      if (e.key === "Escape" && !compact) {
        const s = useViewer.getState();
        if (s.selection) {
          plateSelection.current = null;
          const up = walkUp(model.report, s.symbols, s.selection);
          select(up);
          // The last step (a supercluster, a root file) is "nothing": the open drawer, or the
          // whole web as the project crumb gives it. The selection effect frames each level on
          // the way up but has nothing to frame at the top, and the camera stayed zoomed on the
          // supercluster.
          if (!up) frameSubject(true, "home");
        } else if (s.focusDir !== null) focus(null);
      } else if (e.key === "f" || e.key === "F") frameSelection(useViewer.getState().selection);
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
      // A deliberate step needs no intent: it commits at once, marked as the plate's own so the
      // next pointer move over the void can take it back.
      plateWrote.current = { kind: "file", id: next };
      intent.forget();
      setHover(plateWrote.current);
      speak(next);
    } else if (e.key === "Enter" && cursor.current >= 0) {
      e.preventDefault();
      plateSelection.current = { kind: "file", id: cursor.current };
      select({ kind: "file", id: cursor.current });
    }
  };
  const onPlateBlur = () => {
    if (cursor.current >= 0 && useHover.getState().hover?.kind === "file") {
      plateWrote.current = null;
      setHover(null);
    }
    cursor.current = -1;
  };

  // ── Pointer: hover intent, click, double-click ──
  // Every rAF-throttled pointer sample picks what is under it (moon, then star, then the deepest
  // group, then the void) and shows that at once in the cheap ways: the cursor and a reticle on
  // the star, both uniforms. The card, the envelope, the lit lanes and the dimming wait for hover
  // intent (hoverIntent.ts), which commits only once the pointer settles; committed on every
  // pick, a sweep across a dense cluster flashed a dozen cards in half a second.
  const clicks = useMemo(() => new PlateClicks<PlateHit>(), []);
  const hoverFrame = useRef(0);
  const lastPoint = useRef<{ x: number; y: number; t: number; pointer: PointerKind; name: number }>({ x: 0, y: 0, t: 0, pointer: "mouse", name: -1 });
  const [moonHover, setMoonHover] = useState(-1);
  // Stars, moons and region names outrank groups: a group waits out a star's grace before
  // taking over. A name is a deliberate target, so it ranks with the stars.
  const intent = useMemo(() => new HoverIntent<PlateHit>(sameHit, HOVER_TUNING, (h) => (h.kind === "dir" ? 0 : 1)), []);
  /** What the plate last put in the hover store, so it only ever takes back its own hover. */
  const plateWrote = useRef<Target | null>(null);
  const intentTimer = useRef(0);
  // The moon ring belongs to the selected file. Clicking a moon selects its symbol and the ring
  // goes, but with the pointer still the hover was never cleared, so the moon's name stayed on
  // the plate over nothing; the same happened when another star took the selection.
  useEffect(() => {
    if (intent.committed?.kind === "moon") intent.forget();
    engine.pointerMoon = -1;
    if (engine.hoverMoon < 0) return;
    engine.hoverMoon = -1;
    setMoonHover(-1);
    if (container.current) container.current.style.cursor = "";
    engine.invalidate();
  }, [engine, intent, selection]);
  // Another view took the hover (an explorer row, a region name, a crumb): the plate's intent
  // lets go of its own, or it would think its card was still up and never commit it again.
  useEffect(
    () =>
      useHover.subscribe((s) => {
        if (sameTarget(s.hover, plateWrote.current)) return;
        plateWrote.current = null;
        if (intent.committed?.kind !== "moon") intent.forget();
      }),
    [intent],
  );
  useEffect(
    () => () => {
      window.clearTimeout(intentTimer.current);
      cancelAnimationFrame(hoverFrame.current);
    },
    [],
  );
  // Dev server only (build.ts defines NODE_ENV as "production", and the bundler drops this):
  // the full plate's engine, hover intent and stores on window, so scripted pointer runs can
  // read what was picked, what committed and when, while the hover constants are tuned.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || compact) return;
    const w = window as unknown as Record<string, unknown>;
    w.__plate = { engine, intent, viewer: useViewer, hover: useHover };
    return () => void delete w.__plate;
  }, [engine, intent, compact]);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = container.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onCanvas = (e: { target: EventTarget }) => (e.target as HTMLElement).tagName === "CANVAS";
  /** The region name (its directory id) under an event, or -1. */
  const nameAt = (e: { target: EventTarget }) => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-region-dir]");
    return el ? Number(el.dataset.regionDir) : -1;
  };
  /** A menu or dialog is open over the plate (a press now is the click that dismisses it). */
  const overlayOpen = () => !!document.querySelector("[role=menu][data-state=open], [role=dialog][data-state=open]");

  /** What a plate point holds, by precedence: a moon, a star, the deepest group, or nothing. */
  const pickAt = (x: number, y: number): PlateHit | null => {
    const held = intent.committed;
    const m = engine.pickMoon(x, y);
    if (m >= 0) return { kind: "moon", id: m };
    const i = engine.pick(x, y, held?.kind === "file" ? held.id : -1);
    if (i >= 0) return { kind: "file", id: i };
    const d = engine.pickGroup(x, y, held?.kind === "dir" ? held.id : -1);
    return d >= 0 ? { kind: "dir", id: d } : null;
  };
  /** Show what hover intent committed: a moon's name, or a star or group through the store. */
  const commit = (c: PlateHit | null) => {
    const moon = c?.kind === "moon" ? c.id : -1;
    if (moon !== engine.hoverMoon) {
      engine.hoverMoon = moon;
      setMoonHover(moon);
      engine.invalidate();
    }
    const next: Target | null = c && c.kind !== "moon" ? { kind: c.kind === "file" ? "file" : "dir", id: c.id } : null;
    const current = useHover.getState().hover;
    if (sameTarget(next, current)) return;
    // Letting go clears only the plate's own hover, never a row the reader is pointing at in
    // another panel.
    if (!next && !sameTarget(current, plateWrote.current)) return;
    plateWrote.current = next;
    setHover(next);
  };
  /** Run hover intent's clock: a pointer that stops dead still commits, a slipped-off one lets go. */
  const schedule = () => {
    window.clearTimeout(intentTimer.current);
    const due = intent.nextDeadline();
    if (due === null) return;
    intentTimer.current = window.setTimeout(
      () => {
        commit(intent.tick(performance.now()));
        schedule();
      },
      Math.max(4, due - performance.now()),
    );
  };
  /** The pointer left the plate, or is over chrome or a name drawn on it. */
  const pointerOff = () => {
    engine.uniform("uReticle", -1);
    engine.pointerMoon = -1;
    if (container.current) container.current.style.cursor = "";
    commit(intent.leave(performance.now()));
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.buttons !== 0) return;
    // Region names sit on the plate, in the path of every sweep, so they go through the same
    // intent as the stars. Hovered at once on pointerenter (as they were), a sweep that crossed
    // one flashed its group; and when the hover moved the specimen labels and the name stepped
    // aside for them, out from under the pointer, its pointerleave cleared the hover, the labels
    // moved back, and the name strobed at 30 Hz.
    const name = nameAt(e);
    if (!onCanvas(e) && name < 0) return pointerOff();
    lastPoint.current = { ...local(e), t: e.timeStamp, pointer: e.pointerType === "mouse" ? "mouse" : e.pointerType === "pen" ? "pen" : "touch", name };
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const p = lastPoint.current;
      // The pointer takes over from the arrow keys.
      cursor.current = -1;
      const hit: PlateHit | null = p.pointer !== "mouse" ? null : p.name >= 0 ? { kind: "name", id: p.name } : pickAt(p.x, p.y);
      engine.uniform("uReticle", hit?.kind === "file" ? hit.id : -1);
      engine.pointerMoon = hit?.kind === "moon" ? hit.id : -1;
      if (container.current) container.current.style.cursor = hit ? "pointer" : "";
      commit(intent.sample({ x: p.x, y: p.y, t: p.t, pointer: p.pointer }, hit));
      schedule();
    });
  };
  const onPointerLeave = () => pointerOff();
  // Clicks (clicks.ts): only a press that began on the stars, with no menu open, can select; and
  // the second press of a double-click leaves the first click's selection alone.
  const onPointerDown = (e: ReactPointerEvent) => {
    const p = local(e);
    clicks.press(p.x, p.y, performance.now(), onCanvas(e) && !overlayOpen());
    // An orbit drag is about to move the stars out from under the reticle.
    engine.uniform("uReticle", -1);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const p = local(e);
    const now = performance.now();
    if (clicks.release(p.x, p.y, now, onCanvas(e), e.button === 0) !== "click") return;
    // The same precedence as hover, with the committed hover sticky: a click lands on the star
    // whose card is showing. On touch and pen there is no hover, and a tap selects.
    const hit = pickAt(p.x, p.y);
    clicks.clicked(p.x, p.y, now, hit);
    if (hit?.kind === "moon") {
      select({ kind: "symbol", id: engine.moonSymbols[hit.id]! });
      return;
    }
    if (hit?.kind === "dir") {
      // A group is selected and framed: the flight runs because the plate does not claim the
      // selection (the selection effect flies to anything the plate did not pick in place).
      plateSelection.current = null;
      select({ kind: "dir", id: hit.id });
      return;
    }
    const target: Target | null = hit ? { kind: "file", id: hit.id } : null;
    // Empty plate with nothing selected: the reader wants the resting labels out of the way.
    if (!target && !useViewer.getState().selection) setDismissed(true);
    plateSelection.current = target;
    select(target);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!onCanvas(e)) return;
    const p = local(e);
    // What the first click picked, before its camera flight moved the stars under the pointer.
    const first = clicks.doubleHit(p.x, p.y, performance.now());
    const hit = first !== undefined ? first : pickAt(p.x, p.y);
    if (hit?.kind === "file") {
      const top = model.topDir[hit.id]!;
      if (top > 0) focus(top);
    } else if (hit?.kind === "dir") focus(hit.id);
  };

  const R = engine.radius;
  const start = engine.homeDirection.clone().multiplyScalar(R * 2.6);
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
      aria-roledescription="sky map"
      aria-label={`Sky map of ${model.report.project.name}: ${formatInt(model.fileCount)} files. Drag to orbit, scroll to zoom, click a star to select it, or the space around a group of stars to select that directory. With the map focused, arrow keys step between stars and Enter selects one${compact ? "" : "; Escape steps up one level, from a symbol to its file, its directory and on up"}; F frames it. Command K finds any file by name.`}
    >
      <Canvas
        className="absolute inset-0"
        dpr={[1, 2]}
        frameloop="demand"
        flat
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: R * 0.002, far: R * 40, up: [0, 0, 1], position: [start.x, start.y, start.z] }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(PLATE), 1)}
      >
        <Scene engine={engine} symbolScene={scene} />
      </Canvas>
      <GroupEnvelopes engine={engine} />
      {!compact && <RegionLabels engine={engine} />}
      <SpecimenLabels engine={engine} compact={compact} scene={scene} dismissed={dismissed} />
      <MoonLabel engine={engine} index={moonHover} />
      <PlateMarks engine={engine} compact={compact} raised={hasHistory} />
      <PlateTitle engine={engine} compact={compact} />
      {compact ? (
        <PlateFilterChip engine={engine} compact />
      ) : (
        // Notes under the title, stacked so none has to know the others' heights: the filter
        // chip, the selection's breadcrumb, the code-intelligence status.
        <div className="pointer-events-none absolute top-[58px] left-6 z-20 flex max-w-[calc(100%-3rem)] flex-col items-start gap-1.5 @max-[640px]:top-[92px]">
          <PlateFilterChip engine={engine} compact={false} />
          <PlateCrumbs engine={engine} />
          <PlateStatus />
        </div>
      )}
      <PlateLegend engine={engine} compact={compact} raised={hasHistory} scene={scene} onPreview={(p) => setPreview(() => p)} />
      <PlateControls engine={engine} compact={compact} />
      {hasHistory && <HistoryScrubber engine={engine} />}
      <p className="sr-only" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}

/**
 * What a plate point can hold. Moon ids index engine.moonSymbols; the rest are report ids. A
 * "name" is a region name drawn on the plate, a directory like a "dir" but picked from the DOM.
 */
type PlateHit = { kind: "file" | "dir" | "moon" | "name"; id: number };

function sameHit(a: PlateHit, b: PlateHit): boolean {
  return a.kind === b.kind && a.id === b.id;
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
      className="pointer-events-none absolute top-0 left-0 z-30 bg-white px-1.5 py-0.5 text-[11px] whitespace-nowrap text-[#11171d]"
      role="tooltip"
    >
      <span className="font-mono">{symbols.symbols.name[s]}</span> <span className="text-[#5a6571] italic">{symbols.symbols.kind[s]}</span>
    </div>
  );
}
