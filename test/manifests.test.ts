/**
 * readManifests and readProjectInfo over in-memory trees: each test hands the functions a
 * path list and a reader over a Record, the same shape the pipeline passes.
 */

import { describe, expect, test } from "bun:test";
import type { ExternalDependency } from "../src/shared/schema";
import { readManifests, readProjectInfo } from "../src/core/manifests";

const run = (files: Record<string, string>) => readManifests(Object.keys(files), (p) => files[p]);
const info = (files: Record<string, string>) => readProjectInfo(Object.keys(files), (p) => files[p]);
const dep = (deps: ExternalDependency[], name: string, ecosystem?: string) =>
  deps.find((d) => d.name === name && (!ecosystem || d.ecosystem === ecosystem));

// ─── JavaScript ──────────────────────────────────────────────────────────────────────────────

describe("package.json", () => {
  test("sections map to scopes; internal and local packages are dropped", () => {
    const r = run({
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { react: "^19.0.0", "@acme/ui": "workspace:*", local: "file:../local", "string-width-cjs": "npm:string-width@^4.2.0" },
        devDependencies: { typescript: "^5.6.0", "@acme/core": "^1.0.0" },
        peerDependencies: { "react-dom": "^19.0.0", react: "^19.0.0" },
        optionalDependencies: { fsevents: "^2.3.3" },
      }),
      "packages/core/package.json": JSON.stringify({ name: "@acme/core", version: "1.0.0", dependencies: { zod: "^3.23.0" } }),
    });
    expect(r.manifests.map((m) => [m.path, m.kind, m.ecosystem, m.name, m.version])).toEqual([
      ["package.json", "package.json", "npm", "root", "1.0.0"],
      ["packages/core/package.json", "package.json", "npm", "@acme/core", "1.0.0"],
    ]);
    const names = r.dependencies.map((d) => d.name);
    expect(names).toEqual(["fsevents", "react", "react-dom", "string-width", "typescript", "zod"]);
    expect(dep(r.dependencies, "react")).toMatchObject({ scope: "runtime", version: "^19.0.0", importers: 0, declaredIn: ["package.json"] });
    expect(dep(r.dependencies, "react-dom")?.scope).toBe("peer");
    expect(dep(r.dependencies, "fsevents")?.scope).toBe("optional");
    expect(dep(r.dependencies, "typescript")?.scope).toBe("dev");
    expect(dep(r.dependencies, "string-width")?.version).toBe("^4.2.0");
    expect(r.manifests[0]!.dependencies).toBe(5);
  });

  test("pnpm catalogs resolve versions", () => {
    const r = run({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\ncatalog:\n  react: ^19.1.0\ncatalogs:\n  legacy:\n    react: ^18.3.1\n",
      "package.json": JSON.stringify({ dependencies: { react: "catalog:" } }),
      "packages/old/package.json": JSON.stringify({ name: "old", dependencies: { react: "catalog:legacy" } }),
    });
    const react = dep(r.dependencies, "react")!;
    expect(react.version).toBe("^19.1.0"); // the shallowest declaration wins
    expect(react.declaredIn).toEqual(["package.json", "packages/old/package.json"]);
  });

  test("merging keeps the strongest scope", () => {
    const r = run({
      "a/package.json": JSON.stringify({ devDependencies: { lodash: "^4" } }),
      "b/package.json": JSON.stringify({ dependencies: { lodash: "^4.17.21" } }),
    });
    expect(dep(r.dependencies, "lodash")).toMatchObject({ scope: "runtime", declaredIn: ["a/package.json", "b/package.json"] });
  });

  test("installed packages and fixtures are not the project's manifests", () => {
    const r = run({
      "package.json": JSON.stringify({ dependencies: { a: "1" } }),
      "node_modules/a/package.json": JSON.stringify({ name: "a", dependencies: { b: "1" } }),
      "src/__tests__/fixtures/pkg/package.json": JSON.stringify({ dependencies: { fake: "1" } }),
    });
    expect(r.manifests.map((m) => m.path)).toEqual(["package.json"]);
    expect(r.dependencies.map((d) => d.name)).toEqual(["a"]);
  });

  test("malformed manifests are skipped without throwing", () => {
    const r = run({ "package.json": "{ not json", "pkg/package.json": "[]", "ok/package.json": '{"dependencies":{"x":"1"}}' });
    expect(r.manifests.map((m) => m.path)).toEqual(["ok/package.json"]);
  });

  test("deno.json imports", () => {
    const r = run({
      "deno.jsonc": '{ // comment\n "name": "@me/tool", "version": "0.1.0", "imports": { "@std/assert": "jsr:@std/assert@^1.0.0", "chalk": "npm:chalk@5", "x": "https://deno.land/x/y/mod.ts", "~/": "./src/" } }',
    });
    expect(dep(r.dependencies, "@std/assert", "jsr")?.version).toBe("^1.0.0");
    expect(dep(r.dependencies, "chalk", "npm")?.version).toBe("5");
    expect(r.dependencies.length).toBe(2);
  });
});

