/**
 * Turning a batch of candidate identifiers into references to our symbols.
 *
 * Round trips are the cost model here, not CPU: getSymbolAtLocation takes an array (one round
 * trip per batch), but getAliasedSymbol, getShorthandAssignmentValueSymbol and typeToString
 * take one item each. Those are issued concurrently in slices so the client pipelines them over
 * the one stdio connection instead of waiting out each round trip, and aliases are cached by
 * symbol id because every use of an imported name returns the same alias symbol.
 *
 * One candidate can become several reference rows at the same position. `p.dispose()` on an
 * `Alpha | Beta` calls whichever one `p` holds, so find-all-references credits both, and so
 * does this; `new Circle()` is a use of the class and of its constructor. The RefTable allows
 * any number of rows at one position.
 */

import { SignatureKind, SymbolFlags, type Checker, type Symbol as TsSymbol, type Type } from "typescript/unstable/async";
import type { Expression } from "typescript/unstable/ast";
import type { SymbolKind } from "../../shared/schema";
import { CAND_SHORTHAND, CAND_SUPER, CAND_VALUE, SIG, type Batch, type MemberBatch } from "./references";
import { CALLABLE, REF, type RefStore, type SymbolStore } from "./store";
import { clip, headerText, node, SyntaxKind as K, type TsNode } from "./syntax";

export interface ResolveState {
  store: SymbolStore;
  refs: RefStore;
  /** Alias symbol id → the symbol it finally names, or null when that is the unknown symbol. */
  aliasTargets: Map<number, TsSymbol | null>;
  /** Checker symbol id → our symbols declared at its declarations ([] when none are ours). */
  ours: Map<number, number[]>;
  /** Candidates the checker could not resolve at all (no symbol, or an alias to nothing). */
  unresolved: number;
  /**
   * Absolute paths (as given and lowercased: the checker's paths are lowercased on a
   * case-insensitive file system) of files TsInput.skip left out. A reference into one is
   * resolved fine but has no symbol of ours to land on; it is counted, not stored.
   */
  skipped: ReadonlySet<string>;
  /** Checker symbol ids declared in a skipped file, filled alongside `ours`. */
  intoSkipped: Set<number>;
  skippedRefs: number;
}

/**
 * Per-project lookups. Type ids come from one project's checker, so a cache keyed by them must
 * not outlive the project (two checkers can hand out the same id for different types).
 */
export interface ProjectCache {
  /** Type id → its properties by name, each with the union member it came from. */
  props: Map<number, Promise<Props>>;
  /** Type id → getPropertiesOfType, shared by every union the type is a member of. */
  partProps: Map<number, Promise<readonly TsSymbol[]>>;
}

interface Props {
  /** The union's members, or just the type itself. */
  parts: readonly Type[];
  byName: Map<string, { part: number; sym: TsSymbol }[]>;
}

export const newProjectCache = (): ProjectCache => ({ props: new Map(), partProps: new Map() });

/** Concurrent requests per slice, so one batch never queues tens of thousands at once. */
const SLICE = 512;

async function inSlices<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += SLICE) {
    const slice = items.slice(i, i + SLICE);
    out.push(...(await Promise.all(slice.map((item, j) => fn(item, i + j)))));
  }
  return out;
}

