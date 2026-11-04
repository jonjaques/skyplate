/**
 * scripts/third-party-notices.ts: which packages a viewer build is said to bundle, where each
 * license text comes from, and how the file groups them. The report-level check (a written
 * report carries all three notice files) is in test/pipeline.test.ts.
 *
 * Run: bun test test/notices.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledPackages, cssPackageImports, renderNotices, type MetafileLike } from "../scripts/third-party-notices";

const ROOT = join(import.meta.dir, "..");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "skyplate-notices-test-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const meta = (...inputs: string[]): MetafileLike[] => [{ outputs: { "./app.js": { inputs: Object.fromEntries(inputs.map((i) => [i, { bytesInOutput: 1 }])) } } }];

/** A throwaway package root with the given packages installed. */
function fakeRoot(name: string, pkgs: Record<string, { license?: string; files?: Record<string, string> }>): string {
  const root = join(TMP, name);
  for (const [pkg, spec] of Object.entries(pkgs)) {
    const dir = join(root, "node_modules", pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0", license: spec.license ?? "MIT" }));
    for (const [f, text] of Object.entries(spec.files ?? {})) writeFileSync(join(dir, f), text);
  }
  return root;
}

describe("third-party notices", () => {
  test("a stylesheet's package imports count, its local imports do not", () => {
    const css = `@import "tailwindcss";\n@import 'tw-animate-css';\n@import "./fonts.css";\n@import "@scope/pkg/theme.css";`;
    expect(cssPackageImports(css)).toEqual(["tailwindcss", "tw-animate-css", "@scope/pkg"]);
  });

  test("packages come from the bundle's inputs, scoped and nested names included", () => {
    const pkgs = bundledPackages(meta("node_modules/zustand/esm/vanilla.mjs", "node_modules/@floating-ui/dom/dist/x.mjs", "src/viewer/App.tsx"), ROOT, []);
    expect(pkgs.map((p) => p.name)).toEqual(["@floating-ui/dom", "zustand"]);
    expect(pkgs.find((p) => p.name === "zustand")!.text).toContain("MIT License");
  });

  test("a bundled package with no license file is vendored, or the build fails", () => {
    const root = fakeRoot("missing", { "quiet-pkg": {} });
    expect(() => bundledPackages(meta("node_modules/quiet-pkg/index.js"), root, [])).toThrow(/publishes no license file/);
    mkdirSync(join(root, "scripts", "licenses"), { recursive: true });
    writeFileSync(join(root, "scripts", "licenses", "quiet-pkg"), "MIT License\n\nCopyright (c) Someone\n");
    writeFileSync(join(root, "scripts", "licenses", "quiet-pkg.source"), "https://example.invalid/quiet-pkg/v1.0.0/LICENSE\n");
    const [p] = bundledPackages(meta("node_modules/quiet-pkg/index.js"), root, []);
    expect(p!.vendoredFrom).toBe("https://example.invalid/quiet-pkg/v1.0.0/LICENSE");
    expect(renderNotices([p!], { name: "Skyplate", version: "0.0.0" })).toContain("copied verbatim from\n  https://example.invalid/quiet-pkg/v1.0.0/LICENSE");
  });

  test("identical license texts share one section; a NOTICE file rides along", () => {
    const same = "ISC License\n\nCopyright 2020 One Author\n";
    const root = fakeRoot("grouped", {
      a: { license: "ISC", files: { LICENSE: same } },
      b: { license: "ISC", files: { "LICENSE.md": same } },
      c: { license: "Apache-2.0", files: { LICENSE: "Apache text", NOTICE: "c\nCopyright 2021 C's authors" } },
    });
    const pkgs = bundledPackages(meta("node_modules/a/i.js", "node_modules/b/i.js", "node_modules/c/i.js"), root, []);
    const text = renderNotices(pkgs, { name: "Skyplate", version: "0.0.0" });
    expect(text.match(/Copyright 2020 One Author/g)).toHaveLength(1);
    expect(text).toContain("a 1.0.0 (ISC)\nb 1.0.0 (ISC)");
    expect(text).toContain("Apache text\n\nc\nCopyright 2021 C's authors");
    // Deterministic: the same inputs render the same bytes (no dates), so the committed copy
    // only changes when the bundle does.
    expect(renderNotices(pkgs, { name: "Skyplate", version: "0.0.0" })).toBe(text);
  });
});
