/**
 * `skyplate serve <dir>`: a static file server for a report folder.
 *
 * A report opens straight from disk, so this exists for the cases file:// cannot cover:
 * opening it from another machine, browsers or policies that lock file:// down, and --open
 * right after a run. Every response is no-cache, so re-running the CLI into the same folder
 * shows the new report on reload instead of a mix of old and new data files.
 *
 * Paths are decoded, resolved and refused unless they stay inside the folder: the URL parser
 * already folds "/../", but an encoded slash ("..%2F..%2F") only becomes a separator after
 * decoding, which is exactly when the check has to run.
 */

import { existsSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { NOTICE_FILES } from "../core/site";

const NOTICE_NAMES = new Set<string>(NOTICE_FILES);

export interface StaticServer {
  url: string;
  port: number;
  stop(): void;
}

export function resolveInside(root: string, pathname: string): string | undefined {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return undefined; // malformed escape
  }
  if (rel.includes("\0")) return undefined;
  const file = resolve(root, "." + (rel.startsWith("/") ? rel : `/${rel}`));
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  return file;
}

export function startServer(dir: string, port: number | undefined): StaticServer {
  const root = resolve(dir);
  const handler = async (req: Request): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const file = resolveInside(root, new URL(req.url).pathname);
    if (!file) return new Response("Forbidden", { status: 403 });
    let target = file;
    try {
      if (statSync(target).isDirectory()) target = join(target, "index.html");
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const blob = Bun.file(target);
    if (!(await blob.exists())) return new Response("Not found", { status: 404 });
    // LICENSE, NOTICE and THIRD_PARTY_NOTICES have no extension (the conventional names), so Bun
    // types them application/octet-stream and a browser downloads them instead of showing them;
    // the About panel links to them, and a reader clicking "licenses" expects to read them.
    const type = NOTICE_NAMES.has(basename(target)) ? "text/plain; charset=utf-8" : blob.type || "application/octet-stream";
    return new Response(req.method === "HEAD" ? null : blob, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-cache",
        "Content-Length": String(blob.size),
      },
    });
  };
  const listen = (p: number) => Bun.serve({ port: p, hostname: "127.0.0.1", fetch: handler });
  let server: ReturnType<typeof listen>;
  try {
    server = listen(port ?? 4747);
  } catch (e) {
    // The default port being taken (a second report open) is not worth an error; an explicit
    // --port is, since the user may have a reason for that number.
    if (port !== undefined) throw e;
    server = listen(0);
  }
  return { url: `http://localhost:${server.port}/`, port: server.port!, stop: () => server.stop(true) };
}

/** Opens a URL in the default browser. */
export function openInBrowser(url: string): boolean {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

export function isReportDir(dir: string): boolean {
  return existsSync(join(dir, "index.html"));
}
