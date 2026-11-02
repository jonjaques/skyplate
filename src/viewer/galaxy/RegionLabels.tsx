/**
 * Region names on the plate: one quiet label per top-level drawer, pinned to the region.
 *
 * Each label sits on its supercluster's own stars (the member nearest the region's centroid, so
 * it lands on a cluster rather than in the void between them; see GalaxyEngine.regionAnchor)
 * and follows the morph.
 * Hovering one lights its members and its filaments; clicking opens the drawer. A label that would
 * collide with a larger region's label, or with the plate chrome, steps aside for the frame. One
 * that a specimen label or its leader could not avoid moves below or beside its star, and steps
 * aside only when those spots are taken too (see FRAME_ORDER). With a drawer open, the other
 * regions' names dim with their stars: at full strength they floated over empty plate.
 *
 * Every name carries a halo in the plate's own color, as a map knocks a road out from under a
 * town name. The names sit on their region's stars by design, and without it a star landed on
 * the "3" of "packages 349" and lanes ran through the letters.
 *
 * Hovering a name goes through the plate's hover intent (GalaxyView reads the name under the
 * pointer from data-region-dir), so a sweep across one does not flash its group. And the name
 * under the pointer holds still: hovering a group re-lays the specimen labels, and a name that
 * stepped aside for them moved out from under the pointer, lost the hover, moved back, and
 * strobed at 30 Hz on inertialref's landing view (measured).
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import { FRAME_ORDER, regionOfDir, type GalaxyEngine, type PlateRect, type Region, type RegionLabelRect } from "./engine";
import { overlaps, segmentHitsRect } from "./Labels";

type Placed = PlateRect;

/** Gap between a name and the star it is pinned to. */
const NAME_GAP = 10;

/**
 * The halo: a plate-colored stroke painted under the glyphs (paint-order puts the fill on top,
 * so the letters keep their full weight), feathered by a soft shadow of the same color. Two
 * pixels each side covers a 12px label's counters and letter gaps, so no star or lane shows
 * inside a word; a wider stroke would start erasing the region's own stars around the name.
 */
export const HALO = "[paint-order:stroke_fill] [-webkit-text-stroke:4px_var(--color-plate)] [text-shadow:0_0_4px_var(--color-plate)]";

/**
 * Does any specimen label or group tag, or any leader running from a pinned star to its label,
 * touch `r`? A leader starting on a star the name sits over counts, so the name gives up that
 * star.
 */
export function touchedBySpecimens(r: PlateRect, labels: readonly PlateRect[], leaders: readonly number[], tags: readonly PlateRect[] = NO_TAGS): boolean {
  // Indexed loops: this runs for every name on every frame the camera turns, and for-of's
  // iterators were garbage in the heap profile.
  for (let i = 0; i < labels.length; i++) if (overlaps(r, labels[i]!, 3)) return true;
  for (let i = 0; i < tags.length; i++) if (overlaps(r, tags[i]!, 3)) return true;
  const g = GROWN;
  g.x = r.x - 2;
  g.y = r.y - 2;
  g.w = r.w + 4;
  g.h = r.h + 4;
  for (let k = 0; k + 3 < leaders.length; k += 4) if (segmentHitsRect(leaders[k]!, leaders[k + 1]!, leaders[k + 2]!, leaders[k + 3]!, g)) return true;
  return false;
}
const GROWN: PlateRect = { x: 0, y: 0, w: 0, h: 0 };
const NO_TAGS: readonly PlateRect[] = [];

/** A name shown this frame: where it sits, the other spots it could take, and what pins it. */
export interface ShownName {
  r: Placed;
  alts: Placed[];
  /** The open drawer's name: it never steps aside. */
  focused: boolean;
  /** Under the pointer: it does not move at all (see the header). */
  held: boolean;
}

/**
 * The yield pass's decision for one name a specimen label, a group tag or a leader touches: a
 * free spot around its star, "stay" (the open drawer's name with nowhere to go, or the name under
 * the pointer, which must not move), or "hide" for this frame.
 */
export function yieldName(entry: ShownName, free: (r: Placed) => boolean): Placed | "stay" | "hide" {
  if (entry.held) return "stay";
  for (let i = 0; i < entry.alts.length; i++) if (free(entry.alts[i]!)) return entry.alts[i]!;
  return entry.focused ? "stay" : "hide";
}

