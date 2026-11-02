/**
 * The web's engine-independent math (src/shared/dmath.ts) agrees with the engine's own Math to
 * within a few units in the last place over the ranges the web feeds it. That it gives the same
 * bits in every engine follows from using only + − × ÷ and sqrt; that was checked by hashing
 * computeWeb's output under node (V8) and Bun (JSC), which is not something bun test can run.
 */

import { describe, expect, test } from "bun:test";
import { datan, datan2, dcbrt, dcos, droot, dsin } from "../src/shared/dmath";

/** |a − b| within `ulps` units in the last place of the larger, or an absolute floor near zero. */
function close(a: number, b: number, ulps = 4, floor = 1e-16): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(floor, scale * ulps * Number.EPSILON);
}

function sweep(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + 0.37)) / n);
}

describe("deterministic math", () => {
  test("sin and cos match Math over a full turn and over the golden-angle walk's large arguments", () => {
    for (const x of [...sweep(-7, 7, 4001), ...sweep(0, 50_000, 2001), 0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
      if (!close(dsin(x), Math.sin(x), 8, 1e-15)) throw new Error(`sin(${x}): ${dsin(x)} vs ${Math.sin(x)}`);
      if (!close(dcos(x), Math.cos(x), 8, 1e-15)) throw new Error(`cos(${x}): ${dcos(x)} vs ${Math.cos(x)}`);
    }
  });

  test("atan and atan2 match Math in every quadrant and across the breakpoints", () => {
    for (const x of [...sweep(-30, 30, 6001), 0.4375, 0.6875, 1.1875, 2.4375, 1e20, -1e20]) {
      if (!close(datan(x), Math.atan(x))) throw new Error(`atan(${x}): ${datan(x)} vs ${Math.atan(x)}`);
    }
    for (const y of [-3, -1e-9, 0, 1e-9, 0.5, 2]) {
      for (const x of [-3, -1e-9, 0, 1e-9, 0.5, 2]) {
        if (!close(datan2(y, x), Math.atan2(y, x), 4, 1e-15)) throw new Error(`atan2(${y}, ${x}): ${datan2(y, x)} vs ${Math.atan2(y, x)}`);
      }
    }
  });

  test("cube roots match Math.cbrt from tiny to huge", () => {
    for (const x of [...sweep(1e-6, 1, 1001), ...sweep(1, 1e6, 3001), 8, 27, 64, 1e-300, 1e300, -27, 0]) {
      if (!close(dcbrt(x), Math.cbrt(x), 2)) throw new Error(`cbrt(${x}): ${dcbrt(x)} vs ${Math.cbrt(x)}`);
    }
  });

  test("nth roots match Math.pow for the relaxation's alpha decay", () => {
    for (const n of [1, 2, 3, 40, 60, 90]) {
      expect(close(droot(0.002, n), Math.pow(0.002, 1 / n), 4)).toBe(true);
      expect(close(droot(5, n), Math.pow(5, 1 / n), 4)).toBe(true);
    }
  });
});
