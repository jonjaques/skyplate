#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { parseSession } from "./parse.ts";
import { summarize } from "./summary.ts";
import { freshOutput, checkoutEntry } from "./paths.ts";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

// The child is detached into a group owned by this invocation. Escalate even when
// its leader exited first, since an MCP descendant can still hold a pipe open.
async function terminateGroup(pid: number | undefined) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise((res) => setTimeout(res, 250));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

// The proxy records actual wire calls and owns its server. It preserves the server's
// instructions and tool definitions; report-writing and HTTP-serving calls fail closed.
if (process.argv[2] === "--proxy") {
  const [, , , entry, log] = process.argv;
  const server = spawn(process.execPath, [entry!, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const record = (direction: string, message: any) =>
    appendFileSync(
      log!,
      JSON.stringify({ at: new Date().toISOString(), direction, message }) +
        "\n",
    );
  record("lifecycle", { proxyPid: process.pid, serverPid: server.pid, entry });
  const shutdown = () => {
    server.stdin.end();
    if (server.exitCode === null) server.kill("SIGTERM");
  };
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("exit", shutdown);
  server.stderr.on("data", (b) => appendFileSync(log! + ".stderr", b));
  createInterface({ input: process.stdin })
    .on("line", (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      record("request", message);
      if (
        message.method === "tools/call" &&
        ["build_report", "serve_report", "benchmark"].includes(
          message.params?.name,
        )
      ) {
        const denied = {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "This experiment is read-only. Writing reports and starting HTTP servers are not permitted.",
              },
            ],
          },
        };
        record("response", denied);
        process.stdout.write(JSON.stringify(denied) + "\n");
      } else server.stdin.write(line + "\n");
    })
    .on("close", shutdown);
  createInterface({ input: server.stdout }).on("line", (line) => {
    try {
      record("response", JSON.parse(line));
    } catch {
      record("invalid", line);
    }
    process.stdout.write(line + "\n");
  });
  server.on("error", (e) => {
    record("error", String(e));
    process.exit(1);
  });
  server.on("exit", (code) => {
    record("exit", { code });
    process.exit(code ?? 1);
  });
  await new Promise(() => {});
}

const argv = process.argv.slice(2);
const valueFlags = [
  "--out",
  "--skyplate",
  "--skyplate-ref",
  "--repo",
  "--prompts",
  "--subset",
  "--arms",
  "--codex",
  "--claude",
  "--summarize",
];
const switches = [
  "--reparse",
  "--cold-only",
  "--codex-repository-instructions",
];
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i]!;
  if (valueFlags.includes(flag)) {
    if (!argv[i + 1] || argv[i + 1]!.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    i++;
  } else if (!switches.includes(flag))
    throw new Error(`Unknown option: ${flag}`);
}
const option = (key: string, fallback?: string) => {
  const i = argv.indexOf(key);
  return i < 0 ? fallback : argv[i + 1];
};
const outArg = option("--out");
if (!outArg)
  throw new Error(
    "Usage: bun run.ts --skyplate CHECKOUT --repo REPO --out NEW_DIR [--arms codex,claude] [--prompts FILE] [--codex BIN] [--claude BIN] [--subset id,id] [--codex-repository-instructions] [--cold-only] | --summarize RESULTS_DIR --out NEW_DIR [--reparse]",
  );