export async function resolveBatch(b: Batch, checker: Checker, st: ResolveState, cache: ProjectCache): Promise<void> {
  if (!b.size) return;
  await resolveMembers(b.members, checker, st, cache);
  const count = b.nodes.length; // b.size also counts the member candidates
  if (!count) return;
  const syms: (TsSymbol | undefined)[] = await checker.getSymbolAtLocation(b.nodes.map(node));

  // `{ foo }` names the object member at its location; the variable it reads is a second lookup.
  const shorthand: number[] = [];
  for (let i = 0; i < count; i++) if (b.flags[i]! & CAND_SHORTHAND) shorthand.push(i);
  if (shorthand.length) {
    const values = await inSlices(shorthand, (i) =>
      checker.getShorthandAssignmentValueSymbol(node(b.aux[i]!)).catch(() => undefined),
    );
    shorthand.forEach((i, j) => (syms[i] = values[j]));
  }

  // Imports, re-exports and `require` bindings are aliases; follow each to its target once.
  const pending = new Map<number, TsSymbol>();
  for (const s of syms) if (s && s.flags & SymbolFlags.Alias && !st.aliasTargets.has(s.id)) pending.set(s.id, s);
  if (pending.size) {
    const list = [...pending.values()];
    const targets = await inSlices(list, (s) => checker.getAliasedSymbol(s).catch(() => undefined));
    for (let j = 0; j < list.length; j++) {
      const t = targets[j];
      st.aliasTargets.set(list[j]!.id, t && !(await checker.isUnknownSymbol(t)) ? t : null);
    }
  }

  const sigs: { our: number; sym: TsSymbol; decl: TsNode }[] = [];
  for (let i = 0; i < count; i++) {
    const kind = b.kind[i]!;
    let s = syms[i];
    if (kind === SIG) {
      const decl = b.aux[i]!;
      if (s) sigs.push({ our: b.from[i]!, sym: s, decl });
      else st.store.signature[b.from[i]!] = headerText(decl, decl.getSourceFile());
      continue;
    }
    if (s && s.flags & SymbolFlags.Alias) s = st.aliasTargets.get(s.id) ?? undefined;
    if (!s) {
      st.unresolved++;
      continue;
    }
    const cands = oursOf(s, st);
    if (!cands.length) {
      if (st.intoSkipped.has(s.id)) st.skippedRefs++;
      continue;
    }
    const flags = b.flags[i]!;
    const push = (target: number) => st.refs.push(target, b.file[i]!, b.pos[i]!, b.line[i]!, b.col[i]!, b.len[i]!, kind, b.from[i]!);
    for (const target of targetsOf(cands, kind, (flags & CAND_VALUE) !== 0, st.store)) {
      const ctor = st.store.ctor.get(target);
      // `super(…)` runs the base constructor, or the class's implicit one when it declares none.
      if (flags & CAND_SUPER) push(ctor ?? target);
      else {
        push(target);
        if (kind === REF.new && ctor !== undefined) push(ctor);
      }
    }
  }

  await signatures(sigs, checker, st.store);
}

/**
 * Property names found through their container's type. One type lookup per container (the
 * contextual ones are single requests; binding-pattern types are batched), then one property
 * listing per distinct type: many JSX elements of one component share its props type.
 */
async function resolveMembers(m: MemberBatch, checker: Checker, st: ResolveState, cache: ProjectCache): Promise<void> {
  if (!m.size) return;
  const seen = new Set<TsNode>();
  const contextual: TsNode[] = [];
  const own: TsNode[] = [];
  for (let i = 0; i < m.size; i++) {
    const c = m.container[i]!;
    if (seen.has(c)) continue;
    seen.add(c);
    (m.ownType[i] ? own : contextual).push(c);
  }
  // Containers are JsxAttributes and object literals, both expressions as getContextualType wants.
  const ctxTypes = await inSlices(contextual, (c) => checker.getContextualType(node(c) as Expression).catch(() => undefined));
  const ownTypes = own.length ? await checker.getTypeAtLocation(own.map(node)).catch(() => []) : [];
  const typeOf = new Map<TsNode, Type | undefined>();
  contextual.forEach((c, j) => typeOf.set(c, ctxTypes[j]));
  own.forEach((c, j) => typeOf.set(c, ownTypes[j]));

  const tables = new Map<TsNode, Props>();
  const distinct = new Map<TsNode, Type>();
  for (const [c, t] of typeOf) if (t) distinct.set(c, t);
  const listed = await inSlices([...distinct.values()], (t) => propertiesOf(t, checker, cache));
  [...distinct.keys()].forEach((c, j) => tables.set(c, listed[j]!));
  const fits = await discriminate(m, tables, checker);

  for (let i = 0; i < m.size; i++) {
    const container = m.container[i]!;
    let entries = tables.get(container)?.byName.get(m.name[i]!);
    if (!entries) continue;
    const valid = fits.get(container);
    if (valid && entries.length > 1) {
      const kept = entries.filter((e) => valid.has(e.part));
      // Nothing fits (a literal still missing required members): one guess beats crediting
      // every member of a twenty-way union with a write it does not make.
      entries = kept.length ? kept : entries.slice(0, 1);
    }
    let cands: number[] = [];
    for (const e of entries) {
      const ours = oursOf(e.sym, st);
      cands = cands.length ? cands.concat(ours.filter((o) => !cands.includes(o))) : ours;
    }
    if (!cands.length) continue;
    const kind = m.kind[i]!;
    for (const target of targetsOf(cands, kind, false, st.store)) {
      st.refs.push(target, m.file[i]!, m.pos[i]!, m.line[i]!, m.col[i]!, m.len[i]!, kind, m.from[i]!);
    }
  }
}

