/**
 * How tool results read: JSON, laid out for an agent's context window.
 *
 * Plain JSON.stringify(x, null, 2) puts every field of every row on its own line; unindented
 * JSON is one unreadable line. render() keeps a row (scalars only, see isRow) on one line
 * however wide, and anything else that fits in WIDTH characters, and breaks the rest. A
 * width rule alone was not enough: a file row runs past 120 characters, so `files` with 50
 * rows still came out at 720 lines. Measured on this repository, that listing is 724 lines and
 * 16.2k characters pretty-printed, 57 lines and 11.0k characters here, against 10.7k for
 * unindented JSON.
 *
 * Positions are 1-based everywhere a tool prints them ("src/app.ts:12"), because that is what
 * editors, compiler errors and file-reading tools count; the report stores them 0-based.
 */

const WIDTH = 120;

export function render(value: unknown): string {
  return write(value, "");
}

const scalar = (v: unknown) => v === null || typeof v !== "object";

/** A row: every value a scalar or a list of scalars. Kept whole, however wide it runs. */
function isRow(value: object): boolean {
  return Object.values(value).every((v) => scalar(v) || (Array.isArray(v) && v.length <= 12 && v.every(scalar)));
}

function write(value: unknown, indent: string): string {
  const flat = JSON.stringify(value) ?? "null";
  if (value === null || typeof value !== "object" || flat.length + indent.length <= WIDTH || isRow(value)) return flat;
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => inner + write(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`).join(",\n")}\n${indent}}`;
}

/** Unix seconds → "2026-11-08". */
export const day = (unix: number): string => new Date(unix * 1000).toISOString().slice(0, 10);

/** Round to `places` decimals; small floats in tool output are noise past three. */
export const round = (x: number, places = 3): number => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

export const share = (part: number, whole: number): number => (whole > 0 ? round(part / whole) : 0);

/** "src/app.ts:12" from a 0-based line. */
export const at = (path: string, line0: number): string => `${path}:${line0 + 1}`;

/** Cut a long one-line string (a printed type, a commit subject) to `max` characters. */
export const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Milliseconds as "850 ms" / "4.2 s" / "3 min". */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 120_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
