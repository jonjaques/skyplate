import { describe, expect, test } from "bun:test";
import { expandUseTree, extractImports, importedNames } from "../src/core/imports/extract";
import { createResolver } from "../src/core/imports/resolve";
import type { RawImport } from "../src/core/contracts";

const specs = (text: string, lang: string, path = "x") => extractImports(path, text, lang).map((i) => `${i.line}:${i.kind}:${i.spec}`);

// ─── Extraction ──────────────────────────────────────────────────────────────────────────────

describe("extractImports", () => {
  test("JavaScript / TypeScript forms, skipping strings and comments", () => {
    const ts = [
      'import a from "./a";',
      "import type { B } from './b.js';",
      "import {",
      "  c,",
      "  d as e,",
      "} from '@scope/pkg/sub';",
      'import "./side-effect.css";',
      'export * from "./re";',
      "export { f } from './f';",
      'const g = await import("./lazy");',
      "const h = require('node:fs');",
      'import i = require("legacy");',
      '/// <reference path="./globals.d.ts" />',
      '// import nope from "commented";',
      'const s = "import nope from \'in-string\'";',
      "const t = `require('in-template')`;",
      "obj.require('not-a-require');",
    ].join("\n");
    expect(specs(ts, "typescript")).toEqual([
      "0:import:./a",
      "1:import:./b.js",
      "2:import:@scope/pkg/sub",
      "6:import:./side-effect.css",
      "7:import:./re",
      "8:import:./f",
      "9:import:./lazy",
      "10:require:node:fs",
      "11:require:legacy",
      "12:reference:./globals.d.ts",
    ]);
  });

  test("bindings and module names may be any Unicode identifier", () => {
    const ts = ['import { café } from "./x";', 'import { π, τ } from "./math";', 'import naïve from "./n";', 'import * as ü from "./y";', 'export { ñ } from "./z";'].join("\n");
    expect(specs(ts, "typescript")).toEqual(["0:import:./x", "1:import:./math", "2:import:./n", "3:import:./y", "4:import:./z"]);
    expect(specs("from .café import x\nimport naïve, ok\nfrom . import (été,)\n", "python")).toEqual(["0:import:.café", "1:import:naïve", "1:import:ok", "2:import:.été"]);
  });

  test("new URL(relative, import.meta.url) references the file it loads", () => {
    const ts = [
      "const worker = new Worker(new URL('../workers/universe.worker.ts', import.meta.url), { type: 'module' });",
      'const asset = new URL("./logo.svg", import.meta.url);',
      'const remote = new URL("https://example.com/x.js", import.meta.url);', // not a file here
      'const page = new URL("./page.html", location.href);', //                  not the module's
      '// new URL("./commented.ts", import.meta.url)',
    ].join("\n");
    expect(specs(ts, "typescript")).toEqual(["0:reference:../workers/universe.worker.ts", "1:reference:./logo.svg"]);
  });

  test("type-only imports are flagged; `type` as a binding name is not", () => {
    const ts = [
      'import type { A } from "./a";',
      'import type * as ns from "./ns";',
      'import { type C, type D as E } from "./c";',
      'export type { X } from "./x";',
      'export { type Y } from "./y";',
      'export type * from "./w";',
      'import type from "./default-named-type";', // a default import called `type`
      'import { type F, g } from "./mixed";',
      'import H, { type I } from "./h";',
      'import { type } from "./t";',
      'import type { J } from "./j"; import { k } from "./j";', // one runtime import makes the edge runtime
    ].join("\n");
    const flagged = extractImports("x.ts", ts, "typescript").map((i) => `${i.spec}${i.typeOnly ? " (type)" : ""}`);
    expect(flagged).toEqual(["./a (type)", "./ns (type)", "./c (type)", "./x (type)", "./y (type)", "./w (type)", "./default-named-type", "./mixed", "./h", "./t", "./j"]);
  });

  test("Vue / Svelte script and style blocks, HTML references", () => {
    const vue = [
      "<template>",
      '  <img src="./logo.png" :src="bound">',
      "</template>",
      '<script setup lang="ts">',
      "import Child from './Child.vue'",
      "</script>",
      '<style lang="scss">',
      '@use "./vars";',
      ".a { background: url(./bg.png) }",
      "</style>",
    ].join("\n");
    expect(specs(vue, "vue")).toEqual(["1:link:./logo.png", "4:import:./Child.vue", "7:import:./vars", "8:link:./bg.png"]);
    const html = '<link rel="stylesheet" href="/style.css"><script type="module" src="/src/main.ts"></script><a href="https://x">x</a>';
    expect(specs(html, "html")).toEqual(["0:link:/style.css", "0:link:/src/main.ts"]);
  });

  test("scripts the compiler never reads carry the names they import; TypeScript files do not", () => {
    const vue = [
      "<script setup lang=\"ts\">",
      "import Child from './Child.vue'",
      "import { useSponsor, type Plan as P } from '../composables/sponsor'",
      "import * as all from './all'",
      "import Def, { a } from './mixed'",
      "import './side.css'",
      "</script>",
    ].join("\n");
    const names = (text: string, lang: string) => extractImports("x", text, lang).map((i) => `${i.spec} ${JSON.stringify(i.names)}`);
    expect(names(vue, "vue")).toEqual([
      './Child.vue ["default"]',
      '../composables/sponsor ["useSponsor","Plan"]',
      './all ["*"]',
      './mixed ["default","a"]',
      "./side.css []",
    ]);
    // The checker sees every use made from TypeScript itself; nothing to carry.
    expect(extractImports("x.ts", "import { a } from './a';\n", "typescript")[0]!.names).toBeUndefined();
  });

  test("importedNames reads every clause shape, as the module exports the names", () => {
    expect(importedNames("")).toEqual([]);
    expect(importedNames("X")).toEqual(["default"]);
    expect(importedNames("X, * as ns")).toEqual(["default", "*"]);
    expect(importedNames("{ a, b as c, default as D }")).toEqual(["a", "b", "default"]);
    expect(importedNames("{ type T, type, type as t }")).toEqual(["T", "type", "type"]);
    expect(importedNames("* as ns ")).toEqual(["*"]);
  });

  test("VitePress Markdown: <script setup> imports are read; fenced and inline samples are not", () => {
    const md = [
      "---",
      "title: Acknowledgements",
      "---",
      "",
      "<script setup>",
      "import { computed } from 'vue'",
      "import { useSponsor } from './.vitepress/theme/composables/sponsor'",
      "// import { commented } from './nope'",
      "const label = \"import { inString } from './nope'\"",
      "</script>",
      "",
      "Use a `<script type=\"module\">` tag, as in:",
      "",
      "```vue",
      "<script setup>",
      "import { fromSample } from './sample'",
      "</script>",
      "```",
      "",
      "[guide](./guide.md)",
    ].join("\n");
    const out = extractImports("docs/acknowledgements.md", md, "markdown").map((i) => `${i.line}:${i.kind}:${i.spec} ${JSON.stringify(i.names ?? null)}`);
    expect(out).toEqual(['5:import:vue ["computed"]', '6:import:./.vitepress/theme/composables/sponsor ["useSponsor"]', "19:link:./guide.md null"]);
  });

  test("MDX: multi-line imports carry their names, and imports inside fences are samples", () => {
    const mdx = ["import {", "  Chart,", "  Legend as L,", "} from './chart'", "import Note from './Note'", "", "```js", "import { notReal } from './x'", "```", "", "<Chart />"].join("\n");
    const out = extractImports("p.mdx", mdx, "mdx").map((i) => `${i.line}:${i.spec} ${JSON.stringify(i.names)}`);
    expect(out).toEqual(['0:./chart ["Chart","Legend"]', '4:./Note ["default"]']);
  });

  test("CSS @import lists, url() assets and remote URLs", () => {
    const css = '@import "a.css", url("b.css");\n@import url(c.css);\n.x { background: url(\'img/x.png\'), url(data:image/png;base64,AA), url(https://x/y.png); }\n';
    expect(specs(css, "css")).toEqual(["0:import:a.css", "0:import:b.css", "1:import:c.css", "2:link:img/x.png"]);
  });

  test("Markdown relative links and images, not code or absolute URLs", () => {
    const md = ["[a](./a.md) ![img](img/x.png 'title') [abs](https://x.dev) [anchor](#top)", "```", "[no](./code.md)", "```", "`[no](./inline.md)`", "[ref]: ../b.md#section", '<img src="docs/logo.svg">'].join("\n");
    expect(specs(md, "markdown")).toEqual(["0:link:./a.md", "0:link:img/x.png", "5:link:../b.md", "6:link:docs/logo.svg"]);
  });

  test("Python absolute, relative and parenthesized imports", () => {
    const py = ["import os, a.b as c", "from . import (views,", "    models)", "from ..pkg.mod import thing", "from __future__ import annotations", 's = "import nope"', "    import late"].join("\n");
    expect(specs(py, "python")).toEqual(["0:import:os", "0:import:a.b", "1:import:.views", "1:import:.models", "3:import:..pkg.mod", "4:import:__future__", "6:import:late"]);
  });

  test("Go single and grouped imports", () => {
    const go = 'package x\nimport "fmt"\nimport (\n\t"os"\n\tu "github.com/x/y/util"\n\t_ "embed"\n)\n';
    expect(specs(go, "go")).toEqual(["1:import:fmt", "3:import:os", "4:import:github.com/x/y/util", "5:import:embed"]);
  });

  test("Rust mod, use trees, extern crate, and super inside inline test modules", () => {
    const rs = ["mod a;", "pub(crate) mod b;", "mod inline { }", "use crate::a::{X, y::Z};", "use std::io;", "extern crate serde;", "#[cfg(test)]", "mod tests {", "    use super::*;", "}"].join("\n");
    expect(specs(rs, "rust")).toEqual(["0:include:a", "1:include:b", "3:import:crate::a::X", "3:import:crate::a::y::Z", "4:import:std::io", "5:import:serde", "8:import:self"]);
    expect(expandUseTree("a::{self, b::{c, d as e}, f::*}")).toEqual(["a", "a::b::c", "a::b::d", "a::f"]);
  });

  test("JVM, C family, C#, and scripting languages", () => {
    expect(specs("import java.util.List;\nimport static a.B.m;\nimport a.b.*;", "java")).toEqual(["0:import:java.util.List", "1:import:a.B.m", "2:import:a.b.*"]);
    expect(specs("import a.b.{C, D => E}", "scala")).toEqual(["0:import:a.b.C", "0:import:a.b.D"]);
    expect(specs('#include "x.h"\n#include <stdio.h>\n// #include "no.h"', "c")).toEqual(["0:include:x.h", "1:include:<stdio.h>"]);
    expect(specs("using System.Text;\nusing static A.B;\nusing (var x = y) {}", "c#")).toEqual(["0:import:System.Text", "1:import:A.B"]);
    expect(specs("require 'json'\nrequire_relative 'lib/x'", "ruby")).toEqual(["0:require:json", "1:require:./lib/x"]);
    expect(specs("<?php\nrequire_once __DIR__ . '/x.php';\nuse App\\Models\\{User, Post};", "php")).toEqual(["1:require:./x.php", "2:import:App\\Models\\User", "2:import:App\\Models\\Post"]);
    expect(specs('source ./lib.sh\n. "$DIR/common.sh"\necho source not', "shell")).toEqual(["0:include:./lib.sh", "1:include:common.sh"]);
    expect(specs("FROM node:20 AS build\nFROM build\nFROM scratch", "dockerfile")).toEqual(["0:reference:node:20"]);
    expect(specs('local x = require("a.b")\nrequire "c"', "lua")).toEqual(["0:require:a.b", "1:require:c"]);
    expect(specs('module "vpc" {\n  source = "./modules/vpc"\n}', "hcl")).toEqual(["1:reference:./modules/vpc"]);
    expect(specs("{ imports = [ ./a.nix ]; x = import ./b.nix; }", "nix")).toEqual(["0:reference:./a.nix", "0:import:./b.nix"]);
  });
});

