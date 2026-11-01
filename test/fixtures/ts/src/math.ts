/** Adds two numbers. Second sentence is dropped. */
export function add(a: number, b: number): number {
  return a + b;
}

export const double = (n: number): number => add(n, n);

/** @deprecated Use add. */
export function legacyAdd(a: number, b: number) {
  return add(a, b);
}

export function format(value: string): string;
export function format(value: number): string;
export function format(value: string | number): string {
  if (typeof value === "number" && value > 0) {
    return value.toFixed(2);
  }
  return String(value || "none");
}

export async function* countdown(from: number) {
  for (let i = from; i > 0; i--) yield i;
}

export function identity<T>(value: T): T {
  return value;
}

export enum Color {
  Red,
  Green,
}

export function neverUsed(): void {}

let counter = 0;
export function bump(): number {
  counter++;
  counter = counter + 1;
  return counter;
}

export default function sum(...xs: number[]): number {
  return xs.reduce((acc, x) => add(acc, x), 0);
}
