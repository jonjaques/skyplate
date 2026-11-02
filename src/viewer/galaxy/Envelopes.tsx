/**
 * Group envelopes: a hairline traced around the hovered group and, stronger, the selected one,
 * each with a name tag in the region-name style.
 *
 * An envelope is the convex hull of the group's stars as they project this frame, padded clear
 * of their sprites and rounded (groups.ts). It is traced in screen space because a 3D outline
 * of a web cluster has no single silhouette: the disc-plane contours this replaces were
 * meaningless once the clusters left the disc. Hairlines only, no fill and no shadow: the
 * Specimen Cabinet draws boundaries the way a survey map draws a parcel.
 *
 * The outlines go on a 2D canvas over the stars, and are redrawn only on frames where the
 * camera, the morph, the plate's size, the scrubber or a group changes; any other frame touches
 * nothing. An SVG path was tried first, but its `d` string was a few kilobytes of garbage on
 * every frame of an orbit; the canvas takes the same moveTo/lineTo/arc calls with plain numbers,
 * and the hull lands in buffers allocated once (engine.envelope). What a redraw still allocates
 * is the browser's own boxing of numbers passed to the canvas, about 2 KB a frame while the
 * camera turns (measured with a heap sampling profile); nothing here adds to it.
 *
 * A tag takes the first free spot around its hull (above its highest point, below its lowest,
 * beside its rightmost or leftmost), free meaning clear of the other tag and of region names.
 * Pinned to the top alone, a hovered subgroup's tag landed on the "apps 731" name ("apps
 * 731ler 173") and on the selected group's own tag. When no spot is clear of names, the names it
 * covers step aside for the frame (RegionLabels' yield pass reads engine.groupTagRects).
 */

import { useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import { FRAME_ORDER, type GalaxyEngine, type PlateRect, type RegionLabelRect } from "./engine";
import { overlaps } from "./Labels";
import { groupLabel, HULL_FLOATS, traceEnvelope } from "./groups";
import { HALO } from "./RegionLabels";

/** Gap between an envelope's top and its tag. */
const TAG_GAP = 3;
/** Plate ink (--color-plate-ink) at the two strengths: the selected group's, and a hovered one's. */
const INK_SELECTED = "rgba(233, 238, 241, 0.85)";
const INK_HOVER = "rgba(233, 238, 241, 0.6)";
/** The hovered outline is dashed, the selected one solid: a preview versus a pin. */
const DASH = [4, 3];
const SOLID: number[] = [];

export function GroupEnvelopes({ engine }: { engine: GalaxyEngine }) {
  const hover = useHover((s) => s.hover);
  const selection = useViewer((s) => s.selection);
  const time = useViewer((s) => s.time);
  const dirs = engine.model.report.dirs;
  const selDir = selection?.kind === "dir" && selection.id > 0 ? selection.id : -1;
  const hovDir = hover?.kind === "dir" && hover.id > 0 && hover.id !== selDir ? hover.id : -1;
  // A tag counts the stars its envelope outlines: with the scrubber in the past, the files that
  // existed then, as the title does (the hull already leaves out the rest).
  const count = (dir: number) => (dir < 0 ? 0 : engine.presentIn(engine.model.dirStart[dir]!, engine.model.dirEnd[dir]!, time));
  const selCount = useMemo(() => count(selDir), [engine, selDir, time]); // eslint-disable-line react-hooks/exhaustive-deps
  const hovCount = useMemo(() => count(hovDir), [engine, hovDir, time]); // eslint-disable-line react-hooks/exhaustive-deps

  const canvas = useRef<HTMLCanvasElement>(null);
  const selTag = useRef<HTMLDivElement>(null);
  const hovTag = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d") ?? null;
    if (!cv || !ctx) return;
    const slot = (dir: number, tag: HTMLDivElement | null, ink: string, dash: number[]) => ({
      dir,
      tag,
      ink,
      dash,
      hull: new Float32Array(HULL_FLOATS),
      count: 0,
      pad: 0,
      tagShown: false,
      rect: { x: 0, y: 0, w: tag?.offsetWidth ?? 0, h: tag?.offsetHeight ?? 0, dir } as RegionLabelRect,
      // Tags change size only when their group or its count does, which re-runs this effect:
      // measured once here, not on every frame the camera turns.
      spots: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, w: tag?.offsetWidth ?? 0, h: tag?.offsetHeight ?? 0 }) as PlateRect),
    });
    // The selected outline is drawn last, so it reads on top where the two cross.
    const slots = [slot(hovDir, hovTag.current, INK_HOVER, DASH), slot(selDir, selTag.current, INK_SELECTED, SOLID)];
    const key = new Float64Array(23).fill(Number.NaN);
    const tags: RegionLabelRect[] = [];
    let dpr = 0;
    let drawn = false;

    /**
     * Put a slot's tag on the first spot around its hull that is clear of `other` (a tag already
     * placed) and of the region names, or failing that the one that covers the fewest names; never
     * one over the other tag while a spot clear of it exists. The spots: above the highest point
     * (where it reads as the group's title and stays off the stars inside), below the lowest,
     * beside the rightmost and the leftmost.
     */
    const placeTag = (s: (typeof slots)[number], other: PlateRect | null, W: number, H: number) => {
      if (s.dir < 0) return;
      const { w, h } = s.rect;
      if (s.count === 0) {
        s.rect.x = W / 2 - w / 2;
        s.rect.y = H / 2 - h / 2;
        return;
      }
      let top = 0;
      let bottom = 0;
      let right = 0;
      let left = 0;
      for (let i = 1; i < s.count; i++) {
        const y = s.hull[i * 2 + 1]!;
        const x = s.hull[i * 2]!;
        if (y < s.hull[top * 2 + 1]!) top = i;
        if (y > s.hull[bottom * 2 + 1]!) bottom = i;
        if (x > s.hull[right * 2]!) right = i;
        if (x < s.hull[left * 2]!) left = i;
      }
      const [a, b, c, d] = s.spots as [PlateRect, PlateRect, PlateRect, PlateRect];
      a.x = s.hull[top * 2]! - w / 2;
      a.y = s.hull[top * 2 + 1]! - s.pad - h - TAG_GAP;
      b.x = s.hull[bottom * 2]! - w / 2;
      b.y = s.hull[bottom * 2 + 1]! + s.pad + TAG_GAP;
      c.x = s.hull[right * 2]! + s.pad + TAG_GAP;
      c.y = s.hull[right * 2 + 1]! - h / 2;
      d.x = s.hull[left * 2]! - s.pad - TAG_GAP - w;
      d.y = s.hull[left * 2 + 1]! - h / 2;
      let best: PlateRect = a;
      let bestCost = Number.POSITIVE_INFINITY;
      const names = engine.regionLabelRects;
      for (let k = 0; k < s.spots.length; k++) {
        const r = s.spots[k]!;
        r.x = Math.max(4, Math.min(W - w - 4, r.x));
        r.y = Math.max(4, Math.min(H - h - 4, r.y));
        let cost = other && overlaps(r, other, 4) ? 1000 : 0;
        for (let i = 0; i < names.length; i++) if (names[i]!.dir !== s.dir && overlaps(r, names[i]!, 3)) cost += 10;
        if (cost < bestCost) {
          bestCost = cost;
          best = r;
        }
        if (cost === 0) break;
      }
      s.rect.x = best.x;
      s.rect.y = best.y;
      if (s.tag) s.tag.style.transform = `translate3d(${Math.round(s.rect.x)}px, ${Math.round(s.rect.y)}px, 0)`;
    };

    /** Did anything the outlines depend on change since the last draw? Records it if so. */
    const changed = (camera: THREE.Camera, W: number, H: number, morph: number, web: number) => {
      const view = camera.matrixWorldInverse.elements;
      const proj = camera.projectionMatrix.elements;
      const u = engine.material.uniforms;
      const time = u.uTimeOn!.value ? (u.uTime!.value as number) : -1;
      let diff = key[0] !== W || key[1] !== H || key[2] !== morph || key[3] !== time || key[4] !== proj[0] || key[5] !== proj[5] || key[22] !== web;
      for (let i = 0; !diff && i < 16; i++) if (key[6 + i] !== view[i]) diff = true;
      if (!diff) return false;
      key[0] = W;
      key[1] = H;
      key[2] = morph;
      key[3] = time;
      key[4] = proj[0]!;
      key[5] = proj[5]!;
      key[22] = web;
      for (let i = 0; i < 16; i++) key[6 + i] = view[i]!;
      return true;
    };

    const off = engine.onFrame(({ camera, width: W, height: H, morph }) => {
      // In the import graph a directory's files are scattered across the plate, and a hull
      // around them would be most of it; the envelopes fade out with the web.
      const web = Math.round(engine.webness * 100) / 100;
      const any = slots[0]!.dir >= 0 || slots[1]!.dir >= 0;
      if (any && web >= 0.05 && changed(camera, W, H, morph, web)) {
        const ratio = window.devicePixelRatio || 1;
        if (cv.width !== Math.round(W * ratio) || cv.height !== Math.round(H * ratio) || dpr !== ratio) {
          dpr = ratio;
          cv.width = Math.round(W * ratio);
          cv.height = Math.round(H * ratio);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.globalAlpha = web;
        for (const s of slots) {
          if (s.dir < 0) continue;
          const env = engine.envelope(s.dir, camera, s.hull);
          s.count = env.count;
          s.pad = env.pad;
          ctx.strokeStyle = s.ink;
          ctx.setLineDash(s.dash);
          ctx.beginPath();
          traceEnvelope(s.hull, s.count, s.pad, ctx);
          ctx.stroke();
        }
        // Tags, the selected one first: it is the pin, and the hovered one goes around it.
        placeTag(slots[1]!, null, W, H);
        placeTag(slots[0]!, slots[1]!.dir >= 0 && slots[1]!.count > 0 ? slots[1]!.rect : null, W, H);
        drawn = true;
      } else if ((!any || web < 0.05) && drawn) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        drawn = false;
        key.fill(Number.NaN);
      }
      // A supercluster whose region name is on the plate already says what its tag would.
      tags.length = 0;
      for (const s of slots) {
        if (!s.tag) continue;
        let show = s.dir >= 0 && drawn && s.count > 0;
        for (const r of engine.regionLabelRects) if (r.dir === s.dir) show = false;
        if (show !== s.tagShown) s.tag.style.visibility = (s.tagShown = show) ? "visible" : "hidden";
        if (show) tags.push(s.rect);
      }
      engine.groupTagRects = tags;
    }, FRAME_ORDER.ENVELOPES);
    engine.invalidate();
    return () => {
      off();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      engine.groupTagRects = [];
    };
  }, [engine, selDir, hovDir, selCount, hovCount]);

  const tagFor = (dir: number, n: number, ref: React.RefObject<HTMLDivElement | null>, strong: boolean) =>
    dir < 0 ? null : (
      <div
        ref={ref}
        className={cn(
          "absolute top-0 left-0 flex items-baseline gap-1.5 px-1 py-px text-xs font-semibold whitespace-nowrap [font-stretch:80%]",
          HALO,
          strong ? "text-plate-ink" : "text-plate-ink/90",
        )}
        style={{ visibility: "hidden" }}
      >
        {groupLabel(dirs, dir)}
        <span className="figures font-mono text-[10.5px] font-normal text-[color-mix(in_srgb,currentColor_80%,transparent)]">
          {formatInt(n)}
        </span>
      </div>
    );

  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" aria-hidden="true">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {tagFor(selDir, selCount, selTag, true)}
      {tagFor(hovDir, hovCount, hovTag, false)}
    </div>
  );
}
