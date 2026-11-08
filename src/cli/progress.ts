/**
 * Progress on stderr while a report is built.
 *
 * On a TTY: one live line, rewritten in place, listing every phase still running with its
 * count and the elapsed time; each phase prints a permanent line when it finishes. Git, the
 * TypeScript pass and the file measurements run at the same time, so a line per phase that
 * each rewrote itself would fight over the cursor. Off a TTY (CI logs, pipes): plain lines on
 * finish only, since carriage returns turn a log file into one enormous line.
 */

import type { Phase, ProgressEvent } from "../core/pipeline";

export type CliPhase = Phase | "write";

export const PHASE_LABEL: Record<CliPhase, string> = {
  walk: "Listing files",
  detect: "Detecting languages",
  files: "Measuring files",
  git: "Reading git history",
  typescript: "TypeScript symbols",
  imports: "Resolving imports",
  graph: "Import graph",
  layout: "Layout",
  stats: "Statistics",
  findings: "Findings",
  write: "Writing report",
};

const nf = new Intl.NumberFormat("en-US");

export function seconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

interface Active {
  label: string;
  done?: number;
  total?: number;
  message?: string;
}

export class Progress {
  private readonly tty: boolean;
  private readonly active = new Map<CliPhase, Active>();
  private readonly started = performance.now();
  private live = false;
  private lastDraw = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly stream: NodeJS.WriteStream = process.stderr,
    private readonly quiet = false,
  ) {
    this.tty = !!stream.isTTY && !quiet;
    // Keeps the elapsed clock moving through long silent stretches (git's first batch, tsgo
    // loading a big project). Unref'd so it never holds the process open.
    if (this.tty) {
      this.timer = setInterval(() => this.draw(true), 250);
      this.timer.unref?.();
    }
  }

  event(e: ProgressEvent | { phase: "write"; status: ProgressEvent["status"]; message?: string; ms?: number }): void {
    if (this.quiet) return;
    const phase = e.phase as CliPhase;
    if (e.status === "start") {
      this.active.set(phase, { label: PHASE_LABEL[phase] });
      this.draw();
    } else if (e.status === "update") {
      const a = this.active.get(phase);
      if (!a) return;
      if ("done" in e && e.done !== undefined) a.done = e.done;
      if ("total" in e && e.total !== undefined) a.total = e.total;
      if (e.message) a.message = e.message;
      this.draw();
    } else {
      this.active.delete(phase);
      const mark = e.status === "skip" ? "–" : "✓";
      const time = e.status === "done" && e.ms !== undefined ? `  ${seconds(e.ms)}` : "";
      this.line(`  ${mark} ${PHASE_LABEL[phase].padEnd(20)} ${e.message ?? ""}${time}`.trimEnd());
    }
  }

  /** A permanent line above the live one. */
  line(text: string): void {
    if (this.quiet) return;
    this.clear();
    this.stream.write(text + "\n");
    this.draw(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clear();
  }

  private clear(): void {
    if (this.tty && this.live) {
      this.stream.write("\r\x1b[2K");
      this.live = false;
    }
  }

  private draw(force = false): void {
    if (!this.tty) return;
    const now = performance.now();
    // Workers report per batch, hundreds of times a second on a big tree; ~12 redraws a
    // second reads as live without flooding the terminal.
    if (!force && now - this.lastDraw < 80) return;
    this.lastDraw = now;
    if (this.active.size === 0) {
      this.clear();
      return;
    }
    // Counted phases first: when the line is cut to the terminal width, the cut should take a
    // module's commentary (TypeScript's per-project notes), not "Measuring files 812/2,911".
    const parts = [...this.active.values()]
      .sort((a, b) => (a.done === undefined ? 1 : 0) - (b.done === undefined ? 1 : 0))
      .map((a) => {
        const count = a.done !== undefined ? (a.total ? ` ${nf.format(a.done)}/${nf.format(a.total)}` : ` ${nf.format(a.done)}`) : "";
        const note = a.message && a.message.length > 40 ? `${a.message.slice(0, 39)}…` : a.message;
        return `${a.label}${count}${!count && note ? ` (${note})` : ""}`;
      });
    // The clock stays visible however narrow the terminal: the phase list is what gets cut.
    const time = `  ${seconds(now - this.started)}`;
    let body = `  … ${parts.join(" · ")}`;
    const width = (this.stream.columns || 100) - 1;
    if (body.length + time.length > width) body = body.slice(0, Math.max(0, width - time.length - 1)) + "…";
    const text = body + time;
    this.stream.write("\r\x1b[2K" + text);
    this.live = true;
  }
}
