/**
 * Pass B: walk every node of a file, emit reference candidates and count decision points.
 *
 * Each Identifier / PrivateIdentifier that could name one of our symbols becomes a candidate:
 * the node (for the batched checker lookup), how it is used (REF kind, decided here from the
 * syntax around it), and who uses it (the innermost enclosing symbol of ours). Whether it
 * actually resolves to one of our symbols is the resolver's job; this pass only decides what
 * the use would be if it does.
 *
 * The walk is iterative with parallel arrays as the stack: generated code can nest thousands
 * deep (`a + b + c + …` chains parse as one left-deep tree), deep enough to risk overflowing
 * the call stack in a recursive walk.
 */

import { CALLABLE, REF, type FileDecls, type SymbolStore } from "./store";
import {
  commonJsTarget,
  headerText,
  isAssignmentOperator,
  isRequireCall,
  SyntaxKind as K,
  type TsNode,
  type TsSourceFile,
} from "./syntax";

/** Not a REF kind: the candidate asks for the checker symbol of one of our declarations. */
export const SIG = -1;
const SKIP = -2;

export const CAND_SHORTHAND = 1; // resolve with getShorthandAssignmentValueSymbol(parent)

/**
 * Property names that getSymbolAtLocation cannot attribute to the property they set or read:
 * a JSX attribute resolves to the attribute itself, an object-literal member to the literal's
 * own member, `{ label }` in a binding pattern to the new local. The property is found instead
 * through the container's type (contextual type of the attributes or literal, the type of the
 * pattern) and the name looked up in it.
 */
export class MemberBatch {
  name: string[] = [];
  container: TsNode[] = [];
  /** true: type of the container (binding patterns); false: its contextual type. */
  ownType: boolean[] = [];
  kind: number[] = [];
  from: number[] = [];
  file: number[] = [];
  pos: number[] = [];
  line: number[] = [];
  col: number[] = [];
  len: number[] = [];

  get size(): number {
    return this.name.length;
  }
}

/** Candidates awaiting one batched getSymbolAtLocation call. */
export class Batch {
  readonly members = new MemberBatch();
  nodes: TsNode[] = [];
  kind: number[] = [];
  from: number[] = []; //  enclosing symbol; for SIG, the symbol whose type is wanted
  file: number[] = [];
  pos: number[] = [];
  line: number[] = [];
  col: number[] = [];
  len: number[] = [];
  flags: number[] = [];
  /** SIG: the declaration (enclosing scope for typeToString). SHORTHAND: the assignment. */
  aux: (TsNode | undefined)[] = [];

  get size(): number {
    return this.nodes.length + this.members.size;
  }

  push(n: TsNode, kind: number, from: number, file: number, pos: number, line: number, col: number, len: number, flags: number, aux?: TsNode): void {
    this.nodes.push(n);
    this.kind.push(kind);
    this.from.push(from);
    this.file.push(file);
    this.pos.push(pos);
    this.line.push(line);
    this.col.push(col);
    this.len.push(len);
    this.flags.push(flags);
    this.aux.push(aux);
  }
}

