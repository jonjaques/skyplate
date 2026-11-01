/**
 * Format-specific facts read cheaply from a file's text or header bytes: image dimensions,
 * notebook cell counts, CSV shape, Markdown headings and links, top-level key counts.
 *
 * Every reader here is bounded: headers are read from fixed offsets, text scans are linear and
 * capped, and anything that needs a full parse (JSON, TOML) is skipped past PARSE_LIMIT. A fact
 * that cannot be read cheaply is omitted rather than estimated, because the viewer shows these
 * numbers as facts.
 */

import type { FileFacts } from "../shared/schema";

/** Full parses (JSON, TOML) are skipped above this size; their key count isn't worth 100 ms. */
const PARSE_LIMIT = 2 * 1024 * 1024;
/** CSV is scanned quote-aware up to this many characters; beyond it, rows come from newlines. */
const CSV_EXACT_LIMIT = 32 * 1024 * 1024;
/** Notebooks with embedded outputs get large; past this, cells are not parsed. */
export const NOTEBOOK_LIMIT = 32 * 1024 * 1024;

// ─── Text dispatch ───────────────────────────────────────────────────────────────────────────

/** Facts for a text file, by language id. Notebooks are handled by metrics.ts (see below). */
export function textFacts(text: string, languageId: string, path: string): FileFacts | undefined {
  switch (languageId) {
    case "markdown":
    case "mdx":
    case "rmarkdown":
      return markdownFacts(text);
    case "asciidoc":
      return asciidocFacts(text);
    case "restructuredtext":
      return rstFacts(text);
    case "csv":
      return csvFacts(text, sniffDelimiter(text));
    case "tsv":
      return csvFacts(text, 9);
    case "json":
    case "jsonld":
    case "json-with-comments":
    case "json5":
      return jsonFacts(text, languageId !== "json" && languageId !== "jsonld");
    case "yaml":
    case "miniyaml":
      return yamlFacts(text);
    case "toml":
      return tomlFacts(text);
    case "svg":
      return svgFacts(text);
    default:
      // Lockfiles and the like can be JSON under another language id; only the formats above
      // promise a meaningful key count.
      if (path.endsWith(".json") && languageId === "text") return jsonFacts(text, false);
      return undefined;
  }
}

// ─── Markdown, AsciiDoc, reStructuredText ────────────────────────────────────────────────────

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Inline links and images: [text](target) — the target up to whitespace or `)`.
const INLINE_LINK = /!?\[(?:[^\]\\\n]|\\.){0,500}\]\(\s*<?([^)\s>]{1,2000})/g;
// Reference definitions: [label]: target
const REF_DEF = /^ {0,3}\[[^\]\n]{1,500}\]:[ \t]*<?(\S{1,2000}?)>?(?:[ \t]|$)/;
const AUTOLINK = /<(?:https?|ftp|mailto):[^>\s]{1,2000}>/g;
const HTML_LINK = /<(?:a|img|source|link|script)\b[^>]{0,1000}?\b(?:href|src)\s*=\s*["']([^"']{1,2000})["']/gi;

