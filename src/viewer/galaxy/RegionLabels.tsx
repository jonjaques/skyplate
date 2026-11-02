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
 * Does any specimen label, or any leader running from a pinned star to its label, touch `r`?
 * A leader starting on a star the name sits over counts, so the name gives up that star.
 */
export function touchedBySpecimens(r: PlateRect, labels: readonly PlateRect[], leaders: readonly number[]): boolean {
  for (const p of labels) if (overlaps(r, p, 3)) return true;
  const g = { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 };
  for (let k = 0; k + 3 < leaders.length; k += 4) if (segmentHitsRect(leaders[k]!, leaders[k + 1]!, leaders[k + 2]!, leaders[k + 3]!, g)) return true;
  return false;
}

export function RegionLabels({ engine }: { engine: GalaxyEngine }) {
  const focusDir = useViewer((s) => s.focusDir);
  const selection = useViewer((s) => s.selection);
  const focus = useViewer((s) => s.focus);
  const select = useViewer((s) => s.select);
  const setHover = useHover((s) => s.setHover);
  const focusRegion = focusDir === null ? -1 : regionOfDir(engine, focusDir);
  // The region that is lit while everything else dims: the open drawer, else a selected
  // directory (the rail and the palette select one without opening it).
  const litRegion =
    focusDir !== null && focusDir !== 0 ? focusRegion : selection?.kind === "dir" && selection.id !== 0 ? regionOfDir(engine, selection.id) : -1;
  const quiet = selection?.kind === "symbol";

  const regions = useMemo(() => engine.regions.filter((r) => r.files.length >= 2).map((r) => ({ region: r })), [engine]);
  const els = useRef(new Map<number, HTMLButtonElement>());
  const wrapper = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<number, { w: number; h: number }>());

  useEffect(() => {
    for (const { region } of regions) {
      const el = els.current.get(region.index);
      if (el) sizes.current.set(region.index, { w: el.offsetWidth, h: el.offsetHeight });
    }
  }, [regions]);

  useEffect(() => {
    const a = new THREE.Vector3();
    const container = wrapper.current?.parentElement ?? null;
    let chrome: Placed[] = [];
    let age = 0;
    let W = 0;
    let H = 0;
    /** Names shown this frame: where each sits, the other spots it could take, and whether it is the open drawer's. */
    const shown: { el: HTMLButtonElement; r: Placed; alts: Placed[]; focused: boolean }[] = [];
    const onPlate = (r: Placed) => r.x > 4 && r.y > 4 && r.x + r.w < W - 4 && r.y + r.h < H - 4;
    const clear = (r: Placed, others: readonly Placed[], gap: number) => {
      for (const p of others) if (r.x < p.x + p.w + gap && p.x < r.x + r.w + gap && r.y < p.y + p.h + 2 && p.y < r.y + r.h + 2) return false;
      return true;
    };
    // After the specimen labels have placed themselves: a name one of them, or one of their
    // leaders, still touches moves to another spot around its star when one is free, and
    // otherwise steps aside for this frame. The open drawer's name never steps aside (the
    // labels pay more to avoid it instead), but it does move when it can.
    const yieldOff = engine.onFrame(() => {
      const labels = engine.labelRects;
      const leaders = engine.labelLeaders;
      if (labels.length === 0 && leaders.length === 0) return;
      for (const entry of shown) {
        if (!touchedBySpecimens(entry.r, labels, leaders)) continue;
        const rest = [...chrome];
        for (const o of shown) if (o !== entry && o.el.style.visibility !== "hidden") rest.push(o.r);
        const spot = entry.alts.find((r) => onPlate(r) && clear(r, rest, 6) && !touchedBySpecimens(r, labels, leaders));
        if (spot) {
          entry.r = spot;
          entry.el.style.transform = `translate3d(${Math.round(spot.x)}px, ${Math.round(spot.y)}px, 0)`;
        } else if (!entry.focused) entry.el.style.visibility = "hidden";
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
      const placed: RegionLabelRect[] = [];
      shown.length = 0;
      for (const { region } of regions) {
        const el = els.current.get(region.index);
        if (!el) continue;
        engine.regionAnchor(region.index, a).applyMatrix4(camera.matrixWorldInverse);
        const behind = a.z >= 0;
        a.applyMatrix4(camera.projectionMatrix);
        const sx = (a.x + 1) * 0.5 * W;
        const sy = (1 - a.y) * 0.5 * H;
        const { w, h } = sizes.current.get(region.index) ?? { w: 80, h: 18 };
        // A name sits above its star. The other spots (below, then beside it) are only for
        // stepping out from under a specimen label in the yield pass: offered to every name at
        // rest, they let the small regions a larger name had crowded out back in, and the core
        // of the plate filled with names sitting over their neighbors' stars.
        const above = { x: sx - w / 2, y: sy - h - NAME_GAP, w, h };
        const alts: Placed[] = [
          { x: sx - w / 2, y: sy + NAME_GAP, w, h },
          { x: sx + NAME_GAP + 4, y: sy - h / 2, w, h },
          { x: sx - NAME_GAP - 4 - w, y: sy - h / 2, w, h },
        ];
        const focused = region.index === focusRegion;
        // The focused region always keeps its label; others yield to larger regions and chrome.
        const visible = !behind && onPlate(above) && (focused || clear(above, [...placed, ...chrome], 6));
        if (visible) {
          placed.push(focused ? { ...above, pinned: true, dir: region.dir } : { ...above, dir: region.dir });
          shown.push({ el, r: above, alts, focused });
        }
        el.style.transform = `translate3d(${Math.round(above.x)}px, ${Math.round(above.y)}px, 0)`;
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

  // A region's name hovers its group through the store like any other view, so the plate's
  // envelope, strands and lit stars agree with it. The root's own files are the exception: as a
  // target, the root means the whole project, so their range is lit here directly.
  const enter = (r: Region) => {
    if (r.dir !== 0) setHover({ kind: "dir", id: r.dir });
    else engine.setHotRange(engine.model.dirStart[0]!, engine.model.dirStart[0]! + engine.model.report.dirs[0]!.files.length);
  };
  const leave = () => {
    engine.setHotRange(-1, -1);
    setHover(null);
  };

  return (
    <div ref={wrapper} className={cn("pointer-events-none absolute inset-0 z-[5] overflow-hidden transition-opacity duration-200", quiet && "opacity-40")}>
      {regions.map(({ region }) => (
        <button
          key={region.index}
          ref={(el) => void (el ? els.current.set(region.index, el) : els.current.delete(region.index))}
          type="button"
          className={cn(
            "pointer-events-auto absolute top-0 left-0 flex items-baseline gap-1.5 rounded-xs px-1 py-px text-xs font-semibold whitespace-nowrap [font-stretch:80%] outline-none",
            HALO,
            "text-plate-muted transition-[color,opacity] hover:text-plate-ink hover:opacity-100 focus-visible:text-plate-ink focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-plate-ink/60",
            region.index === focusRegion && "text-plate-ink",
            litRegion >= 0 && region.index !== litRegion && "opacity-35",
          )}
          style={{ visibility: "hidden" }}
          onPointerEnter={() => enter(region)}
          onPointerLeave={leave}
          onFocus={() => enter(region)}
          onBlur={leave}
          onClick={() => {
            leave();
            if (region.dir === 0) {
              focus(null);
              return;
            }
            focus(region.dir);
            select({ kind: "dir", id: region.dir });
          }}
          aria-label={`Open the ${region.name} drawer, ${formatInt(region.files.length)} files`}
        >
          {region.name}
          {/* Dimmed through its color, not opacity: opacity would thin the halo with it. */}
          <span className="figures font-mono text-[10.5px] font-normal text-[color-mix(in_srgb,currentColor_80%,transparent)]">
            {formatInt(region.files.length)}
          </span>
        </button>
      ))}
    </div>
  );
}
