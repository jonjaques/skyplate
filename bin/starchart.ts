#!/usr/bin/env bun
/**
 * starchart: point it at a project directory, get an explorable report folder.
 *
 *   bun bin/starchart.ts <path> [options]      run `--help` for the options
 *
 * Kept to the entry point alone so `bin` in package.json stays a stable path while the CLI
 * itself lives in src/cli/.
 */

import { main } from "../src/cli/main";

const code = await main(process.argv.slice(2));
process.exitCode = code;
// A failed analysis can leave git and tsgo subprocesses running (neither takes a cancellation
// signal), and Bun waits for them before exiting, so the error would print and then the
// terminal would hang for as long as git log takes. Exiting from the write callback lets the
// error line reach stderr first; success has nothing pending, so it exits normally.
if (code !== 0) process.stderr.write("", () => process.exit(code));
