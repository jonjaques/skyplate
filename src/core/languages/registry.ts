/**
 * Language registry: every GitHub Linguist language plus starchart's two fallbacks, indexed by
 * id, extension, filename, interpreter and alias.
 *
 * Ids follow the shared rule: the linguist name lowercased with spaces turned into "-"
 * ("C++" → "c++", "Vim Script" → "vim-script"). Every module keys on that string, so it must
 * never be derived any other way.
 *
 * Indexes are built on first lookup (about 1.5 ms for 837 languages), so a module that only
 * imports the id rule or a type pays nothing.
 */

import type { GetLanguage, LanguageInfo } from "../contracts";
import { LANGUAGES, type LanguageRow } from "./linguist.generated";

export const toLanguageId = (name: string): string => name.toLowerCase().replace(/ /g, "-");

/** Fallback ids. "text" is also linguist's own "Text" language; "binary" is starchart's. */
export const TEXT = "text";
export const BINARY = "binary";

// ─── Disambiguation rank ─────────────────────────────────────────────────────────────────────
//
// When an extension is shared and no heuristic settles it, the candidate highest in this list
// wins. Linguist's own popular.yml is alphabetical and has no data or markup languages, so it
// cannot rank ".sql" (SQL over TSQL) or ".inc" (C++ over PHP). This is ordered by how often
// each language turns up in real repositories, which is the prior that minimizes wrong guesses.
// Languages not listed fall back to "the extension is their primary one", then linguist type.

const RANK_ORDER = [
  "JavaScript",
  "TypeScript",
  "TSX",
  "Python",
  "Java",
  "C#",
  "C++",
  "C",
  "Go",
  "Rust",
  "PHP",
  "Ruby",
  "Shell",
  "Kotlin",
  "Swift",
  "Objective-C",
  "Objective-C++",
  "Dart",
  "Scala",
  "HTML",
  "CSS",
  "Markdown",
  "JSON",
  "YAML",
  "XML",
  "SQL",
  "Text",
  "Perl",
  "Lua",
  "R",
  "Haskell",
  "Elixir",
  "Erlang",
  "Clojure",
  "F#",
  "OCaml",
  "Groovy",
  "PowerShell",
  "Visual Basic .NET",
  "MATLAB",
  "Julia",
  "Makefile",
  "TeX",
  "Assembly",
  "Verilog",
  "Common Lisp",
  "Prolog",
  "Fortran",
  "Pascal",
  "D",
  "Nim",
  "Zig",
  "Racket",
  "Scheme",
  "Emacs Lisp",
  "Vim Script",
  "Raku",
  "Smalltalk",
  "M4",
  "INI",
  "TOML",
  "Roff",
  "GLSL",
];

/**
 * Per-extension defaults where the global order above picks wrong: niche languages that
 * nonetheless own most files with the extension (".pp" is Puppet far more often than Pascal,
 * ".spec" is an RPM spec more often than a PyInstaller script). Ids, not names. Consulted
 * only after linguist's heuristics have had their say.
 */
const EXTENSION_DEFAULTS: Record<string, string> = {
  ".pp": "puppet",
  ".sls": "salt",
  ".spec": "rpm-spec",
  ".l": "lex",
  ".cls": "apex",
  ".s": "unix-assembly",
  ".i": "swig",
  ".cl": "opencl",
  ".frag": "glsl",
  ".d": "d",
  ".pro": "qmake",
  ".mm": "objective-c++",
};

// ─── Index ───────────────────────────────────────────────────────────────────────────────────

interface Entry extends LanguageInfo {
  primaryExt: string;
  rank: number;
}

interface Index {
  byId: Map<string, Entry>;
  list: Entry[];
  byExt: Map<string, string[]>;
  byFilename: Map<string, string[]>;
  byFilenameLower: Map<string, string[]>;
  byInterpreter: Map<string, string[]>;
  byAlias: Map<string, string>;
}

let index: Index | undefined;

const TYPE_ORDER = { programming: 0, markup: 1, data: 2, prose: 3, binary: 4, other: 5 } as const;

