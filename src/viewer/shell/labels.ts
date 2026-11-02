/**
 * Words the shell shows for the report's enums, in one place so the record, the explorer, the
 * palette and the findings never name the same thing two ways.
 */

import { SymbolFlag, type Severity, type SymbolKind } from "../../shared/schema";
import type { Gravity } from "../../shared/web";
import type { ColorBy, SizeBy } from "../state/store";

export const SYMBOL_KIND_LABEL: Record<SymbolKind, string> = {
  function: "Function",
  method: "Method",
  constructor: "Constructor",
  getter: "Getter",
  setter: "Setter",
  property: "Property",
  variable: "Variable",
  class: "Class",
  interface: "Interface",
  type: "Type alias",
  enum: "Enum",
  namespace: "Namespace",
  component: "React component",
  hook: "React hook",
  module: "Module",
};

/** Flag bits worth a badge, in reading order. "component"/"hook" come from the kind instead. */
const FLAG_LABELS: [number, string][] = [
  [SymbolFlag.exported, "exported"],
  [SymbolFlag.defaultExport, "default export"],
  [SymbolFlag.unusedExport, "unused export"],
  [SymbolFlag.async, "async"],
  [SymbolFlag.generator, "generator"],
  [SymbolFlag.static, "static"],
  [SymbolFlag.abstract, "abstract"],
  [SymbolFlag.private, "private"],
  [SymbolFlag.protected, "protected"],
  [SymbolFlag.deprecated, "deprecated"],
  [SymbolFlag.test, "test"],
  [SymbolFlag.ambient, "ambient"],
];

export function symbolFlagLabels(flags: number, kind: SymbolKind): string[] {
  const out: string[] = [];
  if (kind === "component") out.push("component");
  if (kind === "hook") out.push("hook");
  for (const [bit, label] of FLAG_LABELS) if (flags & bit) out.push(label);
  return out;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "warning", "notice", "info"];
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  notice: "Notice",
  info: "For information",
};

export const COLOR_BY_LABEL: Record<ColorBy, string> = {
  language: "Language",
  category: "Category",
  churn: "Churn",
  age: "Age",
  complexity: "Complexity",
  ownership: "Ownership",
  hotspot: "Hotspot",
  rank: "PageRank",
};

/** What each color mode measures, for the select's second line. */
export const COLOR_BY_HINT: Record<ColorBy, string> = {
  language: "Detected language",
  category: "What the file is for",
  churn: "Commits that touched it",
  age: "Time since its last change",
  complexity: "Decision points in the code",
  ownership: "Top author's share of lines",
  hotspot: "Churn × complexity",
  rank: "How depended on it is",
};

export const SIZE_BY_LABEL: Record<SizeBy, string> = {
  lines: "Lines",
  bytes: "Bytes",
  complexity: "Complexity",
  commits: "Commits",
  rank: "PageRank",
};

// ─── The report's generation time ────────────────────────────────────────────────────────────

/**
 * When the report was written, in the reader's own time zone with the zone named:
 * { date: "Oct 31, 2026", time: "11:44 PM CDT" }. The rail used the UTC calendar date and About
 * the local clock, so a report written late in the evening read "Nov 1" in one place and
 * "October 31" in the other. Local wins because it is when the reader's team ran it; the zone
 * is named so a link shared across zones cannot be misread. Two parts so the narrow rail can
 * break between them, never inside one. `timeZone` is for tests.
 */
export function generatedParts(iso: string, timeZone?: string): { date: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: iso, time: "" };
  const date = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(at);
  return { date, time };
}

/** "Oct 31, 2026, 11:44 PM CDT": the one written form of generatedParts. */
export function formatGenerated(iso: string, timeZone?: string): string {
  const { date, time } = generatedParts(iso, timeZone);
  return time ? `${date}, ${time}` : date;
}

/** Modes that read git history; disabled when the report has none. */
export const NEEDS_GIT = new Set<ColorBy | SizeBy>(["churn", "age", "ownership", "hotspot", "commits"]);

/** Gravity modes as the menu, the legend and the command palette name them. */
export const GRAVITY_LABEL: Record<Gravity, string> = {
  dependencies: "Dependencies",
  complexity: "Complexity",
  hotspots: "Hotspots",
  churn: "Churn",
  recent: "Recent change",
  size: "Size",
};

/** One line per mode: what makes a file heavy. The menu shows it under the name. */
export const GRAVITY_HINT: Record<Gravity, string> = {
  dependencies: "Files many others import are heaviest",
  complexity: "The most complex files are heaviest",
  hotspots: "Complex files that change often are heaviest",
  churn: "The most-committed files are heaviest",
  recent: "The most recently changed files are heaviest",
  size: "The files with the most code are heaviest",
};
