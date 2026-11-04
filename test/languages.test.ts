/**
 * Language registry, generator translation, and detectFile.
 *
 * The opt-in accuracy check at the bottom runs detectFile over a linguist checkout's samples/
 * tree, where each file sits under its true language's folder:
 *
 *   LINGUIST_SAMPLES=/path/to/linguist/samples bun test test/languages.test.ts
 */

import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { rubyToJs } from "../scripts/gen-languages";
import { detectFile, namedLanguageIds } from "../src/core/languages/detect";
import { runHeuristics } from "../src/core/languages/heuristics";
import { HEURISTICS, LANGUAGES, PATTERNS, VENDOR_PATTERNS } from "../src/core/languages/linguist.generated";
import {
  allLanguages,
  getLanguage,
  languageForAlias,
  languagesForExtension,
  languagesForFilename,
  languagesForFilenameIgnoringCase,
  languagesForInterpreter,
  rankedLanguageIds,
  toLanguageId,
} from "../src/core/languages/registry";

const enc = new TextEncoder();
const text = (s: string) => enc.encode(s);
const bytes = (...v: number[]) => new Uint8Array(v);
const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const padded = (prefix: number[], size = 64) => {
  const b = new Uint8Array(size);
  b.set(prefix);
  return b;
};
const detect = (path: string, content: string | Uint8Array = "") =>
  detectFile(path, typeof content === "string" ? text(content) : content);

// ─── Generator ───────────────────────────────────────────────────────────────────────────────

describe("rubyToJs", () => {
  test("string anchors become lookarounds", () => {
    const re = new RegExp(rubyToJs("\\A\\s*\\{"), "m");
    expect(re.test("  {")).toBe(true);
    expect(re.test("x\n{")).toBe(false);
    expect(new RegExp(rubyToJs("end\\z"), "m").test("the end")).toBe(true);
    expect(new RegExp(rubyToJs("end\\z"), "m").test("the end\nmore")).toBe(false);
  });

  test("a leading (?i) wraps the whole pattern, alternation included", () => {
    expect(rubyToJs("(?i)^a|b")).toBe("(?i:^a|b)");
    expect(new RegExp(rubyToJs("(?i)^foo"), "m").test("FOO")).toBe(true);
  });

  test("a mid-pattern (?i) applies to the end of its group, as in Onigmo", () => {
    const re = new RegExp(rubyToJs('^(?i)[^"m]*MOV\\s+[^\\s]+,'), "m");
    expect(re.test("  mov eax, 1")).toBe(true);
    expect(new RegExp(rubyToJs("(a(?i)b)c"), "m").test("aBc")).toBe(true);
    expect(new RegExp(rubyToJs("(a(?i)b)c"), "m").test("aBC")).toBe(false);
  });

  test("Ruby (?m) is JS dotall", () => {
    expect(new RegExp(rubyToJs("(?m)a.b"), "m").test("a\nb")).toBe(true);
  });

  test("POSIX classes, \\h, {,n} and class intersection", () => {
    expect(rubyToJs("[[:alpha:]]+")).toBe("[a-zA-Z]+");
    expect(new RegExp(rubyToJs("^\\h+$"), "m").test("c0ffee")).toBe(true);
    expect(rubyToJs("x{,3}")).toBe("x{0,3}");
    const hspace = new RegExp(rubyToJs("^[\\s&&[^\\r\\n]]*="), "m");
    expect(hspace.test("  \t=")).toBe(true);
    expect(hspace.test("\n=x")).toBe(true); // second line starts with "=" directly
    expect(new RegExp(`(?<![\\s\\S])${rubyToJs("[\\s&&[^\\r\\n]]+=")}`).test("\n=")).toBe(false);
  });

  test("possessive quantifiers are dropped, escaped stars are not", () => {
    expect(rubyToJs("a*+b")).toBe("a*b");
    expect(rubyToJs("\\*+[^*/]")).toBe("\\*+[^*/]");
  });

  test("unsupported constructs fail loudly", () => {
    expect(() => rubyToJs("\\Gfoo")).toThrow();
    expect(() => rubyToJs("(?x) a b")).toThrow();
  });
});

describe("generated table", () => {
  test("every heuristic pattern compiles", () => {
    for (const p of PATTERNS) expect(() => new RegExp(p, "m")).not.toThrow();
  });

  test("every heuristic names known languages", () => {
    const ids = new Set(LANGUAGES.map((r) => toLanguageId(r[0])));
    for (const [, rules] of HEURISTICS) for (const [langs] of rules) for (const l of langs) expect(ids.has(l)).toBe(true);
  });

  test("vendor patterns join into one regex", () => {
    const re = new RegExp(VENDOR_PATTERNS.map((s) => `(?:${s})`).join("|"));
    expect(re.test("node_modules/react/index.js")).toBe(true);
    expect(re.test("src/index.ts")).toBe(false);
  });
});

// ─── Registry ────────────────────────────────────────────────────────────────────────────────

