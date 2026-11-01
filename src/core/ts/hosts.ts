/**
 * Uses of TypeScript / JavaScript exports from files the compiler never reads.
 *
 *   applyHostImports(symbols, imports, hostFiles)   mutates `symbols`
 *
 * The compiler analyzes .ts/.tsx/.js and nothing else, so a composable imported only by Vue
 * components and VitePress pages looked like dead code: vite's `useSponsor` read "Exported,
 * but nothing outside sponsor.ts uses it" while AsideSponsors.vue, Layout.vue and
 * acknowledgements.md all import it. The import extractor already reads those files' scripts
 * for the file graph; it records the names each statement takes (ExtractedImport.names), the
 * pipeline resolves the specifier to a file, and this matches the names to that file's
 * exports.
 *
 * What a match does, and deliberately does not:
 * - clears SymbolFlag.unusedExport (and keeps stats.unusedExports in step), because the claim
 *   "nothing uses it" is now false;
 * - records one CodeSymbols.hostUses row per (symbol, importing file), so the record can name
 *   those files;
 * - does not add RefTable rows or touch refs / callers / files. Those count what the checker
 *   resolved, use by use; an import line says the component takes the name, not how often or
 *   how its template calls it. Inventing call rows from it would put guesses in the hierarchy.
 *
 * Matching is by exported name, so it is as good as a name can be and no better:
 * - `export { a } from "./x"` in a barrel is followed (the checker already resolved those to
 *   the declaration, as `export` reference rows in the barrel); `export *` chains and
 *   `export { a as b }` renames are not, so a host importing through one of those still misses;
 * - `import * as ns` marks every export of the module used, since which members the template
 *   reads is not known;
 * - a specifier the file resolver cannot place (a bundler alias it does not know) matches
 *   nothing. stats.hostFiles is there so the viewer can hedge for exactly that.
 */

import { REF_KINDS, SymbolFlag, type CodeSymbols } from "../../shared/schema";

export interface HostImport {
  /** The importing file: a Vue / Svelte / Astro / HTML component, a Markdown or MDX page. */
  from: number;
  /** The file the specifier resolved to. */
  to: number;
  /** 0-based line of the statement in `from`. */
  line: number;
  /** ExtractedImport.names: exported names, "default", or "*". */
  names: string[];
}

interface Exports {
  named: Map<string, number[]>;
  defaults: number[];
  all: Set<number>;
}

const EXPORT = REF_KINDS.indexOf("export");

/**
 * `hostFiles` is how many files outside the compiler's reach had script imports at all,
 * resolved or not; it becomes stats.hostFiles (omitted when 0).
 */
export function applyHostImports(symbols: CodeSymbols, imports: readonly HostImport[], hostFiles: number): void {
  if (hostFiles > 0) symbols.stats.hostFiles = hostFiles;
  const t = symbols.symbols;
  const targets = new Map<number, Exports>();
  for (const imp of imports) {
    if (imp.names.length && (symbols.moduleSymbol[imp.to] ?? -1) >= 0 && !targets.has(imp.to)) {
      targets.set(imp.to, { named: new Map(), defaults: [], all: new Set() });
    }
  }
  if (!targets.size) return;

  const addNamed = (e: Exports, name: string, s: number) => {
    const list = e.named.get(name);
    if (!list) e.named.set(name, [s]);
    else if (!list.includes(s)) list.push(s);
    e.all.add(s);
  };
  // Top-level exports declared in each target...
  for (let s = 0; s < t.name.length; s++) {
    const e = targets.get(t.file[s]!);
    if (!e || t.parent[s] !== -1 || t.kind[s] === "module" || !(t.flags[s]! & SymbolFlag.exported)) continue;
    addNamed(e, t.name[s]!, s);
    if (t.flags[s]! & SymbolFlag.defaultExport) e.defaults.push(s);
  }
  // ...and what each re-exports by name, which the checker resolved to the declaration.
  const r = symbols.refs;
  for (const [f, e] of targets) {
    for (let i = symbols.fileRefStart[f]!; i < symbols.fileRefStart[f + 1]!; i++) {
      if (r.kind[i] === EXPORT && t.kind[r.symbol[i]!] !== "module") addNamed(e, t.name[r.symbol[i]!]!, r.symbol[i]!);
    }
  }

  const fileCount = symbols.moduleSymbol.length;
  const uses = new Map<number, number>(); // symbol · files + importing file → line
  for (const imp of imports) {
    const e = targets.get(imp.to);
    if (!e) continue;
    for (const name of imp.names) {
      const hits = name === "*" ? e.all : name === "default" ? e.defaults : (e.named.get(name) ?? []);
      for (const s of hits) {
        const key = s * fileCount + imp.from;
        if (!uses.has(key)) uses.set(key, imp.line);
      }
    }
  }
  if (!uses.size) return;

  const rows: NonNullable<CodeSymbols["hostUses"]> = { symbol: [], file: [], line: [] };
  for (const key of [...uses.keys()].sort((a, b) => a - b)) {
    const file = key % fileCount;
    const s = (key - file) / fileCount;
    rows.symbol.push(s);
    rows.file.push(file);
    rows.line.push(uses.get(key)!);
    if (t.flags[s]! & SymbolFlag.unusedExport) {
      t.flags[s]! &= ~SymbolFlag.unusedExport;
      symbols.stats.unusedExports--;
    }
  }
  symbols.hostUses = rows;
}
