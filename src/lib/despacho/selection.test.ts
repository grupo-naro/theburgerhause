import { describe, expect, it } from "vitest";
import { board, order } from "./fixtures";
import { pruneSelection, selectionReducer } from "./selection";

const empty = new Set<number>();

describe("selectionReducer", () => {
  it("toggles an id on and off without mutating", () => {
    const on = selectionReducer(empty, { type: "toggle", id: 3 });
    expect([...on]).toEqual([3]);
    expect(empty.size).toBe(0);
    expect(selectionReducer(on, { type: "toggle", id: 3 }).size).toBe(0);
  });
  it("selects every id of the lane and keeps earlier ones", () => {
    const s = selectionReducer(new Set([9]), { type: "selectAll", ids: [1, 2, 2] });
    expect([...s].sort()).toEqual([1, 2, 9]);
  });
  it("clears", () => expect(selectionReducer(new Set([1, 2]), { type: "clear" }).size).toBe(0));
  it("keeps only the allowed ids on prune, returning the same set when nothing changes", () => {
    const s = new Set([1, 2, 3]);
    expect([...selectionReducer(s, { type: "prune", keep: [2, 3, 7] })]).toEqual([2, 3]);
    expect(selectionReducer(s, { type: "prune", keep: [1, 2, 3] })).toBe(s);
  });
});

describe("pruneSelection", () => {
  const b = board({ ready: { delivery: [order({ id: 1 }), order({ id: 2 })], takeaway: [order({ id: 5, fulfillment: "takeaway" })] } });
  it("keeps ids still in the delivery-ready lane", () => expect(pruneSelection([1, 2], b)).toEqual([1, 2]));
  it("drops orders that vanished from the board", () => expect(pruneSelection([1, 99], b)).toEqual([1]));
  it("drops orders that moved to another lane (en route, takeaway, preparing)", () => {
    const moved = board({
      ready: { delivery: [order({ id: 2 })], takeaway: [] },
      enRoute: [{ cadet: { id: 1, name: "N" }, orders: [order({ id: 1, status: "en_camino" })], cashPending: 0 }],
      preparing: [order({ id: 3, status: "en_preparacion" })],
    });
    expect(pruneSelection([1, 2, 3, 5], moved)).toEqual([2]);
  });
  it("is empty for an empty board or selection", () => {
    expect(pruneSelection([], b)).toEqual([]);
    expect(pruneSelection([1], board())).toEqual([]);
  });
});
