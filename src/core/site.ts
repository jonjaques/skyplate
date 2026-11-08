/**
 * The report folder: viewer shell, data scripts, embedded source and copied image assets.
 *
 *   <out>/index.html, <out>/assets/*      the built viewer (dist/viewer, built on demand),
 *                                         without its source maps
 *   <out>/data/report.js                  window.__skyplate.resolve("report", {...})
 *   <out>/data/symbols.js                 when the TypeScript analysis ran
 *   <out>/data/source/0000.js …           source chunks, ~1.5 MB each
 *   <out>/data/assets/<fileId>.<ext>      images ≤ 2 MB, for preview
 *   <out>/data/report.json                only with --json
 *
 * Data files are classic scripts, not JSON, because browsers refuse fetch() and module
 * scripts over file:// (see DATA_GLOBAL in src/shared/schema.ts).
 *
 * Writing is staged: everything goes into a hidden sibling directory, report.js last, and the
 * finished directory is renamed into place. A run that fails halfway leaves the previous
 * report (or nothing), never a folder whose index.html opens onto half the data. The folder
 * being replaced is deleted, so checkOutput refuses anything but an empty folder or a report
 * this tool wrote, and never the analyzed project or a folder that holds it.
 *
 * Embedding policy (chooseEmbedded) also lives here, because it decides what the site
 * contains; the pipeline calls it before measuring so only chosen texts ever cross from the
 * workers.
 */

import { accessSync, closeSync, constants, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DATA_GLOBAL, REPORT_FILE, type Category, type CodeSymbols, type Report, type SourceIndex } from "../shared/schema";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const VIEWER_DIR = join(PROJECT_ROOT, "dist", "viewer");

/**
 * The notices every report carries at its top level: Skyplate's license, its NOTICE, and the
 * licenses of the packages bundled into the viewer. build.ts writes all three into dist/viewer.
 */
export const NOTICE_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES"] as const;

export const DEFAULT_MAX_SOURCE_FILE = 512 * 1024;
export const DEFAULT_MAX_SOURCE_TOTAL = 64 * 1024 * 1024;
/** Chunks near this size: big enough that a reader browsing one directory loads one or two,
 * small enough that opening one file never waits on tens of megabytes. */
const CHUNK_BYTES = 1.5 * 1024 * 1024;
/** Images copied for preview: larger ones are usually textures or photos nobody previews. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/** Formats every browser renders in an <img>. */
const PREVIEWABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"]);

// ─── Embedding policy ────────────────────────────────────────────────────────────────────────

export interface EmbedCandidate {
  id: number;
  path: string;
  bytes: number;
  category: Category;
  binary: boolean;
  secret: boolean;
  generated: boolean;
}

/** What a reader opens first: the project's own code, then what configures and builds it. */
const CATEGORY_PRIORITY: Partial<Record<Category, number>> = {
  code: 0,
  test: 1,
  config: 2,
  build: 3,
  style: 4,
  markup: 5,
  docs: 6,
  notebook: 7,
  data: 8,
};
const LAST = 20;

/**
 * `maxTotal` budgets source bytes as they are on disk, decided before any file is read so
 * only the chosen texts ever cross from the workers. The chunk files come out somewhat larger
 * than the budget: JSON escaping doubles every newline, quote and backslash, and a file read
 * as Latin-1 is written back as UTF-8, two bytes for each byte over 0x7F. Budgeting written
 * bytes instead would mean reading and encoding every candidate first, embedded or not.
 */
export function chooseEmbedded(
  files: EmbedCandidate[],
  maxFile: number,
  maxTotal: number,
): { embed: boolean[]; skipped: SourceIndex["skipped"] } {
  const embed = new Array<boolean>(files.length).fill(false);
  const skipped = { binary: 0, tooLarge: 0, overBudget: 0, disabled: 0 };
  const candidates: EmbedCandidate[] = [];
  for (const f of files) {
    if (f.binary) skipped.binary++;
    // Credentials are never embedded, whatever the caps say (see FileRecord.secret). They are
    // counted as disabled: embedding is switched off for them by rule, not by size.
    else if (f.secret) skipped.disabled++;
    else if (f.bytes > maxFile) skipped.tooLarge++;
    else candidates.push(f);
  }
  const rank = (f: EmbedCandidate) =>
    f.category === "lockfile" || f.generated ? LAST + 1 : (CATEGORY_PRIORITY[f.category] ?? LAST);
  candidates.sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let total = 0;
  let full = false;
  for (const f of candidates) {
    // Strict stop at the first file that does not fit: letting smaller, lower-priority files
    // fill the remainder would embed lockfiles while a core source file is missing.
    if (!full && total + f.bytes <= maxTotal) {
      embed[f.id] = true;
      total += f.bytes;
    } else {
      full = true;
      skipped.overBudget++;
    }
  }
  return { embed, skipped };
}

