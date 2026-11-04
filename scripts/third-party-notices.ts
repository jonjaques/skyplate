/**
 * THIRD_PARTY_NOTICES: the licenses of everything the report viewer bundles.
 *
 *   called by build.ts, once per viewer build; not run on its own
 *
 * Every report ships dist/viewer (assets/app.js, assets/app.css with both fonts inlined, and
 * assets/highlight.js), so sharing a report redistributes these packages, and their licenses
 * (MIT's and ISC's notice clause, BSD-3-Clause's, the fonts' SIL OFL) ask that their notices
 * travel with them. The list comes from the bundler's metafile, so it is what the shipped bytes
 * contain, not what package.json declares: a dependency the viewer never imports (d3-force-3d,
 * postprocessing) stays out, and a transitive one that is bundled (scheduler, camera-controls)
 * gets in.
 *
 * Two kinds of input the metafile cannot see are added by hand, from the stylesheet itself:
 * packages that bun-plugin-tailwind pulls in through `@import "<package>"` (Tailwind's own
 * preflight and utilities, tw-animate-css's keyframes) land in app.css without ever being a
 * bundler input. (app.css's first line names an older tailwindcss than the one listed: that is
 * the compiler bun-plugin-tailwind embeds, which compiles the installed package's stylesheets.
 * Both are Tailwind Labs' MIT license, so the installed package's license file covers it.)
 *
 * Each license text is read from the installed package's own license file. A package whose
 * published tarball leaves its license out (its package.json "files" omits it) gets the
 * upstream file vendored under scripts/licenses/<package name>, copied verbatim from the
 * package's repository, with <package name>.source beside it naming the exact URL it came from
 * (the installed version's tag where the repository has tags). A bundled package with neither
 * fails the build rather than ship unattributed. Packages whose license files are byte-identical (sixty
 * radix-ui packages, most of d3) share one section, which keeps the file a few dozen pages
 * instead of a few hundred.
 *
 * The output is deterministic (sorted, no dates), so a rebuild with unchanged dependencies
 * writes the same bytes and the committed copy at the repository root only changes when the
 * bundle's contents do.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The parts of Bun's BuildMetafile this reads. */
export interface MetafileLike {
  outputs: Record<string, { inputs: Record<string, unknown> }>;
}

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  url: string | undefined;
  /** The license text, and where it came from (the package, or the vendored override). */
  text: string;
  /** Where a vendored text was copied from (its .source file), or undefined for the package's own. */
  vendoredFrom: string | undefined;
}

const LICENSE_FILE = /^(licen[cs]e|copying)([.-](md|txt|mit))?$/i;
const NOTICE_FILE = /^notice([.](md|txt))?$/i;

/** "node_modules/@scope/name" or "node_modules/name": the package directory an input lives in. */
function packageDir(input: string, root: string): string | undefined {
  const abs = resolve(root, input);
  const marker = "/node_modules/";
  const at = abs.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = abs.slice(at + marker.length).split("/");
  const name = rest[0]!.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]!;
  return abs.slice(0, at + marker.length) + name;
}

/** Bare package specifiers a stylesheet @imports (relative and absolute paths are local). */
export function cssPackageImports(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (spec.startsWith(".") || spec.startsWith("/")) continue;
    out.push(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
  }
  return out;
}

