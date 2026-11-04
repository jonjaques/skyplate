/**
 * detectFile: what a file is (language, category) and what is true of it (binary, generated,
 * vendored, secret), from its path and its first ≤ 8 KiB.
 *
 * Language strategy, in order (mirrors linguist's, with the classifier replaced by a ranked
 * default, see registry.ts):
 *   binary sniff → modeline → exact filename → extension (+ heuristics when shared) →
 *   shebang → text-shape sniff → "text".
 * Modelines go first, as in linguist, because they are the author's explicit statement:
 * "-*- C++ -*-" in a .h file or "vim: ft=python" in a .cfg beats any guess from the name.
 * On linguist's samples/ tree, moving them after the shebang step (the brief's order) got
 * 2 of 3,404 files wrong that modeline-first gets right, and fixed none.
 *
 * Category is decided after the language, from path conventions first (lockfile, test, docs,
 * build, config) and the language's type last, because the same language serves different
 * purposes: YAML is data in a fixture, config in .golangci.yml, build in .github/workflows.
 *
 * Everything here is a pure function of (path, head). It runs once per file on 50k-file
 * repositories, so no step allocates more than a decoded head and nothing is quadratic.
 */

import type { Category, DetectionReason } from "../../shared/schema";
import type { DetectFile, Detection } from "../contracts";
import { runHeuristics } from "./heuristics";
import { DOCUMENTATION_PATTERNS, GENERIC_EXTENSIONS, VENDOR_PATTERNS } from "./linguist.generated";
import {
  BINARY,
  TEXT,
  languageForAlias,
  languageType,
  languagesForExtension,
  languagesForFilename,
  languagesForFilenameIgnoringCase,
  languagesForInterpreter,
} from "./registry";

// ─── Text decoding ───────────────────────────────────────────────────────────────────────────

const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");
const utf16le = new TextDecoder("utf-16le");
const utf16be = new TextDecoder("utf-16be");

/** The head is cut at 8 KiB, often mid-character; drop a dangling multibyte lead so the
 * strict decoder judges the content, not where the walker happened to stop reading. */
function trimPartialUtf8(b: Uint8Array): Uint8Array {
  const n = b.length;
  let i = n - 1;
  let cont = 0;
  while (i >= 0 && cont < 3 && (b[i]! & 0xc0) === 0x80) {
    i--;
    cont++;
  }
  if (i < 0) return b;
  const lead = b[i]!;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return need > n - i ? b.subarray(0, i) : b;
}

/**
 * East Asian legacy encodings spend two high bytes on most characters, so Japanese, Chinese
 * or Korean text runs 40-70% high bytes, far past the Latin-1 cap below. For those heads a
 * strict decode is the evidence instead: random bytes stop forming valid double-byte
 * sequences within a few characters. Shift_JIS is tried first because it is the strictest;
 * GB18030 accepts almost any pair, so it only sees what the others refused. Which one wins
 * matters little here, since detection reads only the ASCII in the head (names, keywords,
 * comment markers), and every candidate leaves ASCII alone.
 */
const CJK_ENCODINGS = ["shift_jis", "euc-kr", "gb18030"] as const;

function decodeCjk(head: Uint8Array): string | undefined {
  for (const enc of CJK_ENCODINGS) {
    try {
      // Streaming holds back a character cut at the 8 KiB boundary instead of failing on it.
      return new TextDecoder(enc, { fatal: true }).decode(head, { stream: true });
    } catch {
      // Not this encoding; try the next.
    }
  }
  return undefined;
}

/**
 * Decode the head, or report it binary. NUL bytes mean binary except under a UTF-16 BOM.
 * Invalid UTF-8 also means binary, with two allowances for heads whose only control bytes are
 * whitespace, BEL, BS and ESC. Under 30% high bytes, it is legacy 8-bit text (Latin-1 /
 * Windows-1252 source with an accented author name is common in older C and Delphi trees).
 * Over that, it is text if it decodes strictly as Shift_JIS, EUC-KR or GB18030. Calling
 * either binary would drop real code from every metric.
 */
function decodeHead(head: Uint8Array): { text: string; binary: boolean } {
  const n = head.length;
  if (n === 0) return { text: "", binary: false };
  if (n >= 2 && head[0] === 0xff && head[1] === 0xfe) return { text: utf16le.decode(head.subarray(2)), binary: false };
  if (n >= 2 && head[0] === 0xfe && head[1] === 0xff) return { text: utf16be.decode(head.subarray(2)), binary: false };
  if (head.indexOf(0) >= 0) return { text: "", binary: true };
  const start = n >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  try {
    return { text: utf8.decode(trimPartialUtf8(head.subarray(start))), binary: false };
  } catch {
    let high = 0;
    let spaced = false;
    for (let i = 0; i < n; i++) {
      const c = head[i]!;
      if (c >= 0x80) high++;
      else if (c === 0x20 || c === 0x0a) spaced = true;
      // BEL and backspace are allowed: nroff overstrike (bold as "x\bx") is full of them.
      else if (c < 0x07 || (c > 0x0d && c < 0x20 && c !== 0x1b)) return { text: "", binary: true };
    }
    if (high / n <= 0.3) return { text: cp1252.decode(head), binary: false };
    // Prose and source both have spaces or line breaks; a short random blob that happens to
    // decode as GB18030 usually has neither.
    const cjk = spaced ? decodeCjk(head) : undefined;
    return cjk === undefined ? { text: "", binary: true } : { text: cjk, binary: false };
  }
}

// ─── Magic numbers ───────────────────────────────────────────────────────────────────────────

interface Format {
  format: string;
  category: Category;
}

const at = (b: Uint8Array, off: number, s: string): boolean => {
  if (b.length < off + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
  return true;
};
const bytes = (b: Uint8Array, off: number, ...v: number[]): boolean => {
  if (b.length < off + v.length) return false;
  for (let i = 0; i < v.length; i++) if (b[off + i] !== v[i]) return false;
  return true;
};
const u32be = (b: Uint8Array, off: number) =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

/** ZIP containers are named by what is inside, which the extension states reliably. */
const ZIP_KINDS: Record<string, Format> = {
  docx: { format: "DOCX", category: "docs" },
  pptx: { format: "PPTX", category: "docs" },
  odt: { format: "ODT", category: "docs" },
  odp: { format: "ODP", category: "docs" },
  epub: { format: "EPUB", category: "docs" },
  // iWork documents are ZIP since 2013. A Keynote deck shares .key with private keys, and the
  // ZIP magic is what tells them apart (see isSecret).
  key: { format: "Keynote", category: "docs" },
  pages: { format: "Pages", category: "docs" },
  numbers: { format: "Numbers", category: "data" },
  xlsx: { format: "XLSX", category: "data" },
  ods: { format: "ODS", category: "data" },
  npz: { format: "NumPy NPZ", category: "data" },
  kmz: { format: "KMZ", category: "data" },
  jar: { format: "JAR", category: "archive" },
  war: { format: "WAR", category: "archive" },
  ear: { format: "EAR", category: "archive" },
  aar: { format: "AAR", category: "archive" },
  apk: { format: "APK", category: "archive" },
  aab: { format: "AAB", category: "archive" },
  ipa: { format: "IPA", category: "archive" },
  whl: { format: "Wheel", category: "archive" },
  egg: { format: "Egg", category: "archive" },
  nupkg: { format: "NuGet", category: "archive" },
  vsix: { format: "VSIX", category: "archive" },
  xpi: { format: "XPI", category: "archive" },
  crx: { format: "CRX", category: "archive" },
  pt: { format: "PyTorch", category: "binary" },
  pth: { format: "PyTorch", category: "binary" },
  usdz: { format: "USDZ", category: "binary" },
  sketch: { format: "Sketch", category: "image" },
  "3mf": { format: "3MF", category: "binary" },
};

/** Binaries with no dependable magic number, named by extension once the bytes say binary. */
const BINARY_EXT: Record<string, Format> = {
  onnx: { format: "ONNX", category: "binary" },
  pb: { format: "Protobuf", category: "binary" },
  tflite: { format: "TFLite", category: "binary" },
  pkl: { format: "Pickle", category: "binary" },
  pickle: { format: "Pickle", category: "binary" },
  joblib: { format: "Pickle", category: "binary" },
  ckpt: { format: "Checkpoint", category: "binary" },
  pyc: { format: "Python bytecode", category: "binary" },
  pyo: { format: "Python bytecode", category: "binary" },
  o: { format: "Object file", category: "binary" },
  obj: { format: "Object file", category: "binary" },
  lib: { format: "Library", category: "binary" },
  pdb: { format: "PDB", category: "binary" },
  tga: { format: "TGA", category: "image" },
  eot: { format: "EOT", category: "font" },
  pfb: { format: "Type 1", category: "font" },
  mp3: { format: "MP3", category: "media" },
  aac: { format: "AAC", category: "media" },
  m4a: { format: "M4A", category: "media" },
  wma: { format: "WMA", category: "media" },
  ts: { format: "MPEG-TS", category: "media" },
  mts: { format: "MPEG-TS", category: "media" },
  p12: { format: "PKCS#12", category: "binary" },
  pfx: { format: "PKCS#12", category: "binary" },
  der: { format: "DER", category: "binary" },
  dat: { format: "Data", category: "binary" },
};

const FTYP_IMAGE = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "crx "]);
const FTYP_AUDIO = new Set(["M4A ", "M4B ", "M4P ", "F4A "]);