/** Embedded files in id (path) order, cut into chunks, so one directory lands in few chunks. */
export function planChunks(texts: Map<number, string>): number[][] {
  const ids = [...texts.keys()].sort((a, b) => a - b);
  const chunks: number[][] = [];
  let current: number[] = [];
  let size = 0;
  for (const id of ids) {
    const bytes = Buffer.byteLength(texts.get(id)!, "utf8");
    if (current.length && size + bytes > CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(id);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export const chunkUrl = (i: number) => `data/source/${String(i).padStart(4, "0")}.js`;

export function assetUrl(id: number, path: string, category: Category, bytes: number, secret: boolean): string | undefined {
  if (category !== "image" || secret || bytes > MAX_ASSET_BYTES) return undefined;
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
  return PREVIEWABLE.has(ext) ? `data/assets/${id}.${ext}` : undefined;
}

// ─── Viewer template ─────────────────────────────────────────────────────────────────────────

/**
 * dist/viewer, built by build.ts when missing (a fresh checkout has no dist/), and only then.
 * A stale build is reported (viewerIsStale) but not rebuilt: build.ts deletes dist/viewer
 * before writing it, so a rebuild here would tear the copy another skyplate run is making
 * from it, and a viewer source caught mid-edit would fail this run after its whole analysis.
 *
 * A build without the notice files counts as missing: it predates them (every build since writes
 * all three), and a report must not go out without them, so it is rebuilt once, like a fresh
 * checkout.
 */
function viewerComplete(): boolean {
  return existsSync(join(VIEWER_DIR, "index.html")) && NOTICE_FILES.every((f) => existsSync(join(VIEWER_DIR, f)));
}

export async function ensureViewer(): Promise<string> {
  if (viewerComplete()) return VIEWER_DIR;
  // An installed copy ships dist/viewer pre-built and no build.ts (package.json "files"), so
  // spawning it would fail on a missing module and the advice to run "bun run build" could not
  // be followed. Only a damaged install gets here; reinstalling is the fix.
  if (!existsSync(join(PROJECT_ROOT, "build.ts"))) {
    throw new Error(`this skyplate install has an incomplete viewer (${VIEWER_DIR}); reinstall the package`);
  }
  const proc = Bun.spawn([process.execPath, join(PROJECT_ROOT, "build.ts")], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0 || !viewerComplete()) {
    throw new Error(`building the viewer failed (bun build.ts exited ${code}):\n${(err || out).trim()}`);
  }
  return VIEWER_DIR;
}

/**
 * True when a source file of the viewer (or the schema it reads) is newer than the built
 * dist/viewer, so reports would ship a viewer that predates the code beside it. False when
 * either side is missing: an installed copy has no src/viewer to compare against.
 *
 * The src/viewer check comes first, and on its own: an installed copy does ship src/shared (the
 * CLI runs it), and package managers stamp extracted files with the time they wrote them, in
 * tarball order, so src/shared lands a few milliseconds after dist/viewer/index.html. Comparing
 * it would call every `bunx skyplate` run stale and tell the user to run a build script the
 * package does not contain.
 */
export function viewerIsStale(): boolean {
  if (!existsSync(join(PROJECT_ROOT, "src", "viewer"))) return false;
  let built: number;
  try {
    built = statSync(join(VIEWER_DIR, "index.html")).mtimeMs;
  } catch {
    return false;
  }
  for (const dir of [join(PROJECT_ROOT, "src", "viewer"), join(PROJECT_ROOT, "src", "shared")]) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        if (statSync(join(e.parentPath, e.name)).mtimeMs > built) return true;
      } catch {
        // Deleted between the listing and the stat: nothing to compare.
      }
    }
  }
  return false;
}

// ─── Writing ─────────────────────────────────────────────────────────────────────────────────

export interface SiteInput {
  report: Report;
  symbols?: CodeSymbols;
  /** Embedded text by file id, and the chunk plan (file ids per chunk). */
  sources: Map<number, string>;
  chunks: number[][];
  /** Absolute path of each file id, for copying image assets. */
  abs: string[];
  /** The analyzed project's root, so an output folder that is or holds it is refused. */
  root?: string;
}

