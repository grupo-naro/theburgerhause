import { describe, expect, it } from "vitest";
import { board, order } from "./fixtures";
import { laneCounts } from "./lanes";

describe("laneCounts", () => {
  it("is all zeros for an empty board", () => {
    expect(laneCounts(board())).toEqual({ preparing: 0, ready: 0, readyDelivery: 0, readyCounter: 0, pickup: 0, enRoute: 0 });
  });
  it("counts each lane; ready = delivery + counter/takeaway; enRoute = orders across cadets", () => {
    const b = board({
      preparing: [order({ id: 1 }), order({ id: 2 })],
      ready: { delivery: [order({ id: 3 }), order({ id: 4 }), order({ id: 5 })], takeaway: [order({ id: 6 })] },
      pickup: [order({ id: 7 })],
      enRoute: [
        { cadet: { id: 1, name: "A" }, orders: [order({ id: 8 }), order({ id: 9 })], cashPending: 0 },
        { cadet: { id: 2, name: "B" }, orders: [order({ id: 10 })], cashPending: 0 },
      ],
    });
    expect(laneCounts(b)).toEqual({ preparing: 2, ready: 4, readyDelivery: 3, readyCounter: 1, pickup: 1, enRoute: 3 });
  });
});
