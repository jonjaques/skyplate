import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const checkout = resolve(import.meta.dir, "../..");

export function args(allowed: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  const input = process.argv.slice(2);
  for (let i = 0; i < input.length; i += 2) {
    const key = input[i];
    const value = input[i + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || values.has(key)) {
      throw new Error(`Expected unique key/value arguments: ${allowed.join(", ")}`);
    }
    values.set(key, value);
  }
  return values;
}

export function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}

/** Existing parents are resolved before checking placement, so a symlink cannot hide overlap. */
export function freshOut(value: string, projects: string[] = []): string {
  const requested = resolve(value);
  const out = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
  if (existsSync(out)) throw new Error("--out must not exist");
  for (const root of [checkout, ...projects].map((p) => realpathSync(p))) {
    if (contains(root, out) || contains(out, root)) throw new Error("--out must be outside the checkout and analyzed repositories");
  }
  mkdirSync(out, { mode: 0o700 });
  return out;
}

export function json(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

export function revision(root: string): string | null {
  const p = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : null;
}

export function metadata(project: string) {
  return { analyzerCommit: revision(checkout), inputCommit: revision(project), bun: Bun.version, platform: process.platform, architecture: process.arch };
}
