/**
 * On-demand data: the code-intelligence tables and source chunks.
 *
 * Several views ask for the same data at once (the galaxy and the record both want symbols the
 * moment a function is picked; the record's reference snippets and the source reader both
 * want the same chunk). Every request goes through here so each file loads once, and
 * concurrent callers share the in-flight promise instead of racing to inject duplicate tags.
 */

import { loadSourceChunk, loadSymbols } from "../data/load";
import { useViewer } from "./store";

let symbolsInFlight: Promise<void> | null = null;

/** Load the symbol tables if the report has them. Resolves when ready (or absent/failed). */
export function ensureSymbols(): Promise<void> {
  const state = useViewer.getState();
  if (state.symbolsStatus === "ready" || state.symbolsStatus === "absent") return Promise.resolve();
  if (symbolsInFlight) return symbolsInFlight;
  const url = state.report?.symbols?.url;
  if (!url) return Promise.resolve();

  state.setSymbolsStatus("loading");
  symbolsInFlight = loadSymbols(url)
    .then((symbols) => useViewer.getState().setSymbols(symbols))
    .catch(() => useViewer.getState().setSymbolsStatus("error"))
    .finally(() => {
      symbolsInFlight = null;
    });
  return symbolsInFlight;
}

/** Why a file has no readable source, in the reader's words. */
export type SourceUnavailable =
  | "binary"
  | "secret" //    credentials are never embedded
  | "disabled" //  the report was written with --no-source
  | "too-large" // over the per-file cap or the total budget
  | "missing"; //  the chunk failed to load

const chunkCache = new Map<number, Promise<Record<number, string>>>();

/**
 * Contents of one file, or the reason there are none. Chunks are cached for the session;
 * they are a few megabytes at most and re-reading them costs a script injection each time.
 */
export async function getSource(fileId: number): Promise<{ text: string } | { unavailable: SourceUnavailable }> {
  const { report } = useViewer.getState();
  const file = report?.files[fileId];
  if (!report || !file) return { unavailable: "missing" };
  if (file.secret) return { unavailable: "secret" };
  if (file.binary) return { unavailable: "binary" };
  if (!report.source) return { unavailable: "disabled" };
  if (file.src < 0) return { unavailable: "too-large" };

  const url = report.source.chunks[file.src];
  if (!url) return { unavailable: "missing" };
  let chunk = chunkCache.get(file.src);
  if (!chunk) {
    chunk = loadSourceChunk(file.src, url).then((c) => c.files);
    chunkCache.set(file.src, chunk);
    chunk.catch(() => chunkCache.delete(file.src));
  }
  try {
    const text = (await chunk)[fileId];
    return text === undefined ? { unavailable: "missing" } : { text };
  } catch {
    return { unavailable: "missing" };
  }
}
