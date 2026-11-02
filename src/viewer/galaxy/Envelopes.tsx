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
 * and the hull lands in buffers allocated once (engine.envelope), so redrawing allocates nothing.
 */

import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { formatInt } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import { FRAME_ORDER, type GalaxyEngine, type RegionLabelRect } from "./engine";
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
  const dirs = engine.model.report.dirs;
  const selDir = selection?.kind === "dir" && selection.id > 0 ? selection.id : -1;
  const hovDir = hover?.kind === "dir" && hover.id > 0 && hover.id !== selDir ? hover.id : -1;

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
      // Tags change size only when their group does, which re-runs this effect: measured once
      // here, not on every frame the camera turns.
    });
    // The selected outline is drawn last, so it reads on top where the two cross.
    const slots = [slot(hovDir, hovTag.current, INK_HOVER, DASH), slot(selDir, selTag.current, INK_SELECTED, SOLID)];
    const key = new Float64Array(23).fill(Number.NaN);
    const tags: RegionLabelRect[] = [];
    let dpr = 0;
    let drawn = false;

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
          // The tag sits over the envelope's highest point, where it reads as the group's title
          // and stays off the stars inside.
          let top = 0;
          for (let i = 1; i < s.count; i++) if (s.hull[i * 2 + 1]! < s.hull[top * 2 + 1]!) top = i;
          const { w, h } = s.rect;
          s.rect.x = Math.max(4, Math.min(W - w - 4, (s.count > 0 ? s.hull[top * 2]! : W / 2) - w / 2));
          s.rect.y = Math.max(4, Math.min(H - h - 4, (s.count > 0 ? s.hull[top * 2 + 1]! - s.pad : H / 2) - h - TAG_GAP));
          if (s.tag) s.tag.style.transform = `translate3d(${Math.round(s.rect.x)}px, ${Math.round(s.rect.y)}px, 0)`;
        }
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
  }, [engine, selDir, hovDir]);

  const tagFor = (dir: number, ref: React.RefObject<HTMLDivElement | null>, strong: boolean) =>
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
          {formatInt(dirs[dir]!.totalFiles)}
        </span>
      </div>
    );

  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" aria-hidden="true">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {tagFor(selDir, selTag, true)}
      {tagFor(hovDir, hovTag, false)}
    </div>
  );
}
