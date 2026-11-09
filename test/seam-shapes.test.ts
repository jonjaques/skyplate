/**
 * Two interface shapes the plain "symbols code outside uses" count understates: a property
 * typed as another in-repo interface (callers learn that interface too) and a one-line getter
 * that forwards another object's member. Also the unused-export class `symbol` reports.
 *
 * Run: bun test test/seam-shapes.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, type AnalysisResult } from "../src/core/pipeline";
import { resolveSymbol, seam, seams, symbol } from "../src/mcp/query";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-seam-shapes-")));
let result: AnalysisResult;

function write(path: string, content: string): void {
  const abs = join(TMP, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

beforeAll(async () => {
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler", target: "ES2022" }, include: ["src"] }));
  write("src/kinds.ts", "export interface Shape {\n  kind: string;\n  sides: number;\n}\n\nexport class Circle {\n  radius = 2;\n}\n\nexport class Orphan {}\n");
  write(
    "src/box.ts",
    'import type { Shape } from "./kinds";\nimport { Circle } from "./kinds";\n\nexport class Box {\n  shape: Shape = { kind: "box", sides: 4 };\n  private circle = new Circle();\n  get area() { return this.circle.radius; }\n}\n',
  );
  write("src/use.ts", 'import { Box } from "./box";\n\nconst b = new Box();\nexport const report = `${b.shape.kind} ${b.area}`;\n');
  write("src/api.ts", "export function value() { return 1; }\n");
  write("src/client.ts", 'import { value } from "./api";\nexport function run() { return value(); }\n');
  write("src/api.test.ts", 'import { value } from "./api";\nexport function verify() { return value() === 1; }\n');
  write("src/host.ts", "export function hostValue() { return 1; }\n");
  write("src/host.test.vue", '<script setup lang="ts">\nimport { hostValue } from "./host";\nconst n = hostValue();\n</script>\n<template>{{ n }}</template>\n');
  write("metrics/production.ts", "export const value = 1;\n");
  write("metrics/empty.ts", "");
  write("metrics/package.json", '{"name":"metrics","private":true}\n');
  write("metrics/values.json", '{"value":1}\n');
  write("metrics/model.generated.ts", "export const generated = 1;\n");
  write("metrics/vendor/library.ts", "export const vendored = 1;\n");
  write("metrics/production.test.ts", 'import { value } from "./production";\nexport const ok = value === 1;\n');
  write("metrics/generated.test.ts", "/** @generated */\nexport const ok = true;\n");
  result = await analyzeProject(TMP, { git: false, workers: 1 });
}, 60_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("seam shapes", () => {
  test("ranked file counts match implementation counts and exclude nonproduction files", () => {
    const { report, symbols } = result;
    const byPath = new Map(report.files.map((f) => [f.path, f]));
    expect(byPath.get("metrics/package.json")!.category).toBe("config");
    expect(byPath.get("metrics/values.json")!.category).toBe("data");
    expect(byPath.get("metrics/model.generated.ts")!.generated).toBe(true);
    expect(byPath.get("metrics/vendor/library.ts")!.vendored).toBe(true);
    expect(byPath.get("metrics/generated.test.ts")!.generated).toBe(true);
    expect(byPath.get("metrics/empty.ts")!.code).toBe(0);
    const ranked = seams(report, symbols, { depth: 1, limit: 100 });
    const row = ranked.rows.find((r) => r.module === "metrics")!;
    const detail = seam(report, symbols, row.selector.path, row.selector);
    expect(detail.implementation.files).toBe(2); // zero-code source files still count
    expect(detail.tests.files).toBe(1);
    expect(row.files).toBe(detail.implementation.files);
    expect(row.testFiles).toBe(detail.tests.files);
    expect(row.code).toBe(detail.implementation.code);
    expect(row.complexity).toBe(detail.implementation.complexity);
  });

  test("a property typed as an in-repo interface says what it exposes", () => {
    const box = seam(result.report, result.symbols, "src/box.ts");
    const field = box.interface!.rows.find((r) => r.name === "Box.shape")!;
    expect(field.exposes).toMatch(/^Shape #\d+ \(2 public members\)$/);
  });

  test("a one-line getter reading another object's member is a forward", () => {
    const box = seam(result.report, result.symbols, "src/box.ts");
    expect(box.interface!.rows.find((r) => r.name === "Box.area")!.forwardsTo).toBe("Circle.radius");
  });

  test("symbol carries the same unused-export class search_symbols does", () => {
    const id = resolveSymbol(result.report, result.symbols, { name: "Orphan" });
    expect(symbol(result.report, result.symbols, id).unusedExport).toBe("unreferenced");
  });

  test("test callers stay out of the production interface caller count", () => {
    const api = seam(result.report, result.symbols, "src/api.ts");
    expect(api.interface).toMatchObject({ callers: 1, files: 1, uses: 1 });
    expect(api.interface!.rows[0]!.testUses).toBe(1);
  });

  test("test component imports are test uses, even inside the measured module", () => {
    const host = seam(result.report, result.symbols, "src/host*");
    expect(host.interface!.rows).toEqual([]);
    expect(host.testsPastInterface!.rows.map((s) => s.name)).toContain("hostValue");
    expect(host.testFiles).toContain("src/host.test.vue");
  });
});
