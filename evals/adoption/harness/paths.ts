import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function checkoutEntry(checkout: string): string {
  const entry = join(realpathSync(checkout), "bin", "skyplate.ts");
  if (!statSync(entry).isFile())
    throw new Error(
      "Skyplate checkout needs bin/skyplate.ts and installed dependencies.",
    );
  return entry;
}

// This checkout is always protected, whatever inputs a mode names: a run's raw output holds
// the machine's private instructions and session data, and must never land where git can
// pick it up.
const CHECKOUT = resolve(import.meta.dir, "../../..");

// Resolve symlinked parents before checking containment. A lexical path check would let
// an output symlink place logs inside one of the read-only inputs.
export function freshOutput(value: string, inputs: string[]): string {
  const output = resolve(value);
  if (existsSync(output)) throw new Error("--out must not exist yet.");
  const canonical = join(
    realpathSync(dirname(output)),
    relative(dirname(output), output),
  );
  for (const input of [CHECKOUT, ...inputs]) {
    const rel = relative(realpathSync(input), canonical);
    if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"))) {
      throw new Error("--out must be outside every input directory.");
    }
  }
  mkdirSync(canonical);
  return canonical;
}
