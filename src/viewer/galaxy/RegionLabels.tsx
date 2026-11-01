/**
 * Region names on the plate: one quiet label per top-level drawer, pinned to the region.
 *
 * Each label sits on the region's own stars (the member nearest the region's centroid, so it
 * lands on a crescent arm rather than in the empty middle of its curve) and follows the morph.
 * Hovering one lights its members and its outline; clicking opens the drawer. Labels that would
 * collide with a larger region's label, or with the plate chrome, step aside for the frame.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import type { GalaxyEngine, Region } from "./engine";
import { regionOfDir } from "./Scene";

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
    return engine.onFrame(({ camera, width: W, height: H, morph }) => {
      if (age-- <= 0 && container) {
        const base = container.getBoundingClientRect();
        chrome = [...container.querySelectorAll<HTMLElement>("[data-plate-chrome]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
        });
        age = 30;
      }
      const placed: Placed[] = [];
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
        if (visible) placed.push(r);
        el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
        el.style.visibility = visible ? "visible" : "hidden";
      }
    });
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
            "text-plate-muted transition-colors hover:text-plate-ink focus-visible:text-plate-ink focus-visible:ring-1 focus-visible:ring-plate-ink/60",
            region.index === focusRegion && "text-plate-ink",
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
