/**
 * Generates src/core/languages/linguist.generated.ts from GitHub Linguist's data files.
 *
 *   bun scripts/gen-languages.ts [dir] [--out file]
 *
 * `dir` holds languages.yml, heuristics.yml, vendor.yml, documentation.yml and, optionally,
 * generic.yml (a checkout's lib/linguist/ works). Any file missing from it, or every file when
 * no dir is given, is fetched from the linguist main branch on raw.githubusercontent.com.
 * --out writes somewhere other than src/core/languages/linguist.generated.ts, for comparing
 * a newer linguist against the committed table before replacing it.
 *
 * Why generate instead of parsing the YAML at runtime: the CLI should start instantly and ship
 * as one compiled binary, and the Ruby regexes in heuristics.yml need translating to the JS
 * dialect anyway. Doing that once here means a pattern that cannot be translated fails the
 * build, loudly, instead of silently never matching in a user's report.
 *
 * Linguist is MIT licensed, Copyright (c) 2017 GitHub, Inc. The attribution is written into the
 * generated file's header.
 */

import { join, resolve } from "node:path";

const RAW_BASE = "https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist";
const DEFAULT_OUT = resolve(import.meta.dir, "../src/core/languages/linguist.generated.ts");

// ─── Input ───────────────────────────────────────────────────────────────────────────────────

async function load(dir: string | undefined, file: string, optional = false): Promise<unknown> {
  if (dir) {
    const local = Bun.file(join(dir, file));
    if (await local.exists()) return Bun.YAML.parse(await local.text());
  }
  const res = await fetch(`${RAW_BASE}/${file}`);
  if (!res.ok) {
    if (optional) {
      console.warn(`warning: ${file} unavailable (${res.status}); emitting it empty`);
      return undefined;
    }
    throw new Error(`fetching ${file}: HTTP ${res.status}`);
  }
  return Bun.YAML.parse(await res.text());
}

interface YamlLanguage {
  type: "programming" | "markup" | "data" | "prose";
  color?: string;
  group?: string;
  extensions?: string[];
  filenames?: string[];
  interpreters?: string[];
  aliases?: string[];
}

type YamlPattern = string | string[];
interface YamlRule {
  language?: string | string[];
  pattern?: YamlPattern;
  negative_pattern?: YamlPattern;
  named_pattern?: string;
  and?: YamlRule[];
}
interface YamlHeuristics {
  disambiguations: { extensions: string[]; rules: YamlRule[] }[];
  named_patterns: Record<string, YamlPattern>;
}

/** The shared id rule: linguist name, lowercased, spaces to dashes ("Vim Script" → "vim-script"). */
const toId = (name: string) => name.toLowerCase().replace(/ /g, "-");

// ─── Ruby (Onigmo) → JavaScript regex translation ────────────────────────────────────────────
//
// Every translated pattern is compiled with the "m" flag, because Ruby's ^ and $ are always
// line anchors. The differences that actually occur in linguist's files:
//   \A \z \Z        string anchors JS lacks; rewritten as lookarounds on [\s\S].
//   (?i) (?m) mid-pattern switches  apply to the end of the enclosing group in Onigmo, so they
//                   become JS modifier groups (?i: … ) closed where that group closes. Ruby's
//                   "m" is JS's "s" (dot matches newline).
//   \h              hex digit in Ruby, a literal "h" in JS.
//   [[:alpha:]]     POSIX brackets; expanded to ASCII ranges.
//   [a&&[^b]]       class intersection; becomes a lookahead guard in front of [a].
//   (?> … ) and possessive quantifiers   JS has neither; downgraded to plain groups and
//                   greedy quantifiers. That only changes backtracking cost, never whether a
//                   linguist pattern matches, because none of them rely on atomicity to fail.
//   {,n}            Onigmo's "0 to n"; JS reads it as literal text.
// Anything else exotic (\G, \K, \R, (?x)) throws so the generator fails instead of guessing.

const POSIX: Record<string, string> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: "\\s",
  xdigit: "0-9a-fA-F",
  word: "\\w",
  punct: "!-\\/:-@\\[-`{-~",
  blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f",
  print: "\\x20-\\x7e",
  graph: "\\x21-\\x7e",
};

