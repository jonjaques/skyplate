/**
 * Growable columnar storage for symbols and references while the passes run.
 *
 * The finished report wants plain `number[]` columns, but a large repository produces millions
 * of references; Int32Array columns hold them at 4 bytes a field until the final sort, half of
 * a plain array's 8-byte element slots, and grow by doubling instead of element by element.
 */

import { REF_KINDS, type RefKind, type SymbolKind } from "../../shared/schema";

export const REF = Object.fromEntries(REF_KINDS.map((k, i) => [k, i])) as Record<RefKind, number>;

export const CALLABLE: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  "function",
  "method",
  "constructor",
  "getter",
  "setter",
  "component",
  "hook",
]);

/**
 * Kinds whose checker type is worth printing. Classes print as `typeof Foo`, interfaces and
 * type aliases as their own name, so those keep the declaration header the AST gives for free.
 */
export const CHECKER_SIGNATURE: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  "function",
  "method",
  "getter",
  "setter",
  "property",
  "variable",
  "component",
  "hook",
]);

// ─── Per-file declaration index ──────────────────────────────────────────────────────────────

export interface FileDecls {
  fileId: number;
  moduleSymbol: number;
  /**
   * Declaration node index → symbol, for nodes that open the symbol's scope: references
   * beneath them are made *by* that symbol. Overloads put several nodes on one symbol.
   */
  scopes: Map<number, number>;
  /**
   * Extra node indexes the checker may name as a declaration of one of our symbols without the
   * node being its scope: `module.exports = {}` (the file's export=), the shorthand members of
   * an exported object literal, a class expression behind its variable. Never consulted by the
   * walk, so a reference inside them is not mistaken for self-reference.
   */
  aliases: Map<number, number>;
  /** Node indexes of our declarations' own name identifiers. They are never references. */
  names: Set<number>;
}

// ─── Symbols ─────────────────────────────────────────────────────────────────────────────────

export interface NewSymbol {
  name: string;
  kind: SymbolKind;
  file: number;
  line: number;
  col: number;
  endLine: number;
  parent: number;
  flags: number;
  signature: string;
  doc: string;
  params: number;
}

export class SymbolStore {
  readonly name: string[] = [];
  readonly kind: SymbolKind[] = [];
  readonly file: number[] = [];
  readonly line: number[] = [];
  readonly col: number[] = [];
  readonly endLine: number[] = [];
  readonly parent: number[] = [];
  readonly flags: number[] = [];
  readonly signature: string[] = [];
  readonly doc: string[] = [];
  readonly complexity: number[] = [];
  readonly params: number[] = [];

  /** Canonical SourceFile.path → its declarations. NodeHandle.path is in the same form. */
  readonly files = new Map<string, FileDecls>();
  /** Set once the reference pass has asked the checker for a symbol's type. */
  readonly sigRequested: boolean[] = [];

  get size(): number {
    return this.name.length;
  }

  add(s: NewSymbol): number {
    const id = this.name.length;
    this.name.push(s.name);
    this.kind.push(s.kind);
    this.file.push(s.file);
    this.line.push(s.line);
    this.col.push(s.col);
    this.endLine.push(s.endLine);
    this.parent.push(s.parent);
    this.flags.push(s.flags);
    this.signature.push(s.signature);
    this.doc.push(s.doc);
    // McCabe: one path through any callable, plus one per decision point the walk finds.
    this.complexity.push(CALLABLE.has(s.kind) ? 1 : 0);
    this.params.push(s.params);
    this.sigRequested.push(!CHECKER_SIGNATURE.has(s.kind));
    return id;
  }
}

// ─── References ──────────────────────────────────────────────────────────────────────────────

class IntColumn {
  data = new Int32Array(1024);
  push(i: number, v: number): void {
    if (i >= this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[i] = v;
  }
}

/** Every resolved reference, in arrival order. `pos` is kept only to sort within a file. */
export class RefStore {
  length = 0;
  readonly symbol = new IntColumn();
  readonly file = new IntColumn();
  readonly pos = new IntColumn();
  readonly line = new IntColumn();
  readonly col = new IntColumn();
  readonly len = new IntColumn();
  readonly kind = new IntColumn();
  readonly from = new IntColumn();

  push(symbol: number, file: number, pos: number, line: number, col: number, len: number, kind: number, from: number): void {
    const i = this.length++;
    this.symbol.push(i, symbol);
    this.file.push(i, file);
    this.pos.push(i, pos);
    this.line.push(i, line);
    this.col.push(i, col);
    this.len.push(i, len);
    this.kind.push(i, kind);
    this.from.push(i, from);
  }
}
