export namespace Geometry {
  export interface Point {
    x: number;
    y: number;
  }

  export function origin(): Point {
    return { x: 0, y: 0 };
  }
}