function mapFlags(on: string, off: string, src: string): string {
  const conv = (f: string) =>
    [...f]
      .map((c) => {
        if (c === "i") return "i";
        if (c === "m") return "s";
        throw new Error(`unsupported inline flag "${c}" in ${src}`);
      })
      .join("");
  const a = conv(on);
  const b = conv(off);
  return b ? `${a}-${b}` : a;
}

export function rubyToJs(src: string): string {
  let out = "";
  let inClass = false;
  let classStart = 0; // index in `out` of the open class's "["
  // One frame per open group; `pending` counts modifier groups opened inside it by a bare
  // (?i) switch, which must close when the frame closes.
  const frames: { pending: number }[] = [{ pending: 0 }];
  let lastQuantifiable = false; // whether a quantifier just ended (for possessive "+")
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      const n = src[i + 1];
      if (n === undefined) throw new Error(`trailing backslash in ${src}`);
      i += 2;
      lastQuantifiable = false;
      if (n === "A") out += inClass ? "A" : "(?<![\\s\\S])";
      else if (n === "z") out += inClass ? "z" : "(?![\\s\\S])";
      else if (n === "Z") out += inClass ? "Z" : "(?=\\n?(?![\\s\\S]))";
      else if (n === "h") out += inClass ? "0-9a-fA-F" : "[0-9a-fA-F]";
      else if (n === "H") {
        if (inClass) throw new Error(`\\H inside a class in ${src}`);
        out += "[^0-9a-fA-F]";
      } else if (n === "e") out += "\\x1b";
      else if (n === "a") out += "\\x07";
      else if ("GKRX".includes(n)) throw new Error(`unsupported escape \\${n} in ${src}`);
      else out += `\\${n}`;
      continue;
    }
    if (inClass) {
      if (c === "[" && src[i + 1] === ":") {
        const end = src.indexOf(":]", i + 2);
        const name = end > 0 ? src.slice(i + 2, end) : "";
        const exp = POSIX[name.replace(/^\^/, "")];
        if (exp === undefined || name.startsWith("^")) throw new Error(`POSIX class [:${name}:] in ${src}`);
        out += exp;
        i = end + 2;
        continue;
      }
      if (c === "&" && src.startsWith("&&[", i)) {
        // Class intersection, as in [\s&&[^\r\n]] (horizontal whitespace). JS has no
        // intersection outside the v flag, whose stricter syntax would reject other
        // linguist patterns, so [A&&[B]] becomes a lookahead in front of [A].
        const innerEnd = src.indexOf("]", i + 4);
        if (innerEnd < 0 || src[innerEnd + 1] !== "]") throw new Error(`class intersection in ${src}`);
        const inner = src.slice(i + 3, innerEnd);
        const outer = out.slice(classStart + 1);
        out = out.slice(0, classStart);
        out += inner.startsWith("^")
          ? `(?:(?![${rubyToJs(`[${inner.slice(1)}]`).slice(1, -1)}])[${outer}])`
          : `(?:(?=[${rubyToJs(`[${inner}]`).slice(1, -1)}])[${outer}])`;
        i = innerEnd + 2;
        inClass = false;
        continue;
      }
      if (c === "[") throw new Error(`nested character class in ${src}`);
      if (c === "]") inClass = false;
      out += c;
      i++;
      continue;
    }
    if (c === "[") {
      inClass = true;
      classStart = out.length;
      out += c;
      i++;
      // A "]" right after "[" or "[^" is a literal in both dialects; copy it so it does not
      // read as the class end.
      if (src[i] === "^") out += src[i++];
      if (src[i] === "]") out += src[i++];
      lastQuantifiable = false;
      continue;
    }
    if (c === "(") {
      if (src.startsWith("(?#", i)) {
        const end = src.indexOf(")", i);
        i = end + 1;
        continue;
      }
      const sw = /^\(\?([imx]*)(?:-([imx]*))?\)/.exec(src.slice(i));
      if (sw && (sw[1] || sw[2])) {
        const flags = mapFlags(sw[1] ?? "", sw[2] ?? "", src);
        // "(?-m)" alone maps to nothing in JS (dotall is already off); emit no group.
        if (flags && flags !== "-") {
          out += `(?${flags}:`;
          frames[frames.length - 1]!.pending++;
        }
        i += sw[0].length;
        lastQuantifiable = false;
        continue;
      }
      const grp = /^\(\?([imx]*)(?:-([imx]*))?:/.exec(src.slice(i));
      if (grp && (grp[1] || grp[2])) {
        const flags = mapFlags(grp[1] ?? "", grp[2] ?? "", src);
        out += flags && flags !== "-" ? `(?${flags}:` : "(?:";
        i += grp[0].length;
      } else if (src.startsWith("(?>", i)) {
        out += "(?:";
        i += 3;
      } else if (src.startsWith("(?x", i)) {
        throw new Error(`extended mode in ${src}`);
      } else {
        out += c;
        i++;
      }
      frames.push({ pending: 0 });
      lastQuantifiable = false;
      continue;
    }
    if (c === ")") {
      const f = frames.pop();
      if (!f || frames.length === 0) throw new Error(`unbalanced ")" in ${src}`);
      out += ")".repeat(f.pending) + ")";
      i++;
      lastQuantifiable = false;
      continue;
    }
    if (c === "{" && src[i + 1] === ",") {
      out += "{0";
      i++;
      continue;
    }
    if (c === "+" && lastQuantifiable) {
      // Possessive quantifier (x*+, x++, x?+, x{n}+): drop the "+".
      i++;
      lastQuantifiable = false;
      continue;
    }
    lastQuantifiable = c === "*" || c === "+" || c === "?" || c === "}";
    // "?" after a quantifier is laziness, not a new quantifier.
    if (c === "?" && (out.endsWith("*") || out.endsWith("+") || out.endsWith("}") || out.endsWith("?"))) {
      lastQuantifiable = false;
    }
    out += c;
    i++;
  }
  if (inClass) throw new Error(`unterminated class in ${src}`);
  if (frames.length !== 1) throw new Error(`unbalanced "(" in ${src}`);
  out += ")".repeat(frames[0]!.pending);
  new RegExp(out, "m"); // throws on anything the translation missed
  return out;
}