/**
 * Properties of a type by name. getPropertiesOfType on a union keeps only the members every
 * constituent has, which drops exactly the interesting ones (`{ kind: "a"; x } | { kind: "b" }`
 * has no `x`, and `Props | undefined` has nothing), so unions are listed member by member, and
 * a name several members share keeps all of them: which one a use means is decided per use.
 */
function propertiesOf(t: Type, checker: Checker, cache: ProjectCache): Promise<Props> {
  let p = cache.props.get(t.id);
  if (!p) {
    p = (async () => {
      const parts = t.isUnionType() ? ((await t.getTypes().catch(() => undefined)) ?? []) : [t];
      const byName = new Map<string, { part: number; sym: TsSymbol }[]>();
      const lists = await Promise.all(parts.map((part) => ownProperties(part, checker, cache)));
      lists.forEach((list, part) => {
        for (const sym of list) {
          const entries = byName.get(sym.name);
          if (!entries) byName.set(sym.name, [{ part, sym }]);
          else if (!entries.some((e) => e.sym.id === sym.id)) entries.push({ part, sym });
        }
      });
      return { parts, byName };
    })();
    cache.props.set(t.id, p);
  }
  return p;
}

function ownProperties(t: Type, checker: Checker, cache: ProjectCache): Promise<readonly TsSymbol[]> {
  let p = cache.partProps.get(t.id);
  if (!p) {
    p = checker.getPropertiesOfType(t).catch(() => []);
    cache.partProps.set(t.id, p);
  }
  return p;
}

/**
 * Which members of a union-typed context an object literal or JSX element actually is. The
 * literal `{ kind: "spawn", at }` written where a twenty-variant `WorldEvent` is expected sets
 * the `kind` of one variant, not of all twenty; find-all-references discriminates the same way.
 * A member fits when the literal's own type is assignable to it. Only containers where it
 * matters are asked: contextual, and naming a property more than one member declares.
 */
async function discriminate(m: MemberBatch, tables: Map<TsNode, Props>, checker: Checker): Promise<Map<TsNode, Set<number>>> {
  const ask = new Set<TsNode>();
  for (let i = 0; i < m.size; i++) {
    if (m.ownType[i]) continue;
    const c = m.container[i]!;
    if (!ask.has(c) && (tables.get(c)?.byName.get(m.name[i]!)?.length ?? 0) > 1) ask.add(c);
  }
  const out = new Map<TsNode, Set<number>>();
  if (!ask.size) return out;
  const containers = [...ask];
  const own = await checker.getTypeAtLocation(containers.map(node)).catch(() => [] as (Type | undefined)[]);
  const pairs: { c: TsNode; literal: Type; part: number; target: Type }[] = [];
  containers.forEach((c, j) => {
    const literal = own[j];
    if (!literal) return;
    tables.get(c)!.parts.forEach((target, part) => pairs.push({ c, literal, part, target }));
  });
  const ok = await inSlices(pairs, (p) => checker.isTypeAssignableTo(p.literal, p.target).catch(() => false));
  pairs.forEach((p, j) => {
    let set = out.get(p.c);
    if (!set) out.set(p.c, (set = new Set()));
    if (ok[j]) set.add(p.part);
  });
  return out;
}

/**
 * Our symbols behind a checker symbol, through its declaration handles. A handle is
 * (canonical path, node index), the same pair our declaration pass keyed symbols by.
 */
function oursOf(s: TsSymbol, st: ResolveState): number[] {
  const cached = st.ours.get(s.id);
  if (cached) return cached;
  const out: number[] = [];
  for (const d of s.declarations) {
    const fd = st.store.files.get(d.path);
    if (!fd) {
      if (st.skipped.size && st.skipped.has(d.path)) st.intoSkipped.add(s.id);
      continue;
    }
    let m: number | undefined;
    if (d.kind === K.SourceFile) {
      // CommonJS's `module` and `exports` are also "declared" by the SourceFile; only the
      // module itself (a namespace import, a require of an object export) is the file.
      if (s.flags & SymbolFlags.ValueModule) m = fd.moduleSymbol;
    } else {
      m = fd.scopes.get(d.index) ?? fd.aliases.get(d.index);
    }
    if (m !== undefined && !out.includes(m)) out.push(m);
  }
  // Most symbols are locals and parameters, none of them ours: share one empty answer.
  const answer = out.length ? out : NONE;
  st.ours.set(s.id, answer);
  return answer;
}

