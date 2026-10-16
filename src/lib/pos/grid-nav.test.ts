import { describe, expect, it } from "vitest";
import { nextTileIndex, type Rect } from "./grid-nav";

// 3 columns x 2 rows of 100x100 tiles, plus a 7th tile alone in row 3.
const rects: Rect[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ x: (i % 3) * 110, y: Math.floor(i / 3) * 110, w: 100, h: 100 })),
  { x: 0, y: 220, w: 100, h: 100 },
];

describe("nextTileIndex", () => {
  it("right / left move to the neighbor in DOM order and stop at the ends", () => {
    expect(nextTileIndex(rects, 0, "ArrowRight")).toBe(1);
    expect(nextTileIndex(rects, 2, "ArrowRight")).toBe(3);
    expect(nextTileIndex(rects, 6, "ArrowRight")).toBe(6);
    expect(nextTileIndex(rects, 1, "ArrowLeft")).toBe(0);
    expect(nextTileIndex(rects, 0, "ArrowLeft")).toBe(0);
  });
  it("down goes to the tile right below, up to the one right above", () => {
    expect(nextTileIndex(rects, 1, "ArrowDown")).toBe(4);
    expect(nextTileIndex(rects, 4, "ArrowUp")).toBe(1);
  });
  it("down into a shorter row picks the closest column", () => {
    expect(nextTileIndex(rects, 5, "ArrowDown")).toBe(6);
    expect(nextTileIndex(rects, 6, "ArrowUp")).toBe(3);
  });
  it("up from the first row / down from the last row stays", () => {
    expect(nextTileIndex(rects, 1, "ArrowUp")).toBe(1);
    expect(nextTileIndex(rects, 6, "ArrowDown")).toBe(6);
  });
  it("an invalid index or empty list is left alone", () => {
    expect(nextTileIndex([], 0, "ArrowDown")).toBe(0);
    expect(nextTileIndex(rects, -1, "ArrowDown")).toBe(-1);
  });
});
