/**
 * Specimen labels: white label stock pinned to stars by 1px hairline leaders.
 *
 * The signature of the Specimen Cabinet direction. Which files get a label is React's job and
 * changes rarely (hover, selection, focus); where each label sits is the frame bus's job and
 * changes every frame the camera moves. Placement is greedy in priority order (selected, then
 * hovered, then holotypes): each label tries a ring of positions around its star, keeps last
 * frame's position while it is still clear (so labels do not hop as the camera turns), and
 * avoids the other labels, the other pinned stars, the plate's chrome, the region names, its
 * own star and the lanes or arcs it is describing.
 *
 * Three forms of label stock:
 *   card  the full specimen label (Language, Category, Path, Collector, Collected, det. line)
 *   pin   one line, the file's name: secondary holotypes, and every label on a narrow plate,
 *         where a card covered 40% of a phone-width galaxy (the record below has the rest)
 *   tag   a selected symbol's one-line tag under its definition, clear of the arcs above it
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CATEGORY_GROUP } from "../../shared/schema";
import { CATEGORY_GROUP_LABEL } from "../lib/colors";
import { baseName, formatDate, formatInt, formatIsoDate, shortenPath } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import { passesFilters } from "./encode";
import { FRAME_ORDER, regionOfDir, type GalaxyEngine, type PlateRect, type RegionLabelRect } from "./engine";
import { ARC_LIFT, laneApex, selectionLanes } from "./lanes";
import { describeRelation, type SymbolScene } from "./symbolScene";

type LabelKind = "selected" | "hover" | "holotype" | "symbol";
type LabelForm = "card" | "pin" | "tag";

interface LabelSpec {
  key: string;
  file: number;
  kind: LabelKind;
  form: LabelForm;
  /** Overrides the card's det. line (a ripple's reason, a file not yet collected). */
  det?: string;
}

/** Plates narrower than this get pins instead of cards (phones, the Source tab's side plate). */
export const NARROW_PLATE = 560;
/**
 * Below this, even the resting lead holotype is a pin. A card is 216 × 150 px; on the 680 px
 * plate a 1280 px window leaves, the only room for it was over the galaxy's core, where it hid
 * four region names. A reader who picks or hovers a star still gets that star's card.
 */
const REST_CARD_PLATE = 760;
/** Holotype pins shown at rest beside the main holotype card (the sketch pins three in all). */
const REST_PINS = 2;
/** Arcs considered when keeping labels off a symbol's arcs; enough to find the fan's shape. */
const ARC_OBSTACLES = 160;

const GAP_NEAR = 34;
const GAP_FAR = 88;
const GAP_OUT = 150;
const PIN_NEAR = 18;
const PIN_FAR = 52;
const MARGIN = 8;

export function overlaps(a: PlateRect, b: PlateRect, pad = 6): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/**
 * What covering a region name costs a label, per name its card or leader touches. More than the
 * densest star field (capped at 18) or lane bundle (24) can cost, so a label takes a busier spot
 * before it strikes a name out: at 8 a name, capped at 24, a holotype pin's leader ran straight
 * through ".claude 49" at 1280 px. Still soft, because a name that cannot be avoided steps aside
 * (RegionLabels' yield pass) rather than hiding the label.
 */
const REGION_COST = 26;
/** The open drawer's name never steps aside, so a label pays far more to touch it. */
const REGION_PINNED_COST = 60;

/** Cost of a label at `r`, its leader running (ax, ay) → (ex, ey), over the region names shown. */
export function regionCost(regions: readonly RegionLabelRect[], r: PlateRect, ax: number, ay: number, ex: number, ey: number): number {
  let cost = 0;
  for (const g of regions) {
    if (overlaps(r, g, 3) || segmentHitsRect(ax, ay, ex, ey, g)) cost += g.pinned ? REGION_PINNED_COST : REGION_COST;
  }
  return cost;
}

/** Does the segment (x1, y1)–(x2, y2) pass through the rectangle? Liang-Barsky clipping. */
export function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, r: PlateRect): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x1 - r.x) && clip(dx, r.x + r.w - x1) && clip(-dy, y1 - r.y) && clip(dy, r.y + r.h - y1) && t0 <= t1;
}

/**
 * The plate's chrome, which labels must not cover: the title, the controls, the legend and the
 * scrubber. Read from the DOM (elements carry data-plate-chrome) so the overlay never has to
 * know their sizes.
 */