export function markdownFacts(text: string): FileFacts {
  const lines = text.split(/\r\n|\r|\n/);
  let headings = 0;
  let title: string | undefined;
  let frontTitle: string | undefined;
  let links = 0;
  let fence = "";
  let prevParagraph = false; // previous line could be a setext heading's text
  let prevText = "";
  let start = 0;

  // YAML front matter is metadata, not body; its `title:` is the fallback title.
  if (lines[0] !== undefined && /^---[ \t]*$/.test(lines[0].replace(/^﻿/, ""))) {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
        start = i + 1;
        break;
      }
      const m = /^title:\s*["']?(.*?)["']?\s*$/.exec(line);
      if (m?.[1]) frontTitle = m[1];
    }
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = "";
      continue;
    }
    const f = FENCE.exec(line);
    if (f?.[1]) {
      fence = f[1];
      prevParagraph = false;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx?.[1]) {
      headings++;
      if (title === undefined && atx[1].length === 1 && atx[2]) title = plainHeading(atx[2]);
      prevParagraph = false;
      continue;
    }
    if (prevParagraph && (SETEXT_H1.test(line) || SETEXT_H2.test(line))) {
      headings++;
      if (title === undefined && SETEXT_H1.test(line)) title = plainHeading(prevText);
      prevParagraph = false;
      continue;
    }
    const ref = REF_DEF.exec(line);
    if (ref) {
      links++;
      prevParagraph = false;
      continue;
    }
    // Inline code spans hide link syntax; strip them before counting.
    const body = line.includes("`") ? line.replace(/`+[^`]*`+/g, "") : line;
    links += countMatches(body, INLINE_LINK) + countMatches(body, AUTOLINK) + countMatches(body, HTML_LINK);
    const trimmed = line.trim();
    // A setext underline needs paragraph text above it: not a list item, quote, or table rule.
    prevParagraph = trimmed !== "" && !/^(?:[-*+]|\d+[.)])\s/.test(trimmed) && !trimmed.startsWith(">") && !line.startsWith("    ");
    prevText = trimmed;
  }

  const facts: FileFacts = { headings, links };
  const t = title ?? (frontTitle ? plainHeading(frontTitle) : undefined);
  if (t) facts.title = t;
  return facts;
}

function asciidocFacts(text: string): FileFacts {
  let headings = 0;
  let title: string | undefined;
  let fence = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (/^(?:----|\.\.\.\.|````)\s*$/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(=+)[ \t]+(\S.*)$/.exec(line);
    if (m?.[1] && m[2]) {
      headings++;
      if (title === undefined && m[1].length === 1) title = plainHeading(m[2]);
    }
  }
  const facts: FileFacts = { headings };
  if (title) facts.title = title;
  return facts;
}

/** RST headings are text lines underlined (optionally overlined) by one repeated punctuation char. */
function rstFacts(text: string): FileFacts {
  const lines = text.split(/\r\n|\r|\n/);
  let headings = 0;
  let title: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const under = lines[i] ?? "";
    const above = (lines[i - 1] ?? "").trim();
    if (above === "" || under.length < 2) continue;
    if (!/^([=\-~^"'`#*+:.])\1+\s*$/.test(under)) continue;
    if (/^([=\-~^"'`#*+:.])\1+\s*$/.test(above)) continue; // the overline itself
    if (under.trimEnd().length < above.length) continue;
    headings++;
    title ??= plainHeading(above);
  }
  const facts: FileFacts = { headings };
  if (title) facts.title = title;
  return facts;
}

/** Heading text with inline markup removed, capped for display. */
function plainHeading(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function countMatches(s: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) n++;
  return n;
}

// ─── CSV / TSV ───────────────────────────────────────────────────────────────────────────────

/** Comma unless the header line has none and uses semicolons (European spreadsheet exports). */
function sniffDelimiter(text: string): number {
  const end = text.search(/\r|\n/);
  const header = end < 0 ? text : text.slice(0, end);
  if (!header.includes(",") && header.includes(";")) return 59;
  return 44;
}

/**
 * Records and columns, quote-aware: a quoted field may contain the delimiter, doubled quotes and
 * line breaks. Blank lines are not records. Past CSV_EXACT_LIMIT the record count falls back to
 * line breaks, which only differs when quoted fields span lines.
 */
export function csvFacts(text: string, delim: number): FileFacts {
  const n = text.length;
  let rows = 0;
  let columns = 0;
  let fields = 1;
  let content = false;
  let header = true;
  let inQuote = false;
  const exactEnd = Math.min(n, CSV_EXACT_LIMIT);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRecord = () => {
    if (content || fields > 1) {
      if (header) {
        columns = fields;
        header = false;
      } else rows++;
    }
    fields = 1;
    content = false;
  };

  for (; i < exactEnd; i++) {
    const c = text.charCodeAt(i);
    if (inQuote) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) i++;
        else inQuote = false;
      }
      continue;
    }
    if (c === 34) {
      inQuote = true;
      content = true;
    } else if (c === delim) {
      fields++;
      content = true;
    } else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      endRecord();
    } else if (c > 32) content = true;
  }
  if (exactEnd < n) {
    // Approximate tail: count line breaks the cheap way.
    let p = exactEnd;
    for (;;) {
      const nl = text.indexOf("\n", p);
      if (nl < 0) break;
      rows++;
      p = nl + 1;
    }
    if (p < n) rows++;
  } else endRecord();
  return { rows, columns };
}

// ─── Key counts ──────────────────────────────────────────────────────────────────────────────

function jsonFacts(text: string, comments: boolean): FileFacts | undefined {
  if (text.length > PARSE_LIMIT) return undefined;
  const value = comments ? parseJsonc(text) : tryParse(text);
  if (value && typeof value === "object" && !Array.isArray(value)) return { keys: Object.keys(value).length };
  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
}

/**
 * Parse JSON with comments and trailing commas (tsconfig.json, .vscode/settings.json, JSON5-
 * lite). Comments are removed string-aware so "http://x" survives; returns undefined when the
 * result is still not JSON (unquoted keys, single quotes), since guessing would be worse.
 */
