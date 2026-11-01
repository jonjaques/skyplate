/**
 * Lexical rules per language: enough to tell code from comments and strings, count decision
 * points and spot function definitions, without a parser.
 *
 * Keyed by language id (linguist name, lowercased, spaces → "-"). This file deliberately does
 * not import the language registry: the two are written independently and only share the id
 * convention, so every id below is spelled exactly as linguist names the language.
 *
 * The public `Syntax` contract carries the portable part (openers, delimiters, branch words,
 * function patterns). Real languages need more than that to lex correctly — Rust lifetimes are
 * not char literals, YAML apostrophes in plain scalars are not strings, a shell `#` inside a
 * word is not a comment — so each entry is a `LexRules`, a superset the scanner in metrics.ts
 * reads. `getSyntax` returns the same objects typed as the contract.
 *
 * Branch entries follow one small convention so the list stays declarative:
 *   - a bare word ("if", "elif") matches as a whole word;
 *   - anything else is a literal operator ("&&", "??", "=>", "(if", "-and"), with a word
 *     boundary added on whichever end is a word character;
 *   - "?" alone means the conditional operator, recognized only with whitespace on both sides,
 *     which is how every style guide writes it and the only cheap way to tell it apart from
 *     optional chaining (`a?.b`), TS optionals (`x?: T`), Ruby predicates (`empty?`) and Rust's
 *     `?` error propagation.
 *
 * Function patterns are written to be line-local (no pattern crosses a newline) and use only
 * bounded repetition, because metrics.ts runs each one with the `m` flag over the whole
 * blanked file in one pass — equivalent to per-line application, far cheaper — and a minified
 * bundle is one enormous line where an unbounded backtracking pattern would go quadratic.
 * Line-anchored patterns open with a lookahead on the first non-blank character: JavaScriptCore
 * does not skip ahead by first character under the `m` flag, and without the guard every `}`
 * line walks the whole modifier alternation (measured: 17 ms → 1.8 ms on 1 MiB of TypeScript).
 */

import type { GetSyntax, Syntax } from "../contracts";

// ─── Extended rules ──────────────────────────────────────────────────────────────────────────

/**
 * Where a line-comment opener counts: anywhere; first non-blank on the line; at column 1
 * exactly (fixed-form Fortran); or at a word boundary (after whitespace, `;`, `|`, `&`, `(`).
 */
export type OpenerPosition = "any" | "start" | "col1" | "boundary";

export interface LexRules extends Syntax {
  /** linguist type is "programming": complexity is 1 + decision points (else 0). */
  programming: boolean;
  /** Nesting depth is measured with `{ }` (when neither this nor `indent`, maxDepth is 0). */
  braces?: boolean;
  /** Per-opener position rule for line comments (absent → "any"). */
  lineAt?: Record<string, OpenerPosition>;
  /** Characters that cancel a line opener when they directly precede it (TeX `\%`, `$#`). */
  lineNotAfter?: Record<string, string>;
  /** Characters that cancel a line opener when they directly follow it (PHP `#[`, Haskell `-->`). */
  lineNotBefore?: Record<string, string>;
  /** Statement-like line openers (REM): first on the line, any case, then a non-word char. */
  lineWords?: string[];
  /** Block comments that open and close only as the first thing on a line (=begin, POD, %{). */
  blockAtStart?: [string, string][];
  /** Extra string forms with their own closer, no escapes, may span lines (C# @"…", Nix ''…''). */
  pairs?: [string, string][];
  /** Delimiters whose contents have no backslash escapes (Go `, shell ', SQL '). */
  noEscape?: string[];
  /** Delimiters that may span lines. Others end at the line break, which caps the damage of a
   *  stray quote (an apostrophe in JSX text, a `'` in a TeX-ish comment) at one line. */
  multiline?: string[];
  /** `'` opens a char literal only in the short form 'x' / '\n' / '\u{..}'; otherwise it is
   *  code. Rust lifetimes, OCaml type variables, Haskell primes and C++14 digit separators all
   *  put a lone apostrophe in code. */
  charLiterals?: boolean;
  /** Quotes open a string only at the start of a value (YAML plain scalars carry apostrophes). */
  quoteBoundary?: boolean;
  /** `'` after an identifier, `)` or `]` is an operator (MATLAB transpose, Julia adjoint). */
  primeAfterWord?: boolean;
  /** JavaScript template literals with nested `${ … }` interpolation. */
  templates?: boolean;
  /** Regex literals after an operator or keyword (JavaScript, Ruby, Perl, awk). */
  regex?: boolean;
  /** Raw string flavors: Rust r#"…"#, C++ R"d(…)d", Lua [==[…]==]. */
  raw?: ("rust" | "cpp" | "lua")[];
  /** Heredoc flavor; the body is string content up to the terminator line. */
  heredoc?: "shell" | "ruby" | "perl" | "php";
  /** Prefixes after which the next character is a literal (Clojure \", Scheme #\", Elisp ?"). */
  charPrefix?: string[];
  /** Openers that make the rest of the line a string (Zig `\\` multiline string lines). */
  lineStrings?: string[];
  /** Identifier prefixes allowed directly before a string (Python r"", f"", rb""). */
  stringPrefixes?: boolean;
  /** Line text before a triple-quoted string that makes it documentation (Elixir `@doc """`). */
  docAttribute?: RegExp;
  /** Keywords compare without case (SQL, Fortran, VB, Pascal, Ada, batch, PowerShell). */
  caseInsensitive?: boolean;
  /** A branch word right after `end` closes a block (END IF, End While) and is not counted. */
  endKeywords?: boolean;
  /** Markup host whose <script>/<style> blocks (and Astro front matter) are lexed with their
   *  own language's rules. */
  host?: "html" | "astro";
}

