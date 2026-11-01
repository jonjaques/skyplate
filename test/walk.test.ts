/**
 * walkProject over temporary trees: plain directories with nested .gitignore files, git work
 * trees (staged, untracked, ignored, deleted, gitlinks, symlinks), excludes, and odd names.
 *
 * Git fixtures are only staged, never committed: committing would pick up the machine's
 * global signing and hook configuration, and the index is all ls-files reads. Global config
 * and the global excludes file are switched off for the git tests (walkProject's own git
 * calls inherit the environment), so a developer's ~/.config/git/ignore cannot change counts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { walkProject } from "../src/core/walk";

const UNICODE = "ünïcödé 名前 – emoji 🚀.ts";

async function tree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await p.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(p.stderr).text()}`);
}

const SHARED: Record<string, string> = {
  "a.ts": "export const a = 1;\n",
  ".gitignore": "*.log\nbuild/\n",
  "debug.log": "noise",
  "build/out.js": "built",
  "node_modules/x/index.js": "dep",
  "sub/.gitignore": "!keep.log\nlocal.txt\n",
  "sub/keep.log": "kept by the child's negation",
  "sub/local.txt": "ignored by the child",
  "sub/b.ts": "export const b = 2;\n",
  ".DS_Store": "finder",
  [UNICODE]: "export {};\n",
};

let base: string;
beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "starchart-walk-")));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("plain directory (no git)", () => {
  let root: string;
  beforeAll(async () => {
    root = join(base, "plain");
    await tree(root, SHARED);
    await symlink(join(root, "a.ts"), join(root, "link.ts"));
  });

  test("honors nested .gitignore files and default excludes", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: [] });
    expect(w.isGit).toBe(false);
    expect(w.root).toBe(root);
    expect(w.files.map((f) => f.path)).toEqual([".gitignore", "a.ts", "sub/.gitignore", "sub/b.ts", "sub/keep.log", UNICODE]);
    // debug.log, build/, node_modules/, sub/local.txt, .DS_Store, link.ts
    expect(w.ignored).toBe(6);
  });

  test("reports size, mtime and absolute path", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: [] });
    const a = w.files.find((f) => f.path === "a.ts")!;
    expect(a.bytes).toBe(SHARED["a.ts"]!.length);
    expect(a.abs).toBe(join(root, "a.ts"));
    expect(a.mtimeMs).toBeGreaterThan(Date.now() - 600_000);
    const u = w.files.find((f) => f.path === UNICODE)!;
    expect(existsSync(u.abs)).toBe(true);
  });

  test("exclude applies on top, directories pruned whole", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: ["sub/", "*.ts"] });
    expect(w.files.map((f) => f.path)).toEqual([".gitignore"]);
    expect(w.ignored).toBe(6 + 2); // sub/ and a.ts; the unicode .ts too
  });

  test("includeIgnored walks everything but VCS metadata and symlinks", async () => {
    await tree(root, { ".git/HEAD": "ref: refs/heads/main\n" });
    const w = await walkProject(root, { includeIgnored: true, exclude: [] });
    const paths = w.files.map((f) => f.path);
    expect(paths).toContain("debug.log");
    expect(paths).toContain("build/out.js");
    expect(paths).toContain("node_modules/x/index.js");
    expect(paths).toContain("sub/local.txt");
    expect(paths).toContain(".DS_Store");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
    expect(w.ignored).toBe(1); // the symlink
    await rm(join(root, ".git"), { recursive: true });
  });

  test("results are sorted by path", async () => {
    const w = await walkProject(root, { includeIgnored: true, exclude: [] });
    const paths = w.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test("rejects a file as root", async () => {
    await expect(walkProject(join(root, "a.ts"), { includeIgnored: false, exclude: [] })).rejects.toThrow();
  });
});

describe("git work tree", () => {
  let root: string;
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, xdg: process.env.XDG_CONFIG_HOME, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
  afterAll(() => {
    for (const [k, v] of [["GIT_CONFIG_GLOBAL", saved.global], ["XDG_CONFIG_HOME", saved.xdg], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeAll(async () => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.XDG_CONFIG_HOME = join(base, "xdg");
    root = join(base, "repo");
    await tree(root, {
      ...SHARED,
      // In git mode git alone decides; the walker's default excludes do not apply, so the
      // fixture states them the way a real repository would.
      ".gitignore": "*.log\nbuild/\nnode_modules/\n.DS_Store\n",
      "gone.ts": "deleted after staging",
      "docs/guide.md": "# Guide\n",
    });
    await symlink("a.ts", join(root, "link.ts"));
    await git(root, "init", "-q");
    await git(root, "add", "-A");
    await unlink(join(root, "gone.ts")); // tracked in the index, missing on disk
    await tree(root, { "untracked.ts": "new", "also.log": "ignored" });
    // A gitlink (submodule entry) whose directory exists but holds no checkout.
    await mkdir(join(root, "vendor/lib"), { recursive: true });
    await git(root, "update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor/lib`);
    // An untracked nested repository: --others lists it as "nested/".
    await tree(root, { "nested/x.ts": "x" });
    await git(join(root, "nested"), "init", "-q");
  });

  test("lists tracked and untracked files git does not ignore", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: [] });
    expect(w.isGit).toBe(true);
    const paths = w.files.map((f) => f.path);
    expect(paths).toEqual([".gitignore", "a.ts", "docs/guide.md", "sub/.gitignore", "sub/b.ts", "sub/keep.log", "untracked.ts", UNICODE]);
    expect(paths).not.toContain("gone.ts");
    expect(paths).not.toContain("link.ts");
    expect(w.warnings.some((m) => m.includes("missing from the working tree"))).toBe(true);
    expect(w.warnings.some((m) => m.includes("nested"))).toBe(true);
  });

  test("counts ignored entries, symlinks, gitlinks and nested repos", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: [] });
    // git's ignored listing collapses directories: .DS_Store, also.log, build/, debug.log,
    // node_modules/, sub/local.txt; then the link.ts symlink, the vendor/lib gitlink, nested/.
    expect(w.ignored).toBe(9);
  });

  test("a subdirectory root gets paths relative to itself", async () => {
    const w = await walkProject(join(root, "sub"), { includeIgnored: false, exclude: [] });
    expect(w.isGit).toBe(true);
    expect(w.files.map((f) => f.path)).toEqual([".gitignore", "b.ts", "keep.log"]);
    expect(w.files[0]!.abs).toBe(join(root, "sub", ".gitignore"));
  });

  test("exclude filters git's list", async () => {
    const w = await walkProject(root, { includeIgnored: false, exclude: ["docs/", "*.log"] });
    const paths = w.files.map((f) => f.path);
    expect(paths).not.toContain("docs/guide.md");
    expect(paths).not.toContain("sub/keep.log");
  });

  test("includeIgnored bypasses git", async () => {
    const w = await walkProject(root, { includeIgnored: true, exclude: [] });
    expect(w.isGit).toBe(true);
    const paths = w.files.map((f) => f.path);
    expect(paths).toContain("debug.log");
    expect(paths).toContain("node_modules/x/index.js");
    expect(paths).toContain("nested/x.ts");
    expect(paths.some((p) => p.startsWith(".git/") || p.startsWith("nested/.git/"))).toBe(false);
  });

  test("a gitignored root falls back to a filesystem walk", async () => {
    const w = await walkProject(join(root, "build"), { includeIgnored: false, exclude: [] });
    expect(w.files.map((f) => f.path)).toEqual(["out.js"]);
    expect(w.warnings.some((m) => m.includes("walked the filesystem"))).toBe(true);
  });
});

const VITE = "/var/folders/30/cs05wf2173b2bvdj8f58q9k00000gn/T/starchart-session/repos/vite";

describe.skipIf(!existsSync(VITE))("real repository", () => {
  test("vite walks in well under a second", async () => {
    const t0 = performance.now();
    const w = await walkProject(VITE, { includeIgnored: false, exclude: [] });
    const ms = performance.now() - t0;
    expect(w.files.length).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(1000);
  });
});
