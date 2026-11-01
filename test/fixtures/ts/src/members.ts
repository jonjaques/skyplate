// Members reached through unions, merges, heritage, constructors and string literals.
export class Alpha {
  dispose(): void {}
  warm(n: number): number {
    return n;
  }
}

export class Beta {
  dispose(): void {}
  warm(n: number): number {
    return n * 2;
  }
}

export interface MsgA {
  kind: "a";
  job: number;
  extra: string;
}

export interface MsgB {
  kind: "b";
  job: number;
}

export type Msg = MsgA | MsgB;

export function pick(): Alpha | Beta {
  return Math.random() > 0.5 ? new Alpha() : new Beta();
}

/** A type and a value under one name, as enum-like constants are often written. */
export type Mode = "a" | "b";
export const Mode = { A: "a" as Mode, B: "b" as Mode };

export interface Runner {
  run(job: number): void;
}

/** Runs jobs; see {@link Runner.run} and {@link Mode}. @see pick */
export class Worker implements Runner {
  constructor(readonly id: number) {}

  run(job: number): void {
    void job;
  }
}

export class Night extends Worker {
  constructor() {
    super(0);
  }

  override run(job: number): void {
    super.run(job);
  }
}

export interface Box {
  width: number;
}

export function helper(n: number): number {
  return n + 1;
}
