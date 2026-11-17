import { randomInt } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Report } from "../../shared/schema";
import { coarse, languageId, validateVocabulary } from "./privacy";

export interface Skeleton {
  dirs: { parent: number }[];
  files: {
    dir: number;
    language: string;
    category: string;
    bytes: number;
    lines: number;
    binary: boolean;
    secret: boolean;
    generated: boolean;
    vendored: boolean;
  }[];
  edges: { from: number; to: number; kind: string; type: boolean }[];
}
function permutation(n: number): number[] {
  const ids = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}
/** No seed, hash, sorted-name rank or original id survives the independent permutations. */
export function makeSkeleton(r: Report): Skeleton {
  const ds = permutation(r.dirs.length),
    fs = permutation(r.files.length);
  const di = new Array<number>(ds.length),
    fi = new Array<number>(fs.length);
  ds.forEach((old, id) => {
    di[old] = id;
  });
  fs.forEach((old, id) => {
    fi[old] = id;
  });
  const types = new Set(r.edges.typeOnly ?? []);
  const result: Skeleton = {
    dirs: ds.map((id) => ({ parent: r.dirs[id]!.parent < 0 ? -1 : di[r.dirs[id]!.parent]! })),
    files: fs.map((id) => {
      const f = r.files[id]!;
      return {
        dir: di[f.dir]!,
        language: languageId(f.language),
        category: f.category,
        bytes: coarse(f.bytes),
        lines: coarse(f.lines),
        binary: f.binary,
        secret: f.secret,
        generated: f.generated,
        vendored: f.vendored,
      };
    }),
    edges: r.edges.from
      .flatMap((from, i) => (r.edges.kind[i] === "link" ? [] : [{ from: fi[from]!, to: fi[r.edges.to[i]!]!, kind: r.edges.kind[i]!, type: types.has(i) }]))
      .sort((a, b) => a.from - b.from || a.to - b.to),
  };
  validateSkeleton(result);
  return result;
}
export function validateSkeleton(s: Skeleton): void {
  validateVocabulary(s);
  const exact = (v: object, keys: string[]) => {
    if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) throw new Error("invalid skeleton shape");
  };
  exact(s, ["dirs", "files", "edges"]);
  if (
    !Array.isArray(s.dirs) ||
    !Array.isArray(s.files) ||
    !Array.isArray(s.edges) ||
    !s.dirs.length ||
    s.files.length > 1_000_000 ||
    s.dirs.length > 1_000_000 ||
    s.edges.length > 10_000_000
  )
    throw new Error("invalid skeleton size");
  const id = (x: number, n: number) => Number.isInteger(x) && x >= 0 && x < n;
  let roots = 0;
  for (const d of s.dirs) {
    exact(d, ["parent"]);
    if (d.parent === -1) roots++;
    else if (!id(d.parent, s.dirs.length)) throw new Error("invalid skeleton parent");
  }
  if (roots !== 1) throw new Error("invalid skeleton root");
  const state = new Uint8Array(s.dirs.length);
  for (let start = 0; start < state.length; start++) {
    let p = start;
    const visited: number[] = [];
    while (p >= 0 && !state[p]) {
      state[p] = 1;
      visited.push(p);
      p = s.dirs[p]!.parent;
    }
    if (p >= 0 && state[p] === 1) throw new Error("cyclic skeleton tree");
    for (const d of visited) state[d] = 2;
  }
  for (const f of s.files) {
    exact(f, ["dir", "language", "category", "bytes", "lines", "binary", "secret", "generated", "vendored"]);
    if (
      !id(f.dir, s.dirs.length) ||
      !Number.isInteger(f.bytes) ||
      f.bytes < 0 ||
      !Number.isInteger(f.lines) ||
      f.lines < 0 ||
      [f.binary, f.secret, f.generated, f.vendored].some((b) => typeof b !== "boolean")
    )
      throw new Error("invalid skeleton attributes");
  }
  const pairs = new Set<number>();
  for (const e of s.edges) {
    exact(e, ["from", "to", "kind", "type"]);
    if (
      !id(e.from, s.files.length) ||
      !id(e.to, s.files.length) ||
      e.from === e.to ||
      typeof e.type !== "boolean" ||
      !["import", "require", "include", "reference"].includes(e.kind)
    )
      throw new Error("invalid skeleton edge");
    const key = e.from * s.files.length + e.to;
    if (pairs.has(key)) throw new Error("duplicate skeleton edge");
    pairs.add(key);
  }
}

/** Writes exclusively to a new, explicitly selected directory. It never executes generated code. */
export async function generateSynthetic(s: Skeleton, target: string): Promise<void> {
  validateSkeleton(s);
  const out = resolve(target);
  const paths = new Array<string>(s.dirs.length);
  for (let i = 0; i < paths.length; i++) {
    const chain: number[] = [];
    let p = i;
    while (p >= 0 && paths[p] === undefined) {
      chain.push(p);
      p = s.dirs[p]!.parent;
    }
    let base = p < 0 ? out : paths[p]!;
    while (chain.length) {
      const d = chain.pop()!;
      base = s.dirs[d]!.parent < 0 ? out : join(base, `d${d}`);
      paths[d] = base;
    }
  }
  const names = s.files.map((f, i) => join(paths[f.dir]!, `f${i}.ts`));
  const edges = s.files.map(() => [] as string[]);
  s.edges.forEach((e, i) => {
    let spec = relative(dirname(names[e.from]!), names[e.to]!).split("\\").join("/").replace(/\.ts$/, "");
    if (!spec.startsWith(".")) spec = "./" + spec;
    edges[e.from]!.push(e.type ? `import type { Value as V${i} } from ${JSON.stringify(spec)};` : `import ${JSON.stringify(spec)};`);
  });
  // Bound a hostile imported skeleton before creating anything. Counts remain exact, content is padding.
  const sizes = s.files.map((f, i) => Math.max(f.bytes, f.lines, Buffer.byteLength(edges[i]!.join("\n")) + 80));
  if (sizes.some((n) => n > 64 * 1024 * 1024) || sizes.reduce((a, b) => a + b, 0) > 2 * 1024 ** 3) throw new Error("synthetic output exceeds safety limit");
  await mkdir(out); // EEXIST includes an empty folder or a symlink. Never replace either.
  try {
    for (const p of paths) if (p !== out) await mkdir(p, { recursive: true });
    for (let i = 0; i < names.length; i++) {
      let text = edges[i]!.join("\n") + "\nexport type Value = number;\n";
      text += "\n".repeat(Math.max(0, s.files[i]!.lines - text.split("\n").length));
      text += "/*" + " ".repeat(Math.max(0, sizes[i]! - Buffer.byteLength(text) - 4)) + "*/";
      await writeFile(names[i]!, text, { flag: "wx", mode: 0o600 });
    }
  } catch (e) {
    await rm(out, { recursive: true, force: true });
    throw e;
  }
}