export interface SiteResult {
  out: string;
  bytes: number;
  reportBytes: number;
  symbolsBytes: number;
  sourceBytes: number;
  assetBytes: number;
  ms: number;
}

const dataScriptHead = (name: string) => `window.${DATA_GLOBAL}.resolve(${JSON.stringify(name)}, `;
const dataScript = (name: string, payload: unknown) => `${dataScriptHead(name)}${JSON.stringify(payload)});\n`;

/**
 * The payload of a data script dataScript() wrote for `name`, or undefined when `text` is not
 * one. The MCP server reads report folders back with it (src/mcp/report.ts); the reader sits
 * beside the writer so the two can only change together. Throws on a script that has the
 * right head but a damaged payload (a truncated copy), which is not "no report here".
 */
export function parseDataScript(text: string, name: string): unknown {
  const head = dataScriptHead(name);
  if (!text.startsWith(head)) return undefined;
  const body = text.trimEnd();
  if (!body.endsWith(");")) throw new Error(`data script "${name}" is truncated`);
  return JSON.parse(body.slice(head.length, -2));
}

/** True when `text` begins like the report data script, without parsing the rest. */
export const isReportScriptHead = (text: string): boolean => text.startsWith(dataScriptHead("report"));

/** First bytes of a file as text, "" when it cannot be read. Never reads a whole data file. */
function readHead(path: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0));
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The two marks a report folder carries: how data/report.js begins, and the viewer's generator
 * tag. Each mark is a pair, and a folder must show both halves of one pair.
 *
 * The second pair is back-compat, kept on purpose: the tool was called starchart until its
 * first release, and its reports say window.__starchart and content="starchart". Re-running
 * into one of those folders (the old default name, or a --out a script still passes) replaces
 * it as it always did. Both halves have to match together, and with nothing else at the top
 * level, so the unrelated tool that also calls itself starchart (and the reason for the
 * rename) cannot have its output deleted here by sharing a word.
 */
