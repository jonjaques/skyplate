import { describe, expect, test } from "bun:test";
import { measureBinary, measureText, scanText, contentHash } from "../src/core/metrics";
import { getSyntax } from "../src/core/languages/syntax";
import type { Detection } from "../src/core/contracts";

/** code/comment/blank for a snippet. */
function lines(lang: string, text: string): [number, number, number] {
  const m = measureText("x", text, lang);
  expect(m.code + m.comment + m.blank).toBe(m.lines);
  return [m.code, m.comment, m.blank];
}

// ─── Line classification ─────────────────────────────────────────────────────────────────────

describe("line classification", () => {
  test("C-family comments, strings and the closer-only line", () => {
    const ts = [
      "// header", //                          comment
      "const a = 1; /* trailing", //           code (code + comment)
      "   still comment", //                   comment
      " */", //                                comment, not blank
      "", //                                   blank
      'const s = "// not a comment";', //      code
      "const r = /\\/\\*not-a-comment/;", //   code: regex literal holds /*
      "const t = `a ${b ? `x` : '/*'} c`;", // code: nested template
    ].join("\n");
    expect(lines("typescript", ts)).toEqual([4, 3, 1]);
  });

  test("blank lines inside a block comment stay blank (cloc convention)", () => {
    expect(lines("c", "/*\n\n  x\n*/\nint a;\n")).toEqual([1, 3, 1]);
  });

  test("Python docstrings are comments only in statement position", () => {
    const py = [
      '"""Module doc."""',
      "import os",
      "def f():",
      '    """Doc',
      "",
      '    more"""',
      '    x = """value',
      '    still value"""',
      '    call("""arg""")',
      '    r"""raw doc"""',
      "    # comment",
    ].join("\n");
    // comments: module doc, 2 doc text lines, raw doc, # comment; blank: 1 (inside the doc)
    expect(lines("python", py)).toEqual([5, 5, 1]);
  });

  test("nested block comments, raw strings and lifetimes in Rust", () => {
    const rs = [
      "/* outer /* inner */ still outer */",
      "fn f<'a>(x: &'a str) -> char {",
      "    let r = r#\"// not \"a\" comment\"#;",
      "    let b = b'\"';",
      "    '\"'",
      "}",
    ].join("\n");
    expect(lines("rust", rs)).toEqual([5, 1, 0]);
  });

  test("shell: shebang is code, # inside words and ${#} are code, heredoc bodies are strings", () => {
    const sh = ["#!/bin/sh", "echo ${#arr[@]} a#b # real", "cat <<-EOF", "\t# not a comment", "\tEOF", "# comment"].join("\n");
    expect(lines("shell", sh)).toEqual([5, 1, 0]);
  });

  test("YAML apostrophes in plain scalars do not open strings", () => {
    expect(lines("yaml", "a: don't # c\nb: 'it''s'\n# c\n")).toEqual([2, 1, 0]);
  });

  test("SQL handles both '' doubling and MySQL backslash escapes", () => {
    expect(lines("sql", "INSERT INTO t VALUES ('it\\'s', 'a''b');\n-- comment\n")).toEqual([1, 1, 0]);
  });

  test("Lua long comments and strings", () => {
    expect(lines("lua", "--[==[\nblock ]] still\n]==]\nlocal s = [[ -- no ]]\n-- c\n")).toEqual([1, 4, 0]);
  });

  test("Haskell nested {- -}, operators that start with --", () => {
    expect(lines("haskell", "{- a {- b -} c -}\nx --> y = 1\n-- c\n")).toEqual([1, 2, 0]);
  });

  test("Ruby =begin/=end and Elixir @doc heredocs", () => {
    expect(lines("ruby", "=begin\nnot code\n=end\nputs 1\n")).toEqual([1, 3, 0]);
    expect(lines("elixir", '  @doc """\n  Docs.\n  """\n  def f, do: 1\n')).toEqual([1, 3, 0]);
  });

  test("Ruby percent literals, ?x characters and backtick commands are strings", () => {
    // fzf test/test_shell_integration.rb: the `'` in `%w[foo ' "]` once opened a string that
    // ran 60 lines, hiding a `def` and turning three comment lines into code.
    const rb = "%w[foo ' bar].each { |q| puts q }\n# a comment\ndef helper\n  x = 1 if y\nend\n# another comment\nz = 'it'\n";
    const m = measureText("a.rb", rb, "ruby");
    expect([m.code, m.comment, m.complexity, m.functions]).toEqual([5, 2, 2, 1]);
    expect(lines("ruby", "x = %q(it's (nested) fine)\n# c\ny = %r{a'b}i\n# c\n")).toEqual([2, 2, 0]);
    expect(lines("ruby", "q = c == ?\"\n# c\nok = x.empty? ? ?a : ?\\n\n")).toEqual([2, 1, 0]);
    // A backtick command's `#{` is interpolation, not a comment hiding the `if`.
    expect(measureText("a.rb", "v = `#{bin} --version`.to_i if ok\n# c\n", "ruby").complexity).toBe(2);
    // Modulo, in every spacing, stays an operator.
    const mod = "a = b % c; d = e%f; g = 10 %2; h %= 3; s = \"%d\"%[1]\n";
    expect(scanText(mod, "ruby")!.mask).toBe(mod.replace("%d", "\x01\x01"));
    // Whole-line comments inside a multi-line `%r[…]x` count as comments, as cloc counts them.
    expect(lines("ruby", "R = %r[\n  # opening\n  a [b]\n]x\n")).toEqual([3, 1, 0]);
  });

  test("byte and wide char literals holding a quote (Rust b'\"', C++ L'\"')", () => {
    const rs = "fn a(c: u8) -> bool {\n    c == b'\"'\n}\n// comment one\nfn b() {}\n// comment two\nfn c() { let s = \"x\"; }\n";
    const m = measureText("a.rs", rs, "rust");
    expect([m.code, m.comment, m.functions]).toEqual([5, 2, 3]);
    const cpp = "wchar_t q = L'\"'; char8_t u = u8'\"'; int n = 1'000;\n";
    expect(scanText(cpp, "c++")!.mask).toBe("wchar_t q = L'\x01'; char8_t u = u8'\x01'; int n = 1'000;\n");
  });

  test("Go / ARM assembly `//` comments; #include stays code", () => {
    expect(lines("assembly", '#include "textflag.h"\nTEXT f(SB),NOSPLIT,$0-8\n// go-style comment\n\tMOVD R0, R1 // trailing\n')).toEqual([3, 1, 0]);
  });

  test("Nushell comments, strings, decision points and defs", () => {
    const nu = "# comment\nexport def --env f [] {\n  if $x and $y { 'a#b' } # tail\n}\nlet s = \"multi\n# not a comment\"\n";
    const m = measureText("a.nu", nu, "nushell");
    expect([m.code, m.comment, m.blank]).toEqual([5, 1, 0]);
    expect([m.complexity, m.functions]).toEqual([3, 1]);
  });

  test("an unterminated single-line string only costs its own line", () => {
    expect(lines("javascript", "const a = 'oops\n// comment\nconst b = 1;\n")).toEqual([2, 1, 0]);
  });

  test("CRLF, lone CR, BOM and a missing final newline", () => {
    expect(lines("c", "\uFEFFint a;\r\n// c\r\n\r\nint b;")).toEqual([2, 1, 1]);
    expect(lines("c", "int a;\r// c\rint b;\r")).toEqual([2, 1, 0]);
    expect(measureText("x", "", "c").lines).toBe(0);
  });

  test("languages without rules: every non-blank line is code", () => {
    const m = measureText("a.json", '{\n  "a": 1\n\n}\n', "json");
    expect([m.code, m.comment, m.blank, m.complexity]).toEqual([3, 0, 1, 0]);
  });

  test("markup hosts lex <script> and <style> with their own rules", () => {
    const vue = [
      "<template>",
      "  <!-- c -->",
      "  <div>{{ x }}</div>",
      "</template>",
      '<script setup lang="ts">',
      "// ts comment",
      "if (a && b) {}",
      "</script>",
      "<style>/* css */</style>",
    ].join("\n");
    const m = measureText("A.vue", vue, "vue");
    // The <style> line carries its tags, so it is code even though the CSS is all comment.
    expect([m.code, m.comment, m.blank]).toEqual([7, 2, 0]);
    expect(m.complexity).toBe(3); // 1 + if + &&
  });
});

