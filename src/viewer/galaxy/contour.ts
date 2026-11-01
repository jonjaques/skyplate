/**
 * Region outlines: a hairline that hugs where a region's files actually are.
 *
 * A circle from dirCenters/dirRadius, or a convex hull, would be cheaper, but a spiral arm is a
 * crescent: its circle or hull swallows the lanes and the neighboring arms, and the outline
 * would claim files that are not in the region. Instead the region's stars are splatted onto a
 * grid in the disc plane, blurred, and traced at a low threshold with marching squares, which
 * gives a smooth contour around every clump the region actually has.
 */

export interface ContourInput {
  /** Positions, stride 3 (only x and y are used: the outline lives in the disc plane). */
  pos: Float32Array;
  files: ArrayLike<number>;
  /** Grid cell in world units; outlines sit about 1.5 cells outside the stars. */
  cell: number;
}

/** Segment endpoints, stride 6 (x1 y1 z1 x2 y2 z2), at the region's median height. */
export function traceContour({ pos, files, cell }: ContourInput): Float32Array {
  const count = files.length;
  if (count === 0) return new Float32Array(0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const zs = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const i = files[k]! * 3;
    const x = pos[i]!;
    const y = pos[i + 1]!;
    zs[k] = pos[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  zs.sort();
  const z = zs[count >> 1]!;

  // Cap the grid so a huge region costs the same as a medium one; the cell grows instead.
  let h = cell;
  const span = Math.max(maxX - minX, maxY - minY);
  if (span / h > 220) h = span / 220;
  const pad = 4;
  const W = Math.ceil((maxX - minX) / h) + pad * 2 + 1;
  const H = Math.ceil((maxY - minY) / h) + pad * 2 + 1;
  const ox = minX - pad * h;
  const oy = minY - pad * h;

  let grid: Float32Array = new Float32Array(W * H);
  for (let k = 0; k < count; k++) {
    const i = files[k]! * 3;
    const gx = Math.round((pos[i]! - ox) / h);
    const gy = Math.round((pos[i + 1]! - oy) / h);
    grid[gx + gy * W]! += 1;
  }
  // Two passes of a 5-wide box blur per axis approximate a Gaussian; a lone star's peak ends up
  // at (5/25)² = 0.04 of its weight.
  grid = blur(blur(grid, W, H), W, H);
  const level = 0.04 * 0.35;

  const out: number[] = [];
  const at = (x: number, y: number) => grid[x + y * W]!;
  const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Edge crossing points, in grid units: top (a-b), right (b-c), bottom (d-c), left (a-d).
      const top = () => [x + lerp(a, b), y] as const;
      const right = () => [x + 1, y + lerp(b, c)] as const;
      const bottom = () => [x + lerp(d, c), y + 1] as const;
      const left = () => [x, y + lerp(a, d)] as const;
      const seg = (p: readonly [number, number], q: readonly [number, number]) => {
        out.push(ox + p[0] * h, oy + p[1] * h, z, ox + q[0] * h, oy + q[1] * h, z);
      };
      switch (code) {
        case 1:
        case 14:
          seg(left(), top());
          break;
        case 2:
        case 13:
          seg(top(), right());
          break;
        case 3:
        case 12:
          seg(left(), right());
          break;
        case 4:
        case 11:
          seg(right(), bottom());
          break;
        case 5:
          seg(left(), top());
          seg(right(), bottom());
          break;
        case 6:
        case 9:
          seg(top(), bottom());
          break;
        case 7:
        case 8:
          seg(left(), bottom());
          break;
        case 10:
          seg(top(), right());
          seg(left(), bottom());
          break;
      }
    }
  }
  return Float32Array.from(out);
}

function blur(src: Float32Array, W: number, H: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < W) s += src[xx + y * W]!;
      }
      tmp[x + y * W] = s / 5;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < H) s += tmp[x + yy * W]!;
      }
      out[x + y * W] = s / 5;
    }
  }
  return out;
}
