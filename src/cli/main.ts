/**
 * The `starchart` command: argument handling, progress, the final summary, and serving.
 *
 *   bun bin/starchart.ts <path> [options]      (see USAGE in ./args.ts)
 *
 * main() returns the exit code instead of calling process.exit, so tests can drive it and a
 * pending stderr write is never cut off. Every failure a user can cause (missing path, a file
 * where a folder belongs, an unknown flag) is a one-line message and exit code 1, never a
 * stack trace.
 */

import { existsSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { analyzeProject } from "../core/pipeline";
import { checkOutput, outputPlacement, realPath, viewerIsStale, writeSite } from "../core/site";
import type { Severity } from "../shared/schema";
import { USAGE, UsageError, parseCommand, type AnalyzeCommand, type ServeCommand } from "./args";
import { Progress, seconds } from "./progress";
import { isReportDir, openInBrowser, startServer } from "./serve";

class CliError extends Error {}

const nf = new Intl.NumberFormat("en-US");
const plural = (n: number, one: string) => `${nf.format(n)} ${n === 1 ? one : `${one}s`}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** "Vite ⚡" → "vite", "Café Ops" → "cafe-ops": safe in any shell and on any filesystem. */
export function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
}

/** checkOutput's refusals, as CLI errors and in the CLI's own words (it names --out). */
function checkOut(out: string, root: string): void {
  try {
    checkOutput(out, root);
  } catch (e) {
    throw new CliError((e instanceof Error ? e.message : String(e)).replace("choose another output folder", "choose another --out"));
  }
}

const err = (text: string) => process.stderr.write(text + "\n");

export async function main(argv: string[]): Promise<number> {
  try {
    const cmd = parseCommand(argv);
    if (cmd.kind === "help") {
      process.stdout.write(USAGE + "\n");
      return 0;
    }
    if (cmd.kind === "version") {
      process.stdout.write(`starchart ${pkg.version}\n`);
      return 0;
    }
    if (cmd.kind === "serve") return await serveCommand(cmd);
    return await analyzeCommand(cmd);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`starchart: ${e.message}\nRun "starchart --help" for usage.`);
      return 1;
    }
    err(`starchart: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function serveCommand(cmd: ServeCommand): Promise<number> {
  const dir = resolve(cmd.dir);
  if (!existsSync(dir)) throw new CliError(`report folder not found: ${cmd.dir}`);
  if (!statSync(dir).isDirectory()) throw new CliError(`not a folder: ${cmd.dir}`);
  if (!isReportDir(dir)) throw new CliError(`no index.html in ${cmd.dir}; is it a starchart report folder?`);
  serveAndWait(dir, cmd.port, cmd.open);
  return await new Promise<number>(() => {}); // the server keeps running until Ctrl-C
}

function serveAndWait(dir: string, port: number | undefined, open: boolean): void {
  const server = startServer(dir, port);
  err(`Serving ${dir}\n  ${server.url}   (Ctrl-C to stop)`);
  if (open && !openInBrowser(server.url)) err(`Could not open a browser; visit ${server.url}`);
}

async function analyzeCommand(cmd: AnalyzeCommand): Promise<number> {
  const root = resolve(cmd.path);
  if (!existsSync(root)) throw new CliError(`path not found: ${cmd.path}`);
  if (!statSync(root).isDirectory()) throw new CliError(`not a directory: ${cmd.path}`);
  let out = cmd.out !== undefined ? resolve(cmd.out) : undefined;
  // Before the analysis, so a bad --out costs nothing: on a large repository writeSite would
  // otherwise find it only after minutes of work.
  if (out) checkOut(out, root);

  // Reports are never part of the project they describe. The default output lands inside the
  // project when run as `starchart .`, and without this the second run would measure the
  // first run's data files (megabytes of JSON) as the biggest "code" in the repository.
  // Compared through realpath, as the walker roots itself, so an --out spelled through a
  // symlink is still recognized as inside.
  const exclude = [...cmd.options.exclude, "*.starchart/"];
  if (out && outputPlacement(out, root) === "inside") {
    exclude.push(`/${relative(realPath(root), realPath(out)).split(sep).join("/")}/`);
  }

  const progress = new Progress(process.stderr, cmd.quiet);
  const started = performance.now();
  try {
    const result = await analyzeProject(root, { ...cmd.options, exclude }, (e) => progress.event(e));
    const report = result.report;
    if (!out) {
      out = resolve(`${slug(report.project.name) || slug(basename(root)) || "project"}.starchart`);
      // Still checked against the project: a folder foo.starchart whose README is titled
      // "Foo", analyzed from its parent, gets itself as the default output.
      checkOut(out, root);
    }
    progress.event({ phase: "write", status: "start" });
    const site = await writeSite(result, out, { json: cmd.json });
    progress.event({ phase: "write", status: "done", ms: site.ms, message: formatBytes(site.bytes) });
    progress.stop();

    if (!cmd.quiet) {
      const sev: Record<Severity, number> = { critical: 0, warning: 0, notice: 0, info: 0 };
      for (const f of report.findings) sev[f.severity]++;
      const findings = (["critical", "warning", "notice", "info"] as const).filter((s) => sev[s] > 0).map((s) => `${sev[s]} ${s}`);
      const facts = [
        plural(report.totals.files, "file"),
        plural(report.languages.length, "language"),
        report.git ? plural(report.git.analyzedCommits, "commit") : "no git history",
        report.git ? plural(report.git.authors.length, "author") : undefined,
        report.symbols ? plural(report.symbols.stats.symbols, "symbol") : undefined,
      ].filter(Boolean);
      const rel = relative(process.cwd(), out) || ".";
      const shown = rel.startsWith("..") ? out : rel;
      err("");
      err(`starchart · ${report.project.name}`);
      err(`  ${facts.join(" · ")}`);
      err(`  findings: ${findings.length ? findings.join(" · ") : "none"}`);
      if (report.warnings.length) err(`  ${report.warnings.length === 1 ? "1 warning" : `${report.warnings.length} warnings`} (listed in the report's about panel)`);
      err(`  wrote ${shown} (${formatBytes(site.bytes)}) in ${seconds(performance.now() - started)}`);
      // Only said, never fixed here; site.ts's ensureViewer explains why it does not rebuild.
      if (viewerIsStale()) err(`  note: dist/viewer is older than src/viewer; run "bun run build" so reports get the current viewer`);
      if (!cmd.open && !cmd.serve) {
        err("");
        err(`  next: open ${shown}/index.html`);
        err(`    or: starchart serve ${shown}`);
      }
    }
    if (cmd.open || cmd.serve) {
      serveAndWait(out, cmd.port, cmd.open);
      return await new Promise<number>(() => {});
    }
    return 0;
  } finally {
    progress.stop();
  }
}
