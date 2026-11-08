/**
 * A published package's exports are API, a private package's are not: the same unused export
 * is dead in one and public in the other.
 *
 * Two workspace packages with the same shape, an entry that re-exports a library file with
 * `export *`: `pub` has no `"private": true`, `priv` has it. Nothing in the repository uses
 * either library's exports.
 *
 * Run: bun test test/public-api.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, type AnalysisResult } from "../src/core/pipeline";
import { validateReport } from "../src/core/validate";
import { searchSymbols } from "../src/mcp/query";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-public-api-")));
let result: AnalysisResult;

function write(path: string, content: string): void {
  const abs = join(TMP, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

beforeAll(async () => {
  write("package.json", JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }));
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler", target: "ES2022" }, include: ["packages"] }));
  for (const [name, isPrivate] of [["pub", false], ["priv", true]] as const) {
    write(`packages/${name}/package.json`, JSON.stringify({ name, ...(isPrivate ? { private: true } : {}), exports: { ".": "./src/index.ts" } }));
    write(`packages/${name}/src/index.ts`, `export * from "./lib";\nexport const ${name}Version = "1";\n`);
    // `${name}Local` is used inside its own file and exported anyway.
    write(`packages/${name}/src/lib.ts`, `export function ${name}Thing(): number {\n  return ${name}Local() + 1;\n}\n\nexport function ${name}Local(): number {\n  return 1;\n}\n`);
  }
  result = await analyzeProject(TMP, { git: false, workers: 1 });
}, 60_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("published packages", () => {
  test("the published entry and what it re-exports are public API; the private package is not", () => {
    const files = result.report.files;
    const pub = files.filter((f) => f.publicApi).map((f) => f.path).sort();
    expect(pub).toEqual(["packages/pub/src/index.ts", "packages/pub/src/lib.ts"]);
    expect(files.find((f) => f.path === "packages/priv/src/lib.ts")!.publicApi).toBeUndefined();
    expect(validateReport(result.report, result.symbols)).toEqual([]);
  });

  test("unused exports: public-api in the published package, unreferenced in the private one", () => {
    const r = searchSymbols(result.report, result.symbols, { unusedExports: true, limit: 50 });
    const flagsOf = (name: string) => r.symbols.find((s) => s.name === name)?.flags ?? [];
    for (const name of ["pubThing", "pubVersion", "pubLocal"]) expect(flagsOf(name)).toContain("public-api");
    expect(flagsOf("privThing")).toContain("unreferenced");
    // The private entry's own export is the entry's (a package export), not dead and not public.
    expect(flagsOf("privVersion")).toContain("entry-export");
    expect(flagsOf("privLocal")).not.toContain("unreferenced"); // used at home: it only needs to lose export
    expect(r.unusedExports).toMatchObject({ unreferenced: 1, "public-api": 3 });
  });

  test("the finding counts only the private package's export as dead", () => {
    const finding = result.report.findings.find((f) => f.id === "unused-exports")!;
    expect(finding.detail).toContain("1 is referenced nowhere at all");
    expect(finding.detail).toContain("3 are a published package's API");
  });
});
