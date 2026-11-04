// Globals the fixture's code relies on. A module with `declare global` rather than a bare
// script, so it means the same thing under Skyplate's root tsconfig (moduleDetection: force
// turns every file into a module) as under the fixture's own.
export {};

declare global {
  /** Injected by the bundler at build time. */
  const BUILD_ID: string;
  /** Stands in for `console`, which needs a DOM or Node lib this fixture deliberately lacks. */
  const report: { emit(...values: unknown[]): void };
}
