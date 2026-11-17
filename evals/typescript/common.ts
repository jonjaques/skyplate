import { cpSync, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CodeSymbols } from "../../src/shared/schema";

export const checkout = realpathSync(resolve(import.meta.dir, "../.."));
export const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

export function args(allowed: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const input = process.argv.slice(2);
  for (let i = 0; i < input.length; i += 2) {
    const key = input[i]?.replace(/^--/, "");
    const value = input[i + 1];
    if (!input[i]?.startsWith("--") || !key || !allowed.includes(key) || !value || value.startsWith("--")) {
      throw new Error(`Expected pairs of --${allowed.join(", --")}`);
    }
    if (values[key] !== undefined) throw new Error(`Repeated --${key}`);
    values[key] = value;
  }
  return values;
}

export function required(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

export function integer(value: string | undefined, fallback: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Expected a nonnegative integer");
  return n;
}

export function within(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (!part.startsWith("../") && part !== ".." && !isAbsolute(part));
}

export function output(values: Record<string, string>, project?: string): string {
  const requested = resolve(required(values, "out"));
  // Resolve the existing ancestor so a symlink cannot redirect writes into an input tree.
  let ancestor = requested;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const out = resolve(realpathSync(ancestor), relative(ancestor, requested));
  if (within(checkout, out) || (project && within(realpathSync(project), out))) {
    throw new Error("--out must be outside the checkout and analyzed project");
  }
  if (existsSync(out)) throw new Error("--out must not exist yet");
  mkdirSync(out, { recursive: true });
  return out;
}

export function write(out: string, name: string, value: unknown): void {
  writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n");
}

export function pathsIn(root: string): string[] {
  const found = Bun.spawnSync([
    "rg", "--files", "--hidden", "-g", "!.git", "-g", "!node_modules",
    "-g", "!**/node_modules", "-g", "!dist", "-g", "!build",
  ], { cwd: root });
  if (found.exitCode !== 0 && found.exitCode !== 1) throw new Error(found.stderr.toString());
  return found.stdout.toString().trim().split("\n").filter(Boolean).sort();
}

export function tsInput(root: string, paths = pathsIn(root), maxFiles = 20_000, maxRefs = 600_000) {
  return {
    root, paths, languages: paths.map(() => ""),
    isTest: paths.map((p) => /(^|\/)(__tests__|test|tests)\/|\.(test|spec)\./.test(p)),
    configs: paths.filter((p) => /(^|\/)(tsconfig|jsconfig)(\..+)?\.json$/i.test(p)),
    maxFiles, maxRefs,
  };
}

export function fixture(out: string, name: string): string {
  const root = join(out, name);
  cpSync(join(import.meta.dir, "fixtures", name), root, { recursive: true });
  if (name === "probes") {
    mkdirSync(join(root, "node_modules/@probe"), { recursive: true });
    for (const [alias, target] of [["source", "source"], ["dist", "built"]]) {
      symlinkSync(`../../packages/${target}`, join(root, "node_modules/@probe", alias!), "dir");
    }
  }
  return root;
}

export function label(S: CodeSymbols, id: number): string {
  const t = S.symbols;
  const parent = t.parent[id]!;
  return (parent >= 0 ? label(S, parent) + "." : "") + t.name[id]!;
}

export function portable(value: unknown, roots: [string, string][]): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "string") return item;
    for (const [root, replacement] of roots) item = (item as string).split(root).join(replacement);
    return item;
  }));
}

export interface Measurement {
  summary: { root: string; candidates: number; elapsed: number; [key: string]: unknown };
  paths: string[];
  data: CodeSymbols | null;
}