// ─── Shared fragments ────────────────────────────────────────────────────────────────────────

const SLASH_BLOCK: [string, string][] = [["/*", "*/"]];
const HTML_BLOCK: [string, string][] = [["<!--", "-->"]];

const C_BRANCHES = ["if", "for", "while", "case", "catch", "&&", "||", "?"];

// A C-style definition: one to four type words, a name, a parameter list, and no `;` before
// the end of the line (a prototype or a call statement has one). Allman-style bodies, where
// `{` sits on the next line, still match because only `;` disqualifies.
const C_FUNCTION =
  /^[ \t]*(?=[A-Za-z_])(?!(?:return|else|case|goto|throw|delete|new|using|typedef|if|for|while|switch|do|sizeof|template|namespace|class|struct|enum|union)\b)(?:[A-Za-z_][\w:<>,]{0,80}[ \t*&]{1,8}){1,4}(?!(?:if|for|while|switch|return|sizeof|catch)\b)[A-Za-z_~][\w:~]{0,80}[ \t]*\([^;\n]{0,300}$/m;

// JVM / .NET methods: optional annotations and modifiers, a return type, a name, a parameter
// list opening on the same line, and no `;` after it (an abstract or interface declaration).
const JAVA_METHOD =
  /^[ \t]*(?=[\w@<$])(?:@[\w.]+(?:\([^)\n]{0,200}\))?[ \t]+){0,4}(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|override|virtual|async|sealed|extern|unsafe|partial|default|strictfp|readonly|open|suspend|inline|external|operator)[ \t]+){0,6}(?:<[^>\n]{0,80}>[ \t]+)?(?!(?:if|for|while|switch|return|else|case|new|throw|catch|try|do|using|lock|fixed|yield|await|foreach|when|var|val|let|import|package)\b)[\w.$]{1,80}(?:<[^\n]{0,120}?>)?(?:\[\])*\??[ \t]+[\w$]{1,80}[ \t]*\([^;\n]{0,300}$/m;

// ─── JavaScript family ───────────────────────────────────────────────────────────────────────

const JS_FUNCTIONS = [
  // `function` declarations and expressions, generators included.
  /\bfunction\b/m,
  // Arrow functions given a name: `const f = (…) =>`, `f: async x =>`, class fields.
  /(?:(?<![=!<>])=|:)[ \t]*(?:async[ \t]+)?(?:<[^<>()\n]{0,80}>[ \t]*)?(?:\([^()\n]{0,200}\)|\([^()\n]{0,100}\([^()\n]{0,100}\)[^()\n]{0,100}\)|[\w$]{1,80})[ \t]*(?::[^=\n]{0,120}?)?=>/m,
  // Class and object-literal methods: `name(…) {` at line start, statements excluded.
  /^[ \t]*(?=[\w$#*])(?:(?:public|private|protected|static|async|override|readonly|abstract|declare|get|set|export|default)[ \t]+){0,5}\*?[ \t]*(?!(?:if|for|while|switch|catch|function|return|await|with|else|do|try|new|typeof|throw|yield|super|this|import)\b)[#$\w]{1,80}[ \t]*(?:<[^>\n]{0,100}>)?[ \t]*\([^;()\n]{0,300}\)[ \t]*(?::[^;\n{]{0,200})?\{/m,
];

const JS: LexRules = {
  programming: true,
  braces: true,
  line: ["//"],
  block: SLASH_BLOCK,
  strings: ["`", '"', "'"],
  multiline: ["`"],
  templates: true,
  regex: true,
  branches: [...C_BRANCHES, "??"],
  functions: JS_FUNCTIONS,
};

// ─── C family ────────────────────────────────────────────────────────────────────────────────

function cLike(extra: Partial<LexRules> = {}): LexRules {
  return {
    programming: true,
    braces: true,
    line: ["//"],
    block: SLASH_BLOCK,
    strings: ['"', "'"],
    charLiterals: true,
    branches: C_BRANCHES,
    functions: [C_FUNCTION],
    ...extra,
  };
}

const C = cLike();
const CPP = cLike({ raw: ["cpp"] });
const OBJC = cLike({ functions: [C_FUNCTION, /^[ \t]*[-+][ \t]*\(/m] });

const JAVA = cLike({
  strings: ['"""', '"', "'"],
  multiline: ['"""'],
  functions: [JAVA_METHOD],
});

const CSHARP = cLike({
  strings: ['"""', '"', "'"],
  pairs: [
    ['@$"', '"'],
    ['$@"', '"'],
    ['@"', '"'],
  ],
  multiline: ['"""'],
  noEscape: ['"""'],
  branches: [...C_BRANCHES, "foreach", "??", "when"],
  functions: [JAVA_METHOD],
});

const KOTLIN = cLike({
  nested: true,
  strings: ['"""', '"', "'"],
  multiline: ['"""'],
  noEscape: ['"""'],
  branches: ["if", "for", "while", "when", "catch", "&&", "||", "?:"],
  functions: [/\bfun\b/m],
});

const SCALA = cLike({
  nested: true,
  strings: ['"""', '"', "'"],
  multiline: ['"""'],
  noEscape: ['"""'],
  branches: ["if", "while", "for", "case", "catch", "&&", "||"],
  functions: [/\bdef\b/m],
});

const GROOVY = cLike({
  strings: ["'''", '"""', '"', "'"],
  multiline: ["'''", '"""'],
  charLiterals: false,
  branches: [...C_BRANCHES, "?:"],
  functions: [/\bdef[ \t]+[\w$]+[ \t]*\(/m, JAVA_METHOD],
});

const SWIFT = cLike({
  nested: true,
  strings: ['"""', '"'],
  pairs: [
    ['#"""', '"""#'],
    ['#"', '"#'],
  ],
  multiline: ['"""'],
  charLiterals: false,
  branches: ["if", "guard", "for", "while", "case", "catch", "&&", "||", "??", "?"],
  functions: [/\bfunc\b/m, /^[ \t]*(?:(?:public|private|internal|fileprivate|open|override|convenience|required)[ \t]+){0,4}init[ \t]*[?!]?[ \t]*[(<]/m],
});

const GO = cLike({
  strings: ["`", '"', "'"],
  multiline: ["`"],
  noEscape: ["`"],
  branches: ["if", "for", "case", "&&", "||"],
  functions: [/^func\b/m],
});

// Rust match arms are decision points like switch cases; `=>` appears only in arms and
// macro_rules, so it is the cheapest arm marker. `?` is error propagation, not a branch.
const RUST = cLike({
  nested: true,
  strings: ['"', "'"],
  multiline: ['"'],
  raw: ["rust"],
  branches: ["if", "while", "for", "&&", "||", "=>"],
  functions: [/\bfn[ \t]+\w/m],
});

const DART = cLike({
  nested: true,
  strings: ["'''", '"""', '"', "'"],
  multiline: ["'''", '"""'],
  charLiterals: false,
  branches: [...C_BRANCHES, "??"],
  functions: [JAVA_METHOD, /^[ \t]*(?=\w)(?:[\w<>?]{1,80}[ \t]+)?[a-z_]\w{0,80}[ \t]*\([^;\n]{0,300}\)[ \t]*(?:async\*?[ \t]*)?(?:\{|=>)/m],
});

const PHP = cLike({
  line: ["//", "#"],
  lineNotBefore: { "#": "[" }, // PHP 8 attributes: #[Route(...)]
  strings: ['"', "'"],
  multiline: ['"', "'"],
  charLiterals: false,
  heredoc: "php",
  branches: ["if", "elseif", "for", "foreach", "while", "case", "catch", "&&", "||", "and", "or", "??", "?"],
  functions: [/\bfunction\b/m, /\bfn[ \t]*\(/m],
});

const D = cLike({
  nested: true,
  block: [
    ["/+", "+/"],
    ["/*", "*/"],
  ],
  strings: ['"', "`", "'"],
  multiline: ['"', "`"],
  noEscape: ["`"],
  branches: [...C_BRANCHES, "foreach"],
});

const ZIG = cLike({
  block: [],
  strings: ['"', "'"],
  lineStrings: ["\\\\"],
  branches: ["if", "while", "for", "catch", "orelse", "and", "or", "=>"],
  functions: [/\bfn[ \t]+\w/m],
});

const SOLIDITY = cLike({
  charLiterals: false,
  functions: [/\b(?:function|modifier|constructor)\b/m],
});

const SHADER = cLike({ charLiterals: false });

// ─── Style sheets and data with C comments ───────────────────────────────────────────────────

const CSS: LexRules = {
  programming: false,
  braces: true,
  line: [],
  block: SLASH_BLOCK,
  strings: ['"', "'"],
  branches: [],
  functions: [],
};
const SCSS: LexRules = { ...CSS, line: ["//"] };
const SASS: LexRules = { ...SCSS, braces: false, indent: true };

const JSONC: LexRules = {
  programming: false,
  braces: true,
  line: ["//"],
  block: SLASH_BLOCK,
  strings: ['"'],
  branches: [],
  functions: [],
};
const JSON5: LexRules = { ...JSONC, strings: ['"', "'"] };

const PROTOBUF: LexRules = {
  programming: false,
  braces: true,
  line: ["//"],
  block: SLASH_BLOCK,
  strings: ['"', "'"],
  branches: [],
  functions: [/^[ \t]*rpc[ \t]+\w/m],
};

// ─── Hash-comment family ─────────────────────────────────────────────────────────────────────

const PYTHON: LexRules = {
  programming: true,
  indent: true,
  docstrings: true,
  stringPrefixes: true,
  line: ["#"],
  block: [],
  strings: ['"""', "'''", '"', "'"],
  multiline: ['"""', "'''"],
  branches: ["if", "elif", "for", "while", "except", "case", "and", "or"],
  functions: [/^[ \t]*(?:async[ \t]+)?def[ \t]+\w/m],
};

const RUBY: LexRules = {
  programming: true,
  indent: true,
  line: ["#"],
  block: [],
  blockAtStart: [["=begin", "=end"]],
  strings: ['"', "'"],
  multiline: ['"', "'"],
  heredoc: "ruby",
  regex: true,
  branches: ["if", "elsif", "unless", "while", "until", "for", "when", "rescue", "&&", "||", "and", "or", "?"],
  functions: [/^[ \t]*def[ \t]+/m],
};

const CRYSTAL: LexRules = { ...RUBY, charLiterals: true, strings: ['"', "'"] };

const SHELL_BOUNDARY: Record<string, OpenerPosition> = { "#": "boundary" };
const SHELL: LexRules = {
  programming: true,
  indent: true,
  line: ["#"],
  lineAt: SHELL_BOUNDARY,
  block: [],
  strings: ["$'", '"', "'"],
  multiline: ["$'", '"', "'"],
  noEscape: ["'"],
  heredoc: "shell",
  // `;;` ends every case arm, so it counts the arms without parsing patterns.
  branches: ["if", "elif", "while", "until", "for", "&&", "||", ";;"],
  functions: [/^[ \t]*(?:function[ \t]+[\w:.-]{1,80}|[\w:.-]{1,80}[ \t]*\([ \t]*\))/m],
};

const FISH: LexRules = { ...SHELL, heredoc: undefined, strings: ['"', "'"], multiline: ['"', "'"], branches: ["if", "while", "for", "case", "and", "or", "&&", "||"], functions: [/^[ \t]*function[ \t]+/m] };

const PERL: LexRules = {
  programming: true,
  braces: true,
  line: ["#"],
  lineNotAfter: { "#": "$" }, // $#array is the last index, not a comment
  block: [],
  blockAtStart: [
    ["=pod", "=cut"],
    ["=head", "=cut"],
    ["=item", "=cut"],
    ["=over", "=cut"],
    ["=begin", "=cut"],
    ["=for", "=cut"],
    ["=encoding", "=cut"],
    // Everything after __END__ / __DATA__ is data or documentation, never code.
    ["__END__", "\u0000"],
    ["__DATA__", "\u0000"],
  ],
  strings: ['"', "'"],
  multiline: ['"', "'"],
  heredoc: "perl",
  regex: true,
  branches: ["if", "elsif", "unless", "while", "until", "for", "foreach", "&&", "||", "and", "or", "?"],
  functions: [/\bsub[ \t]+\w/m],
};

const R: LexRules = {
  programming: true,
  braces: true,
  line: ["#"],
  block: [],
  strings: ['"', "'"],
  multiline: ['"', "'"],
  branches: ["if", "for", "while", "&&", "||"],
  functions: [/\bfunction[ \t]*\(/m],
};

const JULIA: LexRules = {
  programming: true,
  indent: true,
  nested: true,
  line: ["#"],
  block: [["#=", "=#"]],
  strings: ['"""', '"', "'"],
  multiline: ['"""', '"'],
  charLiterals: true,
  primeAfterWord: true,
  branches: ["if", "elseif", "for", "while", "catch", "&&", "||", "?"],
  functions: [/^[ \t]*function\b/m, /^[ \t]*[\w.!]{1,80}\([^()\n]{0,200}\)[ \t]*=(?!=)/m],
};

function hashData(extra: Partial<LexRules> = {}): LexRules {
  return {
    programming: false,
    line: ["#"],
    block: [],
    strings: ['"', "'"],
    branches: [],
    functions: [],
    ...extra,
  };
}

// YAML only treats `#` as a comment after whitespace, and quotes only open a scalar at the
// start of a value — `key: don't` is a plain scalar with an apostrophe in it.
const YAML = hashData({ indent: true, lineAt: SHELL_BOUNDARY, quoteBoundary: true });
const TOML = hashData({ strings: ['"""', "'''", '"', "'"], multiline: ['"""', "'''"], noEscape: ["'''", "'"] });
const INI: LexRules = {
  programming: false,
  line: [";", "#"],
  lineAt: { ";": "start", "#": "start" },
  block: [],
  strings: [],
  branches: [],
  functions: [],
};
const DOTFILE = hashData({ lineAt: { "#": "start" }, strings: [] });

const DOCKERFILE: LexRules = {
  ...SHELL,
  programming: true,
  lineAt: SHELL_BOUNDARY,
  branches: ["&&", "||"],
  functions: [],
};

const MAKEFILE: LexRules = {
  programming: true,
  indent: true,
  line: ["#"],
  lineNotAfter: { "#": "\\" },
  block: [],
  strings: ['"', "'"],
  branches: ["ifeq", "ifneq", "ifdef", "ifndef", "&&", "||"],
  functions: [/^define[ \t]+/m],
};

const CMAKE: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  line: ["#"],
  block: [["#[[", "]]"]],
  strings: ['"'],
  multiline: ['"'],
  branches: ["if", "elseif", "foreach", "while", "and", "or"],
  functions: [/^[ \t]*(?:function|macro)[ \t]*\(/im],
};

const POWERSHELL: LexRules = {
  programming: true,
  braces: true,
  caseInsensitive: true,
  line: ["#"],
  lineAt: SHELL_BOUNDARY,
  block: [["<#", "#>"]],
  strings: ['"', "'"],
  pairs: [
    ['@"', '"@'],
    ["@'", "'@"],
  ],
  multiline: ['"', "'"],
  noEscape: ["'"],
  branches: ["if", "elseif", "for", "foreach", "while", "until", "catch", "-and", "-or", "&&", "||"],
  functions: [/^[ \t]*(?:function|filter)[ \t]+/im],
};

const NIX: LexRules = {
  programming: true,
  braces: true,
  line: ["#"],
  block: SLASH_BLOCK,
  strings: ['"'],
  pairs: [["''", "''"]],
  multiline: ['"'],
  branches: ["if", "&&", "||"],
  functions: [],
};

const ELIXIR: LexRules = {
  programming: true,
  indent: true,
  // @moduledoc / @doc / @typedoc heredocs are the language's documentation comments.
  docAttribute: /^[ \t]*@(?:module|type)?doc[ \t]+(?:~[sS])?$/,
  line: ["#"],
  block: [],
  strings: ['"""', "'''", '"', "'"],
  multiline: ['"""', "'''", '"', "'"],
  charPrefix: ["?"],
  branches: ["if", "unless", "case", "cond", "when", "rescue", "catch", "&&", "||", "and", "or"],
  functions: [/^[ \t]*(?:defp?|defmacrop?|defguardp?)[ \t]+/m],
};

const NIM: LexRules = {
  programming: true,
  indent: true,
  nested: true,
  line: ["#"],
  block: [["#[", "]#"]],
  strings: ['"""', '"', "'"],
  multiline: ['"""'],
  charLiterals: true,
  branches: ["if", "elif", "while", "for", "case", "of", "except", "when", "and", "or"],
  functions: [/^[ \t]*(?:proc|func|method|iterator|converter|macro|template)[ \t]+\w/m],
};

const TCL: LexRules = {
  programming: true,
  braces: true,
  line: ["#"],
  lineAt: { "#": "start" },
  block: [],
  strings: ['"'],
  multiline: ['"'],
  branches: ["if", "elseif", "for", "foreach", "while", "&&", "||"],
  functions: [/^[ \t]*proc[ \t]+/m],
};

const COFFEE: LexRules = {
  programming: true,
  indent: true,
  line: ["#"],
  block: [["###", "###"]],
  strings: ['"""', "'''", '"', "'"],
  // Heregexes span lines and hold quotes and `#` freely; lexed as one opaque string.
  pairs: [["///", "///"]],
  multiline: ['"""', "'''", '"', "'"],
  regex: true,
  branches: ["if", "unless", "while", "until", "for", "when", "catch", "and", "or", "&&", "||", "?"],
  functions: [/[\w$]{1,80}[ \t]*[:=][ \t]*(?:\([^()\n]{0,200}\)[ \t]*)?[-=]>/m],
};

const AWK: LexRules = {
  programming: true,
  braces: true,
  line: ["#"],
  block: [],
  strings: ['"'],
  regex: true,
  branches: ["if", "for", "while", "&&", "||", "?"],
  functions: [/^[ \t]*func(?:tion)?[ \t]+\w/m],
};

const HCL: LexRules = {
  programming: true,
  braces: true,
  line: ["#", "//"],
  block: SLASH_BLOCK,
  strings: ['"'],
  heredoc: "shell",
  branches: ["for", "if", "&&", "||", "?"],
  functions: [],
};

const GRAPHQL = hashData({ braces: true, strings: ['"""', '"'], multiline: ['"""'] });

// ─── Dash-dash family ────────────────────────────────────────────────────────────────────────

const SQL: LexRules = {
  programming: false,
  caseInsensitive: true,
  line: ["--"],
  block: SLASH_BLOCK,
  // Backslash escapes stay on: MySQL dumps write 'it\'s', and without them that quote opens a
  // string that runs to the next apostrophe. Standard '' doubling still works, because a
  // doubled quote simply closes one string and opens the next.
  strings: ["'", '"'],
  multiline: ["'"],
  noEscape: ['"'],
  branches: [],
  functions: [/\bcreate[ \t]+(?:or[ \t]+replace[ \t]+)?(?:function|procedure)\b/im],
};

const PLSQL: LexRules = {
  ...SQL,
  programming: true,
  endKeywords: true,
  branches: ["if", "elsif", "elseif", "when", "while", "for", "loop", "and", "or"],
};

// Haskell: `--` opens a comment unless more symbol characters follow (`-->` is an operator).
const HASKELL_SYMBOLS = "!#$%&*+./<=>?@\\^|~:";
const HASKELL: LexRules = {
  programming: true,
  indent: true,
  nested: true,
  line: ["--"],
  lineNotBefore: { "--": HASKELL_SYMBOLS },
  block: [["{-", "-}"]],
  strings: ['"', "'"],
  charLiterals: true,
  branches: ["if", "case", "&&", "||"],
  // Top-level type signatures: one per declared function, layout-independent.
  functions: [/^[a-z_][\w']{0,80}[ \t]*::/m],
};

const ELM: LexRules = { ...HASKELL, functions: [/^[a-z_]\w{0,80}[ \t]*:(?!:)/m] };
const PURESCRIPT: LexRules = { ...HASKELL };

const LUA: LexRules = {
  programming: true,
  indent: true,
  line: ["--"],
  block: [],
  raw: ["lua"],
  strings: ['"', "'"],
  branches: ["if", "elseif", "for", "while", "until", "and", "or"],
  functions: [/\bfunction\b/m],
};

const ADA: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  endKeywords: true,
  line: ["--"],
  block: [],
  strings: ['"', "'"],
  noEscape: ['"'],
  charLiterals: true,
  branches: ["if", "elsif", "while", "for", "when", "and", "or"],
  functions: [/^[ \t]*(?:overriding[ \t]+)?(?:procedure|function)[ \t]+\w/im],
};

const VHDL: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  endKeywords: true,
  line: ["--"],
  block: SLASH_BLOCK,
  strings: ['"', "'"],
  noEscape: ['"'],
  charLiterals: true,
  branches: ["if", "elsif", "when", "while", "for", "and", "or"],
  functions: [/^[ \t]*(?:pure[ \t]+|impure[ \t]+)?(?:function|procedure)[ \t]+\w/im],
};

// ─── Semicolon family ────────────────────────────────────────────────────────────────────────

const LISP_BRANCHES = ["(if", "(when", "(unless", "(cond", "(case", "(and", "(or", "(while"];
function lisp(extra: Partial<LexRules> = {}): LexRules {
  return {
    programming: true,
    indent: true,
    line: [";"],
    block: [],
    strings: ['"'],
    multiline: ['"'],
    branches: LISP_BRANCHES,
    functions: [/\((?:defun|defmacro|defmethod|defgeneric|cl-defun|defn-?|define[ \t]*\(|define-syntax|lambda)\b/m],
    ...extra,
  };
}
const CLOJURE = lisp({ charPrefix: ["\\"] });
const COMMON_LISP = lisp({ nested: true, block: [["#|", "|#"]], charPrefix: ["#\\"] });
const SCHEME = lisp({ nested: true, block: [["#|", "|#"]], charPrefix: ["#\\"] });
const EMACS_LISP = lisp({ charPrefix: ["?\\", "?"] });

const ASSEMBLY: LexRules = {
  programming: true,
  line: [";", "#"],
  lineAt: { "#": "start" },
  lineNotBefore: { "#": "abcdefghijklmnopqrstuvwxyz" }, // #include / #define in .S files are code
  block: SLASH_BLOCK,
  strings: ['"', "'"],
  charLiterals: true,
  branches: [],
  functions: [/^[A-Za-z_.$][\w.$]{0,80}:/m],
};
const UNIX_ASSEMBLY: LexRules = { ...ASSEMBLY, line: ["//", "#", ";"] };

// ─── Percent family ──────────────────────────────────────────────────────────────────────────

const ERLANG: LexRules = {
  programming: true,
  indent: true,
  line: ["%"],
  block: [],
  strings: ['"'],
  charPrefix: ["$\\", "$"],
  branches: ["if", "case", "receive", "when", "andalso", "orelse", "catch"],
  functions: [/^[a-z][\w]{0,80}\([^\n]{0,300}\)[ \t]*(?:when\b[^\n]{0,200})?->/m],
};

const MATLAB: LexRules = {
  programming: true,
  indent: true,
  line: ["%"],
  block: [],
  blockAtStart: [["%{", "%}"]],
  strings: ['"', "'"],
  noEscape: ['"', "'"],
  primeAfterWord: true,
  branches: ["if", "elseif", "for", "while", "case", "catch", "&&", "||"],
  functions: [/^[ \t]*function\b/m],
};

const TEX: LexRules = {
  programming: false,
  line: ["%"],
  lineNotAfter: { "%": "\\" },
  block: [],
  strings: [],
  branches: [],
  functions: [/\\(?:newcommand|renewcommand|providecommand|def)\b/m],
};

const PROLOG: LexRules = {
  programming: true,
  indent: true,
  line: ["%"],
  block: SLASH_BLOCK,
  strings: ['"', "'"],
  branches: ["->"],
  functions: [/^[a-z]\w{0,80}(?:\([^\n]{0,300}\))?[ \t]*:-/m],
};

// ─── ML family ───────────────────────────────────────────────────────────────────────────────

const OCAML: LexRules = {
  programming: true,
  indent: true,
  nested: true,
  line: [],
  block: [["(*", "*)"]],
  strings: ['"'],
  multiline: ['"'],
  charLiterals: true,
  branches: ["if", "while", "for", "when", "&&", "||"],
  functions: [/^[ \t]*(?:let|and)[ \t]+(?:rec[ \t]+)?[a-z_][\w']{0,80}[ \t]+[a-z_(~?][^=\n]{0,200}=/m],
};

const FSHARP: LexRules = {
  ...OCAML,
  line: ["//"],
  strings: ['"""', '"'],
  multiline: ['"""', '"'],
  branches: ["if", "elif", "while", "for", "when", "&&", "||"],
  functions: [
    /^[ \t]*(?:let|and)[ \t]+(?:rec[ \t]+|inline[ \t]+|private[ \t]+){0,3}[a-z_][\w']{0,80}[ \t]+[a-z_(][^=\n]{0,200}=/m,
    /^[ \t]*(?:static[ \t]+)?(?:member|override|default|abstract)[ \t]+/m,
  ],
};

// ─── Other singletons ────────────────────────────────────────────────────────────────────────

const FORTRAN_FREE: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  endKeywords: true,
  line: ["!"],
  block: [],
  strings: ['"', "'"],
  noEscape: ['"', "'"],
  branches: ["if", "do", "case", "where", ".and.", ".or."],
  functions: [/^[ \t]*(?:(?:pure|elemental|recursive|impure|module)[ \t]+){0,3}(?:[\w()*=,]{1,40}[ \t]+){0,2}(?:function|subroutine)[ \t]+\w/im],
};
// Fixed form adds column-1 comment markers (C, c, *) on top of `!`. Plenty of `.f` files are
// really free form, where `call foo` or `character x` can start in column 1, so a C followed by
// any letter other than another C (`CCCC` banners) is taken as code.
const NOT_C_LETTER = "abdefghijklmnopqrstuvwxyzABDEFGHIJKLMNOPQRSTUVWXYZ0123456789_=(";
const FORTRAN: LexRules = {
  ...FORTRAN_FREE,
  line: ["!", "C", "c", "*"],
  lineAt: { C: "col1", c: "col1", "*": "col1" },
  lineNotBefore: { C: NOT_C_LETTER, c: NOT_C_LETTER },
};

// Vim script: `"` is a comment only as the first thing on a line; elsewhere it opens a string.
const VIM: LexRules = {
  programming: true,
  indent: true,
  line: ['"', "#"],
  lineAt: { '"': "start", "#": "start" },
  lineNotBefore: { "#": "{" },
  block: [],
  strings: ['"', "'"],
  noEscape: ["'"],
  branches: ["if", "elseif", "for", "while", "catch", "&&", "||"],
  functions: [/^[ \t]*(?:fu|fun|func|funct|functi|functio|function|def)!?[ \t]+[\w:#.<>]{1,80}[ \t]*\(/m],
};

const BATCH: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  line: ["::"],
  lineAt: { "::": "start" },
  lineWords: ["rem", "@rem"],
  block: [],
  strings: ['"'],
  noEscape: ['"'],
  branches: ["if", "for", "&&", "||"],
  functions: [/^:[A-Za-z_][\w.-]{0,80}/m],
};

const VB: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  endKeywords: true,
  line: ["'"],
  lineWords: ["rem"],
  block: [],
  strings: ['"'],
  noEscape: ['"'],
  branches: ["if", "elseif", "for", "while", "case", "catch", "andalso", "orelse", "and", "or"],
  functions: [/^[ \t]*(?:(?:public|private|protected|friend|shared|overrides|overridable|overloads|static|async|mustoverride|notinheritable)[ \t]+){0,4}(?:function|sub)[ \t]+\w/im],
};

const PASCAL: LexRules = {
  programming: true,
  indent: true,
  caseInsensitive: true,
  line: ["//"],
  block: [
    ["{", "}"],
    ["(*", "*)"],
  ],
  strings: ["'"],
  noEscape: ["'"],
  branches: ["if", "while", "for", "case", "except", "and", "or"],
  functions: [/^[ \t]*(?:class[ \t]+)?(?:procedure|function|constructor|destructor)[ \t]+[\w.]/im],
};

// ─── Markup ──────────────────────────────────────────────────────────────────────────────────

// Markup gets no string delimiters: text content is full of apostrophes, and attribute values
// never contain comment markers in practice.
const HTML: LexRules = {
  programming: false,
  line: [],
  block: HTML_BLOCK,
  strings: [],
  branches: [],
  functions: [],
  host: "html",
};
const XML: LexRules = { ...HTML, host: undefined };
const MARKDOWN: LexRules = { ...HTML, host: undefined };

// Component files keep their logic in <script>; that code is measured with its own rules and
// counts toward complexity even though linguist types these formats as markup.
const COMPONENT: LexRules = { ...HTML, programming: true };
const ASTRO: LexRules = { ...COMPONENT, host: "astro" };

const HANDLEBARS: LexRules = { ...HTML, host: undefined, block: [["{{!--", "--}}"], ["{{!", "}}"], ...HTML_BLOCK] };
const JINJA: LexRules = { ...HTML, host: undefined, block: [["{#", "#}"], ...HTML_BLOCK] };
const ERB: LexRules = { ...HTML, block: [["<%#", "%>"], ...HTML_BLOCK] };

// ─── Table ───────────────────────────────────────────────────────────────────────────────────

const TABLE: Record<string, LexRules> = {
  // JavaScript family. `.jsx` is plain "javascript" in linguist; TSX is its own language.
  javascript: JS,
  typescript: JS,
  tsx: JS,
  "glimmer-js": JS,
  "glimmer-ts": JS,
  "javascript+erb": JS,
  actionscript: JS,
  haxe: JS,
  qml: JS,
  "peg.js": JS,
  jsonnet: { ...JS, line: ["//", "#"], templates: false, regex: false, programming: true },
  // C family
  c: C,
  "c++": CPP,
  "objective-c": OBJC,
  "objective-c++": OBJC,
  cuda: CPP,
  opencl: C,
  "unified-parallel-c": C,
  metal: CPP,
  hip: CPP,
  ispc: C,
  glsl: SHADER,
  hlsl: SHADER,
  wgsl: SHADER,
  "c#": CSHARP,
  vala: CSHARP,
  java: JAVA,
  apex: JAVA,
  processing: JAVA,
  kotlin: KOTLIN,
  "gradle-kotlin-dsl": KOTLIN,
  scala: SCALA,
  groovy: GROOVY,
  gradle: GROOVY,
  swift: SWIFT,
  go: GO,
  rust: RUST,
  dart: DART,
  php: PHP,
  hack: PHP,
  d: D,
  zig: ZIG,
  odin: cLike({ nested: true, strings: ['"', "`", "'"], multiline: ["`"], noEscape: ["`"], functions: [/::[ \t]*proc\b/m] }),
  v: cLike({ strings: ['"', "'", "`"], charLiterals: false, functions: [/\bfn[ \t]+\w/m] }),
  solidity: SOLIDITY,
  verilog: SHADER,
  systemverilog: SHADER,
  "protocol-buffer": PROTOBUF,
  thrift: { ...PROTOBUF, line: ["//", "#"] },
  "cap'n-proto": hashData({ braces: true }),
  flatbuffers: PROTOBUF,
  smithy: PROTOBUF,
  prisma: { ...PROTOBUF, functions: [] },
  cue: { ...JSONC, strings: ['"""', '"', "'"], multiline: ['"""'] },
  webidl: PROTOBUF,
  // Style sheets
  css: CSS,
  postcss: CSS,
  scss: SCSS,
  less: SCSS,
  stylus: { ...SCSS, braces: false, indent: true },
  sass: SASS,
  // Data with comments
  "json-with-comments": JSONC,
  json5: JSON5,
  hocon: { ...JSONC, line: ["//", "#"] },
  // Hash family
  python: PYTHON,
  cython: PYTHON,
  starlark: PYTHON,
  snakemake: PYTHON,
  sage: PYTHON,
  mojo: PYTHON,
  xonsh: PYTHON,
  gdscript: { ...PYTHON, docstrings: false },
  ruby: RUBY,
  crystal: CRYSTAL,
  shell: SHELL,
  tcsh: SHELL,
  "gentoo-ebuild": SHELL,
  "gentoo-eclass": SHELL,
  "alpine-abuild": SHELL,
  "openrc-runscript": SHELL,
  shellsession: SHELL,
  fish: FISH,
  perl: PERL,
  raku: { ...PERL, functions: [/\b(?:sub|method)[ \t]+\w/m] },
  r: R,
  julia: JULIA,
  yaml: YAML,
  miniyaml: YAML,
  toml: TOML,
  dockerfile: DOCKERFILE,
  makefile: MAKEFILE,
  cmake: CMAKE,
  powershell: POWERSHELL,
  nix: NIX,
  elixir: ELIXIR,
  nim: NIM,
  tcl: TCL,
  coffeescript: COFFEE,
  awk: AWK,
  hcl: HCL,
  "terraform-template": HCL,
  graphql: GRAPHQL,
  puppet: { ...hashData({ braces: true }), programming: true, branches: ["if", "elsif", "unless", "case", "and", "or"], functions: [/^[ \t]*define[ \t]+/m] },
  meson: { ...PYTHON, docstrings: false, strings: ["'''", "'"], multiline: ["'''"], branches: ["if", "elif", "foreach", "and", "or"], functions: [] },
  just: { ...SHELL, heredoc: undefined },
  "pip-requirements": DOTFILE,
  dotenv: DOTFILE,
  "ignore-list": DOTFILE,
  "git-attributes": DOTFILE,
  "git-config": INI,
  editorconfig: INI,
  ini: INI,
  "ssh-config": DOTFILE,
  "npm-config": INI,
  "java-properties": { ...INI, line: ["#", "!"], lineAt: { "#": "start", "!": "start" } },
  nginx: hashData({ braces: true, lineAt: SHELL_BOUNDARY }),
  apacheconf: DOTFILE,
  codeowners: DOTFILE,
  "go-module": { ...JSONC, braces: false, block: [], strings: ['"', "`"] },
  "go-workspace": { ...JSONC, braces: false, block: [], strings: ['"', "`"] },
  // Dash-dash family
  sql: SQL,
  plsql: PLSQL,
  tsql: PLSQL,
  plpgsql: PLSQL,
  sqlpl: PLSQL,
  haskell: HASKELL,
  "literate-haskell": HASKELL,
  agda: HASKELL,
  idris: HASKELL,
  elm: ELM,
  purescript: PURESCRIPT,
  lua: LUA,
  luau: LUA,
  ada: ADA,
  vhdl: VHDL,
  applescript: { ...LUA, raw: undefined, block: [["(*", "*)"]], nested: true, branches: ["if", "repeat", "and", "or"], functions: [/^[ \t]*on[ \t]+\w/m] },
  // Semicolon family
  clojure: CLOJURE,
  "common-lisp": COMMON_LISP,
  "emacs-lisp": EMACS_LISP,
  scheme: SCHEME,
  racket: SCHEME,
  fennel: lisp(),
  hy: lisp(),
  newlisp: lisp(),
  assembly: ASSEMBLY,
  "unix-assembly": UNIX_ASSEMBLY,
  "motorola-68k-assembly": ASSEMBLY,
  // Percent family
  erlang: ERLANG,
  matlab: MATLAB,
  tex: TEX,
  bibtex: TEX,
  prolog: PROLOG,
  postscript: { ...TEX, functions: [] },
  // ML family
  ocaml: OCAML,
  "standard-ml": OCAML,
  "f#": FSHARP,
  "rocq-prover": OCAML,
  reason: cLike({ charLiterals: true, functions: [/=>/m] }),
  rescript: cLike({ charLiterals: true, functions: [/=>/m] }),
  // Others
  fortran: FORTRAN,
  "fortran-free-form": FORTRAN_FREE,
  "vim-script": VIM,
  batchfile: BATCH,
  "visual-basic-.net": VB,
  "visual-basic-6.0": VB,
  vba: VB,
  vbscript: VB,
  pascal: PASCAL,
  "component-pascal": PASCAL,
  // Markup
  html: HTML,
  "html+erb": ERB,
  "html+eex": HTML,
  "html+php": HTML,
  "html+razor": HTML,
  xml: XML,
  "xml-property-list": XML,
  "maven-pom": XML,
  xslt: XML,
  svg: XML,
  vue: COMPONENT,
  svelte: COMPONENT,
  astro: ASTRO,
  markdown: MARKDOWN,
  mdx: MARKDOWN,
  rmarkdown: MARKDOWN,
  handlebars: HANDLEBARS,
  mustache: HANDLEBARS,
  jinja: JINJA,
  nunjucks: JINJA,
  twig: JINJA,
  liquid: { ...HTML, host: undefined, block: [["{% comment %}", "{% endcomment %}"], ...HTML_BLOCK] },
  ejs: ERB,
};

/** The scanner's full rules for a language id, or undefined when the language has none. */
export function getLexRules(languageId: string): LexRules | undefined {
  return TABLE[languageId];
}

export const getSyntax: GetSyntax = (languageId) => TABLE[languageId];
