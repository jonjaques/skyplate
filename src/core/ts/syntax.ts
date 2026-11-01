/**
 * AST vocabulary shared by the declaration and reference passes.
 *
 * The TypeScript 7 API hands back `RemoteNode`s: one class whose getters decode any property
 * (name, body, members…) lazily from the binary AST, returning undefined when the node's kind
 * has no such child. The published per-kind interfaces would force a type guard before every
 * property read, so this module describes the remote node structurally instead and converts at
 * the boundary (`ts` / `node`). Everything read here was checked against
 * node_modules/typescript/dist/api/node/node.generated.js.
 */

import {
  getTextOfJSDocComment,
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  type Node,
} from "typescript/unstable/ast";

// ─── The remote node, structurally ───────────────────────────────────────────────────────────

export interface TsNode {
  readonly kind: SyntaxKind;
  readonly flags: number;
  readonly pos: number;
  readonly end: number;
  readonly parent: TsNode;
  /**
   * Slot of the node in its file's flat node table. A NodeHandle (symbol.declarations) carries
   * the same number, so (SourceFile.path, index) is the join key between "the checker says this
   * symbol is declared at X" and "our walk created symbol N at X".
   */
  readonly index: number;
  readonly text?: string;
  readonly jsDoc?: readonly TsNode[];
  readonly modifierFlags: number;
  forEachChild<T>(visit: (node: TsNode) => T): T | undefined;
  getStart(): number;
  getSourceFile(): TsSourceFile;

  // Children by name. Each is undefined when absent or not part of the node's kind.
  readonly name?: TsNode;
  readonly propertyName?: TsNode;
  readonly body?: TsNode;
  readonly expression?: TsNode;
  readonly initializer?: TsNode;
  readonly left?: TsNode;
  readonly right?: TsNode;
  readonly operatorToken?: TsNode;
  readonly operand?: TsNode;
  readonly operator?: SyntaxKind;
  readonly token?: SyntaxKind;
  readonly tag?: TsNode;
  readonly tagName?: TsNode;
  readonly typeName?: TsNode;
  readonly exprName?: TsNode;
  readonly indexType?: TsNode;
  readonly argumentExpression?: TsNode;
  readonly declarationList?: TsNode;
  readonly type?: TsNode;
  readonly exportClause?: TsNode;
  readonly moduleSpecifier?: TsNode;
  readonly asteriskToken?: TsNode;
  readonly isExportEquals?: boolean;
  readonly comment?: string | readonly TsNode[];
  readonly statements?: readonly TsNode[];
  readonly members?: readonly TsNode[] & { readonly pos: number };
  readonly parameters?: readonly TsNode[];
  readonly declarations?: readonly TsNode[];
  readonly elements?: readonly TsNode[];
  readonly properties?: readonly TsNode[];
  readonly arguments?: readonly TsNode[];
  readonly tags?: readonly TsNode[];
}

export interface TsSourceFile extends TsNode {
  readonly text: string;
  /** Canonical path (lowercased on case-insensitive file systems), as NodeHandle.path. */
  readonly path: string;
  readonly fileName: string;
  readonly statements: readonly TsNode[];
  readonly isDeclarationFile: boolean;
  getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}

export const ts = (node: Node): TsNode => node as unknown as TsNode;
export const node = (n: TsNode): Node => n as unknown as Node;

export { ModifierFlags, NodeFlags, SyntaxKind };

const K = SyntaxKind;

// ─── Classification helpers ──────────────────────────────────────────────────────────────────

export function isFunctionLike(n: TsNode | undefined): boolean {
  if (!n) return false;
  const k = n.kind;
  return (
    k === K.ArrowFunction ||
    k === K.FunctionExpression ||
    k === K.FunctionDeclaration ||
    k === K.MethodDeclaration ||
    k === K.Constructor ||
    k === K.GetAccessor ||
    k === K.SetAccessor
  );
}

/** Peel parentheses and type-only wrappers, which change nothing about what a value is. */
export function skipOuter(n: TsNode | undefined): TsNode | undefined {
  while (
    n &&
    (n.kind === K.ParenthesizedExpression ||
      n.kind === K.AsExpression ||
      n.kind === K.SatisfiesExpression ||
      n.kind === K.NonNullExpression ||
      n.kind === K.TypeAssertionExpression)
  ) {
    n = n.expression;
  }
  return n;
}

export function isAssignmentOperator(kind: SyntaxKind | undefined): boolean {
  return kind !== undefined && kind >= K.FirstAssignment && kind <= K.LastAssignment;
}

/** `exports.x`, `module.exports.x`, or the bare `module.exports` / `exports` targets. */
export function commonJsTarget(n: TsNode | undefined): { name: string } | "module" | undefined {
  n = skipOuter(n);
  if (!n) return undefined;
  if (n.kind === K.Identifier && n.text === "exports") return "module";
  if (n.kind !== K.PropertyAccessExpression || !n.name || !n.expression) return undefined;
  const obj = n.expression;
  const prop = n.name.text ?? "";
  if (obj.kind === K.Identifier && obj.text === "module" && prop === "exports") return "module";
  if (obj.kind === K.Identifier && obj.text === "exports") return { name: prop };
  if (
    obj.kind === K.PropertyAccessExpression &&
    obj.expression?.kind === K.Identifier &&
    obj.expression.text === "module" &&
    obj.name?.text === "exports"
  ) {
    return { name: prop };
  }
  return undefined;
}

