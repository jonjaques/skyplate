/**
 * The slice every chart on the Charts tab draws from, computed once per change of the filter
 * row and handed down through context. One slice is what keeps the numbers agreeing: the
 * treemap, the scatter and the table can never be counting different files.
 */

import { createContext, useContext } from "react";
import type { Report } from "../../shared/schema";
import type { Surface } from "../lib/colors";
import type { Model } from "../model/indices";
import type { Filters } from "../state/store";
import { DAY, hasHistory, scopeCommits, scopeFiles, type FileScope } from "./data";

export type RangeKey = "all" | "12m" | "90d" | "30d";

export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "all", label: "All history", days: null },
  { key: "12m", label: "12 months", days: 365 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "30d", label: "30 days", days: 30 },
];

export interface ChartScope {
  report: Report;
  model: Model;
  surface: Surface;
  filters: Filters;
  files: FileScope;
  range: RangeKey;
  /**
   * Start of the time range (unix seconds), or null for all history. Measured back from the
   * newest commit, not today: a report generated a year ago should still show its last 90
   * days of work, not an empty window.
   */
  from: number | null;
  /** Scoped commit indices, or null when the report has no history to chart. */
  commits: Int32Array | null;
  history: boolean;
  /** "in the last 90 days", "" for all history: appended to subtitles. */
  rangePhrase: string;
}

export function buildScope(
  report: Report,
  model: Model,
  surface: Surface,
  filters: Filters,
  focusDir: number | null,
  range: RangeKey,
): ChartScope {
  const files = scopeFiles(report, model, filters, focusDir);
  const history = hasHistory(report);
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  const from = history && days !== null ? report.git!.last - days * DAY : null;
  const commits = history ? scopeCommits(report.git!, files, from) : null;
  const rangePhrase = from === null ? "" : days === 365 ? "in the last 12 months" : `in the last ${days} days`;
  return { report, model, surface, filters, files, range, from, commits, history, rangePhrase };
}

export const ScopeContext = createContext<ChartScope | null>(null);

export function useScope(): ChartScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("useScope outside ChartsView");
  return scope;
}