// ─── Heuristics ──────────────────────────────────────────────────────────────────────────────

/**
 * Encoded matcher, mirroring linguist's rule semantics:
 *   null               always matches (a rule with no pattern)
 *   ["p", ...idx]      any of these patterns matches (Ruby's Regexp.union)
 *   ["n", ...idx]      none of these patterns matches
 *   ["&", ...matcher]  all of the sub-matchers match
 */
type Matcher = null | ["p", ...number[]] | ["n", ...number[]] | ["&", ...Matcher[]];

function buildHeuristics(h: YamlHeuristics, names: Set<string>) {
  const patterns: string[] = [];
  const index = new Map<string, number>();
  const intern = (ruby: string) => {
    const js = rubyToJs(ruby);
    let n = index.get(js);
    if (n === undefined) {
      n = patterns.length;
      patterns.push(js);
      index.set(js, n);
    }
    return n;
  };
  const list = (p: YamlPattern) => (Array.isArray(p) ? p : [p]).map(intern);

  const named = new Map<string, number[]>();
  for (const [k, v] of Object.entries(h.named_patterns)) named.set(k, list(v));

  const matcher = (r: YamlRule): Matcher => {
    const parts: Matcher[] = [];
    if (r.and) parts.push(...r.and.map(matcher));
    if (r.pattern !== undefined) parts.push(["p", ...list(r.pattern)]);
    if (r.named_pattern !== undefined) {
      const p = named.get(r.named_pattern);
      if (!p) throw new Error(`unknown named_pattern ${r.named_pattern}`);
      parts.push(["p", ...p]);
    }
    // Linguist's parser ignores negative_pattern when a rule also has a pattern (parse_rule
    // returns on the first key it finds). The YAML's evident intent is "pattern and not
    // negative", e.g. MiniYAML is "tab-indented and no --- marker", so both are kept as a
    // conjunction. Four rules have both (B, Tree-sitter Query, Scheme, MiniYAML). On
    // linguist's samples this costs one file and gains none: Tree-sitter Query/
    // func_highlights.scm holds a literal "()" that its negative pattern rejects. It is kept
    // because linguist's reading fails worse on real code: a Scheme macro that splices at a
    // line end ("`(begin ,@x)") matches a Tree-sitter capture pattern, and the negative
    // pattern is what keeps that file Scheme. test/languages.test.ts holds both cases.
    if (r.negative_pattern !== undefined) parts.push(["n", ...list(r.negative_pattern)]);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    return ["&", ...parts];
  };

  const missing = new Set<string>();
  const rows = h.disambiguations.map((d) => {
    const rules = d.rules.map((r) => {
      const langs = r.language === undefined ? [] : Array.isArray(r.language) ? r.language : [r.language];
      for (const l of langs) if (!names.has(l)) missing.add(l);
      return [langs.map(toId), matcher(r)] as const;
    });
    return [d.extensions.map((e) => e.toLowerCase()), rules] as const;
  });
  if (missing.size) console.warn(`warning: heuristics name unknown languages: ${[...missing].join(", ")}`);
  return { patterns, rows };
}

