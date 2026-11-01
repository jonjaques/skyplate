// @ts-check
import { add } from "./math";

/**
 * Multiplies by repeated addition. Slow on purpose.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function times(a, b) {
  let out = 0;
  for (let i = 0; i < b; i++) out = add(out, a);
  return out;
}

/** @param {number} n */
export const square = (n) => times(n, n);
