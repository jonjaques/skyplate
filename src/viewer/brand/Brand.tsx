/**
 * The Skyplate mark and wordmark, drawn from the paths scripts/brand.ts generates (the README's
 * lockup and the favicon come from the same source, so the three never drift apart).
 *
 * The mark takes its two colors from --color-mark-plate and --color-mark-ink, which styles.css
 * swaps in the dark theme: a positive plate on light grounds, a negative on dark ones. The
 * wordmark is currentColor, so it wears whatever ink the surrounding text does.
 */

import { cn } from "../lib/utils";
import { MARK, WORDMARK } from "./brand.generated";

/**
 * The plate mark. `size` is its rendered width and height in px.
 *
 * `onPlate` is for the mark drawn on the galaxy plate itself (the loading and empty states).
 * The plate is dark glass in both themes, so the mark keeps its positive colors there whatever
 * the theme: its glass square is then the plate's own color and only the marked star shows,
 * which is the mark read literally (the plate is the background). Following the theme would
 * draw a bright silver square on the dark plate in the dark theme only.
 */
export function Mark({ size = 24, className, title, onPlate = false }: { size?: number; className?: string; title?: string; onPlate?: boolean }) {
  // Under 20px the ticks' 1.7 units fall below a device pixel and the reticle smudges into
  // the star, so small marks draw them heavier (the favicon does the same).
  const tick = size < 20 ? MARK.tickWidthSmall : MARK.tickWidth;
  const plate = onPlate ? "var(--color-plate)" : "var(--color-mark-plate)";
  const ink = onPlate ? "var(--color-plate-ink)" : "var(--color-mark-ink)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK.viewBox}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={MARK.plate} fill={plate} />
      <path d={MARK.ticks} stroke={ink} strokeWidth={tick} strokeLinecap="round" fill="none" />
      {MARK.stars.map(([cx, cy, r]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} fill={ink} />
      ))}
    </svg>
  );
}

/** The wordmark, `height` px from ascender to descender (the word's x-height is about half). */
export function Wordmark({ height = 18, className }: { height?: number; className?: string }) {
  const width = (WORDMARK.width / WORDMARK.height) * height;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} className={cn("shrink-0", className)} aria-hidden>
      <path d={WORDMARK.d} fill="currentColor" />
    </svg>
  );
}

/**
 * Mark and wordmark together, labeled once for assistive tech as "Skyplate". The mark sits a
 * little larger than the word's box so its plate reads at the word's cap height plus a margin,
 * as in the README lockup.
 */
export function Lockup({ height = 18, className }: { height?: number; className?: string }) {
  return (
    <span role="img" aria-label="Skyplate" className={cn("inline-flex items-center gap-2", className)}>
      <Mark size={Math.round(height * 1.2)} />
      <Wordmark height={height} />
    </span>
  );
}
