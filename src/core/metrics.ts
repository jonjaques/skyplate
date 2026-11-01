/**
 * Per-file text metrics: line classification (code / comment / blank), longest line,
 * keyword-based complexity, nesting depth, function and TODO counts, minified detection,
 * content hash, and format facts. Plus binary hashing and image headers.
 *
 * Everything rests on one linear scanner (`scanText`) driven by the language's LexRules. It
 * walks the text once, tracking whether it is in code, a comment or a string, and produces:
 *   - per-line classification by the cloc/tokei convention: a line with any code is code, a
 *     line with only comment text is comment, a line with only whitespace is blank (even inside
 *     a block comment or string, which is what cloc does);
 *   - a position-aligned "mask" of the text where comment characters become spaces and string
 *     contents become \x01, with every newline kept. Regexes for branches, functions and import
 *     statements then run over the mask in one pass each, and can never be fooled by a keyword
 *     inside a string or comment. extract.ts reuses the same mask to find import statements
 *     and slices the specifier out of the original text at the same offsets.
 *
 * The scanner is not a parser. It knows enough to keep string and comment boundaries right in
 * real code (nested block comments, raw strings, template literals with nested `${}`, regex
 * literals, heredocs, Python docstrings), and fails soft when it does not: single-line string
 * kinds end at the line break, so a stray quote costs one line, not the rest of the file.
 */

import type { Detection, MeasureBinary, MeasureText, TextMetrics } from "./contracts";
import type { FileFacts } from "../shared/schema";
import { getLexRules, type LexRules } from "./languages/syntax";
import { imageSize, parseNotebook, textFacts } from "./facts";

// ─── Hash ────────────────────────────────────────────────────────────────────────────────────

/** First 16 hex chars of SHA-1. Strings hash as UTF-8, matching the bytes on disk for UTF-8. */
export function contentHash(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha1").update(data).digest("hex").slice(0, 16);
}

// ─── Compiled lexer ──────────────────────────────────────────────────────────────────────────

const T_LINE = 1;
const T_BLOCK = 2;
const T_STR = 3;
const T_CHAR = 4;
const T_LINESTR = 5;
const T_CHARPREFIX = 6;
const T_RAW_RUST = 7;
const T_RAW_CPP = 8;
const T_LUA = 9;
const T_HEREDOC = 10;
const T_REGEX = 11;
const T_LINEWORD = 12;

const AT_ANY = 0;
const AT_START = 1;
const AT_COL1 = 2;
const AT_BOUNDARY = 3;

interface Tok {
  t: number;
  open: string;
  close: string;
  /** Backslash escapes the next character. */
  esc: boolean;
  /** May span lines (otherwise the line break ends it). */
  multi: boolean;
  /** Triple-quoted string that may turn out to be a docstring. */
  doc: boolean;
  /** JavaScript template literal (`${` interpolation). */
  tpl: boolean;
  /** Block comment that opens and closes only at line start. */
  atStartBlock: boolean;
  at: number;
  notAfter: string;
  notBefore: string;
}

interface Lexer {
  rules: LexRules;
  /** Candidate tokens by the char code of their first character (ASCII only). */
  table: (Tok[] | undefined)[];
  nested: boolean;
  branch: RegExp | null;
  functions: RegExp[];
  /** Template-literal token, for resuming after `${ … }`. */
  tpl: Tok | undefined;
}

const lexers = new WeakMap<LexRules, Lexer>();

function tok(t: number, open: string, close = "", extra: Partial<Tok> = {}): Tok {
  return { t, open, close, esc: false, multi: false, doc: false, tpl: false, atStartBlock: false, at: AT_ANY, notAfter: "", notBefore: "", ...extra };
}

