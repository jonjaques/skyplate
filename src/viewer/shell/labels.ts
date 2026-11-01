/**
 * Words the shell shows for the report's enums, in one place so the record, the explorer, the
 * palette and the findings never name the same thing two ways.
 */

import { SymbolFlag, type Severity, type SymbolKind } from "../../shared/schema";
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

/** Modes that read git history; disabled when the report has none. */
export const NEEDS_GIT = new Set<ColorBy | SizeBy>(["churn", "age", "ownership", "hotspot", "commits"]);
