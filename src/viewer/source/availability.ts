/**
 * Why a file has no readable source, said in the reader's words.
 *
 * state/loaders.getSource decides the reason when it is asked for contents. The record needs the
 * same answer before anything loads (to offer "Open in source reader" only when there is
 * something to read), so the synchronous half of getSource's checks is mirrored here; the one
 * reason only a load can reveal ("missing", a chunk that failed) never appears from this side.
 */

import type { FileRecord, Report } from "../../shared/schema";
import { formatBytes } from "../lib/format";
import type { SourceUnavailable } from "../state/loaders";

/** The reason a file's contents are not in the report, or null when they are (or it is an image). */
export function sourceUnavailable(report: Report, file: FileRecord): SourceUnavailable | null {
  if (file.secret) return "secret";
  if (file.binary) return "binary";
  if (!report.source) return "disabled";
  if (file.src < 0) return "too-large";
  return null;
}

/** What a report without source still carries, so the copy never promises a missing section. */
function stillHere(report: Report): string {
  const parts = ["metrics", "imports"];
  if (report.git) parts.push("history");
  if (report.symbols) parts.push("symbols");
  const last = parts.pop()!;
  const list = `${parts.join(", ")} and ${last}`;
  return list.charAt(0).toUpperCase() + list.slice(1);
}

export function describeUnavailable(
  report: Report,
  file: FileRecord,
  reason: SourceUnavailable,
): { title: string; body: string } {
  switch (reason) {
    case "secret":
      return {
        title: "Contents withheld: this file looks like it holds credentials",
        body: `starchart never embeds files that look like keys, tokens or .env secrets, whatever the report options say. Its size${report.git ? " and history are" : " is"} still measured.`,
      };
    case "binary":
      return {
        title: file.asset ? "An image, shown as a preview" : "A binary file has no text to read",
        body: file.facts?.format
          ? `The analyzer read its header as ${file.facts.format}${file.facts.width ? `, ${file.facts.width} × ${file.facts.height} px` : ""}.`
          : `${formatBytes(file.bytes)} of binary data.`,
      };
    case "disabled":
      return {
        title: "This report was written without source",
        body: `It was generated with --no-source, so file contents were left out for sharing. ${stillHere(report)} are all still here.`,
      };
    case "too-large":
      // getSource folds both caps into one reason; the file's size against the per-file cap
      // tells which one it was, so the reader gets the actual cause rather than two maybes.
      return report.source && file.bytes > report.source.maxFileBytes
        ? {
            title: "Over the size cap for embedded source",
            body: `At ${formatBytes(file.bytes)}, this file is over the report's ${formatBytes(report.source.maxFileBytes)} per-file cap, so its contents were left out. Re-running starchart with a larger --max-source-file includes it.`,
          }
        : {
            title: "Left out when the source budget ran out",
            body: `The report embeds at most ${formatBytes(report.source?.maxTotalBytes ?? 0)} of source in total, and that was spent before this file's turn came. Re-running starchart with a larger --max-source-total includes it.`,
          };
    case "missing":
      return {
        title: "The source for this file could not be loaded",
        body: "Its chunk under data/source did not load. If the report was copied, check that the data folder came with it.",
      };
  }
}
