import { describe, expect, test } from "bun:test";
import { rank, rankScored, scoreTerm, searchable, SUBSTRING_FLOOR } from "../src/viewer/shell/search";

const score = (term: string, target: string) => scoreTerm(term, target.toLowerCase(), target, target.lastIndexOf("/") + 1);

describe("palette ranking", () => {
  test("every substring hit outranks every subsequence hit, however long the query", () => {
    const paths = [
      "apps/game/src/render/entryTrace.gpu.test.ts", // a scattered subsequence of the query
      "apps/game/src/engine/GameEngine.ts", //          the query is a literal prefix of this one
    ];
    expect(rank(searchable(paths), "apps/game/src/eng", 8)).toEqual([1, 0]);
    expect(score("apps/game/src/eng", paths[0]!)).toBeLessThan(SUBSTRING_FLOOR);
    expect(score("apps/game/src/eng", paths[1]!)).toBeGreaterThanOrEqual(SUBSTRING_FLOOR);
  });

  test("a path typed from its root finds the file it continues into", () => {
    const paths = [
      "packages/vite/src/node/server/middlewares/__tests__/fixtures/none/index.html",
      "packages/vite/src/node/server/__tests__/fixtures/deno.json",
      "packages/vite/package.json",
      "packages/vite/src/node/server/index.ts",
    ];
    expect(rank(searchable(paths), "packages/vite/src/node/server/ind", 8)[0]).toBe(3);
  });

  test("a literal match in an author's name beats letters that happen to appear in a file name", () => {
    const files = rankScored(searchable(["fta.json", "knip.jsonc"]), "jon", 8);
    const authors = rankScored(searchable(["Jon Jaques jonjaques@users.noreply.github.com"]), "jon", 8);
    expect(authors[0]!.s).toBeGreaterThan(files[0]!.s);
  });

  test("an exact name beats the file named after it, and ties go to the busier symbol", () => {
    const names = ["Vec3", "vec3", "WireVec3"];
    const refs = [758, 1117, 17];
    const symbols = rankScored(searchable(names), "vec3", 8, undefined, (i) => refs[i]!);
    expect(symbols.map((h) => h.i)).toEqual([1, 0, 2]);
    const files = rankScored(searchable(["packages/spatial/src/vec3.ts"]), "vec3", 8);
    expect(symbols[0]!.s).toBeGreaterThan(files[0]!.s);
  });

  test("every term must match, and a miss is excluded rather than ranked last", () => {
    const paths = ["src/server/index.ts", "src/client/index.ts"];
    expect(rank(searchable(paths), "server index", 8)).toEqual([0]);
    expect(rank(searchable(paths), "zzz", 8)).toEqual([]);
  });
});
