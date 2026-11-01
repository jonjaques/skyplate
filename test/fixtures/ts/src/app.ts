import * as m from "./math";
import { Round, total, double } from "./index";
import type { HasArea, ShapeList } from "./shapes";
import { Geometry } from "./geometry";

export function describe(shape: HasArea): string {
  return shape.label + ": " + m.format(shape.area());
}

export function main(): void {
  const c = new Round(2);
  const list: ShapeList = [c, Round.unit()];
  const t = total(1, 2, double(3));
  const color = m.Color.Green;
  c.label = "x";
  report.emit(describe(c), list.length, t, color, m.identity<string>("é😀"), Geometry.origin());
  const corner: Geometry.Point = { x: 1, y: BUILD_ID.length };
  void corner;
}

main();

// @ts-expect-error: deliberately undeclared, the one name the analysis cannot resolve.
undeclaredHook();
