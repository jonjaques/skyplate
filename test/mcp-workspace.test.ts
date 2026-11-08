import { afterAll, describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReportFolder } from "../src/mcp/report";
import { Job, Workspace } from "../src/mcp/workspace";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-workspace-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function fixture(name: string): string {
  const root = join(TMP, name);
  mkdirSync(root);
  writeFileSync(join(root, "index.ts"), "export const value = 1;\n");
  return root;
}

describe("workspace lifecycle", () => {
  test("concurrent opens share one project and analysis", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("concurrent");
      const opened = await Promise.all(Array.from({ length: 3 }, () => ws.open(root, { watch: false, options: { git: false, symbols: false } })));
      expect(opened.every((p) => p === opened[0])).toBe(true);
      expect(ws.list().projects).toHaveLength(1);
      expect(ws.list().jobs).toHaveLength(1);
      await opened[0]!.job!.done;
      expect(opened[0]!.job!.state).toBe("done");
    } finally {
      ws.shutdown();
    }
  });

  test("new options during analysis are merged and get their own completed analysis", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("options");
      const p = await ws.open(root, { watch: false, options: { git: false } });
      const first = p.job!;
      await ws.open(root, { options: { symbols: false } });
      expect(p.options).toEqual({ git: false, symbols: false });
      expect(p.job).not.toBe(first);
      await p.job!.done;
      expect(p.job!.state).toBe("done");
      expect(p.snapshot!.report.git).toBeUndefined();
      expect(await p.snapshot!.symbols()).toBeUndefined();
    } finally {
      ws.shutdown();
    }
  });

  test("watch can be enabled and disabled on an already open project", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("watch");
      const p = await ws.open(root, { watch: false, options: { git: false, symbols: false } });
      await p.job!.done;
      expect(p.watcher).toBeUndefined();
      await ws.open(root, { watch: true });
      expect(p.watcher).toBeDefined();
      await ws.open(root, { watch: false });
      expect(p.watcher).toBeUndefined();
    } finally {
      ws.shutdown();
    }
  });

  test("a change in the analysis start's millisecond still makes the snapshot stale", async () => {
    const ws = new Workspace();
    try {
      const p = await ws.open(fixture("same-millisecond"), { watch: false, options: { git: false, symbols: false } });
      await p.job!.done;
      p.changedAt = p.snapshot!.startedAt;
      p.changes = 1;
      expect(p.stale).toBe(true);
      await ws.ready(p, 5000);
      expect(p.stale).toBe(false);
    } finally {
      ws.shutdown();
    }
  });

  test("a queued build checks freshness when it starts", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("build");
      const p = await ws.open(root, { watch: false, options: { git: false, symbols: false } });
      await p.job!.done;
      const out = join(TMP, "fresh.skyplate");
      const build = ws.build({ project: p, out });
      writeFileSync(join(root, "new.ts"), "export const later = 2;\n");
      // Deliver a watcher event before the queue advances, without a platform-dependent timer.
      p.changedAt = p.snapshot!.startedAt + 1;
      await build.done;
      expect(build.state).toBe("done");
      expect(build.result?.reusedAnalysis).toBeUndefined();
      const folder = await readReportFolder(out);
      expect(folder.report.files.map((f) => f.path)).toContain("new.ts");
    } finally {
      ws.shutdown();
    }
  });

  test("aborted waits return immediately, and finished waits remove their listeners", async () => {
    const ws = new Workspace();
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await ws.wait(new Job("analyze", "cancelled"), 60_000, undefined, cancelled.signal)).toBe(false);
    expect(getEventListeners(cancelled.signal, "abort")).toHaveLength(0);
    for (const complete of [false, true]) {
      const controller = new AbortController();
      const job = new Job("analyze", "test");
      const waiting = ws.wait(job, complete ? 60_000 : 0, undefined, controller.signal);
      if (complete) job.finish();
      expect(await waiting).toBe(complete);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
  }, 1000);
});

describe("live source", () => {
  test("a credential added after analysis is never returned", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("credentials");
      writeFileSync(join(root, ".npmrc"), "engine-strict=true\n");
      const p = await ws.open(root, { watch: false, options: { git: false, symbols: false } });
      await p.job!.done;
      const snapshot = p.snapshot!;
      const id = snapshot.report.files.find((f) => f.path === ".npmrc")!.id;
      expect(await snapshot.text(id)).toHaveProperty("text");
      writeFileSync(join(root, ".npmrc"), "//registry.npmjs.org/:_authToken=fixture-only-secret\n");
      expect(await snapshot.text(id)).toMatchObject({ reason: expect.stringContaining("credentials") });
    } finally {
      ws.shutdown();
    }
  });

  test("a source path replaced with a link is never followed", async () => {
    const ws = new Workspace();
    try {
      const root = fixture("redirect");
      const p = await ws.open(root, { watch: false, options: { git: false, symbols: false } });
      await p.job!.done;
      const snapshot = p.snapshot!;
      const id = snapshot.report.files.find((f) => f.path === "index.ts")!.id;
      writeFileSync(join(root, ".env"), "TOKEN=fixture-only-secret\n");
      rmSync(join(root, "index.ts"));
      symlinkSync(".env", join(root, "index.ts"));
      expect(await snapshot.text(id)).toHaveProperty("reason");
    } finally {
      ws.shutdown();
    }
  });
});
