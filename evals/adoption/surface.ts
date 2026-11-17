#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { realpathSync } from "node:fs";
import { join } from "node:path";

// Listing never opens a project or starts an analysis. JSON.stringify(array).length
// matches the historical measurement, in UTF-16 code units, with no RPC envelope.
export async function measureSurface(checkout: string) {
  const source = realpathSync(checkout);
  const client = new Client({
    name: "skyplate-adoption-surface",
    version: "1",
  });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(source, "bin", "skyplate.ts"), "mcp"],
        cwd: source,
        stderr: "inherit",
      }),
    );
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return {
      toolCount: tools.length,
      toolsListChars: JSON.stringify(tools).length,
      instructionsChars: (client.getInstructions() ?? "").length,
      tools: tools.map((tool) => ({
        name: tool.name,
        descriptionChars: (tool.description ?? "").length,
      })),
      unit: "UTF-16 code units; compact JSON array for tools/list; instructions text only",
    };
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  const checkout = process.argv[2];
  if (!checkout || process.argv.length !== 3)
    throw new Error("Usage: bun evals/adoption/surface.ts CHECKOUT");
  console.log(JSON.stringify(await measureSurface(checkout), null, 2));
}