function chromeRects(container: HTMLElement | null): PlateRect[] {
  if (!container) return [];
  const base = container.getBoundingClientRect();
  const out: PlateRect[] = [];
  container.querySelectorAll<HTMLElement>("[data-plate-chrome]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) out.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
  });
  return out;
}

export function SpecimenLabels({
  engine,
  compact,
  scene,
  dismissed,
}: {
  engine: GalaxyEngine;
  compact: boolean;
  /** The selected symbol's neighborhood: the definition gets a tag, and hover cards say why a star is lit. */
  scene: SymbolScene | null;
  /** The reader clicked empty plate: the resting holotype labels stay down until the next selection. */
  dismissed: boolean;
}) {
  const model = engine.model;
  const selection = useViewer((s) => s.selection);
  const focusDir = useViewer((s) => s.focusDir);
  const symbols = useViewer((s) => s.symbols);
  const edges = useViewer((s) => s.edges);
  const time = useViewer((s) => s.time);
  const filters = useViewer((s) => s.filters);
  const hover = useHover((s) => s.hover);

  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = compact || (width > 0 && width < NARROW_PLATE);

  const specs = useMemo<LabelSpec[]>(() => {
    const out: LabelSpec[] = [];
    const seen = new Set<number>();
    const add = (file: number, kind: LabelKind, form: LabelForm, det?: string) => {
      if (file < 0 || file >= model.fileCount || seen.has(file)) return;
      // A holotype the reader filtered out keeps no label: its star is dimmed with the rest,
      // and a red card over it said the opposite.
      if (kind === "holotype" && !passesFilters(model, file, filters)) return;
      seen.add(file);
      out.push({ key: `${kind}:${form}:${file}`, file, kind, form, det });
    };
    const card: LabelForm = narrow ? "pin" : "card";
    // A file the scrubber has not reached yet: say so on its label (the plate draws a ghost ring).
    const notYet = (file: number) => {
      const born = model.created[file]!;
      return time !== null && !Number.isNaN(born) && born > time ? `Not yet collected on ${formatDate(time)}; collected ${formatIsoDate(born)}` : undefined;
    };
    if (selection?.kind === "file") add(selection.id, "selected", card, notYet(selection.id));
    // A selected symbol speaks through a slim tag under its definition. On the Source tab's side
    // plate there is no room for even that; the legend's one-line key carries it there.
    if (selection?.kind === "symbol" && symbols && !compact) add(symbols.symbols.file[selection.id]!, "symbol", "tag");
    if (hover?.kind === "file" && !compact) add(hover.id, "hover", card, (scene && symbols && describeRelation(scene, symbols, hover.id)) || notYet(hover.id));
    // A symbol's neighborhood is the subject while one is selected; holotype labels would only
    // compete with its arcs.
    if (!compact && selection?.kind !== "symbol") {
      if (selection?.kind === "file") {
        // With a file pinned, the holotype worth a label is the one in its own drawer: the file
        // its neighbors most depend on, for comparison. A pin, so the selection's card leads.
        const holo = model.holotypeOfDir.get(model.topDir[selection.id]!);
        if (holo !== undefined) add(holo, "holotype", "pin");
      } else if (dismissed) {
        // The reader cleared the plate; nothing comes back until they pick something.
      } else if (focusDir !== null && focusDir !== 0) {
        const region = regionOfDir(engine, focusDir);
        const dir = engine.regions[region]?.dir;
        const holo = dir === undefined ? undefined : model.holotypeOfDir.get(dir);
        if (holo !== undefined) add(holo, "holotype", card);
      } else {
        // At rest: the holotype everything leans on most gets the card, and the next ones get
        // pins. Three full cards covered a third of the plate at 1440 px; pins carry the name
        // and the red, which is what "follow the holotypes" needs from the first viewport.
        const ranked = engine.regions
          .filter((r) => r.dir !== 0)
          .map((r) => model.holotypeOfDir.get(r.dir))
          .filter((f): f is number => f !== undefined && model.report.files[f]!.fanIn >= 3)
          .sort((a, b) => model.report.files[b]!.fanIn - model.report.files[a]!.fanIn || a - b);
        // While a star is hovered (or stepped to from the keyboard) its card leads, and the
        // holotype card it displaced went looking for room and covered four region names.
        const lead: LabelForm = hover?.kind === "file" || width < REST_CARD_PLATE ? "pin" : card;
        ranked.slice(0, 1 + (narrow ? 1 : REST_PINS)).forEach((f, i) => add(f, "holotype", i === 0 ? lead : "pin"));
      }
    }
    return out;
  }, [model, engine, selection, symbols, hover, focusDir, compact, narrow, width, dismissed, scene, time, filters]);

  // The lanes a selected file draws, so its label can stay off them.
  const laneEnds = useMemo(() => {
    if (selection?.kind !== "file" || edges === "none") return null;
    const set = selectionLanes(model, selection.id);
    return { from: selection.id, ends: [...set.imports, ...set.importers] };
  }, [model, selection, edges]);

  const cards = useRef(new Map<string, HTMLDivElement>());
  const lines = useRef(new Map<string, SVGLineElement>());
  const dots = useRef(new Map<string, SVGCircleElement>());
  const sizes = useRef(new Map<string, { w: number; h: number }>());
  const previous = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    for (const s of specs) {
      const el = cards.current.get(s.key);
      if (el) sizes.current.set(s.key, { w: el.offsetWidth, h: el.offsetHeight });
    }
    engine.invalidate();
  }, [specs, engine]);

  useEffect(() => {
    const pt = { x: 0, y: 0 };
    const scratch = new THREE.Vector3();
    const a3 = new THREE.Vector3();
    const b3 = new THREE.Vector3();
    const apex = new THREE.Vector3();
    let chrome: PlateRect[] = [];
    let chromeAge = 0;
    /** World point → plate px, or null behind the camera. */
    const project = (v: THREE.Vector3, camera: THREE.Camera, W: number, H: number): { x: number; y: number } | null => {
      scratch.copy(v).applyMatrix4(camera.matrixWorldInverse);
      if (scratch.z >= 0) return null;
      scratch.applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrix);
      return { x: (scratch.x + 1) * 0.5 * W, y: (1 - scratch.y) * 0.5 * H };
    };
    return engine.onFrame(({ camera, width: W, height: H }) => {
      // Chrome rarely moves; re-read it every 30 frames instead of every frame.
      if (chromeAge-- <= 0) {
        chrome = chromeRects(container.current?.parentElement ?? null);
        chromeAge = 30;
      }
      engine.refreshDensity();
      const anchors: ({ x: number; y: number } | null)[] = specs.map((s) => (engine.screenOf(s.file, pt, scratch) ? { x: pt.x, y: pt.y } : null));

      // The focal bundle: the selected file's lanes, or the selected symbol's arcs (each as two
      // straight pieces through its apex, which bound the curve). Labels count how many of
      // these they would cover and prefer the spots that cover fewest.
      const segs: number[] = [];
      if (laneEnds) {
        const o = engine.screenOf(laneEnds.from, pt, scratch) ? { x: pt.x, y: pt.y } : null;
        if (o) for (const f of laneEnds.ends) if (engine.screenOf(f, pt, scratch)) segs.push(o.x, o.y, pt.x, pt.y);
      }
      if (scene) {
        engine.filePos(scene.defFile, b3);
        const d = project(b3, camera, W, H);
        if (d) {
          for (const arc of [...scene.arcs, ...scene.dispatch].slice(0, ARC_OBSTACLES)) {
            engine.filePos(arc.file, a3);
            laneApex(a3, b3, ARC_LIFT, apex);
            const s0 = project(a3, camera, W, H);
            const s1 = project(apex, camera, W, H);
            if (!s0 || !s1) continue;
            segs.push(s0.x, s0.y, s1.x, s1.y, s1.x, s1.y, d.x, d.y);
          }
        }
      }
      const crossings = (r: PlateRect) => {
        let c = 0;
        for (let k = 0; k < segs.length; k += 4) if (segmentHitsRect(segs[k]!, segs[k + 1]!, segs[k + 2]!, segs[k + 3]!, r)) c++;
        return c;
      };
      const regions = engine.regionLabelRects;

      const placed: PlateRect[] = [];
      // Leaders as drawn this frame, from the star itself (not the gap) to the label's edge, so a
      // region name sitting on a pinned star counts as crossed. The region labels' yield pass
      // reads them.
      const leaders: number[] = [];
      specs.forEach((spec, idx) => {
        const card = cards.current.get(spec.key);
        const line = lines.current.get(spec.key);
        const dot = dots.current.get(spec.key);
        if (!card || !line || !dot) return;
        const a = anchors[idx];
        const fallback = spec.form === "card" ? { w: 196, h: 110 } : { w: 120, h: 18 };
        const size = sizes.current.get(spec.key) ?? fallback;
        const hide = () => {
          card.style.opacity = "0";
          line.setAttribute("visibility", "hidden");
          dot.setAttribute("visibility", "hidden");
        };
        if (!a || a.x < -10 || a.y < -10 || a.x > W + 10 || a.y > H + 10) return hide();
        // A holotype whose star a label placed before it already covers has nothing to point at.
        if (spec.kind === "holotype" && placed.some((p) => a.x > p.x - 4 && a.x < p.x + p.w + 4 && a.y > p.y - 4 && a.y < p.y + p.h + 4)) return hide();
        const { w, h } = size;
        const candidates: [number, number, number][] = []; // x, y, preference cost
        if (spec.form === "tag") {
          // Arcs rise off the disc (+z), which is up on the plate from every default view, so
          // the definition's tag hangs below its star, clear of the fan it describes.
          candidates.push(
            [a.x - w / 2, a.y + 22, 0],
            [a.x + 16, a.y + 16, 0.5],
            [a.x - 16 - w, a.y + 16, 0.5],
            [a.x - w / 2, a.y + 60, 1],
            [a.x + 26, a.y - h / 2, 4],
            [a.x - 26 - w, a.y - h / 2, 4],
            [a.x - w / 2, a.y - 22 - h, 10],
          );
        } else {
          const gaps = spec.form === "pin" ? [PIN_NEAR, PIN_FAR] : spec.kind === "holotype" ? [GAP_NEAR, GAP_FAR, GAP_OUT] : [GAP_NEAR, GAP_FAR];
          // Holotype cards may run a longer leader out of the dense middle; a pinned or hovered
          // card stays close to the star the reader is looking at.
          gaps.forEach((d, ring) => {
            const p = ring * 0.01;
            candidates.push(
              [a.x + d, a.y - d - h, p],
              [a.x - d - w, a.y - d - h, p + 0.5],
              [a.x + d, a.y + d, p + 0.5],
              [a.x - d - w, a.y + d, p + 0.5],
              [a.x + d + 10, a.y - h / 2, p + 0.5],
              [a.x - d - 10 - w, a.y - h / 2, p + 0.5],
            );
          });
        }
        // Hard costs (off the plate, over another label, over the chrome, over another pinned
        // star, over its own star) dominate. Region names, covered stars and crossed lanes are
        // soft, so a label prefers the dark lanes between arms but still lands somewhere when
        // the whole plate is busy; a region name it cannot avoid steps aside instead.
        const hard = (ci: number): number => {
          const [x, y] = candidates[ci]!;
          const r = { x, y, w, h };
          let s = 0;
          if (x < MARGIN || y < MARGIN || x + w > W - MARGIN || y + h > H - MARGIN) s += 100;
          for (const p of placed) if (overlaps(r, p)) s += 50;
          for (const c of chrome) if (overlaps(r, c, 4)) s += 30;
          // Stars whose labels were placed first are hard to cover. Those still to come are a
          // soft cost (see soft): at 1280 px the resting holotype card found every spot
          // blocked by the stars of the two pins after it, and hid, leaving only the pins.
          anchors.forEach((o, j) => {
            if (o && j < idx && o.x > x - 6 && o.x < x + w + 6 && o.y > y - 6 && o.y < y + h + 6) s += 20;
          });
          if (a.x > x - 8 && a.x < x + w + 8 && a.y > y - 8 && a.y < y + h + 8) s += 60;
          return s;
        };
        const soft = (ci: number): number => {
          const [x, y, pref] = candidates[ci]!;
          const r = { x, y, w, h };
          // The leader runs from the star to the label's nearest point; one drawn through a
          // region name strikes it out as surely as a label on top of it.
          const ex = Math.min(Math.max(a.x, x), x + w);
          const ey = Math.min(Math.max(a.y, y), y + h);
          return regionCost(regions, r, a.x, a.y, ex, ey) + laterCost(x, y, w, h) + Math.min(18, engine.starsIn(x, y, w, h) * 0.25) + Math.min(24, crossings(r) * 0.7) + pref;
        };
        const laterCost = (x: number, y: number, w: number, h: number) => {
          let later = 0;
          anchors.forEach((o, j) => {
            if (o && j > idx && o.x > x - 6 && o.x < x + w + 6 && o.y > y - 6 && o.y < y + h + 6) later++;
          });
          return later * 6;
        };
        const score = (ci: number) => hard(ci) + soft(ci);
        // Keep last frame's spot unless another is clearly better, so labels do not hop while
        // the camera turns.
        let best = previous.current.get(spec.key) ?? 0;
        let bestScore = best < candidates.length ? score(best) - 2 : Infinity;
        for (let ci = 0; ci < candidates.length; ci++) {
          const sc = score(ci) + ci * 0.01; // nearer positions win ties
          if (sc < bestScore) {
            bestScore = sc;
            best = ci;
          }
        }
        // Holotype labels are a courtesy: they step aside rather than crowd the plate.
        if (spec.kind === "holotype" && hard(best) >= 20) return hide();
        previous.current.set(spec.key, best);
        // On a narrow plate no candidate may fit; keep the label on the plate anyway and let the
        // leader find it, rather than hang it off the edge.
        const x = Math.max(MARGIN, Math.min(candidates[best]![0], W - w - MARGIN));
        let y = Math.max(MARGIN, Math.min(candidates[best]![1], H - h - MARGIN));
        // Clamping can land the label on the legend or the title, and a label over the legend
        // hides the key to every color on the plate. Slide it vertically off any chrome it still
        // covers.
        for (const c of chrome) {
          if (!overlaps({ x, y, w, h }, c, 4)) continue;
          const up = c.y - h - 6;
          const down = c.y + c.h + 6;
          y = y + h / 2 < c.y + c.h / 2 && up >= MARGIN ? up : down + h <= H - MARGIN ? down : up;
          y = Math.max(MARGIN, Math.min(y, H - h - MARGIN));
        }
        const rect = { x, y, w, h };
        placed.push(rect);
        card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        card.style.opacity = "1";
        // Leader: from just outside the star to the nearest point of the label.
        const ex = Math.min(Math.max(a.x, x), x + w);
        const ey = Math.min(Math.max(a.y, y), y + h);
        const len = Math.hypot(ex - a.x, ey - a.y) || 1;
        const gap = spec.form === "tag" ? 12 : 7;
        const sx = a.x + ((ex - a.x) / len) * Math.min(gap, len);
        const sy = a.y + ((ey - a.y) / len) * Math.min(gap, len);
        line.setAttribute("x1", sx.toFixed(1));
        line.setAttribute("y1", sy.toFixed(1));
        line.setAttribute("x2", ex.toFixed(1));
        line.setAttribute("y2", ey.toFixed(1));
        line.setAttribute("visibility", len > gap ? "visible" : "hidden");
        dot.setAttribute("cx", ex.toFixed(1));
        dot.setAttribute("cy", ey.toFixed(1));
        dot.setAttribute("visibility", len > gap ? "visible" : "hidden");
        if (len > gap) leaders.push(a.x, a.y, ex, ey);
      });
      engine.labelRects = placed;
      engine.labelLeaders = leaders;
    }, FRAME_ORDER.LABELS);
  }, [engine, specs, laneEnds, scene]);

  useEffect(
    () => () => {
      engine.labelRects = [];
      engine.labelLeaders = [];
    },
    [engine],
  );

  return (
    <div ref={container} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full">
        {specs.map((s) => (
          <g key={s.key}>
            <line
              ref={(el) => void (el ? lines.current.set(s.key, el) : lines.current.delete(s.key))}
              stroke="#ffffff"
              strokeOpacity={s.kind === "hover" ? 0.7 : 0.9}
              strokeWidth={1}
              visibility="hidden"
            />
            <circle ref={(el) => void (el ? dots.current.set(s.key, el) : dots.current.delete(s.key))} r={2} fill="#ffffff" visibility="hidden" />
          </g>
        ))}
      </svg>
      {specs.map((s) => {
        const ref = (el: HTMLDivElement | null) => void (el ? cards.current.set(s.key, el) : cards.current.delete(s.key));
        if (s.form === "tag") return <SymbolTag key={s.key} cardRef={ref} />;
        if (s.form === "pin") return <PinLabel key={s.key} engine={engine} spec={s} cardRef={ref} />;
        return <SpecimenCard key={s.key} engine={engine} spec={s} cardRef={ref} />;
      })}
    </div>
  );
}

