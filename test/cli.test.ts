/**
 * The `skyplate` command: flags, error exits, a real run, and the static server.
 *
 * The CLI is spawned as a user would run it (`bun bin/skyplate.ts …`), so exit codes and
 * stderr are the real ones; argument parsing and the server are also tested in-process.
 *
 * Run: bun test test/cli.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError, parseCommand, parseSize } from "../src/cli/args";
import { slug } from "../src/cli/main";
import { resolveInside, startServer, type StaticServer } from "../src/cli/serve";

const BIN = join(import.meta.dir, "..", "bin", "skyplate.ts");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-cli-test-")));
const PROJECT = join(TMP, "tiny");

function run(args: string[], cwd = TMP): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync([process.execPath, BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

beforeAll(() => {
  mkdirSync(join(PROJECT, "src"), { recursive: true });
  writeFileSync(join(PROJECT, "README.md"), "# Tiny Thing\n\nA two-file project.\n");
  writeFileSync(join(PROJECT, "src", "a.py"), "from . import b\n\nprint(b.VALUE)\n");
  writeFileSync(join(PROJECT, "src", "b.py"), "VALUE = 1\n");
  writeFileSync(join(TMP, "a-file.txt"), "not a directory");
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("arguments", () => {
  test("sizes accept suffixes and plain bytes", () => {
    expect(parseSize("512k", "--x")).toBe(512 * 1024);
    expect(parseSize("64m", "--x")).toBe(64 * 1024 * 1024);
    expect(parseSize("1.5g", "--x")).toBe(1.5 * 1024 ** 3);
    expect(parseSize("2MiB", "--x")).toBe(2 * 1024 * 1024);
    expect(parseSize("4096", "--x")).toBe(4096);
    expect(() => parseSize("lots", "--x")).toThrow(UsageError);
  });

  test("defaults and every option", () => {
    const d = parseCommand([]);
    expect(d).toMatchObject({ kind: "analyze", path: ".", open: false, serve: false, json: false, quiet: false });
    if (d.kind !== "analyze") throw new Error("expected analyze");
    expect(d.options).toEqual({
      includeIgnored: false,
      exclude: [],
      git: true,
      source: true,
      symbols: true,
      maxCommits: 20_000,
      maxSourceFile: 512 * 1024,
      maxSourceTotal: 64 * 1024 * 1024,
      tsMaxFiles: 20_000,
      redactPaths: false,
    });
    const all = parseCommand([
      "proj",
      "-o",
      "out",
      "--open",
      "--port",
      "5000",
      "--no-git",
      "--no-source",
      "--no-symbols",
      "--max-commits",
      "100",
      "--max-source-file",
      "1m",
      "--max-source-total",
      "8m",
      "--include-ignored",
      "--exclude",
      "*.log",
      "--exclude",
      "build/",
      "--ts-max-files",
      "50",
      "--redact-paths",
      "--json",
      "--quiet",
    ]);
    expect(all).toMatchObject({ kind: "analyze", path: "proj", out: "out", open: true, port: 5000, json: true, quiet: true });
    if (all.kind !== "analyze") throw new Error("expected analyze");
    expect(all.options).toEqual({
      includeIgnored: true,
      exclude: ["*.log", "build/"],
      git: false,
      source: false,
      symbols: false,
      maxCommits: 100,
      maxSourceFile: 1024 * 1024,
      maxSourceTotal: 8 * 1024 * 1024,
      tsMaxFiles: 50,
      redactPaths: true,
    });
  });

  test("serve takes one folder", () => {
    expect(parseCommand(["serve", "r", "--port", "0", "--open"])).toEqual({ kind: "serve", dir: "r", port: 0, open: true });
    expect(() => parseCommand(["serve"])).toThrow(UsageError);
    expect(() => parseCommand(["a", "b"])).toThrow(UsageError);
    expect(() => parseCommand(["--max-commits", "many"])).toThrow(UsageError);
  });

  test("default report names are filesystem-safe", () => {
    expect(slug("Vite ⚡")).toBe("vite");
    expect(slug("Café Ops")).toBe("cafe-ops");
    expect(slug("@scope/pkg")).toBe("scope-pkg");
  });
});

describe("the command", () => {
  test("--help and --version exit 0 on stdout", () => {
    const help = run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage");
    expect(help.stdout).toContain("--max-source-total");
    const v = run(["--version"]);
    expect(v.code).toBe(0);
    expect(v.stdout).toMatch(/^skyplate \d+\.\d+\.\d+\n$/);
  });

  test("user errors are one line and exit 1", () => {
    const missing = run([join(TMP, "nope")]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe(`skyplate: path not found: ${join(TMP, "nope")}\n`);

    const file = run([join(TMP, "a-file.txt")]);
    expect(file.code).toBe(1);
    expect(file.stderr).toContain("not a directory");

    const outIsFile = run([PROJECT, "--out", join(TMP, "a-file.txt")]);
    expect(outIsFile.code).toBe(1);
    expect(outIsFile.stderr).toContain("output path is a file");

    const flag = run(["--frobnicate"]);
    expect(flag.code).toBe(1);
    expect(flag.stderr).toContain("--help");
  });

  test("refuses to overwrite a folder that is not a report", () => {
    const keep = join(TMP, "keep");
    mkdirSync(keep, { recursive: true });
    writeFileSync(join(keep, "important.txt"), "do not delete");
    const r = run([PROJECT, "--out", keep, "--quiet"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not a skyplate report");
    expect(readFileSync(join(keep, "important.txt"), "utf8")).toBe("do not delete");
  });

  test("--out . refuses to replace the project, even one that has a data/report.js", () => {
    // The run that used to exit 0 having deleted everything but the report it wrote.
    const proj = join(TMP, "selfdelete");
    mkdirSync(join(proj, "data"), { recursive: true });
    mkdirSync(join(proj, "src"), { recursive: true });
    writeFileSync(join(proj, "data", "report.js"), "export const report = {};\n");
    writeFileSync(join(proj, "src", "main.ts"), "export function main() { return 42; }\n");
    const r = run([".", "--out", ".", "--quiet", "--no-git"], proj);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`skyplate: output folder ${proj} is the project being analyzed, and writing there would replace it; choose a new folder (one inside the project is fine)\n`);
    expect(readFileSync(join(proj, "src", "main.ts"), "utf8")).toContain("main()");
  });

  test("refuses an --out that contains the project", () => {
    const r = run([PROJECT, "--out", TMP, "--quiet", "--no-git"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("contains the project being analyzed");
    expect(existsSync(join(PROJECT, "src", "a.py"))).toBe(true);
  });

  test("an unrelated folder with a data/report.js is not a report", () => {
    const victim = join(TMP, "victim");
    mkdirSync(join(victim, "data"), { recursive: true });
    mkdirSync(join(victim, "src"), { recursive: true });
    writeFileSync(join(victim, "data", "report.js"), "export const report = {};\n");
    writeFileSync(join(victim, "src", "important.txt"), "do not delete");
    writeFileSync(join(victim, "package.json"), "{}\n");
    const r = run([PROJECT, "--out", victim, "--quiet", "--no-git"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a skyplate report; choose another --out");
    expect(readFileSync(join(victim, "src", "important.txt"), "utf8")).toBe("do not delete");
  });

  test("an --out under a file or in a read-only folder fails before the analysis, in one line", () => {
    const file = join(TMP, "a-file.txt");
    const under = run([PROJECT, "--out", join(file, "report")]);
    expect(under.code).toBe(1);
    // No progress, no summary: the check ran before anything was analyzed.
    expect(under.stderr).toBe(`skyplate: output path is inside a file: ${file}\n`);

    if (process.getuid?.() === 0) return; // root writes anywhere, so there is nothing to refuse
    const locked = join(TMP, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o555);
    try {
      const denied = run([PROJECT, "--out", join(locked, "x.skyplate")]);
      expect(denied.code).toBe(1);
      expect(denied.stderr).toBe(`skyplate: cannot write the report to ${join(locked, "x.skyplate")}: ${locked} is not writable\n`);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test("a quiet run writes the report and prints nothing", () => {
    const out = join(TMP, "tiny-report");
    const r = run([PROJECT, "--out", out, "--quiet", "--no-git"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(existsSync(join(out, "index.html"))).toBe(true);
    expect(readFileSync(join(out, "data", "report.js"), "utf8")).toStartWith('window.__skyplate.resolve("report", ');
  }, 60_000);

  test("the default output lands in the current directory, named after the project", () => {
    const r = run([PROJECT, "--no-git"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(TMP, "tiny-thing.skyplate", "data", "report.js"))).toBe(true);
    expect(r.stderr).toContain("skyplate · Tiny Thing");
    expect(r.stderr).toContain("next: open tiny-thing.skyplate/index.html");
    expect(r.stderr).toContain("skyplate serve tiny-thing.skyplate");
  }, 60_000);

  test("a report inside the project is not analyzed on the next run", () => {
    const first = run([".", "--no-git", "--quiet"], PROJECT);
    expect(first.code).toBe(0);
    const second = run([".", "--no-git", "--quiet", "--json"], PROJECT);
    expect(second.code).toBe(0);
    const report = JSON.parse(readFileSync(join(PROJECT, "tiny-thing.skyplate", "data", "report.json"), "utf8"));
    expect(report.files.map((f: { path: string }) => f.path)).toEqual(["README.md", "src/a.py", "src/b.py"]);
  }, 60_000);
});

describe("serve", () => {
  let server: StaticServer;
  const dir = join(TMP, "served");

  beforeAll(() => {
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
    writeFileSync(join(dir, "data", "report.js"), "window.__skyplate.resolve('report', {});");
    writeFileSync(join(dir, "THIRD_PARTY_NOTICES"), "THIRD-PARTY NOTICES\n");
    writeFileSync(join(TMP, "outside.txt"), "outside the report");
    server = startServer(dir, 0);
  });
  afterAll(() => server.stop());

  test("serves files with MIME types and no-cache", async () => {
    const index = await fetch(server.url);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    const data = await fetch(server.url + "data/report.js");
    expect(data.headers.get("content-type")).toContain("javascript");
    expect(await data.text()).toContain("__skyplate");
    expect((await fetch(server.url + "missing.js")).status).toBe(404);
  });

  test("serves the extensionless notice files as text, so a browser shows them", async () => {
    const notices = await fetch(server.url + "THIRD_PARTY_NOTICES");
    expect(notices.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await notices.text()).toBe("THIRD-PARTY NOTICES\n");
  });

  test("refuses paths that escape the folder", async () => {
    const r = await fetch(server.url + "..%2Foutside.txt");
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("outside the report");
    expect(resolveInside("/r", "/../etc/passwd")).toBeUndefined();
    expect(resolveInside("/r", "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    expect(resolveInside("/r", "/a/%00b")).toBeUndefined();
    expect(resolveInside("/r", "/%E0%A4%A")).toBeUndefined();
    expect(resolveInside("/r", "/data/x.js")).toBe("/r/data/x.js");
  });
});
