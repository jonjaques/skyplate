/**
 * Clicks on the plate: which pointer releases the plate should act on, and what a double-click
 * is about. Pure, with the clock passed in, so the rules are tested without a browser
 * (src/viewer/galaxy/clicks.test.ts).
 *
 *   press on the stars   only a press that began on the plate's own canvas can end in a click.
 *                        Radix menus (Gravity, the breadcrumb's fold; Display is a popover) open on pointerdown
 *                        and set pointer-events: none on the body, but R3F's canvas keeps
 *                        pointer-events: auto, so the release of the press that opened a menu
 *                        landed on the canvas under the button. Judged on the release alone, it
 *                        read as a click there and replaced the selection (a selected function
 *                        and its caller arcs were lost to whichever star sat under "Gravity").
 *                        A press while a menu is open is the click that dismisses it, and only that.
 *   click, not a drag    within CLICK_SLOP_PX and CLICK_MAX_MS of the press; past either it was an
 *                        orbit or a hold.
 *   double-click         the second press of a double-click is not a second click. A click on a
 *                        group starts a camera flight, and the second press, re-picked 150-250 ms
 *                        later under a moving camera, selected whatever star had slid under the
 *                        pointer; the double-click then opened that star's drawer (measured with
 *                        real mouse clicks at normal speed). The double-click acts on what the
 *                        first click hit.
 */

/** A release this far (CSS px) from its press is the end of a drag, not a click. */
export const CLICK_SLOP_PX = 5;
/** Held longer than this (ms), a press is a hold, not a click. */
export const CLICK_MAX_MS = 500;
/**
 * A second click this soon (ms) after the first, and within the slop, belongs to a double-click.
 * macOS and Windows both default to a 500 ms double-click interval.
 */
export const DOUBLE_MS = 500;

export type Release = "click" | "second" | null;

export class PlateClicks<T> {
  private down: { x: number; y: number; t: number } | null = null;
  private last: { x: number; y: number; t: number; hit: T | null } | null = null;

  /** A pointer went down; `onPlate` when it landed on the stars with no menu or dialog open. */
  press(x: number, y: number, t: number, onPlate: boolean): void {
    this.down = onPlate ? { x, y, t } : null;
  }

  /**
   * The pointer came up: "click" when the plate should pick and select here, "second" for the
   * second press of a double-click (the first click already acted; the dblclick event follows),
   * or null when it is no click of the plate's (a drag, a hold, another button, or a press that
   * began on chrome).
   */
  release(x: number, y: number, t: number, onPlate: boolean, primary: boolean): Release {
    const d = this.down;
    this.down = null;
    if (!d || !onPlate || !primary) return null;
    if (Math.hypot(x - d.x, y - d.y) > CLICK_SLOP_PX || t - d.t > CLICK_MAX_MS) return null;
    const prev = this.last;
    if (prev && t - prev.t <= DOUBLE_MS && Math.hypot(x - prev.x, y - prev.y) <= CLICK_SLOP_PX) return "second";
    return "click";
  }

  /** Record what a click picked, for the double-click that may follow it. */
  clicked(x: number, y: number, t: number, hit: T | null): void {
    this.last = { x, y, t, hit };
  }

  /**
   * What a double-click at (x, y) is about: the first click's hit when that click was here and
   * recent, or undefined when there was none (re-pick then).
   */
  doubleHit(x: number, y: number, t: number): T | null | undefined {
    const prev = this.last;
    if (!prev || t - prev.t > DOUBLE_MS * 2 || Math.hypot(x - prev.x, y - prev.y) > CLICK_SLOP_PX) return undefined;
    return prev.hit;
  }
}