// ─── Rust, Go ────────────────────────────────────────────────────────────────────────────────

describe("Cargo.toml", () => {
  test("tables, renames, optional, targets, path deps and workspace inheritance", () => {
    const r = run({
      "Cargo.toml": `[workspace]
members = ["crates/*"]
[workspace.package]
version = "0.3.0"
license = "MIT OR Apache-2.0"
[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
`,
      "crates/app/Cargo.toml": `[package]
name = "app"
version.workspace = true
[dependencies]
serde = { workspace = true }
regex = "1.10"
clap_complete = { version = "4", optional = true }
my-lib = { path = "../lib" }
renamed = { package = "real-name", version = "2" }
[dev-dependencies]
insta = "1"
[build-dependencies]
cc = "1.0"
[target.'cfg(unix)'.dependencies]
libc = "0.2"
`,
      "crates/lib/Cargo.toml": `[package]\nname = "my-lib"\nversion = "0.1.0"\n`,
    });
    const deps = r.dependencies;
    expect(dep(deps, "serde")).toMatchObject({ version: "1.0", scope: "runtime" });
    expect(dep(deps, "clap_complete")?.scope).toBe("optional");
    expect(dep(deps, "real-name")?.version).toBe("2");
    expect(dep(deps, "insta")?.scope).toBe("dev");
    expect(dep(deps, "cc")?.scope).toBe("build");
    expect(dep(deps, "libc")?.scope).toBe("runtime");
    expect(dep(deps, "my-lib")).toBeUndefined();
    expect(r.manifests.find((m) => m.path === "crates/app/Cargo.toml")).toMatchObject({ name: "app", version: "0.3.0" });
  });
});