const REPORT_MARKS: { head: string; generator: RegExp }[] = [
  { head: `window.${DATA_GLOBAL}.resolve("report", `, generator: /<meta\s+name=["']generator["']\s+content=["']skyplate["']/i },
  { head: `window.__starchart.resolve("report", `, generator: /<meta\s+name=["']generator["']\s+content=["']starchart["']/i },
];
const REPORT_HEAD_BYTES = Math.max(...REPORT_MARKS.map((m) => m.head.length));

/** Top-level names a report folder may hold: the viewer's files, data/, and Finder's litter. */
function reportEntries(): Set<string> {
  const names = new Set<string>(["index.html", "assets", "data", ".DS_Store", ...NOTICE_FILES]);
  try {
    // A viewer that grows a top-level file (a favicon) must not make its own reports
    // unreplaceable.
    for (const name of readdirSync(VIEWER_DIR)) names.add(name);
  } catch {
    // Not built yet: the fixed names are what every viewer so far has shipped.
  }
  return names;
}

/**
 * True when `dir` is safe to replace: empty, or a report this tool wrote. Replacing means
 * deleting, so every marker must hold: nothing at the top level but what a report contains,
 * data/report.js that is a report data script, and the viewer's generator tag. Any one alone
 * is too weak: a project of its own can have a data/report.js (one did, and a run with
 * `--out .` deleted it), and an unrelated page can name itself the same thing.
 */
export function isReplaceable(dir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  if (entries.length === 0) return true;
  const allowed = reportEntries();
  if (!entries.every((e) => allowed.has(e))) return false;
  const head = readHead(join(dir, REPORT_FILE), REPORT_HEAD_BYTES);
  const page = readHead(join(dir, "index.html"), 4096);
  return REPORT_MARKS.some((m) => head.startsWith(m.head) && m.generator.test(page));
}

/**
 * realpath for a path that may not exist yet: the nearest existing ancestor realpath'd, plus
 * the rest as written. Bun's realpath also folds case on macOS, so "~/Dev/X" and "~/dev/x"
 * compare equal when they are the same folder.
 */
export function realPath(p: string): string {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = []; // the names that do not exist yet, in path order
  while (true) {
    let real: string;
    try {
      real = realpathSync(head);
    } catch {
      const up = dirname(head);
      if (up === head) return abs;
      tail.unshift(basename(head));
      head = up;
      continue;
    }
    return join(real, ...tail);
  }
}

/**
 * How `out` sits relative to the project `root`, compared through realpath so a symlink, a
 * relative path or macOS's /var → /private/var cannot hide that they are the same place.
 */
export function outputPlacement(out: string, root: string): "same" | "contains" | "inside" | "apart" {
  const o = realPath(out);
  const r = realPath(root);
  if (o === r) return "same";
  if (r.startsWith(o.endsWith(sep) ? o : o + sep)) return "contains";
  if (o.startsWith(r.endsWith(sep) ? r : r + sep)) return "inside";
  return "apart";
}

/**
 * The exclude list for analyzing `root` when its report goes to `out`: the caller's patterns,
 * plus every report folder.
 *
 * Reports are never part of the project they describe. The default output lands inside the
 * project when run as `skyplate .`, and without this the second run would measure the first
 * run's data files (megabytes of JSON) as the biggest "code" in the repository. Compared
 * through realpath, as the walker roots itself, so an --out spelled through a symlink is still
 * recognized as inside.
 * "*.starchart/" is back-compat, kept on purpose: before the rename the tool was called
 * starchart and `starchart .` wrote <project>.starchart/ inside the project, so projects that
 * were analyzed before still carry one, and it is a report, not part of the project.
 */
export function reportExcludes(root: string, out: string | undefined, exclude: readonly string[]): string[] {
  const all = [...exclude, "*.skyplate/", "*.starchart/"];
  if (out && outputPlacement(out, root) === "inside") {
    all.push(`/${relative(realPath(root), realPath(out)).split(sep).join("/")}/`);
  }
  return all;
}

/**
 * Everything about an output folder that can be known before writing, so the CLI can refuse a
 * bad --out before a minutes-long analysis rather than after it. Throws a one-line Error.
 * writeSite repeats it, for callers that skip the CLI.
 */
export function checkOutput(outDir: string, root?: string): void {
  const out = resolve(outDir);
  if (root !== undefined) {
    // Replacing the output folder deletes it, so these would delete the project itself.
    const placement = outputPlacement(out, root);
    if (placement === "same") throw new Error(`output folder ${out} is the project being analyzed, and writing there would replace it; choose a new folder (one inside the project is fine)`);
    if (placement === "contains") throw new Error(`output folder ${out} contains the project being analyzed, and writing there would replace it; choose a folder that does not contain the project`);
  }
  if (existsSync(out)) {
    if (!statSync(out).isDirectory()) throw new Error(`output path is a file: ${out}`);
    if (!isReplaceable(out)) throw new Error(`output folder ${out} already exists and is not a skyplate report; choose another output folder`);
  }
  // The report is staged next to `out` and renamed into place, so what has to be writable is
  // the nearest folder that already exists on the way up from its parent.
  let dir = dirname(out);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  if (!statSync(dir).isDirectory()) throw new Error(`output path is inside a file: ${dir}`);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`cannot write the report to ${out}: ${dir} is not writable`);
  }
}

/** The first ancestor of `p` (itself included) that exists and is not a folder. */
function fileAncestor(p: string): string | undefined {
  for (let d = p; ; d = dirname(d)) {
    try {
      if (!statSync(d).isDirectory()) return d;
    } catch {
      // Missing, or ENOTDIR because something further up is a file: keep climbing.
    }
    if (dirname(d) === d) return undefined;
  }
}

/**
 * A filesystem error from writing, as one line about the output folder. The raw message names
 * the hidden staging folder (".x.skyplate.tmp-8941-mvx4743a"), which the user never asked
 * for and cannot act on.
 */
function writeError(e: unknown, out: string): Error {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "EACCES":
    case "EPERM":
      return new Error(`cannot write the report to ${out}: permission denied`);
    case "EROFS":
      return new Error(`cannot write the report to ${out}: the file system is read-only`);
    case "ENOSPC":
    case "EDQUOT":
      return new Error(`cannot write the report to ${out}: no space left on the device`);
    case "EEXIST":
    case "ENOTDIR":
    case "ENOTEMPTY": {
      const file = fileAncestor(dirname(out));
      return new Error(file ? `output path is inside a file: ${file}` : `cannot write the report to ${out}: something else created it while the report was being written`);
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** `//# sourceMappingURL=app.js.map` (JS) or the CSS comment form, as the bundler's last line. */
const MAP_TRAILER = /\r?\n?(?:\/\/# sourceMappingURL=[^\n]*\.map|\/\*# sourceMappingURL=[^\n]*\.map \*\/)\s*$/;

/**
 * Strip the source-map trailer from the copied scripts and sheets whose map was left behind.
 * Kept, it points at a file the folder does not have, and every reader who opens devtools on a
 * report gets a failed request and a "could not load source map" warning for it.
 */
async function dropMapTrailers(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // a viewer without an assets folder has nothing to strip
  }
  for (const name of names) {
    if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
    const file = join(dir, name);
    const text = await Bun.file(file).text();
    const stripped = text.replace(MAP_TRAILER, "\n");
    if (stripped !== text) await writeFile(file, stripped);
  }
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
  }
  return total;
}

export async function writeSite(input: SiteInput, outDir: string, opts: { json?: boolean } = {}): Promise<SiteResult> {
  const started = performance.now();
  const out = resolve(outDir);
  checkOutput(out, input.root);
  const viewer = await ensureViewer();
  const parent = dirname(out);
  try {
    await mkdir(parent, { recursive: true });
  } catch (e) {
    throw writeError(e, out);
  }
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const tmp = join(parent, `.${basename(out)}.tmp-${stamp}`);
  const report = input.report;
  let reportBytes = 0;
  let symbolsBytes = 0;
  let sourceBytes = 0;
  let assetBytes = 0;

  try {
    // Source maps stay in dist/viewer for whoever debugs the viewer, and out of reports: the
    // map (sourcesContent for every viewer file) was 7.5 MB beside a 1.8 MB app.js, so a
    // `--no-source` report meant for sharing was about 70% map of a viewer nobody reading the
    // report will step through. The trailer that names the map goes too (dropMapTrailers).
    await cp(viewer, tmp, { recursive: true, filter: (src) => !src.endsWith(".map") });
    await dropMapTrailers(join(tmp, "assets"));
    // Sharing a report redistributes the viewer and everything bundled into it, so its license,
    // NOTICE and the bundled packages' licenses travel in every report folder, at the top level
    // where a reader looks for them. They come with the viewer template (build.ts writes them),
    // and are checked here rather than trusted, because a report without them is not one to ship.
    for (const f of NOTICE_FILES) {
      if (!existsSync(join(tmp, f))) throw new Error(`the viewer build has no ${f}; run "bun run build" and try again`);
    }
    await mkdir(join(tmp, "data", "source"), { recursive: true });

    for (let i = 0; i < input.chunks.length; i++) {
      const files: Record<number, string> = {};
      for (const id of input.chunks[i]!) files[id] = input.sources.get(id)!;
      const text = dataScript(`source/${i}`, { chunk: i, files });
      await writeFile(join(tmp, chunkUrl(i)), text);
      sourceBytes += Buffer.byteLength(text);
    }

    const withAssets = report.files.filter((f) => f.asset);
    if (withAssets.length) await mkdir(join(tmp, "data", "assets"), { recursive: true });
    for (const f of withAssets) {
      try {
        await copyFile(input.abs[f.id]!, join(tmp, f.asset!));
        assetBytes += f.bytes;
      } catch {
        // Gone or unreadable since the walk: the report simply has no preview for it. Safe to
        // change here because report.js has not been written yet.
        delete f.asset;
      }
    }

    if (input.symbols) {
      const text = dataScript("symbols", input.symbols);
      await writeFile(join(tmp, "data", "symbols.js"), text);
      symbolsBytes = Buffer.byteLength(text);
    }

    // Everything but report.js itself is on disk; its own write is the only cost not counted.
    report.timings.write = Math.round(performance.now() - started);
    if (opts.json) await writeFile(join(tmp, "data", "report.json"), JSON.stringify(report));
    const text = dataScript("report", report);
    await writeFile(join(tmp, REPORT_FILE), text);
    reportBytes = Buffer.byteLength(text);

    if (existsSync(out)) {
      const old = join(parent, `.${basename(out)}.old-${stamp}`);
      await rename(out, old);
      try {
        await rename(tmp, out);
      } catch (e) {
        await rename(old, out); // put the previous report back
        throw e;
      }
      await rm(old, { recursive: true, force: true });
    } else {
      await rename(tmp, out);
    }
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw writeError(e, out);
  }

  return {
    out,
    bytes: await dirBytes(out),
    reportBytes,
    symbolsBytes,
    sourceBytes,
    assetBytes,
    ms: Math.round(performance.now() - started),
  };
}
