/**
 * Pool worker: the per-file work (read, detect, measure, extract imports) and the layout job,
 * run off the main thread by src/core/pool.ts.
 *
 * Two file passes, because git mining and the TypeScript analysis both need every file's
 * language before they start, and they are the slowest phases: detection alone (8 KiB per
 * file, ~20 µs) finishes in a fraction of a second, so they can start early and overlap the
 * full measurement instead of waiting behind it. The second pass re-reads each file; the page
 * cache makes that read nearly free, and holding every head between passes would not be.
 *
 * Reads are synchronous: on a worker thread nothing else is waiting, and openSync/readSync
 * measured 3x faster than fs.promises (51 ms vs 168 ms for vite's 2,911 heads) — the async API
 * pays a thread-pool round trip per call.
 *
 * Never throws for one file. Anything that goes wrong reading or measuring a file becomes an
 * `error` on that file's result, and the batch carries on.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { Detection, RawImport } from "./contracts";
import type { FileFacts, Layouts } from "../shared/schema";
import { detectFile } from "./languages/detect";
import { measureBinary, measureText } from "./metrics";
import { extractImports } from "./imports/extract";
import { computeLayout, type LayoutInput } from "./layout";

declare var self: Worker;

// ─── Protocol ────────────────────────────────────────────────────────────────────────────────

export interface DetectJob {
  id: number;
  abs: string;
  path: string;
}

export interface DetectResult {
  id: number;
  detection: Detection;
  error?: string;
}

export interface MeasureJob {
  id: number;
  abs: string;
  path: string;
  detection: Detection;
  /** Return the decoded text (the main thread already chose what fits the source budget). */
  embed: boolean;
}

export interface MeasureResult {
  id: number;
  lines: number;
  code: number;
  comment: number;
  blank: number;
  longestLine: number;
  complexity: number;
  maxDepth: number;
  functions: number;
  todos: number;
  minified: boolean;
  hash: string;
  facts?: FileFacts;
  imports: RawImport[];
  text?: string;
  /** Over the read cap: lines were counted by streaming, nothing else was measured. */
  unmeasured?: boolean;
  error?: string;
}

export type WorkerRequest =
  | { type: "detect"; files: DetectJob[] }
  | { type: "measure"; files: MeasureJob[]; maxRead: number }
  | { type: "layout"; input: LayoutInput };

export type WorkerResponse =
  | { type: "detect"; results: DetectResult[] }
  | { type: "measure"; results: MeasureResult[] }
  | { type: "layout"; layout: Layouts }
  | { type: "error"; message: string };

// ─── Reading ─────────────────────────────────────────────────────────────────────────────────

const HEAD = 8192;
/** Image headers sit in the first few KB; 64 KiB covers JPEGs with large EXIF blocks. */
const BINARY_HEAD = 64 * 1024;
const STREAM_CHUNK = 1 << 20;