function compile(rules: LexRules): Lexer {
  const cached = lexers.get(rules);
  if (cached) return cached;
  const table: (Tok[] | undefined)[] = new Array(128);
  const add = (first: string, k: Tok) => {
    const code = first.charCodeAt(0);
    if (code >= 128) return;
    (table[code] ??= []).push(k);
  };
  const position = (o: string) => {
    const p = rules.lineAt?.[o];
    return p === "start" ? AT_START : p === "col1" ? AT_COL1 : p === "boundary" ? AT_BOUNDARY : AT_ANY;
  };
  for (const o of rules.line) {
    add(o, tok(T_LINE, o, "", { at: position(o), notAfter: rules.lineNotAfter?.[o] ?? "", notBefore: rules.lineNotBefore?.[o] ?? "" }));
  }
  for (const w of rules.lineWords ?? []) {
    const k = tok(T_LINEWORD, w.toLowerCase(), "", { at: AT_START });
    add(w.toLowerCase(), k);
    add(w.toUpperCase(), k);
  }
  for (const [o, c] of rules.block) add(o, tok(T_BLOCK, o, c));
  for (const [o, c] of rules.blockAtStart ?? []) add(o, tok(T_BLOCK, o, c, { atStartBlock: true, at: AT_START }));
  const noEscape = new Set(rules.noEscape ?? []);
  const multiline = new Set(rules.multiline ?? []);
  let tpl: Tok | undefined;
  for (const s of rules.strings) {
    if (s === "'" && rules.charLiterals) {
      add(s, tok(T_CHAR, s, s));
      continue;
    }
    // `$'…'` (ANSI-C quoting) closes with the bare quote.
    const close = s.length === 2 && s[0] === "$" ? s.slice(1) : s;
    const k = tok(T_STR, s, close, {
      esc: !noEscape.has(s),
      multi: multiline.has(s),
      doc: (!!rules.docstrings || !!rules.docAttribute) && s.length === 3,
      tpl: !!rules.templates && s === "`",
    });
    if (k.tpl) tpl = k;
    add(s, k);
  }
  for (const [o, c] of rules.pairs ?? []) add(o, tok(T_STR, o, c, { multi: true }));
  for (const o of rules.lineStrings ?? []) add(o, tok(T_LINESTR, o));
  for (const o of rules.charPrefix ?? []) add(o, tok(T_CHARPREFIX, o));
  for (const r of rules.raw ?? []) {
    if (r === "rust") {
      add("r", tok(T_RAW_RUST, "r"));
      add("b", tok(T_RAW_RUST, "b"));
    } else if (r === "cpp") {
      for (const f of ["R", "u", "U", "L"]) add(f, tok(T_RAW_CPP, f));
    } else if (r === "lua") add("[", tok(T_LUA, "["));
  }
  if (rules.heredoc) add("<", tok(T_HEREDOC, "<"));
  if (rules.regex) add("/", tok(T_REGEX, "/"));
  // Longest opener first, so `"""` wins over `"` and `//` over a regex `/`.
  for (const bucket of table) bucket?.sort((a, b) => b.open.length - a.open.length);
  const lx: Lexer = {
    rules,
    table,
    nested: !!rules.nested,
    branch: compileBranches(rules),
    functions: rules.functions.map((re) => new RegExp(re.source, "gm" + (re.flags.includes("i") ? "i" : ""))),
    tpl,
  };
  lexers.set(rules, lx);
  return lx;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compileBranches(rules: LexRules): RegExp | null {
  if (rules.branches.length === 0) return null;
  const words: string[] = [];
  const ops: string[] = [];
  for (const b of rules.branches) {
    if (b === "?") ops.push("(?<=\\s)\\?(?=\\s)");
    else if (/^\w+$/.test(b)) words.push(b);
    else {
      let s = escapeRe(b);
      if (/^\w/.test(b)) s = "\\b" + s;
      if (/\w$/.test(b)) s += "\\b";
      ops.push(s);
    }
  }
  if (words.length) {
    // `END IF` / `End While` close blocks; only the opening keyword is a decision.
    const guard = rules.endKeywords ? "(?<!\\bend[ \\t]{1,4})" : "";
    ops.unshift(`${guard}\\b(?:${words.map(escapeRe).join("|")})\\b`);
  }
  return new RegExp(ops.join("|"), rules.caseInsensitive ? "gi" : "g");
}

// ─── Scanner ─────────────────────────────────────────────────────────────────────────────────

const SPAN_COMMENT = 0;
const SPAN_STRING = 1;

const S_CODE = 0;
const S_BLOCK = 1;
const S_STR = 2;
const S_HEREDOC = 3;

/** A stretch of the text lexed with one language's rules (HTML hosts have several). */
export interface Segment {
  start: number;
  end: number;
  rules: LexRules;
}

export interface Scan {
  lines: number;
  code: number;
  comment: number;
  blank: number;
  longestLine: number;
  maxDepth: number;
  /** Same length as the text: comments → spaces, string contents → \x01, newlines kept. */
  mask: string;
  segments: Segment[];
  /** Comment spans exist (TODO search is skipped otherwise). */
  hasComments: boolean;
  /** The file's own rules (a host's, for HTML-like files). */
  rules: LexRules;
}

interface Heredoc {
  term: string;
  /** "-" strips leading tabs before the terminator, "~" any leading whitespace. */
  mode: string;
}

const isIdent = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36;
const isSpace = (c: number) => c === 32 || c === 9 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff;

// Keywords after which `/` starts a regex rather than dividing.
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "and", "or", "not", "if", "unless", "when", "while", "until", "split", "grep", "map"]);
// Previous significant characters after which `/` starts a regex.
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^".split("").map((c) => c.charCodeAt(0)));

/**
 * Scan `text` as `languageId`. Returns undefined when the language has no lexical rules, in
 * which case callers treat every non-blank line as code.
 */
export function scanText(text: string, languageId: string): Scan | undefined {
  const rules = getLexRules(languageId);
  if (!rules) return undefined;
  return scanWithRules(text, rules);
}

