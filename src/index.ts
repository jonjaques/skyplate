/**
 * Development server: the viewer with hot reload, plus a report folder's data files.
 *
 *   bun dev                                  # serves .skyplate/dev (write one with the CLI)
 *   SKYPLATE_REPORT=path/to/report bun dev  # serves any report folder's data
 *
 * The viewer always requests data relative to the page ("data/report.js"), exactly as it does
 * from a built report folder, so dev and production exercise the same loading path.
 */

import { serve } from "bun";
import path from "node:path";
import index from "./viewer/index.html";

const reportDir = path.resolve(process.env.SKYPLATE_REPORT ?? ".skyplate/dev");
const port = Number(process.env.PORT ?? 4317);

const server = serve({
  port,
  routes: {
    "/data/*": async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const file = path.resolve(reportDir, rel);
      // Refuse anything that escapes the report folder (../ in the URL).
      if (!file.startsWith(reportDir + path.sep)) return new Response("Not found", { status: 404 });
      const blob = Bun.file(file);
      if (!(await blob.exists())) return new Response("Not found", { status: 404 });
      return new Response(blob, { headers: { "Cache-Control": "no-store" } });
    },
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`skyplate dev server at ${server.url} (report data from ${reportDir})`);
