/**
 * Loads report data files written by the CLI.
 *
 * Data ships as classic scripts that call `window.__skyplate.resolve(name, payload)` (see
 * DATA_GLOBAL in src/shared/schema.ts). fetch() would be simpler, but browsers refuse fetch()
 * and module scripts over file://, and a report folder has to work when someone double-clicks
 * its index.html. A plain <script src> still runs there.
 */

import {
  DATA_GLOBAL,
  REPORT_FILE,
  type CodeSymbols,
  type Report,
  type SourceChunk,
} from "../../shared/schema";

type Resolver = (payload: unknown) => void;

interface DataGlobal {
  resolve(name: string, payload: unknown): void;
}

const pending = new Map<string, { promise: Promise<unknown>; resolve: Resolver }>();

function installGlobal(): void {
  const w = window as unknown as Record<string, DataGlobal | undefined>;
  if (w[DATA_GLOBAL]) return;
  w[DATA_GLOBAL] = {
    resolve(name, payload) {
      pending.get(name)?.resolve(payload);
    },
  };
}

/**
 * Inject `url` once and resolve with whatever it hands to `resolve(name, …)`. Repeated calls
 * share one script tag, so two views asking for the same source chunk cost one load.
 */
function loadDataScript<T>(name: string, url: string): Promise<T> {
  installGlobal();
  const existing = pending.get(name);
  if (existing) return existing.promise as Promise<T>;

  let resolve!: Resolver;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pending.set(name, { promise, resolve });

  const script = document.createElement("script");
  script.src = url;
  script.async = true;
  script.onerror = () => {
    pending.delete(name);
    reject(new Error(`Could not load ${url}`));
  };
  // The tag has done its job once the payload arrives; dropping it frees the source text.
  promise.then(() => script.remove(), () => script.remove());
  document.head.appendChild(script);
  return promise as Promise<T>;
}

export function loadReport(): Promise<Report> {
  return loadDataScript<Report>("report", REPORT_FILE);
}

export function loadSymbols(url: string): Promise<CodeSymbols> {
  return loadDataScript<CodeSymbols>("symbols", url);
}

export function loadSourceChunk(index: number, url: string): Promise<SourceChunk> {
  return loadDataScript<SourceChunk>(`source/${index}`, url);
}