export function parseJsonc(text: string): unknown {
  const plain = tryParse(text);
  if (plain !== undefined) return plain;
  let out = "";
  let last = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      for (i++; i < n; i++) {
        const d = text.charCodeAt(i);
        if (d === 92) i++;
        else if (d === 34) break;
      }
    } else if (c === 47 && text.charCodeAt(i + 1) === 47) {
      out += text.slice(last, i);
      while (i < n && text.charCodeAt(i) !== 10) i++;
      last = i;
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      out += text.slice(last, i);
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 1;
      last = i + 1;
    }
  }
  out += text.slice(last);
  // Trailing commas: `,` followed only by whitespace before `}` or `]`. Applied after comment
  // removal, and only outside strings in practice because a string cannot end in `,\s*}`.
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return tryParse(out);
}

/**
 * Top-level YAML keys by line shape: a key at column 0 followed by `:`. A full parse would choke
 * on custom tags (CloudFormation's !Ref) and costs far more than this. Only the first document
 * of a multi-document stream counts.
 */
function yamlFacts(text: string): FileFacts | undefined {
  let keys = 0;
  let seenContent = false;
  const re = /^(?:---|\.\.\.)|^("[^"\n]*"|'[^'\n]*'|[^\s#\-?:,\[\]{}&*!|>'"%@`][^\n:#]*?)[ \t]*:(?:[ \t]|$)/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === undefined) {
      if (seenContent) break;
      continue;
    }
    seenContent = true;
    keys++;
  }
  return seenContent ? { keys } : undefined;
}

function tomlFacts(text: string): FileFacts | undefined {
  if (text.length > PARSE_LIMIT) return undefined;
  try {
    const value = Bun.TOML.parse(text);
    if (value && typeof value === "object") return { keys: Object.keys(value).length };
  } catch {
    // Invalid TOML (templates, partial files): no fact rather than a guessed one.
  }
  return undefined;
}

// ─── SVG ─────────────────────────────────────────────────────────────────────────────────────

/** Width/height attributes in user units (px or unitless); otherwise the viewBox size. */
export function svgFacts(text: string): FileFacts | undefined {
  const m = /<svg\b([^>]*)>/i.exec(text.length > 65536 ? text.slice(0, 65536) : text);
  if (!m?.[1]) return undefined;
  const attrs = m[1];
  const attr = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
  const px = (v: string | undefined) => {
    const p = v && /^\s*([\d.]+)\s*(px)?\s*$/.exec(v);
    return p?.[1] ? Number(p[1]) : undefined;
  };
  let width = px(attr("width"));
  let height = px(attr("height"));
  if (width === undefined || height === undefined) {
    const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
      width ??= vb[2];
      height ??= vb[3];
    }
  }
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return { width, height };
}

// ─── Notebooks ───────────────────────────────────────────────────────────────────────────────

export interface NotebookCells {
  facts: FileFacts;
  /** Language id derived from the kernel's language name, when one is declared. */
  languageId?: string;
  code: string[];
  markdown: string[];
}

interface RawCell {
  cell_type?: string;
  source?: string | string[];
  input?: string | string[];
}

/** Cells and kernel of a .ipynb (nbformat 4, and 3's worksheets), or undefined if not JSON. */
export function parseNotebook(text: string): NotebookCells | undefined {
  if (text.length > NOTEBOOK_LIMIT) return undefined;
  const nb = tryParse(text) as
    | {
        cells?: RawCell[];
        worksheets?: { cells?: RawCell[] }[];
        metadata?: { kernelspec?: { language?: string; name?: string }; language_info?: { name?: string }; language?: string };
      }
    | undefined;
  if (!nb || typeof nb !== "object") return undefined;
  const cells = Array.isArray(nb.cells) ? nb.cells : (nb.worksheets?.[0]?.cells ?? []);
  if (!Array.isArray(cells)) return undefined;
  const code: string[] = [];
  const markdown: string[] = [];
  for (const cell of cells) {
    const src = cell?.source ?? cell?.input ?? "";
    const body = Array.isArray(src) ? src.join("") : String(src);
    if (cell?.cell_type === "code") code.push(body);
    else markdown.push(body); // markdown, raw and heading (nbformat 3) cells are all prose
  }
  const meta = nb.metadata ?? {};
  const kernel = meta.kernelspec?.language ?? meta.language_info?.name ?? meta.language ?? meta.kernelspec?.name;
  const facts: FileFacts = {
    cells: cells.length,
    codeCells: code.length,
    markdownCells: cells.filter((c) => c?.cell_type === "markdown").length,
  };
  const result: NotebookCells = { facts, code, markdown };
  if (typeof kernel === "string" && kernel) {
    facts.kernel = kernel;
    const id = kernel.toLowerCase().replace(/ /g, "-");
    result.languageId = id.startsWith("python") ? "python" : id;
  }
  return result;
}

// ─── Binary headers ──────────────────────────────────────────────────────────────────────────

/** Pixel dimensions from an image header, or undefined when the format isn't recognized. */
export function imageSize(b: Uint8Array): { width: number; height: number; format: string } | undefined {
  const n = b.length;
  if (n < 10) return undefined;
  const u16be = (o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
  const u16le = (o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
  const u32be = (o: number) => (((b[o] ?? 0) << 24) >>> 0) + ((b[o + 1] ?? 0) << 16) + ((b[o + 2] ?? 0) << 8) + (b[o + 3] ?? 0);
  const u32le = (o: number) => (b[o] ?? 0) + ((b[o + 1] ?? 0) << 8) + ((b[o + 2] ?? 0) << 16) + (((b[o + 3] ?? 0) << 24) >>> 0);
  const ascii = (o: number, s: string) => {
    for (let k = 0; k < s.length; k++) if (b[o + k] !== s.charCodeAt(k)) return false;
    return true;
  };
  const ok = (width: number, height: number, format: string) =>
    width > 0 && height > 0 && width < 1e6 && height < 1e6 ? { width, height, format } : undefined;

  // PNG: signature, then IHDR is required to be the first chunk.
  if (b[0] === 0x89 && ascii(1, "PNG") && n >= 24 && ascii(12, "IHDR")) return ok(u32be(16), u32be(20), "PNG");
  if (ascii(0, "GIF8")) return ok(u16le(6), u16le(8), "GIF");
  // JPEG: walk segments to the first SOFn (frame header), which precedes the scan data.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < n) {
      if (b[p] !== 0xff) return undefined;
      let marker = b[p + 1] ?? 0;
      while (marker === 0xff && p + 2 < n) marker = b[++p + 1] ?? 0;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return undefined;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok(u16be(p + 7), u16be(p + 5), "JPEG");
      }
      p += 2 + u16be(p + 2);
    }
    return undefined;
  }
  if (ascii(0, "RIFF") && ascii(8, "WEBP") && n >= 30) {
    if (ascii(12, "VP8 ")) return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff, "WebP");
    if (ascii(12, "VP8L")) {
      const b1 = b[22] ?? 0;
      const b2 = b[23] ?? 0;
      const b3 = b[24] ?? 0;
      return ok(1 + ((b[21] ?? 0) | ((b1 & 0x3f) << 8)), 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)), "WebP");
    }
    if (ascii(12, "VP8X")) {
      const w = 1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16));
      const h = 1 + ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16));
      return ok(w, h, "WebP");
    }
    return undefined;
  }
  if (ascii(0, "BM") && n >= 26) {
    // BITMAPCOREHEADER (12 bytes) stores 16-bit sizes; every later header stores 32-bit ones,
    // with a negative height meaning top-down rows.
    if (u32le(14) === 12) return ok(u16le(18), u16le(20), "BMP");
    return ok(Math.abs(u32le(18) | 0), Math.abs(u32le(22) | 0), "BMP");
  }
  // ICO / CUR: the first directory entry; a stored 0 means 256.
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0 && u16le(4) > 0 && n >= 8) {
    return ok(b[6] || 256, b[7] || 256, b[2] === 1 ? "ICO" : "CUR");
  }
  if (ascii(0, "8BPS") && n >= 22) return ok(u32be(18), u32be(14), "PSD");
  if (ascii(0, "qoif") && n >= 12) return ok(u32be(4), u32be(8), "QOI");
  // TIFF: walk the first IFD for ImageWidth (256) and ImageLength (257).
  if ((ascii(0, "II") && b[2] === 42 && b[3] === 0) || (ascii(0, "MM") && b[2] === 0 && b[3] === 42)) {
    const le = b[0] === 0x49;
    const r16 = le ? u16le : u16be;
    const r32 = le ? u32le : u32be;
    const ifd = r32(4);
    const count = r16(ifd);
    let w = 0;
    let h = 0;
    for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= n; k++) {
      const e = ifd + 2 + k * 12;
      const tag = r16(e);
      const value = r16(e + 2) === 3 ? r16(e + 8) : r32(e + 8);
      if (tag === 256) w = value;
      else if (tag === 257) h = value;
    }
    return ok(w, h, "TIFF");
  }
  // HEIF family (AVIF, HEIC): the `ispe` property carries the image spatial extent. Searching
  // the first 64 KiB is enough because the meta box precedes media data in every real file.
  if (n >= 16 && ascii(4, "ftyp")) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    const format = brand.startsWith("avi") ? "AVIF" : brand.startsWith("hei") || brand.startsWith("hev") || brand === "mif1" ? "HEIF" : "";
    if (!format) return undefined;
    const limit = Math.min(n - 16, 65536);
    for (let p = 12; p < limit; p++) {
      if (b[p] === 0x69 && ascii(p, "ispe")) return ok(u32be(p + 8), u32be(p + 12), format);
    }
  }
  return undefined;
}
