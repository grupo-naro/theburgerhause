import { describe, expect, it } from "vitest";
import { orderTotals } from "@/domain/pricing";
import { menuFixture } from "./fixtures";
import { buildMenuIndex, cartPreviewTotal, unitTotalFor } from "./pricing";
import type { CartLine } from "./types";

const index = buildMenuIndex(menuFixture);
const line = (id: string, productId: number, modifierIds: number[] = []): CartLine => ({ id, productId, modifierIds, note: "" });

describe("buildMenuIndex", () => {
  it("maps products and modifiers (with their group)", () => {
    expect(index.products.get(1)?.name).toBe("Ranchita simple");
    expect(index.modifiers.get(301)).toMatchObject({ groupId: 30, modifier: { name: "Papas grandes" } });
    expect(index.modifiers.get(999)).toBeUndefined();
  });
});

describe("unitTotalFor / cartPreviewTotal", () => {
  it("is base price plus the modifiers' deltas", () => {
    expect(unitTotalFor(line("a", 1), index)).toBe(850000);
    expect(unitTotalFor(line("a", 1, [201, 301]), index)).toBe(850000 + 120000 + 100000);
  });
  it("equals the domain orderTotals for the same units with delivery fee 0", () => {
    const lines = [line("a", 1, [201]), line("b", 1), line("c", 2, [202])];
    const expected = orderTotals(
      [
        { basePrice: 850000, modifiers: [{ priceDelta: 120000 }] },
        { basePrice: 850000, modifiers: [] },
        { basePrice: 400000, modifiers: [{ priceDelta: 50000 }] },
      ],
      0,
    );
    expect(cartPreviewTotal(lines, index)).toEqual({ subtotal: expected.subtotal, unitCount: 3 });
  });
  it("unknown product or modifier ids contribute 0 and never throw", () => {
    expect(unitTotalFor(line("a", 99), index)).toBe(0);
    expect(unitTotalFor(line("a", 1, [999]), index)).toBe(850000);
    // a modifier that exists but is not offered on this product is not valid for it
    expect(unitTotalFor(line("a", 2, [301]), index)).toBe(400000);
    expect(cartPreviewTotal([line("a", 99)], index)).toEqual({ subtotal: 0, unitCount: 1 });
  });
  it("empty cart", () => {
    expect(cartPreviewTotal([], index)).toEqual({ subtotal: 0, unitCount: 0 });
  });
});