const self = resolve(import.meta.path);
const summaryInput = option("--summarize");
if (summaryInput) {
  const input = resolve(summaryInput);
  const output = freshOutput(outArg, [input]);
  const result = JSON.parse(readFileSync(join(input, "results.json"), "utf8"));
  const gradeFile = join(input, "grades.json");
  if (existsSync(gradeFile))
    writeFileSync(join(output, "grades.json"), readFileSync(gradeFile));
  if (argv.includes("--reparse"))
    for (const s of result.sessions) {
      if (
        !["codex", "claude"].includes(s.arm) ||
        !/^[a-zA-Z0-9][\w-]*$/.test(s.id)
      )
        throw new Error("Invalid session selector.");
      const prefix = join(input, `${s.arm}-${s.id}`);
      if (!existsSync(prefix + ".events.jsonl"))
        throw new Error(
          "--reparse needs private transcripts; omit it for public results.",
        );
      const parsed = parseSession(s.arm, prefix);
      Object.assign(s, parsed);
      const i = parsed.tools.findIndex((t) => t.skyplate);
      s.firstSkyplatePosition = i < 0 ? null : i + 1;
      s.skyplateCalls = parsed.tools.filter((t) => t.skyplate).length;
      s.shellSearchCalls = parsed.tools.filter((t) => t.shellSearch).length;
    }
  summarize(result, output);
  process.exit(0);
}
const sourceArg = option("--skyplate"),
  repoArg = option("--repo");
if (!sourceArg || !repoArg)
  throw new Error(
    "--skyplate CHECKOUT and --repo REPO are required for a run.",
  );
const source = resolve(sourceArg),
  skyplate = checkoutEntry(source),
  repository = resolve(repoArg);
const output = freshOutput(outArg, [source, repository]);
const promptsPath = resolve(
  option("--prompts") ?? join(import.meta.dir, "prompts.json"),
);
const spec = JSON.parse(readFileSync(promptsPath, "utf8"));
if (
  !Array.isArray(spec.prompts) ||
  spec.prompts.some(
    (p: any) =>
      !/^[a-zA-Z0-9][\w-]*$/.test(p.id) || typeof p.prompt !== "string",
  ) ||
  new Set(spec.prompts.map((p: any) => p.id)).size !== spec.prompts.length
)
  throw new Error("Prompts need unique path-safe ids and prompt text.");
const subset = option("--subset")?.split(",");
if (subset?.some((id) => !spec.prompts.some((p: any) => p.id === id)))
  throw new Error("Unknown prompt in --subset.");
const arms = option("--arms", "codex,claude")!.split(",");
if (arms.some((arm) => !["codex", "claude"].includes(arm)))
  throw new Error("--arms accepts codex and claude only.");
const prompts = spec.prompts.filter(
  (p: any) => !subset || subset.includes(p.id),
);
const stamp = () => new Date().toISOString();
const gitAt = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).stdout?.trim() ?? "";
const git = (...args: string[]) => gitAt(repository, ...args);
const sourceGit = (...args: string[]) => gitAt(source, ...args);
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const result: any = {
  version: 1,
  startedAt: stamp(),
  repository: {
    url: git("remote", "get-url", "origin"),
    commit: git("rev-parse", "HEAD"),
    files: git("ls-files").split("\n").filter(Boolean).length,
    commits: Number(git("rev-list", "--count", "HEAD")),
    initialStatus: git("status", "--short"),
  },
  skyplate: {
    ref: option("--skyplate-ref") ?? sourceGit("rev-parse", "HEAD"),
    commit: sourceGit("rev-parse", "HEAD"),
    initialStatus: sourceGit("status", "--short"),
  },
  promptsSha256: createHash("sha256")
    .update(readFileSync(promptsPath))
    .digest("hex"),
  sessions: [],
  arms: {},
  limitations: [
    "One fresh CLI process and stdio server per prompt; filesystem and provider caches are not flushed.",
    "No target dependencies installed. Compiler analysis can be incomplete without them.",
    "The proxy preserves tool definitions but rejects build_report, serve_report and benchmark.",
    "Calls are ordered by observed invocation, not completion. Parallel calls can share timestamps.",
    "Tokens are provider-reported. Correctness grades require separate review.",
    "Global instructions and skills remain in effect. Record their relevant influence separately without publishing their text.",
  ],
};
const save = () =>
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
const summarizeRun = () => summarize(result, output);
writeFileSync(
  join(output, "prompts.json"),
  JSON.stringify(spec, null, 2) + "\n",
);
save();

