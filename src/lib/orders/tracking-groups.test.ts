import { describe, expect, it } from "vitest";
import { orderTotals, unitTotal } from "@/domain/pricing";
import { groupTrackingItems, type SnapshotItem } from "./tracking-groups";

const item = (over: Partial<SnapshotItem> & Pick<SnapshotItem, "name" | "unitPrice">): SnapshotItem => ({
  productId: 1,
  note: null,
  modifiers: [],
  ...over,
});

describe("groupTrackingItems", () => {
  it("returns nothing for no items", () => {
    expect(groupTrackingItems([])).toEqual({ groups: [], subtotal: 0 });
  });

  it("two identical units become one group of quantity 2", () => {
    const r = groupTrackingItems([item({ name: "Ranchita", unitPrice: 850000 }), item({ name: "Ranchita", unitPrice: 850000 })]);
    expect(r.groups).toEqual([
      { name: "Ranchita", quantity: 2, modifiers: [], note: null, unitTotal: 850000, lineTotal: 1700000 },
    ]);
    expect(r.subtotal).toBe(1700000);
  });

  it("different modifiers make separate groups, in first-appearance order", () => {
    const sin = { modifierId: 10, name: "Sin cheddar", priceDelta: 0 };
    const dips = { modifierId: 11, name: "+ Dips", priceDelta: 120000 };
    const r = groupTrackingItems([
      item({ name: "Ranchita", unitPrice: 850000, modifiers: [sin] }),
      item({ name: "Ranchita", unitPrice: 850000, modifiers: [dips] }),
      item({ name: "Ranchita", unitPrice: 850000, modifiers: [sin] }),
    ]);
    expect(r.groups.map((g) => [g.quantity, g.modifiers.map((m) => m.name), g.unitTotal, g.lineTotal])).toEqual([
      [2, ["Sin cheddar"], 850000, 1700000],
      [1, ["+ Dips"], 970000, 970000],
    ]);
    expect(r.subtotal).toBe(2670000);
  });

  it("modifier order does not split a group", () => {
    const a = { modifierId: 1, name: "A", priceDelta: 100 };
    const b = { modifierId: 2, name: "B", priceDelta: 200 };
    const r = groupTrackingItems([
      item({ name: "X", unitPrice: 1000, modifiers: [a, b] }),
      item({ name: "X", unitPrice: 1000, modifiers: [b, a] }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].quantity).toBe(2);
  });

  it("a different note splits a group; equal notes join", () => {
    const r = groupTrackingItems([
      item({ name: "X", unitPrice: 1000, note: "sin sal" }),
      item({ name: "X", unitPrice: 1000, note: null }),
      item({ name: "X", unitPrice: 1000, note: "sin sal" }),
    ]);
    expect(r.groups.map((g) => [g.quantity, g.note])).toEqual([
      [2, "sin sal"],
      [1, null],
    ]);
  });

  it("different products never join", () => {
    const r = groupTrackingItems([
      item({ productId: 1, name: "A", unitPrice: 1000 }),
      item({ productId: 2, name: "A", unitPrice: 1000 }),
    ]);
    expect(r.groups).toHaveLength(2);
  });

  it("negative price deltas lower the unit total (snapshot values, domain arithmetic)", () => {
    const r = groupTrackingItems([
      item({ name: "Combo", unitPrice: 5000, modifiers: [{ modifierId: 1, name: "Sin papas", priceDelta: -700 }] }),
    ]);
    expect(r.groups[0].unitTotal).toBe(4300);
    expect(r.subtotal).toBe(4300);
  });

  it("subtotal equals the domain orderTotals over the same units", () => {
    const items = [
      item({ name: "A", unitPrice: 850000, modifiers: [{ modifierId: 1, name: "m", priceDelta: 120000 }] }),
      item({ name: "A", unitPrice: 850000 }),
      item({ productId: 2, name: "B", unitPrice: 880000, modifiers: [{ modifierId: 2, name: "n", priceDelta: -50000 }] }),
    ];
    const r = groupTrackingItems(items);
    const units = items.map((i) => ({ basePrice: i.unitPrice, modifiers: i.modifiers }));
    expect(r.subtotal).toBe(orderTotals(units, 0).subtotal);
    expect(r.groups.reduce((s, g) => s + g.lineTotal, 0)).toBe(r.subtotal);
    expect(r.groups[0].unitTotal).toBe(unitTotal(units[0]));
  });

  it("does not leak internal ids into the groups", () => {
    const r = groupTrackingItems([item({ name: "A", unitPrice: 1, modifiers: [{ modifierId: 99, name: "m", priceDelta: 0 }] })]);
    expect(JSON.stringify(r)).not.toMatch(/productId|modifierId|99/);
  });
});

describe("groupTrackingItems kitchenLabel pass-through", () => {
  it("carries kitchenLabel only when the input provides it", () => {
    const withLabel = groupTrackingItems([
      item({ name: "R", unitPrice: 100, modifiers: [{ modifierId: 1, name: "Sin cheddar", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" }] }),
    ]);
    expect(withLabel.groups[0].modifiers).toEqual([{ name: "Sin cheddar", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" }]);
    const without = groupTrackingItems([
      item({ name: "R", unitPrice: 100, modifiers: [{ modifierId: 1, name: "Sin cheddar", priceDelta: 0 }] }),
    ]);
    expect(Object.keys(without.groups[0].modifiers[0])).toEqual(["name", "priceDelta"]);
  });
});