export function walkReferences(sf: TsSourceFile, decls: FileDecls, store: SymbolStore, batch: Batch): void {
  const fileId = decls.fileId;
  const nodes: TsNode[] = [];
  const syms: number[] = []; //   enclosing symbol (the caller)
  const fns: number[] = []; //    symbol receiving decision points, or -1
  const types: boolean[] = []; // inside a type node

  const push = (n: TsNode, sym: number, fn: number, inType: boolean) => {
    nodes.push(n);
    syms.push(sym);
    fns.push(fn);
    types.push(inType);
  };
  // forEachChild visits children in order; a stack reverses them, which is harmless because
  // references are sorted by position at the end.
  sf.forEachChild((c) => {
    push(c, decls.moduleSymbol, -1, false);
  });

  while (nodes.length) {
    const n = nodes.pop()!;
    let sym = syms.pop()!;
    let fn = fns.pop()!;
    let inType = types.pop()!;
    const k = n.kind;

    const own = decls.scopes.get(n.index);
    if (own !== undefined) {
      sym = own;
      // A variable or class is not a function: its initializer's branches are nobody's.
      fn = CALLABLE.has(store.kind[own]!) ? own : -1;
      if (!store.sigRequested[own]) {
        store.sigRequested[own] = true;
        const target = sigNode(n);
        if (target) batch.push(target, SIG, own, fileId, 0, 0, 0, 0, 0, n);
        else store.signature[own] = headerText(n, sf);
      }
    }

    if (k === K.Identifier || k === K.PrivateIdentifier) {
      if (decls.names.has(n.index)) continue;
      const kind = classify(n, inType);
      const member = memberUse(n);
      if (kind === SKIP && !member) continue;
      const start = n.getStart();
      const lc = sf.getLineAndCharacterOfPosition(start);
      const len = n.end - start;
      if (kind !== SKIP) {
        const shorthand = n.parent.kind === K.ShorthandPropertyAssignment && same(n.parent.name, n);
        batch.push(n, kind, sym, fileId, start, lc.line, lc.character, len, shorthand ? CAND_SHORTHAND : 0, shorthand ? n.parent : undefined);
      }
      if (member) {
        const m = batch.members;
        m.name.push(n.text ?? "");
        m.container.push(member.container);
        m.ownType.push(member.ownType);
        m.kind.push(member.kind);
        m.from.push(sym);
        m.file.push(fileId);
        m.pos.push(start);
        m.line.push(lc.line);
        m.col.push(lc.character);
        m.len.push(len);
      }
      continue;
    }

    if (fn >= 0 && isDecision(n)) store.complexity[fn]!++;
    // Heritage expressions are TypeNodes to the compiler but values to a reader; their type
    // arguments are TypeNodes of their own and set the flag when the walk reaches them.
    if (!inType && k !== K.ExpressionWithTypeArguments && isTypeNodeKind(k)) inType = true;
    n.forEachChild((c) => {
      push(c, sym, fn, inType);
    });
  }
}

/** The identifier to ask the checker about for a declaration's type. */
function sigNode(n: TsNode): TsNode | undefined {
  // `exports.f = function () {}` is scoped at the function but named by the assignment, and
  // only the assignment's name carries the JSDoc-typed export symbol.
  const up = n.parent;
  if (up?.kind === K.BinaryExpression && same(up.right, n)) n = up;
  if (n.kind === K.BinaryExpression) {
    // CommonJS `exports.x = …`: the name is the property; `module.exports = …` names `exports`.
    const left = n.left;
    return left?.kind === K.PropertyAccessExpression ? left.name : left;
  }
  if (n.kind === K.ExportAssignment || n.kind === K.Constructor) return undefined;
  const name = n.name;
  return name && (name.kind === K.Identifier || name.kind === K.PrivateIdentifier || name.kind === K.StringLiteral) ? name : undefined;
}

// ─── Decision points ─────────────────────────────────────────────────────────────────────────

/**
 * McCabe decision points. `&&`, `||`, `??` (and their assignment forms) count because each is
 * a branch. Optional chaining does not: counting every `?.` would rank defensive code as
 * complex when it reads as a single straight path. `default:` is not a decision either.
 */
function isDecision(n: TsNode): boolean {
  switch (n.kind) {
    case K.IfStatement:
    case K.ConditionalExpression:
    case K.CaseClause:
    case K.ForStatement:
    case K.ForInStatement:
    case K.ForOfStatement:
    case K.WhileStatement:
    case K.DoStatement:
    case K.CatchClause:
      return true;
    case K.BinaryExpression: {
      const op = n.operatorToken?.kind;
      return (
        op === K.AmpersandAmpersandToken ||
        op === K.BarBarToken ||
        op === K.QuestionQuestionToken ||
        op === K.AmpersandAmpersandEqualsToken ||
        op === K.BarBarEqualsToken ||
        op === K.QuestionQuestionEqualsToken
      );
    }
  }
  return false;
}

