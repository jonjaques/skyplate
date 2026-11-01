/**
 * Direct-label placement for point marks (the hotspot scatter's leading files).
 *
 * Each label tries positions around its dot in order: right, left, the four diagonals just
 * clear of the dot, then further out with a hairline leader back to the dot. A position is
 * taken only when the label box stays inside the plot and clears every obstacle circle (the
 * emphasized dots, its own dot included) and every label already placed. Items are placed in
 * the order given, so the highest-ranked dot gets the best spot; one that fits nowhere is
 * dropped, and its name stays in the tooltip and the table view.
 *
 * The scatter used to test labels only against each other, so "terrainStreamer.ts" and its
 * halo were drawn straight over the dot of the second-ranked hotspot.
 */

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface LabelItem<K> extends Circle {
  key: K;
  /** Label box size in pixels. */
  w: number;
  h: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedLabel<K> {
  key: K;
  /** Left edge and vertical center of the label box (text-anchor start, dy 0.32em). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hairline from the dot's edge to the label, for labels set away from their dot. */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

const GAP = 5;
const PAD = 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hitsCircle(b: Box, c: Circle): boolean {
  const cx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(c.y, b.y + b.h));
  return Math.hypot(c.x - cx, c.y - cy) < c.r + PAD;
}

function hitsBox(a: Box, b: Box): boolean {
  return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
}

function inside(b: Box, bounds: Bounds): boolean {
  return b.x >= bounds.x0 && b.x + b.w <= bounds.x1 && b.y >= bounds.y0 && b.y + b.h <= bounds.y1;
}

/** Candidate boxes for one item, best first, with the leader each one needs (if any). */
function candidates(it: Circle & { w: number; h: number }): { box: Box; leader: boolean }[] {
  const { x, y, r, w, h } = it;
  const near = r + GAP;
  const diag = r * 0.7 + 3;
  const out: { box: Box; leader: boolean }[] = [
    { box: { x: x + near, y: y - h / 2, w, h }, leader: false },
    { box: { x: x - near - w, y: y - h / 2, w, h }, leader: false },
    { box: { x: x + diag, y: y - r - 3 - h, w, h }, leader: false },
    { box: { x: x - diag - w, y: y - r - 3 - h, w, h }, leader: false },
    { box: { x: x + diag, y: y + r + 3, w, h }, leader: false },
    { box: { x: x - diag - w, y: y + r + 3, w, h }, leader: false },
  ];
  // Further out, with a leader: up and down first (a label beside a crowded dot usually has
  // more room above or below), then the diagonals.
  for (const d of [16, 28, 42]) {
    out.push(
      { box: { x: x - w / 2, y: y - r - d - h, w, h }, leader: true },
      { box: { x: x - w / 2, y: y + r + d, w, h }, leader: true },
      { box: { x: x + r + d, y: y - r - d * 0.6 - h / 2, w, h }, leader: true },
      { box: { x: x - r - d - w, y: y - r - d * 0.6 - h / 2, w, h }, leader: true },
      { box: { x: x + r + d, y: y + r + d * 0.6 - h / 2, w, h }, leader: true },
      { box: { x: x - r - d - w, y: y + r + d * 0.6 - h / 2, w, h }, leader: true },
    );
  }
  return out;
}

/** The hairline from the dot's edge toward the nearest point of the label box. */
function leaderFor(c: Circle, b: Box): PlacedLabel<unknown>["leader"] {
  const tx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const ty = Math.max(b.y, Math.min(c.y, b.y + b.h));
  const len = Math.hypot(tx - c.x, ty - c.y) || 1;
  return { x1: c.x + ((tx - c.x) / len) * (c.r + 1.5), y1: c.y + ((ty - c.y) / len) * (c.r + 1.5), x2: tx, y2: ty };
}

export function placeLabels<K>(items: LabelItem<K>[], obstacles: Circle[], bounds: Bounds): PlacedLabel<K>[] {
  const placed: PlacedLabel<K>[] = [];
  const taken: Box[] = [];
  for (const it of items) {
    const spot = candidates(it).find(
      ({ box }) => inside(box, bounds) && !obstacles.some((c) => hitsCircle(box, c)) && !taken.some((t) => hitsBox(box, t)),
    );
    if (!spot) continue;
    const { box, leader } = spot;
    taken.push(box);
    placed.push({ key: it.key, x: box.x, y: box.y + box.h / 2, w: box.w, h: box.h, leader: leader ? leaderFor(it, box) : undefined });
  }
  return placed;
}
