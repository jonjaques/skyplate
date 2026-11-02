/**
 * Engine-independent math for the web's layout: sin, cos, atan2, cube and nth roots built from
 * + − × ÷ and Math.sqrt alone.
 *
 * ECMAScript fixes those five operations to IEEE 754's correctly rounded results, but lets every
 * engine approximate Math.sin, cos, atan2, acos, cbrt, pow and hypot its own way, and they do: on
 * 20,000 inputs each, V8 (node, Chrome) and JSC (Bun, Safari) disagreed somewhere in the last bit
 * for every one of them (measured). The web's relaxation is chaotic, so one such bit could grow
 * into a visibly different layout (vite under "size" gravity differed by 2% of its radius), and a
 * link opened in Safari and in Chrome showed two webs. These functions give the same bits in
 * every engine, which is what computeWeb's determinism promise needs; they are as accurate as
 * fdlibm (a few units in the last place), not correctly rounded.
 *
 * The kernels' coefficients are fdlibm's (k_sin.c, k_cos.c, s_atan.c), the same ones V8 ports.
 */

// sin and cos on [−π/4, π/4] (k_sin.c, k_cos.c).
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;
// π/2 in two parts for the reduction: the first has 33 significant bits, so n × PIO2_HI is exact
// for every quadrant count n below 2^20 (|x| up to about 1.6 million, far beyond what the web uses).
const PIO2_HI = 1.57079632673412561417e0;
const PIO2_LO = 6.07710050650619224932e-11;
const TWO_OVER_PI = 6.36619772367581382433e-1;

function kernelSin(x: number): number {
  const z = x * x;
  return x + z * x * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(x: number): number {
  const z = x * x;
  return 1 - (0.5 * z - z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))));
}

/** The quadrant (0-3) and the remainder in [−π/4, π/4] of x. */
function reduce(x: number, out: Float64Array): number {
  const n = Math.round(x * TWO_OVER_PI);
  out[0] = x - n * PIO2_HI - n * PIO2_LO;
  return ((n % 4) + 4) % 4;
}

const scratch = new Float64Array(1);

export function dsin(x: number): number {
  const q = reduce(x, scratch);
  const r = scratch[0]!;
  return q === 0 ? kernelSin(r) : q === 1 ? kernelCos(r) : q === 2 ? -kernelSin(r) : -kernelCos(r);
}

export function dcos(x: number): number {
  const q = reduce(x, scratch);
  const r = scratch[0]!;
  return q === 0 ? kernelCos(r) : q === 1 ? -kernelSin(r) : q === 2 ? -kernelCos(r) : kernelSin(r);
}

// atan (s_atan.c): breakpoints with atan's value split high and low, and the odd polynomial.
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948965580e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2,
  1.62858201153657823623e-2,
];

export function datan(x: number): number {
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e19) return neg ? -ATAN_HI[3]! : ATAN_HI[3]!; // 2^66
  let id = -1;
  if (a >= 0.4375) {
    if (a < 1.1875) {
      if (a < 0.6875) {
        id = 0;
        a = (2 * a - 1) / (2 + a);
      } else {
        id = 1;
        a = (a - 1) / (a + 1);
      }
    } else if (a < 2.4375) {
      id = 2;
      a = (a - 1.5) / (1 + 1.5 * a);
    } else {
      id = 3;
      a = -1 / a;
    }
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  const r = id < 0 ? a - a * (s1 + s2) : ATAN_HI[id]! - (a * (s1 + s2) - ATAN_LO[id]! - a);
  return neg ? -r : r;
}

/** The angle of (x, y) in (−π, π], as Math.atan2(y, x). */
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? Math.PI - datan(y / -x) : -(Math.PI - datan(-y / -x));
  return y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0;
}

/** The real cube root of x. */
export function dcbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const neg = x < 0;
  let m = neg ? -x : x;
  // Scale by powers of 8 (exact) into [1, 8), whose cube root is in [1, 2); scale back by 2s.
  let k = 0;
  while (m >= 8) {
    m /= 8;
    k++;
  }
  while (m < 1) {
    m *= 8;
    k--;
  }
  // Newton from the middle of [1, 2]: the error squares every step, under 1e-15 after six.
  let y = 1.5;
  for (let i = 0; i < 7; i++) y = (2 * y + m / (y * y)) / 3;
  for (; k > 0; k--) y *= 2;
  for (; k < 0; k++) y /= 2;
  return neg ? -y : y;
}

/** x^(1/n) for x > 0 and a whole n ≥ 1, by Newton's method. */
export function droot(x: number, n: number): number {
  let y = x > 1 ? x : 1;
  for (let i = 0; i < 200; i++) {
    let p = 1;
    for (let j = 1; j < n; j++) p *= y;
    const next = ((n - 1) * y + x / p) / n;
    if (next === y) break;
    y = next;
  }
  return y;
}
