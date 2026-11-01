/**
 * Pass A: declarations → symbols.
 *
 * A shallow walk: module and namespace statements, class / interface / enum members, top-level
 * variables and CommonJS export assignments. It never descends into function bodies, because
 * nothing declared there is one of our symbols (locals and parameters are deliberately left
 * out — they would multiply the table for symbols nobody looks up by name).
 *
 * Every symbol is keyed by its declaration node's index (see FileDecls), which is how the
 * reference pass later recognizes "the checker says this identifier means the thing declared
 * at node 117 of shapes.ts" as our symbol N.
 */

import { SymbolFlag, type SymbolKind } from "../../shared/schema";
import { CHECKER_SIGNATURE, type FileDecls, type SymbolStore } from "./store";
import {
  commonJsTarget,
  containsJsx,
  firstSentence,
  headerText,
  isDeprecated,
  isFunctionLike,
  isRequireCall,
  jsDocOf,
  ModifierFlags,
  nameText,
  NodeFlags,
  skipOuter,
  SyntaxKind as K,
  type TsNode,
  type TsSourceFile,
} from "./syntax";

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const HOOK = /^use[A-Z]/;

/**
 * A name a CommonJS export or a local `export { x }` points at, settled once the whole file's
 * top-level names are known (function declarations hoist, so the target may come later).
 */
interface PendingLink {
  node: number; // the declaration node the checker will name
  local: string; // the top-level name it stands for
  flags: number; // export flags to add to the target
}

