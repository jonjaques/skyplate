/**
 * Plate clicks with a fake clock: what counts as a click, and what a double-click is about.
 *
 *   bun test src/viewer/galaxy/clicks.test.ts
 */

import { describe, expect, test } from "bun:test";
import { CLICK_MAX_MS, DOUBLE_MS, PlateClicks } from "./clicks";

describe("plate clicks", () => {
  test("a press and release on the stars is a click", () => {
    const c = new PlateClicks<string>();
    c.press(100, 100, 0, true);
    expect(c.release(101, 100, 90, true, true)).toBe("click");
  });

  test("the press that opens a plate menu never clicks through to the stars", () => {
    // Pressed on the Gravity button (not the plate), released on the canvas under it once the
    // menu has set pointer-events: none on everything but the canvas.
    const c = new PlateClicks<string>();
    c.press(700, 20, 0, false);
    expect(c.release(700, 20, 80, true, true)).toBeNull();
    // A press while the menu is open is the dismissing click, not a pick.
    c.press(400, 300, 500, false);
    expect(c.release(400, 300, 560, true, true)).toBeNull();
  });

  test("drags, holds and other buttons are not clicks", () => {
    const c = new PlateClicks<string>();
    c.press(100, 100, 0, true);
    expect(c.release(112, 100, 120, true, true)).toBeNull();
    c.press(100, 100, 1000, true);
    expect(c.release(100, 100, 1000 + CLICK_MAX_MS + 1, true, true)).toBeNull();
    c.press(100, 100, 3000, true);
    expect(c.release(100, 100, 3050, true, false)).toBeNull();
    // A press on the stars released over chrome is not the plate's either.
    c.press(100, 100, 4000, true);
    expect(c.release(100, 100, 4050, false, true)).toBeNull();
  });

  test("the second press of a double-click does not pick again, and the double-click acts on the first hit", () => {
    const c = new PlateClicks<string>();
    c.press(300, 200, 0, true);
    expect(c.release(300, 200, 70, true, true)).toBe("click");
    c.clicked(300, 200, 70, "group:render");
    // The camera is flying to the group; 190 ms later a star has slid under the pointer.
    c.press(301, 200, 260, true);
    expect(c.release(301, 200, 330, true, true)).toBe("second");
    expect(c.doubleHit(301, 200, 335)).toBe("group:render");
  });

  test("two clicks apart in time or space are two clicks", () => {
    const c = new PlateClicks<string>();
    c.press(300, 200, 0, true);
    expect(c.release(300, 200, 60, true, true)).toBe("click");
    c.clicked(300, 200, 60, "a");
    c.press(300, 200, 60 + DOUBLE_MS + 100, true);
    expect(c.release(300, 200, 60 + DOUBLE_MS + 150, true, true)).toBe("click");
    c.clicked(300, 200, 60 + DOUBLE_MS + 150, "b");
    c.press(360, 200, 60 + DOUBLE_MS + 250, true);
    expect(c.release(360, 200, 60 + DOUBLE_MS + 300, true, true)).toBe("click");
    // A double-click somewhere no click landed re-picks.
    expect(c.doubleHit(500, 500, 60 + DOUBLE_MS + 310)).toBeUndefined();
  });
});
