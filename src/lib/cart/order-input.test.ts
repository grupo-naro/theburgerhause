import { describe, expect, it } from "vitest";
import { toOrderUnits } from "./order-input";

describe("toOrderUnits", () => {
  it("one entry per unit, no ids or prices, sorted ids, trimmed notes", () => {
    const units = toOrderUnits([
      { id: "a", productId: 1, modifierIds: [3, 1, 3], note: "  sin sal " },
      { id: "b", productId: 1, modifierIds: [3, 1], note: "sin sal" },
      { id: "c", productId: 2, modifierIds: [], note: "" },
    ]);
    expect(units).toEqual([
      { productId: 1, modifierIds: [1, 3], note: "sin sal" },
      { productId: 1, modifierIds: [1, 3], note: "sin sal" },
      { productId: 2, modifierIds: [], note: "" },
    ]);
    expect(Object.keys(units[0]).sort()).toEqual(["modifierIds", "note", "productId"]);
  });
  it("empty cart -> no units", () => {
    expect(toOrderUnits([])).toEqual([]);
  });
});
