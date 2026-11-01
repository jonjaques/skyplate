/**
 * Specimen labels: white label stock pinned to stars by 1px hairline leaders.
 *
 * The signature of the Specimen Cabinet direction. Which files get a label is React's job and
 * changes rarely (hover, selection, focus); where each label sits is the frame bus's job and
 * changes every frame the camera moves. Placement is greedy in priority order (selected, then
 * hovered, then holotypes): each card tries a ring of positions around its star, keeps last
 * frame's position while it is still clear (so cards do not hop as the camera turns), and
 * avoids the other cards, the other pinned stars and the plate's own chrome.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CATEGORY_GROUP } from "../../shared/schema";
import { CATEGORY_GROUP_LABEL } from "../lib/colors";
import { baseName, formatInt, formatIsoDate, shortenPath } from "../lib/format";
import { cn } from "../lib/utils";
import { useHover, useViewer } from "../state/store";
import type { GalaxyEngine } from "./engine";
import { regionOfDir } from "./Scene";

type LabelKind = "selected" | "hover" | "holotype";

interface LabelSpec {
  key: string;
  file: number;
  kind: LabelKind;
  /** Overrides the det. line (a selected symbol speaks about itself). */
  det?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP_NEAR = 34;
const GAP_FAR = 88;
const MARGIN = 8;

function overlaps(a: Rect, b: Rect, pad = 6): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/**
 * The plate's chrome, which labels must not cover: the title, the controls, the legend and the
 * scrubber. Read from the DOM (elements carry data-plate-chrome) so the overlay never has to
 * know their sizes.
 */
function chromeRects(container: HTMLElement | null): Rect[] {
  if (!container) return [];
  const base = container.getBoundingClientRect();
  const out: Rect[] = [];
  container.querySelectorAll<HTMLElement>("[data-plate-chrome]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) out.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
  });
  return out;
}