function ftyp(b: Uint8Array): Format | undefined {
  if (!at(b, 4, "ftyp") || b.length < 12) return undefined;
  const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
  if (FTYP_IMAGE.has(brand)) {
    const label = brand.startsWith("av") ? "AVIF" : brand === "crx " ? "CR3" : "HEIC";
    return { format: label, category: "image" };
  }
  if (FTYP_AUDIO.has(brand)) return { format: "M4A", category: "media" };
  if (brand === "qt  ") return { format: "MOV", category: "media" };
  if (brand.startsWith("3g")) return { format: "3GP", category: "media" };
  return { format: "MP4", category: "media" };
}

/** Formats that are a compression stream on the outside: the magic says GZIP or ZSTD, the
 * extension says what the user actually has (Blender 3+ saves zstd-compressed .blend files). */
const COMPRESSED_AS: Record<string, Format> = {
  blend: { format: "Blender", category: "binary" },
  svgz: { format: "SVGZ", category: "image" },
  tgz: { format: "TGZ", category: "archive" },
};

/** Identify a binary by its leading bytes. `ext` is lowercased without the dot. */
function sniffMagic(b: Uint8Array, ext: string): Format | undefined {
  const f = sniffMagicRaw(b, ext);
  if (f?.category === "archive" && COMPRESSED_AS[ext]) return COMPRESSED_AS[ext];
  return f;
}