describe("go.mod", () => {
  test("direct requirements only", () => {
    const r = run({
      "go.mod": `module github.com/junegunn/fzf

go 1.23.0

require (
	github.com/gdamore/tcell/v2 v2.9.0
	golang.org/x/sys v0.35.0 // comment
	github.com/mattn/go-runewidth v0.0.16 // indirect
)

require github.com/rivo/uniseg v0.4.7
`,
    });
    expect(r.manifests[0]).toMatchObject({ kind: "go.mod", ecosystem: "go", name: "github.com/junegunn/fzf", dependencies: 3 });
    expect(r.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual([
      "github.com/gdamore/tcell/v2@v2.9.0",
      "github.com/rivo/uniseg@v0.4.7",
      "golang.org/x/sys@v0.35.0",
    ]);
  });
});

// ─── Python ──────────────────────────────────────────────────────────────────────────────────

describe("Python manifests", () => {
  test("pyproject: PEP 621, extras, dependency groups, build system, poetry", () => {
    const r = run({
      "pyproject.toml": `[project]
name = "Flask"
version = "3.2.0"
dependencies = ["Werkzeug>=3.1.0", "click>=8.1.3", "importlib-metadata; python_version < '3.10'"]
[project.optional-dependencies]
async = ["asgiref>=3.2"]
test = ["pytest"]
[dependency-groups]
dev = ["ruff", {include-group = "test"}]
[build-system]
requires = ["flit_core>=3.11,<4"]
`,
      "examples/app/pyproject.toml": `[tool.poetry]
name = "example"
version = "0.1.0"
[tool.poetry.dependencies]
python = "^3.11"
flask = "*"
requests = { version = "^2.32", extras = ["socks"] }
[tool.poetry.group.dev.dependencies]
black = "^24"
`,
    });
    const d = r.dependencies;
    expect(dep(d, "werkzeug")).toMatchObject({ version: ">=3.1.0", scope: "runtime" });
    expect(dep(d, "importlib-metadata")?.version).toBeUndefined();
    expect(dep(d, "asgiref")?.scope).toBe("optional");
    expect(dep(d, "pytest")?.scope).toBe("dev");
    expect(dep(d, "ruff")?.scope).toBe("dev");
    expect(dep(d, "flit-core")).toMatchObject({ scope: "build", version: ">=3.11,<4" });
    expect(dep(d, "requests")?.version).toBe("^2.32");
    expect(dep(d, "black")?.scope).toBe("dev");
    expect(dep(d, "python")).toBeUndefined();
    // "Flask" the project is internal to its own examples.
    expect(dep(d, "flask")).toBeUndefined();
  });

  test("requirements files, Pipfile, setup.cfg", () => {
    const r = run({
      "requirements.txt": "# runtime\nDjango==5.0.1  # pinned\n-r base.txt\n--index-url https://x\ngit+https://github.com/a/b.git\nrequests[security]>=2.0 ; python_version > '3'\n./local\n",
      "requirements/dev.txt": "pytest>=8\n",
      "requirements-lock.txt": "# This file is autogenerated by pip-compile with Python 3.12\nasgiref==3.8.1\n",
      Pipfile: '[packages]\nnumpy = "*"\n[dev-packages]\nmypy = ">=1.0"\n',
      "setup.cfg": "[metadata]\nname = legacy\nversion = attr: legacy.__version__\n[options]\ninstall_requires =\n    six>=1.16\n    attrs\n[options.extras_require]\ntesting = pytest-cov\n",
    });
    const d = r.dependencies;
    expect(dep(d, "django")).toMatchObject({ version: "==5.0.1", scope: "runtime" });
    expect(dep(d, "requests")?.version).toBe(">=2.0");
    expect(dep(d, "pytest")?.scope).toBe("dev");
    expect(dep(d, "asgiref")).toBeUndefined();
    expect(dep(d, "numpy")?.version).toBeUndefined();
    expect(dep(d, "mypy")?.scope).toBe("dev");
    expect(dep(d, "six")?.version).toBe(">=1.16");
    expect(dep(d, "pytest-cov")?.scope).toBe("dev");
    const cfg = r.manifests.find((m) => m.kind === "setup.cfg")!;
    expect(cfg.name).toBe("legacy");
    expect(cfg.version).toBeUndefined();
    expect(r.manifests.map((m) => m.path)).not.toContain("requirements-lock.txt");
  });

  test("conda environment with pip section", () => {
    const r = run({ "environment.yml": "name: ml\ndependencies:\n  - python=3.11\n  - numpy=1.26\n  - conda-forge::pytorch>=2.1\n  - pip\n  - pip:\n    - transformers==4.40.0\n" });
    expect(dep(r.dependencies, "numpy", "conda")?.version).toBe("==1.26");
    expect(dep(r.dependencies, "pytorch", "conda")?.version).toBe(">=2.1");
    expect(dep(r.dependencies, "transformers", "pypi")?.version).toBe("==4.40.0");
    expect(dep(r.dependencies, "python")).toBeUndefined();
  });
});

// ─── Ruby, PHP ───────────────────────────────────────────────────────────────────────────────

describe("Ruby and PHP", () => {
  test("Gemfile groups and modifiers", () => {
    const r = run({
      Gemfile: `source 'https://rubygems.org'
gemspec
gem 'rails', '~> 7.1', '>= 7.1.2'
gem "pg"
gem 'bootsnap', require: false
platforms :jruby do
  gem 'jdbc'
end
group :development, :test do
  gem 'rspec-rails'
  if ENV['CI']
    gem 'simplecov'
  end
end
group :debug do
  gem 'byebug' if RUBY_VERSION >= '2.2'
end
gem 'rubocop', group: :development
`,
    });
    const d = r.dependencies;
    expect(dep(d, "rails")).toMatchObject({ version: "~> 7.1, >= 7.1.2", scope: "runtime" });
    expect(dep(d, "pg")?.scope).toBe("runtime");
    expect(dep(d, "bootsnap")?.scope).toBe("runtime");
    expect(dep(d, "jdbc")?.scope).toBe("runtime");
    expect(dep(d, "rspec-rails")?.scope).toBe("dev");
    expect(dep(d, "simplecov")?.scope).toBe("dev");
    expect(dep(d, "byebug")).toMatchObject({ scope: "dev" });
    expect(dep(d, "byebug")?.version).toBeUndefined();
    expect(dep(d, "rubocop")?.scope).toBe("dev");
  });

  test("gemspec", () => {
    const r = run({
      "linguist.gemspec": `Gem::Specification.new do |s|
  s.name    = 'github-linguist'
  s.version = ENV['GEM_VERSION'] || Linguist::VERSION
  s.license = "MIT"
  s.add_dependency 'charlock_holmes', '~> 0.7.7'
  s.add_runtime_dependency "rugged", ">= 1.0", "< 2"
  s.add_development_dependency 'minitest', '~> 5.15'
end
`,
    });
    expect(r.manifests[0]).toMatchObject({ kind: "gemspec", name: "github-linguist" });
    expect(r.manifests[0]!.version).toBeUndefined();
    expect(dep(r.dependencies, "rugged")?.version).toBe(">= 1.0, < 2");
    expect(dep(r.dependencies, "minitest")?.scope).toBe("dev");
  });

  test("composer.json skips platform requirements", () => {
    const r = run({ "composer.json": JSON.stringify({ name: "acme/app", require: { php: ">=8.2", "ext-json": "*", "laravel/framework": "^11.0" }, "require-dev": { "phpunit/phpunit": "^11" } }) });
    expect(r.dependencies.map((d) => `${d.name}:${d.scope}`)).toEqual(["laravel/framework:runtime", "phpunit/phpunit:dev"]);
  });
});

// ─── JVM, .NET ───────────────────────────────────────────────────────────────────────────────

describe("JVM and .NET", () => {
  test("pom.xml: properties, scopes, managed and plugin dependencies excluded", () => {
    const r = run({
      "pom.xml": `<?xml version="1.0"?>
<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.0</version></parent>
  <groupId>com.acme</groupId>
  <artifactId>app</artifactId>
  <version>1.4.0</version>
  <properties><guava.version>33.0.0-jre</guava.version></properties>
  <dependencyManagement><dependencies><dependency><groupId>x</groupId><artifactId>managed</artifactId><version>1</version></dependency></dependencies></dependencyManagement>
  <dependencies>
    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>\${guava.version}</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
    <!-- <dependency><groupId>old</groupId><artifactId>commented</artifactId></dependency> -->
  </dependencies>
  <build><plugins><plugin><artifactId>maven-shade-plugin</artifactId><dependencies><dependency><groupId>p</groupId><artifactId>plugin-dep</artifactId></dependency></dependencies></plugin></plugins></build>
</project>`,
    });
    expect(r.manifests[0]).toMatchObject({ kind: "pom.xml", name: "com.acme:app", version: "1.4.0" });
    expect(r.dependencies.map((d) => `${d.name}@${d.version ?? ""}:${d.scope}`)).toEqual([
      "com.google.guava:guava@33.0.0-jre:runtime",
      "org.junit.jupiter:junit-jupiter@:dev",
    ]);
  });

  test("Gradle scripts and the version catalog", () => {
    const r = run({
      "app/build.gradle.kts": `plugins { kotlin("jvm") }
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("org.jetbrains.kotlinx:kotlinx-coroutines-bom:1.8.0"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    compileOnly("org.projectlombok:lombok:1.18.30")
    implementation(libs.retrofit)
}`,
      "lib/build.gradle": "dependencies {\n  api 'com.google.guava:guava:33.0.0-jre'\n  runtimeOnly group: 'org.postgresql', name: 'postgresql', version: '42.7.1'\n}",
      "gradle/libs.versions.toml": '[versions]\nretrofit = "2.11.0"\n[libraries]\nretrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }\n',
    });
    const d = r.dependencies;
    expect(dep(d, "com.squareup.okhttp3:okhttp")).toMatchObject({ version: "4.12.0", scope: "runtime" });
    expect(dep(d, "org.jetbrains.kotlinx:kotlinx-coroutines-bom")?.version).toBe("1.8.0");
    expect(dep(d, "org.junit.jupiter:junit-jupiter")?.scope).toBe("dev");
    expect(dep(d, "org.projectlombok:lombok")?.scope).toBe("build");
    expect(dep(d, "org.postgresql:postgresql")?.version).toBe("42.7.1");
    expect(dep(d, "com.squareup.retrofit2:retrofit")?.version).toBe("2.11.0");
  });

  test("csproj with central package management, packages.config", () => {
    const r = run({
      "Directory.Packages.props": '<Project><ItemGroup><PackageVersion Include="Serilog" Version="3.1.1" /></ItemGroup></Project>',
      "src/App/App.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><AssemblyName>Acme.App</AssemblyName></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" />
    <PackageReference Include="StyleCop.Analyzers" Version="1.1.118"><PrivateAssets>all</PrivateAssets></PackageReference>
  </ItemGroup>
</Project>`,
      "legacy/packages.config": '<packages><package id="NUnit" version="3.14.0" developmentDependency="true" /><package id="log4net" version="2.0.15" /></packages>',
    });
    const d = r.dependencies;
    expect(dep(d, "Newtonsoft.Json")?.version).toBe("13.0.3");
    expect(dep(d, "Serilog")?.version).toBe("3.1.1");
    expect(dep(d, "StyleCop.Analyzers")?.scope).toBe("dev");
    expect(dep(d, "NUnit")?.scope).toBe("dev");
    expect(dep(d, "log4net")?.scope).toBe("runtime");
    expect(r.manifests.find((m) => m.path.endsWith("App.csproj"))).toMatchObject({ kind: "csproj", ecosystem: "nuget", name: "Acme.App" });
  });
});

// ─── Dart, Elixir, Swift, vcpkg ──────────────────────────────────────────────────────────────

describe("other ecosystems", () => {
  test("pubspec, mix.exs, Package.swift, vcpkg.json", () => {
    const r = run({
      "pubspec.yaml": "name: app\nversion: 1.2.3\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n  local:\n    path: ../local\ndev_dependencies:\n  lints: ^3.0.0\n",
      "mix.exs": `defmodule App.MixProject do
  use Mix.Project
  def project, do: [app: :app, version: "0.1.0", deps: deps()]
  def handle({:ok, value}), do: value
  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:sibling, in_umbrella: true},
      {:ex_doc, ">= 0.0.0", only: :dev}
    ]
  end
end`,
      "Package.swift": `let package = Package(
  name: "Tool",
  dependencies: [
    .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
    .package(url: "https://github.com/vapor/vapor", .upToNextMajor(from: "4.89.0")),
    .package(path: "../Local"),
  ]
)`,
      "vcpkg.json": JSON.stringify({ name: "engine", "version-string": "0.9", dependencies: ["fmt", { name: "boost-asio", "version>=": "1.83.0" }, { name: "vcpkg-cmake", host: true }] }),
    });
    const d = r.dependencies;
    expect(dep(d, "http", "pub")?.version).toBe("^1.2.0");
    expect(dep(d, "flutter")).toBeUndefined();
    expect(dep(d, "local")).toBeUndefined();
    expect(dep(d, "lints")?.scope).toBe("dev");
    expect(dep(d, "phoenix", "hex")).toMatchObject({ version: "~> 1.7", scope: "runtime" });
    expect(dep(d, "credo")?.scope).toBe("dev");
    expect(dep(d, "ex_doc")?.scope).toBe("dev");
    expect(dep(d, "sibling")).toBeUndefined();
    expect(dep(d, "ok")).toBeUndefined();
    expect(dep(d, "swift-argument-parser", "swiftpm")?.version).toBe("1.3.0");
    expect(dep(d, "vapor")?.version).toBe("4.89.0");
    expect(dep(d, "boost-asio", "vcpkg")?.version).toBe(">=1.83.0");
    expect(dep(d, "vcpkg-cmake")?.scope).toBe("build");
    expect(r.manifests.find((m) => m.kind === "mix.exs")).toMatchObject({ name: "app", version: "0.1.0" });
    expect(r.manifests.find((m) => m.kind === "Package.swift")?.name).toBe("Tool");
  });
});

// ─── Project info ────────────────────────────────────────────────────────────────────────────

const MIT = `MIT License

Copyright (c) 2024 Someone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal`;
const APACHE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/`;
const BSD3 = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
3. Neither the name of the copyright holder nor the names of its contributors`;

describe("readProjectInfo", () => {
  test("skips headings, badges and HTML banners for the first prose paragraph", () => {
    const r = info({
      "README.md": `<div align="center"><img src="logo.svg" alt="Logo"></div>

<kbd>Show your love -- T-shirts, mugs, and stickers now available here!</kbd>

# tool

[![CI](https://x/badge.svg)](https://x) [![npm](https://img.shields.io/npm/v/x.svg)](https://npm.im/x)

\`tool\` is a **fast** [file finder](https://example.com) for _your_ terminal.
It respects &lt;gitignore&gt; rules.

## Install
`,
      "docs/README.md": "# not this one",
    });
    expect(r.readme).toBe("README.md");
    expect(r.description).toBe("tool is a fast file finder for your terminal. It respects <gitignore> rules.");
  });

  test("falls back to prose inside HTML when there is no Markdown paragraph", () => {
    const r = info({ "readme.md": '<p align="center">A small library for parsing things quickly and well.</p>\n\n- one\n- two\n' });
    expect(r.description).toBe("A small library for parsing things quickly and well.");
  });

  test("blockquote taglines count; lists and tables do not", () => {
    const r = info({ "README.md": "# Vite ⚡\n\n> Next Generation Frontend Tooling\n\n- 💡 Instant Server Start\n" });
    expect(r.description).toBe("Next Generation Frontend Tooling");
  });

  test("reStructuredText", () => {
    const r = info({
      "README.rst": "Project\n=======\n\n.. image:: https://x/badge.svg\n   :target: https://x\n\nProject is a `toolkit <https://example.com>`_ for building ``things`` quickly.\n",
    });
    expect(r.description).toBe("Project is a toolkit for building things quickly.");
  });

  test("prefers README.md over other root READMEs and truncates at 400 chars", () => {
    const long = `${"word ".repeat(150).trim()}.`;
    const r = info({ "README.txt": "Plain text readme with enough words here.", "README.md": long, "README-VIM.md": "x" });
    expect(r.readme).toBe("README.md");
    expect(r.description!.length).toBeLessThanOrEqual(400);
    expect(r.description!.endsWith("…")).toBe(true);
  });

  test("license from license text", () => {
    expect(info({ LICENSE: MIT }).license).toBe("MIT");
    expect(info({ "LICENSE.txt": APACHE }).license).toBe("Apache-2.0");
    expect(info({ "LICENSE.md": BSD3 }).license).toBe("BSD-3-Clause");
    expect(info({ COPYING: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007" }).license).toBe("GPL-3.0");
    expect(info({ COPYING: "GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991" }).license).toBe("GPL-2.0");
    expect(info({ LICENSE: "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999" }).license).toBe("LGPL-2.1");
    expect(info({ LICENSE: "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3" }).license).toBe("AGPL-3.0");
    expect(info({ LICENSE: "Mozilla Public License Version 2.0\n==================" }).license).toBe("MPL-2.0");
    expect(info({ LICENSE: "ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies." }).license).toBe("ISC");
    expect(info({ UNLICENSE: "This is free and unencumbered software released into the public domain." }).license).toBe("Unlicense");
  });

  test("dual licenses use the manifest's expression, or OR", () => {
    expect(info({ "LICENSE-MIT": MIT, "LICENSE-APACHE": APACHE, "Cargo.toml": '[package]\nname = "x"\nlicense = "MIT OR Apache-2.0"\n' }).license).toBe("MIT OR Apache-2.0");
    expect(info({ "LICENSE-MIT": MIT, "LICENSE-APACHE": APACHE }).license).toBe("Apache-2.0 OR MIT");
  });

  test("manifest license when no license file; Other when unrecognized", () => {
    expect(info({ "package.json": '{"license":"ISC"}' }).license).toBe("ISC");
    expect(info({ "pyproject.toml": '[project]\nname = "x"\nlicense = "BSD-3-Clause"\n' }).license).toBe("BSD-3-Clause");
    expect(info({ LICENSE: "All rights reserved. Do not copy." }).license).toBe("Other");
    expect(info({ "README.md": "hi" }).license).toBeUndefined();
  });
});
