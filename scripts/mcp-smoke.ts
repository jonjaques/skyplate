/**
 * Smoke-test an installed `skyplate mcp` over real stdio, the way a client starts it.
 *
 *   bun scripts/mcp-smoke.ts <skyplate-binary> <project-dir>
 *
 * CI runs it against the packed tarball (see .github/workflows/ci.yml): test/mcp.test.ts
 * drives the server in process, so it cannot see a runtime dependency missing from the
 * package, a broken stdio entry, or a server that outlives its client. This speaks raw
 * newline-delimited JSON-RPC and imports nothing from the checkout, so what it exercises is
 * only what the package ships.
 */

const [bin, project] = process.argv.slice(2);
if (!bin || !project) {
  console.error("usage: bun scripts/mcp-smoke.ts <skyplate-binary> <project-dir>");
  process.exit(2);
}

const proc = Bun.spawn([bin, "mcp"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
const waiting = new Map<number, (msg: any) => void>();
let nextId = 1;

(async () => {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of proc.stdout) {
    buffered += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line); // anything but JSON on stdout corrupts the protocol
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
    }
  }
})();

function fail(message: string): never {
  console.error(`mcp smoke: ${message}`);
  proc.kill();
  process.exit(1);
}

function request(method: string, params: unknown, seconds = 60): Promise<any> {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  proc.stdin.flush();
  return new Promise((resolve) => {
    const timer = setTimeout(() => fail(`${method} got no answer in ${seconds} s`), seconds * 1000);
    waiting.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) fail(`${method}: ${JSON.stringify(msg.error)}`);
      resolve(msg.result);
    });
  });
}

const init = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "skyplate-smoke", version: "0" } });
if (init.serverInfo?.name !== "skyplate") fail(`unexpected server ${JSON.stringify(init.serverInfo)}`);
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const { tools } = await request("tools/list", {});
const names = tools.map((t: { name: string }) => t.name);
for (const want of ["open", "symbol", "build_report"]) if (!names.includes(want)) fail(`tools/list has no ${want}: ${names.join(", ")}`);

const opened = await request("tools/call", { name: "open", arguments: { path: project, wait_seconds: 120 } }, 150);
const text = opened.content?.[0]?.text ?? "";
if (opened.isError || JSON.parse(text).project?.state !== "ready") fail(`open did not finish: ${text.slice(0, 400)}`);
const sym = await request("tools/call", { name: "search_symbols", arguments: {} });
if (sym.isError) fail(`search_symbols: ${sym.content?.[0]?.text}`);

// Closing stdin is how a client says goodbye; a server still running after it leaks.
proc.stdin.end();
const code = await Promise.race([proc.exited, Bun.sleep(5000).then(() => "timeout")]);
if (code === "timeout") fail("the server kept running after its stdin closed");
console.log(`mcp smoke: ${names.length} tools, opened ${project}, exited ${code}`);
process.exit(0);
