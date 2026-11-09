/**
 * Import / include / require extraction, comment- and string-aware.
 *
 * Each extractor runs its statement regexes over the scanner's mask (metrics.ts), where comment
 * text is blanked to spaces and string contents to \x01 with every offset preserved. A keyword
 * can therefore only match in real code, and a string literal's contents can be sliced from
 * the original text at the same offsets. The mask also makes "the closing quote" trivial to
 * find: inside a masked string there are no quote characters left, so the next quote of the
 * same kind is the closer.
 *
 * Specifiers are returned as written (minus surrounding quotes); resolution is resolve.ts's
 * job. Line numbers are 0-based and point at the statement's first line.
 */

import type { ExtractImports, RawImport } from "../contracts";
import type { EdgeKind } from "../../shared/schema";
import { scanWithRules, type Scan } from "../metrics";
import { getLexRules, type LexRules } from "../languages/syntax";

// ─── Shared machinery ────────────────────────────────────────────────────────────────────────

/**
 * A RawImport that may also say the compiler erases it (`import type`, `export type … from`,
 * or a list whose every specifier is written `type X`). Such an edge is real coupling but
 * never runs, so it cannot make an import cycle bite at module evaluation; the graph keeps it
 * out of cycle detection. The flag rides on the contract's RawImport as an extra field until
 * the contract names it, which is why it is optional and only ever `true`.
 */
export interface ExtractedImport extends RawImport {
  typeOnly?: true;
  /**
   * `export … from`: the module passes the target's exports on as its own. A published
   * package's API is its entry plus everything its entry re-exports this way, and `export *`
   * leaves no reference to say which symbols that covers (src/core/pipeline.ts, publicApi).
   */
  reexport?: true;
  /**
   * What the statement takes from the module, as the module exports it (see importedNames),
   * recorded only for scripts the TypeScript analysis never reads: the <script> blocks of
   * Vue, Svelte, Astro and HTML files, VitePress Markdown and MDX. The compiler sees every
   * use made from .ts/.js itself; these are the uses it cannot, so the pipeline matches them
   * to symbols (src/core/ts/hosts.ts) instead of calling an export that a component imports
   * "unused". [] for a side-effect import.
   */
  names?: string[];
}

