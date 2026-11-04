/**
 * Command-line parsing for `skyplate`, on node:util parseArgs.
 *
 *   skyplate [path=.] [options]          analyze a project and write a report folder
 *   skyplate serve <dir> [--port N] [--open]
 *
 * parseArgs has no negated booleans that work across runtimes (`allowNegative` is recent in
 * Node and not something Bun promises), so --no-git and friends are declared as their own
 * flags. Sizes accept 512k / 64m / 1.5g or plain bytes, because nobody types 67108864.
 */

import { parseArgs } from "node:util";
import { DEFAULT_OPTIONS } from "../core/pipeline";

export const USAGE = `skyplate: map a project as an explorable 3D galaxy, dashboard and source reader.

Usage
  skyplate [path] [options]              analyze <path> (default: .) and write a report folder
  skyplate serve <dir> [--port N] [--open]
                                          serve an existing report folder over http

Output
  -o, --out <dir>          report folder (default: ./<project-name>.skyplate)
      --open               serve the finished report and open it in the browser
      --serve              serve the finished report without opening a browser
      --port <n>           port for --serve / --open / serve (default: 4747, or any free one)
      --json               also write data/report.json
  -q, --quiet              no progress or summary, errors only

What to analyze
      --include-ignored    include files git or .gitignore would ignore
      --exclude <glob>     leave out matching paths (gitignore syntax; repeatable)
      --no-git             skip git history (no churn, ownership, hotspots)
      --max-commits <n>    newest commits to analyze (default: ${DEFAULT_OPTIONS.maxCommits})
      --no-symbols         skip the TypeScript/JavaScript code-intelligence pass
      --ts-max-files <n>   skip that pass when more TS/JS files than this (default: ${DEFAULT_OPTIONS.tsMaxFiles})

What the report contains
      --no-source          embed no file contents or image previews (for sharing)
      --max-source-file <size>   largest file to embed (default: 512k)
      --max-source-total <size>  total embedded source (default: 64m)
      --redact-paths       omit the absolute project path from the report

  -h, --help               show this help
  -v, --version            print the version

Sizes take k, m or g suffixes (512k, 64m) or plain bytes.`;

export interface AnalyzeCommand {
  kind: "analyze";
  path: string;
  out?: string;
  open: boolean;
  serve: boolean;
  port?: number;
  json: boolean;
  quiet: boolean;
  options: {
    includeIgnored: boolean;
    exclude: string[];
    git: boolean;
    source: boolean;
    symbols: boolean;
    maxCommits: number;
    maxSourceFile: number;
    maxSourceTotal: number;
    tsMaxFiles: number;
    redactPaths: boolean;
  };
}

export interface ServeCommand {
  kind: "serve";
  dir: string;
  port?: number;
  open: boolean;
}

export type Command = AnalyzeCommand | ServeCommand | { kind: "help" } | { kind: "version" };

export class UsageError extends Error {}

/** "512k" → 524288, "64m", "1.5g", "4096", "512kb", "2MiB". */
export function parseSize(text: string, flag: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)(?:i?b)?$/i.exec(text.trim());
  if (!m) throw new UsageError(`${flag} expects a size such as 512k, 64m or a byte count, not "${text}"`);
  const unit = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2]!.toLowerCase() as "" | "k" | "m" | "g"];
  return Math.round(Number(m[1]) * unit);
}

function parseCount(text: string, flag: string, min = 1): number {
  if (!/^\d+$/.test(text.trim())) throw new UsageError(`${flag} expects a whole number, not "${text}"`);
  const n = Number(text);
  if (n < min) throw new UsageError(`${flag} must be at least ${min}`);
  return n;
}

function parsePort(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = parseCount(text, "--port", 0);
  if (n > 65535) throw new UsageError("--port must be between 0 and 65535");
  return n;
}

export function parseCommand(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: "string", short: "o" },
        open: { type: "boolean" },
        serve: { type: "boolean" },
        port: { type: "string" },
        json: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        "include-ignored": { type: "boolean" },
        exclude: { type: "string", multiple: true },
        "no-git": { type: "boolean" },
        "max-commits": { type: "string" },
        "no-symbols": { type: "boolean" },
        "ts-max-files": { type: "string" },
        "no-source": { type: "boolean" },
        "max-source-file": { type: "string" },
        "max-source-total": { type: "string" },
        "redact-paths": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values: v, positionals } = parsed;
  if (v.help) return { kind: "help" };
  if (v.version) return { kind: "version" };

  if (positionals[0] === "serve") {
    if (positionals.length !== 2) throw new UsageError("serve takes exactly one report folder: skyplate serve <dir>");
    return { kind: "serve", dir: positionals[1]!, port: parsePort(v.port), open: !!v.open };
  }
  if (positionals.length > 1) throw new UsageError(`expected one project path, got ${positionals.length}: ${positionals.join(" ")}`);

  return {
    kind: "analyze",
    path: positionals[0] ?? ".",
    ...(v.out !== undefined ? { out: v.out } : {}),
    open: !!v.open,
    serve: !!v.serve,
    port: parsePort(v.port),
    json: !!v.json,
    quiet: !!v.quiet,
    options: {
      includeIgnored: !!v["include-ignored"],
      exclude: v.exclude ?? [],
      git: !v["no-git"],
      source: !v["no-source"],
      symbols: !v["no-symbols"],
      maxCommits: v["max-commits"] !== undefined ? parseCount(v["max-commits"], "--max-commits") : DEFAULT_OPTIONS.maxCommits,
      maxSourceFile: v["max-source-file"] !== undefined ? parseSize(v["max-source-file"], "--max-source-file") : DEFAULT_OPTIONS.maxSourceFile,
      maxSourceTotal: v["max-source-total"] !== undefined ? parseSize(v["max-source-total"], "--max-source-total") : DEFAULT_OPTIONS.maxSourceTotal,
      tsMaxFiles: v["ts-max-files"] !== undefined ? parseCount(v["ts-max-files"], "--ts-max-files", 0) : DEFAULT_OPTIONS.tsMaxFiles,
      redactPaths: !!v["redact-paths"],
    },
  };
}