export function RegionLabels({ engine }: { engine: GalaxyEngine }) {
  const focusDir = useViewer((s) => s.focusDir);
  const selection = useViewer((s) => s.selection);
  const focus = useViewer((s) => s.focus);
  const select = useViewer((s) => s.select);
  const time = useViewer((s) => s.time);
  const setHover = useHover((s) => s.setHover);
  const focusRegion = focusDir === null ? -1 : regionOfDir(engine, focusDir);
  // The region that is lit while everything else dims: the open drawer, else a selected
  // directory (the rail and the palette select one without opening it).
  const litRegion =
    focusDir !== null && focusDir !== 0 ? focusRegion : selection?.kind === "dir" && selection.id !== 0 ? regionOfDir(engine, selection.id) : -1;
  const quiet = selection?.kind === "symbol";

  const regions = useMemo(() => engine.regions.filter((r) => r.files.length >= 2), [engine]);
  // Each name's count at the scrubber's date: the stars it names, not the files at HEAD.
  // (A region's files are its depth-first range: the root's own, or a top-level subtree.)
  const counts = useMemo(() => regions.map((r) => engine.presentIn(...engine.hoverRange(r.dir), time)), [engine, regions, time]);
  const els = useRef(new Map<number, HTMLButtonElement>());
  const wrapper = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<number, { w: number; h: number }>());
  /** The name under the pointer, held where it was when the pointer arrived (see the header). */
  const held = useRef<{ index: number; dx: number; dy: number } | null>(null);
  /** Per region: the name's last placed corner and its anchor on screen, x y sx sy. */
  const last = useRef(new Float32Array(0));
  if (last.current.length < engine.regions.length * 4) last.current = new Float32Array(engine.regions.length * 4);

  useEffect(() => {
    for (const region of regions) {
      const el = els.current.get(region.index);
      if (el) sizes.current.set(region.index, { w: el.offsetWidth, h: el.offsetHeight });
    }
    engine.invalidate();
  }, [engine, regions, counts]);

  useEffect(() => {
    const a = new THREE.Vector3();
    const container = wrapper.current?.parentElement ?? null;
    const at = last.current;
    let chrome: Placed[] = [];
    let age = 0;
    let W = 0;
    let H = 0;
    // One record per name, reused every frame: the passes run on every frame the camera turns,
    // and building a rect per name per frame was garbage the collector had to chase.
    const slots = regions.map((region) => ({
      region,
      el: null as HTMLButtonElement | null,
      entry: { r: { x: 0, y: 0, w: 0, h: 0 }, alts: [0, 1, 2].map(() => ({ x: 0, y: 0, w: 0, h: 0 })), focused: false, held: false } as ShownName,
      rect: { x: 0, y: 0, w: 0, h: 0, dir: region.dir } as RegionLabelRect,
      shown: false,
    }));
    const placed: RegionLabelRect[] = [];
    const rest: Placed[] = [];
    const onPlate = (r: Placed) => r.x > 4 && r.y > 4 && r.x + r.w < W - 4 && r.y + r.h < H - 4;
    const clear = (r: Placed, others: readonly Placed[], gap: number) => {
      for (let i = 0; i < others.length; i++) {
        const p = others[i]!;
        if (r.x < p.x + p.w + gap && p.x < r.x + r.w + gap && r.y < p.y + p.h + 2 && p.y < r.y + r.h + 2) return false;
      }
      return true;
    };
    const place = (s: (typeof slots)[number], r: Placed) => {
      s.el!.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
      at[s.region.index * 4] = r.x;
      at[s.region.index * 4 + 1] = r.y;
    };
    // After the specimen labels have placed themselves: a name one of them, a group's tag, or a
    // leader still touches moves to another spot around its star when one is free, and
    // otherwise steps aside for this frame (yieldName). The open drawer's name never steps
    // aside (the labels pay more to avoid it instead), and the one under the pointer never moves.
    let labels: readonly PlateRect[] = [];
    let leaders: readonly number[] = [];
    let tags: readonly PlateRect[] = [];
    const free = (r: Placed) => onPlate(r) && clear(r, rest, 6) && !touchedBySpecimens(r, labels, leaders, tags);
    const yieldOff = engine.onFrame(() => {
      labels = engine.labelRects;
      leaders = engine.labelLeaders;
      tags = engine.groupTagRects;
      if (labels.length === 0 && leaders.length === 0 && tags.length === 0) return;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k]!;
        if (!s.shown || !touchedBySpecimens(s.entry.r, labels, leaders, tags)) continue;
        rest.length = 0;
        for (let i = 0; i < chrome.length; i++) rest.push(chrome[i]!);
        for (let i = 0; i < slots.length; i++) if (i !== k && slots[i]!.shown) rest.push(slots[i]!.entry.r);
        const spot = yieldName(s.entry, free);
        if (spot === "hide") {
          s.el!.style.visibility = "hidden";
          s.shown = false;
        } else if (spot !== "stay") {
          s.entry.r.x = spot.x;
          s.entry.r.y = spot.y;
          place(s, spot);
        }
      }
    }, FRAME_ORDER.YIELD);
    const placeOff = engine.onFrame(({ camera, width, height }) => {
      W = width;
      H = height;
      if (age-- <= 0 && container) {
        const base = container.getBoundingClientRect();
        chrome = [...container.querySelectorAll<HTMLElement>("[data-plate-chrome]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
        });
        age = 30;
      }
      placed.length = 0;
      const hold = held.current;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k]!;
        const region = s.region;
        const el = (s.el = els.current.get(region.index) ?? null);
        s.shown = false;
        if (!el) continue;
        engine.regionAnchor(region.index, a).applyMatrix4(camera.matrixWorldInverse);
        const behind = a.z >= 0;
        a.applyMatrix4(camera.projectionMatrix);
        const sx = (a.x + 1) * 0.5 * W;
        const sy = (1 - a.y) * 0.5 * H;
        const { w, h } = sizes.current.get(region.index) ?? { w: 80, h: 18 };
        const e = s.entry;
        const isHeld = hold !== null && hold.index === region.index;
        // A name sits above its star; the one under the pointer keeps the offset it had when the
        // pointer arrived. The other spots (below, then beside it) are only for stepping out
        // from under a specimen label in the yield pass: offered to every name at rest, they let
        // the small regions a larger name had crowded out back in, and the core of the plate
        // filled with names sitting over their neighbors' stars.
        e.r.x = isHeld ? sx + hold.dx : sx - w / 2;
        e.r.y = isHeld ? sy + hold.dy : sy - h - NAME_GAP;
        e.r.w = w;
        e.r.h = h;
        const [below, right, left] = e.alts as [Placed, Placed, Placed];
        below.x = sx - w / 2;
        below.y = sy + NAME_GAP;
        right.x = sx + NAME_GAP + 4;
        right.y = sy - h / 2;
        left.x = sx - NAME_GAP - 4 - w;
        left.y = sy - h / 2;
        for (let i = 0; i < e.alts.length; i++) {
          e.alts[i]!.w = w;
          e.alts[i]!.h = h;
        }
        e.focused = region.index === focusRegion;
        e.held = isHeld;
        // The focused region always keeps its label, and so does the one being pointed at; others
        // yield to larger regions and chrome.
        const visible = !behind && (isHeld || (onPlate(e.r) && (e.focused || clear(e.r, placed, 6) && clear(e.r, chrome, 6))));
        if (visible) {
          const rect = s.rect;
          rect.x = e.r.x;
          rect.y = e.r.y;
          rect.w = w;
          rect.h = h;
          rect.pinned = e.focused || isHeld;
          placed.push(rect);
          s.shown = true;
        }
        at[region.index * 4 + 2] = sx;
        at[region.index * 4 + 3] = sy;
        place(s, e.r);
        el.style.visibility = visible ? "visible" : "hidden";
      }
      engine.regionLabelRects = placed;
    }, FRAME_ORDER.REGIONS);
    return () => {
      yieldOff();
      placeOff();
      engine.regionLabelRects = [];
    };
  }, [engine, regions, focusRegion]);

  // Keyboard focus on a name hovers its group at once: a focus is a deliberate, discrete move,
  // with no sweep to filter. Pointer hover goes through the plate's intent instead (see above).
  // The root's name hovers the root, which lights the root's own files (engine.hoverRange).
  const enter = (r: Region) => setHover({ kind: "dir", id: r.dir });
  const leave = (r: Region) => {
    const h = useHover.getState().hover;
    if (h?.kind === "dir" && h.id === r.dir) setHover(null);
  };
  // The name under the pointer holds still from the moment it arrives (pointerenter is immediate,
  // the hover it leads to is not), at the offset from its star it had then.
  const hold = (r: Region) => {
    const at = last.current;
    const i = r.index * 4;
    held.current = { index: r.index, dx: at[i]! - at[i + 2]!, dy: at[i + 1]! - at[i + 3]! };
  };
  const release = (r: Region) => {
    if (held.current?.index === r.index) held.current = null;
    engine.invalidate();
  };

  return (
    <div ref={wrapper} className={cn("pointer-events-none absolute inset-0 z-[5] overflow-hidden transition-opacity duration-200", quiet && "opacity-40")}>
      {regions.map((region, k) => (
        <button
          key={region.index}
          ref={(el) => void (el ? els.current.set(region.index, el) : els.current.delete(region.index))}
          type="button"
          data-region-dir={region.dir}
          className={cn(
            "pointer-events-auto absolute top-0 left-0 flex items-baseline gap-1.5 rounded-xs px-1 py-px text-xs font-semibold whitespace-nowrap [font-stretch:80%] outline-none",
            HALO,
            "text-plate-muted transition-[color,opacity] hover:text-plate-ink hover:opacity-100 focus-visible:text-plate-ink focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-plate-ink/60",
            region.index === focusRegion && "text-plate-ink",
            litRegion >= 0 && region.index !== litRegion && "opacity-35",
          )}
          style={{ visibility: "hidden" }}
          onPointerEnter={() => hold(region)}
          onPointerLeave={() => release(region)}
          onFocus={() => enter(region)}
          onBlur={() => leave(region)}
          onClick={() => {
            if (region.dir === 0) {
              focus(null);
              return;
            }
            focus(region.dir);
            select({ kind: "dir", id: region.dir });
          }}
          aria-label={`Open the ${region.name} drawer, ${formatInt(counts[k]!)} files`}
        >
          {region.name}
          {/* Dimmed through its color, not opacity: opacity would thin the halo with it. */}
          <span className="figures font-mono text-[10.5px] font-normal text-[color-mix(in_srgb,currentColor_80%,transparent)]">
            {formatInt(counts[k]!)}
          </span>
        </button>
      ))}
    </div>
  );
}
