/**
 * React access to file contents through state/loaders.getSource.
 *
 * getSource already shares chunk loads; this adds a synchronous cache of settled results so a
 * file that was read once (by the reader, or by the record's reference snippets) renders on
 * the first frame next time instead of flashing a loading state for one microtask.
 */

import { useEffect, useState } from "react";
import { getSource, type SourceUnavailable } from "../state/loaders";

export type SourceState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "unavailable"; reason: SourceUnavailable };

const settled = new Map<number, SourceState>();

function toState(r: Awaited<ReturnType<typeof getSource>>): Exclude<SourceState, { status: "loading" }> {
  return "text" in r ? { status: "ready", text: r.text } : { status: "unavailable", reason: r.unavailable };
}

/** Contents of a file id (or null for none), loading on first use. */
export function useSourceText(fileId: number | null): SourceState {
  const [state, setState] = useState<{ id: number | null; value: SourceState }>(() => ({
    id: fileId,
    value: fileId === null ? { status: "loading" } : (settled.get(fileId) ?? { status: "loading" }),
  }));

  useEffect(() => {
    if (fileId === null) return;
    const known = settled.get(fileId);
    if (known) {
      setState({ id: fileId, value: known });
      return;
    }
    let live = true;
    setState({ id: fileId, value: { status: "loading" } });
    void getSource(fileId).then((r) => {
      const value = toState(r);
      // A failed chunk load may succeed on a later try (loaders drops it from its cache), so
      // only results that cannot change are remembered.
      if (value.status === "ready" || value.reason !== "missing") settled.set(fileId, value);
      if (live) setState({ id: fileId, value });
    });
    return () => {
      live = false;
    };
  }, [fileId]);

  if (fileId === null) return { status: "loading" };
  // Between a file change and the effect above, the old file's state must not show.
  if (state.id !== fileId) return settled.get(fileId) ?? { status: "loading" };
  return state.value;
}

const split = new Map<number, { text: string; lines: string[] }>();

/**
 * A file's lines, split once per file: the record's reference list asks for one line at a time
 * from files with hundreds of references, and re-splitting a 10k-line file per row adds up.
 */
export function linesOf(fileId: number, text: string): string[] {
  const hit = split.get(fileId);
  if (hit && hit.text === text) return hit.lines;
  const lines = text.split("\n");
  split.set(fileId, { text, lines });
  // Keep the cache to the files a reader is plausibly moving between.
  if (split.size > 64) split.delete(split.keys().next().value!);
  return lines;
}
