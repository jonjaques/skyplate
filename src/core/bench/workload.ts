/**
 * The agent-facing cost of this project: one canned question per MCP tool, timed and sized.
 *
 * On a large repository the bug an agent meets is rarely a wrong answer. It is an answer that
 * takes seconds or fills its context, and neither shows in a test suite built on small
 * fixtures. Each question's input is picked from the project by rank (its top hotspot, its
 * most-referenced symbol, its largest directory), so the input never leaves this function:
 * only the rank's label, the time and the size do.
 */

import * as query from "../../mcp/query";
import type { AnalysisResult } from "../pipeline";
import { coarse, duration, safeFailure } from "./privacy";

export interface QueryMeasurement {
  tool: string;
  rank: string;
  status: string;
  ms: number;
  responseBytes: number;
  tokens: number;
  truncated: number;
  error: string;
}
/** Rank chooses the private input; only fixed rank labels and response sizes leave this function. */
export async function measureQueries({ report: r, symbols: s }: AnalysisResult): Promise<QueryMeasurement[]> {
  const rows: QueryMeasurement[] = [];
  const run = async (tool: string, rank: string, f: () => unknown, available = true) => {
    if (!available) {
      rows.push({ tool, rank, status: "skipped", ms: 0, responseBytes: 0, tokens: 0, truncated: 0, error: "none" });
      return;
    }
    const started = performance.now();
    try {
      // Include JSON serialization, since that cost and payload reach every MCP client.
      const answer = await f();
      const bytes = Buffer.byteLength(JSON.stringify(answer) ?? "");
      let truncated = 0;
      const stack: unknown[] = [answer];
      while (stack.length) {
        const value = stack.pop();
        if (value && typeof value === "object")
          for (const [key, child] of Object.entries(value)) {
            if ((key === "more" || key.endsWith("More")) && typeof child === "number" && child > 0) truncated += child;
            else if (child && typeof child === "object") stack.push(child);
          }
      }
      rows.push({
        tool,
        rank,
        status: "ok",
        ms: duration(performance.now() - started),
        responseBytes: coarse(bytes),
        tokens: coarse(Math.ceil(bytes / 4)),
        truncated: coarse(truncated),
        error: "none",
      });
    } catch (e) {
      rows.push({
        tool,
        rank,
        status: "failed",
        ms: duration(performance.now() - started),
        responseBytes: 0,
        tokens: 0,
        truncated: 0,
        error: safeFailure(e, "unknown").error,
      });
    }
  };
  const rankedFiles = [...r.files].sort((a, b) => b.hotspot - a.hotspot || b.complexity - a.complexity || a.id - b.id);
  const sizeFiles = [...r.files].sort((a, b) => a.lines - b.lines || a.id - b.id);
  const dirs = r.dirs.filter((d) => d.id !== 0).sort((a, b) => b.totalFiles - a.totalFiles || a.id - b.id);
  const top = rankedFiles[0];
  const median = sizeFiles[Math.floor(sizeFiles.length / 2)];
  const largest = dirs[0] ?? r.dirs[0];
  const midDir = dirs[Math.floor(dirs.length / 2)] ?? r.dirs[0];
  let sym = -1;
  if (s) for (let i = 0; i < s.symbols.name.length; i++) if (sym < 0 || s.symbols.refs[i]! > s.symbols.refs[sym]!) sym = i;
  // A term for locate_code: the top hotspot's file name without its extension. No source is
  // read here (the tool's content scan needs a live project's reader), so this measures the
  // ranking over paths, symbols, docs and commits.
  const term = top?.path.split("/").pop()!.split(".")[0];
  await run("overview", "cold", () => query.overview(r));
  await run("map_codebase", "cold", () => query.mapCodebase(r, s));
  await run("locate_code", "top_hotspot", () => query.locateCode(r, s, { query: term! }), !!term);
  await run("change_impact", "top_hotspot", () => query.changeImpact(r, s, { paths: [top!.path] }), !!top);
  await run("change_impact", "most_referenced", () => query.changeImpact(r, s, { symbols: [{ id: sym }] }), sym >= 0);
  await run("files", "top_hotspot", () => query.files(r, { sort: "hotspot", limit: 40 }));
  await run("dir", "largest_directory", () => query.dir(r, largest!.path), !!largest);
  await run("dir", "median_directory", () => query.dir(r, midDir!.path), !!midDir);
  await run("file", "top_hotspot", () => query.file(r, s, top!.path), !!top);
  await run("file", "median_file", () => query.file(r, s, median!.path), !!median);
  await run("symbol", "most_referenced", () => query.symbol(r, s, sym), sym >= 0);
  await run("search_symbols", "most_referenced", () => query.searchSymbols(r, s, { query: s!.symbols.name[sym], limit: 40 }), sym >= 0);
  await run("seams", "cold", () => query.seams(r, s, { limit: 40 }));
  await run("seam", "largest_directory", () => query.seam(r, s, largest!.path), !!largest);
  await run("seam", "median_directory", () => query.seam(r, s, midDir!.path), !!midDir);
  await run("graph", "top_hotspot", () => query.graph(r, { view: "dependents", path: top!.path }), !!top);
  await run("history", "cold", () => query.history(r, { view: "summary" }), !!r.git);
  await run("dependencies", "cold", () => query.dependencies(r, { limit: 40 }));
  await run("overview", "warm", () => query.overview(r));
  return rows;
}