// Raw JSON-RPC avoids a dependency on the checkout's SDK version.
async function coldOpen() {
  const log = join(output, "cold-open.mcp.jsonl");
  const coldTmp = join(output, "cold-open.tmp");
  mkdirSync(coldTmp);
  const p = spawn(process.execPath, [self, "--proxy", skyplate, log], {
    cwd: repository,
    env: { ...process.env, TMPDIR: coldTmp + "/" },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const signalHandler = () => {
    void terminateGroup(p.pid).finally(() => process.exit(130));
  };
  process.once("SIGINT", signalHandler);
  process.once("SIGTERM", signalHandler);
  const waiting = new Map<number, (v: any) => void>();
  let id = 0;
  const timer = setTimeout(() => {
    if (p.pid) {
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {}
    }
  }, 600_000);
  p.stderr.on("data", (b) =>
    appendFileSync(join(output, "cold-open.stderr"), b),
  );
  createInterface({ input: p.stdout }).on("line", (line) => {
    const m = safeJson(line);
    if (m?.id) waiting.get(m.id)?.(m);
  });
  const request = (method: string, params: any): Promise<any> =>
    new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      });
      p.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
      );
      p.once("exit", () => rej(new Error("MCP server exited before reply")));
    });
  const start = performance.now();
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "skyplate-adoption-eval", version: "1" },
    });
    p.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const listed = await request("tools/list", {});
    writeFileSync(
      join(output, "observed-surface.json"),
      JSON.stringify(
        {
          instructions: init.instructions,
          tools: listed.tools,
          serverInfo: init.serverInfo,
        },
        null,
        2,
      ),
    );
    const openStart = performance.now();
    let opened = await request("tools/call", {
      name: "open",
      arguments: { path: repository },
    });
    const firstResponseSeconds = (performance.now() - openStart) / 1000;
    const parse = (v: any) =>
      safeJson(v.content?.find((c: any) => c.type === "text")?.text ?? "") ?? v;
    let data = parse(opened);
    const readyState = (v: any) =>
      v.state === "ready" ||
      v.project?.state === "ready" ||
      v.projects?.some((p: any) => p.state === "ready");
    while (
      !opened.isError &&
      !readyState(data) &&
      performance.now() - openStart < 580_000
    ) {
      if (data.state === "failed" || data.project?.state === "failed") break;
      opened = await request("tools/call", {
        name: "status",
        arguments: { project: repository, wait_seconds: 45 },
      });
      data = parse(opened);
    }
    const ready = readyState(data);
    result.coldOpen = {
      firstResponseSeconds,
      readySeconds: ready ? (performance.now() - openStart) / 1000 : null,
      startupAndOpenSeconds: (performance.now() - start) / 1000,
      response: data,
      isError: opened.isError ?? false,
    };
  } catch (e) {
    result.coldOpen = { error: String(e) };
  } finally {
    clearTimeout(timer);
    p.stdin.end();
    await terminateGroup(p.pid);
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    await new Promise<void>((res) => {
      if (p.exitCode !== null || p.signalCode !== null) res();
      else p.once("exit", () => res());
    });
  }
  save();
  console.log(
    "cold open",
    result.coldOpen.readySeconds ?? result.coldOpen.error ?? "not ready",
  );
}
await coldOpen();
if (result.coldOpen.readySeconds == null)
  throw new Error("Cold open failed; no agents launched. See results.json.");
if (argv.includes("--cold-only")) {
  result.finishedAt = stamp();
  summarizeRun();
  process.exit();
}

const codexBin = option("--codex") ?? Bun.which("codex") ?? "codex";
const claudeBin = option("--claude") ?? Bun.which("claude") ?? "claude";
const repositoryInstructions = argv.includes("--codex-repository-instructions")
  ? "Before exploring unfamiliar or large areas, use Skyplate `map_codebase` and `locate_code` to choose directories and files, then read the strongest evidence. Before a rename, move, deletion or refactor, use `change_impact` for dependents, test candidates and co-change. After editing, call `change_impact` with `working_tree: true` and run the required checks. Preserve freshness warnings; static test candidates are not proof of coverage."
  : undefined;