describe("registry", () => {
  test("ids follow the shared rule", () => {
    expect(toLanguageId("TypeScript")).toBe("typescript");
    expect(toLanguageId("C++")).toBe("c++");
    expect(toLanguageId("Objective-C")).toBe("objective-c");
    expect(toLanguageId("JSON with Comments")).toBe("json-with-comments");
    expect(toLanguageId("Vim Script")).toBe("vim-script");
    expect(toLanguageId("Jupyter Notebook")).toBe("jupyter-notebook");
    for (const id of ["typescript", "c++", "objective-c", "shell", "json-with-comments", "vim-script", "f#", "jupyter-notebook", "markdown", "tsx"]) {
      expect(getLanguage(id)?.id).toBe(id);
    }
  });

  test("language info carries type, color and group", () => {
    expect(getLanguage("typescript")).toMatchObject({ name: "TypeScript", type: "programming", color: "#3178c6" });
    expect(getLanguage("tsx")?.group).toBe("typescript");
    expect(getLanguage("json-with-comments")?.group).toBe("json");
    expect(getLanguage("nope")).toBeUndefined();
  });

  test("fallbacks exist", () => {
    expect(getLanguage("text")?.type).toBe("prose");
    expect(getLanguage("binary")?.type).toBe("binary");
  });

  test("allLanguages is complete and sorted by id", () => {
    const all = allLanguages();
    expect(all.length).toBe(LANGUAGES.length + 1);
    const ids = all.map((l) => l.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("shared extensions rank the common language first", () => {
    expect(languagesForExtension(".ts")[0]).toBe("typescript");
    expect(languagesForExtension(".h")[0]).toBe("c++");
    expect(languagesForExtension(".m")[0]).toBe("objective-c");
    expect(languagesForExtension(".pl")[0]).toBe("perl");
    expect(languagesForExtension(".md")[0]).toBe("markdown");
    expect(languagesForExtension(".sql")[0]).toBe("sql");
    // Per-extension defaults where the global order would pick wrong.
    expect(languagesForExtension(".pp")[0]).toBe("puppet");
    expect(languagesForExtension(".mm")[0]).toBe("objective-c++");
    expect(languagesForExtension(".spec")[0]).toBe("rpm-spec");
  });

  test("every id the rules name by hand resolves", () => {
    // A renamed or misspelled id never matches and fails silently; "robots.txt" did.
    const dead = [...namedLanguageIds(), ...rankedLanguageIds()].filter((id) => !getLanguage(id));
    expect(dead).toEqual([]);
  });

  test("filename, interpreter and alias lookups", () => {
    expect(languagesForFilename("Makefile")).toEqual(["makefile"]);
    expect(languagesForFilename("makefile")).toEqual(["makefile"]);
    expect(languagesForFilename("tsconfig.json")).toEqual(["json-with-comments"]);
    // Exact case, as linguist looks names up; the any-case fallback is a separate, weaker call.
    expect(languagesForFilename("install")).toEqual([]);
    expect(languagesForFilenameIgnoringCase("install")).toEqual(["text"]);
    expect(languagesForFilenameIgnoringCase("dockerfile")).toEqual(["dockerfile"]);
    expect(languagesForInterpreter("node")[0]).toBe("javascript");
    expect(languagesForInterpreter("python3")).toEqual(["python"]);
    expect(languageForAlias("cpp")).toBe("c++");
    expect(languageForAlias("sh")).toBe("shell");
    expect(languageForAlias("Python")).toBe("python");
  });
});

// ─── detectFile: language ────────────────────────────────────────────────────────────────────

describe("detectFile language", () => {
  test("unambiguous extensions", () => {
    expect(detect("src/main.rs", "fn main() {}")).toMatchObject({ language: "rust" });
    expect(detect("app.py", "print(1)")).toMatchObject({ language: "python", reason: "extension" });
    expect(detect("a/b/C.java", "class C {}")).toMatchObject({ language: "java", reason: "extension" });
    expect(detect("x.go", "package x")).toMatchObject({ language: "go", reason: "extension" });
  });

  test(".ts is TypeScript unless the document is Qt XML", () => {
    expect(detect("src/a.ts", "export const a = 1;")).toMatchObject({ language: "typescript" });
    expect(detect("src/g.ts", "function f<TS extends Shape>(x: TS) { return x; }")).toMatchObject({ language: "typescript" });
    expect(detect("i18n/app_de.ts", '<?xml version="1.0"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="de">')).toMatchObject({
      language: "xml",
    });
    expect(detect("src/App.tsx", "export const App = () => <div />;")).toMatchObject({ language: "tsx" });
    expect(detect("types/index.d.ts", "export {};")).toMatchObject({ language: "typescript", category: "code", vendored: false });
  });

  test("heuristics settle .h, .m and .pl", () => {
    expect(detect("a.h", "#include <stdio.h>\nint f(void);")).toMatchObject({ language: "c", reason: "heuristic" });
    expect(detect("a.h", "namespace foo {\nclass Bar {};\n}")).toMatchObject({ language: "c++", reason: "heuristic" });
    expect(detect("a.h", "@interface Foo : NSObject\n@end")).toMatchObject({ language: "objective-c" });
    expect(detect("a.m", "#import <Foundation/Foundation.h>\n@implementation Foo\n@end")).toMatchObject({ language: "objective-c" });
    expect(detect("a.m", "function y = f(x)\n  y = x;\nend")).toMatchObject({ language: "matlab" });
    expect(detect("a.pl", "use strict;\nmy $x = 1;")).toMatchObject({ language: "perl" });
    expect(detect("a.pl", ":- module(foo, []).\nfoo(X) :- bar(X).")).toMatchObject({ language: "prolog" });
  });

  test("heuristics run on the lowercased basename", () => {
    expect(runHeuristics("x.h", "int x;")).toEqual(["c"]);
    expect(runHeuristics("x.unknown", "int x;")).toBeUndefined();
  });

  test("markdown vs GCC machine description", () => {
    expect(detect("README.md", "# Hi\n\nSome text.")).toMatchObject({ language: "markdown", category: "docs" });
    expect(detect("gcc/i386.md", ";; Machine description\n(define_insn \"x\"")).toMatchObject({ language: "gcc-machine-description" });
  });

  test("exact filenames, linguist's and Skyplate's", () => {
    expect(detect("Makefile", "all:\n\techo hi")).toMatchObject({ language: "makefile", reason: "filename", category: "build" });
    expect(detect("Dockerfile", "FROM node")).toMatchObject({ language: "dockerfile", category: "build" });
    expect(detect("Dockerfile.dev", "FROM node")).toMatchObject({ language: "dockerfile", category: "build" });
    expect(detect("CMakeLists.txt", "project(x)")).toMatchObject({ language: "cmake", category: "build" });
    expect(detect(".bashrc", "export X=1")).toMatchObject({ language: "shell", category: "config" });
    expect(detect(".gitignore", "node_modules")).toMatchObject({ language: "ignore-list", category: "config" });
    expect(detect("LICENSE", "MIT License")).toMatchObject({ language: "text", category: "docs" });
    expect(detect("go.mod", "module x")).toMatchObject({ language: "go-module", category: "config" });
    expect(detect("tsconfig.json", "{ // c\n}")).toMatchObject({ language: "json-with-comments", category: "config" });
    expect(detect("tsconfig.build.json", "{}")).toMatchObject({ language: "json-with-comments", category: "config" });
    expect(detect(".vscode/settings.json", "{}")).toMatchObject({ language: "json-with-comments", category: "config" });
    expect(detect("Gemfile", "gem 'x'")).toMatchObject({ language: "ruby", category: "config" });
    expect(detect("README", "Hello there, this is a project.")).toMatchObject({ language: "text", reason: "filename", category: "docs" });
  });

  test("ambiguous filenames go by shape", () => {
    expect(detect(".eslintrc", '{ "rules": {} }')).toMatchObject({ language: "json-with-comments" });
    expect(detect(".eslintrc", "rules:\n  semi: 2")).toMatchObject({ language: "yaml" });
  });

  test("a shebang beats a name matched only case-insensitively or by convention", () => {
    // fzf's install and linguist's tools/grammars/docker/build were Text/docs and Starlark.
    expect(detect("install", "#!/usr/bin/env bash\nset -u\n")).toMatchObject({ language: "shell", category: "code", reason: "shebang" });
    expect(detect("tools/grammars/docker/build", "#!/bin/sh\nset -e\n")).toMatchObject({ language: "shell", reason: "shebang" });
    expect(detect("news", "#!/usr/bin/env python3\nprint(1)\n")).toMatchObject({ language: "python" });
    expect(detect("copying", "#!/usr/bin/env node\n")).toMatchObject({ language: "javascript" });
    // Without a shebang the conventions still apply, and an exact linguist name still wins.
    expect(detect("install", "Run make install.\n")).toMatchObject({ language: "text", category: "docs", reason: "filename" });
    expect(detect("dockerfile", "FROM node\n")).toMatchObject({ language: "dockerfile", reason: "filename" });
    expect(detect("INSTALL", "#!/bin/sh\necho\n")).toMatchObject({ language: "text", reason: "filename" });
  });

  test("names Skyplate adds: Cursor rules and Wrangler's .dev.vars", () => {
    expect(detect(".cursor/rules/style.mdc", "---\ndescription: x\n---\n# Style\n")).toMatchObject({ language: "markdown", category: "docs" });
    expect(detect(".dev.vars", "API_TOKEN=x\n")).toMatchObject({ language: "dotenv", category: "config" });
  });

  test("content settles what the ranked default would get wrong", () => {
    // XML outranks Scheme and HCL, but an XML document must open with "<".
    expect(detect("lib/sboyer.sch", ";;; File: sboyer.sch\n(define (f x) x)\n")).toMatchObject({ language: "scheme" });
    expect(detect("main.workflow", 'workflow "Build" {\n  on = "push"\n}\n')).toMatchObject({ language: "hcl" });
    expect(detect("views/Hello.gst", "<%!-- defined in Hello.gst --%>\n<%@ params(x : String) %>\n")).toMatchObject({ language: "gosu" });
    // And one that does open with an element is XML, or the dialect its root names.
    expect(detect("ideas.mm", '<map version="0.9.0">\n<node TEXT="x"/>\n</map>\n')).toMatchObject({ language: "xml", category: "markup" });
    expect(detect("XmlIO.pluginspec", '<plugin name="XmlIO" version="0.0.1">\n</plugin>\n')).toMatchObject({ language: "xml" });
    const eagle = '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd">\n<eagle version="6.3">\n';
    expect(detect("board/Eagle.brd", eagle)).toMatchObject({ language: "eagle" });
    expect(detect("board/Eagle.sch", eagle)).toMatchObject({ language: "eagle" });
    expect(detect("cgi/prefix.fcgi", '<?php\necho "x";\n')).toMatchObject({ language: "php" });
    expect(detect("Calc.nb", "(* Content-type: application/vnd.wolfram.mathematica *)\n")).toMatchObject({ language: "wolfram-language" });
    // Ordinary files keep their extension's default.
    expect(detect("src/View.mm", "#import <UIKit/UIKit.h>\n@implementation View\n@end\n")).toMatchObject({ language: "objective-c++" });
    expect(detect("rules/schematron.sch", '<?xml version="1.0"?>\n<sch:schema xmlns:sch="x"/>\n')).toMatchObject({ language: "xml" });
    expect(detect("Notes.nb", "a plain note\n")).toMatchObject({ language: "text" });
  });

  test("negative_pattern applies alongside pattern, a known deviation from linguist", () => {
    // Linguist's parser drops negative_pattern when a rule also has a pattern (parse_rule
    // returns on the first key). Skyplate keeps both, as the YAML evidently means.
    // The cost, measured over linguist's samples: one file, samples/Tree-sitter Query/
    // func_highlights.scm, whose literal "()" trips the Tree-sitter rule's negative pattern
    // and leaves it to the ranked default, Scheme. Linguist says Tree-sitter Query.
    const query = "(function_definition name: (identifier) @function)\n((identifier) @constant (#match? @constant \"^[A-Z]\"))\n";
    expect(detect("queries/highlights.scm", query)).toMatchObject({ language: "tree-sitter-query" });
    expect(detect("queries/highlights.scm", `${query}(arguments ()) @empty\n`)).toMatchObject({ language: "scheme" });
    // The benefit: Scheme that splices with ,@ matches a Tree-sitter capture pattern, so under
    // linguist's reading every such macro file would be a Tree-sitter query.
    const macro = "(define (wrap x) `(begin ,@x)\n)\n(display (+ 1 2))\n";
    const [, rules] = HEURISTICS.find(([exts]) => exts.includes(".scm"))!;
    const tsq = rules[0]![1];
    if (tsq === null || tsq[0] !== "&") throw new Error("the .scm heuristic changed shape");
    const positive = tsq[1] as readonly ["p", ...number[]];
    expect(positive.slice(1).some((i) => new RegExp(PATTERNS[i as number]!, "m").test(macro))).toBe(true);
    expect(detect("lib/macros.scm", macro)).toMatchObject({ language: "scheme" });
  });

  test("shebangs", () => {
    expect(detect("bin/run", "#!/usr/bin/env node\nconsole.log(1)")).toMatchObject({ language: "javascript", reason: "shebang" });
    expect(detect("bin/run", "#!/usr/bin/env python3\nprint(1)")).toMatchObject({ language: "python", reason: "shebang" });
    expect(detect("bin/run", "#!/usr/bin/python3.12\nprint(1)")).toMatchObject({ language: "python" });
    expect(detect("bin/run", "#!/bin/bash\necho")).toMatchObject({ language: "shell" });
    expect(detect("bin/run", "#!/usr/bin/env -S deno run -A\n")).toMatchObject({ language: "javascript" });
    expect(detect("bin/run", "#!/usr/bin/env ruby\nputs 1")).toMatchObject({ language: "ruby" });
    expect(detect("bin/run", "#!/usr/bin/perl -w\nprint 1;")).toMatchObject({ language: "perl" });
    expect(detect("bin/run", '#!/bin/sh\n# \\\nexec tclsh "$0" "$@"\n')).toMatchObject({ language: "tcl" });
  });

  test("modelines", () => {
    expect(detect("include/thing.h", "// -*- C++ -*-\n#pragma once\n")).toMatchObject({ language: "c++", reason: "modeline" });
    expect(detect("conf/thing", "# vim: set ft=python:\nx = 1\n")).toMatchObject({ language: "python", reason: "modeline" });
    expect(detect("scripts/x", "echo hi\n\n\n\n\n\n\n# vim: ft=sh\n")).toMatchObject({ language: "shell", reason: "modeline" });
    expect(detect("x.el", ";;; x.el --- thing -*- lexical-binding: t -*-\n")).toMatchObject({ language: "emacs-lisp" });
  });

  test("text-shape sniffing for unknown names", () => {
    expect(detect("data/feed", '<?xml version="1.0"?>\n<rss/>')).toMatchObject({ language: "xml", reason: "content" });
    expect(detect("pages/index", "<!DOCTYPE html>\n<html></html>")).toMatchObject({ language: "html", reason: "content" });
    expect(detect("data/blob", '{"a": [1, 2]}')).toMatchObject({ language: "json", reason: "content" });
    expect(detect("completion/_fd", "#compdef fd\n_fd() {}")).toMatchObject({ language: "shell" });
    expect(detect("notes/thing", "just some words")).toMatchObject({ language: "text", reason: "fallback", category: "unknown" });
    expect(detect("empty.unknownext", "")).toMatchObject({ language: "text", binary: false });
  });
});

// ─── detectFile: binary formats ──────────────────────────────────────────────────────────────

describe("detectFile binary", () => {
  const cases: [string, Uint8Array, string, string][] = [
    ["a.png", padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "PNG", "image"],
    ["a.jpg", padded([0xff, 0xd8, 0xff, 0xe0, 0]), "JPEG", "image"],
    ["a.gif", padded([...text("GIF89a"), 1, 0, 1, 0]), "GIF", "image"],
    ["a.webp", padded([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")]), "WEBP", "image"],
    ["a.ico", padded([0, 0, 1, 0, 1, 0]), "ICO", "image"],
    ["a.avif", padded([0, 0, 0, 0x1c, ...text("ftypavif")]), "AVIF", "image"],
    ["a.heic", padded([0, 0, 0, 0x18, ...text("ftypheic")]), "HEIC", "image"],
    ["a.mp4", padded([0, 0, 0, 0x18, ...text("ftypisom")]), "MP4", "media"],
    ["a.mov", padded([0, 0, 0, 0x14, ...text("ftypqt  ")]), "MOV", "media"],
    ["a.pdf", text("%PDF-1.7\n"), "PDF", "docs"],
    ["a.zip", padded([...text("PK"), 3, 4, 0]), "ZIP", "archive"],
    ["a.docx", padded([...text("PK"), 3, 4, 0]), "DOCX", "docs"],
    ["a.xlsx", padded([...text("PK"), 3, 4, 0]), "XLSX", "data"],
    ["a.jar", padded([...text("PK"), 3, 4, 0]), "JAR", "archive"],
    ["a.whl", padded([...text("PK"), 3, 4, 0]), "Wheel", "archive"],
    ["a.gz", padded([0x1f, 0x8b, 8, 0]), "GZIP", "archive"],
    ["a.xz", padded([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]), "XZ", "archive"],
    ["a.zst", padded([0x28, 0xb5, 0x2f, 0xfd, 0]), "ZSTD", "archive"],
    ["a.blend", padded([0x28, 0xb5, 0x2f, 0xfd, 0]), "Blender", "binary"],
    ["a.7z", padded([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0]), "7z", "archive"],
    ["a.tar", (() => { const b = padded([0x61, 0], 600); b.set(text("ustar"), 257); return b; })(), "TAR", "archive"],
    ["bin/tool", padded([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), "ELF", "binary"],
    ["bin/tool", padded([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]), "Mach-O", "binary"],
    ["bin/fat", padded([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]), "Mach-O", "binary"],
    ["A.class", padded([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41]), "Java class", "binary"],
    ["a.exe", padded([...text("MZ"), 0x90, 0]), "PE/COFF", "binary"],
    ["a.wasm", padded([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), "WASM", "binary"],
    ["a.db", padded([...text("SQLite format 3"), 0]), "SQLite", "data"],
    ["m.gguf", padded([...text("GGUF"), 3, 0, 0, 0]), "GGUF", "binary"],
    ["m.safetensors", padded([0x40, 0, 0, 0, 0, 0, 0, 0, 0x7b, 0x22]), "safetensors", "binary"],
    ["d.parquet", padded([...text("PAR1"), 0x15, 0]), "Parquet", "data"],
    ["d.arrow", padded([...text("ARROW1"), 0, 0]), "Arrow", "data"],
    ["d.npy", padded([0x93, ...text("NUMPY"), 1, 0]), "NumPy", "data"],
    ["d.h5", padded([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "HDF5", "data"],
    ["m.onnx", padded([0x08, 0x07, 0x12, 0]), "ONNX", "binary"],
    ["f.ttf", padded([0, 1, 0, 0, 0, 0x10]), "TTF", "font"],
    ["f.otf", padded([...text("OTTO"), 0, 0x10]), "OTF", "font"],
    ["f.woff", padded([...text("wOFF"), 0, 1]), "WOFF", "font"],
    ["f.woff2", padded([...text("wOF2"), 0, 1]), "WOFF2", "font"],
    ["s.mp3", padded([...text("ID3"), 4, 0]), "MP3", "media"],
    ["s.flac", padded([...text("fLaC"), 0]), "FLAC", "media"],
    ["s.ogg", padded([...text("OggS"), 0]), "OGG", "media"],
    ["s.wav", padded([...text("RIFF"), 0, 0, 0, 0, ...text("WAVE")]), "WAV", "media"],
    ["v.webm", padded([0x1a, 0x45, 0xdf, 0xa3, 0]), "WebM", "media"],
    ["s.mid", padded([...text("MThd"), 0, 0, 0, 6]), "MIDI", "media"],
  ];
  for (const [path, head, format, category] of cases) {
    test(`${path} → ${format}`, () => {
      const d = detectFile(path, head);
      expect(d).toMatchObject({ language: "binary", binary: true, format, category, reason: "content" });
    });
  }

  test("an MPEG transport stream named .ts is media, not TypeScript", () => {
    const b = new Uint8Array(400);
    b[0] = 0x47;
    b[188] = 0x47;
    b[1] = 0x40;
    expect(detectFile("video/clip.ts", b)).toMatchObject({ language: "binary", format: "MPEG-TS", category: "media" });
  });

  test("unknown binary falls back", () => {
    expect(detectFile("data/blob.irsm", bytes(1, 2, 0, 0, 255, 254, 3))).toMatchObject({ language: "binary", category: "binary", reason: "fallback" });
  });

  test("bun.lockb is a binary lockfile", () => {
    expect(detectFile("bun.lockb", bytes(0x23, 0x21, 0, 1, 2))).toMatchObject({ binary: true, category: "lockfile" });
  });
});

// ─── detectFile: text decoding ───────────────────────────────────────────────────────────────

describe("detectFile text decoding", () => {
  test("UTF-16 with a BOM is text", () => {
    const s = "Hello, world";
    const b = new Uint8Array(2 + s.length * 2);
    b[0] = 0xff;
    b[1] = 0xfe;
    for (let i = 0; i < s.length; i++) b[2 + i * 2] = s.charCodeAt(i);
    expect(detectFile("notes.txt", b)).toMatchObject({ binary: false, language: "text" });
  });

  test("a multibyte character cut at the 8 KiB boundary stays text", () => {
    const b = new Uint8Array(8192).fill(0x61);
    b.set([0xe2, 0x82], 8190); // first two bytes of "€"
    expect(detectFile("big.txt", b).binary).toBe(false);
  });

  test("Latin-1 source without control bytes is text; random bytes are binary", () => {
    expect(detectFile("a.c", text("/* Copyright J\u00fcrgen */ int x;")).binary).toBe(false);
    const l1 = new Uint8Array([...text("/* Copyright J"), 0xfc, ...text("rgen */\nint x;\n")]);
    expect(detectFile("a.c", l1)).toMatchObject({ binary: false, language: "c" });
    expect(detectFile("a.c", bytes(0x01, 0x02, 0xfc, 0xfd, 0x03))).toMatchObject({ binary: true });
  });

  test("Shift_JIS, GBK and EUC-KR text is text, past the Latin-1 high-byte cap", () => {
    const cases: [string, string, string][] = [
      // "# はじめに\n\nこのプロジェクトは日本語の説明です。…" in Shift_JIS
      ["docs/README.ja.md", "232082cd82b682df82c90a0a82b182cc8376838d83578346834e836782cd93fa967b8cea82cc90e096be82c582b781428343839383588367815b838b95fb964082cd88c889ba82cc92ca82e882c582b781420a", "markdown"],
      // "/* 主程序入口，打印问候语 */\nint main(void) { return 0; }\n" in GBK
      ["src/main_gbk.c", "2f2a20d6f7b3ccd0f2c8ebbfdaa3acb4f2d3a1cecabaf2d3ef202a2f0a696e74206d61696e28766f696429207b2072657475726e20303b207d0a", "c"],
      // '// 사용자 이름 목록\nconst names = ["김철수", "이영희"];\n' in EUC-KR
      ["src/name_euckr.js", "2f2f20bbe7bfebc0da20c0ccb8a720b8f1b7cf0a636f6e7374206e616d6573203d205b22b1e8c3b6bcf6222c2022c0ccbfb5c8f1225d3b0a", "javascript"],
    ];
    for (const [path, h, language] of cases) {
      const b = hex(h);
      expect(b.filter((c) => c >= 0x80).length / b.length).toBeGreaterThan(0.3); // the path under test
      expect([path, detectFile(path, b)]).toMatchObject([path, { binary: false, language }]);
    }
    // A short run of high bytes with no whitespace stays binary even where GB18030 would take it.
    expect(detectFile("blob.bin", bytes(0xb0, 0xa1, 0xb0, 0xa2, 0xb0, 0xa3)).binary).toBe(true);
  });
});

// ─── detectFile: category ────────────────────────────────────────────────────────────────────

describe("detectFile category", () => {
  test("tests by path convention across ecosystems", () => {
    for (const p of [
      "src/__tests__/a.ts",
      "src/a.test.ts",
      "src/a.spec.jsx",
      "pkg/a_test.go",
      "tests/test_api.py",
      "app/test_models.py",
      "lib/foo_test.py",
      "src/test/java/com/x/FooTest.java",
      "Tests/FooTests.cs",
      "spec/models/user_spec.rb",
      "e2e/login.ts",
      "cypress/e2e/login.cy.ts",
      "playwright/smoke.ts",
      "test/fixtures/data.json",
      "src/__snapshots__/a.test.ts.snap",
      "tests/conftest.py",
      "vitestSetup.ts",
      "t/basic.t",
      "packages/vite/src/node/__tests_dts__/config.ts",
    ]) {
      expect([p, detect(p, "x").category]).toEqual([p, "test"]);
    }
    expect(detect("src/latest.ts", "x").category).toBe("code");
    expect(detect("src/contest.py", "x").category).toBe("code");
  });

  test("prose is docs whatever its name says, unless a test directory holds it", () => {
    expect(detect("docs/tutorial/tests.rst", "Test Coverage\n=============\n").category).toBe("docs");
    expect(detect("docs/tests.md", "# Tests\n").category).toBe("docs");
    expect(detect("spec/protocol.md", "# Protocol\n").category).toBe("docs");
    expect(detect("spec/fixtures/sample.md", "# Fixture\n").category).toBe("test");
    expect(detect("tests/data/input.txt", "hello\n").category).toBe("test");
    expect(detect("src/__tests__/notes.md", "# Notes\n").category).toBe("test");
  });

  test("docs", () => {
    expect(detect("docs/guide.md", "# Guide").category).toBe("docs");
    expect(detect("docs/index.html", "<html>").category).toBe("docs");
    expect(detect("CHANGELOG.md", "# 1.0").category).toBe("docs");
    expect(detect("CONTRIBUTING.md", "hi").category).toBe("docs");
    expect(detect("LICENSE-MIT", "MIT").category).toBe("docs");
    expect(detect("docs/conf.py", "x = 1").category).toBe("code");
    expect(detect("install.sh", "#!/bin/sh").category).toBe("code");
  });

  test("config", () => {
    for (const p of [
      "vite.config.ts",
      "tailwind.config.js",
      "eslint.config.mjs",
      ".prettierrc",
      ".eslintrc.cjs",
      ".editorconfig",
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "setup.cfg",
      "renovate.json",
      ".npmrc",
      ".env.example",
      "docs/.vitepress/config.ts",
      ".claude/settings.json",
      // Tool configs named for the tool alone, and the .conf / -config / _rc spellings.
      "typos.toml",
      "_typos.toml",
      "typedoc.json",
      "fta.json",
      "angular.json",
      "nodemon.json",
      "mkdocs.yml",
      "lefthook.yml",
      "packages/create-vite/template-react/_oxlintrc.json",
      "karma.conf.js",
      "wdio.conf.ts",
      "gatsby-config.js",
      "playground/worker/worker-sourcemap-config.js",
      // Data under a config/ directory configures the application.
      "config/database.yml",
      "config/settings.toml",
      "apps/game/public/robots.txt",
    ]) {
      expect([p, detect(p, "{}").category]).toEqual([p, "config"]);
    }
    // An application's own config module is code it imports.
    expect(detect("src/auth-config.ts", "export const auth = {};").category).toBe("code");
  });

  test("build", () => {
    for (const p of [".github/workflows/ci.yml", ".gitlab-ci.yml", "Jenkinsfile", "justfile", "Taskfile.yml", "main.tf", "flake.nix", "BUILD.bazel", "defs.bzl", "build.gradle.kts", "docker-compose.yml", "compose.yaml", "Procfile", "build.rs"]) {
      expect([p, detect(p, "x").category]).toEqual([p, "build"]);
    }
  });

  test("Kubernetes and Helm manifests are build (IaC); a kubeconfig is config", () => {
    expect(detect("k8s/deployment.yaml", "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n").category).toBe("build");
    expect(detect("deploy/all.yaml", "# web\n---\napiVersion: v1\nkind: Service\n").category).toBe("build");
    expect(detect("charts/web/Chart.yaml", "name: web\nversion: 0.1.0\n").category).toBe("build");
    expect(detect("charts/web/values.yaml", "replicaCount: 1\n").category).toBe("build");
    expect(detect("deploy/cluster.yaml", "apiVersion: v1\nkind: Config\nclusters: []\n").category).toBe("config");
    // Plain YAML stays data: a root values.yaml could belong to anything.
    expect(detect("values.yaml", "replicaCount: 1\n").category).toBe("data");
    expect(detect("data/kinds.yaml", "kind: fruit\n").category).toBe("data");
  });

  test("stylesheets are style inside docs and examples trees too", () => {
    for (const p of ["examples/ejs/public/stylesheets/style.css", "docs/.vitepress/theme/styles.css", "docs/theme/custom.scss"]) {
      expect([p, detect(p, "body { color: red }").category]).toEqual([p, "style"]);
    }
    expect(detect("docs/index.html", "<html>").category).toBe("docs");
  });

  test("lockfiles are lockfiles, and generated whatever their header says", () => {
    for (const p of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "Cargo.lock", "poetry.lock", "Pipfile.lock", "uv.lock", "Gemfile.lock", "composer.lock", "go.sum", "flake.lock", "mix.lock", "pubspec.lock", "Podfile.lock", "packages.lock.json", "gradle.lockfile", "Manifest-v1.12.toml", "JuliaManifest-v1.12.toml"]) {
      const d = detect(p, "x");
      expect([p, d.category, d.generated]).toEqual([p, "lockfile", true]);
    }
    expect(detectFile("bun.lockb", bytes(0x23, 0x21, 0, 1, 2)).generated).toBe(true);
  });

  test("notebooks, markup, style, data, images", () => {
    expect(detect("a.ipynb", '{"cells": []}').category).toBe("notebook");
    expect(detect("a.Rmd", "---\ntitle: x\n---").category).toBe("notebook");
    expect(detect("a.qmd", "---\ntitle: x\n---").category).toBe("notebook");
    expect(detect("src/page.html", "<div></div>").category).toBe("markup");
    expect(detect("src/App.vue", "<template></template>").category).toBe("code");
    expect(detect("src/a.scss", "a { b: c }").category).toBe("style");
    expect(detect("data/a.csv", "a,b\n1,2").category).toBe("data");
    expect(detect("data/a.yaml", "a: 1").category).toBe("data");
    expect(detect("logo.svg", "<svg></svg>").category).toBe("image");
  });
});

// ─── detectFile: flags ───────────────────────────────────────────────────────────────────────

describe("detectFile flags", () => {
  test("secrets", () => {
    for (const p of [
      ".env",
      ".env.local",
      ".env.production",
      "certs/server.pem",
      "server.key",
      "store.p12",
      "release.jks",
      "id_rsa",
      "id_ed25519",
      ".htpasswd",
      "credentials.json",
      "service-account-prod.json",
      "config/secrets.yml",
      // Wrangler's local secrets, Terraform state and variables, kubeconfigs.
      ".dev.vars",
      ".dev.vars.staging",
      "infra/terraform.tfstate",
      "infra/terraform.tfstate.backup",
      "terraform.tfstate.d/prod/terraform.tfstate",
      "infra/prod.tfvars",
      "infra/prod.auto.tfvars",
      "infra/prod.tfvars.json",
      "deploy/kubeconfig",
      "deploy/staging.kubeconfig",
      "home/.kube/config",
    ]) {
      expect([p, detect(p, "x").secret]).toEqual([p, true]);
    }
    for (const p of [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.local.example", ".dev.vars.example", "infra/prod.tfvars.example", "id_rsa.pub", "src/env.ts", "keys.ts"]) {
      expect([p, detect(p, "x").secret]).toEqual([p, false]);
    }
    expect(detect("notes.txt", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc").secret).toBe(true);
    expect(detect("notes.txt", "-----BEGIN PUBLIC KEY-----\nabc").secret).toBe(false);
    expect(detect("deploy/cluster.yaml", "users:\n- name: ci\n  user:\n    client-key-data: LS0tLS1CRUdJTg==\n").secret).toBe(true);
    // A file named for an Object.prototype member must not find it in a lookup table.
    expect(detect("constructor", "x").secret).toBe(false);
  });

  test("tool configs are secret only when they hold a credential", () => {
    // Express's .npmrc: settings only, which raised a false credentials warning.
    expect(detect(".npmrc", "package-lock=false\nmin-release-age=7\nignore-scripts=true\n").secret).toBe(false);
    expect(detect(".npmrc", "//registry.npmjs.org/:_authToken=npm_abc123\n").secret).toBe(true);
    expect(detect(".npmrc", "_auth = dXNlcjpwYXNz\n").secret).toBe(true);
    // Referencing the environment is the documented way to commit one.
    expect(detect(".npmrc", "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n").secret).toBe(false);
    expect(detect(".pypirc", "[distutils]\nindex-servers = pypi\n").secret).toBe(false);
    expect(detect(".pypirc", "[pypi]\nusername = __token__\npassword = pypi-AgEIcHlwaS5vcmc\n").secret).toBe(true);
    expect(detect(".netrc", "machine api.example.com login jon password hunter2\n").secret).toBe(true);
    expect(detect(".netrc", "machine api.example.com login jon\n").secret).toBe(false);
    expect(detect(".envrc", "export JAVA_HOME=/usr/lib/jvm\nexport AUTHOR=jon\n").secret).toBe(false);
    expect(detect(".envrc", "export GITHUB_TOKEN=ghp_abc123\n").secret).toBe(true);
    expect(detect(".envrc", 'export DATABASE_URL="postgres://app:s3cret@db/app"\n').secret).toBe(true);
    expect(detect(".envrc", "export GITHUB_TOKEN=$(gh auth token)\n").secret).toBe(false);
  });

  test("key and certificate files", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    expect(detect("certs/ca.pem", cert).secret).toBe(false);
    expect(detect("certs/combined.pem", `${cert}-----BEGIN RSA PRIVATE KEY-----\nMIIE\n`).secret).toBe(true);
    // Raw key material has no armor (Rails' master.key is 32 hex digits).
    expect(detect("config/master.key", "0123456789abcdef0123456789abcdef\n").secret).toBe(true);
    // A truncated head could hide a key behind its certificates.
    const long = new Uint8Array(8192).fill(0x41);
    long.set(text(cert));
    expect(detectFile("certs/bundle.pem", long).secret).toBe(true);
    // A Keynote deck is a ZIP named .key; DER key material is not.
    const zip = padded([...text("PK"), 3, 4, 0x14, 0]);
    expect(detectFile("slides/talk.key", zip)).toMatchObject({ secret: false, format: "Keynote", category: "docs" });
    expect(detectFile("certs/server.key", padded([0x30, 0x82, 0x04, 0xa4, 0x02, 0x01, 0x00]))).toMatchObject({ secret: true });
  });

  test("secret files still get a language and category", () => {
    expect(detect(".env", "A=1")).toMatchObject({ language: "dotenv", category: "config", secret: true });
  });

  test("generated by name and by header", () => {
    for (const p of ["dist/app.min.js", "a.js.map", "api.pb.go", "api_pb2.py", "schema.generated.ts", "model.g.dart", "Form1.Designer.cs", "src/__generated__/q.graphql.ts"]) {
      expect([p, detect(p, "x").generated]).toEqual([p, true]);
    }
    expect(detect("x.go", "// Code generated by protoc-gen-go. DO NOT EDIT.\npackage x").generated).toBe(true);
    expect(detect("x.js", "/**\n * @generated\n */\nexport {}").generated).toBe(true);
    expect(detect("x.ts", "// Please do not edit below this line by hand\nexport {}").generated).toBe(false);
    expect(detect("x.ts", "export const a = 1;").generated).toBe(false);
    expect(detect("bundle.js", `${"var a=1;".repeat(400)}\n`).generated).toBe(true);
    expect(detect("vendor.js", "var a=1;".repeat(1024)).generated).toBe(true); // 8 KiB, no newline
  });

  test("a generator's signature alone marks a file generated", () => {
    for (const [p, head] of [
      // inertialref's 16,250-line type file, the largest "code" file in its report.
      ["apps/server/.cloudflare/types/index.d.ts", "/* eslint-disable */\n// Generated by @cloudflare/config\ntype C = 1;\n"],
      ["worker-configuration.d.ts", "// Generated by Wrangler by running `wrangler types`\n\ninterface Env {}\n"],
      ["src/Parser.java", "// This is a generated file. Not intended for manual editing.\npackage x;\n"],
      ["src/Lexer.java", "/* The following code was generated by JFlex 1.4.3 on 28/01/16 11:27 */\n\npackage x;\n"],
      ["out/main.py", "# Generated by Haxe 4.0.5\n# coding: utf-8\nimport sys\n"],
      ["requirements.txt", "#\n# This file is autogenerated by pip-compile with Python 3.11\n# by the following command:\n"],
      ["man/ls.html", "<!DOCTYPE html>\n<html>\n<!-- This is an automatically generated file.  Do not edit.\n"],
      ["lib/classes.js", "// Generated by CoffeeScript 1.2.1\n(function() {\n"],
    ]) {
      expect([p, detect(p!, head!).generated]).toEqual([p, true]);
    }
    for (const [p, head] of [
      ["src/a.ts", "// Generated by hand, carefully.\nexport {}\n"],
      ["src/b.ts", "// The ids below are generated by the server.\nexport {}\n"],
      ["settings.gradle.kts", "/*\n * This file was generated by the Gradle 'init' task.\n */\nrootProject.name = \"x\"\n"],
      ["src/c.ts", "export const a = 1;\n\n\n// Generated by X\n"], // past the opening lines
      ["README.md", "# Tool\n\nCode generated by this tool is fast.\n"],
    ]) {
      expect([p, detect(p!, head!).generated]).toEqual([p, false]);
    }
  });

  test("linguist's generated.rb rules for formats with a fixed stamp", () => {
    const cases: [string, string][] = [
      ["Assets/Scripts/Player.cs.meta", "fileFormatVersion: 2\nguid: 0123\n"],
      ["project/GMS2_Project.yyp", '{\n  "resources": [],\n  "name": "x"\n}\n'],
      ["db/metrics.frm", "TYPE=VIEW\nquery=select 1\n"],
      ["out/app.map", '/** Begin line maps. **/{ "file":"out.js", "count": 2 }\n'],
      ["fonts/lambda.pfa", "%!PS-AdobeFont-1.0: Lambda 020.017\n%%Creator: FontForge 20170719\n"],
      ["c/image.c", "/* GIMP RGB C-Source image dump (image.c) */\n\nstatic const struct {\n"],
      ["c/ppport.h", "#if 0\n<<'SKIP';\n#endif\n/*\n----\n\n ppport.h -- Perl/Pollution/Portability\n\n Automatically created by Devel::PPPort running under perl 5.0\n"],
      ["Features/Binding.feature.cs", "namespace X {}\n"],
      [".pnp.mjs", "export {}\n"],
      ["Godeps/Godeps.json", "{}\n"],
      ["docs/makeinfo.html", '<html lang="en">\n<head>\n<meta name="generator" content="makeinfo 4.8">\n'],
      ["docs/org.html", "<!DOCTYPE html>\n<html>\n<head>\n<META   NAME= 'GENERATOR' \tCONTENT  \t= \t 'ORG MODE'>\n"],
      ["docs/ronn.html", '<!DOCTYPE html>\n<html>\n<meta name="generator" value="Ronn/v0.7.3 (http://github.com/rtomayko/ronn)" />\n'],
      ["docs/api.html", "<html>\n<head>\n<!-- Generated by Doxygen 1.8.17 -->\n"],
    ];
    for (const [p, head] of cases) expect([p, detect(p, head).generated]).toEqual([p, true]);
    expect(detect("docs/hand.html", '<html>\n<meta name="generator" content="Some sick tool nobody uses">\n').generated).toBe(false);
    expect(detect("src/parser.yy", "%{\n#include <stdio.h>\n%}\n%%\n").generated).toBe(false);
    expect(detect("Assets/Readme.txt.meta", "just notes\n").generated).toBe(false);
  });

  test("vendored by linguist's patterns, minus the ones Skyplate reads differently", () => {
    expect(detect("node_modules/react/index.js", "x").vendored).toBe(true);
    expect(detect("vendor/github.com/x/y.go", "x").vendored).toBe(true);
    expect(detect("third_party/zlib/zlib.h", "x").vendored).toBe(true);
    expect(detect("public/js/jquery-3.7.1.min.js", "x").vendored).toBe(true);
    expect(detect(".github/workflows/ci.yml", "x").vendored).toBe(false);
    expect(detect("types/global.d.ts", "x").vendored).toBe(false);
    expect(detect("src/cache/index.ts", "x").vendored).toBe(false);
  });

  test("CocoaPods' Pods/ is vendored, as node_modules is", () => {
    expect(detect("ios/Pods/Alamofire/Source/Session.swift", "import Foundation\n").vendored).toBe(true);
    expect(detect("Pods/Target Support Files/Pods-App/Pods-App-umbrella.h", "#import <UIKit/UIKit.h>\n").vendored).toBe(true);
    expect(detect("src/pods/list.ts", "export {}\n").vendored).toBe(false); // Kubernetes pods, say
  });
});

// ─── Linguist samples (opt-in) ───────────────────────────────────────────────────────────────

const SAMPLES = process.env.LINGUIST_SAMPLES;

describe.skipIf(!SAMPLES || !existsSync(SAMPLES))("linguist samples accuracy", () => {
  test("detects the folder language for at least 95% of samples", () => {
    const root = SAMPLES!;
    const fsName: Record<string, string> = { Fstar: "f*", ProC: "pro*c" };
    const buf = new Uint8Array(8192);
    let total = 0;
    let ok = 0;
    const walk = (dir: string, rel: string, want: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), r, want);
        else if (e.isFile()) {
          const fd = openSync(join(dir, e.name), "r");
          const n = readSync(fd, buf, 0, 8192, 0);
          closeSync(fd);
          total++;
          if (detectFile(r, buf.slice(0, n)).language === want) ok++;
        }
      }
    };
    for (const lang of readdirSync(root)) walk(join(root, lang), "", fsName[lang] ?? toLanguageId(lang));
    expect(total).toBeGreaterThan(1000);
    expect(ok / total).toBeGreaterThan(0.95);
  });
});