function repositoryUrl(pkg: Record<string, unknown>): string | undefined {
  const repo = pkg.repository as string | { url?: string } | undefined;
  const raw = typeof repo === "string" ? repo : repo?.url;
  if (raw) {
    const url = raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://");
    // "github:owner/repo" and bare "owner/repo" are npm's shorthands for GitHub.
    if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url.replace(/^github:/, "")}`;
    return url;
  }
  return typeof pkg.homepage === "string" ? pkg.homepage : undefined;
}

function readPackage(dir: string, root: string): BundledPackage {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  const name = String(pkg.name);
  const declared = pkg.license ?? (Array.isArray(pkg.licenses) ? (pkg.licenses as { type?: string }[]).map((l) => l.type).join(" OR ") : undefined);
  const files = readdirSync(dir);
  const licenseFiles = files.filter((f) => LICENSE_FILE.test(f)).sort();
  const noticeFiles = files.filter((f) => NOTICE_FILE.test(f)).sort();
  let text: string;
  let vendoredFrom: string | undefined;
  if (licenseFiles.length > 0) {
    text = licenseFiles.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n");
  } else {
    const vendored = join(root, "scripts", "licenses", name);
    if (!existsSync(vendored)) {
      throw new Error(
        `${name} is bundled into the viewer but publishes no license file, and scripts/licenses/${name} does not exist. ` +
          `Copy the LICENSE from its repository at the tag for version ${String(pkg.version)} into that path, verbatim.`,
      );
    }
    text = readFileSync(vendored, "utf8").trim();
    vendoredFrom = existsSync(`${vendored}.source`) ? readFileSync(`${vendored}.source`, "utf8").trim() : "its repository";
  }
  // Apache-2.0 section 4(d): a NOTICE file the work ships travels with it.
  for (const f of noticeFiles) text += `\n\n${readFileSync(join(dir, f), "utf8").trim()}`;
  return { name, version: String(pkg.version), license: String(declared ?? "UNKNOWN"), url: repositoryUrl(pkg), text, vendoredFrom };
}

/** Every package that contributes to any of the bundles, plus the stylesheet's package imports. */
export function bundledPackages(metafiles: MetafileLike[], root: string, cssImports: string[]): BundledPackage[] {
  const dirs = new Set<string>();
  for (const meta of metafiles) {
    for (const output of Object.values(meta.outputs)) {
      for (const input of Object.keys(output.inputs)) {
        const dir = packageDir(input, root);
        if (dir) dirs.add(dir);
      }
    }
  }
  for (const spec of cssImports) {
    const dir = join(root, "node_modules", spec);
    if (!existsSync(join(dir, "package.json"))) throw new Error(`the viewer's stylesheet imports ${spec}, which is not installed`);
    dirs.add(dir);
  }
  const byKey = new Map<string, BundledPackage>();
  for (const dir of dirs) {
    const p = readPackage(dir, root);
    byKey.set(`${p.name}@${p.version}`, p);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const RULE = "-".repeat(80);

export function renderNotices(packages: BundledPackage[], tool: { name: string; version: string }): string {
  // One section per distinct license text, in the order its first package sorts.
  const groups = new Map<string, BundledPackage[]>();
  for (const p of packages) {
    const list = groups.get(p.text);
    if (list) list.push(p);
    else groups.set(p.text, [p]);
  }
  const width = Math.max(...packages.map((p) => `${p.name} ${p.version}`.length));
  const lines: string[] = [
    "THIRD-PARTY NOTICES",
    "",
    `${tool.name} ${tool.version}'s report viewer bundles the open-source software below into the`,
    "files every report ships (assets/app.js, assets/app.css and assets/highlight.js), so a",
    "report carries it wherever the report goes. Each package is listed with its version and",
    "declared license, then its license text as the package publishes it.",
    "",
    "Skyplate itself is licensed under the Apache License 2.0; see LICENSE and NOTICE.",
    "",
    "This file is generated by scripts/third-party-notices.ts during the viewer build",
    "(bun run build). Do not edit it by hand.",
    "",
    RULE,
    `${packages.length} packages`,
    RULE,
    ...packages.map((p) => `${`${p.name} ${p.version}`.padEnd(width)}  ${p.license}`),
  ];
  for (const [text, list] of groups) {
    lines.push("", RULE, "");
    for (const p of list) lines.push(`${p.name} ${p.version} (${p.license})${p.url ? `  ${p.url}` : ""}`);
    for (const p of list) {
      if (p.vendoredFrom) lines.push("", `(The published ${p.name} package carries no license file. This text is copied verbatim from`, ...p.vendoredFrom.split("\n").map((l) => `  ${l}`), ")");
    }
    lines.push("", text);
  }
  lines.push("");
  return lines.join("\n");
}