export function scanWithRules(text: string, rules: LexRules): Scan {
  const n = text.length;
  const segments = rules.host ? hostSegments(text, rules) : [{ start: 0, end: n, rules }];
  const spans: number[] = [];

  // Line state, shared across segments so a line that straddles `<script>` is counted once.
  let lines = 0;
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let longest = 0;
  let lineStart = 0;
  let hasCode = false;
  let hasComment = false;
  let hasText = false; // non-blank text inside a docstring candidate
  let firstCode = -1;

  // Nesting.
  let brace = 0;
  let maxBrace = 0;
  let bracket = 0; // ( [ { — Python-style implicit line joining
  let lineBracket = 0;
  let lineInCode = true;
  let continued = false;
  let lineContinued = false;
  const indentStack: number[] = [0];
  let maxIndent = 0;
  let indentRules = rules.indent === true;

  // Docstring deferral: lines inside a triple-quoted string that opened a statement are held
  // until the closing quote shows whether anything follows it on the line.
  let inDoc = false;
  let docPending = 0;
  let docStart = 0;

  const endLine = (pos: number) => {
    const len = pos - lineStart;
    if (len > longest) longest = len;
    lines++;
    if (inDoc) {
      if (hasText) docPending++;
      else blankLines++;
    } else if (hasCode) {
      codeLines++;
      if (indentRules && lineInCode && lineBracket === 0 && !lineContinued && firstCode >= 0) {
        let w = 0;
        for (let p = lineStart; p < firstCode; p++) w = text.charCodeAt(p) === 9 ? (((w >> 3) + 1) << 3) : w + 1;
        while (indentStack.length > 1 && (indentStack[indentStack.length - 1] ?? 0) > w) indentStack.pop();
        if (w > (indentStack[indentStack.length - 1] ?? 0)) indentStack.push(w);
        if (indentStack.length - 1 > maxIndent) maxIndent = indentStack.length - 1;
      }
    } else if (hasComment) commentLines++;
    else blankLines++;
    hasCode = false;
    hasComment = false;
    hasText = false;
    firstCode = -1;
  };

  const markCode = (pos: number) => {
    hasCode = true;
    if (firstCode < 0) firstCode = pos;
  };

  const lineEnd = (from: number, end: number) => {
    let j = from;
    while (j < end) {
      const c = text.charCodeAt(j);
      if (c === 10 || c === 13) break;
      j++;
    }
    return j;
  };

  const onlySpaceBefore = (pos: number) => {
    for (let p = pos - 1; p >= lineStart; p--) if (!isSpace(text.charCodeAt(p))) return false;
    return true;
  };

  for (const seg of segments) {
    const lx = compile(seg.rules);
    const R = seg.rules;
    const table = lx.table;
    const end = seg.end;
    indentRules = R.indent === true;
    const braces = R.braces === true;
    let state = S_CODE;
    let cur: Tok | undefined; // current string or block token
    let close = "";
    let closeFirst = 0;
    let depth = 0; // block-comment nesting
    let spanStart = 0;
    let lastSig = -1;
    let lastSigPos = -1;
    const tplStack: number[] = [];
    const heredocs: Heredoc[] = [];
    let heredoc: Heredoc | undefined;
    let i = seg.start;

    const enterString = (k: Tok, at: number, openLen: number, closer: string, prefixStart: number) => {
      cur = k;
      close = closer;
      closeFirst = closer.charCodeAt(0);
      state = S_STR;
      // A docstring is a statement that is only a string: nothing but an allowed prefix before
      // it on the line, not inside brackets, not a continuation line.
      // Or a documentation attribute owns it (`@doc """`), in which case the attribute line is
      // part of the comment too.
      const statement = !!R.docstrings && bracket === 0 && !lineContinued && (firstCode < 0 || firstCode === prefixStart);
      const attribute = !!R.docAttribute && firstCode >= 0 && R.docAttribute.test(text.slice(lineStart, at));
      if (k.doc && (statement || attribute)) {
        inDoc = true;
        docPending = 0;
        docStart = attribute ? firstCode : prefixStart >= 0 ? prefixStart : at;
        hasCode = false;
        firstCode = -1;
        hasText = true;
      } else markCode(at);
      spanStart = at + openLen;
    };

    // ── Token entry: closures over this segment's state, created once per segment ──
    function tryToken(k: Tok, at: number): number {
      const open = k.open;
      if (k.t === T_LINEWORD) {
        if (text.slice(at, at + open.length).toLowerCase() !== open) return -1;
        if (hasCode || hasComment) return -1;
        if (isIdent(text.charCodeAt(at + open.length))) return -1;
        return lineComment(at);
      }
      if (open.length > 1 && !text.startsWith(open, at)) return -1;
      // Position rules.
      if (k.at === AT_START && (hasCode || hasComment || !onlySpaceBefore(at))) return -1;
      if (k.at === AT_COL1 && at !== lineStart) return -1;
      if (k.at === AT_BOUNDARY && at > lineStart) {
        const p = text.charCodeAt(at - 1);
        if (!isSpace(p) && p !== 59 && p !== 124 && p !== 38 && p !== 40 && p !== 41) return -1;
      }
      if (k.notAfter && at > 0 && k.notAfter.includes(text[at - 1]!)) return -1;
      if (k.notBefore && at + open.length < end && k.notBefore.includes(text[at + open.length]!)) return -1;

      switch (k.t) {
        case T_LINE: {
          // A `#!` interpreter line decides how the file runs; it is code, not commentary
          // (cloc counts it the same way).
          if (open === "#" && text.charCodeAt(at + 1) === 33 && (at === 0 || (at === 1 && text.charCodeAt(0) === 0xfeff))) {
            markCode(at);
            return lineEnd(at, end);
          }
          // Lua: `--[[` / `--[==[` open a long comment, not a line comment.
          if (R.raw?.includes("lua") && text.charCodeAt(at + 2) === 91) {
            const eq = longBracket(at + 2);
            if (eq >= 0) {
              cur = k;
              close = "]" + "=".repeat(eq) + "]";
              closeFirst = 93;
              depth = 1;
              state = S_BLOCK;
              spanStart = at;
              hasComment = true;
              return at + 4 + eq;
            }
          }
          return lineComment(at);
        }
        case T_BLOCK:
          cur = k;
          close = k.close;
          closeFirst = close.charCodeAt(0);
          depth = 1;
          state = S_BLOCK;
          spanStart = at;
          hasComment = true;
          return at + open.length;
        case T_STR: {
          if (R.quoteBoundary && at > lineStart) {
            const p = text.charCodeAt(at - 1);
            // After whitespace, `:`, `[`, `{`, `,`, `-`, or the `'` of a doubled `''` escape.
            if (!isSpace(p) && p !== 58 && p !== 91 && p !== 123 && p !== 44 && p !== 45 && p !== 39) return -1;
          }
          if (R.primeAfterWord && open === "'" && at > lineStart) {
            const p = text.charCodeAt(at - 1);
            if (isIdent(p) || p === 41 || p === 93 || p === 125 || p === 39 || p === 46) return -1;
          }
          enterString(k, at, open.length, k.close, prefixStart(at));
          return at + open.length;
        }
        case T_CHAR: {
          if (at > 0) {
            const p = text.charCodeAt(at - 1);
            if (isIdent(p)) return -1;
            if (R.primeAfterWord && (p === 41 || p === 93 || p === 125 || p === 39 || p === 46)) return -1;
          }
          const close = charLiteralEnd(at);
          if (close < 0) return -1;
          markCode(at);
          spans.push(at + 1, close, SPAN_STRING);
          lastSig = 39;
          lastSigPos = close;
          return close + 1;
        }
        case T_LINESTR: {
          markCode(at);
          const e = lineEnd(at, end);
          spans.push(at + open.length, e, SPAN_STRING);
          return e;
        }
        case T_CHARPREFIX: {
          if (at > 0 && isIdent(text.charCodeAt(at - 1))) return -1;
          const p = at + open.length;
          if (p >= end) return -1;
          const d = text.charCodeAt(p);
          if (d === 10 || d === 13) return -1;
          const w = d >= 0xd800 && d <= 0xdbff ? 2 : 1;
          markCode(at);
          spans.push(p, p + w, SPAN_STRING);
          return p + w;
        }
        case T_RAW_RUST: {
          if (at > 0 && isIdent(text.charCodeAt(at - 1))) return -1;
          let p = at;
          if (text.charCodeAt(p) === 98) p++; // b
          if (text.charCodeAt(p) !== 114) return -1; // r
          p++;
          let hashes = 0;
          while (text.charCodeAt(p) === 35) {
            hashes++;
            p++;
          }
          if (text.charCodeAt(p) !== 34) return -1;
          const k2 = tok(T_STR, "", '"' + "#".repeat(hashes), { multi: true });
          enterString(k2, at, p + 1 - at, k2.close, -2);
          return p + 1;
        }
        case T_RAW_CPP: {
          // R"delim( … )delim", optionally prefixed u8 / u / U / L.
          let p = at;
          if (at > 0 && isIdent(text.charCodeAt(at - 1))) return -1;
          if (text.charCodeAt(p) !== 82) {
            if (text.startsWith("u8R", p)) p += 2;
            else if (text.charCodeAt(p + 1) === 82) p += 1;
            else return -1;
          }
          if (text.charCodeAt(p + 1) !== 34) return -1;
          const paren = text.indexOf("(", p + 2);
          if (paren < 0 || paren - (p + 2) > 16) return -1;
          const delim = text.slice(p + 2, paren);
          if (/[\s\\)"]/.test(delim)) return -1;
          const k2 = tok(T_STR, "", ")" + delim + '"', { multi: true });
          enterString(k2, at, paren + 1 - at, k2.close, -2);
          return paren + 1;
        }
        case T_LUA: {
          const eq = longBracket(at);
          if (eq < 0) return -1;
          const k2 = tok(T_STR, "", "]" + "=".repeat(eq) + "]", { multi: true });
          enterString(k2, at, eq + 2, k2.close, -2);
          return at + eq + 2;
        }
        case T_HEREDOC:
          return heredocStart(at);
        case T_REGEX:
          return regexLiteral(at);
      }
      return -1;
    }

    function lineComment(at: number): number {
      hasComment = true;
      const e = lineEnd(at, end);
      spans.push(at, e, SPAN_COMMENT);
      return e;
    }

    /** Start of a valid string prefix run (r, b, f, u, rb …) directly before `at`, else -2. */
    function prefixStart(at: number): number {
      if (!R.stringPrefixes) return -2;
      let p = at;
      while (p > lineStart && p > at - 3 && /[rRbBuUfFtT]/.test(text[p - 1]!)) p--;
      if (p === at) return at;
      if (p > 0 && isIdent(text.charCodeAt(p - 1))) return -2;
      return p;
    }

    /** A literal prefix (b, u8, u, U, L) ends right before `at`, standing alone as a word. */
    function charPrefixBefore(at: number): boolean {
      let p = at;
      while (p > lineStart && p > at - 3 && isIdent(text.charCodeAt(p - 1))) p--;
      if (p > 0 && isIdent(text.charCodeAt(p - 1))) return false;
      const w = text.slice(p, at);
      return w === "b" || w === "u8" || w === "u" || w === "U" || w === "L";
    }

    /** `[` + n×`=` + `[` at `at` → n, else -1. */
    function longBracket(at: number): number {
      if (text.charCodeAt(at) !== 91) return -1;
      let p = at + 1;
      while (text.charCodeAt(p) === 61) p++;
      return text.charCodeAt(p) === 91 ? p - at - 1 : -1;
    }

    /** Index of the closing `'` of a short char literal starting at `at`, or -1. */
    function charLiteralEnd(at: number): number {
      const d = text.charCodeAt(at + 1);
      if (d === 92) {
        for (let p = at + 2; p < at + 14 && p < end; p++) {
          const e = text.charCodeAt(p);
          if (e === 10 || e === 13) return -1;
          if (e === 39 && p > at + 2) return p;
        }
        return -1;
      }
      if (d === 39 || d === 10 || d === 13 || Number.isNaN(d)) return -1;
      const w = d >= 0xd800 && d <= 0xdbff ? 2 : 1;
      return text.charCodeAt(at + 1 + w) === 39 ? at + 1 + w : -1;
    }

    function heredocStart(at: number): number {
      const flavor = R.heredoc;
      let re: RegExp;
      if (flavor === "shell") {
        if (text.charCodeAt(at + 2) === 60) return -1; // <<< is a here-string
        re = /<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/y;
      } else if (flavor === "php") re = /<<<[ \t]*(["']?)([A-Za-z_]\w*)\1/y;
      else re = /<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/y;
      re.lastIndex = at;
      const m = re.exec(text);
      if (!m) return -1;
      let term: string;
      let mode: string;
      if (flavor === "php") {
        term = m[2]!;
        mode = "~";
      } else {
        term = m[3]!;
        mode = m[1] ?? "";
        // Ruby and Perl: an unquoted terminator must start uppercase, so `a <<b` stays a shift.
        if (flavor !== "shell" && !m[2] && !/^[A-Z_]/.test(term)) return -1;
        if (flavor === "perl" && !mode) mode = "";
      }
      heredocs.push({ term, mode });
      markCode(at);
      return at + m[0].length;
    }

    function regexLiteral(at: number): number {
      const next = text.charCodeAt(at + 1);
      if (next === 47 || next === 42) return -1;
      if (lastSig >= 0 && !REGEX_AFTER.has(lastSig)) {
        if (!isIdent(lastSig)) return -1;
        let p = lastSigPos;
        while (p > 0 && p > lastSigPos - 12 && isIdent(text.charCodeAt(p - 1))) p--;
        if (!REGEX_KEYWORDS.has(text.slice(p, lastSigPos + 1))) return -1;
      }
      let inClass = false;
      for (let p = at + 1; p < end; p++) {
        const d = text.charCodeAt(p);
        if (d === 10 || d === 13) return -1;
        if (d === 92) {
          p++;
          continue;
        }
        if (inClass) {
          if (d === 93) inClass = false;
        } else if (d === 91) inClass = true;
        else if (d === 47) {
          markCode(at);
          spans.push(at + 1, p, SPAN_STRING);
          lastSig = 47;
          lastSigPos = p;
          return p + 1;
        }
      }
      return -1;
    }

    while (i < end) {
      const c = text.charCodeAt(i);

      // ── Line breaks, common to every state ──
      if (c === 10 || c === 13) {
        if (state === S_STR && cur && !cur.multi) {
          // Unterminated single-line string: end it here so the damage stays on this line.
          spans.push(spanStart, i, SPAN_STRING);
          state = S_CODE;
          if (inDoc) inDoc = false;
        }
        if (state === S_CODE && indentRules) {
          let p = i - 1;
          while (p >= lineStart && isSpace(text.charCodeAt(p))) p--;
          continued = p >= lineStart && text.charCodeAt(p) === 92;
        } else continued = false;
        endLine(i);
        i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        lineStart = i;
        lineBracket = bracket;
        lineContinued = continued;
        if (state === S_CODE && heredocs.length) {
          heredoc = heredocs.shift();
          state = S_HEREDOC;
          spanStart = i;
        }
        lineInCode = state === S_CODE;
        continue;
      }

      if (state === S_CODE) {
        if (c === 32 || c === 9) {
          i++;
          continue;
        }
        const bucket = c < 128 ? table[c] : undefined;
        let handled = false;
        if (bucket) {
          for (const k of bucket) {
            const next = tryToken(k, i);
            if (next >= 0) {
              i = next;
              handled = true;
              break;
            }
          }
        }
        if (handled) continue;
        if (!isSpace(c)) {
          markCode(i);
          lastSig = c;
          lastSigPos = i;
        }
        if (c === 123) {
          if (tplStack.length) tplStack[tplStack.length - 1]!++;
          if (braces && ++brace > maxBrace) maxBrace = brace;
          bracket++;
        } else if (c === 125) {
          if (tplStack.length) {
            const top = tplStack.length - 1;
            if (tplStack[top] === 0 && lx.tpl) {
              // End of `${ … }`: back into the template literal.
              tplStack.pop();
              cur = lx.tpl;
              close = "`";
              closeFirst = 96;
              state = S_STR;
              spanStart = i + 1;
              i++;
              continue;
            }
            tplStack[top]!--;
          }
          if (braces && brace > 0) brace--;
          if (bracket > 0) bracket--;
        } else if (c === 40 || c === 91) bracket++;
        else if ((c === 41 || c === 93) && bracket > 0) bracket--;
        i++;
        continue;
      }

      if (state === S_BLOCK) {
        const k = cur!;
        for (; i < end; ) {
          const d = text.charCodeAt(i);
          if (d === 10 || d === 13) break;
          if (lx.nested && d === k.open.charCodeAt(0) && text.startsWith(k.open, i) && !k.atStartBlock) {
            depth++;
            i += k.open.length;
            hasComment = true;
            continue;
          }
          if (d === closeFirst && text.startsWith(close, i) && (!k.atStartBlock || onlySpaceBefore(i))) {
            // A line holding only ` */` is a comment line, not a blank one.
            hasComment = true;
            i += close.length;
            if (k.atStartBlock) i = lineEnd(i, end); // `=end` / `=cut` lines belong to the block
            if (--depth === 0) {
              spans.push(spanStart, i, SPAN_COMMENT);
              state = S_CODE;
              break;
            }
            continue;
          }
          if (!isSpace(d)) hasComment = true;
          i++;
        }
        continue;
      }

      if (state === S_STR) {
        const k = cur!;
        for (; i < end; ) {
          const d = text.charCodeAt(i);
          if (d === 10 || d === 13) break;
          if (k.esc && d === 92) {
            const e = text.charCodeAt(i + 1);
            // An escaped line break continues the string. Multi-line kinds let the outer loop
            // count the line; a single-line kind would be ended there as unterminated, so its
            // line is counted here and the string carries on.
            if (e === 10 || e === 13) {
              i++;
              if (!k.multi) {
                if (inDoc) hasText = true;
                else markCode(i);
                const nl = e === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
                endLine(i);
                i += nl;
                lineStart = i;
                lineBracket = bracket;
                lineContinued = true;
                lineInCode = false;
                continue;
              }
              break;
            }
            i += 2;
            if (inDoc) hasText = true;
            else markCode(i - 2);
            continue;
          }
          if (k.tpl && d === 36 && text.charCodeAt(i + 1) === 123) {
            spans.push(spanStart, i, SPAN_STRING);
            tplStack.push(0);
            state = S_CODE;
            markCode(i);
            i += 2;
            break;
          }
          if (d === closeFirst && text.startsWith(close, i)) {
            const contentEnd = i;
            i += close.length;
            state = S_CODE;
            lastSig = d;
            lastSigPos = i - 1;
            if (inDoc) {
              inDoc = false;
              let j = i;
              while (j < end && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
              const after = j < end ? text.charCodeAt(j) : 10;
              if (after === 10 || after === 13 || after === 35 /* # */) {
                spans.push(docStart, i, SPAN_COMMENT);
                commentLines += docPending;
                hasComment = true;
              } else {
                spans.push(spanStart, contentEnd, SPAN_STRING);
                codeLines += docPending;
                markCode(docStart);
              }
              docPending = 0;
            } else {
              spans.push(spanStart, contentEnd, SPAN_STRING);
              markCode(contentEnd);
            }
            break;
          }
          if (!isSpace(d)) {
            if (inDoc) hasText = true;
            else markCode(i);
          }
          i++;
        }
        continue;
      }

      // S_HEREDOC: processed a line at a time from its start.
      const eol = lineEnd(i, end);
      const h = heredoc!;
      let line = text.slice(i, eol);
      if (h.mode === "-") line = line.replace(/^\t+/, "");
      else if (h.mode === "~") line = line.trimStart();
      if (line.trimEnd() === h.term) {
        spans.push(spanStart, i, SPAN_STRING);
        markCode(i);
        state = S_CODE;
      } else if (line.trim() !== "") markCode(i);
      i = eol;
      continue;
    }

    // Segment ended inside a construct: close its span at the segment boundary.
    if (state === S_BLOCK) spans.push(spanStart, end, SPAN_COMMENT);
    else if (state === S_STR || state === S_HEREDOC) spans.push(spanStart, end, SPAN_STRING);
    if (inDoc) {
      // An unterminated triple-quoted string is not a docstring.
      inDoc = false;
      codeLines += docPending;
      docPending = 0;
      hasCode = true;
    }
  }
  if (lineStart < n) endLine(n);

  let hasComments = false;
  for (let k = 2; k < spans.length; k += 3) {
    if (spans[k] === SPAN_COMMENT) {
      hasComments = true;
      break;
    }
  }

  return {
    lines,
    code: codeLines,
    comment: commentLines,
    blank: blankLines,
    longestLine: longest,
    maxDepth: Math.max(maxBrace, maxIndent),
    mask: buildMask(text, spans),
    segments,
    hasComments,
    rules,
  };
}

// ─── Mask ────────────────────────────────────────────────────────────────────────────────────

let SPACES = " ".repeat(4096);
let MARKS = "\x01".repeat(4096);

function fill(kind: number, len: number): string {
  if (kind === SPAN_COMMENT) {
    while (SPACES.length < len) SPACES += SPACES;
    return SPACES.slice(0, len);
  }
  while (MARKS.length < len) MARKS += MARKS;
  return MARKS.slice(0, len);
}

function buildMask(text: string, spans: number[]): string {
  if (spans.length === 0) return text;
  // Spans arrive in text order (a docstring is pushed at its close, but nothing is recorded
  // while inside it). Sorting is a guard, only paid when that ever stops being true.
  const order: number[] = [];
  let sorted = true;
  for (let k = 0; k < spans.length; k += 3) {
    if (k > 0 && spans[k]! < spans[k - 3]!) sorted = false;
    order.push(k);
  }
  if (!sorted) order.sort((a, b) => spans[a]! - spans[b]!);
  const parts: string[] = [];
  // Next LF / CR at or after the cursor, cached because the cursor only moves forward. Without
  // the cache, one stray CR in a large file makes every span search to it: quadratic.
  let nextLF = -1;
  let nextCR = text.includes("\r") ? -1 : Infinity;
  const nextBreak = (p: number) => {
    if (nextLF < p) {
      nextLF = text.indexOf("\n", p);
      if (nextLF < 0) nextLF = Infinity;
    }
    if (nextCR < p) {
      nextCR = text.indexOf("\r", p);
      if (nextCR < 0) nextCR = Infinity;
    }
    return Math.min(nextLF, nextCR);
  };
  let pos = 0;
  for (const k of order) {
    const s = Math.max(spans[k]!, pos);
    const e = spans[k + 1]!;
    const kind = spans[k + 2]!;
    if (e <= s) continue;
    if (s > pos) parts.push(text.slice(pos, s));
    // Keep line breaks so line numbers and per-line regexes line up with the original.
    let p = s;
    while (p < e) {
      const nl = nextBreak(p);
      if (nl >= e) {
        parts.push(fill(kind, e - p));
        break;
      }
      if (nl > p) parts.push(fill(kind, nl - p));
      parts.push(text[nl]!);
      p = nl + 1;
    }
    pos = e;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts.join("");
}

// ─── Embedded languages ──────────────────────────────────────────────────────────────────────

const PLAIN: LexRules = { programming: false, line: [], block: [], strings: [], branches: [], functions: [] };

function scriptRules(attrs: string): LexRules {
  const lang = /\blang\s*=\s*["']?([\w+-]+)/i.exec(attrs)?.[1]?.toLowerCase();
  const type = /\btype\s*=\s*["']?([\w+/.-]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
  if (lang === "ts" || lang === "typescript" || lang === "tsx" || type.includes("typescript")) return getLexRules("typescript")!;
  if (lang === "coffee" || lang === "coffeescript") return getLexRules("coffeescript")!;
  if (/json|importmap/.test(type)) return getLexRules("json5")!;
  if (/template|html|markdown|text\/x-/.test(type)) return PLAIN;
  return getLexRules("javascript")!;
}

function styleRules(attrs: string): LexRules {
  const lang = /\blang\s*=\s*["']?([\w-]+)/i.exec(attrs)?.[1]?.toLowerCase();
  return getLexRules(lang === "scss" || lang === "sass" || lang === "less" || lang === "stylus" ? lang : "css")!;
}

/** Split an HTML / Vue / Svelte / Astro file into markup and embedded script/style segments. */
function hostSegments(text: string, host: LexRules): Segment[] {
  const segs: Segment[] = [];
  const n = text.length;
  let pos = 0;
  if (host.host === "astro") {
    const fm = /^﻿?---[ \t]*\r?\n/.exec(text);
    if (fm) {
      const close = /^---[ \t]*$/m;
      const rest = text.slice(fm[0].length);
      const m = close.exec(rest);
      const bodyEnd = m ? fm[0].length + m.index : n;
      segs.push({ start: 0, end: fm[0].length, rules: host });
      segs.push({ start: fm[0].length, end: bodyEnd, rules: getLexRules("typescript")! });
      pos = bodyEnd;
    }
  }
  const open = /<(script|style)\b([^>]*)>/gi;
  open.lastIndex = pos;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    const attrs = m[2] ?? "";
    if (attrs.trimEnd().endsWith("/")) continue;
    const tag = m[1]!.toLowerCase();
    const bodyStart = m.index + m[0].length;
    const closeRe = tag === "script" ? /<\/script\s*>/gi : /<\/style\s*>/gi;
    closeRe.lastIndex = bodyStart;
    const cm = closeRe.exec(text);
    const bodyEnd = cm ? cm.index : n;
    if (bodyStart > pos) segs.push({ start: pos, end: bodyStart, rules: host });
    if (bodyEnd > bodyStart) segs.push({ start: bodyStart, end: bodyEnd, rules: tag === "script" ? scriptRules(attrs) : styleRules(attrs) });
    pos = bodyEnd;
    open.lastIndex = cm ? cm.index + cm[0].length : n;
  }
  if (pos < n || segs.length === 0) segs.push({ start: pos, end: n, rules: host });
  return segs;
}

// ─── Derived counts ──────────────────────────────────────────────────────────────────────────

function countAll(re: RegExp, s: string): number {
  re.lastIndex = 0;
  return s.match(re)?.length ?? 0;
}

const TODO = /\b(?:TODO|FIXME|HACK|XXX|BUG)\b/g;

/**
 * Branch and function counts over the mask, per segment so each uses its own rules. Whether
 * complexity applies is the file's call, not the segment's: an HTML page with an inline script
 * stays at 0, a Vue component (whose rules opt in) gets its script's decision points.
 */
function codeCounts(scan: Scan): { branches: number; functions: number; programming: boolean } {
  let branches = 0;
  let functions = 0;
  const whole = scan.segments.length === 1;
  for (const seg of scan.segments) {
    const lx = compile(seg.rules);
    if (!lx.branch && lx.functions.length === 0) continue;
    const body = whole ? scan.mask : scan.mask.slice(seg.start, seg.end);
    if (lx.branch) branches += countAll(lx.branch, body);
    for (const re of lx.functions) functions += countAll(re, body);
  }
  return { branches, functions, programming: scan.rules.programming };
}

/** TODO markers whose position the mask shows to be inside a comment. */
function countTodos(text: string, mask: string): number {
  let n = 0;
  TODO.lastIndex = 0;
  for (let m = TODO.exec(text); m; m = TODO.exec(text)) {
    if (mask.charCodeAt(m.index) === 32) n++;
  }
  return n;
}

/** Line counts for text with no lexical rules: every non-blank line is code. */
function plainLines(text: string): { lines: number; code: number; blank: number; longest: number } {
  const n = text.length;
  let lines = 0;
  let code = 0;
  let longest = 0;
  let start = 0;
  let nonBlank = false;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      lines++;
      if (nonBlank) code++;
      if (i - start > longest) longest = i - start;
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
      nonBlank = false;
    } else if (!nonBlank && !isSpace(c)) nonBlank = true;
  }
  if (start < n) {
    lines++;
    if (nonBlank) code++;
    if (n - start > longest) longest = n - start;
  }
  return { lines, code, blank: lines - code, longest };
}

// ─── measureText ─────────────────────────────────────────────────────────────────────────────

export const measureText: MeasureText = (path, text, languageId) => {
  const hash = contentHash(text);
  if (languageId === "jupyter-notebook") {
    const nb = measureNotebook(text, hash);
    if (nb) return nb;
  }
  const facts = textFacts(text, languageId, path);
  const scan = scanText(text, languageId);
  let result: TextMetrics;
  if (!scan) {
    const p = plainLines(text);
    result = {
      lines: p.lines,
      code: p.code,
      comment: 0,
      blank: p.blank,
      longestLine: p.longest,
      complexity: 0,
      maxDepth: 0,
      functions: 0,
      todos: 0,
      minified: isMinified(p.longest, p.lines, text.length),
      hash,
    };
  } else {
    const counts = codeCounts(scan);
    result = {
      lines: scan.lines,
      code: scan.code,
      comment: scan.comment,
      blank: scan.blank,
      longestLine: scan.longestLine,
      complexity: counts.programming ? 1 + counts.branches : 0,
      maxDepth: scan.maxDepth,
      functions: counts.functions,
      todos: scan.hasComments ? countTodos(text, scan.mask) : 0,
      minified: isMinified(scan.longestLine, scan.lines, text.length),
      hash,
    };
  }
  if (facts) result.facts = facts;
  return result;
};

/** One very long line in a short file, or a high average: almost certainly built output. */
function isMinified(longest: number, lines: number, chars: number): boolean {
  if (lines === 0) return false;
  return (longest > 1000 && lines <= 10) || chars / lines > 300;
}

/**
 * Notebooks are measured from their cell sources, not the JSON around them. The raw file is
 * mostly JSON punctuation and base64 outputs, so counting it would rank a plotting notebook
 * above most of the codebase. Code cells are scanned with the kernel language's rules;
 * markdown and raw cells count as comment lines — they are the notebook's prose about its
 * code, which is what a comment ratio is meant to capture. Complexity stays 0 (a notebook is
 * not a programming-language file by linguist type), but functions, depth and TODOs come from
 * the code cells. Unparseable notebooks fall through to plain JSON counting.
 */
function measureNotebook(text: string, hash: string): TextMetrics | undefined {
  const nb = parseNotebook(text);
  if (!nb) return undefined;
  const joinCells = (cells: string[]) => cells.map((c) => (c.endsWith("\n") || c === "" ? c : c + "\n")).join("");
  const codeText = joinCells(nb.code);
  const rules = getLexRules(nb.languageId ?? "python") ?? getLexRules("python")!;
  const scan = scanWithRules(codeText, rules);
  const prose = plainLines(joinCells(nb.markdown));
  const counts = codeCounts(scan);
  const lines = scan.lines + prose.lines;
  const longest = Math.max(scan.longestLine, prose.longest);
  return {
    lines,
    code: scan.code,
    comment: scan.comment + prose.code,
    blank: scan.blank + prose.blank,
    longestLine: longest,
    complexity: 0,
    maxDepth: scan.maxDepth,
    functions: counts.functions,
    todos: scan.hasComments ? countTodos(codeText, scan.mask) : 0,
    minified: false,
    hash,
    facts: nb.facts,
  };
}

// ─── measureBinary ───────────────────────────────────────────────────────────────────────────

export const measureBinary: MeasureBinary = (_path, bytes, detection: Detection) => {
  const hash = contentHash(bytes);
  const facts: FileFacts = {};
  const image = imageSize(bytes);
  if (image) {
    facts.width = image.width;
    facts.height = image.height;
  }
  const format = detection.format ?? image?.format;
  if (format) facts.format = format;
  return Object.keys(facts).length ? { hash, facts } : { hash };
};