function sniffMagicRaw(b: Uint8Array, ext: string): Format | undefined {
  const n = b.length;
  if (n < 2) return undefined;
  // Images
  if (bytes(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { format: "PNG", category: "image" };
  if (bytes(b, 0, 0xff, 0xd8, 0xff)) return { format: "JPEG", category: "image" };
  if (at(b, 0, "GIF87a") || at(b, 0, "GIF89a")) return { format: "GIF", category: "image" };
  if (at(b, 0, "RIFF") && at(b, 8, "WEBP")) return { format: "WEBP", category: "image" };
  if (bytes(b, 0, 0, 0, 1, 0) && n > 6) return { format: "ICO", category: "image" };
  if (bytes(b, 0, 0, 0, 2, 0) && ext === "cur") return { format: "CUR", category: "image" };
  if (at(b, 0, "II*\0") || at(b, 0, "MM\0*")) return { format: "TIFF", category: "image" };
  if (at(b, 0, "8BPS")) return { format: "PSD", category: "image" };
  if (at(b, 0, "icns")) return { format: "ICNS", category: "image" };
  if (at(b, 0, "qoif")) return { format: "QOI", category: "image" };
  if (at(b, 0, "gimp xcf")) return { format: "XCF", category: "image" };
  if (bytes(b, 0, 0x76, 0x2f, 0x31, 0x01)) return { format: "OpenEXR", category: "image" };
  if (at(b, 0, "DDS ")) return { format: "DDS", category: "image" };
  if (bytes(b, 0, 0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20)) return { format: "JPEG 2000", category: "image" };
  if (bytes(b, 0, 0xff, 0x0a) || bytes(b, 0, 0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20)) return { format: "JPEG XL", category: "image" };
  // "BM" is two printable letters, so it only counts with the extension agreeing.
  if (at(b, 0, "BM") && (ext === "bmp" || ext === "dib")) return { format: "BMP", category: "image" };
  const ft = ftyp(b);
  if (ft) return ft;
  // Documents
  if (at(b, 0, "%PDF-")) return { format: "PDF", category: "docs" };
  // Archives and containers
  if (at(b, 0, "PK\x03\x04") || at(b, 0, "PK\x05\x06") || at(b, 0, "PK\x07\x08")) {
    return ZIP_KINDS[ext] ?? { format: "ZIP", category: "archive" };
  }
  if (bytes(b, 0, 0x1f, 0x8b)) return { format: "GZIP", category: "archive" };
  if (at(b, 0, "BZh") && n > 3 && b[3]! >= 0x31 && b[3]! <= 0x39) return { format: "BZIP2", category: "archive" };
  if (bytes(b, 0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)) return { format: "XZ", category: "archive" };
  if (bytes(b, 0, 0x28, 0xb5, 0x2f, 0xfd)) return { format: "ZSTD", category: "archive" };
  if (bytes(b, 0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return { format: "7z", category: "archive" };
  if (at(b, 0, "Rar!\x1a\x07")) return { format: "RAR", category: "archive" };
  if (bytes(b, 0, 0x04, 0x22, 0x4d, 0x18)) return { format: "LZ4", category: "archive" };
  if (bytes(b, 0, 0x1f, 0x9d)) return { format: "Unix compress", category: "archive" };
  if (at(b, 0, "MSCF")) return { format: "CAB", category: "archive" };
  if (bytes(b, 0, 0xed, 0xab, 0xee, 0xdb)) return { format: "RPM", category: "archive" };
  if (at(b, 0, "!<arch>\ndebian")) return { format: "DEB", category: "archive" };
  if (at(b, 0, "!<arch>\n")) return { format: "ar archive", category: "binary" };
  if (at(b, 257, "ustar")) return { format: "TAR", category: "archive" };
  // Executables and bytecode
  if (bytes(b, 0, 0x7f, 0x45, 0x4c, 0x46)) return { format: "ELF", category: "binary" };
  if (
    bytes(b, 0, 0xfe, 0xed, 0xfa, 0xce) ||
    bytes(b, 0, 0xfe, 0xed, 0xfa, 0xcf) ||
    bytes(b, 0, 0xce, 0xfa, 0xed, 0xfe) ||
    bytes(b, 0, 0xcf, 0xfa, 0xed, 0xfe)
  ) {
    return { format: "Mach-O", category: "binary" };
  }
  if (bytes(b, 0, 0xca, 0xfe, 0xba, 0xbe) || bytes(b, 0, 0xca, 0xfe, 0xba, 0xbf)) {
    // Java class files and fat Mach-O binaries share CAFEBABE. The next word is the class
    // file's version (major ≥ 45) or the fat header's architecture count (a handful).
    if (n >= 8 && u32be(b, 4) < 40) return { format: "Mach-O", category: "binary" };
    return { format: "Java class", category: "binary" };
  }
  if (at(b, 0, "MZ")) return { format: "PE/COFF", category: "binary" };
  if (bytes(b, 0, 0x00, 0x61, 0x73, 0x6d)) return { format: "WASM", category: "binary" };
  if (at(b, 0, "dex\n")) return { format: "DEX", category: "binary" };
  if (at(b, 0, "BC\xc0\xde")) return { format: "LLVM bitcode", category: "binary" };
  if (bytes(b, 0, 0x1b, 0x4c, 0x75, 0x61)) return { format: "Lua bytecode", category: "binary" };
  if (at(b, 0, "FOR1") && at(b, 8, "BEAM")) return { format: "BEAM", category: "binary" };
  if (bytes(b, 0, 0xde, 0x12, 0x04, 0x95) || bytes(b, 0, 0x95, 0x04, 0x12, 0xde)) return { format: "gettext MO", category: "binary" };
  if (bytes(b, 0, 0xfe, 0xed, 0xfe, 0xed)) return { format: "Java KeyStore", category: "binary" };
  if (bytes(b, 0, 0x03, 0xd9, 0xa2, 0x9a)) return { format: "KeePass", category: "binary" };
  if (at(b, 0, "PACK")) return { format: "Git pack", category: "binary" };
  if (bytes(b, 0, 0, 0, 0, 1) && at(b, 4, "Bud1")) return { format: "DS_Store", category: "binary" };
  // Databases, data and model weights
  if (at(b, 0, "SQLite format 3\0")) return { format: "SQLite", category: "data" };
  if (at(b, 0, "PAR1")) return { format: "Parquet", category: "data" };
  if (at(b, 0, "ARROW1")) return { format: "Arrow", category: "data" };
  if (at(b, 0, "FEA1")) return { format: "Feather", category: "data" };
  if (at(b, 0, "\x93NUMPY")) return { format: "NumPy", category: "data" };
  if (bytes(b, 0, 0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a)) return { format: "HDF5", category: "data" };
  if (at(b, 0, "bplist00")) return { format: "Binary plist", category: "data" };
  if (at(b, 0, "GGUF")) return { format: "GGUF", category: "binary" };
  // safetensors: an 8-byte little-endian header length, then the JSON header itself.
  if (n > 9 && b[8] === 0x7b && b[9] === 0x22 && b[6] === 0 && b[7] === 0) return { format: "safetensors", category: "binary" };
  if (at(b, 4, "TFL3")) return { format: "TFLite", category: "binary" };
  if (at(b, 0, "glTF")) return { format: "GLB", category: "binary" };
  if (at(b, 0, "BLENDER")) return { format: "Blender", category: "binary" };
  if (at(b, 0, "Kaydara FBX Binary")) return { format: "FBX", category: "binary" };
  // Pickle protocol 2+ opens with PROTO (0x80) and a version byte.
  if (b[0] === 0x80 && b[1]! >= 2 && b[1]! <= 5 && (ext === "pkl" || ext === "pickle" || ext === "joblib")) {
    return { format: "Pickle", category: "binary" };
  }
  // Fonts
  if (bytes(b, 0, 0x00, 0x01, 0x00, 0x00, 0x00) || at(b, 0, "true")) return { format: "TTF", category: "font" };
  if (at(b, 0, "OTTO")) return { format: "OTF", category: "font" };
  if (at(b, 0, "wOFF")) return { format: "WOFF", category: "font" };
  if (at(b, 0, "wOF2")) return { format: "WOFF2", category: "font" };
  if (at(b, 0, "ttcf")) return { format: "TTC", category: "font" };
  // Audio and video
  if (at(b, 0, "ID3")) return { format: "MP3", category: "media" };
  if (at(b, 0, "fLaC")) return { format: "FLAC", category: "media" };
  if (at(b, 0, "OggS")) return { format: "OGG", category: "media" };
  if (at(b, 0, "RIFF") && at(b, 8, "WAVE")) return { format: "WAV", category: "media" };
  if (at(b, 0, "RIFF") && at(b, 8, "AVI ")) return { format: "AVI", category: "media" };
  if (at(b, 0, "FORM") && (at(b, 8, "AIFF") || at(b, 8, "AIFC"))) return { format: "AIFF", category: "media" };
  if (at(b, 0, "MThd")) return { format: "MIDI", category: "media" };
  if (bytes(b, 0, 0x1a, 0x45, 0xdf, 0xa3)) {
    const webm = ext === "webm" || new TextDecoder().decode(b.subarray(0, 64)).includes("webm");
    return { format: webm ? "WebM" : "Matroska", category: "media" };
  }
  if (at(b, 0, "FLV\x01")) return { format: "FLV", category: "media" };
  if (bytes(b, 0, 0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11)) return { format: "ASF", category: "media" };
  if (bytes(b, 0, 0x00, 0x00, 0x01, 0xba) || bytes(b, 0, 0x00, 0x00, 0x01, 0xb3)) return { format: "MPEG", category: "media" };
  if (b[0] === 0x47 && n > 188 && b[188] === 0x47) return { format: "MPEG-TS", category: "media" };
  if (at(b, 0, "#!AMR")) return { format: "AMR", category: "media" };
  // MPEG audio frame sync (11 set bits) is common in random data; trust it only for .mp3.
  if (ext === "mp3" && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return { format: "MP3", category: "media" };
  if (at(b, 0, "FWS") || at(b, 0, "CWS") || at(b, 0, "ZWS")) return { format: "SWF", category: "media" };
  return undefined;
}

// ─── Path helpers ────────────────────────────────────────────────────────────────────────────

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Final extension without the dot, lowercased; "" for none and for bare dotfiles. */
function lastExt(lowerName: string): string {
  const dot = lowerName.lastIndexOf(".");
  return dot > 0 ? lowerName.slice(dot + 1) : "";
}

let vendorRe: RegExp | undefined;
let docRe: RegExp | undefined;
const vendorPattern = () => (vendorRe ??= new RegExp(VENDOR_PATTERNS.map((s) => `(?:${s})`).join("|")));
const docPattern = () => (docRe ??= new RegExp(DOCUMENTATION_PATTERNS.map((s) => `(?:${s})`).join("|")));
const GENERIC = new Set(GENERIC_EXTENSIONS);

// ─── Secrets ─────────────────────────────────────────────────────────────────────────────────

// Templates are meant to be committed and shared. Any dotenv name with one of these segments is
// a template by convention (.env.example, .env.local.example, .env.sample).
const ENV_TEMPLATE = /(?:^|\.)(?:example|sample|template|dist|defaults?)(?:\.|$)/i;

/**
 * Names that hold credentials whatever is inside: key stores, SSH keys, credential dumps, and
 * Terraform state, which stores every resource attribute (database passwords included) in
 * plaintext. .tfvars is here too, though many hold only a region, because its secrets have
 * no fixed key names to look for; GitHub's own Terraform .gitignore excludes it for that
 * reason. kubeconfig carries a cluster token or client key.
 */
const SECRET_NAME =
  /^(?:.+\.(?:p12|pfx|jks|keystore|kdbx|tfstate|tfstate\.backup|tfvars|tfvars\.json|kubeconfig)|id_(?:rsa|dsa|ecdsa|ed25519)|\.htpasswd|\.git-credentials|credentials\.json|service[-_]?account.*\.json|secrets?\.(?:json|ya?ml|toml)|kubeconfig)$/i;

/**
 * Tool configs that only sometimes hold a credential. Committed .npmrc files are mostly
 * settings (engine-strict, ignore-scripts), and flagging those raised a false credentials
 * warning on Express, so each needs its credential in the head, in the tool's own syntax.
 * A value that only references the environment (`_authToken=${NPM_TOKEN}`,
 * `export TOKEN=$(op read …)`) is how these files are meant to be committed, so it does not
 * count. .envrc is direnv's: it exports tokens as often as .env does.
 */
const ENV_REF = String.raw`(?!["']?\$)\S`;
// A Map, not an object literal: a file named "constructor" must not find Object's.
const CREDENTIAL_IN = new Map<string, RegExp>([
  [".npmrc", new RegExp(String.raw`(?:_authToken|_auth|_password)\s*=\s*${ENV_REF}`)],
  [".pypirc", new RegExp(String.raw`^\s*password\s*[=:]\s*${ENV_REF}`, "im")],
  [".netrc", /\bpassword\s+\S/],
  ["_netrc", /\bpassword\s+\S/],
  [
    ".envrc",
    new RegExp(
      String.raw`\b(?:\w+_)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?|AUTH)(?:_\w+)?\s*=\s*${ENV_REF}|:\/\/[^\s:\/@]+:[^\s\/@$]+@`,
      "i",
    ),
  ],
]);

/**
 * Certificates, public keys and CSRs share .pem and .key with private keys. Only a complete
 * head whose PEM armor holds no private key clears one: raw key material has no armor at all
 * (Rails' config/master.key is 32 hex digits), and a truncated head may hide a key behind its
 * certificate chain (HAProxy's combined .pem puts the key last).
 */
const KEY_FILE = /\.(?:pem|key)$/i;
const PEM_ARMOR = /-----BEGIN [A-Z0-9 ]+-----/;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
// A kubeconfig's client key is base64, so the PRIVATE KEY armor is not visible in it.
const EMBEDDED_KEY = /^\s*client-key-data:\s*\S/m;

/** `format` is the magic-number label of a binary head, when it has one. */
function isSecret(path: string, name: string, text: string, complete: boolean, binary: boolean, format?: string): boolean {
  if (name === ".env" || (name.startsWith(".env.") && !ENV_TEMPLATE.test(name.slice(5)))) return true;
  // Wrangler's local secrets, dotenv syntax: .dev.vars, or .dev.vars.<environment>.
  if (name === ".dev.vars" || (name.startsWith(".dev.vars.") && !ENV_TEMPLATE.test(name.slice(10)))) return true;
  if (SECRET_NAME.test(name)) return true;
  // Neither has an extension to catch it by.
  if (/(?:^|\/)\.(?:aws\/credentials|kube\/config)$/.test(path)) return true;
  if (KEY_FILE.test(name)) {
    // A binary .key is DER key material unless its bytes are a Keynote deck.
    if (binary) return format !== "Keynote";
    return !complete || !PEM_ARMOR.test(text) || PRIVATE_KEY.test(text);
  }
  if (CREDENTIAL_IN.get(name)?.test(text)) return true;
  if (!text) return false;
  return (text.includes("PRIVATE KEY") && PRIVATE_KEY.test(text)) || (text.includes("client-key-data") && EMBEDDED_KEY.test(text));
}

// ─── Language: shebang and modeline ──────────────────────────────────────────────────────────

/** Port of linguist's Shebang.interpreter. */
function shebangInterpreter(text: string): string | undefined {
  if (!text.startsWith("#!")) return undefined;
  const nl = text.indexOf("\n");
  const line = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, "");
  const m = /^#!\s*(\S+)/.exec(line);
  if (!m) return undefined;
  let script = m[1]!.slice(m[1]!.lastIndexOf("/") + 1);
  if (script === "env") {
    // Skip env's own flags (-S, -i, --ignore-environment) and VAR=value assignments.
    const tokens = line.slice(m[0].length).trim().split(/\s+/);
    let k = 0;
    while (k < tokens.length && (tokens[k]!.startsWith("-") || /^\S+=\S+$/.test(tokens[k]!))) k++;
    const t = tokens[k];
    if (!t) return undefined;
    script = t.slice(t.lastIndexOf("/") + 1);
  }
  script = script.replace(/\.\d+$/, ""); // "python3.12" → "python3"
  if (script === "sh") {
    // Multi-line hacks that re-exec another interpreter: `exec tclsh "$0" "$@"`.
    for (const l of text.split("\n", 5)) {
      const e = /exec (\w+)[\s"']+\$0[\s"']+\$@/.exec(l);
      if (e) {
        script = e[1]!;
        break;
      }
    }
  }
  // `osascript -l JavaScript` names its language explicitly; leave it to later strategies.
  if (script === "osascript" && /-l\s?/.test(line)) return undefined;
  return script || undefined;
}

function shebangLanguages(text: string): readonly string[] {
  const i = shebangInterpreter(text);
  return i ? languagesForInterpreter(i) : [];
}

// Ports of linguist's EMACS_MODELINE and VIM_MODELINE (written there in Ruby's extended mode).
const EMACS_MODELINE =
  /-\*-(?:[ \t]*(?=[^:;\s]+[ \t]*-\*-)|(?:.*?[ \t;]|(?<=-\*-))[ \t]*mode[ \t]*:[ \t]*)([^:;\s]+)(?=[ \t;]|(?<![-*])-\*-).*?-\*-/i;
const VIM_MODELINE =
  /(?:(?:^|[ \t])(?:vi|Vi(?=m))(?:m[<=>]?[0-9]+|m)?|[ \t]ex)(?=:(?=[ \t]*set?[ \t][^\r\n:]+:)|:(?![ \t]*set?[ \t]))(?:(?:[ \t]*:[ \t]*|[ \t])\w*(?:[ \t]*=(?:[^\\\s]|\\.)*)?)*[ \t:](?:filetype|ft|syntax)[ \t]*=(\w+)(?=$|\s|:)/m;

/** First `n` lines of `text`, without splitting the rest of an 8 KiB head. */
function headLines(text: string, n: number): string {
  let end = -1;
  for (let k = 0; k < n; k++) {
    end = text.indexOf("\n", end + 1);
    if (end < 0) return text;
  }
  return text.slice(0, end);
}

/** Last `n` lines of `text`. */
function tailLines(text: string, n: number): string {
  let start = text.endsWith("\n") ? text.length - 1 : text.length;
  for (let k = 0; k < n; k++) {
    start = text.lastIndexOf("\n", start - 1);
    if (start < 0) return text;
  }
  return text.slice(start + 1);
}

const MODELINE_HINT = /-\*-|(?:vim?|Vim|ex)[<=>]?\d*:/;

/** Modelines live in the first or last five lines. `complete` says the head is the whole file. */
function modelineLanguage(text: string, complete: boolean): string | undefined {
  // Lines are capped so a minified one-liner cannot make the vim pattern backtrack for long.
  const cap = (s: string) => s.split("\n").map((l) => (l.length > 400 ? l.slice(0, 400) : l)).join("\n");
  const header = headLines(text, 5);
  const footer = complete && header.length < text.length ? tailLines(text, 5) : "";
  if (!MODELINE_HINT.test(header) && !MODELINE_HINT.test(footer)) return undefined;
  if (header.includes("UseVimball")) return undefined;
  const scope = cap(footer ? `${header}\n${footer}` : header);
  const m = EMACS_MODELINE.exec(scope) ?? VIM_MODELINE.exec(scope);
  if (!m) return undefined;
  const mode = m[1]!;
  return languageForAlias(mode) ?? languageForAlias(mode.split(",", 1)[0]!);
}

// ─── Language: filename, extension, shape ────────────────────────────────────────────────────

/**
 * Skyplate's additions to linguist's exact-filename table: conventions linguist either
 * leaves to its classifier or does not know. Checked after linguist's own filenames.
 */
const FILENAME_RULES: readonly [RegExp, string][] = [
  // VS Code reads every JSON file in .vscode/ as JSONC; comments in settings.json are normal.
  [/(?:^|\/)\.vscode\/[^/]+\.json$/, "json-with-comments"],
  [/(?:^|\/)(?:tsconfig|jsconfig)[.-][^/]*\.json$/, "json-with-comments"],
  [/(?:^|\/)\.env(?:\.[\w-]+)*$/, "dotenv"],
  // Wrangler's local secrets file is dotenv syntax under its own name.
  [/(?:^|\/)\.dev\.vars(?:\.[\w-]+)?$/, "dotenv"],
  // Project templates ship ignore files as _gitignore because npm drops .gitignore on publish.
  [/(?:^|\/)_(?:gitignore|npmignore|dockerignore)$/, "ignore-list"],
  [/(?:^|\/)(?:Dockerfile|Containerfile)[.-][^/]+$/, "dockerfile"],
  [/(?:^|\/)requirements[\w.-]*\.(?:txt|in)$|(?:^|\/)requirements\/[^/]+\.(?:txt|in)$/, "pip-requirements"],
  // Extensionless prose by convention. A dotted name (CHANGELOG.md) is left to its extension.
  [/(?:^|\/)(?:README|LICEN[CS]E|COPYING|UNLICENSE|AUTHORS|CONTRIBUTORS|CREDITS|NOTICE|PATENTS|CHANGELOG|CHANGES|HISTORY|NEWS|MAINTAINERS|THANKS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|SUPPORT)(?:[-_][A-Za-z0-9-]+)*$/i, TEXT],
  [/(?:^|\/)\.(?:nvmrc|node-version|python-version|ruby-version|tool-versions|terraform-version|go-version|java-version|sdkmanrc|gitkeep|keep|mailmap|nojekyll)$|(?:^|\/)py\.typed$/, TEXT],
];

const HOSTS_LINE = /^\s*(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]*::[0-9a-f:]*)\s+\S/im;

/** Pick among filename candidates (".eslintrc": JSONC or YAML) by the text's shape. */
function byShape(ids: readonly string[], text: string): string {
  if (ids.includes("hosts-file") && HOSTS_LINE.test(text)) return "hosts-file";
  const t = text.trimStart();
  const jsonish = t.startsWith("{") || t.startsWith("[");
  const json = ids.find((id) => id === "json" || id === "json-with-comments" || id === "json5");
  if (jsonish && json) return json;
  if (!jsonish) {
    const other = ids.find((id) => id !== json);
    if (other) return other;
  }
  return ids[0]!;
}

/**
 * Extensions linguist does not know yet. Cursor's rule files (.cursor/rules/*.mdc) are
 * Markdown with YAML frontmatter; as unknown text they were colored with images and binaries.
 */
const EXTRA_EXTENSIONS = new Map<string, readonly string[]>([[".mdc", ["markdown"]]]);

function extensionCandidates(lowerName: string): { ext: string; ids: readonly string[] } | undefined {
  // Longest dotted suffix first: "foo.d.ts" tries ".d.ts" then ".ts"; "x.cmake.in" finds CMake.
  for (let dot = lowerName.indexOf("."); dot >= 0; dot = lowerName.indexOf(".", dot + 1)) {
    const ext = lowerName.slice(dot);
    const ids = languagesForExtension(ext);
    if (ids.length) return { ext, ids };
    const extra = EXTRA_EXTENSIONS.get(ext);
    if (extra) return { ext, ids: extra };
  }
  return undefined;
}

// A document that opens like XML: prolog, comment, DOCTYPE or an element. "<%" (ERB, Gosu
// templates) and "<?php" do not.
const XML_START = /^<(?:\?xml\b|!--|!DOCTYPE\b|[A-Za-z_])/;
// The root's name, past any prolog and comments: "eagle" in <!DOCTYPE eagle SYSTEM ...>.
const XML_ROOT = /^(?:<\?xml\b[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:!DOCTYPE\s+)?([A-Za-z_][\w.-]*)/;

/**
 * Settle a shared extension from the head where no heuristic spoke, before the ranked default
 * would. The default is a prior over all repositories, and it contradicts content that admits
 * one reading: a .mm or .pluginspec that opens with an element is XML, not Objective-C++ or
 * Ruby, and an XML dialect named by its own root (<!DOCTYPE eagle> in a .brd) is that dialect.
 * "<?php" and Mathematica's notebook banner are as plain. With rankedDefault below, these
 * were 9 of the 79 misses on linguist's samples.
 */
function byContent(ids: readonly string[], text: string): string | undefined {
  const t = text.trimStart();
  if (t.startsWith("<?php") && ids.includes("php")) return "php";
  if (ids.includes("wolfram-language") && /^\(\*[^\n]*\b(?:Mathematica|Wolfram)\b/i.test(t)) return "wolfram-language";
  if (!XML_START.test(t)) return undefined;
  const root = XML_ROOT.exec(t)?.[1]?.toLowerCase();
  if (root && ids.includes(root)) return root;
  return ids.includes("xml") ? "xml" : undefined;
}

/** The ranked default, minus XML when the head cannot be XML: a ";;;"-commented .sch is
 * Scheme even though XML outranks Scheme, because an XML document must open with "<". */
function rankedDefault(ids: readonly string[], text: string): string {
  if (ids[0] === "xml" && ids.length > 1 && !XML_START.test(text.trimStart())) return ids[1]!;
  return ids[0]!;
}

/** Last-resort shape sniff for unrecognized names; mirrors linguist's XML strategy, plus HTML. */
function sniffText(text: string, complete: boolean): string | undefined {
  const firstLines = text.slice(0, 512);
  if (/<\?xml version=/.test(firstLines.split("\n", 2).join("\n"))) return "xml";
  // zsh completion functions (_fd, _git) carry no extension and no shebang, only this tag.
  if (text.startsWith("#compdef ")) return "shell";
  if (/^\s*(?:<!doctype html|<html[\s>]|<(?:head|body|div|table|p|span|form|script)[\s>])/i.test(firstLines)) return "html";
  const t = text.trimStart();
  // A truncated head cannot be parsed, but an object opening on a quoted key is JSON's shape
  // (source maps, API dumps); YAML flow mappings and JS objects rarely quote the first key.
  if (!complete && /^\{\s*"[^"\n]*"\s*:/.test(t)) return "json";
  if (complete && (t.startsWith("{") || t.startsWith("["))) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      return undefined;
    }
  }
  return undefined;
}

interface LanguageGuess {
  language: string;
  reason: DetectionReason;
}

function detectLanguage(path: string, name: string, lower: string, text: string, complete: boolean): LanguageGuess {
  const modeline = modelineLanguage(text, complete);
  if (modeline) return { language: modeline, reason: "modeline" };

  const exact = languagesForFilename(name);
  if (exact.length) return { language: exact.length === 1 ? exact[0]! : byShape(exact, text), reason: "filename" };

  // A name matched only case-insensitively or by Skyplate's own conventions is weaker than
  // an interpreter line: `install` and `build` beside fzf's and linguist's bash and sh
  // shebangs are scripts, not linguist's INSTALL (Text) and BUILD (Starlark). Linguist
  // itself would never match them, since its filename lookup is exact.
  let byName = languagesForFilenameIgnoringCase(name);
  if (!byName.length) {
    for (const [re, id] of FILENAME_RULES) {
      if (re.test(path)) {
        byName = [id];
        break;
      }
    }
  }
  if (byName.length) {
    const sb = shebangLanguages(text);
    if (sb.length) return { language: sb[0]!, reason: "shebang" };
    return { language: byName.length === 1 ? byName[0]! : byShape(byName, text), reason: "filename" };
  }

  const ex = extensionCandidates(lower);
  if (ex) {
    const generic = GENERIC.has(ex.ext);
    if (ex.ids.length === 1 && !generic) return { language: ex.ids[0]!, reason: "extension" };
    if (ex.ext === ".ts" || ex.ext === ".tsx") {
      // Linguist's .ts rule is "<TS\b anywhere", which a generic parameter satisfies
      // (`function f<TS extends Shape>()`). Qt Linguist files open with their XML prolog or
      // root element, so only a document that starts that way is XML.
      const qt = /^\s*<(?:\?xml\b|!DOCTYPE TS\b|TS[\s>])/.test(text);
      return { language: qt ? "xml" : ex.ext === ".ts" ? "typescript" : "tsx", reason: "heuristic" };
    }
    const settled = runHeuristics(lower, text)?.filter((id) => languageType(id) !== undefined);
    if (settled?.length) {
      const inCandidates = settled.find((id) => ex.ids.includes(id));
      return { language: inCandidates ?? settled[0]!, reason: "heuristic" };
    }
    if (!generic) {
      const sb = shebangLanguages(text).find((id) => ex.ids.includes(id));
      if (sb) return { language: sb, reason: "shebang" };
      const read = ex.ids.length > 1 ? byContent(ex.ids, text) : undefined;
      if (read) return { language: read, reason: "content" };
      // Markup is unmistakable where heuristics are silent: an .inc that opens with <html> or
      // a .mod that opens with <?xml is HTML / XML, whatever the extension's default is.
      const shaped = sniffText(text, complete);
      if (shaped && ex.ids.includes(shaped)) return { language: shaped, reason: "content" };
      return { language: rankedDefault(ex.ids, text), reason: "extension" };
    }
  }

  const sb = shebangLanguages(text);
  if (sb.length) return { language: sb[0]!, reason: "shebang" };

  const sniffed = sniffText(text, complete);
  if (sniffed) return { language: sniffed, reason: "content" };

  return { language: TEXT, reason: "fallback" };
}

// ─── Category ────────────────────────────────────────────────────────────────────────────────

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "pixi.lock",
  "pylock.toml",
  "conda-lock.yml",
  "Gemfile.lock",
  "gems.locked",
  "composer.lock",
  "go.sum",
  "go.work.sum",
  "Gopkg.lock",
  "glide.lock",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "Package.resolved",
  "Cartfile.resolved",
  "packages.lock.json",
  "paket.lock",
  "gradle.lockfile",
  "MODULE.bazel.lock",
  "mise.lock",
  "renv.lock",
  "rebar.lock",
  "shard.lock",
  "stack.yaml.lock",
  "cabal.project.freeze",
  "Manifest.toml",
  "JuliaManifest.toml",
  ".terraform.lock.hcl",
  "vcpkg-lock.json",
]);
// Julia 1.11+ writes a versioned manifest beside the plain one: Manifest-v1.12.toml.
const LOCKFILE_RE = /(?:\.lock|\.lockfile|-lock\.(?:json|ya?ml)|^pylock\.[^/]+\.toml|^(?:Julia)?Manifest-v\d+\.\d+\.toml)$/;

// "__tests?_<kind>__" covers suites a project splits by kind: vite's __tests_dts__ holds
// expectTypeOf assertions that its typecheck script runs.
const TEST_DIR =
  /^(?:__tests?(?:_[a-z0-9]+)*__|tests?|specs?|e2e|cypress|playwright|__mocks__|__snapshots__|__fixtures__|testdata|test[-_]?data|test[-_]?(?:utils?|helpers?|support|fixtures?|cases?|suites?|resources)|(?:unit|integration|functional|acceptance|smoke|regression|system|end[-_]?to[-_]?end)[-_]?tests?|androidTest|testFixtures|[A-Za-z]+Tests)$/i;
const TEST_FILE =
  /(?:^|[._-])(?:test|tests|spec|specs|e2e|cy)\.[^.]+$|^test_[^/]*\.py$|_test\.[^.]+$|_spec\.rb$|^conftest\.py$|^(?:setup[-_.]?tests?|tests?[-_.]setup|(?:vitest|jest|playwright)[-_.]?(?:global[-_.]?)?setup[\w.-]*)\.[cm]?[jt]sx?$|\.(?:snap|bats|t)$/i;
// PascalCase JVM/.NET/Swift conventions are case-sensitive: "FooTest.java", not "latest.java".
const TEST_CLASS = /[a-z0-9](?:Tests?|Specs?|Suite|IT|TestCase)\.(?:java|kt|kts|scala|groovy|cs|fs|vb|swift|m|mm|php|dart)$/;

const DOC_STEM =
  /^(?:readme|licen[cs]e|copying|copyright|unlicense|authors|contributors|credits|thanks|changelog|changes|history|news|releases?|release[-_]notes|contributing|code[-_]of[-_]conduct|conduct|security|support|governance|maintainers|notice|patents|citation|install|upgrading|migrating|migration|roadmap|faq)(?:[-_.][^/]*)?$/i;

const BUILD_NAMES = new Set([
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "BSDmakefile",
  "Makefile.am",
  "Makefile.in",
  "CMakeLists.txt",
  "Jenkinsfile",
  "justfile",
  "Justfile",
  ".justfile",
  "Taskfile.yml",
  "Taskfile.yaml",
  "Taskfile.dist.yml",
  "Procfile",
  "Earthfile",
  "Tiltfile",
  "Vagrantfile",
  "Rakefile",
  "Gruntfile.js",
  "Gruntfile.coffee",
  "gulpfile.js",
  "Gulpfile.js",
  "gulpfile.ts",
  "gulpfile.mjs",
  "Jakefile",
  "Cakefile",
  "BUILD",
  "BUILD.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
  "WORKSPACE.bzlmod",
  "MODULE.bazel",
  "BUCK",
  ".bazelrc",
  ".bazelversion",
  "meson.build",
  "meson_options.txt",
  "meson.options",
  "build.zig",
  "build.zig.zon",
  "SConstruct",
  "SConscript",
  "configure",
  "configure.ac",
  "configure.in",
  "build.rs",
  "setup.py",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gradlew",
  "gradlew.bat",
  "mvnw",
  "mvnw.cmd",
  "pom.xml",
  "build.xml",
  "build.sbt",
  "Makefile.toml",
  "xmake.lua",
  "premake5.lua",
  "flake.nix",
  "default.nix",
  "shell.nix",
  ".gitlab-ci.yml",
  ".travis.yml",
  "appveyor.yml",
  ".appveyor.yml",
  "azure-pipelines.yml",
  "bitbucket-pipelines.yml",
  ".drone.yml",
  "cloudbuild.yaml",
  "cloudbuild.yml",
  "buildspec.yml",
  ".cirrus.yml",
  "codemagic.yaml",
  ".woodpecker.yml",
  ".goreleaser.yml",
  ".goreleaser.yaml",
  "skaffold.yaml",
  "serverless.yml",
  "serverless.yaml",
  "Pulumi.yaml",
  "cdk.json",
  ".dockerignore",
]);
const BUILD_FILE =
  /^(?:Dockerfile|Containerfile)[.-]|\.(?:dockerfile|containerfile|mk|mak|make|cmake|cmake\.in|gradle|gradle\.kts|bzl|bazel|tf|tfvars|tofu|hcl|nomad|nix|bicep|sln|csproj|fsproj|vbproj|vcxproj|targets)$|^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$|^azure-pipelines[\w.-]*\.ya?ml$/i;
const BUILD_DIR = /(?:^|\/)(?:\.github\/(?:workflows|actions)|\.circleci|\.buildkite|\.gitlab|\.woodpecker|\.tekton|\.azure-pipelines)\//;
const BUILD_LANGUAGES = new Set([
  "dockerfile",
  "makefile",
  "cmake",
  "hcl",
  "nix",
  "starlark",
  "meson",
  "just",
  "earthly",
  "ninja",
  "bitbake",
  "gradle",
  "gradle-kotlin-dsl",
  "procfile",
  "bicep",
  "ant-build-system",
  "maven-pom",
  "qmake",
  "gn",
  "m4sugar",
]);

const CONFIG_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "setup.cfg",
  "Cargo.toml",
  "go.mod",
  "go.work",
  "composer.json",
  "Gemfile",
  "gems.rb",
  "Brewfile",
  "Podfile",
  "Pipfile",
  "pubspec.yaml",
  "mix.exs",
  "Package.swift",
  "deno.json",
  "deno.jsonc",
  "bunfig.toml",
  "environment.yml",
  "environment.yaml",
  "vcpkg.json",
  "vcpkg-configuration.json",
  "packages.config",
  "Directory.Build.props",
  "Directory.Build.targets",
  "Directory.Packages.props",
  "nuget.config",
  "NuGet.Config",
  "global.json",
  "renovate.json",
  "renovate.json5",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "pnpm-workspace.yaml",
  "rush.json",
  "biome.json",
  "biome.jsonc",
  "dprint.json",
  "components.json",
  "vercel.json",
  "netlify.toml",
  "fly.toml",
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
  "firebase.json",
  "now.json",
  "render.yaml",
  "railway.json",
  "railway.toml",
  "app.json",
  "tox.ini",
  "pytest.ini",
  "mypy.ini",
  "ruff.toml",
  "pylintrc",
  "MANIFEST.in",
  "rust-toolchain",
  "rust-toolchain.toml",
  "rustfmt.toml",
  "clippy.toml",
  "deny.toml",
  "Cross.toml",
  "mise.toml",
  "codecov.yml",
  "CODEOWNERS",
  "browserslist",
  "sonar-project.properties",
  "jest.config.json",
  "dependabot.yml",
  "dependabot.yaml",
  "py.typed",
  // Tools whose config file is named for the tool alone, so no pattern below sees it.
  "typos.toml",
  "_typos.toml",
  "typedoc.json",
  "fta.json",
  "angular.json",
  "nodemon.json",
  "mkdocs.yml",
  "mkdocs.yaml",
  "lefthook.yml",
  "lefthook.yaml",
]);
// "x.conf.js" is Karma's, WebdriverIO's and Protractor's spelling of "x.config.js". "_rc"
// is the rc dotfile as project templates ship it (create-vite's _oxlintrc.json), for the
// same reason they ship _gitignore: npm drops dotfiles on publish.
const CONFIG_FILE =
  /\.config\.(?:[cm]?[jt]s|json5?|jsonc|ya?ml|toml)$|\.conf\.[cm]?[jt]s$|^[._][\w-]+rc(?:\.(?:[cm]?[jt]s|json5?|jsonc|ya?ml|toml))?$|^(?:ts|js)config(?:[.-][\w.-]+)?\.json$|\.gemspec$|\.(?:ini|cfg|conf|properties|plist|editorconfig)$/i;
// gatsby-config.js, and a vite playground's worker-sourcemap-config.js. Inside src/, lib/ or
// app/ the same spelling is the application's own config module (auth-config.ts), which is
// code the app imports and belongs in its metrics.
const TOOL_CONFIG_FILE = /-config\.[cm]?[jt]s$/;
const SOURCE_DIR = /^(?:src|lib|app)$/;
// Data files under these directories configure the application (Rails' config/database.yml).
const CONFIG_SEGMENT = /^(?:config|configs|conf)$/;
// Tool directories whose contents configure the project rather than make it.
const CONFIG_DIR = /(?:^|\/)(?:\.vscode|\.idea|\.devcontainer|\.husky|\.cargo|\.config|\.github|\.storybook|\.changeset|\.yarn|\.circleci)\//;
const CONFIG_LANGUAGES = new Set([
  "ini",
  "editorconfig",
  "ignore-list",
  "git-config",
  "git-attributes",
  "json-with-comments",
  "dotenv",
  "npm-config",
  "ssh-config",
  "browserslist",
  "codeowners",
  "readline-config",
  "nginx",
  "apacheconf",
  "pip-requirements",
  "go-module",
  "go-workspace",
  "java-properties",
  "robots-exclusion-rules",
  "hosts-file",
  "wget-config",
  "curl-config",
  "desktop",
  "caddyfile",
  "xml-property-list",
  "cabal-config",
]);

const STYLE_LANGUAGES = new Set(["css", "scss", "sass", "less", "stylus", "postcss", "sugarss"]);
// Single-file components carry the module's script, so the import graph and complexity
// metrics treat them as code; linguist files them under markup.
const COMPONENT_LANGUAGES = new Set(["vue", "svelte", "astro", "marko", "riot"]);
const NOTEBOOK_LANGUAGES = new Set(["jupyter-notebook", "rmarkdown"]);
// Linguist's type for these is "data"/"markup", but each is read as prose.
const DOC_LANGUAGES = new Set(["mdx", "text", "roff-manpage", "texinfo", "pod", "pod-6", "rdoc"]);

/**
 * `prose` is a recognized documentation language. Its name never makes it a test, since
 * docs/tutorial/tests.rst is a tutorial page and docs/tests.md a guide; only a directory
 * does. Not spec/ either: outside RSpec it holds specifications (spec/protocol.md), and RSpec
 * keeps prose fixtures under spec/fixtures/, which counts.
 */
function isTestPath(segments: string[], name: string, prose: boolean): boolean {
  if (!prose && (TEST_FILE.test(name) || TEST_CLASS.test(name))) return true;
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i]!;
    if (prose ? /^fixtures?$/i.test(s) || (TEST_DIR.test(s) && !/^specs?$/i.test(s)) : TEST_DIR.test(s)) return true;
  }
  return false;
}

