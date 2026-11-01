/**
 * The reader's syntax palette: highlight.js scopes → Tailwind classes.
 *
 * Deliberately not the categorical series. Those colors mean "this language" on the galaxy and
 * in every chart, so a blue keyword would read as "TypeScript" and a green string as "Vue".
 * Code here is set in archival inks instead: slate keywords, teal types, olive strings, umber
 * literals, gray italic comments. Each step was checked at ≥ 4.5:1 on paper (#fff) and on dark
 * paper (#1c2328), and ≥ 4.4:1 under the reference mark. Holotype red is never used, not even
 * for diff deletions (plum), because red means "most depended-on file" in this world.
 *
 * Literal class strings (not built from parts) so Tailwind's scanner finds them.
 */

const KEYWORD = "text-[#3f5566] dark:text-[#a8bccb]";
const TYPE = "text-[#1f5f6b] dark:text-[#8cc8d2]";
const STRING = "text-[#3d6b2f] dark:text-[#a7cf8f]";
const LITERAL = "text-[#8a4f0f] dark:text-[#e0b07a]";
const COMMENT = "italic text-[#5d666d] dark:text-[#9aa5ad]";
const TITLE = "font-semibold text-ink";
const ATTR = "text-ink-2";
const META = "text-[#5a4a8a] dark:text-[#b9aee6]";

const BY_SCOPE: Record<string, string> = {
  keyword: KEYWORD,
  "built_in": TYPE,
  type: TYPE,
  "title.class": TYPE,
  "title.class.inherited": TYPE,
  class: TYPE,
  literal: LITERAL,
  number: LITERAL,
  regexp: LITERAL,
  symbol: LITERAL,
  bullet: LITERAL,
  string: STRING,
  char: STRING,
  "template-tag": STRING,
  subst: "text-ink",
  comment: COMMENT,
  quote: COMMENT,
  doctag: `font-semibold ${META}`,
  title: TITLE,
  "title.function": TITLE,
  "title.function.invoke": "text-ink",
  section: "font-bold text-ink",
  attr: ATTR,
  attribute: ATTR,
  property: ATTR,
  variable: "text-ink",
  "variable.language": KEYWORD,
  "variable.constant": LITERAL,
  params: "text-ink",
  meta: META,
  "meta keyword": META,
  "meta-keyword": META,
  "meta-string": STRING,
  tag: META,
  name: KEYWORD,
  "selector-tag": KEYWORD,
  "selector-id": TYPE,
  "selector-class": TYPE,
  "selector-attr": ATTR,
  "selector-pseudo": ATTR,
  operator: "text-ink-2",
  punctuation: "text-ink-2",
  link: "underline underline-offset-2",
  emphasis: "italic",
  strong: "font-bold",
  code: STRING,
  formula: LITERAL,
  addition: "text-[#2f6b2f] dark:text-[#a7cf8f]",
  deletion: "text-[#8a3d6b] dark:text-[#e6a3c8]",
};

const cache = new Map<string, string>();

/**
 * highlight.js writes scopes as `hljs-title function_` (a scope plus modifiers with a trailing
 * underscore). Look up the most specific dotted form first, then fall back to the base scope.
 */
export function syntaxClass(scope: string): string {
  if (!scope) return "";
  let hit = cache.get(scope);
  if (hit !== undefined) return hit;
  const parts = scope.split(/\s+/);
  const base = (parts[0] ?? "").replace(/^hljs-/, "");
  const modifiers = parts
    .slice(1)
    .map((p) => p.replace(/_+$/, "").replace(/^hljs-/, ""))
    .filter(Boolean);
  hit = BY_SCOPE[[base, ...modifiers].join(".")] ?? BY_SCOPE[base] ?? "";
  cache.set(scope, hit);
  return hit;
}