function push(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

/** Rank, then "this extension is the language's primary one", then linguist type, then name. */
function compare(byId: Map<string, Entry>, a: string, b: string, ext?: string): number {
  const ea = byId.get(a)!;
  const eb = byId.get(b)!;
  if (ea.rank !== eb.rank) return ea.rank - eb.rank;
  if (ext !== undefined) {
    const pa = ea.primaryExt === ext ? 0 : 1;
    const pb = eb.primaryExt === ext ? 0 : 1;
    if (pa !== pb) return pa - pb;
  }
  const t = TYPE_ORDER[ea.type] - TYPE_ORDER[eb.type];
  if (t !== 0) return t;
  return ea.name < eb.name ? -1 : ea.name > eb.name ? 1 : 0;
}

function build(): Index {
  const rankOf = new Map(RANK_ORDER.map((n, i) => [toLanguageId(n), i]));
  const byId = new Map<string, Entry>();
  const byExt = new Map<string, string[]>();
  const byFilename = new Map<string, string[]>();
  const byFilenameLower = new Map<string, string[]>();
  const byInterpreter = new Map<string, string[]>();
  const byAlias = new Map<string, string>();

  const add = (row: LanguageRow) => {
    const [name, type, color, group, exts, filenames, interpreters, aliases] = row;
    const id = toLanguageId(name);
    const entry: Entry = {
      id,
      name,
      type,
      ...(color ? { color } : {}),
      ...(group ? { group } : {}),
      primaryExt: exts[0] ?? "",
      rank: rankOf.get(id) ?? Number.MAX_SAFE_INTEGER,
    };
    byId.set(id, entry);
    for (const e of exts) push(byExt, e, id);
    for (const f of filenames) {
      push(byFilename, f, id);
      push(byFilenameLower, f.toLowerCase(), id);
    }
    for (const i of interpreters) push(byInterpreter, i, id);
    // Modelines name languages by alias, by name, or by a lowercased name: "ft=cpp",
    // "mode: c++", "-*- Python -*-". On a clash the language first in name order keeps it.
    for (const a of [name.toLowerCase(), id, ...aliases]) if (!byAlias.has(a)) byAlias.set(a, id);
  };
  for (const row of LANGUAGES) add(row);

  byId.set(BINARY, {
    id: BINARY,
    name: "Binary",
    type: "binary",
    primaryExt: "",
    rank: Number.MAX_SAFE_INTEGER,
  });

  // Candidate lists come back best-first, so callers can take [0] as the default guess.
  for (const [ext, ids] of byExt) {
    ids.sort((a, b) => compare(byId, a, b, ext));
    const preferred = EXTENSION_DEFAULTS[ext];
    const at = preferred ? ids.indexOf(preferred) : -1;
    if (at > 0) ids.unshift(...ids.splice(at, 1));
  }
  for (const ids of byFilename.values()) ids.sort((a, b) => compare(byId, a, b));
  for (const ids of byFilenameLower.values()) ids.sort((a, b) => compare(byId, a, b));
  for (const ids of byInterpreter.values()) ids.sort((a, b) => compare(byId, a, b));

  const list = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { byId, list, byExt, byFilename, byFilenameLower, byInterpreter, byAlias };
}

const idx = () => (index ??= build());

const EMPTY: readonly string[] = [];

const publicInfo = (e: Entry): LanguageInfo => ({
  id: e.id,
  name: e.name,
  type: e.type,
  ...(e.color ? { color: e.color } : {}),
  ...(e.group ? { group: e.group } : {}),
});

// ─── Public API ──────────────────────────────────────────────────────────────────────────────

export const getLanguage: GetLanguage = (id) => {
  const e = idx().byId.get(id);
  return e ? publicInfo(e) : undefined;
};

/** Every language, sorted by id. Includes the "text" and "binary" fallbacks. */
export function allLanguages(): LanguageInfo[] {
  return idx().list.map(publicInfo);
}

/** Languages claiming a lowercased extension with its dot (".ts"), best guess first. */
export function languagesForExtension(ext: string): readonly string[] {
  return idx().byExt.get(ext) ?? EMPTY;
}

/** Languages claiming an exact basename; falls back to a case-insensitive match. */
export function languagesForFilename(name: string): readonly string[] {
  const i = idx();
  return i.byFilename.get(name) ?? i.byFilenameLower.get(name.toLowerCase()) ?? EMPTY;
}

/** Languages run by an interpreter named in a shebang ("python3", "node"). */
export function languagesForInterpreter(name: string): readonly string[] {
  return idx().byInterpreter.get(name) ?? EMPTY;
}

/** Resolve a modeline or fence name ("cpp", "c++", "sh", "python") to an id. */
export function languageForAlias(alias: string): string | undefined {
  return idx().byAlias.get(alias.toLowerCase());
}

/** Internal: linguist type of an id, or undefined when unknown. */
export function languageType(id: string): LanguageInfo["type"] | undefined {
  return idx().byId.get(id)?.type;
}
