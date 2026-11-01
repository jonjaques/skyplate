import { helper, Mode, Night, pick, Worker, type Box, type Msg, type Runner } from "./members";

export function exercise(m: Msg, r: Runner): number {
  const p = pick();
  p.dispose();
  p.warm(1);
  r.run(m.job);
  new Worker(1).run(2);
  new Night();
  const sent: Msg = { kind: "b", job: 2 };
  const mode: Mode = Mode.A;
  const kinds: typeof Mode = Mode;
  const width: Box["width"] = new Worker(3)["id"];
  (helper as (n: number) => number)(1);
  (helper satisfies (n: number) => number)(2);
  (<(n: number) => number>helper)(3);
  return sent.job + mode.length + kinds.B.length + width;
}
