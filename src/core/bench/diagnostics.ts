/** A numeric side channel. Never retain a diagnostic's message or an import's spelling. */
export const DIAGNOSTIC_CODES = [
  "unclassified_warning",
  "history_insufficient",
  "history_boundary",
  "git_shallow",
  "git_commit_cap",
  "dependencies_missing",
  "unreadable_file",
  "text_read_cap",
  "binary_read_cap",
  "git_failed",
  "git_unavailable",
  "git_rename_limit",
  "git_move_limit",
  "ts_failed",
  "ts_file_cap",
  "ts_reference_cap",
  "ts_config_unreadable",
  "ts_config_circular",
  "ts_config_base",
  "ts_config_solution",
  "ts_config_invalid",
  "ts_config_failed",
  "ts_timeout",
  "ts_read_failed",
  "ts_resolve_failed",
  "ts_notice",
  "resolver_failed",
  "package_sibling_cap",
  "uninstalled_manifests",
  "pagerank_iteration_cap",
  "module_split_cap",
  "git_coupling_cap",
  "rust_use_cap",
  "rust_statement_cap",
] as const;
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type DiagnosticSink = (code: DiagnosticCode, count?: number) => void;
export const SPECIFIER_SHAPES = ["relative", "absolute", "url", "alias", "scoped", "dotted", "bare", "other"] as const;
export type SpecifierShape = (typeof SPECIFIER_SHAPES)[number];
export function specifierShape(spec: string): SpecifierShape {
  if (/^\.{1,2}(?:\/|$)/.test(spec)) return "relative";
  if (/^(?:\/|[a-z]:[\\/])/i.test(spec)) return "absolute";
  if (/^[a-z][\w+.-]*:/i.test(spec)) return "url";
  if (/^[#~]|^@\//.test(spec)) return "alias";
  if (/^@[^/]+\//.test(spec)) return "scoped";
  if (/^[\w]+(?:\.[\w]+)+$/.test(spec)) return "dotted";
  if (/^[\w./@-]+$/.test(spec)) return "bare";
  return "other";
}
export interface ImportCounts {
  internal: number;
  external: number;
  unresolved: number;
  shapes: Partial<Record<SpecifierShape, number>>;
}
export class AnalysisDiagnostics {
  constructor(private readonly onFailure?: (error: unknown, phase: string) => void) {}
  failure(error: unknown, phase: string): void {
    this.onFailure?.(error, phase);
  }
  readonly counts = new Map<DiagnosticCode, number>();
  readonly imports = new Map<string, ImportCounts>();
  workers: Record<string, number> = {};
  readonly add: DiagnosticSink = (code, count = 1) => {
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  };
  import(language: string, result: "internal" | "external" | "unresolved", spec: string): void {
    let row = this.imports.get(language);
    if (!row) this.imports.set(language, (row = { internal: 0, external: 0, unresolved: 0, shapes: {} }));
    row[result]++;
    if (result === "unresolved") {
      const shape = specifierShape(spec);
      row.shapes[shape] = (row.shapes[shape] ?? 0) + 1;
    }
  }
}
