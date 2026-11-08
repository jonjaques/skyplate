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
import { resolveSymbol, seam, symbol } from "../src/mcp/query";

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
  result = await analyzeProject(TMP, { git: false, workers: 1 });
}, 60_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("seam shapes", () => {
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
});
