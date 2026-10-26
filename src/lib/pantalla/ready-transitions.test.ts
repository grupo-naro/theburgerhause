import { describe, expect, it } from "vitest";
import { newlyReady } from "./ready-transitions";

describe("newlyReady", () => {
  it("returns the ids that moved from preparation into Ready", () => {
    expect(newlyReady([], [1], [1, 2])).toEqual([1]);
    expect(newlyReady([3], [3, 1, 2], [1, 2])).toEqual([1, 2]); // two at almost the same time: both
  });

  it("ignores ids that were already Ready (listo_despacho -> para_retirar keeps it in Ready: no new chime)", () => {
    expect(newlyReady([1, 2], [1, 2], [])).toEqual([]);
    expect(newlyReady([1], [2, 1], [])).toEqual([]); // 2 was never seen in preparation
  });

  it("only ids that were in preparation: an order seen for the first time directly in Ready does not chime", () => {
    expect(newlyReady([], [5], [])).toEqual([]);
    expect(newlyReady([], [5, 6], [6])).toEqual([6]);
  });

  it("an order going back from Ready to preparation is not a chime (it just leaves Ready)", () => {
    expect(newlyReady([1, 2], [2], [])).toEqual([]);
  });

  it("keeps the order of `next` and never repeats ids", () => {
    expect(newlyReady([], [9, 4, 9], [4, 9])).toEqual([9, 4]);
  });
});
