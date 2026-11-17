import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { freshOutput } from "./paths.ts";
import { renderChart } from "./chart.ts";

// Synthetic event fixtures check the counters without launching an agent or server.
const outIndex = process.argv.indexOf("--out");
if (outIndex < 0 || !process.argv[outIndex + 1])
  throw new Error("Usage: bun selfcheck.ts --out NEW_DIR");
const root = freshOutput(process.argv[outIndex + 1]!, []);
const dir = join(root, "raw");
mkdirSync(dir);
const json = (name: string, value: any) =>
  writeFileSync(join(dir, name), JSON.stringify(value));
const jsonl = (name: string, values: any[]) =>
  writeFileSync(
    join(dir, name),
    values.map((v) => JSON.stringify(v)).join("\n") + "\n",
  );
const item = (event: string, type: string, id: string, extra: any = {}) => ({
  type: event,
  item: { type, id, ...extra },
});
json("prompts.json", { prompts: [] });
json("results.json", {
  repository: { url: "synthetic", commit: "synthetic", files: 0, commits: 0 },
  arms: { codex: {}, claude: {} },
  limitations: ["Synthetic parser test only."],
  sessions: [
    {
      arm: "codex",
      id: "fixture",
      control: false,
      state: "completed",
      exitCode: 0,
      wallSeconds: 1,
      tools: [],
    },
    {
      arm: "claude",
      id: "fixture",
      control: false,
      state: "completed",
      exitCode: 0,
      wallSeconds: 2,
      tools: [],
    },
  ],
});
json("grades.json", {
  codex: {
    fixture: { grade: "correct", gradeReason: "Synthetic grade application." },
  },
});
jsonl("codex-fixture.events.jsonl", [
  item("item.started", "command_execution", "a", { command: "rg x" }),
  item("item.completed", "command_execution", "a", { command: "rg x" }),
  item("item.started", "mcp_tool_call", "b", {
    server: "skyplate",
    tool: "open",
    arguments: { path: "/synthetic" },
  }),
  item("item.completed", "mcp_tool_call", "b", {
    server: "skyplate",
    tool: "open",
    arguments: { path: "/synthetic" },
  }),
  item("item.started", "todo_list", "c", {
    items: [{ text: "inspect", completed: false }],
  }),
  item("item.updated", "todo_list", "c", {
    items: [{ text: "inspect", completed: true }],
  }),
  item("item.completed", "todo_list", "c", {
    items: [{ text: "inspect", completed: true }],
  }),
  item("item.completed", "file_change", "d", { changes: [] }),
  item("item.started", "collab_tool_call", "e", { tool: "spawn_agent" }),
  item("item.completed", "collab_tool_call", "e", { tool: "spawn_agent" }),
  item("item.started", "web_search", "f", { query: "synthetic" }),
  item("item.completed", "web_search", "f", { query: "synthetic" }),
  item("item.completed", "agent_message", "g", {
    text: "Codex fixture answer",
  }),
  { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } },
]);
jsonl("claude-fixture.events.jsonl", [
  {
    type: "system",
    subtype: "init",
    model: "fixture-model",
    permissionMode: "manual",
    mcp_servers: [{ name: "skyplate", status: "connected" }],
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "a",
          name: "Read",
          input: { file_path: "x.ts" },
        },
        {
          type: "tool_use",
          id: "b",
          name: "mcp__skyplate__file",
          input: { path: "x.ts" },
        },
      ],
    },
  },
  {
    type: "result",
    is_error: false,
    result: "Claude fixture answer",
    usage: { input_tokens: 50, output_tokens: 10 },
  },
]);
for (const arm of ["codex", "claude"])
  jsonl(`${arm}-fixture.mcp.jsonl`, [
    {
      at: "synthetic",
      direction: "request",
      message: {
        method: "tools/call",
        params: { name: arm === "codex" ? "open" : "file", arguments: {} },
      },
    },
  ]);
