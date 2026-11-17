import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { args, checkout, fixture, output, portable, required, write } from "./common";

const flags = args(["out", "mode", "project"]);
const mode = required(flags, "mode");
if (mode !== "pagination" && mode !== "dogfood") throw new Error("--mode must be pagination or dogfood");
const project = mode === "dogfood" ? realpathSync(required(flags, "project")) : undefined;
const out = output(flags, project);
const root = project ?? fixture(out, "pagination");
const client = new Client({ name: "typescript-eval", version: "1" });
const records: { name: string; args: Record<string, unknown>; ms: number; isError: boolean; data: unknown }[] = [];
async function call(name: string, input: Record<string, unknown>) {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: input }, { timeout: 150_000 });
  const data = (result.structuredContent as { data?: unknown } | undefined)?.data;
  records.push({ name, args: input, ms: performance.now() - start, isError: !!result.isError,
    data: data ?? result.content });
  return { data: data as Record<string, unknown> | undefined, isError: result.isError };
}
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(checkout, "bin/skyplate.ts"), "mcp"] }));
  const opened = await call("open", { path: root, watch: false, wait_seconds: 120 });
  if (opened.isError) throw new Error("MCP open failed; see the saved transcript");
  for (;;) {
    const status = await call("status", { project: root, wait_seconds: 45 });
    if (status.isError) throw new Error("MCP status failed");
    const state = status.data?.state ?? (status.data?.project as { state?: string } | undefined)?.state;
    if (state === "ready") break;
    if (state !== "analyzing") throw new Error(`Unexpected project state ${String(state)}`);
  }
  if (mode === "pagination") {
    // The first two calls reproduce the old protocol question. The third checks strict args.
    const positions = new Set<string>();
    let offset = 0;
    let returned = 0;
    for (;;) {
      const page = await call("symbol", { project: root, name: "many", limit: 500, offset });
      if (page.isError) throw new Error("Reference page failed");
      const refs = page.data?.references as { byFile: { path: string; at: string[] }[]; nextOffset?: number; total: number; stored: number } | undefined;
      if (!refs) throw new Error("No reference locations in symbol answer");
      for (const file of refs.byFile) for (const at of file.at) { returned++; positions.add(file.path + ":" + at); }
      if (refs.nextOffset === undefined) break;
      if (refs.nextOffset <= offset) throw new Error("Reference cursor did not advance");
      offset = refs.nextOffset;
    }
    await call("symbol", { project: root, name: "many", limit: 500, offset: 2500 });
    write(out, "pagination-summary.json", { expected: 3_000, returned, unique: positions.size,
      complete: returned === 3_000 && positions.size === 3_000 });
    if (returned !== 3_000 || positions.size !== 3_000) process.exitCode = 1;
  } else {
    for (const [name, input] of [
      ["search_symbols", { query: "analyzeTypeScript", limit: 5 }],
      ["symbol", { name: "analyzeTypeScript", impact_depth: 3 }],
      ["symbol", { name: "run", limit: 3 }],
      ["search_symbols", { unused_kind: "unreferenced", limit: 10 }],
      ["seams", { path: "src/core/ts", limit: 5 }],
      ["seam", { path: "src/core/ts", limit: 8 }],
      ["symbol", { path: "src/core/ts/index.ts", line: 53 }],
    ] as const) await call(name, { project: root, ...input });
  }
  await call("close", { project: root });
} finally {
  write(out, mode === "pagination" ? "pagination-mcp.json" : "mcp.json", portable(records, [[root, "."], [checkout, "<checkout>"]]));
  await client.close();
}