// ─── Resolution ──────────────────────────────────────────────────────────────────────────────

/** An in-memory repository; `r` resolves and renders the result as a path or `eco:name`. */
function repo(files: Record<string, string>) {
  const paths = Object.keys(files).sort();
  const resolve = createResolver({ root: "/repo", paths, manifests: [], readText: (p) => files[p] });
  return (from: string, spec: string, lang: string, kind: RawImport["kind"] = "import") => {
    const id = paths.indexOf(from);
    if (id < 0) throw new Error(`no such file ${from}`);
    const res = resolve(id, { spec, kind, line: 0 }, lang);
    if ("file" in res) return paths[res.file];
    if ("external" in res) return `${res.external.ecosystem}:${res.external.name}`;
    return null;
  };
}

describe("createResolver: JavaScript / TypeScript", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "root", private: true, imports: { "#internal/*": "./src/internal/*.ts" } }),
    "tsconfig.json": '{\n  // comments and trailing commas are fine\n  "extends": "./tsconfig.base.json",\n}',
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"], "~utils": ["src/util/index.ts"] } } }),
    "src/main.ts": "",
    "src/a.ts": "",
    "src/dir/index.tsx": "",
    "src/util/index.ts": "",
    "src/internal/secret.ts": "",
    "src/styles.css": "",
    "packages/lib/package.json": JSON.stringify({ name: "@acme/lib", exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" }, "./feature/*": "./dist/feature/*.js" } }),
    "packages/lib/src/index.ts": "",
    "packages/lib/src/feature/x.ts": "",
    "packages/plain/package.json": JSON.stringify({ name: "plain", main: "lib/index.js" }),
    "packages/plain/src/index.js": "",
  });

  test("relative paths with extension probing, ESM .js → .ts, and directory indexes", () => {
    expect(r("src/main.ts", "./a", "typescript")).toBe("src/a.ts");
    expect(r("src/main.ts", "./a.js", "typescript")).toBe("src/a.ts");
    expect(r("src/main.ts", "./dir", "typescript")).toBe("src/dir/index.tsx");
    expect(r("src/main.ts", "./styles.css?inline", "typescript")).toBe("src/styles.css");
    expect(r("src/main.ts", "./missing", "typescript")).toBeNull();
  });

  test("tsconfig paths and baseUrl through an extends chain", () => {
    expect(r("src/main.ts", "@/a", "typescript")).toBe("src/a.ts");
    expect(r("src/main.ts", "~utils", "typescript")).toBe("src/util/index.ts");
    expect(r("src/main.ts", "src/a", "typescript")).toBe("src/a.ts"); // baseUrl
  });

  test("package.json imports (#private)", () => {
    expect(r("src/main.ts", "#internal/secret", "typescript")).toBe("src/internal/secret.ts");
  });

  test("workspace packages map published entry points back to source", () => {
    expect(r("src/main.ts", "@acme/lib", "typescript")).toBe("packages/lib/src/index.ts");
    expect(r("src/main.ts", "@acme/lib/feature/x", "typescript")).toBe("packages/lib/src/feature/x.ts");
    expect(r("src/main.ts", "plain", "typescript")).toBe("packages/plain/src/index.js");
  });

  test("builtins, npm packages and unknown aliases", () => {
    expect(r("src/main.ts", "node:fs/promises", "typescript")).toBe("node:fs");
    expect(r("src/main.ts", "path", "typescript")).toBe("node:path");
    expect(r("src/main.ts", "@scope/pkg/deep/path", "typescript")).toBe("npm:@scope/pkg");
    expect(r("src/main.ts", "react-dom/client", "typescript")).toBe("npm:react-dom");
    expect(r("src/main.ts", "~/not-configured", "typescript")).toBeNull();
  });

  test("Node's builtins, not the host runtime's: Bun's extras are packages", () => {
    expect(r("src/main.ts", "ws", "typescript")).toBe("npm:ws");
    expect(r("src/main.ts", "undici", "typescript")).toBe("npm:undici");
    expect(r("src/main.ts", "bun", "typescript")).toBe("bun:bun");
    // Prefix-only builtins: the bare names are ordinary packages.
    expect(r("src/main.ts", "test", "typescript")).toBe("npm:test");
    expect(r("src/main.ts", "sqlite", "typescript")).toBe("npm:sqlite");
    expect(r("src/main.ts", "node:test", "typescript")).toBe("node:test");
  });

  test("schemes and names npm could never publish are not npm packages", () => {
    expect(r("src/main.ts", "data:text/javascript, export default 'hi'", "typescript")).toBe("url:data:text/javascript");
    expect(r("src/main.ts", "virtual:my-module", "typescript")).toBe("virtual:virtual:my-module");
    expect(r("src/main.ts", "cloudflare:workers", "typescript")).toBe("cloudflare:cloudflare:workers");
    for (const alias of ["=/nested", "__F_ABSOLUTE_PACKAGE_PATH__", "@virtual-file", ".hidden"]) expect(r("src/main.ts", alias, "typescript")).toBeNull();
    expect(r("src/main.ts", "JSONStream", "typescript")).toBe("npm:JSONStream"); // pre-rule uppercase name
  });
});

describe("createResolver: package imports, tsconfig scope, stylesheets", () => {
  const r = repo({
    "app/package.json": JSON.stringify({ name: "app", imports: { "#star/*": "./star/*", "#imports": "./imports-field.css" } }),
    "app/star/dollar$$.js": "",
    "app/star/a$&b.js": "",
    "app/main.js": "",
    "app/a.css": "",
    "app/imports-field.css": "",
    // A nearer tsconfig whose include leaves __tests__ out does not own those files.
    "web/tsconfig.json": JSON.stringify({ include: ["**/*.ts"], exclude: ["./skipped/**"], compilerOptions: { paths: { "~utils": ["./test-utils.ts"], "@/*": ["./src/*"] } } }),
    "web/test-utils.ts": "",
    "web/src/route$$.ts": "",
    "web/feature/tsconfig.json": JSON.stringify({ include: ["./src"] }),
    "web/feature/src/a.ts": "",
    "web/feature/__tests__/a.spec.ts": "",
    "web/skipped/x.ts": "",
    "web/nested/tsconfig.json": JSON.stringify({ include: [], references: [{ path: "./tsconfig.a.json" }, { path: "./tsconfig.b.json" }] }),
    "web/nested/tsconfig.a.json": JSON.stringify({ include: ["./a.ts"], compilerOptions: { paths: { "@imported": ["./a-imported.ts"] } } }),
    "web/nested/tsconfig.b.json": JSON.stringify({ include: ["./b.ts"], compilerOptions: { paths: { "@imported": ["./b-imported.ts"] } } }),
    "web/nested/a.ts": "",
    "web/nested/b.ts": "",
    "web/nested/a-imported.ts": "",
    "web/nested/b-imported.ts": "",
    "css/stylus.styl": "",
    "css/nested/nested.less": "",
    "css/nested/nested.styl": "",
    "css/sass.scss": "",
    "css/plain.css": "",
    "css/dep/package.json": JSON.stringify({ name: "css-dep", main: "index.js", sass: "index.scss", style: "index.css" }),
    "css/dep/index.js": "",
    "css/dep/index.scss": "",
    "css/dep/index.css": "",
  });

  test("wildcard targets insert the match literally ($$, $& in file names)", () => {
    expect(r("app/main.js", "#star/dollar$$.js", "javascript")).toBe("app/star/dollar$$.js");
    expect(r("app/main.js", "#star/a$&b.js", "javascript")).toBe("app/star/a$&b.js");
    expect(r("web/test-utils.ts", "@/route$$", "typescript")).toBe("web/src/route$$.ts");
  });

  test("CSS @import of a package import (#name) is not a fragment", () => {
    expect(r("app/a.css", "#imports", "css")).toBe("app/imports-field.css");
  });

  test("tsconfig paths come from the config whose include takes the file", () => {
    expect(r("web/feature/__tests__/a.spec.ts", "~utils", "typescript")).toBe("web/test-utils.ts");
    expect(r("web/nested/a.ts", "@imported", "typescript")).toBe("web/nested/a-imported.ts");
    expect(r("web/nested/b.ts", "@imported", "typescript")).toBe("web/nested/b-imported.ts");
    // A file no config takes keeps the nearest directory's aliases: the fallback for importers
    // (`.vue`, `.css`) that an include list written for `.ts` leaves out.
    expect(r("web/skipped/x.ts", "~utils", "typescript")).toBe("web/test-utils.ts");
  });

  test("stylesheets probe their own extension first and use a package's style entry", () => {
    expect(r("css/stylus.styl", "./nested/nested", "stylus")).toBe("css/nested/nested.styl");
    expect(r("css/sass.scss", "css-dep", "scss")).toBe("css/dep/index.scss");
    expect(r("css/plain.css", "css-dep", "css")).toBe("css/dep/index.css");
    expect(r("app/main.js", "css-dep", "javascript")).toBe("css/dep/index.js");
  });
});

describe("createResolver: other ecosystems", () => {
  test("Python: relative dots, package roots under src/, stdlib and PyPI", () => {
    const r = repo({ "src/pkg/__init__.py": "", "src/pkg/app.py": "", "src/pkg/sub/__init__.py": "", "src/pkg/sub/mod.py": "", "tests/test_app.py": "", "tests/helpers.py": "" });
    expect(r("src/pkg/sub/mod.py", "..app", "python")).toBe("src/pkg/app.py");
    expect(r("src/pkg/app.py", ".sub", "python")).toBe("src/pkg/sub/__init__.py");
    expect(r("src/pkg/app.py", ".nothing_named_this", "python")).toBe("src/pkg/__init__.py");
    expect(r("tests/test_app.py", "pkg.sub.mod", "python")).toBe("src/pkg/sub/mod.py");
    expect(r("tests/test_app.py", "helpers", "python")).toBe("tests/helpers.py");
    expect(r("tests/test_app.py", "os.path", "python")).toBe("python-stdlib:os");
    expect(r("tests/test_app.py", "requests.adapters", "python")).toBe("pypi:requests");
  });

  test("Go: module paths from go.mod, stdlib, externals named by require", () => {
    const r = repo({
      "go.mod": "module github.com/me/app\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n)\n",
      "main.go": "",
      "util/util.go": "",
      "util/extra.go": "",
      "util/util_test.go": "",
    });
    expect(r("main.go", "github.com/me/app/util", "go")).toBe("util/util.go");
    expect(r("main.go", "fmt", "go")).toBe("go-stdlib:fmt");
    expect(r("main.go", "github.com/spf13/cobra/doc", "go")).toBe("go:github.com/spf13/cobra");
    const resolve = createResolver({ root: "/", paths: ["go.mod", "main.go", "util/extra.go", "util/util.go", "util/util_test.go"], manifests: [], readText: (p) => (p === "go.mod" ? "module m\n" : "") });
    const res = resolve(1, { spec: "m/util", kind: "import", line: 0 }, "go") as { file: number; also: number[] };
    expect(res.file).toBe(3);
    expect(res.also).toEqual([2]); // the package's other non-test file
  });

  test("Rust: mod files, crate/self/super paths, std and crates", () => {
    const r = repo({
      "Cargo.toml": '[package]\nname = "my-app"\n\n[dependencies]\nserde = "1"\n',
      "src/main.rs": "",
      "src/config.rs": "",
      "src/fmt/mod.rs": "",
      "src/fmt/input.rs": "",
      "src/fmt/output/mod.rs": "",
    });
    expect(r("src/main.rs", "config", "rust", "include")).toBe("src/config.rs");
    expect(r("src/main.rs", "fmt", "rust", "include")).toBe("src/fmt/mod.rs");
    expect(r("src/fmt/mod.rs", "input", "rust", "include")).toBe("src/fmt/input.rs");
    expect(r("src/config.rs", "crate::fmt::input::Token", "rust")).toBe("src/fmt/input.rs");
    expect(r("src/config.rs", "crate::Thing", "rust")).toBe("src/main.rs");
    expect(r("src/fmt/input.rs", "super::output", "rust")).toBe("src/fmt/output/mod.rs");
    expect(r("src/fmt/mod.rs", "self::input::X", "rust")).toBe("src/fmt/input.rs");
    expect(r("src/main.rs", "std::io", "rust")).toBe("rust-stdlib:std");
    expect(r("src/main.rs", "serde::Deserialize", "rust")).toBe("cargo:serde");
  });

  test("Rust: crates by their declared names; undeclared first segments are items in scope", () => {
    const r = repo({
      "Cargo.toml": [
        "[package]",
        'name = "app"',
        "[dependencies]",
        'aho-corasick = "1"',
        'jemalloc = { package = "tikv-jemallocator", version = "0.6" }',
        'shared = { path = "crates/shared-lib" }',
        "[target.'cfg(unix)'.dependencies]",
        'nix = "0.29"',
        "[dev-dependencies]",
        'test-case = "3"',
      ].join("\n"),
      "src/main.rs": "",
      "src/fmt/mod.rs": "",
      "crates/shared-lib/Cargo.toml": '[package]\nname = "shared-lib"\n',
      "crates/shared-lib/src/lib.rs": "",
    });
    // The pipeline merges externals by exact name: these must match the manifest's spelling.
    expect(r("src/main.rs", "aho_corasick::AhoCorasick", "rust")).toBe("cargo:aho-corasick");
    expect(r("src/main.rs", "test_case::test_case", "rust")).toBe("cargo:test-case");
    expect(r("src/main.rs", "jemalloc::Jemalloc", "rust")).toBe("cargo:tikv-jemallocator");
    expect(r("src/main.rs", "nix::unistd", "rust")).toBe("cargo:nix");
    expect(r("src/main.rs", "shared::Thing", "rust")).toBe("crates/shared-lib/src/lib.rs");
    expect(r("src/main.rs", "shared_lib::Thing", "rust")).toBe("crates/shared-lib/src/lib.rs");
    // fd src/fmt/mod.rs: `use Token::*;` names its own enum, not a crate.
    expect(r("src/fmt/mod.rs", "Token", "rust")).toBe("src/fmt/mod.rs");
    expect(r("src/fmt/mod.rs", "helpers::x", "rust")).toBe("src/fmt/mod.rs");
    // No manifest to say what is declared: lowercase names stay crates, types stay local.
    const bare = repo({ "main.rs": "" });
    expect(bare("main.rs", "regex::Regex", "rust")).toBe("cargo:regex");
    expect(bare("main.rs", "Kind", "rust")).toBe("main.rs");
  });

  test("PyPI and gem externals use the names their manifests declare", () => {
    const r = repo({
      "pyproject.toml": '[project]\nname = "app"\ndependencies = ["pallets-sphinx-themes", "Typing_Extensions"]\n',
      "Gemfile": 'source "https://rubygems.org"\ngem "minitest"\n',
      "docs/conf.py": "",
      "test/helper.rb": "",
    });
    expect(r("docs/conf.py", "pallets_sphinx_themes", "python")).toBe("pypi:pallets-sphinx-themes");
    expect(r("docs/conf.py", "typing_extensions", "python")).toBe("pypi:typing-extensions");
    expect(r("docs/conf.py", "yaml", "python")).toBe("pypi:yaml"); // undeclared: as written
    expect(r("test/helper.rb", "minitest/autorun", "ruby")).toBe("gem:minitest");
    expect(r("test/helper.rb", "json", "ruby")).toBe("ruby-stdlib:json");
  });

  test("JVM, C/C++, Ruby, PHP PSR-4, CSS partials", () => {
    const r = repo({
      "src/main/java/com/acme/App.java": "",
      "src/main/java/com/acme/util/Strings.java": "",
      "include/acme/util.h": "",
      "src/util.c": "",
      "src/local.h": "",
      "lib/acme/thing.rb": "",
      "lib/acme.rb": "",
      "composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }),
      "app/Models/User.php": "",
      "styles/main.scss": "",
      "styles/_vars.scss": "",
    });
    expect(r("src/main/java/com/acme/App.java", "com.acme.util.Strings", "java")).toBe("src/main/java/com/acme/util/Strings.java");
    expect(r("src/main/java/com/acme/App.java", "com.acme.util.Strings.join", "java")).toBe("src/main/java/com/acme/util/Strings.java");
    expect(r("src/main/java/com/acme/App.java", "com.acme.util.*", "java")).toBe("src/main/java/com/acme/util/Strings.java");
    expect(r("src/main/java/com/acme/App.java", "java.util.List", "java")).toBe("java-stdlib:java.util");
    expect(r("src/util.c", "local.h", "c")).toBe("src/local.h");
    expect(r("src/util.c", "acme/util.h", "c")).toBe("include/acme/util.h");
    expect(r("src/util.c", "<acme/util.h>", "c")).toBe("include/acme/util.h");
    expect(r("src/util.c", "<stdio.h>", "c")).toBe("system:stdio.h");
    expect(r("lib/acme.rb", "acme/thing", "ruby")).toBe("lib/acme/thing.rb");
    expect(r("lib/acme.rb", "./acme/thing", "ruby")).toBe("lib/acme/thing.rb");
    expect(r("lib/acme.rb", "json", "ruby")).toBe("ruby-stdlib:json");
    expect(r("lib/acme.rb", "rails", "ruby")).toBe("gem:rails");
    expect(r("app/Models/User.php", "App\\Models\\User", "php")).toBe("app/Models/User.php");
    expect(r("styles/main.scss", "vars", "scss")).toBe("styles/_vars.scss");
    expect(r("styles/main.scss", "sass:math", "scss")).toBe("sass:sass");
  });

  test("links: relative, directories, docs-site .html → .md, public/ for root-relative", () => {
    const r = repo({
      "README.md": "",
      "docs/package.json": "{}",
      "docs/guide/intro.md": "",
      "docs/guide/README.md": "",
      "docs/public/logo.svg": "",
      "web/index.html": "",
      "web/package.json": "{}",
      "web/src/main.ts": "",
    });
    expect(r("README.md", "docs/guide/intro.md", "markdown", "link")).toBe("docs/guide/intro.md");
    expect(r("README.md", "docs/guide", "markdown", "link")).toBe("docs/guide/README.md");
    expect(r("docs/guide/intro.md", "/guide/intro.html", "markdown", "link")).toBe("docs/guide/intro.md");
    expect(r("docs/guide/intro.md", "/logo.svg", "markdown", "link")).toBe("docs/public/logo.svg");
    expect(r("web/index.html", "/src/main.ts", "html", "link")).toBe("web/src/main.ts");
  });
});