const NONE: number[] = [];

/**
 * Which of our symbols a use of a checker symbol with these declarations is a reference to.
 *
 * Declarations in different containers are different symbols that one use reaches at once:
 * the members of `Alpha | Beta`, or of an intersection. Each container gets its own row.
 * Declarations in one container are one symbol declared more than once (a get/set pair, a
 * class merged with a namespace, an interface declared twice, `type Mode` beside `const Mode`),
 * and the use decides which declaration it means. An import or export names all of them.
 */
function targetsOf(cands: number[], kind: number, value: boolean, store: SymbolStore): number[] {
  if (cands.length === 1 || kind === REF.import || kind === REF.export) return cands;
  const groups = new Map<string, number[]>();
  for (const c of cands) {
    const key = `${store.file[c]}:${store.parent[c]}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  const out: number[] = [];
  for (const g of groups.values()) out.push(g.length === 1 ? g[0]! : choose(g, kind, value, store.kind));
  // Across containers the meaning still has to fit: `new Alpha()` is not a use of the
  // `interface Alpha` a module augmentation added beside the class.
  const typeUse = !value && (kind === REF.type || kind === REF.extends || kind === REF.implements);
  const fits = typeUse ? TYPE_LIKE : VALUE;
  const kept = out.filter((c) => fits(store.kind[c]!));
  return kept.length ? kept : out;
}

const TYPE_LIKE = (k: SymbolKind) => k === "class" || k === "interface" || k === "type" || k === "enum";
/** A declaration that exists at run time; an interface or type alias never does. */
const VALUE = (k: SymbolKind) => k !== "interface" && k !== "type";

/** Pick among one symbol's declarations by how it is used. */
function choose(cands: number[], kind: number, value: boolean, kinds: readonly SymbolKind[]): number {
  const pick = (pred: (k: SymbolKind) => boolean) => cands.find((c) => pred(kinds[c]!));
  const first = cands[0]!;
  if (kind === REF.write) return pick((k) => k === "setter") ?? pick((k) => k !== "getter" && VALUE(k)) ?? first;
  if (!value && kind === REF.extends) return pick((k) => k === "class") ?? pick(TYPE_LIKE) ?? first;
  if (!value && (kind === REF.type || kind === REF.implements)) return pick(TYPE_LIKE) ?? first;
  if (kind === REF.new) return pick((k) => k === "class") ?? pick(VALUE) ?? first;
  if (kind === REF.call || kind === REF.jsx) return pick((k) => CALLABLE.has(k) || k === "class") ?? pick(VALUE) ?? first;
  return pick((k) => k === "getter") ?? pick((k) => k !== "setter" && VALUE(k)) ?? first;
}

/** Printed types for this batch's declarations: one batched type lookup, then one print each. */
async function signatures(sigs: { our: number; sym: TsSymbol; decl: TsNode }[], checker: Checker, store: SymbolStore): Promise<void> {
  if (!sigs.length) return;
  let types: (Type | undefined)[];
  try {
    types = await checker.getTypeOfSymbol(sigs.map((s) => s.sym));
  } catch {
    types = [];
  }
  const texts = await inSlices(sigs, async (s, i): Promise<string> => {
    const t = types[i];
    if (!t || t.isErrorType()) return "";
    return checker.typeToString(t, node(s.decl)).catch(() => "");
  });
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i]!;
    const text = texts[i] ?? "";
    store.signature[s.our] = text && text !== "any" ? clip(text) : headerText(s.decl, s.decl.getSourceFile());
  }

  // `const useX = call(…)` is a hook only if what the call returns can be called: a zustand
  // store prints as `UseBoundStore<…>`, so the printed text cannot tell; its call signatures can.
  const hooks = sigs.flatMap((s, i) => (store.hookByCall.has(s.our) && types[i] && !types[i]!.isErrorType() ? [{ our: s.our, t: types[i]! }] : []));
  const callable = await inSlices(hooks, (h) =>
    checker.getSignaturesOfType(h.t, SignatureKind.Call).then(
      (list) => list.length > 0,
      () => true,
    ),
  );
  hooks.forEach((h, j) => {
    if (callable[j]) return;
    store.kind[h.our] = "variable";
    store.complexity[h.our] = 0;
    store.params[h.our] = 0;
  });
}