// ─── Complexity, depth, functions, todos ─────────────────────────────────────────────────────

describe("code metrics", () => {
  test("complexity counts decision points in code, not in strings or comments", () => {
    const ts = [
      "function f(a) {",
      "  if (a && b || c) return a ? 1 : 2; // if while for",
      '  const s = "if for while";',
      "  const o = a?.b ?? c;",
      "  for (const x of y) { while (z) {} }",
      "}",
    ].join("\n");
    // if, &&, ||, ?, ??, for, while
    expect(measureText("x", ts, "typescript").complexity).toBe(8);
  });

  test("non-programming languages report complexity 0", () => {
    expect(measureText("x", "a { color: red }\n", "css").complexity).toBe(0);
    expect(measureText("x", "a: 1\n", "yaml").complexity).toBe(0);
  });

  test("END IF closes a block and is not a decision", () => {
    expect(measureText("x", "IF a THEN\n  b;\nEND IF;\n", "plsql").complexity).toBe(2);
  });

  test("maxDepth by braces and by indentation", () => {
    expect(measureText("x", "a {\n  b {\n    c { }\n  }\n}\n", "c").maxDepth).toBe(3);
    const py = "def f():\n    if x:\n        y = (1,\n                 2)\n    return 1\n";
    expect(measureText("x", py, "python").maxDepth).toBe(2);
  });

  test("function definitions per family", () => {
    const ts = [
      "export function a() {}",
      "const b = (x: number) => x;",
      "const c = async () => {};",
      "class K {",
      "  constructor() {}",
      "  async m(x) {",
      "    if (x) {}",
      "    items.map((i) => i);",
      "  }",
      "}",
    ].join("\n");
    expect(measureText("x", ts, "typescript").functions).toBe(5);
    expect(measureText("x", "def a():\n  pass\nasync def b():\n  pass\n", "python").functions).toBe(2);
    expect(measureText("x", "func main() {}\nfunc (s *S) m() {}\n", "go").functions).toBe(2);
    expect(measureText("x", "fn a() {}\npub fn b<T>() {}\nlet f: fn(i32);\n", "rust").functions).toBe(2);
    expect(measureText("x", "int main(int argc, char **argv) {\n  return foo(1);\n}\nvoid g(void);\n", "c").functions).toBe(1);
  });

  test("TODO markers count only inside comments", () => {
    const js = '// TODO: a\n/* FIXME b\n   HACK c */\nconst s = "TODO not";\n';
    expect(measureText("x", js, "javascript").todos).toBe(3);
  });

  test("minified detection", () => {
    expect(measureText("x", "a".repeat(2000), "javascript").minified).toBe(true);
    expect(measureText("x", "a;\n".repeat(100), "javascript").minified).toBe(false);
  });

  test("hash is the first 16 hex chars of SHA-1 of the UTF-8 bytes", () => {
    const h = new Bun.CryptoHasher("sha1").update("héllo").digest("hex").slice(0, 16);
    expect(measureText("x", "héllo", "text").hash).toBe(h);
    expect(contentHash(new TextEncoder().encode("héllo"))).toBe(h);
  });

  test("the scanner mask keeps offsets and blanks strings and comments", () => {
    const text = 'a("x") // y\nb';
    const scan = scanText(text, "javascript")!;
    expect(scan.mask.length).toBe(text.length);
    expect(scan.mask).toBe('a("\x01")     \nb');
  });

  test("getSyntax exposes the contract shape", () => {
    const s = getSyntax("python")!;
    expect(s.line).toEqual(["#"]);
    expect(s.docstrings).toBe(true);
    expect(getSyntax("json")).toBeUndefined();
  });

  test("1 MiB of TypeScript stays linear", () => {
    const unit = [
      "// comment line with TODO",
      "export function f(a: number, b = `t ${a}`): number {",
      "  if (a > 1 && b !== '/*') { return a ? 1 : 2; }",
      "  const re = /[a-z]+\\/x/g; /* block */",
      "  return [1, 2, 3].map((x) => x * 2).length;",
      "}",
      "",
    ].join("\n");
    const text = unit.repeat(Math.ceil(1_048_576 / unit.length)).slice(0, 1_048_576);
    measureText("warm.ts", text, "typescript");
    const t = performance.now();
    measureText("a.ts", text, "typescript");
    const ms = performance.now() - t;
    // The budget is 30 ms; 150 ms here only guards against regressions to quadratic behavior on
    // slow CI machines. (Measured ~10 ms on an M-series Mac.)
    expect(ms).toBeLessThan(150);
  });
});