export function collectDeclarations(
  sf: TsSourceFile,
  fileId: number,
  baseName: string,
  isTest: boolean,
  store: SymbolStore,
): FileDecls {
  const fileFlags = (isTest ? SymbolFlag.test : 0) | (sf.isDeclarationFile ? SymbolFlag.ambient : 0);
  const lastLine = sf.getLineAndCharacterOfPosition(sf.end).line;
  const moduleSymbol = store.add({
    name: baseName,
    kind: "module",
    file: fileId,
    line: 0,
    col: 0,
    endLine: lastLine,
    parent: -1,
    flags: fileFlags,
    signature: "",
    doc: "",
    params: 0,
  });
  const decls: FileDecls = {
    fileId,
    moduleSymbol,
    scopes: new Map(),
    aliases: new Map(),
    names: new Set(),
  };
  store.files.set(sf.path, decls);

  const topLevel = new Map<string, number>();
  const pending: PendingLink[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos);

  // ─── Symbol construction ───────────────────────────────────────────────────────────────

  interface Decl {
    node: TsNode; //           scope node (the key)
    nameNode?: TsNode; //      identifier to place the symbol at and to skip as a reference
    name: string;
    kind: SymbolKind;
    parent: number;
    flags: number;
    fn?: TsNode; //            function-like whose parameters count
    docNode?: TsNode; //       where the JSDoc hangs, when not on `node`
    at?: number; //            position to report when there is no name node (constructors)
  }

  function add(d: Decl): number {
    const at = d.nameNode ? d.nameNode.getStart() : (d.at ?? d.node.getStart());
    const lc = lineOf(at);
    const doc = jsDocOf(d.docNode ?? d.node);
    let flags = d.flags | fileFlags;
    if (d.node.flags & NodeFlags.Ambient) flags |= SymbolFlag.ambient;
    if (isDeprecated(doc)) flags |= SymbolFlag.deprecated;
    if (d.nameNode?.kind === K.PrivateIdentifier) flags |= SymbolFlag.private;
    if (d.fn) {
      if (d.fn.modifierFlags & ModifierFlags.Async) flags |= SymbolFlag.async;
      if (d.fn.asteriskToken) flags |= SymbolFlag.generator;
    }
    const id = store.add({
      name: d.name,
      kind: d.kind,
      file: fileId,
      line: lc.line,
      col: lc.character,
      endLine: lineOf(d.node.end).line,
      parent: d.parent,
      flags,
      signature: CHECKER_SIGNATURE.has(d.kind) ? "" : headerText(d.node, sf),
      doc: firstSentence(doc),
      params: d.fn ? paramCount(d.fn) : 0,
    });
    decls.scopes.set(d.node.index, id);
    if (d.nameNode) decls.names.add(d.nameNode.index);
    if (d.parent === -1 && !topLevel.has(d.name)) topLevel.set(d.name, id);
    return id;
  }

  /**
   * A later overload (or the implementation) joins the symbol its first signature created: the
   * first signature keeps the position, the extent grows to cover the implementation, and the
   * implementation's parameters are the ones that count.
   */
  function join(id: number, n: TsNode, nameNode: TsNode | undefined): void {
    decls.scopes.set(n.index, id);
    if (nameNode) decls.names.add(nameNode.index);
    store.endLine[id] = lineOf(n.end).line;
    if (n.body) store.params[id] = paramCount(n);
    if (!store.doc[id]) store.doc[id] = firstSentence(jsDocOf(n));
    if (n.modifierFlags & ModifierFlags.Async) store.flags[id]! |= SymbolFlag.async;
  }

  function functionKind(name: string, fn: TsNode | undefined): SymbolKind {
    if (HOOK.test(name)) return "hook";
    if (fn && PASCAL.test(name) && /[a-z]/.test(name) && containsJsx(fn.body)) return "component";
    return "function";
  }

  // ─── Statements ────────────────────────────────────────────────────────────────────────

  function statements(list: readonly TsNode[] | undefined, parent: number): void {
    if (!list) return;
    // Overloads are adjacent same-name declarations with no body until the last.
    let group: { name: string; kind: K; id: number; open: boolean } | undefined;
    for (const st of list) {
      if (st.kind === K.FunctionDeclaration) {
        const def = !!(st.modifierFlags & ModifierFlags.Default);
        const name = st.name?.text ?? (def ? "default" : undefined);
        if (!name) continue;
        if (group && group.open && group.kind === st.kind && group.name === name) {
          join(group.id, st, st.name);
        } else {
          const id = add({ node: st, nameNode: st.name, name, kind: functionKind(name, st), parent, flags: modifierBits(st), fn: st });
          group = { name, kind: st.kind, id, open: true };
        }
        group.open = !st.body;
        continue;
      }
      group = undefined;
      statement(st, parent);
    }
  }

  function statement(st: TsNode, parent: number): void {
    switch (st.kind) {
      case K.ClassDeclaration: {
        const name = st.name?.text ?? (st.modifierFlags & ModifierFlags.Default ? "default" : undefined);
        if (name) classLike(st, st, st.name, name, parent, modifierBits(st));
        return;
      }
      case K.InterfaceDeclaration: {
        const id = add({ node: st, nameNode: st.name, name: st.name?.text ?? "", kind: "interface", parent, flags: modifierBits(st) });
        typeMembers(st.members, id);
        return;
      }
      case K.TypeAliasDeclaration:
      case K.JSTypeAliasDeclaration:
        add({ node: st, nameNode: st.name, name: st.name?.text ?? "", kind: "type", parent, flags: modifierBits(st) });
        return;
      case K.EnumDeclaration: {
        const id = add({ node: st, nameNode: st.name, name: st.name?.text ?? "", kind: "enum", parent, flags: modifierBits(st) });
        for (const m of st.members ?? []) {
          const name = nameText(m.name, sf);
          if (name !== undefined) add({ node: m, nameNode: m.name, name, kind: "property", parent: id, flags: 0 });
        }
        return;
      }
      case K.ModuleDeclaration: {
        const name = nameText(st.name, sf) ?? "global";
        const id = add({ node: st, nameNode: st.name, name, kind: "namespace", parent, flags: modifierBits(st) });
        // `namespace A.B {}` nests B as A's body rather than as a statement of a block.
        const body = st.body;
        if (body?.kind === K.ModuleBlock) statements(body.statements, id);
        else if (body?.kind === K.ModuleDeclaration) statement(body, id);
        return;
      }
      case K.VariableStatement: {
        const flags = modifierBits(st);
        for (const d of st.declarationList?.declarations ?? []) variable(d, st, flags, parent);
        return;
      }
      case K.ExportAssignment:
        exportAssignment(st, parent);
        return;
      case K.ExportDeclaration:
        localExports(st);
        return;
      case K.ExpressionStatement:
        commonJs(st, parent);
        return;
    }
  }

  // ─── Variables ─────────────────────────────────────────────────────────────────────────

  function variable(d: TsNode, st: TsNode, flags: number, parent: number): void {
    // `const x = require("y")` is an import in all but syntax; the checker binds it as an alias.
    if (isRequireCall(d.initializer)) return;
    const nameNode = d.name;
    if (!nameNode) return;
    if (nameNode.kind === K.ObjectBindingPattern || nameNode.kind === K.ArrayBindingPattern) {
      bindings(nameNode, st, flags, parent);
      return;
    }
    const name = nameNode.text ?? "";
    const init = skipOuter(d.initializer);
    let id: number;
    if (init && (init.kind === K.ArrowFunction || init.kind === K.FunctionExpression)) {
      id = add({ node: d, nameNode, name, kind: functionKind(name, init), parent, flags, fn: init, docNode: d });
      if (init.kind === K.FunctionExpression && init.name) decls.aliases.set(init.index, id);
    } else if (init?.kind === K.ClassExpression) {
      id = classLike(d, init, nameNode, name, parent, flags);
    } else {
      // `memo(function Foo() {…})`, `forwardRef((props, ref) => …)`: the wrapped function is the
      // component. `create(…)` named `useStore` is a zustand-style hook.
      const wrapped = init?.kind === K.CallExpression ? init.arguments?.find((a) => isFunctionLike(skipOuter(a))) : undefined;
      const fn = skipOuter(wrapped);
      let kind: SymbolKind = "variable";
      if (HOOK.test(name) && init?.kind === K.CallExpression) kind = "hook";
      else if (fn && PASCAL.test(name) && /[a-z]/.test(name) && containsJsx(fn.body)) kind = "component";
      id = add({ node: d, nameNode, name, kind, parent, flags, fn: kind === "variable" ? undefined : fn, docNode: d });
    }
    // `var app = exports = module.exports = {}`: requiring this file yields `app`.
    for (const b of assignmentChain(d.initializer)) {
      if (commonJsTarget(b.left) === "module") {
        decls.aliases.set(b.index, id);
        store.flags[id]! |= SymbolFlag.exported | SymbolFlag.defaultExport;
      }
    }
  }

  function bindings(pattern: TsNode, st: TsNode, flags: number, parent: number): void {
    for (const el of pattern.elements ?? []) {
      if (el.kind !== K.BindingElement || !el.name) continue;
      if (el.name.kind === K.Identifier) {
        add({ node: el, nameNode: el.name, name: el.name.text ?? "", kind: "variable", parent, flags, docNode: st });
      } else {
        bindings(el.name, st, flags, parent);
      }
    }
  }

  // ─── Classes, interfaces ───────────────────────────────────────────────────────────────

  /** `keyNode` is the class declaration, or the variable a class expression is assigned to. */
  function classLike(keyNode: TsNode, cls: TsNode, nameNode: TsNode | undefined, name: string, parent: number, flags: number): number {
    const id = add({ node: keyNode, nameNode, name, kind: "class", parent, flags, docNode: keyNode });
    if (cls !== keyNode) {
      decls.aliases.set(cls.index, id);
      store.signature[id] = headerText(cls, sf);
    }
    let group: { name: string; kind: K; id: number; open: boolean } | undefined;
    for (const m of cls.members ?? []) {
      const k = m.kind;
      if (k !== K.MethodDeclaration && k !== K.Constructor) group = undefined;
      const mflags = modifierBits(m);
      switch (k) {
        case K.Constructor:
        case K.MethodDeclaration: {
          const mname = k === K.Constructor ? "constructor" : nameText(m.name, sf);
          if (mname === undefined) break;
          if (group && group.open && group.kind === k && group.name === mname) {
            join(group.id, m, m.name);
          } else {
            const mid = add({
              node: m,
              nameNode: m.name,
              at: k === K.Constructor ? constructorKeyword(m) : undefined,
              name: mname,
              kind: k === K.Constructor ? "constructor" : "method",
              parent: id,
              flags: mflags,
              fn: m,
            });
            group = { name: mname, kind: k, id: mid, open: true };
          }
          group.open = !m.body;
          if (k === K.Constructor) parameterProperties(m, id);
          break;
        }
        case K.GetAccessor:
        case K.SetAccessor: {
          const mname = nameText(m.name, sf);
          if (mname !== undefined) {
            add({ node: m, nameNode: m.name, name: mname, kind: k === K.GetAccessor ? "getter" : "setter", parent: id, flags: mflags, fn: m });
          }
          break;
        }
        case K.PropertyDeclaration: {
          const mname = nameText(m.name, sf);
          if (mname === undefined) break;
          // `handleClick = () => {…}` is a method in every way a reader cares about.
          const init = skipOuter(m.initializer);
          const fn = init && (init.kind === K.ArrowFunction || init.kind === K.FunctionExpression) ? init : undefined;
          add({ node: m, nameNode: m.name, name: mname, kind: fn ? "method" : "property", parent: id, flags: mflags, fn });
          break;
        }
      }
    }
    return id;
  }

  /** `constructor(private radius: number)` declares a property on the class. */
  function parameterProperties(ctor: TsNode, cls: number): void {
    const ACCESS = ModifierFlags.Public | ModifierFlags.Private | ModifierFlags.Protected | ModifierFlags.Readonly | ModifierFlags.Override;
    for (const p of ctor.parameters ?? []) {
      if (!(p.modifierFlags & ACCESS) || p.name?.kind !== K.Identifier) continue;
      add({ node: p, nameNode: p.name, name: p.name.text ?? "", kind: "property", parent: cls, flags: modifierBits(p) });
    }
  }

  function typeMembers(members: readonly TsNode[] | undefined, parent: number): void {
    let group: { name: string; id: number } | undefined;
    for (const m of members ?? []) {
      const mname = nameText(m.name, sf);
      if (mname === undefined) {
        group = undefined;
        continue;
      }
      if (m.kind === K.MethodSignature) {
        if (group?.name === mname) {
          join(group.id, m, m.name);
          continue;
        }
        group = { name: mname, id: add({ node: m, nameNode: m.name, name: mname, kind: "method", parent, flags: 0, fn: m }) };
        continue;
      }
      group = undefined;
      if (m.kind === K.PropertySignature) {
        add({ node: m, nameNode: m.name, name: mname, kind: "property", parent, flags: modifierBits(m) });
      } else if (m.kind === K.GetAccessor || m.kind === K.SetAccessor) {
        add({ node: m, nameNode: m.name, name: mname, kind: m.kind === K.GetAccessor ? "getter" : "setter", parent, flags: 0, fn: m });
      }
    }
  }

  // ─── Exports ───────────────────────────────────────────────────────────────────────────

  /** `export default <expr>` / `export = <expr>` with a value that is not just a name. */
  function exportAssignment(st: TsNode, parent: number): void {
    const flags = SymbolFlag.exported | SymbolFlag.defaultExport;
    const e = skipOuter(st.expression);
    if (!e) return;
    if (e.kind === K.Identifier) {
      pending.push({ node: st.index, local: e.text ?? "", flags });
      return;
    }
    if (e.kind === K.PropertyAccessExpression) return; // a reference, classified by the walk
    if (e.kind === K.ArrowFunction || e.kind === K.FunctionExpression) {
      const name = e.name?.text ?? "default";
      const kind = HOOK.test(name) ? "hook" : containsJsx(e.body) ? "component" : "function";
      const id = add({ node: st, name, kind, parent, flags, fn: e });
      decls.aliases.set(e.index, id);
    } else if (e.kind === K.ClassExpression) {
      classLike(st, e, e.name, e.name?.text ?? "default", parent, flags);
    } else {
      add({ node: st, name: "default", kind: "variable", parent, flags });
    }
  }

  /** `export { a, b as c }` without a module specifier exports local declarations. */
  function localExports(st: TsNode): void {
    if (st.moduleSpecifier || st.exportClause?.kind !== K.NamedExports) return;
    for (const spec of st.exportClause.elements ?? []) {
      const local = spec.propertyName ?? spec.name;
      if (local?.kind !== K.Identifier) continue;
      const def = spec.name?.text === "default" ? SymbolFlag.defaultExport : 0;
      pending.push({ node: -1, local: local.text ?? "", flags: SymbolFlag.exported | def });
    }
  }

  /**
   * CommonJS: `exports.x = …`, `module.exports.x = …`, `module.exports = …`. tsgo binds each as
   * a declaration whose node is the assignment (BinaryExpression), so that is the alias key.
   * Any other `a.b = function …` is an expando method (below).
   */
  function commonJs(st: TsNode, parent: number): void {
    if (parent !== -1) return;
    const chain = assignmentChain(st.expression);
    const value = skipOuter(chain[chain.length - 1]?.right);
    if (!value) return;
    for (const b of chain) {
      const target = commonJsTarget(b.left);
      if (!target) {
        expando(b, value, st, parent);
        continue;
      }
      const isModule = target === "module";
      const flags = SymbolFlag.exported | (isModule ? SymbolFlag.defaultExport : 0);
      if (value.kind === K.Identifier) {
        pending.push({ node: b.index, local: value.text ?? "", flags });
        // `exports.helper = helper`: the left `helper` names the export, it does not write the local.
        const exportName = skipOuter(b.left)?.name;
        if (!isModule && exportName) decls.names.add(exportName.index);
      } else if (value.kind === K.ArrowFunction || value.kind === K.FunctionExpression) {
        const name = isModule ? (value.name?.text ?? baseName.replace(/\.[^.]+$/, "")) : target.name;
        const nameNode = isModule ? undefined : skipOuter(b.left)?.name;
        const id = add({ node: value, nameNode, name, kind: functionKind(name, value), parent, flags, fn: value, docNode: st });
        decls.aliases.set(b.index, id);
      } else if (value.kind === K.ClassExpression) {
        const name = isModule ? (value.name?.text ?? baseName.replace(/\.[^.]+$/, "")) : target.name;
        classLike(b, value, isModule ? undefined : skipOuter(b.left)?.name, name, parent, flags);
      } else if (isModule && value.kind === K.ObjectLiteralExpression) {
        decls.aliases.set(b.index, moduleSymbol);
        exportedObject(value);
      } else if (isModule) {
        decls.aliases.set(b.index, moduleSymbol);
      } else if (!isRequireCall(value, true)) {
        add({ node: b, nameNode: skipOuter(b.left)?.name, name: target.name, kind: "variable", parent, flags, docNode: st });
      }
    }
  }

  /**
   * `res.send = function send() {…}`, `View.prototype.lookup = function lookup() {…}`: the
   * pre-class way to define methods, all over CommonJS code. tsgo does not bind these, so calls
   * to them stay unresolved, but as symbols they still outline the file, carry complexity, and
   * make the references inside their bodies come *from* the method rather than the module.
   * Only function and class values count: `config.debug = true` is a write, not a definition.
   */
  function expando(b: TsNode, value: TsNode, st: TsNode, parent: number): void {
    if (value.kind !== K.ArrowFunction && value.kind !== K.FunctionExpression && value.kind !== K.ClassExpression) return;
    const left = skipOuter(b.left);
    if (left?.kind !== K.PropertyAccessExpression || !left.name || left.name.kind !== K.Identifier) return;
    let owner = skipOuter(left.expression);
    if (owner?.kind === K.PropertyAccessExpression && owner.name?.text === "prototype") owner = skipOuter(owner.expression);
    if (owner?.kind !== K.Identifier) return;
    const ownerId = topLevel.get(owner.text ?? "");
    const name = left.name.text ?? "";
    const kind: SymbolKind = value.kind === K.ClassExpression ? "class" : ownerId !== undefined ? "method" : functionKind(name, value);
    if (kind === "class") {
      classLike(b, value, left.name, name, ownerId ?? parent, 0);
      return;
    }
    // The function, not the assignment, is the scope: the `res` in `res.send = …` is the module
    // naming `res`, not `send` referring to its own owner.
    const id = add({ node: value, nameNode: left.name, name, kind, parent: ownerId ?? parent, flags: 0, fn: value, docNode: st });
    // In TS files tsgo does bind expandos on functions (`api.helper = function…` resolves at
    // `api.helper()`); both the assignment and its target are keyed so either declaration form
    // the checker reports finds this symbol.
    decls.aliases.set(b.index, id);
    decls.aliases.set(left.index, id);
  }

  /** `module.exports = { a, b: c, d() {} }`: each member is an export of the file. */
  function exportedObject(obj: TsNode): void {
    for (const p of obj.properties ?? []) {
      const name = nameText(p.name, sf);
      if (name === undefined) continue;
      const flags = SymbolFlag.exported;
      if (p.kind === K.ShorthandPropertyAssignment) {
        pending.push({ node: p.index, local: name, flags });
      } else if (p.kind === K.PropertyAssignment) {
        const v = skipOuter(p.initializer);
        if (v?.kind === K.Identifier) pending.push({ node: p.index, local: v.text ?? "", flags });
        else if (v && (v.kind === K.ArrowFunction || v.kind === K.FunctionExpression)) {
          add({ node: p, nameNode: p.name, name, kind: functionKind(name, v), parent: -1, flags, fn: v });
        }
      } else if (p.kind === K.MethodDeclaration) {
        add({ node: p, nameNode: p.name, name, kind: functionKind(name, p), parent: -1, flags, fn: p });
      }
    }
  }

  // ─── Run ───────────────────────────────────────────────────────────────────────────────

  statements(sf.statements, -1);
  for (const link of pending) {
    const id = topLevel.get(link.local);
    if (id === undefined) continue;
    if (link.node >= 0) decls.aliases.set(link.node, id);
    store.flags[id]! |= link.flags;
  }
  return decls;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

function modifierBits(n: TsNode): number {
  const m = n.modifierFlags;
  let f = 0;
  if (m & ModifierFlags.Export) f |= SymbolFlag.exported;
  if (m & ModifierFlags.Default) f |= SymbolFlag.defaultExport;
  if (m & ModifierFlags.Static) f |= SymbolFlag.static;
  if (m & ModifierFlags.Abstract) f |= SymbolFlag.abstract;
  if (m & ModifierFlags.Private) f |= SymbolFlag.private;
  if (m & ModifierFlags.Protected) f |= SymbolFlag.protected;
  if (m & ModifierFlags.Ambient) f |= SymbolFlag.ambient;
  return f;
}

/** Parameters, not counting a TypeScript `this` parameter (it is a type annotation only). */
function paramCount(fn: TsNode): number {
  let n = 0;
  for (const p of fn.parameters ?? []) if (!(p.name?.kind === K.Identifier && p.name.text === "this")) n++;
  return n;
}

/** `a = b = c = value` → the BinaryExpressions for a, b and c, outermost first. */
function assignmentChain(e: TsNode | undefined): TsNode[] {
  const out: TsNode[] = [];
  let cur = skipOuter(e);
  while (cur && cur.kind === K.BinaryExpression && cur.operatorToken?.kind === K.EqualsToken) {
    out.push(cur);
    cur = skipOuter(cur.right);
  }
  return out;
}

/**
 * Constructors have no name node. Their getStart() lands on the first modifier or decorator
 * (`@Inject() public constructor`), so search for the keyword itself.
 */
function constructorKeyword(ctor: TsNode): number {
  const start = ctor.getStart();
  const at = ctor.getSourceFile().text.indexOf("constructor", start);
  return at >= 0 && at < ctor.end ? at : start;
}
