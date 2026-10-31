/**
 * Builds the report viewer into dist/viewer/, the template the CLI copies into every report.
 *
 *   bun run build
 *
 * Output: dist/viewer/index.html, dist/viewer/assets/app.js, app.css, and font files.
 *
 * Why not Bun's HTML entrypoint (which the dev server uses): it emits
 * <script type="module" crossorigin>, and browsers refuse module scripts over file://. A report
 * folder has to open by double-clicking index.html, so the bundle is an IIFE loaded by a plain
 * deferred <script>, and the page is written from src/viewer/index.html with the dev module tag
 * swapped out. Asset URLs stay relative ("assets/…") so the folder also works from any static
 * host and any subpath.
 */

import tailwind from "bun-plugin-tailwind";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dir;
const outdir = path.join(root, "dist", "viewer");
const assets = path.join(outdir, "assets");

await rm(outdir, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(root, "src/viewer/main.tsx")],
  outdir: assets,
  format: "iife",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
  naming: { entry: "app.[ext]", asset: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const template = await Bun.file(path.join(root, "src/viewer/index.html")).text();
const devEntry = /<script type="module" src="\.\/main\.tsx"><\/script>/;
if (!devEntry.test(template)) {
  console.error("src/viewer/index.html no longer has the dev entry tag build.ts replaces.");
  process.exit(1);
}
const html = template
  .replace(/\s*<!-- Development entry\.[^>]*-->/, "")
  .replace(
    devEntry,
    `<link rel="stylesheet" href="assets/app.css" />\n    <script defer src="assets/app.js"></script>`,
  );
await Bun.write(path.join(outdir, "index.html"), html);

let total = 0;
for (const output of result.outputs) {
  total += output.size;
  console.log(` ${path.relative(root, output.path).padEnd(52)} ${(output.size / 1024).toFixed(1)} KB`);
}
console.log(` dist/viewer/index.html`);
console.log(` total ${(total / 1024).toFixed(0)} KB`);