// ─── Vendor / documentation path patterns ────────────────────────────────────────────────────

/**
 * vendor.yml entries that do not mean "third-party code" in starchart's model, and why.
 * Linguist's "vendored" means "exclude from language statistics"; starchart's flag means
 * "someone else's code", and the category already says what these files are for.
 */
const VENDOR_DROP: Record<string, string> = {
  "(^|/)\\.github/": "CI workflows and repo config are the project's own (category build/config)",
  "(^|/)\\.vscode/": "editor settings are the project's own config",
  "(^|/)\\.gitattributes$": "the project's own config",
  "(^|/)\\.gitignore$": "the project's own config",
  "(^|/)\\.gitmodules$": "the project's own config",
  "(^|/)Jenkinsfile$": "the project's own CI pipeline (category build)",
  "(^|/)Vagrantfile$": "the project's own dev environment (category build)",
  "(.*?)\\.d\\.ts$": "hand-written declaration files are first-party TypeScript",
  "(^|/)[Tt]ests?/fixtures/": "fixtures are the project's tests (category test)",
  "(^|/)[Ss]pecs?/fixtures/": "fixtures are the project's tests (category test)",
  "(^|/)testdata/": "Go fixtures are the project's tests (category test)",
  "(^|/)\\.[Dd][Ss]_[Ss]tore$": "Finder metadata; the walker already excludes it",
  "(^|/)\\.sublime-project": "the project's own editor config",
  "(^|/)\\.sublime-workspace": "the project's own editor config",
  "(^|/)\\.obsidian/": "the project's own editor config",
  "(^|/)\\.teamcity/": "the project's own CI config",
  "(^|/)\\.gitpod\\.Dockerfile$": "the project's own dev environment",
  "(^|/)cache/": "too broad: matches first-party modules named cache/ (src/cache/index.ts)",
  "(^|/)env/": "too broad: matches first-party modules named env/",
};

function buildPathPatterns(list: string[], drop: Record<string, string> = {}) {
  const used = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    if (p in drop) {
      used.add(p);
      continue;
    }
    out.push(rubyToJs(p));
  }
  for (const k of Object.keys(drop)) {
    if (!used.has(k)) console.warn(`warning: VENDOR_DROP entry no longer in vendor.yml: ${k}`);
  }
  // The runtime joins each list into one alternation; prove that compiles here.
  new RegExp(out.map((s) => `(?:${s})`).join("|"));
  return out;
}

// ─── Emit ────────────────────────────────────────────────────────────────────────────────────

