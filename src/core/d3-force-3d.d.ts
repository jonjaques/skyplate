/**
 * Minimal types for d3-force-3d, which ships no declarations (and has no @types package). Only
 * what src/core/layout.ts uses is declared; the API mirrors d3-force's, plus the dimension
 * argument and z forces. Reference: https://github.com/vasturiano/d3-force-3d
 */

declare module "d3-force-3d" {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimLink<N extends SimNode> {
    source: number | N;
    target: number | N;
    index?: number;
  }

  export interface Force<N extends SimNode> {
    (alpha: number): void;
    initialize?(nodes: N[], random: () => number, nDim: number): void;
  }

  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    nodes(): N[];
    alpha(value: number): this;
    alphaMin(value: number): this;
    alphaDecay(value: number): this;
    velocityDecay(value: number): this;
    randomSource(fn: () => number): this;
    force(name: string, force: Force<N> | null): this;
  }

  export interface LinkForce<N extends SimNode> extends Force<N> {
    distance(d: number | ((link: SimLink<N>) => number)): this;
    strength(s: number | ((link: SimLink<N>) => number)): this;
    iterations(n: number): this;
  }

  export interface ManyBodyForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((node: N) => number)): this;
    theta(t: number): this;
    distanceMin(d: number): this;
    distanceMax(d: number): this;
  }

  export interface PositionForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((node: N, i: number) => number)): this;
  }

  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink<N extends SimNode>(links?: SimLink<N>[]): LinkForce<N>;
  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;
  export function forceX<N extends SimNode>(x?: number | ((node: N, i: number) => number)): PositionForce<N>;
  export function forceY<N extends SimNode>(y?: number | ((node: N, i: number) => number)): PositionForce<N>;
  export function forceZ<N extends SimNode>(z?: number | ((node: N, i: number) => number)): PositionForce<N>;
}