function readHead(abs: string, max: number): Uint8Array {
  const fd = openSync(abs, "r");
  try {
    const buf = new Uint8Array(max);
    let got = 0;
    while (got < max) {
      const n = readSync(fd, buf, got, max - got, got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

/** The whole file, or undefined when it is larger than `max` (the caller streams it then). */
function readUpTo(abs: string, max: number): Uint8Array | undefined {
  const fd = openSync(abs, "r");
  try {
    const size = fstatSync(fd).size;
    if (size > max) return undefined;
    // Sized from the stat plus one byte, so reaching EOF is seen in one read; the loop still
    // grows the buffer if the file is longer than the stat said (being written right now).
    let buf = new Uint8Array(size + 1);
    let got = 0;
    for (;;) {
      if (got === buf.length) {
        if (buf.length > max) return undefined;
        const bigger = new Uint8Array(Math.min(max + 1, buf.length * 2));
        bigger.set(buf);
        buf = bigger;
      }
      const n = readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
    }
    return got > max ? undefined : buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

/**
 * Line count of a file too large to measure, by streaming its bytes: newlines, whitespace-only
 * lines, the longest line (in bytes), and the content hash, without ever holding more than one
 * chunk. Classification needs the scanner, so non-blank lines all count as code.
 */
function streamLines(abs: string): { lines: number; blank: number; longest: number; hash: string } {
  const fd = openSync(abs, "r");
  const hasher = new Bun.CryptoHasher("sha1");
  const buf = new Uint8Array(STREAM_CHUNK);
  let lines = 0;
  let blank = 0;
  let longest = 0;
  let len = 0;
  let nonBlank = false;
  let pos = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      hasher.update(buf.subarray(0, n));
      for (let i = 0; i < n; i++) {
        const c = buf[i]!;
        if (c === 10) {
          lines++;
          if (!nonBlank) blank++;
          if (len > longest) longest = len;
          len = 0;
          nonBlank = false;
        } else {
          len++;
          if (c !== 32 && c !== 9 && c !== 13 && c !== 12 && c !== 11) nonBlank = true;
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  if (len > 0) {
    lines++;
    if (!nonBlank) blank++;
    if (len > longest) longest = len;
  }
  return { lines, blank, longest, hash: hasher.digest("hex").slice(0, 16) };
}

// ─── Decoding ────────────────────────────────────────────────────────────────────────────────

const utf8 = new TextDecoder("utf-8", { fatal: true });
const utf16le = new TextDecoder("utf-16le");
const utf16be = new TextDecoder("utf-16be");
const cp1252 = new TextDecoder("windows-1252");

/**
 * UTF-8 (BOM dropped), UTF-16 under a BOM, and Windows-1252 for anything else: the detector
 * already called these bytes text, and the only text it accepts that is not UTF-8 is legacy
 * 8-bit source (see decodeHead in detect.ts). Lossy UTF-8 decoding would turn every accented
 * byte into U+FFFD instead.
 */
function decode(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
  try {
    return utf8.decode(b);
  } catch {
    return cp1252.decode(b);
  }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────────────────────

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function detectOne(job: DetectJob): DetectResult {
  try {
    return { id: job.id, detection: detectFile(job.path, readHead(job.abs, HEAD)) };
  } catch (e) {
    // Unreadable: still classify by name, so the file keeps its place in the report.
    return { id: job.id, detection: detectFile(job.path, new Uint8Array(0)), error: message(e) };
  }
}

const EMPTY: Omit<MeasureResult, "id" | "hash"> = {
  lines: 0,
  code: 0,
  comment: 0,
  blank: 0,
  longestLine: 0,
  complexity: 0,
  maxDepth: 0,
  functions: 0,
  todos: 0,
  minified: false,
  imports: [],
};

function measureOne(job: MeasureJob, maxRead: number): MeasureResult {
  const d = job.detection;
  try {
    if (d.binary) {
      const bytes = readUpTo(job.abs, maxRead);
      if (!bytes) {
        // Hashing a multi-gigabyte model file to find duplicates is not worth its read time;
        // the header still gives format and image dimensions.
        const m = measureBinary(job.path, readHead(job.abs, BINARY_HEAD), d);
        return { id: job.id, ...EMPTY, hash: "", ...(m.facts ? { facts: m.facts } : {}), unmeasured: true };
      }
      const m = measureBinary(job.path, bytes, d);
      return { id: job.id, ...EMPTY, hash: d.secret ? "" : m.hash, ...(m.facts ? { facts: m.facts } : {}) };
    }

    const bytes = readUpTo(job.abs, maxRead);
    if (!bytes) {
      const s = streamLines(job.abs);
      return {
        id: job.id,
        ...EMPTY,
        lines: s.lines,
        code: s.lines - s.blank,
        blank: s.blank,
        longestLine: s.longest,
        hash: d.secret ? "" : s.hash,
        unmeasured: true,
      };
    }
    const text = decode(bytes);
    const m = measureText(job.path, text, d.language);
    let imports: RawImport[] = [];
    // A credentials file has no imports worth an edge, and its text is never handed on.
    if (!d.secret) imports = extractImports(job.path, text, d.language);
    const out: MeasureResult = {
      id: job.id,
      lines: m.lines,
      code: m.code,
      comment: m.comment,
      blank: m.blank,
      longestLine: m.longestLine,
      complexity: m.complexity,
      maxDepth: m.maxDepth,
      functions: m.functions,
      todos: m.todos,
      minified: m.minified,
      // A 16-hex SHA-1 prefix of a short .env is brute-forceable, so secrets carry no hash.
      hash: d.secret ? "" : m.hash,
      imports,
    };
    if (m.facts) out.facts = m.facts;
    if (job.embed && !d.secret) out.text = text;
    return out;
  } catch (e) {
    return { id: job.id, ...EMPTY, hash: "", error: message(e) };
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  let res: WorkerResponse;
  try {
    if (req.type === "detect") res = { type: "detect", results: req.files.map(detectOne) };
    else if (req.type === "measure") res = { type: "measure", results: req.files.map((f) => measureOne(f, req.maxRead)) };
    else res = { type: "layout", layout: computeLayout(req.input) };
  } catch (e) {
    res = { type: "error", message: message(e) };
  }
  postMessage(res);
};