const summary = join(root, "summary");
const r = spawnSync(
  process.execPath,
  [
    join(import.meta.dir, "run.ts"),
    "--out",
    summary,
    "--summarize",
    dir,
    "--reparse",
  ],
  { encoding: "utf8" },
);
assert.equal(r.status, 0, r.stderr);
const result = JSON.parse(readFileSync(join(summary, "results.json"), "utf8"));
const [codex, claude] = result.sessions;
assert.equal(codex.tools.length, 7);
assert.equal(codex.firstSkyplatePosition, 2);
assert.equal(codex.skyplateCalls, 1);
assert.equal(codex.shellSearchCalls, 2);
assert.equal(codex.finalAnswer, "Codex fixture answer");
assert.equal(codex.grade, "correct");
assert.equal(codex.eventWireCountsMatch, true);
assert.equal(claude.tools.length, 2);
assert.equal(claude.firstSkyplatePosition, 2);
assert.equal(claude.eventWireCountsMatch, true);
assert.equal(claude.observedSession.model, "fixture-model");
assert.equal(claude.finalAnswer, "Claude fixture answer");
assert.equal(result.arms.codex.statistics.used, 1);
assert.match(
  readFileSync(join(summary, "summary.md"), "utf8"),
  /\| codex \| fixture/,
);
const cold = join(root, "cold");
const source = join(root, "source"),
  repository = join(root, "repository");
mkdirSync(source);
mkdirSync(join(source, "bin"));
mkdirSync(repository);
const fake = join(source, "bin", "skyplate.ts");
writeFileSync(
  fake,
  `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(m.id === undefined)return;
 let result;
 if(m.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
 else if(m.method==='tools/list')result={tools:[]};
 else result={content:[{type:'text',text:JSON.stringify(m.params.name==='open'?{project:{state:'analyzing'}}:{state:'ready'})}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`,
);
const coldRun = spawnSync(
  process.execPath,
  [
    join(import.meta.dir, "run.ts"),
    "--skyplate",
    source,
    "--repo",
    repository,
    "--prompts",
    join(dir, "prompts.json"),
    "--out",
    cold,
    "--cold-only",
  ],
  { encoding: "utf8" },
);
assert.equal(coldRun.status, 0, coldRun.stderr);
const coldResult = JSON.parse(readFileSync(join(cold, "results.json"), "utf8"));
assert.equal(coldResult.coldOpen.response.state, "ready");
assert.equal(typeof coldResult.coldOpen.readySeconds, "number");
assert.deepEqual(coldResult.sessions, []);
// Exercise the proxy boundary independently of its advertised tool list.
const proxyClient = new Client({ name: "adoption-selfcheck", version: "1" });
try {
  await proxyClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        join(import.meta.dir, "run.ts"),
        "--proxy",
        fake,
        join(root, "proxy.mcp.jsonl"),
      ],
      cwd: repository,
    }),
  );
  for (const name of ["build_report", "serve_report", "benchmark"]) {
    const denied = await proxyClient.callTool({ name, arguments: {} });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied.content), /experiment is read-only/);
  }
} finally {
  await proxyClient.close();
}
assert.throws(() => freshOutput(cold, []), /must not exist/);
assert.throws(() => freshOutput(join(source, "nested"), [source]), /outside/);
const alias = join(dir, "alias");
symlinkSync(source, alias);
assert.throws(() => freshOutput(join(alias, "nested"), [source]), /outside/);
assert.equal(existsSync(join(source, "nested")), false);
// A summary of public records must work without transcripts or an agent binary.
const publicSource = resolve(import.meta.dir, "../results/2026-11-16/baseline");
const publicOut = join(root, "public-summary");
const publicRun = spawnSync(
  process.execPath,
  [
    join(import.meta.dir, "run.ts"),
    "--summarize",
    publicSource,
    "--out",
    publicOut,
  ],
  { encoding: "utf8" },
);
assert.equal(publicRun.status, 0, publicRun.stderr);
const historical = JSON.parse(
  readFileSync(join(publicOut, "results.json"), "utf8"),
);
assert.equal(historical.arms.codex.statistics.taskUses, 0);
assert.equal(historical.arms.claude.statistics.taskUses, 3);
const chart = renderChart(historical);
assert.match(chart, /<svg role="img"/);
assert.match(chart, /<caption>/);
assert.match(chart, /scope="col"/);
console.log(
  `Parser, summary, path isolation, chart, proxy denial and pending-open checks passed. Synthetic fixtures retained at ${dir}`,
);
