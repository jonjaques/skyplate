/**
 * A fixed pool of Bun Workers running src/core/worker.ts, one request in flight per worker.
 *
 *   const pool = new WorkerPool(size);
 *   const res = await pool.run({ type: "detect", files });
 *   pool.close();
 *
 * Requests queue in submission order and go to whichever worker frees up first, so a batch of
 * one 8 MB file never holds up the batches behind it. The worker is created from a URL next to
 * this module, which is what makes it run straight from source (`bun bin/starchart.ts`)
 * without a build step.
 *
 * Workers stay ref'd while the pool is open: an unref'd pool lets the process exit in the
 * middle of an analysis whenever the main thread happens to be idle waiting on them. close()
 * terminates them, so a finished run never lingers.
 */

import { availableParallelism } from "node:os";
import type { WorkerRequest, WorkerResponse } from "./worker";

interface Pending {
  request: WorkerRequest;
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
}

/** Available cores minus one for the main thread (git parsing, the TS client), at least one. */
export function defaultPoolSize(): number {
  return Math.max(1, availableParallelism() - 1);
}

export class WorkerPool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Pending>();
  private readonly queue: Pending[] = [];
  private closed = false;

  constructor(size = defaultPoolSize()) {
    this.size = Math.max(1, Math.floor(size));
  }

  run(request: WorkerRequest): Promise<WorkerResponse> {
    if (this.closed) return Promise.reject(new Error("worker pool is closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    for (const w of this.workers) w.terminate();
    for (const p of this.busy.values()) p.reject(new Error("worker pool closed"));
    for (const p of this.queue) p.reject(new Error("worker pool closed"));
    this.busy.clear();
    this.queue.length = 0;
    this.workers.length = 0;
    this.idle.length = 0;
  }

  private spawn(): Worker {
    const w = new Worker(new URL("./worker.ts", import.meta.url).href);
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.busy.get(w);
      this.busy.delete(w);
      this.idle.push(w);
      if (p) {
        if (e.data.type === "error") p.reject(new Error(`analysis worker failed: ${e.data.message}`));
        else p.resolve(e.data);
      }
      this.pump();
    };
    w.onerror = (e: ErrorEvent) => {
      // A worker that throws outside a request (failed import, out of memory) is gone for good;
      // fail its request and retire it rather than hand it more work.
      const p = this.busy.get(w);
      this.busy.delete(w);
      const i = this.workers.indexOf(w);
      if (i >= 0) this.workers.splice(i, 1);
      w.terminate();
      p?.reject(new Error(`analysis worker crashed: ${e.message || "unknown error"}`));
      this.pump();
    };
    this.workers.push(w);
    return w;
  }

  private pump(): void {
    while (this.queue.length) {
      let w = this.idle.pop();
      if (!w && this.workers.length < this.size) w = this.spawn();
      if (!w) return;
      const p = this.queue.shift()!;
      this.busy.set(w, p);
      w.postMessage(p.request);
    }
  }
}
