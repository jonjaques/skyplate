import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReportFolder } from "../src/mcp/report";
import { Workspace } from "../src/mcp/workspace";
import type { Report } from "../src/shared/schema";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-report-read-")));
const BASE = join(TMP, "base.skyplate");
let report: Report;
let id: number;

beforeAll(async () => {
  const project = join(TMP, "project");
  mkdirSync(project);
  writeFileSync(join(project, "index.ts"), "export const value = 1;\n");
  const ws = new Workspace();
  try {
    const job = ws.build({ path: project, out: BASE, options: { git: false } });
    await job.done;
    expect(job.state).toBe("done");
    report = (await readReportFolder(BASE)).report;
    id = report.files.find((f) => f.path === "index.ts")!.id;
  } finally {
    ws.shutdown();
  }
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function copy(name: string): { dir: string; data: Report } {
  const dir = join(TMP, name);
  cpSync(BASE, dir, { recursive: true });
  return { dir, data: structuredClone(report) };
}

function save(dir: string, data: Report): void {
  writeFileSync(join(dir, "data/report.js"), `window.__skyplate.resolve("report", ${JSON.stringify(data)});\n`);
}

describe("report data reads", () => {
  test("source chunks cannot escape through paths or symlinks", async () => {
    const outside = join(TMP, "outside.js");
    writeFileSync(outside, `window.__skyplate.resolve("source/0", ${JSON.stringify({ chunk: 0, files: { [id]: "fixture-only-private-text" } })});\n`);
    const traversal = copy("traversal");
    traversal.data.source!.chunks[0] = "../outside.js";
    save(traversal.dir, traversal.data);
    await expect((await readReportFolder(traversal.dir)).text(id)).rejects.toThrow("invalid report data path");
    const linked = copy("linked");
    const chunk = join(linked.dir, linked.data.source!.chunks[0]!);
    rmSync(chunk);
    symlinkSync(outside, chunk);
    await expect((await readReportFolder(linked.dir)).text(id)).rejects.toThrow("leaves the report folder");
  });

  test("failed lazy symbol reads can recover after the data file is repaired", async () => {
    const { dir, data } = copy("repair");
    const target = join(dir, data.symbols!.url);
    writeFileSync(target, "not a symbols data script");
    const folder = await readReportFolder(dir);
    await expect(folder.symbols()).rejects.toThrow("invalid symbols data script");
    writeFileSync(target, readFileSync(join(BASE, data.symbols!.url)));
    expect((await folder.symbols())!.symbols.name).toContain("value");
  });

  test("source classification does not trust an absent secret flag", async () => {
    const { dir, data } = copy("secret");
    data.files[id]!.path = ".env";
    save(dir, data);
    expect(await (await readReportFolder(dir)).text(id)).toMatchObject({ reason: expect.stringContaining("credentials") });
  });

  test("a snapshot never mixes its file ids with a rebuilt report's chunks", async () => {
    const { dir } = copy("rebuilt");
    const folder = await readReportFolder(dir);
    // A deterministic rebuild marker, independent of the filesystem clock's resolution.
    const later = new Date(folder.mtimeMs + 1000);
    utimesSync(join(dir, "data/report.js"), later, later);
    await expect(folder.text(id)).rejects.toThrow("report changed on disk");
  });
});
