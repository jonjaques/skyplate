import { join, resolve } from "node:path";
import { args, checkout, freshOut, json, metadata, required } from "../structure/io";

const values = args(["--project", "--out", "--query", "--timeout-seconds", "--stop-after-first"]);
const project = resolve(required(values, "--project"));
const timeoutSeconds = Number(values.get("--timeout-seconds") ?? 900);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) throw new Error("--timeout-seconds must be positive");
if (values.has("--stop-after-first") && values.get("--stop-after-first") !== "true") throw new Error("--stop-after-first accepts true");
const out = freshOut(required(values, "--out"), [project]);
const query = values.get("--query") ?? "source";
const started = performance.now();
const elapsed = () => performance.now() - started;
const proc = Bun.spawn([process.execPath, join(checkout, "bin/skyplate.ts"), "mcp"], { cwd: project, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(proc.stderr).text();
interface RpcResult {
  isError?: boolean;
  serverInfo?: { name?: string };
  structuredContent?: { data?: Record<string, unknown>; freshnessNote?: string };
}
interface ResponseMessage { id?: number; result?: RpcResult; error?: unknown }
const waiting = new Map<number, { resolve: (result: RpcResult) => void; reject: (error: Error) => void }>();
let nextId = 1;
let protocolError: string | null = null;
const reader = (async () => {
  let buffered = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as ResponseMessage;
        if (msg.id === undefined) continue;
        const pending = waiting.get(msg.id);
        if (!pending) continue;
        waiting.delete(msg.id);
        if (msg.error) pending.reject(new Error("JSON-RPC error"));
        else pending.resolve(msg.result ?? {});
      }
    }
    if (buffered.trim()) throw new Error("Incomplete JSON-RPC line");
  } catch {
    protocolError = "Invalid JSON-RPC output";
  } finally {
    for (const pending of waiting.values()) pending.reject(new Error(protocolError ?? "Server closed before answering"));
    waiting.clear();
  }
})();
function request(method: string, params: unknown): Promise<RpcResult> {
  const id = nextId++;
  const remaining = timeoutSeconds * 1000 - elapsed();
  if (remaining <= 0) throw new Error("Measurement deadline exceeded");
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("Measurement deadline exceeded")); }, remaining);
    waiting.set(id, { resolve: (result) => { clearTimeout(timer); resolveResult(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    proc.stdin.flush();
  });
}
const calls: { tool: string; callMs: number; sinceStartMs: number; partial: boolean; state: unknown }[] = [];
async function ask(name: string, argv: Record<string, unknown>) {
  const before = elapsed();
  const result = await request("tools/call", { name, arguments: argv });
  if (result.isError) throw new Error(`MCP ${name} returned a tool error`);
  const data = result.structuredContent?.data;
  if (!data) throw new Error(`MCP ${name} had no structured data`);
  calls.push({ tool: name, callMs: elapsed() - before, sinceStartMs: elapsed(), partial: /structure pass/i.test(result.structuredContent?.freshnessNote ?? ""), state: data.state ?? null });
  return data;
}
let failure: string | null = null;
let fullReadyObservedMs: number | null = null;
let historyState: unknown = null;
let firstStatus: unknown = null;
try {
  const init = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "first-answer-eval", version: "1" } });
  if (init.serverInfo?.name !== "skyplate") throw new Error("Unexpected MCP server");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  let map = await ask("map_codebase", { project, depth: 1, token_budget: 800 });
  while (map.state === "analyzing") {
    await ask("status", { project, wait_seconds: 1 });
    map = await ask("map_codebase", { project, depth: 1, token_budget: 800 });
  }
  let locate = await ask("locate_code", { project, query, content: false, limit: 3 });
  while (locate.state === "analyzing") {
    await ask("status", { project, wait_seconds: 1 });
    locate = await ask("locate_code", { project, query, content: false, limit: 3 });
  }
  historyState = (await ask("history", { project, view: "summary", wait_seconds: 0 })).state ?? "ready";
  let status = await ask("status", { project, wait_seconds: 0 });
  const state = (value: Record<string, unknown>) => {
    const projects = value.projects as { state?: string; partial?: string; files?: number; job?: { state?: string; elapsed?: number } }[] | undefined;
    const row = projects?.[0] ?? value as { state?: string; partial?: string; files?: number; job?: { state?: string; elapsed?: number } };
    return row ? { state: row.state, partial: !!row.partial, files: row.files, job: row.job ? { state: row.job.state, elapsed: row.job.elapsed } : null } : undefined;
  };
  firstStatus = state(status);
  const complete = (value: Record<string, unknown>) => ["ready", "stale"].includes(state(value)?.state ?? "") && !state(value)?.partial;
  while (!complete(status) && !values.has("--stop-after-first")) {
    if (state(status)?.state === "failed") throw new Error("Full analysis failed");
    status = await ask("status", { project, wait_seconds: 1 });
  }
  if (complete(status)) fullReadyObservedMs = elapsed();
} catch (error) {
  failure = error instanceof Error ? error.message : "Unknown client failure";
} finally {
  const shutdownAt = elapsed();
  proc.stdin.end();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exit = await Promise.race([proc.exited, new Promise<null>((resolveResult) => { timer = setTimeout(() => resolveResult(null), 5000); })]);
  clearTimeout(timer);
  if (exit === null) { proc.kill(); await proc.exited; }
  await reader;
  const stderrText = await stderr;
  const first = (tool: string) => calls.find((c) => c.tool === tool && c.state !== "analyzing") ?? null;
  const result = { ...metadata(project), query, coldProcess: true, cacheState: "OS and filesystem caches uncontrolled", calls, firstMap: first("map_codebase"), firstLocate: first("locate_code"), historyState, firstStatus, fullReadyObservedMs, stoppedAfterFirst: values.has("--stop-after-first"), shutdown: { exitCode: exit, clean: exit === 0, forced: exit === null, ms: elapsed() - shutdownAt, stderrBytes: Buffer.byteLength(stderrText), protocolError }, failure };
  json(join(out, "timing.json"), result);
  console.log(JSON.stringify({ firstMap: result.firstMap, firstLocate: result.firstLocate, fullReadyObservedMs, shutdown: result.shutdown, failure }));
  if (failure || exit !== 0 || protocolError) process.exitCode = 1;
}
