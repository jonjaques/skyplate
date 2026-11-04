/**
 * Galaxy dev harness server: the plate alone, against any report folder, with hot reload.
 *
 *   PORT=4321 SKYPLATE_REPORT=path/to/report bun --hot src/viewer/galaxy/dev/serve.ts
 *
 * Dev-only: nothing here is imported by the viewer, so the production bundle never sees it.
 * It exists so the galaxy can be built and measured while the shell around it is still being
 * written, and so it can be driven from the console (window.__viewer is the store).
 */

import { serve } from "bun";
import path from "node:path";
import harness from "./harness.html";

const reportDir = path.resolve(process.env.SKYPLATE_REPORT ?? ".skyplate/dev");
const port = Number(process.env.PORT ?? 4321);

const server = serve({
  port,
  routes: {
    "/data/*": async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const file = path.resolve(reportDir, rel);
      if (!file.startsWith(reportDir + path.sep)) return new Response("Not found", { status: 404 });
      const blob = Bun.file(file);
      if (!(await blob.exists())) return new Response("Not found", { status: 404 });
      return new Response(blob, { headers: { "Cache-Control": "no-store" } });
    },
    "/*": harness,
  },
  development: { hmr: true, console: true },
});

console.log(`galaxy harness at ${server.url} (report data from ${reportDir})`);