// ─── Facts ───────────────────────────────────────────────────────────────────────────────────

describe("facts", () => {
  test("markdown headings, title and links", () => {
    const md = [
      "---",
      "title: Front",
      "---",
      "Intro text",
      "==========",
      "",
      "## Section",
      "```",
      "# not a heading [x](y)",
      "```",
      "See [rel](./a.md), [abs](https://x.dev) and `[code](z)`.",
      "[ref]: ../b.md",
    ].join("\n");
    expect(measureText("a.md", md, "markdown").facts).toEqual({ headings: 2, links: 3, title: "Intro text" });
  });

  test("notebooks count cells and measure cell sources, not JSON", () => {
    const nb = JSON.stringify({
      cells: [
        { cell_type: "markdown", source: ["# Title\n", "\n", "prose"] },
        { cell_type: "code", source: ["# comment\n", "def f(x):\n", "    return x\n"] },
        { cell_type: "code", source: "print(1)" },
      ],
      metadata: { kernelspec: { language: "python", name: "python3" } },
    });
    const m = measureText("n.ipynb", nb, "jupyter-notebook");
    expect(m.facts).toEqual({ cells: 3, codeCells: 2, markdownCells: 1, kernel: "python" });
    expect([m.code, m.comment, m.blank, m.lines]).toEqual([3, 3, 1, 7]);
    expect(m.functions).toBe(1);
  });

  test("CSV rows and columns are quote-aware", () => {
    const csv = 'a,b,c\n1,"x, y",3\n2,"multi\nline",4\n\n3,,\n';
    expect(measureText("a.csv", csv, "csv").facts).toEqual({ rows: 3, columns: 3 });
    expect(measureText("a.tsv", "a\tb\n1\t2\n", "tsv").facts).toEqual({ rows: 1, columns: 2 });
  });

  test("top-level keys for JSON, JSONC, YAML and TOML", () => {
    expect(measureText("a.json", '{"a":1,"b":{"c":2}}', "json").facts).toEqual({ keys: 2 });
    expect(measureText("tsconfig.json", '{\n // c\n "a": 1, "b": "http://x",\n}', "json-with-comments").facts).toEqual({ keys: 2 });
    expect(measureText("a.yml", "a: 1\nb:\n  c: 2\n# x: 3\n---\nd: 4\n", "yaml").facts).toEqual({ keys: 2 });
    expect(measureText("a.toml", 'a = 1\n[b]\nc = 2\n', "toml").facts).toEqual({ keys: 2 });
  });

  test("SVG size from attributes, falling back to the viewBox", () => {
    expect(measureText("a.svg", '<svg width="24px" height="16" xmlns="x"></svg>', "svg").facts).toEqual({ width: 24, height: 16 });
    expect(measureText("a.svg", '<svg viewBox="0 0 100 50" width="100%"></svg>', "svg").facts).toEqual({ width: 100, height: 50 });
  });
});

