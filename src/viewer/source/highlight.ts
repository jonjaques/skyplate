/**
 * Syntax highlighting for the source reader: highlight.js, loaded only when a file is opened.
 *
 * Why highlight.js: starchart recognizes hundreds of languages and highlight.js grammars cover
 * ~190 of them in one synchronous call, with no WASM and no worker (both of which are awkward
 * or blocked over file://). Its full build is about 1 MB, so it never rides in the main bundle:
 *
 * - Production (a report folder): build.ts writes it as its own classic script,
 *   assets/highlight.js, which sets window.__starchartHighlight. It is injected with a plain
 *   <script src> on first use, the same way report data loads, so it works from file://.
 * - Development: the Bun dev server serves ES modules, so a dynamic import() does the job.
 *   The branch is keyed on process.env.NODE_ENV, which build.ts defines as "production", and
 *   the bundler drops the dead import entirely (checked: the IIFE does not contain hljs).
 *
 * Output is parsed into per-line token runs rather than injected as HTML: the reader has to
 * split tokens at reference boundaries to make identifiers interactive, and it never puts
 * report contents into innerHTML.
 */

import type { HLJSApi } from "highlight.js";
import type { FileRecord } from "../../shared/schema";

declare global {
  interface Window {
    __starchartHighlight?: HLJSApi;
  }
}

let loading: Promise<HLJSApi | null> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

/** The highlighter, or null when it cannot load (the reader then shows plain text). */
export function loadHighlighter(): Promise<HLJSApi | null> {
  if (window.__starchartHighlight) return Promise.resolve(window.__starchartHighlight);
  if (!loading) {
    const load: Promise<HLJSApi | undefined> =
      process.env.NODE_ENV !== "production"
        ? import("highlight.js").then((m) => m.default)
        : injectScript("assets/highlight.js").then(() => window.__starchartHighlight);
    loading = load.then(
      (h) => h ?? null,
      () => null,
    );
  }
  return loading;
}

/**
 * starchart language ids (linguist slugs) whose highlight.js grammar has another name. Ids not
 * listed are tried as-is, then by extension, since most slugs ("python", "rust", "go") are
 * already highlight.js names or aliases.
 */
const GRAMMAR: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
  "json-with-comments": "json",
  json5: "json",
  jsonld: "json",
  "jest-snapshot": "javascript",
  mdx: "markdown",
  rmarkdown: "markdown",
  html: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  astro: "xml",
  marko: "xml",
  ejs: "xml",
  "html+erb": "erb",
  "html+eex": "xml",
  "html+razor": "xml",
  "xml-property-list": "xml",
  "maven-pom": "xml",
  xslt: "xml",
  shell: "bash",
  shellsession: "shell",
  tcsh: "bash",
  fish: "bash",
  dotenv: "bash",
  "c++": "cpp",
  "objective-c": "objectivec",
  "objective-c++": "objectivec",
  "c#": "csharp",
  "f#": "fsharp",
  "visual-basic-.net": "vbnet",
  "visual-basic-6.0": "vbscript",
  vba: "vbscript",
  batchfile: "dos",
  "git-config": "ini",
  editorconfig: "ini",
  "npm-config": "ini",
  "java-properties": "properties",
  "common-lisp": "lisp",
  "emacs-lisp": "lisp",
  racket: "scheme",
  "vim-script": "vim",
  "protocol-buffer": "protobuf",
  "protocol-buffer-text-format": "protobuf",
  tex: "latex",
  "graphviz-(dot)": "dot",
  apacheconf: "apache",
  "unix-assembly": "x86asm",
  assembly: "x86asm",
  "motorola-68k-assembly": "m68k",
  webassembly: "wasm",
  "gradle-kotlin-dsl": "kotlin",
  gradle: "gradle",
  pascal: "delphi",
  "component-pascal": "delphi",
  reason: "reasonml",
  purescript: "haskell",
  "standard-ml": "sml",
  "go-template": "handlebars",
  mustache: "handlebars",
  jinja: "django",
  nunjucks: "django",
  liquid: "django",
  "pip-requirements": "plaintext",
  postcss: "css",
  sugarss: "stylus",
  sass: "scss",
  "cabal-config": "haskell",
  "ignore-list": "bash",
  "git-attributes": "plaintext",
  "robots-exclusion-rules": "plaintext",
  "jupyter-notebook": "json",
  "lean-4": "lean",
  "open-policy-agent": "rego",
  "openstep-property-list": "plaintext",
  gcode: "gcode",
  "g-code": "gcode",
  "roff-manpage": "plaintext",
  text: "plaintext",
  csv: "plaintext",
  tsv: "plaintext",
};

/** highlight.js grammar name for a file, or null for plain text. */
export function grammarFor(hljs: HLJSApi, file: FileRecord): string | null {
  for (const candidate of [GRAMMAR[file.language], file.language, file.ext]) {
    if (!candidate || candidate === "plaintext") continue;
    if (hljs.getLanguage(candidate)) return candidate;
  }
  // Dockerfile, Makefile and friends are recognized by name, not extension.
  const byName = file.name.toLowerCase();
  if (byName === "dockerfile" || byName.startsWith("dockerfile.")) return "dockerfile";
  if (byName === "makefile" || byName === "gnumakefile") return "makefile";
  return null;
}

// ─── HTML → per-line tokens ──────────────────────────────────────────────────────────────────

/** A run of text and the highlight.js scope that colors it ("" for plain). */
export interface Tok {
  t: string;
  c: string;
}

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

function decode(s: string): string {
  return s.indexOf("&") < 0 ? s : s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITY[m] ?? m);
}

/**
 * Split highlight.js output into lines of tokens. Its markup is only ever
 * `<span class="…">`, `</span>` and escaped text, so a small scanner is exact. Spans that
 * cross a newline (block comments, template strings) carry their scope onto the next line.
 */
export function htmlToLines(html: string): Tok[][] {
  const lines: Tok[][] = [[]];
  const stack: string[] = [];
  let i = 0;
  const push = (text: string) => {
    if (!text) return;
    const scope = stack.length ? stack[stack.length - 1]! : "";
    const parts = text.split("\n");
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ t: part, c: scope });
    });
  };
  while (i < html.length) {
    if (html.startsWith('<span class="', i)) {
      const end = html.indexOf('">', i);
      stack.push(html.slice(i + 13, end));
      i = end + 2;
    } else if (html.startsWith("</span>", i)) {
      stack.pop();
      i += 7;
    } else {
      const next = html.indexOf("<", i);
      const stop = next < 0 ? html.length : next;
      push(decode(html.slice(i, stop)));
      i = stop;
    }
  }
  return lines;
}

/** Plain-text lines as single tokens: the fallback and the first paint before highlighting. */
export function plainLines(text: string): Tok[][] {
  return text.split("\n").map((t) => (t ? [{ t, c: "" }] : []));
}
