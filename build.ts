/**
 * Builds the report viewer into dist/viewer/, the template the CLI copies into every report.
 *
 *   bun run build
 *
 * Output: dist/viewer/index.html, dist/viewer/assets/app.js, app.css, font files, and
 * highlight.js (the source reader's lazily loaded highlighter), plus the three notices every
 * report carries: LICENSE and NOTICE (copied from the repository root) and THIRD_PARTY_NOTICES
 * (generated here from what the bundles actually contain; scripts/third-party-notices.ts).
 *
 * Why not Bun's HTML entrypoint (which the dev server uses): it emits
 * <script type="module" crossorigin>, and browsers refuse module scripts over file://. A report
 * folder has to open by double-clicking index.html, so the bundle is an IIFE loaded by a plain
 * deferred <script>, and the page is written from src/viewer/index.html with the dev module tag
 * swapped out. Asset URLs stay relative ("assets/…") so the folder also works from any static
 * host and any subpath.
 */

import tailwind from "bun-plugin-tailwind";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import pkg from "./package.json";
import { bundledPackages, cssPackageImports, renderNotices, type MetafileLike } from "./scripts/third-party-notices";

const root = import.meta.dir;
const outdir = path.join(root, "dist", "viewer");
const assets = path.join(outdir, "assets");

// One line ahead of each bundle, so a copy of app.js that travels without its report still says
// whose it is and where its licenses are. `/*!` is the legal-comment form minifiers keep. It sits
// before the IIFE, so the bundle stays a plain classic script (file:// rules). Bun applies it to
// the JS entry only; app.css already opens with Tailwind's own legal comment.
const banner = (what: string) =>
  `/*! ${what} | Skyplate ${pkg.version} | Apache-2.0 | Copyright 2026 Jon Jaques | third-party licenses: THIRD_PARTY_NOTICES */`;

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
  banner: banner("Skyplate report viewer"),
  metafile: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// The source reader's syntax highlighter (highlight.js, ~1 MB with every grammar) ships as a
// second classic script, assets/highlight.js, that the reader injects on first use; see
// src/viewer/source/highlight.ts. Same rules as app.js: IIFE, plain <script src>, relative URL,
// so it loads over file:// too. Kept out of app.js so a first view never downloads it.
const highlighter = await Bun.build({
  entrypoints: [path.join(root, "src/viewer/source/highlight-entry.ts")],
  outdir: assets,
  format: "iife",
  target: "browser",
  minify: true,
  naming: { entry: "highlight.[ext]" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  banner: banner("highlight.js (BSD-3-Clause), bundled for the Skyplate source reader"),
  metafile: true,
});

if (!highlighter.success) {
  for (const log of highlighter.logs) console.error(log);
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

// ─── Notices ─────────────────────────────────────────────────────────────────────────────────

const metafiles = [result.metafile, highlighter.metafile].map((m) => (typeof m === "string" ? JSON.parse(m) : m) as MetafileLike);
const stylesheet = await Bun.file(path.join(root, "src/viewer/styles.css")).text();
const packages = bundledPackages(metafiles, root, cssPackageImports(stylesheet));
const notices = renderNotices(packages, { name: "Skyplate", version: pkg.version });
await Bun.write(path.join(outdir, "THIRD_PARTY_NOTICES"), notices);
await copyFile(path.join(root, "LICENSE"), path.join(outdir, "LICENSE"));
await copyFile(path.join(root, "NOTICE"), path.join(outdir, "NOTICE"));

// The repository keeps a copy at its root, beside LICENSE and NOTICE, for anyone reading the
// source rather than a report. Written only when it changed, so a rebuild with the same
// dependencies leaves git clean and a dependency bump shows up as a reviewable diff. Never
// fatal: an installed copy may sit in a read-only prefix, and the report's own copy above is
// the one that has to exist.
const rootCopy = path.join(root, "THIRD_PARTY_NOTICES");
let noticesNote = "";
try {
  const current = (await Bun.file(rootCopy).exists()) ? await Bun.file(rootCopy).text() : "";
  if (current !== notices) {
    await Bun.write(rootCopy, notices);
    noticesNote = " (updated the repository copy)";
  }
} catch (e) {
  noticesNote = ` (could not update the repository copy: ${(e as Error).message})`;
}

let total = 0;
for (const output of [...result.outputs, ...highlighter.outputs]) {
  total += output.size;
  console.log(` ${path.relative(root, output.path).padEnd(52)} ${(output.size / 1024).toFixed(1)} KB`);
}
console.log(` dist/viewer/index.html`);
console.log(` dist/viewer/LICENSE, NOTICE, THIRD_PARTY_NOTICES: ${packages.length} bundled packages${noticesNote}`);
console.log(` total ${(total / 1024).toFixed(0)} KB`);
