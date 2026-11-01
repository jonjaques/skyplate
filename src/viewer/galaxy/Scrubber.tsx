/**
 * History scrubber: a strip along the plate's foot that remaps every star to a moment in the
 * project's history. Files not yet created fade out; files touched in the weeks before the
 * chosen moment flash. HEAD (null in the store) is the present.
 *
 * The faint columns behind the slider are the weekly commit counts, the same series the
 * activity tray charts, so the reader can aim the scrubber at a burst of work.
 */

import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { formatDate, formatInt } from "../lib/format";
import { useViewer } from "../state/store";
import type { GalaxyEngine } from "./engine";

const WEEK = 7 * 86400;

function columnPath(columns: number[], from: number, to: number): string {
  let d = "";
  for (let i = from; i < to; i++) {
    const h = Math.max(4, columns[i]! * 100);
    d += `M${i + 0.12} 100V${(100 - h).toFixed(1)}H${i + 0.88}V100Z`;
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

  const columns = useMemo(() => {
    const max = Math.max(1, ...weekly.map((w) => w.commits));
    // √ so a few release-week spikes do not flatten every other week to nothing.
    return weekly.map((w) => Math.sqrt(w.commits / max));
  }, [weekly]);

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
  return (
    <div
      data-plate-chrome
      data-plate-inset="bottom"
      className="absolute inset-x-0 bottom-0 z-20 flex h-[52px] items-center gap-3 border-t border-plate-rule px-4 text-xs text-plate-muted"
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
        <svg
          className="pointer-events-none absolute inset-x-0 top-0 bottom-3 h-[calc(100%-0.75rem)] w-full"
          viewBox={`0 0 ${columns.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={columnPath(columns, 0, position + 1)} className="fill-plate-muted" fillOpacity={0.36} />
          <path d={columnPath(columns, position + 1, columns.length)} className="fill-plate-muted" fillOpacity={0.12} />
        </svg>
        <Slider
          className="absolute inset-x-0 bottom-0 [&_[data-slot=slider-range]]:bg-plate-ink/70 [&_[data-slot=slider-thumb]]:border-plate-ink [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-plate-rule"
          min={0}
          max={last}
          step={1}
          value={[position]}
          onValueChange={(v) => {
            setPlaying(false);
            setTime(timeAt(v[0] ?? last));
          }}
          aria-label="Point in history"
        />
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
