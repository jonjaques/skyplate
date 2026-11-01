/**
 * After pass B: facts about symbols that only every reference together can settle.
 *
 *   linkOverrides       a class member that implements or overrides a base member references it
 *   promoteComponents   a PascalCase function or variable used as a JSX tag is a component
 *
 * Both read the reference store and write to it or to the symbol store, before tables.ts
 * totals anything, so the links count like any reference and the new kinds reach the report.
 */

import { SymbolFlag, type SymbolKind } from "../../shared/schema";
import { REF, type RefStore, type SymbolStore } from "./store";

const HAS_MEMBERS = (k: SymbolKind) => k === "class" || k === "interface";

/**
 * `class SvcImpl implements Svc { submit() {} }`: calls made through `Svc` resolve to
 * `Svc.submit`, so `SvcImpl.submit` would show none of them, and nothing would say that the two
 * are one method to a caller. Find-all-references treats them as one family, from either end.
 *
 * Here each member gets one reference row, on its own name, to the nearest same-named member up
 * each base path: kind `implements` when the path starts with an `implements` clause, `extends`
 * otherwise, from the member itself. That mirrors the class-level `Circle → Shape` row the
 * heritage clause already produces, and puts the link in the call table, where a reader can go
 * from an implementation to the member callers actually name, and from there to their calls.
 *
 * The heritage itself comes from pass B's own `extends` / `implements` references, which the
 * checker already resolved through aliases, so this costs no further round trips. Returns the
 * number of rows added.
 */
export function linkOverrides(store: SymbolStore, refs: RefStore): number {
  const bases = new Map<number, { base: number; kind: number }[]>();
  for (let i = 0; i < refs.length; i++) {
    const kind = refs.kind.data[i]!;
    if (kind !== REF.extends && kind !== REF.implements) continue;
    const from = refs.from.data[i]!;
    const base = refs.symbol.data[i]!;
    if (from === base || !HAS_MEMBERS(store.kind[from]!) || !HAS_MEMBERS(store.kind[base]!)) continue;
    const list = bases.get(from);
    if (!list) bases.set(from, [{ base, kind }]);
    else if (!list.some((b) => b.base === base)) list.push({ base, kind });
  }
  if (!bases.size) return 0;

  // Members by container and name; statics only override statics. Constructors and `#private`
  // names are never inherited members.
  const members = new Map<number, Map<string, number[]>>();
  for (let s = 0; s < store.size; s++) {
    const p = store.parent[s]!;
    if (p < 0 || !HAS_MEMBERS(store.kind[p]!) || store.kind[s] === "constructor" || store.name[s]!.startsWith("#")) continue;
    const key = (store.flags[s]! & SymbolFlag.static ? "static " : "") + store.name[s]!;
    let byName = members.get(p);
    if (!byName) members.set(p, (byName = new Map()));
    const list = byName.get(key);
    if (list) list.push(s);
    else byName.set(key, [s]);
  }

  // The nearest declarations of `key` from `start` upward: a base that declares it ends that
  // path, so `Circle.area` links to `Shape.area`, not past it to the interface Shape implements.
  const nearest = (start: number, key: string): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const stack = [start];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue; // a heritage cycle is a compile error, but not ours to hang on
      seen.add(c);
      const hit = members.get(c)?.get(key);
      if (hit) {
        for (const h of hit) if (!out.includes(h)) out.push(h);
        continue;
      }
      for (const b of bases.get(c) ?? []) stack.push(b.base);
    }
    return out;
  };

  let added = 0;
  for (const [derived, list] of bases) {
    const own = members.get(derived);
    if (!own) continue;
    for (const [key, ms] of own) {
      for (const { base, kind } of list) {
        for (const target of nearest(base, key)) {
          for (const m of ms) {
            if (store.namePos[m]! < 0) continue;
            refs.push(target, store.file[m]!, store.namePos[m]!, store.line[m]!, store.nameCol[m]!, store.nameLen[m]!, kind, m);
            added++;
          }
        }
      }
    }
  }
  return added;
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
/** How the checker prints React's component types (without the `React.` it may add). */
const COMPONENT_TYPE =
  /^(?:React\.)?(?:LazyExoticComponent|MemoExoticComponent|ForwardRefExoticComponent|NamedExoticComponent|ExoticComponent|FunctionComponent|FC|VFC|ComponentType|ComponentClass)</;

/**
 * Pass A calls a PascalCase function a component when its body returns JSX, which misses the
 * ones that render nothing (`return null` for a component that only runs effects), and every
 * `lazy(() => import(…))`: their bodies are elsewhere. Being used as a JSX tag settles it, and so
 * does a React component type. All-caps names (`API`, `URL`) are constants, not components.
 * Returns the number of symbols promoted.
 */
export function promoteComponents(store: SymbolStore, refs: RefStore): number {
  const tag = new Uint8Array(store.size);
  for (let i = 0; i < refs.length; i++) if (refs.kind.data[i] === REF.jsx) tag[refs.symbol.data[i]!] = 1;
  let promoted = 0;
  for (let s = 0; s < store.size; s++) {
    const k = store.kind[s];
    if (k !== "function" && k !== "variable") continue;
    const name = store.name[s]!;
    if (!PASCAL.test(name) || !/[a-z]/.test(name)) continue;
    if (!tag[s] && !(k === "variable" && COMPONENT_TYPE.test(store.signature[s]!))) continue;
    store.kind[s] = "component";
    // A variable's initializer was walked as nobody's body; as a component it is one path.
    if (k === "variable" && store.complexity[s] === 0) store.complexity[s] = 1;
    promoted++;
  }
  return promoted;
}