interface Ctx {
  text: string;
  mask: string;
  out: ExtractedImport[];
  seen: Map<string, ExtractedImport>;
  lineStarts: number[];
  /** Record ExtractedImport.names: this text is a script the compiler does not analyze. */
  names: boolean;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineOf(ctx: Ctx, pos: number): number {
  const s = ctx.lineStarts;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function add(ctx: Ctx, spec: string, kind: EdgeKind, pos: number, typeOnly = false): ExtractedImport | undefined {
  const s = spec.trim();
  if (!s || s.length > 1000) return undefined;
  const line = lineOf(ctx, pos);
  // The same specifier twice on one line (`@import url("x")` seen by two patterns) is one edge,
  // and a runtime import of it outweighs a type-only one beside it.
  const key = `${kind}\0${line}\0${s}`;
  const prior = ctx.seen.get(key);
  if (prior) {
    if (!typeOnly) delete prior.typeOnly;
    return prior;
  }
  const imp: ExtractedImport = typeOnly ? { spec: s, kind, line, typeOnly: true } : { spec: s, kind, line };
  ctx.seen.set(key, imp);
  ctx.out.push(imp);
  return imp;
}

/** Add `names` to an import's, keeping each once (two statements of one spec on one line). */
function addNames(imp: ExtractedImport | undefined, names: string[]): void {
  if (!imp) return;
  imp.names = imp.names ? [...new Set([...imp.names, ...names])] : names;
}

/**
 * The names an import or re-export clause takes from its module, as the module exports them:
 * "default" for a default binding, "*" for a namespace (`* as ns`, `export *`), and each listed
 * specifier's exported name, the one before `as`. `type` modifiers are dropped: a type-only
 * import is still a use of the export. [] for a side-effect import (no clause).
 *
 *   X                    → ["default"]
 *   X, { a, b as c }     → ["default", "a", "b"]
 *   * as ns              → ["*"]
 *   { default as Y, "x-y" as z }  → ["default", "x-y"]
 */
export function importedNames(clause: string): string[] {
  let s = clause.trim();
  const out: string[] = [];
  if (!s) return out;
  if (s[0] !== "{" && s[0] !== "*") {
    const def = /^[\p{ID_Start}$_][\p{ID_Continue}$]*/u.exec(s);
    if (!def) return out;
    out.push("default");
    s = s.slice(def[0].length).replace(/^\s*,\s*/, "");
  }
  if (s[0] === "*") out.push("*");
  else if (s[0] === "{") {
    const close = s.indexOf("}");
    for (const part of s.slice(1, close < 0 ? undefined : close).split(",")) {
      let p = part.trim();
      // `{ type A }` names A; `{ type }` and `{ type as t }` name an export called `type`.
      if (/^type\s+(?!as\s+[\p{ID_Continue}$]+$)\S/u.test(p)) p = p.replace(/^type\s+/, "");
      const name = /^(?:"([^"]*)"|'([^']*)'|([\p{ID_Start}$_][\p{ID_Continue}$]*))/u.exec(p);
      if (name) out.push(name[1] ?? name[2] ?? name[3]!);
    }
  }
  return out;
}

/**
 * Contents of the string literal whose opening quote is at `q` in the mask. Undefined when the
 * literal is not closed on the same line (template literals may span lines) or interpolates.
 */
function stringAt(ctx: Ctx, q: number): string | undefined {
  const quote = ctx.mask[q];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  const close = ctx.mask.indexOf(quote, q + 1);
  if (close < 0) return undefined;
  const value = ctx.text.slice(q + 1, close);
  if (quote !== "`" && /[\r\n]/.test(value)) return undefined;
  if (quote === "`" && value.includes("${")) return undefined;
  return value;
}

/** Run a global regex over [start, end) of the mask. */
function each(ctx: Ctx, re: RegExp, start: number, end: number, fn: (m: RegExpExecArray) => void): void {
  re.lastIndex = start;
  for (let m = re.exec(ctx.mask); m && m.index < end; m = re.exec(ctx.mask)) {
    fn(m);
    if (m[0].length === 0) re.lastIndex++;
  }
}

/** Position of the last character of the whole match (the opening quote, by construction). */
const lastPos = (m: RegExpExecArray) => m.index + m[0].length - 1;

// ─── JavaScript / TypeScript ─────────────────────────────────────────────────────────────────

// Bindings may be any identifier (`import { café }`, `import * as ü`), so the classes are
// Unicode ID_Continue rather than \w, which is ASCII-only and silently dropped those imports.
const JS_IMPORT = /(?<![\p{ID_Continue}$.])import\s+(type\s+)?(?:([\p{ID_Continue}$*{}\s,]{0,2000}?)\s*from\s*)?(["'])/gu;
const JS_EXPORT_FROM = /(?<![\p{ID_Continue}$.])export\s+(type\s+)?(\*\s*(?:as\s+[\p{ID_Continue}$]+\s*)?|\{[^}]{0,4000}\}\s*)from\s*(["'])/gu;
const JS_DYNAMIC = /(?<![\p{ID_Continue}$.])import\s*\(\s*(["'`])/gu;
const JS_REQUIRE = /(?<![\p{ID_Continue}$.])require\s*\(\s*(["'`])/gu;
const TRIPLE_SLASH = /^[ \t]*\/\/\/[ \t]*<reference\s+(path|types)\s*=\s*(["'])([^"'\n]*)\2/gm;
// `new URL("./worker.ts", import.meta.url)`: how Vite, webpack 5, Parcel and Node load a worker
// or an asset relative to the module. No import names the file, so a worker loaded this way
// read as a file nothing imports.
const JS_NEW_URL = /(?<![\p{ID_Continue}$.])new\s+URL\s*\(\s*(["'`])/gu;
const META_URL = /^\s*,\s*import\.meta\.url\b/;

/**
 * `{ type A, type B as C }` and nothing else: every specifier is erased. `{ type }` imports a
 * value named `type`, and `{ type as t }` renames one, so both stay runtime imports.
 */
function allTypeSpecifiers(bindings: string): boolean {
  const list = /^\s*\{([^}]*)\}\s*$/.exec(bindings)?.[1];
  if (list === undefined) return false;
  const parts = list.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s+(?!as\s+[\p{ID_Continue}$]+$)/u.test(p));
}

function extractJs(ctx: Ctx, start: number, end: number): void {
  each(ctx, JS_IMPORT, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec === undefined) return;
    const bindings = m[2] ?? "";
    // `import type from "./x"` is a default import named `type`: the keyword needs bindings after it.
    const typeOnly = (!!m[1] && bindings.trim() !== "") || allTypeSpecifiers(bindings);
    const imp = add(ctx, spec, "import", m.index, typeOnly);
    if (ctx.names) addNames(imp, importedNames(m[1] && !bindings.trim() ? "type" : bindings));
  });
  each(ctx, JS_EXPORT_FROM, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec === undefined) return;
    const imp = add(ctx, spec, "import", m.index, !!m[1] || allTypeSpecifiers(m[2]!));
    if (imp) imp.reexport = true;
    if (ctx.names) addNames(imp, importedNames(m[2]!));
  });
  each(ctx, JS_DYNAMIC, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec !== undefined) add(ctx, spec, "import", m.index);
  });
  each(ctx, JS_REQUIRE, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec !== undefined) add(ctx, spec, "require", m.index);
  });
  each(ctx, JS_NEW_URL, start, end, (m) => {
    const q = lastPos(m);
    const spec = stringAt(ctx, q);
    if (spec === undefined || !/^\.\.?\//.test(spec)) return; // relative to the module only
    const close = ctx.mask.indexOf(ctx.mask[q]!, q + 1);
    if (META_URL.test(ctx.mask.slice(close + 1, close + 80))) add(ctx, spec, "reference", m.index);
  });
  // Triple-slash directives live in comments, so they are matched in the original text and
  // kept only where the mask confirms a comment (not a string that happens to contain one).
  if (ctx.text.includes("/// <reference") || ctx.text.includes("///<reference")) {
    TRIPLE_SLASH.lastIndex = start;
    for (let m = TRIPLE_SLASH.exec(ctx.text); m && m.index < end; m = TRIPLE_SLASH.exec(ctx.text)) {
      const slash = ctx.text.indexOf("///", m.index);
      if (ctx.mask.charCodeAt(slash) !== 32) continue;
      add(ctx, m[3]!, "reference", m.index);
    }
  }
}

// ─── Style sheets ────────────────────────────────────────────────────────────────────────────

const CSS_AT = /@(import|use|forward)\b[ \t]*(?:\([^)\n]*\)[ \t]*)?(?:url\([ \t]*)?(["'])/g;
const CSS_AT_BARE_URL = /@import[ \t]+url\([ \t]*([^)"'\s]+)/g;
const CSS_URL = /(?<![\w-])url\([ \t]*(["']?)/g;

function isLocalAsset(spec: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\$|@\{|\{\{|<%)/i.test(spec) && !spec.includes("#{");
}

function extractCss(ctx: Ctx, start: number, end: number): void {
  // Statement spans of @import / @use / @forward: url() inside them is the import itself, not
  // an asset link.
  const statements: [number, number][] = [];
  each(ctx, CSS_AT, start, end, (m) => {
    const semi = ctx.mask.indexOf(";", m.index);
    statements.push([m.index, semi < 0 ? end : semi]);
    let q = lastPos(m);
    const kind: EdgeKind = "import";
    for (let guard = 0; guard < 64; guard++) {
      const spec = stringAt(ctx, q);
      if (spec === undefined) return;
      add(ctx, spec, kind, m.index);
      // `@import "a", "b";` lists several sheets in one rule.
      const close = ctx.mask.indexOf(ctx.mask[q]!, q + 1);
      const rest = /^[ \t]*\)?[ \t]*,\s*(?:url\([ \t]*)?(["'])/.exec(ctx.mask.slice(close + 1, close + 200));
      if (!rest) return;
      q = close + 1 + rest[0].length - 1;
    }
  });
  each(ctx, CSS_AT_BARE_URL, start, end, (m) => {
    add(ctx, m[1]!, "import", m.index);
    const semi = ctx.mask.indexOf(";", m.index);
    statements.push([m.index, semi < 0 ? end : semi]);
  });
  each(ctx, CSS_URL, start, end, (m) => {
    let spec: string | undefined;
    if (m[1]) spec = stringAt(ctx, lastPos(m));
    else {
      const close = ctx.mask.indexOf(")", m.index);
      spec = close > 0 ? ctx.text.slice(m.index + m[0].length, close).trim() : undefined;
      if (spec && /[\s\r\n]/.test(spec)) spec = undefined;
    }
    if (statements.some(([s, e]) => m.index > s && m.index < e)) return;
    if (spec && isLocalAsset(spec)) add(ctx, spec, "link", m.index);
  });
}

// ─── HTML and Markdown ───────────────────────────────────────────────────────────────────────

// The attribute must follow whitespace: `:src="logo"` / `v-bind:src` / `[src]` are bindings to
// script values, not paths.
const HTML_REF = /<(script|link|img|source)\b[^>]{0,2000}?(?<=\s)(src|href|srcset)\s*=\s*(["']?)([^"'\s>]*)/gi;

function isRelativeLink(spec: string): boolean {
  if (!spec || spec.startsWith("#") || spec.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return false;
  return !/[{}<>$]|%%/.test(spec);
}

function extractHtml(ctx: Ctx, start: number, end: number): void {
  each(ctx, HTML_REF, start, end, (m) => {
    const tag = m[1]!.toLowerCase();
    const attr = m[2]!.toLowerCase();
    if (tag === "link" && attr !== "href") return;
    if (tag === "script" && attr !== "src") return;
    let spec = m[4]!;
    if (attr === "srcset") spec = spec.split(/[\s,]/)[0] ?? "";
    if (isRelativeLink(spec)) add(ctx, spec, "link", m.index);
  });
}

const MD_INLINE = /!?\[(?:[^\]\\\n]|\\.){0,500}\]\(\s*(<[^>\n]{1,2000}>|[^)\s]{1,2000})/g;
const MD_REFDEF = /^ {0,3}\[[^\]\n]{1,500}\]:[ \t]*(<[^>\n]{1,2000}>|\S{1,2000})/;
const MD_HTML = /<(?:img|a|source)\b[^>]{0,1000}?\b(?:src|href)\s*=\s*["']([^"'\n]{1,2000})["']/gi;
const MD_FENCE = /^ {0,3}(`{3,}|~{3,})/;

function cleanLink(raw: string): string {
  let s = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  try {
    s = decodeURI(s);
  } catch {
    // Malformed escapes: keep the specifier as written.
  }
  return s;
}

/** A Markdown HTML block opening a script (CommonMark: at most three spaces of indent). */
const MD_SCRIPT = /^ {0,3}<script\b([^>]*)>/gim;
// The clause is bindings only (names, braces, commas, `*`), as in JS_IMPORT, so it can span
// lines without running on through prose to some later `from "…"` in the text.
const MDX_ESM = /^(?:import|export)\s+(type\s+)?([\p{ID_Continue}$*{}\s,]{0,2000}?)\s*\bfrom\s*(["'])([^"'\n]+)\3|^import\s*(["'])([^"'\n]+)\5/gmu;

function extractMarkdown(ctx: Ctx, withJs: boolean): void {
  const text = ctx.text;
  let fence = "";
  const starts = ctx.lineStarts;
  // Fenced lines, so the script and ESM passes below never read a code sample as code: a docs
  // page showing `<script setup>` or `import x from` in a fence is describing it, not doing it.
  const fenced: [number, number][] = [];
  for (let li = 0; li < starts.length; li++) {
    const s = starts[li]!;
    const e = li + 1 < starts.length ? starts[li + 1]! : text.length;
    const line = text.slice(s, e).replace(/[\r\n]+$/, "");
    if (fence) {
      fenced.at(-1)![1] = e;
      if (line.trimStart().startsWith(fence)) fence = "";
      continue;
    }
    const f = MD_FENCE.exec(line);
    if (f) {
      fence = f[1]!;
      fenced.push([s, e]);
      continue;
    }
    if (line.startsWith("    ") || line.startsWith("\t")) continue; // indented code block
    if (withJs && /^(?:import|export)\s/.test(line)) continue; // MDX statements, handled below
    const body = line.includes("`") ? line.replace(/`+[^`\n]*`+/g, (x) => " ".repeat(x.length)) : line;
    const push = (raw: string) => {
      const spec = cleanLink(raw.trim());
      if (isRelativeLink(spec)) ctx.out.push({ spec, kind: "link", line: li });
    };
    const ref = MD_REFDEF.exec(body);
    if (ref) {
      push(ref[1]!);
      continue;
    }
    MD_INLINE.lastIndex = 0;
    for (let m = MD_INLINE.exec(body); m; m = MD_INLINE.exec(body)) push(m[1]!);
    if (body.includes("<")) {
      MD_HTML.lastIndex = 0;
      for (let m = MD_HTML.exec(body); m; m = MD_HTML.exec(body)) push(m[1]!);
    }
  }
  // Fence contents blanked, offsets kept, for the two passes that look for code.
  let prose = text;
  if (fenced.length) {
    const parts: string[] = [];
    let at = 0;
    for (const [s, e] of fenced) {
      parts.push(text.slice(at, s), text.slice(s, e).replace(/[^\r\n]/g, " "));
      at = e;
    }
    parts.push(text.slice(at));
    prose = parts.join("");
  }
  if (withJs) {
    // MDX: ESM statements sit at the top level, outside fences, and the clause may span lines
    // (`import {\n  a,\n  b,\n} from "./x"`).
    MDX_ESM.lastIndex = 0;
    for (let m = MDX_ESM.exec(prose); m; m = MDX_ESM.exec(prose)) {
      const imp: ExtractedImport = { spec: m[4] ?? m[6]!, kind: "import", line: lineOf(ctx, m.index) };
      if (ctx.names) imp.names = m[4] === undefined ? [] : importedNames(m[1] && !m[2]!.trim() ? "type" : m[2]!);
      ctx.out.push(imp);
    }
  }
  // VitePress (and any Markdown that compiles to a component) runs a page's <script setup>
  // block, so its imports are the page's dependencies. Before this they were not read at all,
  // and a composable used only from docs pages was reported as an unused export.
  if (!prose.includes("<script") && !prose.includes("<SCRIPT")) return;
  const tsRules = getLexRules("typescript")!;
  MD_SCRIPT.lastIndex = 0;
  for (let m = MD_SCRIPT.exec(prose); m; m = MD_SCRIPT.exec(prose)) {
    if (/\bsrc\s*=/i.test(m[1]!) || m[1]!.trimEnd().endsWith("/")) continue;
    const bodyStart = m.index + m[0].length;
    const close = /<\/script\s*>/gi;
    close.lastIndex = bodyStart;
    const bodyEnd = close.exec(text)?.index ?? text.length;
    // The body lexed as TypeScript (a superset of what these blocks hold), so comments and
    // strings inside it are masked the way extractJs expects, at the page's own offsets.
    const body = scanWithRules(text.slice(bodyStart, bodyEnd), tsRules).mask;
    extractJs({ ...ctx, mask: text.slice(0, bodyStart) + body + text.slice(bodyEnd) }, bodyStart, bodyEnd);
    MD_SCRIPT.lastIndex = bodyEnd;
  }
}

// ─── Python ──────────────────────────────────────────────────────────────────────────────────

// Python 3 identifiers are Unicode (`import naïve`, `from .café import x`); \w would drop them.
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\p{ID_Continue}.]*)[ \t]+import[ \t]+(\([^)]{0,4000}\)|[^\n#;]{0,2000})/gmu;
const PY_IMPORT = /^[ \t]*import[ \t]+([^\n#;]{1,2000})/gm;
const PY_NAME = /^[\p{ID_Start}_]\p{ID_Continue}*$/u;
const PY_DOTTED = /^[\p{ID_Start}_][\p{ID_Continue}.]*$/u;

function extractPython(ctx: Ctx, start: number, end: number): void {
  each(ctx, PY_FROM, start, end, (m) => {
    const mod = m[1]!;
    if (/^\.+$/.test(mod)) {
      // `from . import a, b` imports sibling modules (or names from __init__): emit one
      // specifier per name so the resolver can find `a.py` before falling back to `.`.
      const names = m[2]!.replace(/[()\\\s]+/g, " ").split(",");
      let any = false;
      for (const part of names) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name && name !== "*" && PY_NAME.test(name)) {
          add(ctx, mod + name, "import", m.index);
          any = true;
        }
      }
      if (!any) add(ctx, mod, "import", m.index);
    } else add(ctx, mod, "import", m.index);
  });
  each(ctx, PY_IMPORT, start, end, (m) => {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+/)[0];
      if (name && PY_DOTTED.test(name)) add(ctx, name, "import", m.index);
    }
  });
}

// ─── Go ──────────────────────────────────────────────────────────────────────────────────────

const GO_SINGLE = /^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?(["`])/gm;
const GO_GROUP = /^[ \t]*import[ \t]*\(/gm;

function extractGo(ctx: Ctx, start: number, end: number): void {
  each(ctx, GO_SINGLE, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec !== undefined) add(ctx, spec, "import", m.index);
  });
  each(ctx, GO_GROUP, start, end, (m) => {
    const close = ctx.mask.indexOf(")", m.index + m[0].length);
    const stop = close < 0 ? end : close;
    for (let p = m.index + m[0].length; p < stop; p++) {
      const c = ctx.mask[p];
      if (c === '"' || c === "`") {
        const spec = stringAt(ctx, p);
        if (spec !== undefined) add(ctx, spec, "import", p);
        const q = ctx.mask.indexOf(c, p + 1);
        if (q < 0) break;
        p = q;
      }
    }
  });
}

// ─── Rust ────────────────────────────────────────────────────────────────────────────────────

const RUST_MOD = /^[ \t]*(?:#\[[^\]\n]*\][ \t]*)*(?:pub(?:\([^)\n]*\))?[ \t]+)?mod[ \t]+(?:r#)?(\w+)[ \t]*;/gm;
const RUST_USE = /(?<![\w#:])use\s+([^;]{1,4000});/g;
const RUST_EXTERN = /\bextern[ \t]+crate[ \t]+(\w+)/g;

/** Expand a use tree (`a::{b, c::{d, e}}`) into paths; capped so a huge std import stays sane. */
export function expandUseTree(tree: string, cap = 32): string[] {
  const out: string[] = [];
  const walk = (prefix: string, s: string) => {
    s = s.trim();
    const brace = s.indexOf("{");
    if (brace < 0) {
      let p = s.replace(/\s+as\s+\w+$/, "").trim();
      if (p === "self") p = "";
      const full = prefix && p ? `${prefix}::${p}` : prefix || p;
      if (full && full !== "*" && out.length < cap) out.push(full.replace(/::\*$/, ""));
      return;
    }
    const head = s.slice(0, brace).replace(/::\s*$/, "").trim();
    const inner = s.slice(brace + 1, s.lastIndexOf("}"));
    const base = prefix && head ? `${prefix}::${head}` : prefix || head;
    let depth = 0;
    let from = 0;
    for (let i = 0; i <= inner.length; i++) {
      const c = inner[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if ((c === "," && depth === 0) || i === inner.length) {
        const part = inner.slice(from, i);
        if (part.trim()) walk(base, part);
        from = i + 1;
      }
    }
  };
  walk("", tree.replace(/\s+/g, " "));
  return out;
}

const RUST_INLINE_MOD = /\bmod[ \t]+(?:r#)?\w+[ \t]*\{/g;

function extractRust(ctx: Ctx, start: number, end: number): void {
  // Inline `mod tests { … }` blocks: inside one, `super::` means this file's module, not its
  // parent. Without this every `use super::*` in a test block becomes an edge to the parent
  // module and fabricates a cycle through the crate root.
  const inline: [number, number][] = [];
  each(ctx, RUST_INLINE_MOD, start, end, (m) => {
    let depth = 0;
    for (let p = m.index + m[0].length - 1; p < end; p++) {
      const c = ctx.mask.charCodeAt(p);
      if (c === 123) depth++;
      else if (c === 125 && --depth === 0) {
        inline.push([m.index, p]);
        break;
      }
    }
  });
  each(ctx, RUST_MOD, start, end, (m) => add(ctx, m[1]!, "include", m.index));
  each(ctx, RUST_USE, start, end, (m) => {
    let nesting = 0;
    for (const [s, e] of inline) if (m.index > s && m.index < e) nesting++;
    for (let path of expandUseTree(m[1]!)) {
      path = path.replace(/^::/, "");
      if (nesting > 0) {
        // Each leading `super` first climbs out of an inline module, staying in this file.
        let k = 0;
        while (k < nesting && path.startsWith("super")) {
          path = path.replace(/^super(?:::)?/, "");
          k++;
        }
        if (k > 0) path = path ? `self::${path}` : "self";
      }
      add(ctx, path, "import", m.index);
    }
  });
  each(ctx, RUST_EXTERN, start, end, (m) => add(ctx, m[1]!, "import", m.index));
}

// ─── JVM, .NET, Swift, Dart ──────────────────────────────────────────────────────────────────

const JVM_IMPORT = /^[ \t]*import[ \t]+(?:static[ \t]+)?(\w+(?:\.\w+)*(?:\.\*|\._)?)(?:[ \t]*\.?[ \t]*\{([^}\n]*)\})?/gm;

function extractJvm(ctx: Ctx, start: number, end: number): void {
  each(ctx, JVM_IMPORT, start, end, (m) => {
    const path = m[1]!;
    if (m[2] !== undefined) {
      // Scala selectors: import a.b.{C, D => E, _}
      const prefix = path.replace(/\.$/, "");
      for (const sel of m[2].split(",")) {
        const name = sel.trim().split(/\s*=>\s*/)[0]?.trim();
        add(ctx, !name || name === "_" || name === "*" ? `${prefix}.*` : `${prefix}.${name}`, "import", m.index);
      }
    } else add(ctx, path, "import", m.index);
  });
}

const CS_USING = /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm;
const SWIFT_IMPORT = /^[ \t]*(?:@\w+[ \t]+)*import[ \t]+(?:(?:typealias|struct|class|enum|protocol|let|var|func)[ \t]+)?([\w.]+)/gm;
const DART_IMPORT = /^[ \t]*(import|export|part)[ \t]+(["'])/gm;

function extractSimple(ctx: Ctx, re: RegExp, kind: EdgeKind, start: number, end: number): void {
  each(ctx, re, start, end, (m) => add(ctx, m[1]!, kind, m.index));
}

function extractDart(ctx: Ctx, start: number, end: number): void {
  each(ctx, DART_IMPORT, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec !== undefined) add(ctx, spec, m[1] === "part" ? "include" : "import", m.index);
  });
}

// ─── C family ────────────────────────────────────────────────────────────────────────────────

const C_INCLUDE = /^[ \t]*#[ \t]*(?:include|import|include_next)[ \t]*([<"])/gm;
const OBJC_MODULE = /^[ \t]*@import[ \t]+([\w.]+)/gm;

function extractC(ctx: Ctx, start: number, end: number): void {
  each(ctx, C_INCLUDE, start, end, (m) => {
    const q = lastPos(m);
    if (m[1] === '"') {
      const spec = stringAt(ctx, q);
      if (spec !== undefined) add(ctx, spec, "include", m.index);
    } else {
      const close = ctx.text.indexOf(">", q);
      const nl = ctx.text.slice(q, close).search(/[\r\n]/);
      if (close > q && nl < 0) add(ctx, ctx.text.slice(q, close + 1), "include", m.index);
    }
  });
  each(ctx, OBJC_MODULE, start, end, (m) => add(ctx, m[1]!, "import", m.index));
}

// ─── Scripting languages ─────────────────────────────────────────────────────────────────────

const RUBY_REQUIRE = /(?<![.\w])(require_relative|require|load|autoload[ \t]*\(?[ \t]*:\w+[ \t]*,)[ \t]*\(?[ \t]*(["'])/g;
const PHP_INCLUDE = /(?<![\w$>])(require_once|require|include_once|include)\b[ \t]*\(?[ \t]*((?:__DIR__|dirname\([ \t]*__FILE__[ \t]*\))[ \t]*\.[ \t]*)?(["'])/g;
const PHP_USE = /^[ \t]*use[ \t]+(?:function[ \t]+|const[ \t]+)?\\?([\w\\]+?)(?:\\\{([^}]*)\})?[ \t]*(?:as[ \t]+\w+[ \t]*)?[;,]/gm;
const LUA_REQUIRE = /(?<![.\w:])require[ \t]*\(?[ \t]*(["'])/g;
const R_LIBRARY_BARE = /(?<![.\w])(?:library|require|requireNamespace)[ \t]*\([ \t]*([A-Za-z][\w.]*)/g;
const R_LIBRARY_QUOTED = /(?<![.\w])(?:library|require|requireNamespace)[ \t]*\([ \t]*(["'])/g;
const R_SOURCE = /(?<![.\w])source[ \t]*\([ \t]*(["'])/g;
const JULIA_USING = /^[ \t]*(?:using|import)[ \t]+([^\n#]+)/gm;
const JULIA_INCLUDE = /(?<![.\w])include[ \t]*\([ \t]*(["'])/g;
const PERL_USE = /^[ \t]*(?:use|require|no)[ \t]+([A-Za-z][\w:]*)/gm;
const PERL_REQUIRE_FILE = /(?<![\w$])(?:require|do)[ \t]+(["'])/g;
const ZIG_IMPORT = /@import[ \t]*\([ \t]*(["'])/g;
const ELIXIR_REF = /^[ \t]*(?:alias|import|require|use)[ \t]+([A-Z][\w.]*)(?:\.\{([^}]*)\})?/gm;
const HASKELL_IMPORT = /^import[ \t]+(?:safe[ \t]+)?(?:qualified[ \t]+)?(?:"[^"\n]*"[ \t]+)?([A-Z][\w.]*)/gm;
const PROTO_IMPORT = /^[ \t]*import[ \t]+(?:public[ \t]+|weak[ \t]+)?(["'])/gm;
const HCL_SOURCE = /(?<![\w-])source[ \t]*=[ \t]*(["'])/g;
const NIX_PATH = /(?<![\w.\/~-])(\.{1,2}\/[\w.\/+-]*[\w+-]|<[\w.\/+-]+>)/g;
const SHELL_SOURCE = /(?:^|[;&|({]|\bthen\b|\bdo\b|\belse\b)[ \t]*(?:source|\.)[ \t]+(?=[^\s=])/gm;
const DOCKER_FROM = /^[ \t]*FROM[ \t]+(?:--\S+[ \t]+)*(\S+)(?:[ \t]+AS[ \t]+(\S+))?/gim;
const MAKE_INCLUDE = /^[ \t]*-?s?include[ \t]+([^\n#]+)/gm;
const CMAKE_INCLUDE = /\b(include|add_subdirectory)[ \t]*\([ \t]*"?([^)"\s]+)/gi;

function quoted(ctx: Ctx, re: RegExp, kind: EdgeKind | ((m: RegExpExecArray) => EdgeKind), start: number, end: number): void {
  each(ctx, re, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec !== undefined) add(ctx, spec, typeof kind === "function" ? kind(m) : kind, m.index);
  });
}

function extractRuby(ctx: Ctx, start: number, end: number): void {
  each(ctx, RUBY_REQUIRE, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec === undefined) return;
    // require_relative is relative to the file even without "./"; say so in the specifier, or
    // the resolver would search the load path for it.
    const relative = m[1] === "require_relative" && !spec.startsWith(".") && !spec.startsWith("/");
    add(ctx, relative ? `./${spec}` : spec, "require", m.index);
  });
}

function extractPhp(ctx: Ctx, start: number, end: number): void {
  each(ctx, PHP_INCLUDE, start, end, (m) => {
    const spec = stringAt(ctx, lastPos(m));
    if (spec === undefined) return;
    // `__DIR__ . '/x.php'` is relative to the including file; mark it so.
    const full = m[2] ? `.${spec.startsWith("/") ? "" : "/"}${spec}` : spec;
    add(ctx, full, m[1]!.startsWith("require") ? "require" : "include", m.index);
  });
  each(ctx, PHP_USE, start, end, (m) => {
    const base = m[1]!;
    if (m[2] !== undefined) {
      for (const part of m[2].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) add(ctx, `${base}\\${name}`, "import", m.index);
      }
    } else add(ctx, base, "import", m.index);
  });
}

function extractR(ctx: Ctx, start: number, end: number): void {
  each(ctx, R_LIBRARY_BARE, start, end, (m) => add(ctx, m[1]!, "import", m.index));
  quoted(ctx, R_LIBRARY_QUOTED, "import", start, end);
  quoted(ctx, R_SOURCE, "include", start, end);
}

function extractJulia(ctx: Ctx, start: number, end: number): void {
  each(ctx, JULIA_USING, start, end, (m) => {
    const list = m[1]!.split(":")[0]!;
    for (const part of list.split(",")) {
      const name = part.trim();
      if (/^\.*[\w.]+$/.test(name)) add(ctx, name, "import", m.index);
    }
  });
  quoted(ctx, JULIA_INCLUDE, "include", start, end);
}

function extractPerl(ctx: Ctx, start: number, end: number): void {
  each(ctx, PERL_USE, start, end, (m) => {
    if (!/^v?\d/.test(m[1]!)) add(ctx, m[1]!, "import", m.index);
  });
  quoted(ctx, PERL_REQUIRE_FILE, "require", start, end);
}

function extractElixir(ctx: Ctx, start: number, end: number): void {
  each(ctx, ELIXIR_REF, start, end, (m) => {
    if (m[2] !== undefined) {
      for (const part of m[2].split(",")) if (part.trim()) add(ctx, `${m[1]}.${part.trim()}`, "import", m.index);
    } else add(ctx, m[1]!, "import", m.index);
  });
}

function extractNix(ctx: Ctx, start: number, end: number): void {
  each(ctx, NIX_PATH, start, end, (m) => {
    const before = ctx.mask.slice(Math.max(0, m.index - 16), m.index);
    add(ctx, m[1]!, /\b(?:import|callPackage)\s*$/.test(before) ? "import" : "reference", m.index);
  });
}

function extractShell(ctx: Ctx, start: number, end: number): void {
  each(ctx, SHELL_SOURCE, start, end, (m) => {
    const from = m.index + m[0].length;
    const eol = ctx.text.slice(from, from + 1000).search(/[\r\n;&|]|\s#/);
    let raw = ctx.text.slice(from, eol < 0 ? from + 1000 : from + eol).trim().split(/\s+(?=[^"']*$)/)[0] ?? "";
    raw = raw.replace(/["']/g, "");
    // `"$(dirname "$0")/lib.sh"`, `$DIR/lib.sh`, `${BASH_SOURCE%/*}/x`: keep the literal tail,
    // which the resolver matches relative to the script and then by path suffix.
    if (raw.includes("$")) raw = raw.replace(/^.*(?:\$\{[^}]*\}|\$\([^)]*\)|\$\w+)\/?/, "");
    // `<%= BASE %>/x.sh` and friends are templates rendered before the script runs.
    if (raw && !/[$<>%{}]/.test(raw)) add(ctx, raw, "include", m.index);
  });
}

function extractDocker(ctx: Ctx, start: number, end: number): void {
  // `FROM build AS final` after `FROM node:20 AS build` names an earlier stage, not an image.
  const stages = new Set<string>();
  each(ctx, DOCKER_FROM, start, end, (m) => {
    const image = m[1]!.toLowerCase();
    if (image !== "scratch" && !stages.has(image)) add(ctx, m[1]!, "reference", m.index);
    if (m[2]) stages.add(m[2].toLowerCase());
  });
}

function extractMake(ctx: Ctx, start: number, end: number): void {
  each(ctx, MAKE_INCLUDE, start, end, (m) => {
    for (const part of m[1]!.trim().split(/\s+/)) if (part && !part.includes("$(") && !part.includes("${")) add(ctx, part, "include", m.index);
  });
}

function extractCmake(ctx: Ctx, start: number, end: number): void {
  each(ctx, CMAKE_INCLUDE, start, end, (m) => {
    const spec = m[2]!;
    if (!spec.includes("${")) add(ctx, m[1]!.toLowerCase() === "add_subdirectory" ? `${spec.replace(/\/$/, "")}/CMakeLists.txt` : spec, "include", m.index);
  });
}

// ─── Dispatch ────────────────────────────────────────────────────────────────────────────────

type Extractor = (ctx: Ctx, start: number, end: number) => void;

const BY_LANGUAGE: Record<string, Extractor> = {
  javascript: extractJs,
  typescript: extractJs,
  tsx: extractJs,
  "glimmer-js": extractJs,
  "glimmer-ts": extractJs,
  css: extractCss,
  scss: extractCss,
  sass: extractCss,
  less: extractCss,
  stylus: extractCss,
  postcss: extractCss,
  python: extractPython,
  cython: extractPython,
  starlark: extractPython,
  go: extractGo,
  rust: extractRust,
  java: extractJvm,
  kotlin: extractJvm,
  scala: extractJvm,
  groovy: extractJvm,
  "gradle-kotlin-dsl": extractJvm,
  c: extractC,
  "c++": extractC,
  "objective-c": extractC,
  "objective-c++": extractC,
  cuda: extractC,
  metal: extractC,
  hlsl: extractC,
  glsl: extractC,
  "c#": (ctx, s, e) => extractSimple(ctx, CS_USING, "import", s, e),
  swift: (ctx, s, e) => extractSimple(ctx, SWIFT_IMPORT, "import", s, e),
  dart: extractDart,
  ruby: extractRuby,
  crystal: extractRuby,
  php: extractPhp,
  lua: (ctx, s, e) => quoted(ctx, LUA_REQUIRE, "require", s, e),
  luau: (ctx, s, e) => quoted(ctx, LUA_REQUIRE, "require", s, e),
  r: extractR,
  julia: extractJulia,
  perl: extractPerl,
  zig: (ctx, s, e) => quoted(ctx, ZIG_IMPORT, "import", s, e),
  elixir: extractElixir,
  haskell: (ctx, s, e) => extractSimple(ctx, HASKELL_IMPORT, "import", s, e),
  elm: (ctx, s, e) => extractSimple(ctx, HASKELL_IMPORT, "import", s, e),
  purescript: (ctx, s, e) => extractSimple(ctx, HASKELL_IMPORT, "import", s, e),
  "protocol-buffer": (ctx, s, e) => quoted(ctx, PROTO_IMPORT, "import", s, e),
  hcl: (ctx, s, e) => quoted(ctx, HCL_SOURCE, "reference", s, e),
  nix: extractNix,
  shell: extractShell,
  fish: extractShell,
  tcsh: extractShell,
  dockerfile: extractDocker,
  makefile: extractMake,
  cmake: extractCmake,
  html: extractHtml,
};

const HOSTS = new Set(["html", "vue", "svelte", "astro", "html+erb", "ejs", "handlebars"]);

/** Which extractor fits an embedded segment, by the rules the scanner chose for it. */
function segmentExtractor(rules: LexRules): Extractor | undefined {
  if (rules === getLexRules("javascript") || rules === getLexRules("typescript")) return extractJs;
  const style = ["css", "scss", "less", "sass", "stylus"];
  if (style.some((id) => rules === getLexRules(id))) return extractCss;
  if (rules.host || rules === getLexRules("html")) return extractHtml;
  return undefined;
}

// Typed through `satisfies` so callers see ExtractedImport and can read `typeOnly`.
export const extractImports = ((_path: string, text: string, languageId: string): ExtractedImport[] => {
  const markdown = languageId === "markdown" || languageId === "rmarkdown" || languageId === "mdx";
  const host = HOSTS.has(languageId);
  const extractor = BY_LANGUAGE[languageId];
  if (!extractor && !markdown && !host) return [];
  const rules = markdown ? undefined : getLexRules(languageId);
  const scan: Scan | undefined = rules ? scanWithRules(text, rules) : undefined;
  const ctx: Ctx = { text, mask: scan?.mask ?? text, out: [], seen: new Map(), lineStarts: lineStartsOf(text), names: host || markdown };
  if (markdown) extractMarkdown(ctx, languageId === "mdx");
  else if (scan && scan.segments.length > 1) {
    // HTML-like files: scripts, styles and markup each get their own extractor.
    for (const seg of scan.segments) segmentExtractor(seg.rules)?.(ctx, seg.start, seg.end);
  } else if (extractor) extractor(ctx, 0, text.length);
  else if (host) extractHtml(ctx, 0, text.length);
  ctx.out.sort((a, b) => a.line - b.line);
  return ctx.out;
}) satisfies ExtractImports;