// ─── Binary ──────────────────────────────────────────────────────────────────────────────────

const det = (format?: string): Detection => ({ language: "binary", category: "image", reason: "content", generated: false, vendored: false, binary: true, secret: false, format });

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Uint8Array.from(out);
}
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le16 = (v: number) => [v & 255, (v >>> 8) & 255];
const le32 = (v: number) => [...le16(v & 0xffff), ...le16(v >>> 16)];

describe("measureBinary", () => {
  test("image dimensions from headers", () => {
    const png = bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(640), be32(480), [8, 6, 0, 0, 0]);
    expect(measureBinary("a.png", png, det("PNG")).facts).toEqual({ width: 640, height: 480, format: "PNG" });
    const gif = bytes("GIF89a", le16(10), le16(20), [0, 0, 0]);
    expect(measureBinary("a.gif", gif, det()).facts).toEqual({ width: 10, height: 20, format: "GIF" });
    // JPEG: SOI, an APP0 segment to skip, then SOF0 with height 300 / width 200.
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 4, 0, 0], [0xff, 0xc0, 0, 17, 8], [1, 44], [0, 200], [3, 0, 0, 0, 0]);
    expect(measureBinary("a.jpg", jpeg, det("JPEG")).facts?.width).toBe(200);
    expect(measureBinary("a.jpg", jpeg, det("JPEG")).facts?.height).toBe(300);
    const webp = bytes("RIFF", le32(30), "WEBPVP8X", le32(10), [0, 0, 0, 0], [99, 0, 0], [49, 0, 0]);
    expect(measureBinary("a.webp", webp, det()).facts).toEqual({ width: 100, height: 50, format: "WebP" });
    const bmp = bytes("BM", le32(0), le32(0), le32(54), le32(40), le32(32), le32(-16 >>> 0), [0, 0, 0, 0]);
    expect(measureBinary("a.bmp", bmp, det()).facts).toEqual({ width: 32, height: 16, format: "BMP" });
    const ico = bytes([0, 0, 1, 0, 1, 0], [0, 48, 0, 0]);
    expect(measureBinary("a.ico", ico, det()).facts).toEqual({ width: 256, height: 48, format: "ICO" });
  });

  test("format passes through from detection; hash covers the bytes", () => {
    const b = bytes("\x7fELF", [2, 1, 1, 0, 0, 0, 0, 0]);
    const r = measureBinary("a.out", b, det("ELF"));
    expect(r.facts).toEqual({ format: "ELF" });
    expect(r.hash).toBe(new Bun.CryptoHasher("sha1").update(b).digest("hex").slice(0, 16));
  });
});
