/**
 * Turning a batch of candidate identifiers into references to our symbols.
 *
 * Round trips are the cost model here, not CPU: getSymbolAtLocation takes an array (one round
 * trip per batch), but getAliasedSymbol, getShorthandAssignmentValueSymbol and typeToString
 * take one item each. Those are issued concurrently in slices so the client pipelines them over
 * the one stdio connection instead of waiting out each round trip, and aliases are cached by
 * symbol id because every use of an imported name returns the same alias symbol.
 */

import { SymbolFlags, type Checker, type Symbol as TsSymbol, type Type } from "typescript/unstable/async";
import type { Expression } from "typescript/unstable/ast";
import type { SymbolKind } from "../../shared/schema";
import { CAND_SHORTHAND, SIG, type Batch, type MemberBatch } from "./references";
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
}

/**
 * Per-project lookups. Type ids come from one project's checker, so a cache keyed by them must
 * not outlive the project (two checkers can hand out the same id for different types).
 */
export interface ProjectCache {
  /** Type id → its properties by name; a union merges its members' (first one wins). */
  props: Map<number, Promise<Map<string, TsSymbol>>>;
}

export const newProjectCache = (): ProjectCache => ({ props: new Map() });

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
    if (!cands.length) continue;
    const target = cands.length === 1 ? cands[0]! : choose(cands, kind, st.store.kind);
    st.refs.push(target, b.file[i]!, b.pos[i]!, b.line[i]!, b.col[i]!, b.len[i]!, kind, b.from[i]!);
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

  const tables = new Map<TsNode, Map<string, TsSymbol>>();
  const distinct = new Map<TsNode, Type>();
  for (const [c, t] of typeOf) if (t) distinct.set(c, t);
  const listed = await inSlices([...distinct.values()], (t) => propertiesOf(t, checker, cache));
  [...distinct.keys()].forEach((c, j) => tables.set(c, listed[j]!));

  for (let i = 0; i < m.size; i++) {
    const s = tables.get(m.container[i]!)?.get(m.name[i]!);
    if (!s) continue;
    const cands = oursOf(s, st);
    if (!cands.length) continue;
    const kind = m.kind[i]!;
    const target = cands.length === 1 ? cands[0]! : choose(cands, kind, st.store.kind);
    st.refs.push(target, m.file[i]!, m.pos[i]!, m.line[i]!, m.col[i]!, m.len[i]!, kind, m.from[i]!);
  }
}

/**
 * Properties of a type by name. getPropertiesOfType on a union keeps only the members every
 * constituent has, which drops exactly the interesting ones (`{ kind: "a"; x } | { kind: "b" }`
 * has no `x`, and `Props | undefined` has nothing), so unions are listed member by member.
 */
function propertiesOf(t: Type, checker: Checker, cache: ProjectCache): Promise<Map<string, TsSymbol>> {
  let p = cache.props.get(t.id);
  if (!p) {
    p = (async () => {
      const out = new Map<string, TsSymbol>();
      const parts = t.isUnionType() ? ((await t.getTypes().catch(() => undefined)) ?? []) : [t];
      for (const part of parts) {
        if (part === t) {
          for (const s of await checker.getPropertiesOfType(part).catch(() => [])) if (!out.has(s.name)) out.set(s.name, s);
        } else {
          for (const [name, s] of await propertiesOf(part, checker, cache)) if (!out.has(name)) out.set(name, s);
        }
      }
      return out;
    })();
    cache.props.set(t.id, p);
  }
  return p;
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
    if (!fd) continue;
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
 * One checker symbol can stand for several of ours: a get/set accessor pair, a class merged
 * with a namespace, an interface declared twice. Pick by how it is used.
 */
function choose(cands: number[], kind: number, kinds: readonly SymbolKind[]): number {
  const pick = (pred: (k: SymbolKind) => boolean) => cands.find((c) => pred(kinds[c]!));
  const first = cands[0]!;
  if (kind === REF.write) return pick((k) => k === "setter") ?? pick((k) => k !== "getter") ?? first;
  if (kind === REF.type || kind === REF.extends || kind === REF.implements) {
    return pick((k) => k === "class" || k === "interface" || k === "type" || k === "enum") ?? first;
  }
  if (kind === REF.new) return pick((k) => k === "class") ?? first;
  if (kind === REF.call || kind === REF.jsx) return pick((k) => CALLABLE.has(k) || k === "class") ?? first;
  return pick((k) => k === "getter") ?? first;
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
}