function isTypeNodeKind(k: K): boolean {
  return (k >= K.FirstTypeNode && k <= K.LastTypeNode) || (k >= K.FirstJSDocNode && k <= K.LastJSDocNode);
}

// ─── Classification ──────────────────────────────────────────────────────────────────────────

const same = (a: TsNode | undefined, b: TsNode) => a !== undefined && a.index === b.index;

/** How an identifier is used, as a REF index, or SKIP when it cannot be a reference. */
function classify(id: TsNode, inType: boolean): number {
  const p = id.parent;
  switch (p.kind) {
    case K.PropertyAccessExpression:
      return same(p.name, id) ? usage(p, inType) : inType ? REF.type : REF.read;
    case K.QualifiedName: {
      let top = p;
      while (top.parent.kind === K.QualifiedName) top = top.parent;
      return top.parent.kind === K.ImportEqualsDeclaration ? REF.import : REF.type;
    }
    case K.TypeReference:
    case K.TypeQuery:
      return REF.type;
    case K.ImportSpecifier:
    case K.ExportSpecifier: {
      const kind = p.kind === K.ImportSpecifier ? REF.import : REF.export;
      if (same(p.propertyName, id)) return kind;
      // `{ a as b }`: `a` carries the reference; `b` is only the local (or exported) alias.
      return p.propertyName?.kind === K.Identifier ? SKIP : kind;
    }
    case K.ImportClause:
    case K.NamespaceImport:
    case K.ImportEqualsDeclaration:
      return REF.import;
    case K.NamespaceExport:
    case K.ExportAssignment:
      return REF.export;
    case K.ShorthandPropertyAssignment:
      if (!same(p.name, id)) return REF.read;
      return isModuleExportsObject(p.parent) ? REF.export : REF.read;
    case K.JsxOpeningElement:
    case K.JsxSelfClosingElement:
      return same(p.tagName, id) ? REF.jsx : REF.read;
    case K.JsxClosingElement:
      // One reference per element: the closing tag repeats the opening tag's name.
      return SKIP;
    case K.VariableDeclaration:
      if (!same(p.name, id)) return usage(id, inType);
      return isRequireCall(p.initializer) ? REF.import : SKIP;
    case K.BindingElement: {
      const fromRequire = requireRoot(p);
      if (same(p.propertyName, id)) return fromRequire ? REF.import : REF.read;
      if (same(p.name, id)) return fromRequire && !p.propertyName ? REF.import : SKIP;
      return usage(id, inType);
    }
    // Declaration names: the identifier *is* the declaration (locals, parameters, members of
    // object literals, and our own symbols, already filtered by FileDecls.names).
    case K.Parameter:
    case K.FunctionDeclaration:
    case K.FunctionExpression:
    case K.ClassDeclaration:
    case K.ClassExpression:
    case K.InterfaceDeclaration:
    case K.TypeAliasDeclaration:
    case K.EnumDeclaration:
    case K.EnumMember:
    case K.ModuleDeclaration:
    case K.MethodDeclaration:
    case K.MethodSignature:
    case K.PropertyDeclaration:
    case K.PropertySignature:
    case K.GetAccessor:
    case K.SetAccessor:
    case K.TypeParameter:
    case K.PropertyAssignment:
    case K.NamedTupleMember:
    case K.JSTypeAliasDeclaration:
      return same(p.name, id) ? SKIP : usage(id, inType);
    // JSX attribute names resolve to the attribute itself, not the props member; labels, meta
    // properties (`import.meta`) and namespaced JSX names never resolve to a declaration.
    case K.JsxAttribute:
    case K.JsxNamespacedName:
    case K.LabeledStatement:
    case K.BreakStatement:
    case K.ContinueStatement:
    case K.MetaProperty:
    case K.ImportAttribute:
    case K.NamespaceExportDeclaration:
      return SKIP;
  }
  return usage(id, inType);
}

