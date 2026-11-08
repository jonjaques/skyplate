/**
 * `skyplate mcp`: the MCP server on stdio, for coding agents.
 *
 *   skyplate mcp [path...] [--refresh on_read|on_change|manual] [analysis options]
 *
 * Registered with a client as a command, e.g. `claude mcp add skyplate -- bunx skyplate mcp`.
 * Paths given here are opened at startup, so an agent's first question about the project it
 * runs in does not wait for the analysis to begin.
 *
 * stdout carries the protocol and nothing else may write to it; diagnostics go to stderr,
 * which clients keep as the server's log. When the client closes stdin the server exits at
 * once: watchers, report servers and a running analysis's workers would otherwise keep the
 * process alive with nobody left to answer.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { McpCommand } from "../cli/args";
import { createServer } from "./server";
import { Workspace } from "./workspace";

export async function runMcp(cmd: McpCommand): Promise<number> {
  const ws = new Workspace();
  for (const path of cmd.paths) {
    // A bad startup path is the configuration's mistake: fail loudly, before any client connects.
    await ws.open(path, { options: cmd.options, refresh: cmd.refresh });
  }
  const handle = serveStdio(() => createServer(ws), {
    onerror: (e) => process.stderr.write(`skyplate mcp: ${e.message}\n`),
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    ws.shutdown();
    void handle.close().finally(() => process.exit(0));
    // close() waits on nothing slow, but a wedged transport must not keep the process alive.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return await new Promise<number>(() => {});
}