const json = (v: unknown) => JSON.stringify(v);

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 && args[outAt + 1] ? resolve(args[outAt + 1]!) : DEFAULT_OUT;
  if (outAt >= 0) args.splice(outAt, 2);
  const dir = args[0] ? resolve(args[0]) : undefined;
  const [languages, heuristics, vendor, documentation, generic] = (await Promise.all([
    load(dir, "languages.yml"),
    load(dir, "heuristics.yml"),
    load(dir, "vendor.yml"),
    load(dir, "documentation.yml"),
    load(dir, "generic.yml", true),
  ])) as [Record<string, YamlLanguage>, YamlHeuristics, string[], string[], { extensions?: string[] } | undefined];

  const names = new Set(Object.keys(languages));
  const ids = new Map<string, string>();
  for (const n of names) {
    const id = toId(n);
    const prior = ids.get(id);
    if (prior) throw new Error(`id collision: "${prior}" and "${n}" both map to "${id}"`);
    ids.set(id, n);
  }

  const langRows = Object.entries(languages)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, l]) =>
      json([
        name,
        l.type,
        l.color ?? "",
        l.group ? toId(l.group) : "",
        (l.extensions ?? []).map((e) => e.toLowerCase()),
        l.filenames ?? [],
        l.interpreters ?? [],
        (l.aliases ?? []).map((a) => a.toLowerCase()),
      ]),
    );

  const h = buildHeuristics(heuristics, names);
  const vendorJs = buildPathPatterns(vendor, VENDOR_DROP);
  const docJs = buildPathPatterns(documentation);
  const genericExt = (generic?.extensions ?? []).map((e) => e.toLowerCase());

  const header = `/**
 * GENERATED FILE. DO NOT EDIT.
 * Regenerate with: bun scripts/gen-languages.ts [dir-with-linguist-yml]
 *
 * Language table, disambiguation heuristics, and vendor/documentation path patterns derived
 * from GitHub Linguist (https://github.com/github-linguist/linguist): languages.yml,
 * heuristics.yml, vendor.yml, documentation.yml, generic.yml. Regexes are translated from
 * Ruby to JavaScript by the generator; see scripts/gen-languages.ts for what changes.
 *
 * GitHub Linguist is released under the MIT License.
 * Copyright (c) 2017 GitHub, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions: The above copyright
 * notice and this permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
`;

  const body = `${header}
export type LinguistType = "programming" | "markup" | "data" | "prose";

/** [name, type, color, group id, extensions (lowercased), filenames, interpreters, aliases] */
export type LanguageRow = readonly [
  name: string,
  type: LinguistType,
  color: string,
  group: string,
  extensions: readonly string[],
  filenames: readonly string[],
  interpreters: readonly string[],
  aliases: readonly string[],
];

/**
 * Heuristic matcher: null always matches; ["p", ...i] any pattern i matches; ["n", ...i] no
 * pattern i matches; ["&", ...m] every sub-matcher matches. Indexes point into PATTERNS.
 */
export type Matcher = null | readonly ["p", ...number[]] | readonly ["n", ...number[]] | readonly ["&", ...Matcher[]];

/** [language ids (first wins), matcher]. Rules are tried in order; the first match decides. */
export type HeuristicRule = readonly [languages: readonly string[], matcher: Matcher];

/** [extensions (lowercased, leading dot), rules]. */
export type Heuristic = readonly [extensions: readonly string[], rules: readonly HeuristicRule[]];

export const LANGUAGES: readonly LanguageRow[] = [
${langRows.map((r) => `  ${r},`).join("\n")}
];

/** Heuristic regex sources, JS dialect. Compile with the "m" flag (Ruby anchors are per line). */
export const PATTERNS: readonly string[] = [
${h.patterns.map((p) => `  ${json(p)},`).join("\n")}
];

export const HEURISTICS: readonly Heuristic[] = [
${h.rows.map((r) => `  ${json(r)},`).join("\n")}
];

/** Extensions too common to trust alone; a heuristic must confirm them (generic.yml). */
export const GENERIC_EXTENSIONS: readonly string[] = ${json(genericExt)};

/** Paths of third-party code (vendor.yml, minus entries starchart reads differently). */
export const VENDOR_PATTERNS: readonly string[] = [
${vendorJs.map((p) => `  ${json(p)},`).join("\n")}
];

/** Paths linguist treats as documentation (documentation.yml). */
export const DOCUMENTATION_PATTERNS: readonly string[] = [
${docJs.map((p) => `  ${json(p)},`).join("\n")}
];
`;

  await Bun.write(out, body);
  console.log(
    `wrote ${out}: ${langRows.length} languages, ${h.rows.length} heuristics, ${h.patterns.length} patterns, ` +
      `${vendorJs.length} vendor + ${docJs.length} documentation patterns, ${(body.length / 1024).toFixed(1)} KiB`,
  );
}

if (import.meta.main) await main();