/** Label stock: white in both themes (it is paper on glass), so its colors are fixed, not tokens. */
const SpecimenCard = memo(function SpecimenCard({
  engine,
  spec,
  cardRef,
}: {
  engine: GalaxyEngine;
  spec: LabelSpec;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const model = engine.model;
  const report = model.report;
  const f = report.files[spec.file]!;
  const holo = model.holotypes.has(spec.file);
  const lang = model.languages.get(f.language)?.name ?? f.language;
  const owner = f.git && report.git ? report.git.authors[f.git.owner] : undefined;
  const fields: [string, string, boolean][] = [
    ["Language", lang, false],
    ["Category", CATEGORY_GROUP_LABEL[CATEGORY_GROUP[f.category]], false],
    ["Path", shortenPath(f.path, 28), true],
  ];
  if (owner) fields.push(["Collector", owner.name, false]);
  if (f.git) fields.push(["Collected", formatIsoDate(f.git.created), true]);
  const det = spec.det ?? engine.facts.det(spec.file);
  return (
    <div
      ref={cardRef}
      className={cn(
        "absolute top-0 left-0 px-2.5 pt-2 pb-[7px] text-[11px] leading-[1.35] transition-opacity duration-150 will-change-transform",
        holo ? "w-[216px] bg-holotype text-white" : "w-[196px] bg-white text-[#15191c]",
      )}
      style={{ opacity: 0 }}
    >
      <div className={cn("mb-[5px] truncate border-b pb-1 text-[13px] font-bold [font-stretch:80%]", holo ? "border-white" : "border-[#15191c]")}>
        {holo ? `Holotype · ${baseName(f.path)}` : baseName(f.path)}
      </div>
      <dl className="grid grid-cols-[62px_1fr] gap-y-0.5">
        {fields.map(([k, v, mono]) => (
          <div key={k} className="contents">
            <dt className={cn("[font-stretch:75%]", holo ? "text-[#fff3f1]" : "text-[#5d666d]")}>{k}</dt>
            <dd className={cn("truncate", mono ? "font-mono text-[10.5px]" : "")} title={k === "Path" ? f.path : undefined}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className={cn("mt-[5px] border-t pt-1 italic", holo ? "border-[#e07a6e] text-[#fff3f1]" : "border-[#d5d9d6] text-[#5d666d]")}>{det}</div>
    </div>
  );
});

/** One line of label stock: the file's name, red for a holotype. */
const PinLabel = memo(function PinLabel({
  engine,
  spec,
  cardRef,
}: {
  engine: GalaxyEngine;
  spec: LabelSpec;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const f = engine.model.report.files[spec.file]!;
  const holo = engine.model.holotypes.has(spec.file);
  return (
    <div
      ref={cardRef}
      className={cn(
        "absolute top-0 left-0 max-w-[200px] truncate px-1.5 py-[3px] text-[11px] leading-[1.15] font-bold whitespace-nowrap [font-stretch:80%] transition-opacity duration-150 will-change-transform",
        holo ? "bg-holotype text-white" : "bg-white text-[#15191c]",
      )}
      style={{ opacity: 0 }}
      title={f.path}
    >
      {holo ? `Holotype · ${baseName(f.path)}` : baseName(f.path)}
      {spec.det && spec.kind !== "holotype" && <span className="ml-1.5 font-normal italic opacity-75">{spec.det}</span>}
    </div>
  );
});

/** A selected symbol's tag: name, kind, references and files, on one line of label stock. */
function SymbolTag({ cardRef }: { cardRef: (el: HTMLDivElement | null) => void }) {
  const selection = useViewer((s) => s.selection);
  const symbols = useViewer((s) => s.symbols);
  if (selection?.kind !== "symbol" || !symbols) return null;
  const t = symbols.symbols;
  const s = selection.id;
  return (
    <div
      ref={cardRef}
      className="absolute top-0 left-0 bg-white px-2 py-1 text-[11px] leading-[1.2] whitespace-nowrap text-[#15191c] transition-opacity duration-150 will-change-transform"
      style={{ opacity: 0 }}
    >
      <span className="font-mono font-semibold">{t.name[s]}</span>
      <span className="text-[#5d666d]">
        {" "}
        · <span className="italic">{t.kind[s]}</span> · <span className="figures font-mono">{formatInt(t.refs[s]!)}</span> refs ·{" "}
        <span className="figures font-mono">{formatInt(t.files[s]!)}</span> files
      </span>
    </div>
  );
}
