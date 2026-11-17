import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { args, checkout, freshOut, json, required } from "./io";

const values = args(["--project", "--out"]);
const project = resolve(required(values, "--project"));
const out = freshOut(required(values, "--out"), [project]);
const questions = await Bun.file(join(import.meta.dir, "fixtures/questions.json")).json() as { name: string; args: Record<string, unknown> }[];
const client = new Client({ name: "structure-eval", version: "1" });
const rows = [];
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(checkout, "bin/skyplate.ts"), "mcp"], cwd: project }));
  for (const question of questions) {
    const started = performance.now();
    const argv = question.name === "open" ? { ...question.args, path: project } : question.args;
    const result = await client.callTool({ name: question.name, arguments: argv }, { timeout: 150000 });
    // Answers contain public author names and paths; runtime results stay in the selected output.
    rows.push({ name: question.name, args: question.args, ms: performance.now() - started, result });
  }
} finally {
  await client.close();
}
json(join(out, "mcp.json"), rows);
console.log(`Recorded ${rows.length} calls and closed the client`);
