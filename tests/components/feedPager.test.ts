import { describe, it, expect } from "vitest";

import { pageWindow } from "~/components/publish/FeedPager";

/**
 * The pager's number strip.
 *
 * The feed's total is open-ended — the server hands out cursors, not a count —
 * so the strip only ever renders pages that are known to exist. These cover the
 * cases where the elision has to appear, and the ones where inserting it would
 * be sillier than just printing the number it replaced.
 */
describe("pageWindow", () => {
  it("prints every page while they all fit", () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the first, the last and the neighbours of where you are", () => {
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
  });

  it("prints a lone missing page rather than an ellipsis as wide as it", () => {
    expect(pageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never runs past either end", () => {
    expect(pageWindow(1, 9)).toEqual([1, 2, null, 9]);
    expect(pageWindow(9, 9)).toEqual([1, null, 8, 9]);
  });

  it("survives a single-page feed", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});
