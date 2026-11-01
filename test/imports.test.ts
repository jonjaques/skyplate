import { describe, expect, test } from "bun:test";
import { extractImports, expandUseTree } from "../src/core/imports/extract";
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
      "Cargo.toml": '[package]\nname = "my-app"\n',
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
