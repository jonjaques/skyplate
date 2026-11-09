/**
 * findEntries: which files the repository declares as entry points, and who declares them.
 *
 * Run: bun test test/entries.test.ts
 */

import { describe, expect, test } from "bun:test";
import { findEntries } from "../src/core/entries";

function entriesOf(files: Record<string, string>): Record<string, string> {
  const paths = Object.keys(files).sort();
  return Object.fromEntries(findEntries(paths, (p) => files[p]));
}

describe("findEntries", () => {
  test("package.json main, bin and exports, conditions and subpath patterns included", () => {
    const found = entriesOf({
      "packages/a/package.json": JSON.stringify({
        main: "./src/main.ts",
        bin: { a: "bin/a.mjs" },
        exports: { ".": { import: "./src/index.ts", types: "./src/index.d.ts" }, "./tools/*": "./src/tools/*.ts" },
      }),
      "packages/a/src/main.ts": "",
      "packages/a/src/index.ts": "",
      "packages/a/src/tools/x.ts": "",
      "packages/a/src/tools/y.ts": "",
      "packages/a/src/other.ts": "",
      "packages/a/bin/a.mjs": "",
      // A built target the repository does not hold is not an entry of anything here.
      "packages/b/package.json": JSON.stringify({ main: "dist/index.js" }),
      "packages/b/src/index.ts": "",
    });
    expect(found).toEqual({
      "packages/a/src/main.ts": "package main",
      "packages/a/bin/a.mjs": "package bin",
      "packages/a/src/index.ts": "package exports",
      "packages/a/src/tools/x.ts": "package exports",
      "packages/a/src/tools/y.ts": "package exports",
    });
  });

  test("files scripts run, relative to the package that declares the script", () => {
    const found = entriesOf({
      "package.json": JSON.stringify({ scripts: { dev: "node scripts/dev.mjs && vitest --config=apps/web/vitest.slow.config.ts", lint: "oxlint" } }),
      "scripts/dev.mjs": "",
      "apps/web/vitest.slow.config.ts": "",
      "apps/web/package.json": JSON.stringify({ scripts: { start: "tsx src/server.ts --port $PORT" } }),
      "apps/web/src/server.ts": "",
      "src/server.ts": "", // a root file of the same name is not what apps/web's script runs
    });
    expect(found["scripts/dev.mjs"]).toBe("package script");
    expect(found["apps/web/vitest.slow.config.ts"]).toBe("package script");
    expect(found["apps/web/src/server.ts"]).toBe("package script");
    expect(found["src/server.ts"]).toBeUndefined();
  });

  test("knip's entry globs, at the root and per workspace, comments and negations allowed", () => {
    const found = entriesOf({
      "knip.jsonc": `{
        // the repository's own declaration
        "entry": ["scripts/**/*.mjs", "!scripts/skip/**"],
        "workspaces": {
          "packages/*": { "entry": ["src/index.ts!", "src/**/*.test.ts"] },
        },
      }`,
      "scripts/a/run.mjs": "",
      "scripts/skip/x.mjs": "",
      "packages/p/src/index.ts": "",
      "packages/p/src/util.ts": "",
      "packages/p/src/util.test.ts": "",
    });
    expect(found).toEqual({
      "scripts/a/run.mjs": "knip entry",
      "packages/p/src/index.ts": "knip entry",
      "packages/p/src/util.test.ts": "knip entry",
    });
  });

  test("files CI steps, agent hooks and T3 project scripts run", () => {
    const found = entriesOf({
      ".github/workflows/ci.yml": [
        "jobs:",
        "  check:",
        "    steps:",
        "      - run: node scripts/check.mjs",
        "      - name: Archive",
        "        working-directory: tools",
        "        run: |",
        '          echo "v=$(node archive.mjs version)" >> "$GITHUB_OUTPUT"',
        "          bash ../scripts/publish.sh",
        "      - run: pnpm test # no file here",
      ].join("\n"),
      "scripts/check.mjs": "",
      "tools/archive.mjs": "",
      "scripts/publish.sh": "",
      ".claude/settings.json": JSON.stringify({
        hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/start.sh' }] }] },
        permissions: { allow: ["Bash(command scripts/not-a-hook.sh)"] },
      }),
      ".claude/hooks/start.sh": "",
      "scripts/not-a-hook.sh": "",
      ".codex/hooks.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$(git rev-parse --show-toplevel)/scripts/agents/stop.mjs"' }] }] } }),
      "scripts/agents/stop.mjs": "",
      "t3.json": JSON.stringify({ scripts: [{ name: "Setup", command: "bash scripts/setup.sh" }, { name: "Dev", command: "pnpm dev" }] }),
      "scripts/setup.sh": "",
    });
    expect(found).toEqual({
      "scripts/check.mjs": "workflow step",
      "tools/archive.mjs": "workflow step",
      "scripts/publish.sh": "workflow step",
      ".claude/hooks/start.sh": "agent hook",
      "scripts/agents/stop.mjs": "agent hook",
      "scripts/setup.sh": "t3 script",
    });
  });

  test("tool configs are entries by their name; the most explicit source wins", () => {
    const found = entriesOf({
      "vite.config.ts": "",
      "apps/web/astro.config.mjs": "",
      "src/config.ts": "",
      "src/env.d.ts": "",
      "package.json": JSON.stringify({ scripts: { test: "vitest --config vite.config.ts" } }),
    });
    expect(found).toEqual({ "vite.config.ts": "package script", "apps/web/astro.config.mjs": "tool config", "src/env.d.ts": "type declarations" });
  });
});