if (repositoryInstructions)
  result.repositoryInstructions = {
    delivery: "per-invocation -c developer_instructions",
    text: repositoryInstructions,
    differenceFromAgentsMd:
      "Developer-priority session instructions, not a repository-scoped AGENTS.md discovered from disk; task prompt unchanged.",
  };
const readonly =
  "Read-only investigation. Do not edit or create files in the repository, install dependencies, write reports, start HTTP or dev servers, delegate, or access credentials or external account connectors. Answer the task from repository evidence. Do not launch any child agents.";
for (const arm of arms) {
  if (!["codex", "claude"].includes(arm))
    throw new Error("Unknown arm: " + arm);
  const binary = arm === "codex" ? codexBin : claudeBin;
  const help = spawnSync(
    binary,
    arm === "codex" ? ["exec", "--help"] : ["--help"],
    { encoding: "utf8" },
  );
  writeFileSync(
    join(output, arm + ".help.txt"),
    (help.stdout ?? "") + (help.stderr ?? ""),
  );
  result.arms[arm] = {
    binary,
    version: spawnSync(binary, ["--version"], {
      encoding: "utf8",
    }).stdout?.trim(),
    permissionMode:
      arm === "codex"
        ? "read-only sandbox, approval_policy never"
        : "CLI default; no permission-mode override",
    modelAndEffort: "CLI defaults; no overrides",
    configurationIsolation:
      arm === "codex"
        ? "--ignore-user-config; auth and execpolicy rules retained"
        : "--strict-mcp-config; normal user settings retained",
  };
  if (help.error || help.status !== 0) {
    result.arms[arm].skipReason = String(help.error ?? help.stderr);
    save();
    continue;
  }
  for (const prompt of prompts) {
    const prefix = join(output, `${arm}-${prompt.id}`),
      mcpLog = prefix + ".mcp.jsonl";
    const server = {
      command: process.execPath,
      args: [self, "--proxy", skyplate, mcpLog],
    };
    const configFile = prefix + ".mcp-config.json";
    writeFileSync(
      configFile,
      JSON.stringify({ mcpServers: { skyplate: server } }, null, 2),
    );
    const allowed = [
      "Read",
      "Grep",
      "Glob",
      "Bash(rg *)",
      "Bash(git status *)",
      "Bash(git log *)",
      "Bash(git ls-files *)",
      "Bash(git show *)",
      "Bash(git shortlog *)",
      "Bash(git blame *)",
      "Bash(wc *)",
      "Bash(sed *)",
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(ls *)",
      "Bash(find *)",
    ];
    const surface = JSON.parse(
      readFileSync(join(output, "observed-surface.json"), "utf8"),
    );
    for (const t of surface.tools)
      if (!["build_report", "serve_report", "benchmark"].includes(t.name))
        allowed.push(`mcp__skyplate__${t.name}`);
    const configToml = `mcp_servers={skyplate={command=${JSON.stringify(process.execPath)},args=${JSON.stringify(server.args)},tool_timeout_sec=600}}`;
    const task = prompt.prompt + "\n\n" + readonly;
    const args =
      arm === "codex"
        ? [
            "exec",
            "--ignore-user-config",
            "--json",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "-C",
            repository,
            "-c",
            'approval_policy="never"',
            "-c",
            configToml,
            ...(repositoryInstructions
              ? [
                  "-c",
                  `developer_instructions=${JSON.stringify(repositoryInstructions)}`,
                ]
              : []),
            task,
          ]
        : [
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            configFile,
            "--tools",
            "Read,Grep,Glob,Bash",
            "--allowedTools",
            allowed.join(","),
            "--append-system-prompt",
            readonly,
            task,
          ];
    const sessionTmp = prefix + ".tmp";
    mkdirSync(sessionTmp, { recursive: true });
    writeFileSync(
      prefix + ".invocation.json",
      JSON.stringify(
        {
          binary,
          args,
          cwd: repository,
          environmentOverrides: { TMPDIR: sessionTmp + "/" },
        },
        null,
        2,
      ),
    );
    console.log(`${arm}/${prompt.id} starting ${stamp()}`);
    const start = performance.now();
    const p = spawn(binary, args, {
      cwd: repository,
      env: { ...process.env, TMPDIR: sessionTmp + "/" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    writeFileSync(
      prefix + ".pid.json",
      JSON.stringify({ pid: p.pid, startedAt: stamp() }),
    );
    p.stdout.on("data", (b) => appendFileSync(prefix + ".events.jsonl", b));
    p.stderr.on("data", (b) => appendFileSync(prefix + ".stderr", b));
    let timedOut = false;
    const stop = () => {
      if (p.pid && p.exitCode === null) {
        try {
          process.kill(-p.pid, "SIGTERM");
        } catch {}
      }
    };
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      forceStop = setTimeout(() => {
        if (p.pid && p.exitCode === null) {
          try {
            process.kill(-p.pid, "SIGKILL");
          } catch {}
        }
      }, 5000);
    }, 600_000);
    const signalHandler = () => {
      void terminateGroup(p.pid).finally(() => process.exit(130));
    };
    process.once("SIGINT", signalHandler);
    process.once("SIGTERM", signalHandler);
    const exitCode = await new Promise<number | null>((res) => {
      p.on("exit", res);
      p.on("error", (e) => {
        appendFileSync(prefix + ".stderr", String(e));
        res(null);
      });
    });
    clearTimeout(timer);
    clearTimeout(forceStop);
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    // A CLI can exit before its MCP descendants. The group was created by this run.
    await terminateGroup(p.pid);
    const parsed = parseSession(arm, prefix);
    const position = parsed.tools.findIndex((t) => t.skyplate);
    const session = {
      arm,
      id: prompt.id,
      control: prompt.control ?? false,
      skyplateEntry: skyplate,
      state: timedOut
        ? "timeout"
        : parsed.completed && exitCode === 0
          ? "completed"
          : "failed",
      exitCode,
      wallSeconds: (performance.now() - start) / 1000,
      ...parsed,
      firstSkyplatePosition: position < 0 ? null : position + 1,
      skyplateCalls: parsed.tools.filter((t) => t.skyplate).length,
      shellSearchCalls: parsed.tools.filter((t) => t.shellSearch).length,
      transcript: prefix + ".events.jsonl",
      stderr: prefix + ".stderr",
      grade: null,
    };
    result.sessions.push(session);
    writeFileSync(prefix + ".answer.md", parsed.finalAnswer + "\n");
    summarizeRun();
    console.log(
      `${arm}/${prompt.id} ${session.state}, ${session.tools.length} tools, ${session.wallSeconds.toFixed(1)}s`,
    );
    const errorText =
      (existsSync(prefix + ".stderr")
        ? readFileSync(prefix + ".stderr", "utf8")
        : "") +
      (existsSync(prefix + ".events.jsonl")
        ? readFileSync(prefix + ".events.jsonl", "utf8")
        : "");
    if (
      session.state === "failed" &&
      /cannot be launched inside|nested session|not logged in|authentication|unauthorized|login required|not authenticated|permission.*denied|invalid.*config/i.test(
        errorText,
      )
    ) {
      result.arms[arm].skipReason =
        "CLI refused the first session; see " +
        prefix +
        ".stderr and .events.jsonl. No workaround attempted.";
      break;
    }
  }
}
result.finishedAt = stamp();
result.skyplate.finalStatus = sourceGit("status", "--short");
result.repository.finalStatus = git("status", "--short");
summarizeRun();