// Kubernetes and Helm manifests are infrastructure as code, which the schema files under
// build with Terraform. No name marks a Kubernetes manifest (k8s/deployment.yaml), but the two
// keys every object carries do. A kubeconfig carries them too, and is a client's config.
const K8S_API = /^apiVersion:[ \t]*\S/m;
const K8S_KIND = /^kind:[ \t]*["']?(\w+)/m;
const HELM_FILE = /(?:^|\/)Chart\.ya?ml$|(?:^|\/)(?:charts|helm)\/(?:[^/]+\/)*values[\w.-]*\.ya?ml$/;

function infraCategory(path: string, id: string, text: string): Category | undefined {
  if (id !== "yaml") return undefined;
  if (HELM_FILE.test(path)) return "build";
  if (!text.includes("apiVersion") || !K8S_API.test(text)) return undefined;
  const kind = K8S_KIND.exec(text)?.[1];
  if (!kind) return undefined;
  return kind === "Config" ? "config" : "build";
}

/** Linguist type, but with components counted as programming (see COMPONENT_LANGUAGES). */
function effectiveType(id: string): string {
  if (COMPONENT_LANGUAGES.has(id)) return "programming";
  return languageType(id) ?? "other";
}

function categorize(path: string, name: string, lower: string, id: string, reason: DetectionReason, text: string): Category {
  if (LOCKFILES.has(name) || LOCKFILE_RE.test(name)) return "lockfile";
  if (id === "svg") return "image";
  if (NOTEBOOK_LANGUAGES.has(id) || lower.endsWith(".qmd")) return "notebook";

  const type = effectiveType(id);
  const prose = type === "prose" || DOC_LANGUAGES.has(id);
  const segments = path.split("/");
  const dirs = segments.slice(0, -1);

  if (DOC_STEM.test(name) && (prose || type === "markup" || reason === "fallback")) return "docs";
  if (isTestPath(segments, name, prose && reason !== "fallback")) return "test";

  if (BUILD_NAMES.has(name) || BUILD_FILE.test(name) || BUILD_DIR.test(path) || BUILD_LANGUAGES.has(id)) return "build";
  // Scripts under .github/ run in CI (release, labeling, triage); they build, not ship.
  if (path.startsWith(".github/") && type === "programming") return "build";
  const infra = infraCategory(path, id, text);
  if (infra) return infra;

  if (CONFIG_NAMES.has(name) || CONFIG_FILE.test(name) || CONFIG_LANGUAGES.has(id)) return "config";
  if (TOOL_CONFIG_FILE.test(name) && !dirs.some((s) => SOURCE_DIR.test(s))) return "config";
  if (CONFIG_DIR.test(path)) return "config";
  // Structured data inside any dot-directory belongs to some tool (.claude/settings.json,
  // .cursor/hooks.json); new agents and editors invent these faster than any list keeps up.
  if (type === "data" && dirs.some((s) => s.startsWith(".") && s.length > 1)) return "config";
  if (type === "data" && dirs.some((s) => CONFIG_SEGMENT.test(s))) return "config";
  // Remaining dotfiles (.nojekyll, .pnp.cjs, .eslintrc.cjs...) configure some tool.
  if (name.startsWith(".")) return "config";
  // Config modules inside a tool's dot-directory: .vitepress/config.ts, .storybook/main.ts.
  if (/^(?:config|main|preview|manager)\.[cm]?[jt]s$/.test(name) && dirs.some((s) => s.startsWith("."))) {
    return "config";
  }

  // Ahead of the documentation tree below: linguist types CSS as markup, and a stylesheet is a
  // stylesheet in docs/.vitepress/theme/ or an examples/ app as much as anywhere.
  if (STYLE_LANGUAGES.has(id)) return "style";

  // Prose and markup under a documentation tree are documentation, whatever their language;
  // code there (docs/conf.py, a docs site's components) stays code.
  if (prose || type === "markup") {
    if (prose && reason !== "fallback") return "docs";
    if (segments.some((s) => s === "docs" || s === "doc" || s === "Docs" || s === "Doc") || docPattern().test(path)) {
      return "docs";
    }
  }

  if (reason === "fallback") return "unknown";
  switch (type) {
    case "programming":
      return "code";
    case "markup":
      return id === "mdx" ? "docs" : "markup";
    case "data":
      return id === "xml" ? "markup" : "data";
    case "prose":
      return "docs";
    default:
      return "unknown";
  }
}

// ─── Generated / vendored ────────────────────────────────────────────────────────────────────

// SpecFlow writes x.feature.cs beside each x.feature; Yarn PnP writes .pnp.cjs, .pnp.mjs and
// .pnp.loader.mjs depending on version.
const GENERATED_NAME =
  /(?:[.-]min\.(?:js|mjs|cjs|css)|\.(?:js|css|mjs|cjs)\.map|\.pb\.(?:go|cc|h|swift|rs)|_pb2(?:_grpc)?\.pyi?|_pb\.(?:js|d\.ts)|_grpc_pb\.(?:js|d\.ts)|\.pb\.gw\.go|\.generated\.[^.]+|\.g\.dart|\.freezed\.dart|\.gr\.dart|\.mocks\.dart|\.designer\.(?:cs|vb)|\.g\.(?:cs|i\.cs)|\.feature\.cs|\.nib|\.xcworkspacedata|\.xcuserstate|_tlb\.pas|\.zep\.(?:c|h|php)|^\.pnp\.[^/]+)$/i;
// Godeps/ is the pre-modules Go dependency snapshot (its _workspace/ is vendored by linguist).
const GENERATED_DIR = /(?:^|\/)(?:__generated__|htmlcov|\.sqlx|Godeps)\//;
const GENERATED_FILENAMES = new Set(["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd", "Cargo.toml.orig", ".secrets.baseline"]);

// CocoaPods installs dependencies, their support files and its own Xcode project into Pods/.
// Linguist calls that generated; to Skyplate it is someone else's code, as node_modules is,
// so it is vendored. Case-sensitive, as CocoaPods writes it.
const PODS_DIR = /(?:^|\/)Pods\//;

// Markers generators write in a file's opening comment. Only the first lines are searched, so
// a mention of "@generated" deep inside ordinary code (this file, say) never counts.
// Shouted DO NOT EDIT is a generator's voice; lowercase "do not edit" in a hand-written config
// ("do not edit below this line") is not, so that half is case-sensitive.
const GENERATED_MARK = /\bDO NOT EDIT\b|@generated\b|<auto-generated/;
const GENERATED_HEADER =
  /Code generated .*DO NOT EDIT|\b(?:auto-?generated|generated (?:by|from|with|automatically))\b.*\b(?:do not|don't|not to) (?:edit|modify)|\b(?:do not|don't) (?:edit|modify)\b.*\b(?:auto-?)?generated\b|Generated by the protocol buffer compiler|Autogenerated by Thrift|This file (?:is|was) (?:automatically|auto-) ?generated|Generated by Cython|parser generated by jison|generated by jison-lex|Generated by roxygen2|This file is generated by jOOQ|Jest Snapshot v\d|GENERATED CODE -- DO NOT EDIT|generated code\W{2,3}do not modify|GIMP [\w -]+ C-Source image dump|GIMP header image file format|Automatically created by Devel::PPPort/i;

/**
 * A generator often signs only its name, with no "do not edit": "// Generated by Wrangler",
 * "# Generated by Haxe 4.0.5", "/* The following code was generated by JFlex 1.4.3 *\/",
 * "// This is a generated file. Not intended for manual editing." GENERATED_HEADER wants both
 * halves on one line, which missed inertialref's 16,250-line Cloudflare type file, the
 * largest "code" file in its report. So a comment in the first three lines that opens by
 * naming its generator counts alone. Prose further down ("the ids below are generated by the
 * server") never does, nor "generated by hand", nor the Gradle init scaffold, whose header
 * stays on build files people have edited for years.
 */
const GENERATOR_SIGNATURE =
  /^[ \t]*(?:\/\/+!?|\/\*+!?|\*|#+|--|;+|%+|<!--|\(\*+)[ \t]*(?:(?:this|the following) (?:[\w-]+ )?(?:file|code|source)(?: file)? (?:is|was|has been) )?(?:auto(?:matically)?[- ]?)?generated (?:by|from|with|using)[ \t]+(?!hand\b|humans?\b|the gradle 'init' task)\S|^[ \t]*(?:\/\/+|\/\*+|\*|#+|--|<!--)[ \t]*this is an? (?:auto(?:matically)?[- ]?)?generated file\b/im;

// Ports of linguist's generated_html?: documentation tools that stamp a <meta name=generator>.
const HTML_GENERATORS = /^(?:org\s+mode|j?latex2html|groff|makeinfo|texi2html|ronn)\b/i;
const HTML_META = /<meta(\s[^>]+)>/gi;
const HTML_ATTR = /(?<=^|\s)(name|content|value)\s*=\s*("[^"]+"|'[^']+'|[^\s"']+)/gi;

function generatedHtml(text: string): boolean {
  const top = headLines(text, 31);
  if (/<!--\s+Generated by Doxygen\s+[.0-9]+\s*-->/i.test(top)) return true;
  if (!/<meta\b/i.test(top)) return false;
  for (const m of top.matchAll(HTML_META)) {
    const attrs = new Map<string, string>();
    for (const a of m[1]!.replace(/\/\s*$/, "").matchAll(HTML_ATTR)) {
      attrs.set(a[1]!.toLowerCase(), a[2]!.replace(/^["']|["']$/g, ""));
    }
    if (attrs.get("name")?.toLowerCase() !== "generator") continue;
    const tool = attrs.get("content") ?? attrs.get("value");
    if (tool && HTML_GENERATORS.test(tool)) return true;
  }
  return false;
}

/**
 * Linguist's content rules for formats that carry a fixed stamp (generated.rb): Unity's .meta
 * sidecars, GameMaker Studio's JSON project files, MySQL view definitions, version-1 source
 * maps, and PostScript written by a font converter or a versioned tool.
 */
function generatedFormat(ext: string, text: string): boolean {
  const first = headLines(text, 1);
  switch (ext) {
    case "meta":
      return first.includes("fileFormatVersion: ");
    case "yy":
    case "yyp":
      return /^\s*[{[]/.test(headLines(text, 3)) || /^\d\.\d\.\d.+\|\{/.test(first);
    case "frm":
      return first.includes("TYPE=VIEW");
    case "map":
      return /^\{"version":\d+,/.test(first) || first.startsWith("/** Begin line maps. **/{");
    case "ps":
    case "eps":
    case "pfa": {
      if (/^\s*(?:currentfile eexec\s|\/sfnts\s+\[\s<)/m.test(text)) return true;
      const creator = /^%%Creator: (.*)$/m.exec(headLines(text, 10))?.[1];
      return creator !== undefined && /[0-9]|draw|mpage|ImageMagick|inkscape|MATLAB|PCBNEW|pnmtops|\(Unknown\)|Serif Affinity|Filterimage -tops/.test(creator);
    }
    case "html":
    case "htm":
    case "xhtml":
      return generatedHtml(text);
    default:
      return false;
  }
}

function isGenerated(path: string, name: string, lower: string, text: string, complete: boolean): boolean {
  if (GENERATED_FILENAMES.has(name) || GENERATED_NAME.test(name) || GENERATED_DIR.test(path)) return true;
  if (!text) return false;
  const top = headLines(text, 12).slice(0, 2000);
  if (GENERATED_MARK.test(top) || GENERATED_HEADER.test(top)) return true;
  if (GENERATOR_SIGNATURE.test(headLines(top, 3))) return true;
  const ext = lastExt(lower);
  if (generatedFormat(ext, text)) return true;
  if (ext === "js" || ext === "css" || ext === "mjs" || ext === "cjs") {
    // Linguist's minified_files? test: average line length over 110 means a build product.
    // The last line of a truncated head is partial, so it is left out of the average, unless
    // it is the only line: 8 KiB without a newline is a minified bundle by itself.
    const lines = text.split("\n");
    const counted = complete || lines.length === 1 ? lines : lines.slice(0, -1);
    if (counted.length > 0) {
      let sum = 0;
      for (const l of counted) sum += l.length;
      if (sum / counted.length > 110) return true;
    }
    // A sourceMappingURL trailer marks compiled output; visible only when the head is the file.
    if (complete && /\n\/[/*][#@] sourceMappingURL=\S+\s*(?:\*\/)?\s*$/.test(text)) return true;
  }
  return false;
}

// ─── detectFile ──────────────────────────────────────────────────────────────────────────────

const HEAD_BYTES = 8192;

export const detectFile: DetectFile = (path, head) => {
  const name = basename(path);
  const lower = name.toLowerCase();
  const ext = lastExt(lower);
  // A head shorter than the walker's read size is the whole file, so end-of-file signals
  // (vim footer modelines, sourceMappingURL trailers, JSON validity) can be trusted.
  const complete = head.length < HEAD_BYTES;
  const vendored = vendorPattern().test(path) || PODS_DIR.test(path);

  const pdf = head.length >= 5 && at(head, 0, "%PDF-");
  const decoded = pdf ? { text: "", binary: true } : decodeHead(head);

  // Lockfiles are always generated, as linguist has it. Deciding by header made the flag
  // depend on whether the tool happens to stamp one: Cargo.lock says @generated, uv.lock and
  // pnpm-lock.yaml say nothing, so fd reported 6% generated lines and vite none.
  if (decoded.binary) {
    const magic = sniffMagic(head, ext) ?? BINARY_EXT[ext];
    const lockfile = LOCKFILES.has(name);
    const result: Detection = {
      language: BINARY,
      category: lockfile ? "lockfile" : (magic?.category ?? "binary"),
      reason: magic ? "content" : "fallback",
      generated: lockfile || GENERATED_FILENAMES.has(name) || GENERATED_NAME.test(name),
      vendored,
      binary: true,
      secret: isSecret(path, name, "", complete, true, magic?.format),
    };
    if (magic) result.format = magic.format;
    return result;
  }

  const { text } = decoded;
  const guess = detectLanguage(path, name, lower, text, complete);
  const category = categorize(path, name, lower, guess.language, guess.reason, text);
  return {
    language: guess.language,
    category,
    reason: guess.reason,
    generated: category === "lockfile" || isGenerated(path, name, lower, text, complete),
    vendored,
    binary: false,
    secret: isSecret(path, name, text, complete, false),
  };
};

/**
 * Internal: every language id the rules in this file name by hand. An id that is misspelled
 * or that linguist renames never matches and fails silently (the config set once held
 * "robots.txt", whose real id is robots-exclusion-rules, so robots.txt files came out as
 * data), so a test resolves each one.
 */
export function namedLanguageIds(): string[] {
  return [
    ...BUILD_LANGUAGES,
    ...CONFIG_LANGUAGES,
    ...STYLE_LANGUAGES,
    ...COMPONENT_LANGUAGES,
    ...NOTEBOOK_LANGUAGES,
    ...DOC_LANGUAGES,
    ...FILENAME_RULES.map(([, id]) => id),
    ...[...EXTRA_EXTENSIONS.values()].flat(),
  ];
}
