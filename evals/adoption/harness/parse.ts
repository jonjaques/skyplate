import { existsSync, readFileSync } from "node:fs";
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const lines = (file: string) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(safeJson)
        .filter(Boolean)
    : [];
const brief = (a: any) =>
  (typeof a === "string" ? a : JSON.stringify(a ?? {}))
    .replace(/\s+/g, " ")
    .slice(0, 240);
export function parseSession(arm: string, prefix: string) {
  const events = lines(prefix + ".events.jsonl"),
    wire = lines(prefix + ".mcp.jsonl");
  const tools: any[] = [],
    seen = new Set<string>();
  let finalAnswer = "",
    usage: any = null,
    completed = false,
    observedSession: any = null;
  for (const e of events) {
    if (arm === "codex") {
      const item = e.item;
      if (e.type === "turn.completed") {
        usage = e.usage;
        completed = true;
      }
      if (item?.type === "agent_message" && e.type === "item.completed")
        finalAnswer = item.text ?? finalAnswer;
      if (
        !item ||
        !["item.started", "item.updated", "item.completed"].includes(e.type)
      )
        continue;
      const type = item.type;
      if (["agent_message", "reasoning", "error"].includes(type)) continue;
      // Plan updates reuse one item ID; completion can repeat the last update.
      const key =
        type === "todo_list"
          ? `${item.id}:${JSON.stringify(item.items)}`
          : (item.id ?? JSON.stringify(item));
      if (seen.has(key)) continue;
      seen.add(key);
      const isSkyplate = type === "mcp_tool_call" && item.server === "skyplate";
      tools.push({
        id: key,
        name:
          type === "command_execution"
            ? "shell"
            : type === "mcp_tool_call"
              ? `mcp__${item.server}__${item.tool}`
              : type === "todo_list"
                ? "update_plan"
                : type === "file_change"
                  ? "apply_patch"
                  : (item.name ?? item.tool ?? type),
        arguments: item.arguments ?? item.command ?? item.query ?? item,
        argumentSummary: brief(
          item.arguments ?? item.command ?? item.query ?? item.items ?? item,
        ),
        skyplate: isSkyplate,
        shellSearch: type === "command_execution" || type === "web_search",
        observation: e.type,
      });
    } else {
      if (e.type === "system" && e.subtype === "init")
        observedSession = {
          model: e.model,
          permissionMode: e.permissionMode,
          mcpServers: e.mcp_servers,
          tools: e.tools,
        };
      if (e.type === "assistant")
        for (const c of e.message?.content ?? []) {
          if (c.type === "text") finalAnswer = c.text;
          if (c.type === "tool_use" && !seen.has(c.id)) {
            seen.add(c.id);
            tools.push({
              id: c.id,
              name: c.name,
              arguments: c.input,
              argumentSummary: brief(c.input),
              skyplate: c.name.startsWith("mcp__skyplate__"),
              shellSearch: ["Bash", "Grep", "Glob", "WebSearch"].includes(
                c.name,
              ),
              observation: "assistant.tool_use",
            });
          }
        }
      if (e.type === "result") {
        completed = !e.is_error;
        finalAnswer = e.result ?? finalAnswer;
        usage = {
          ...e.usage,
          modelUsage: e.modelUsage,
          totalCostUsd: e.total_cost_usd,
        };
      }
    }
  }
  // Wire logs are an independent check, not a second count of the same MCP call.
  const calls = wire.filter(
    (e) => e.direction === "request" && e.message?.method === "tools/call",
  );
  return {
    tools,
    finalAnswer,
    tokenUsage: usage,
    observedSession,
    completed,
    mcpWireCalls: calls.map((e) => ({
      at: e.at,
      name: e.message.params.name,
      arguments: e.message.params.arguments,
    })),
    eventWireCountsMatch:
      tools.filter((t) => t.skyplate).length === calls.length,
    rawEventTypes: [...new Set(events.map((e) => e.type))],
  };
}
