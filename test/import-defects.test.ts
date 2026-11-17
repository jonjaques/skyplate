import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractImports } from "../src/core/imports/extract";
import { createResolver } from "../src/core/imports/resolve";
import { analyzeProject } from "../src/core/pipeline";
import { validateReport } from "../src/core/validate";
import { changeImpact, file, graph } from "../src/mcp/query";
import type { Report } from "../src/shared/schema";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-import-defects-")));
let packages: Report;
let python: Report;

async function analyze(name: string, files: Record<string, string>): Promise<Report> {
  const root = join(TMP, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return (await analyzeProject(root, { git: false, symbols: false, source: false, workers: 1 })).report;
}

beforeAll(async () => {
  const files: Record<string, string> = {
    "go.mod": "module example.test/demo\n",
    "app/main.go": 'package app\nimport "example.test/demo/pkg"\n',
    "next/main.go": 'package next\nimport "example.test/demo/app"\n',
    "tiny/main.go": 'package tiny\nimport "example.test/demo/small"\n',
  };
  for (let member = 0; member < 24; member++) files[`pkg/f${String(member).padStart(2, "0")}.go`] = "package pkg\n";
  for (let member = 0; member < 3; member++) files[`small/f${member}.go`] = "package small\n";
  packages = await analyze("packages", files);
  python = await analyze("python", {
    "a.py": "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import b\n",
    "b.py": "import a\n",
  });
}, 60_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("package import projections", () => {
  test("Go records 17 projected file edges for a 24-member package", () => {
    const importer = packages.files.find((entry) => entry.path === "app/main.go")!.id;
    const directory = packages.dirs.find((entry) => entry.path === "pkg")!.id;
    expect(packages.edges.from.filter((from) => from === importer)).toHaveLength(17);
    const table = packages.edges.packages!;
    const row = table.from.indexOf(importer);
    expect({ from: table.from[row], dir: table.dir[row], members: table.members[row], projected: table.projected[row], capped: table.capped[row] })
      .toEqual({ from: importer, dir: directory, members: 24, projected: 17, capped: true });
    expect(validateReport(packages)).toEqual([]);
  });

  test("file imports and importedBy explain the capped package projection", () => {
    const result = file(packages, undefined, "app/main.go");
    expect(result.imports.count).toBe(17);
    expect(result.imports).toHaveProperty("note", expect.stringMatching(/17 file edges for 24 members/));
    expect(file(packages, undefined, "pkg/f00.go").importedBy).toHaveProperty("note", expect.stringMatching(/capped/i));
  });

  test("graph explains capped dependencies and dependents, including omitted members", () => {
    const dependencies = graph(packages, { view: "dependencies", path: "app/main.go", depth: 1 });
    expect(dependencies).toHaveProperty("note", expect.stringMatching(/17 file edges for 24 members/));
    expect(graph(packages, { view: "dependents", path: "pkg/f00.go" })).toHaveProperty("note", expect.stringMatching(/capped/i));
    const omitted = graph(packages, { view: "dependents", path: "pkg/f23.go" });
    expect(omitted).toHaveProperty("total", 0);
    expect(omitted).toHaveProperty("note", expect.stringMatching(/capped/i));
  });

  test("change_impact qualifies dependents even when the member has no projected edge", () => {
    for (const path of ["pkg/f00.go", "pkg/f23.go"]) {
      const result = changeImpact(packages, undefined, { paths: [path] });
      expect(result.dependents).toHaveProperty("note", expect.stringMatching(/17 file edges for 24 members/));
    }
  });

  test("graph path answers qualify both a projected chain and an absent edge", () => {
    for (const to of ["pkg/f00.go", "pkg/f23.go"]) {
      expect(graph(packages, { view: "path", path: "app/main.go", to })).toHaveProperty("note", expect.stringMatching(/17 file edges for 24 members/));
    }
  });

  test("packages within the cap keep every edge and no cap note", () => {
    const importer = packages.files.find((entry) => entry.path === "tiny/main.go")!.id;
    const table = packages.edges.packages!;
    const row = table.from.indexOf(importer);
    expect(table.members[row]).toBe(3);
    expect(table.projected[row]).toBe(3);
    expect(table.capped[row]).toBe(false);
    const result = file(packages, undefined, "tiny/main.go");
    expect(result.imports.count).toBe(3);
    expect(result.imports).not.toHaveProperty("note", expect.any(String));
    expect(graph(packages, { view: "dependencies", path: "tiny/main.go" })).not.toHaveProperty("note", expect.any(String));
    expect(changeImpact(packages, undefined, { paths: ["small/f0.go"] }).dependents).not.toHaveProperty("note", expect.any(String));
  });

  test("older reports without package metadata still load and answer", () => {
    const older = structuredClone(packages);
    delete older.edges.packages;
    expect(validateReport(older)).toEqual([]);
    expect(file(older, undefined, "app/main.go").imports.count).toBe(17);
    expect(graph(older, { view: "dependents", path: "pkg/f00.go" })).not.toHaveProperty("note", expect.any(String));
  });

  test("the 17-member boundary is complete and a self-import is not called capped", async () => {
    const files: Record<string, string> = { "go.mod": "module example.test/boundary\n", "main.go": 'package main\nimport "example.test/boundary/pkg"\n' };
    for (let member = 0; member < 17; member++) files[`pkg/f${member}.go`] = "package pkg\n";
    const boundary = await analyze("boundary", files);
    expect(boundary.edges.packages).toMatchObject({ members: [17], projected: [17], capped: [false] });
    expect(validateReport(boundary)).toEqual([]);
    const self = await analyze("self", { "pkg/Only.java": "package pkg;\nimport pkg.*;\n" });
    expect(self.edges.packages).toMatchObject({ members: [1], projected: [0], capped: [false] });
    expect(validateReport(self)).toEqual([]);
    expect(file(self, undefined, "pkg/Only.java").imports).not.toHaveProperty("note", expect.any(String));
  });

  test("capped imports validate when the importer shares the directory but is outside the projection", async () => {
    const files: Record<string, string> = { "pkg/Z.java": "package pkg;\nimport pkg.*;\n" };
    for (let member = 0; member < 17; member++) files[`pkg/A${member}.java`] = "package pkg;\n";
    const wildcard = await analyze("wildcard-self", files);
    expect(wildcard.edges.packages).toMatchObject({ members: [18], projected: [17], capped: [true] });
    expect(validateReport(wildcard)).toEqual([]);
    const goFiles: Record<string, string> = {
      "go.mod": "module example.test/selftest\n",
      "pkg/external_test.go": 'package pkg_test\nimport "example.test/selftest/pkg"\n',
    };
    for (let member = 0; member < 18; member++) goFiles[`pkg/f${member}.go`] = "package pkg;\n";
    const externalTest = await analyze("go-self-test", goFiles);
    expect(externalTest.edges.packages).toMatchObject({ members: [18], projected: [17], capped: [true] });
    expect(validateReport(externalTest)).toEqual([]);
  });

  test("validateReport checks projection columns, integer ids, counts, and uniqueness", () => {
    const corruptions = [
      (report: Report) => report.edges.packages!.dir.pop(),
      (report: Report) => { report.edges.packages!.from[0] = report.files.length; },
      (report: Report) => { report.edges.packages!.dir[0] = -1; },
      (report: Report) => { report.edges.packages!.members[0] = 1.5; },
      (report: Report) => { report.edges.packages!.members[0] = report.files.length + 1; },
      (report: Report) => { report.edges.packages!.projected[0] = 25; },
      (report: Report) => { report.edges.packages!.projected[0] = -1; },
      (report: Report) => { report.edges.packages!.capped[0] = false; },
      (report: Report) => {
        const table = report.edges.packages!;
        table.from.push(table.from[0]!);
        table.dir.push(table.dir[0]!);
        table.members.push(table.members[0]!);
        table.projected.push(table.projected[0]!);
        table.capped.push(table.capped[0]!);
      },
    ];
    for (const corrupt of corruptions) {
      const report = structuredClone(packages);
      corrupt(report);
      expect(validateReport(report).some((error) => error.includes("package projection"))).toBe(true);
    }
  });
});

describe("Python type-checking guards", () => {
  test("recognizes bare, qualified, and aliased guards with nested runtime else branches", () => {
    const text = [
      "from typing import TYPE_CHECKING as TC",
      "import typing as ty",
      "if TYPE_CHECKING:",
      "    import bare",
      "    if flag:",
      "        from . import nested",
      "    else:",
      "        import nested_else",
      "else:",
      "    import runtime_else",
      "if typing.TYPE_CHECKING:",
      "    from qualified import Value",
      "if TC:",
      "    import alias",
      "    # Blank lines and comments do not end the guard.",
      "",
      "    import after_blank",
      "if ty.TYPE_CHECKING:",
      "    import module_alias",
      "else:",
      "    if flag:",
      "        import runtime_nested",
      "import after",
    ].join("\n");
    expect(extractImports("guards.py", text, "python").map((entry) => `${entry.spec}${entry.typeOnly ? " (type)" : ""}`)).toEqual([
      "typing", "typing", "bare (type)", ".nested (type)", "nested_else (type)", "runtime_else", "qualified (type)",
      "alias (type)", "after_blank (type)", "module_alias (type)", "runtime_nested", "after",
    ]);
  });

  test("parenthesized alias imports, tabs, and multiline guarded imports preserve status", () => {
    const text = "from typing import (\n    TYPE_CHECKING as TC,\n)\nif TC:\n\tfrom . import (\n\t    first,\n\t    second,\n\t)\n\tif flag:\n\t\timport deep\nelse:\n\timport runtime\n";
    expect(extractImports("guards.py", text, "python").filter((entry) => entry.typeOnly).map((entry) => entry.spec)).toEqual([".first", ".second", "deep"]);
  });

  test("comments, strings, other guards, and guard-like names do not hide runtime imports", () => {
    const text = 'text = "if TYPE_CHECKING:"\n# if TYPE_CHECKING:\nif other.TYPE_CHECKING:\n    import other\nif TYPE_CHECKING_ENABLED:\n    import enabled\nif TYPE_CHECKING or flag:\n    import possible_runtime\n';
    expect(extractImports("guards.py", text, "python").some((entry) => entry.typeOnly)).toBe(false);
  });

  test("multiline conditions and strings do not end a guard, and elif restores its own guard", () => {
    const text = 'if (\n    TYPE_CHECKING\n):\n    text = """text\nat column zero\n"""\n    import guarded\nelif flag:\n    import runtime\nelif TYPE_CHECKING:\n    import elif_guarded\nelse:\n    import runtime_else\n';
    expect(extractImports("guards.py", text, "python").map((entry) => `${entry.spec}${entry.typeOnly ? " (type)" : ""}`)).toEqual(["guarded (type)", "runtime", "elif_guarded (type)", "runtime_else"]);
  });

  test("a runtime import of the same module outweighs its guarded import", async () => {
    const report = await analyze("python-mixed", {
      "a.py": "if TYPE_CHECKING:\n    import b\nelse:\n    import b\n",
      "b.py": "import a\n",
    });
    expect(report.edges.typeOnly).toBeUndefined();
    expect(report.graph.cycles).toHaveLength(1);
    expect(validateReport(report)).toEqual([]);
  });

  test("a guarded Python loop is type-only, not a runtime cycle or finding", () => {
    expect(python.edges.typeOnly).toHaveLength(1);
    expect(python.graph.cycles).toEqual([]);
    expect(python.graph.typeLoops).toHaveLength(1);
    expect(python.findings.some((finding) => finding.id === "type-only-loops")).toBe(true);
    expect(python.files.every((entry) => entry.cycle === undefined || entry.cycle === -1)).toBe(true);
    expect(file(python, undefined, "a.py").typeOnlyImports).toEqual(["b.py"]);
    expect(validateReport(python)).toEqual([]);
  });
});

describe("C and C++ extensionless headers", () => {
  const paths = ["main.c", "include/projectheader", "include/vector", "include/stdio.h", "src/main.c", "src/unrelated/api.h", "include/api.h"];
  const resolver = createResolver({ root: TMP, paths, manifests: [], readText: () => undefined });
  const resolve = (from: string, spec: string) => resolver(paths.indexOf(from), { spec, kind: "include", line: 0 }, "c");

  test("extensionless angle includes resolve to repository headers", () => {
    expect(resolve("main.c", "<projectheader>")).toEqual({ file: paths.indexOf("include/projectheader") });
    expect(resolve("main.c", "projectheader")).toEqual({ file: paths.indexOf("include/projectheader") });
  });

  test("known C and C++ standard headers stay system headers even with local namesakes", () => {
    for (const header of ["vector", "stdio.h", "algorithm", "string", "string_view", "ranges", "cstdint", "coroutine", "expected", "meta", "stdbit.h", "stdckdint.h", "sys/socket.h"]) {
      expect(resolve("main.c", `<${header}>`)).toEqual({ external: { name: header, ecosystem: "system" } });
    }
  });

  test("angle includes the repository does not hold stay system headers, and quoted suffix search order is unchanged", () => {
    expect(resolve("main.c", "<missing_header>")).toEqual({ external: { name: "missing_header", ecosystem: "system" } });
    expect(resolve("main.c", "<missing_header.h>")).toEqual({ external: { name: "missing_header.h", ecosystem: "system" } });
    expect(resolve("src/main.c", "api.h")).toEqual({ file: paths.indexOf("src/unrelated/api.h") });
  });
});
