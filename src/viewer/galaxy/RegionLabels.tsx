/**
 * Region names on the plate: one quiet label per top-level drawer, pinned to the region.
 *
 * Each label sits on the region's own stars (the member nearest the region's centroid, so it
 * lands on a crescent arm rather than in the empty middle of its curve) and follows the morph.
 * Hovering one lights its members and its outline; clicking opens the drawer. Labels that would
 * collide with a larger region's label, or with the plate chrome, step aside for the frame, and
 * so does any label a specimen label could not avoid (see FRAME_ORDER). With a drawer open, the
 * other regions' names dim with their stars: at full strength they floated over empty plate.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import { FRAME_ORDER, regionOfDir, type GalaxyEngine, type PlateRect, type Region } from "./engine";

type Placed = PlateRect;

/** The member nearest the centroid of the region's positions in one layout. */
function anchorOf(pos: Float32Array, files: Int32Array): number {
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
  return best;
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

  const regions = useMemo(
    () =>
      engine.regions
        .filter((r) => r.files.length >= 2)
        .map((r) => ({ region: r, tree: anchorOf(engine.tree, r.files), graph: anchorOf(engine.graph, r.files) })),
    [engine],
  );
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
    const b = new THREE.Vector3();
    const container = wrapper.current?.parentElement ?? null;
    let chrome: Placed[] = [];
    let age = 0;
    const shown: { el: HTMLButtonElement; r: Placed; focused: boolean }[] = [];
    // After the specimen labels have placed themselves: a region name one of them covers steps
    // aside for this frame (the open drawer's name excepted; the label then avoids it instead).
    const yieldOff = engine.onFrame(() => {
      for (const { el, r, focused } of shown) {
        if (focused) continue;
        const covered = engine.labelRects.some((p) => r.x < p.x + p.w + 3 && p.x < r.x + r.w + 3 && r.y < p.y + p.h + 3 && p.y < r.y + r.h + 3);
        el.style.visibility = covered ? "hidden" : "visible";
      }
    }, FRAME_ORDER.YIELD);
    const placeOff = engine.onFrame(({ camera, width: W, height: H, morph }) => {
      if (age-- <= 0 && container) {
        const base = container.getBoundingClientRect();
        chrome = [...container.querySelectorAll<HTMLElement>("[data-plate-chrome]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
        });
        age = 30;
      }
      const placed: Placed[] = [];
      shown.length = 0;
      for (const { region, tree, graph } of regions) {
        const el = els.current.get(region.index);
        if (!el) continue;
        engine.filePos(tree, a, 0);
        engine.filePos(graph, b, 1);
        a.lerp(b, morph).applyMatrix4(camera.matrixWorldInverse);
        const behind = a.z >= 0;
        a.applyMatrix4(camera.projectionMatrix);
        const sx = (a.x + 1) * 0.5 * W;
        const sy = (1 - a.y) * 0.5 * H;
        const { w, h } = sizes.current.get(region.index) ?? { w: 80, h: 18 };
        const r = { x: sx - w / 2, y: sy - h - 10, w, h };
        let visible = !behind && r.x > 4 && r.y > 4 && r.x + w < W - 4 && r.y + h < H - 4;
        // The focused region always keeps its label; others yield to larger regions and chrome.
        if (visible && region.index !== focusRegion) {
          for (const p of [...placed, ...chrome]) {
            if (r.x < p.x + p.w + 6 && p.x < r.x + r.w + 6 && r.y < p.y + p.h + 2 && p.y < r.y + r.h + 2) {
              visible = false;
              break;
            }
          }
        }
        if (visible) {
          placed.push(r);
          shown.push({ el, r, focused: region.index === focusRegion });
        }
        el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
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

  const enter = (r: Region) => {
    engine.uniform("uHoverRegion", r.index);
    if (r.dir !== 0) setHover({ kind: "dir", id: r.dir });
  };
  const leave = () => {
    engine.uniform("uHoverRegion", -1);
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
          <span className="figures font-mono text-[10.5px] font-normal opacity-80">{formatInt(region.files.length)}</span>
        </button>
      ))}
    </div>
  );
}
