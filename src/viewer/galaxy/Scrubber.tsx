/**
 * History scrubber: a strip along the plate's foot that remaps every star to a moment in the
 * project's history. Files not yet created fade out; files touched in the weeks before the
 * chosen moment flash. HEAD (null in the store) is the present.
 *
 * The faint columns behind the slider are the weekly commit counts, the same series the
 * activity tray charts, on the same linear scale, so the reader can aim the scrubber at a burst
 * of work and the strip and the tray never disagree about which week was busier.
 */

import { Pause, Play } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { formatDate, formatInt } from "../lib/format";
import { useViewer } from "../state/store";
import type { GalaxyEngine } from "./engine";

const WEEK = 7 * 86400;
/**
 * Column width cap (px): past it a short history reads as a row of blocks, not a series. It
 * was 24, and a three-week history (a shallow clone) drew three wide gray slabs across the
 * strip that read as placeholders that had failed to load.
 */
const COLUMN_MAX = 8;

/**
 * SVG path for weekly columns `from`..`to` in a `width` × `height` box (pixels). Linear in
 * commits against the busiest week, as in the activity tray: the strip used a square-root scale
 * with a 4% floor, which drew an 81-commit week and a 39-commit week nearly level and made
 * quiet weeks look like slow ones. A week with no commits draws nothing; a week with any draws
 * at least one pixel. Columns are centered in their week's slot, at most COLUMN_MAX wide, and
 * round only their data end (the top), not the baseline.
 */
export function columnPath(commits: readonly number[], from: number, to: number, width: number, height: number): string {
  const n = commits.length;
  if (n === 0 || width <= 0 || height <= 0) return "";
  let max = 1;
  for (const c of commits) if (c > max) max = c;
  const slot = width / n;
  const w = Math.min(COLUMN_MAX, slot * 0.76);
  const r = Math.min(2, w / 2);
  let d = "";
  for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
    const c = commits[i]!;
    if (c <= 0) continue;
    const h = Math.max(1, (c / max) * height);
    const x = i * slot + (slot - w) / 2;
    const top = height - h;
    const rr = Math.min(r, h);
    const f = (v: number) => v.toFixed(2);
    d += `M${f(x)} ${f(height)}V${f(top + rr)}Q${f(x)} ${f(top)} ${f(x + rr)} ${f(top)}H${f(x + w - rr)}Q${f(x + w)} ${f(top)} ${f(x + w)} ${f(top + rr)}V${f(height)}Z`;
  }
  return d;
}

export function HistoryScrubber({ engine }: { engine: GalaxyEngine }) {
  const git = engine.model.report.git!;
  const weekly = git.weekly;
  const time = useViewer((s) => s.time);
  const setTime = useViewer((s) => s.setTime);
  const [playing, setPlaying] = useState(false);
  const last = weekly.length - 1;

  // Slider positions are weeks; the store holds unix seconds at the end of the chosen week.
  const weekOf = (t: number | null) => {
    if (t === null || weekly.length === 0) return last;
    let i = 0;
    while (i < last && weekly[i + 1]!.start <= t) i++;
    return i;
  };
  const position = weekOf(time);
  const timeAt = (i: number): number | null => (i >= last ? null : Math.min(git.last, weekly[i]!.start + WEEK - 1));

  const commits = weekly.map((w) => w.commits);
  // The columns are drawn in real pixels (a stretched viewBox cannot cap a column's width), so
  // the strip measures itself.
  const strip = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Playback sweeps the whole history in a fixed span (faster for long histories), updating
  // the store at ~20 Hz: enough for the flashes to read, without re-rendering every chart
  // that listens to `time` on every animation frame.
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    engine.animating.add("history");
    const span = Math.min(24, Math.max(6, weekly.length * 0.06)) * 1000;
    const startWeek = position >= last ? 0 : position;
    const t0 = performance.now() - (startWeek / Math.max(1, last)) * span;
    let lastPush = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / span);
      if (now - lastPush > 50 || p >= 1) {
        lastPush = now;
        const w = Math.round(p * last);
        setTime(timeAt(w));
      }
      if (p >= 1) {
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf.current);
      engine.animating.delete("history");
    };
    // Playback captures its start once; position changes it causes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (weekly.length < 2) return null;
  const at = time ?? git.last;
  const valueText = time === null ? `${formatDate(at)}, HEAD, the present` : `${formatDate(at)}, ${formatInt(weekly[position]!.commits)} commits that week`;
  return (
    // bg-plate: lanes and stars passed under the strip and through its date and columns. The
    // plate's own color occludes them without drawing a panel.
    <div
      data-plate-chrome
      data-plate-inset="bottom"
      className="absolute inset-x-0 bottom-0 z-20 flex h-[52px] items-center gap-3 border-t border-plate-rule bg-plate px-4 text-xs text-plate-muted"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 border border-plate-rule text-plate-ink hover:bg-plate-ink/10 hover:text-plate-ink"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause history" : "Play history"}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{playing ? "Pause" : "Play the project's history"}</TooltipContent>
      </Tooltip>
      <div className="w-[132px] shrink-0 leading-tight">
        <div className="figures font-mono text-plate-ink">{formatDate(at)}</div>
        <div className="text-[11px]">{time === null ? "HEAD, the present" : `${formatInt(weekly[position]!.commits)} commits that week`}</div>
      </div>
      <div className="relative h-8 min-w-0 flex-1">
        {/* One path per side of the thumb: a 900-week history is 900 columns, too many for
            elements, and SVG keeps them crisp at any plate width. */}
        <div ref={strip} className="pointer-events-none absolute inset-x-0 top-0 bottom-3">
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} aria-hidden="true">
            <path d={columnPath(commits, 0, position + 1, box.w, box.h)} className="fill-plate-muted" fillOpacity={0.4} />
            <path d={columnPath(commits, position + 1, commits.length, box.w, box.h)} className="fill-plate-muted" fillOpacity={0.14} />
          </svg>
        </div>
        {/* The Radix primitive rather than the shadcn Slider: the element a screen reader lands
            on is the thumb (role=slider), and the wrapper renders its thumbs itself with no way
            to name them. The root's aria-label never reached the thumb, which announced a bare
            week index ("slider, 7") instead of a date. The markup and data-slot hooks match the
            wrapper, restyled for the plate. */}
        <SliderPrimitive.Root
          data-slot="slider"
          className="absolute inset-x-0 bottom-0 flex w-full touch-none items-center select-none"
          min={0}
          max={last}
          step={1}
          value={[position]}
          onValueChange={(v) => {
            setPlaying(false);
            setTime(timeAt(v[0] ?? last));
          }}
        >
          <SliderPrimitive.Track data-slot="slider-track" className="relative h-1 w-full grow overflow-hidden rounded-full bg-plate-rule">
            <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-plate-ink/70" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label="Point in history"
            aria-valuetext={valueText}
            className="block size-4 shrink-0 rounded-full border border-plate-ink bg-white outline-none transition-[box-shadow] hover:ring-4 hover:ring-plate-ink/20 focus-visible:ring-2 focus-visible:ring-plate-ink focus-visible:ring-offset-2 focus-visible:ring-offset-plate"
          />
        </SliderPrimitive.Root>
      </div>
      {time !== null && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 border border-plate-rule px-2.5 text-xs font-semibold text-plate-muted [font-stretch:85%] hover:bg-plate-ink/10 hover:text-plate-ink"
          onClick={() => {
            setPlaying(false);
            setTime(null);
          }}
        >
          Back to HEAD
        </Button>
      )}
    </div>
  );
}