/**
 * `require("x")`, or with `accessed`, also `require("x").y`. The difference matters: tsgo
 * binds `const a = require("x")` (and destructuring of it) as an import alias, but
 * `const b = require("x").y` as an ordinary variable whose initializer reads the export.
 */
export function isRequireCall(n: TsNode | undefined, accessed = false): boolean {
  n = skipOuter(n);
  while (accessed && n && n.kind === K.PropertyAccessExpression) n = skipOuter(n.expression);
  return (
    !!n &&
    n.kind === K.CallExpression &&
    n.expression?.kind === K.Identifier &&
    n.expression.text === "require" &&
    n.arguments?.length === 1
  );
}

/** Display name of a declaration name node, or undefined for binding patterns. */
export function nameText(name: TsNode | undefined, sf: TsSourceFile): string | undefined {
  if (!name) return undefined;
  switch (name.kind) {
    case K.Identifier:
    case K.PrivateIdentifier:
    case K.StringLiteral:
    case K.NumericLiteral:
    case K.NoSubstitutionTemplateLiteral:
      return name.text;
    case K.ComputedPropertyName:
      return sf.text.slice(name.getStart(), name.end);
    default:
      return undefined;
  }
}

/** JSX anywhere in a function body, not counting nested functions' own bodies. */
export function containsJsx(body: TsNode | undefined): boolean {
  if (!body) return false;
  const stack: TsNode[] = [body];
  while (stack.length) {
    const n = stack.pop()!;
    const k = n.kind;
    if (k === K.JsxElement || k === K.JsxSelfClosingElement || k === K.JsxFragment) return true;
    if (n !== body && isFunctionLike(n)) continue;
    n.forEachChild((c) => {
      stack.push(c);
    });
  }
  return false;
}

// ─── JSDoc ───────────────────────────────────────────────────────────────────────────────────

/**
 * The JSDoc block that documents `n`: the last one before it (TypeScript's own rule when a
 * declaration carries several). Variable declarations borrow their statement's.
 */
export function jsDocOf(n: TsNode): TsNode | undefined {
  let docs = n.jsDoc;
  if (!docs?.length && n.kind === K.VariableDeclaration) docs = n.parent?.parent?.jsDoc;
  return docs?.length ? docs[docs.length - 1] : undefined;
}

export function isDeprecated(doc: TsNode | undefined): boolean {
  if (!doc?.tags) return false;
  for (const tag of doc.tags) if (tag.kind === K.JSDocDeprecatedTag) return true;
  return false;
}

/**
 * First sentence of a JSDoc comment, ≤ 200 chars. A sentence ends at `.`, `!` or `?` followed
 * by whitespace and a capital (so "e.g. this" does not end one), or at a blank line.
 */
export function firstSentence(doc: TsNode | undefined): string {
  if (!doc) return "";
  // The remote node's comment is the string or JSDocText/JSDocLink list this helper expects.
  const raw = getTextOfJSDocComment(doc.comment as Parameters<typeof getTextOfJSDocComment>[0]) ?? "";
  const para = raw.split(/\n\s*\n/)[0] ?? "";
  const flat = para.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(?=\s+[A-Z0-9("'`[]|$)/.exec(flat);
  const s = m?.[1] ?? flat;
  return s.length > 200 ? s.slice(0, 199) + "…" : s;
}

// ─── Source text ─────────────────────────────────────────────────────────────────────────────

/** Collapse whitespace and cap at 240 chars, the signature column's budget. */
export function clip(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/**
 * Declaration header as written, without its body: `class Foo<T> extends Bar`,
 * `constructor(private radius: number)`, `type Id = string | number`. Used for kinds whose
 * checker type prints uselessly (`typeof Foo`) and as the fallback when the checker fails.
 */
export function headerText(n: TsNode, sf: TsSourceFile): string {
  // A function assigned to a property reads best with its target: `res.send = function send(body)`.
  if (isFunctionLike(n) && n.parent?.kind === K.BinaryExpression && n.parent.right?.index === n.index) n = n.parent;
  const start = n.getStart();
  let end = n.end;
  const k = n.kind;
  if (k === K.ClassDeclaration || k === K.ClassExpression || k === K.InterfaceDeclaration || k === K.EnumDeclaration) {
    const open = sf.text.lastIndexOf("{", n.members ? n.members.pos : end);
    if (open > start) end = open;
  } else if (k === K.ModuleDeclaration) {
    if (n.body) end = n.body.getStart();
  } else {
    // A function, or something holding one (`const f = () => …`, `exports.f = function …`,
    // `export default function …`): stop where its body starts.
    const fn = isFunctionLike(n) ? n : [n.initializer, n.right, n.expression].map(skipOuter).find(isFunctionLike);
    if (fn?.body) {
      end = fn.body.getStart();
      if (fn.kind === K.ArrowFunction) {
        const arrow = sf.text.lastIndexOf("=>", end);
        if (arrow > start) end = arrow;
      }
    }
  }
  // `export`, `default` and `declare` are flags on the record; repeating them is noise.
  const text = sf.text.slice(start, end).replace(/^(?:(?:export|default|declare)\s+)+/, "");
  return clip(text);
}