export function SpecimenLabels({ engine, compact }: { engine: GalaxyEngine; compact: boolean }) {
  const model = engine.model;
  const selection = useViewer((s) => s.selection);
  const focusDir = useViewer((s) => s.focusDir);
  const symbols = useViewer((s) => s.symbols);
  const hover = useHover((s) => s.hover);

  const specs = useMemo<LabelSpec[]>(() => {
    const out: LabelSpec[] = [];
    const seen = new Set<number>();
    const add = (file: number, kind: LabelKind, det?: string) => {
      if (file < 0 || file >= model.fileCount || seen.has(file)) return;
      seen.add(file);
      out.push({ key: `${kind}:${file}`, file, kind, det });
    };
    if (selection?.kind === "file") add(selection.id, "selected");
    if (selection?.kind === "symbol" && symbols) {
      const t = symbols.symbols;
      const s = selection.id;
      add(t.file[s]!, "selected", `det. ${t.name[s]}, ${formatInt(t.refs[s]!)} references in ${formatInt(t.files[s]!)} files`);
    }
    if (hover?.kind === "file" && !compact) add(hover.id, "hover");
    if (!compact) {
      if (focusDir !== null) {
        const region = regionOfDir(engine, focusDir);
        const dir = engine.regions[region]?.dir;
        const holo = dir === undefined ? undefined : model.holotypeOfDir.get(dir);
        if (holo !== undefined) add(holo, "holotype");
      } else {
        // Zoomed out: the holotypes of the largest regions, as many as fit without clutter.
        let shown = 0;
        for (const r of engine.regions) {
          const holo = model.holotypeOfDir.get(r.dir);
          if (holo === undefined || r.dir === 0) continue;
          add(holo, "holotype");
          if (++shown >= 3) break;
        }
      }
    }
    return out;
  }, [model, engine, selection, symbols, hover, focusDir, compact]);

  const container = useRef<HTMLDivElement>(null);
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
    let chrome: Rect[] = [];
    let chromeAge = 0;
    return engine.onFrame(({ width: W, height: H }) => {
      // Chrome rarely moves; re-read it every 30 frames instead of every frame.
      if (chromeAge-- <= 0) {
        chrome = chromeRects(container.current?.parentElement ?? null);
        chromeAge = 30;
      }
      const anchors: ({ x: number; y: number } | null)[] = specs.map((s) => (engine.screenOf(s.file, pt, scratch) ? { x: pt.x, y: pt.y } : null));
      const placed: Rect[] = [];
      specs.forEach((spec, idx) => {
        const card = cards.current.get(spec.key);
        const line = lines.current.get(spec.key);
        const dot = dots.current.get(spec.key);
        if (!card || !line || !dot) return;
        const a = anchors[idx];
        const size = sizes.current.get(spec.key) ?? { w: 196, h: 110 };
        const hide = () => {
          card.style.opacity = "0";
          line.setAttribute("visibility", "hidden");
          dot.setAttribute("visibility", "hidden");
        };
        if (!a || a.x < -10 || a.y < -10 || a.x > W + 10 || a.y > H + 10) return hide();
        const { w, h } = size;
        const candidates: [number, number][] = [];
        for (const d of [GAP_NEAR, GAP_FAR]) {
          candidates.push(
            [a.x + d, a.y - d - h],
            [a.x - d - w, a.y - d - h],
            [a.x + d, a.y + d],
            [a.x - d - w, a.y + d],
            [a.x + d + 10, a.y - h / 2],
            [a.x - d - 10 - w, a.y - h / 2],
          );
        }
        const score = (ci: number): number => {
          const [x, y] = candidates[ci]!;
          const r = { x, y, w, h };
          let s = 0;
          if (x < MARGIN || y < MARGIN || x + w > W - MARGIN || y + h > H - MARGIN) s += 100;
          for (const p of placed) if (overlaps(r, p)) s += 50;
          for (const c of chrome) if (overlaps(r, c, 4)) s += 30;
          anchors.forEach((o, j) => {
            if (o && j !== idx && o.x > x - 6 && o.x < x + w + 6 && o.y > y - 6 && o.y < y + h + 6) s += 20;
          });
          return s;
        };
        let best = previous.current.get(spec.key) ?? 0;
        let bestScore = best < candidates.length ? score(best) : Infinity;
        if (bestScore > 0) {
          for (let ci = 0; ci < candidates.length; ci++) {
            const sc = score(ci) + ci * 0.01; // nearer, upper-right positions win ties
            if (sc < bestScore) {
              bestScore = sc;
              best = ci;
            }
          }
        }
        // Holotype labels are a courtesy: they step aside rather than crowd the plate.
        if (spec.kind === "holotype" && bestScore >= 20) return hide();
        previous.current.set(spec.key, best);
        const [x, y] = candidates[best]!;
        const rect = { x, y, w, h };
        placed.push(rect);
        card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        card.style.opacity = "1";
        // Leader: from just outside the star to the nearest point of the card.
        const ex = Math.min(Math.max(a.x, x), x + w);
        const ey = Math.min(Math.max(a.y, y), y + h);
        const len = Math.hypot(ex - a.x, ey - a.y) || 1;
        const sx = a.x + ((ex - a.x) / len) * 7;
        const sy = a.y + ((ey - a.y) / len) * 7;
        line.setAttribute("x1", sx.toFixed(1));
        line.setAttribute("y1", sy.toFixed(1));
        line.setAttribute("x2", ex.toFixed(1));
        line.setAttribute("y2", ey.toFixed(1));
        line.setAttribute("visibility", "visible");
        dot.setAttribute("cx", ex.toFixed(1));
        dot.setAttribute("cy", ey.toFixed(1));
        dot.setAttribute("visibility", "visible");
      });
    });
  }, [engine, specs]);

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
      {specs.map((s) => (
        <SpecimenCard
          key={s.key}
          engine={engine}
          spec={s}
          cardRef={(el) => void (el ? cards.current.set(s.key, el) : cards.current.delete(s.key))}
        />
      ))}
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