/** Kind of use for an expression `e` (an identifier, or a property access naming the member). */
function usage(e: TsNode, inType: boolean): number {
  let p = e.parent;
  // `(fn)()`, `fn!()`: the wrappers do not change that it is the callee.
  while (p.kind === K.ParenthesizedExpression || p.kind === K.NonNullExpression) {
    e = p;
    p = p.parent;
  }
  switch (p.kind) {
    case K.CallExpression:
      return same(p.expression, e) ? REF.call : REF.read;
    case K.NewExpression:
      return same(p.expression, e) ? REF.new : REF.read;
    case K.TaggedTemplateExpression:
      return same(p.tag, e) ? REF.call : REF.read;
    case K.Decorator:
      return REF.call;
    case K.JsxOpeningElement:
    case K.JsxSelfClosingElement:
      return same(p.tagName, e) ? REF.jsx : REF.read;
    case K.JsxClosingElement:
      return same(p.tagName, e) ? SKIP : REF.read;
    case K.ExpressionWithTypeArguments: {
      const clause = p.parent;
      if (clause.kind === K.HeritageClause) return clause.token === K.ImplementsKeyword ? REF.implements : REF.extends;
      return REF.read;
    }
    case K.BinaryExpression:
      if (isAssignmentOperator(p.operatorToken?.kind) && same(p.left, e)) return REF.write;
      if (same(p.right, e) && p.operatorToken?.kind === K.EqualsToken && commonJsTarget(p.left)) return REF.export;
      return inType ? REF.type : REF.read;
    case K.PrefixUnaryExpression:
    case K.PostfixUnaryExpression:
      return p.operator === K.PlusPlusToken || p.operator === K.MinusMinusToken ? REF.write : REF.read;
    case K.ExportAssignment:
      return REF.export;
  }
  return inType ? REF.type : REF.read;
}

/**
 * A property name whose property is only reachable through its container's type, or
 * undefined. `{ label }` in an object literal is both this (the property it sets) and a read
 * of the variable `label` (classify handles that half).
 */
function memberUse(id: TsNode): { container: TsNode; ownType: boolean; kind: number } | undefined {
  const p = id.parent;
  if (!same(p.name, id)) return undefined;
  switch (p.kind) {
    case K.JsxAttribute:
      return { container: p.parent, ownType: false, kind: REF.write };
    case K.PropertyAssignment:
    case K.ShorthandPropertyAssignment:
    case K.MethodDeclaration:
    case K.GetAccessor:
    case K.SetAccessor: {
      const obj = p.parent;
      if (obj.kind !== K.ObjectLiteralExpression || isModuleExportsObject(obj)) return undefined;
      // `const x = { … }` with no annotation has no contextual type; skip the round trip.
      const up = obj.parent;
      if (up.kind === K.VariableDeclaration && !up.type) return undefined;
      return { container: obj, ownType: false, kind: REF.write };
    }
    case K.BindingElement:
      if (p.propertyName || p.parent.kind !== K.ObjectBindingPattern || requireRoot(p)) return undefined;
      return { container: p.parent, ownType: true, kind: REF.read };
  }
  return undefined;
}

function isModuleExportsObject(obj: TsNode): boolean {
  const b = obj.parent;
  return b.kind === K.BinaryExpression && same(b.right, obj) && commonJsTarget(b.left) === "module";
}

/** `const { a, b: c } = require("x")` — the binding names are imports. */
function requireRoot(el: TsNode): boolean {
  let n: TsNode = el;
  while (n.kind === K.BindingElement || n.kind === K.ObjectBindingPattern || n.kind === K.ArrayBindingPattern) n = n.parent;
  return n.kind === K.VariableDeclaration && isRequireCall(n.initializer);
}
