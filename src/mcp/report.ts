/**
 * A report folder, read back: the same data the viewer loads, for the MCP server to query.
 *
 *   const folder = await readReportFolder(dir);   // data/report.js, parsed and checked
 *   await folder.symbols();                       // data/symbols.js, on first use
 *   await folder.text(fileId);                    // one embedded file, from its source chunk
 *
 * The data files are classic scripts (see DATA_GLOBAL in src/shared/schema.ts), parsed with
 * site.ts's own reader. symbols.js is loaded lazily because it is the large one (hundreds of
 * MB on a big monorepo) and many questions never need it, and source chunks are kept in a
 * small LRU for the same reason: a reader paging through one directory stays in one or two
 * chunks, and an agent reading files at random should not pull the whole source into memory.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { isReportScriptHead, parseDataScript } from "../core/site";
import { REPORT_FILE, SCHEMA_VERSION, type CodeSymbols, type Report, type SourceChunk } from "../shared/schema";

const CHUNK_CACHE = 4;

export interface ReportFolder {
  dir: string;
  report: Report;
  /** mtime of data/report.js when read, to notice a rebuild into the same folder. */
  mtimeMs: number;
  symbols(): Promise<CodeSymbols | undefined>;
  /** Embedded text of a file, or why there is none. */
  text(file: number): Promise<{ text: string } | { reason: string }>;
}

/** data/report.js begins like a report data script. Reads 64 bytes, never the whole file. */
export async function isReportFolder(dir: string): Promise<boolean> {
  const file = join(dir, REPORT_FILE);
  if (!existsSync(file)) return false;
  return isReportScriptHead(await Bun.file(file).slice(0, 64).text());
}

export function reportMtime(dir: string): number {
  try {
    return statSync(join(dir, REPORT_FILE)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function readReportFolder(dir: string): Promise<ReportFolder> {
  const file = join(dir, REPORT_FILE);
  const mtimeMs = reportMtime(dir);
  const report = parseDataScript(await Bun.file(file).text(), "report") as Report | undefined;
  if (!report) throw new Error(`${dir} is not a skyplate report folder (no report data in ${REPORT_FILE})`);
  // Older reports are not migrated: a viewer of the same version is what reads them, and a
  // shape this code does not know would answer questions wrongly rather than fail.
  if (report.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${dir} was written by ${report.tool?.name ?? "skyplate"} ${report.tool?.version ?? "?"} (report schema ${report.schemaVersion}); this server reads schema ${SCHEMA_VERSION}. Rebuild it, or open the project directory instead`,
    );
  }

  let symbols: Promise<CodeSymbols | undefined> | undefined;
  const chunks = new Map<number, Promise<Record<number, string>>>();

  const loadChunk = (i: number): Promise<Record<number, string>> => {
    let hit = chunks.get(i);
    if (hit) {
      chunks.delete(i); // re-insert: Map order is the LRU order
      chunks.set(i, hit);
      return hit;
    }
    const url = report.source!.chunks[i]!;
    hit = Bun.file(join(dir, url))
      .text()
      .then((text) => (parseDataScript(text, `source/${i}`) as SourceChunk).files);
    hit.catch(() => chunks.delete(i)); // a failed read is retried next time, not cached
    chunks.set(i, hit);
    while (chunks.size > CHUNK_CACHE) chunks.delete(chunks.keys().next().value!);
    return hit;
  };

  return {
    dir,
    report,
    mtimeMs,
    symbols() {
      if (!report.symbols) return Promise.resolve(undefined);
      symbols ??= Bun.file(join(dir, report.symbols.url))
        .text()
        .then((text) => parseDataScript(text, "symbols") as CodeSymbols);
      return symbols;
    },
    async text(id) {
      const f = report.files[id];
      if (!f) return { reason: "no such file" };
      if (f.secret) return { reason: "looks like it holds credentials, so its contents are never embedded or shown" };
      if (f.binary) return { reason: "binary file" };
      if (!report.source) return { reason: "this report embeds no source (written with --no-source)" };
      if (f.src < 0) {
        const cap = report.source.maxFileBytes;
        return {
          reason:
            f.bytes > cap
              ? `not embedded: larger than the report's ${Math.round(cap / 1024)} KB per-file cap`
              : "not embedded: the report's total source budget ran out before this file",
        };
      }
      const text = (await loadChunk(f.src))[id];
      return text === undefined ? { reason: "missing from its source chunk" } : { text };
    },
  };
}
