import { expect, test } from "bun:test";
import { ToolRecorder, validateVocabulary } from "../src/core/bench";

test("recorder drops unknown tool, parameter and error text and records transitions without identities", () => {
  const r = new ToolRecorder();
  r.record({ tool: "overview", durationMs: 3, responseBytes: 1001, parameterKeys: ["project", "path", "path", "PRIVATE_PARAMETER"] });
  r.record({ tool: "PRIVATE_TOOL", durationMs: 11, responseBytes: 0, errorCode: "PRIVATE_ERROR" });
  r.breakSequence();
  r.record({ tool: "file", durationMs: 2, responseBytes: 19, errorCode: "permission" });
  const s = r.summary();
  validateVocabulary(s);
  expect(JSON.stringify(s)).not.toContain("PRIVATE");
  expect(s.transitions).toEqual([{ previous: "overview", next: "unknown_tool", count: 1 }]);
  expect(s.calls.find((c) => c.tool === "overview")!.responseBytes.maximum).toBe(1024);
  expect(s.calls.find((c) => c.tool === "overview")!.parameters).toContainEqual({ code: "unknown_parameter", value: 1 });
  expect(s.calls.find((c) => c.tool === "unknown_tool")!.errors).toEqual([{ code: "unknown_error", value: 1 }]);
  expect(() => r.record({ tool: "overview", durationMs: NaN, responseBytes: 0 })).toThrow();
  expect(r.summary()).toEqual(s);
});
test("histograms retain bounded summaries rather than an unbounded list of raw calls", () => {
  const r = new ToolRecorder();
  for (let i = 0; i < 10000; i++) r.record({ tool: "files", durationMs: i + 1, responseBytes: 100 });
  const s = r.summary();
  expect(s.calls[0]!.count).toBe(16384);
  expect(s.calls[0]!.durationMs.histogram.length).toBeLessThan(16);
  expect(s.calls[0]!.durationMs.p50).toBe(8192);
  expect(s.transitions).toEqual([{ previous: "files", next: "files", count: 16384 }]);
});

test("the own-source allowlist names every shipped source file", async () => {
  const { SKYPLATE_SOURCES } = await import("../src/core/bench/sources");
  const shipped: string[] = [];
  for (const dir of ["src/cli", "src/core", "src/mcp", "src/shared"]) {
    for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: `${import.meta.dir}/../${dir}` })) if (!file.endsWith(".test.ts")) shipped.push(`${dir}/${file}`);
  }
  expect(([...SKYPLATE_SOURCES] as string[]).sort()).toEqual(shipped.sort());
});
