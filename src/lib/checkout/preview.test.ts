import { describe, expect, it } from "vitest";
import { orderTotals } from "@/domain/pricing";
import { menuFixture } from "@/lib/cart/fixtures";
import { buildMenuIndex } from "@/lib/cart/pricing";
import type { CartLine } from "@/lib/cart/types";
import { checkoutPreview } from "./preview";

const index = buildMenuIndex(menuFixture);
const line = (id: string, productId: number, modifierIds: number[] = []): CartLine => ({ id, productId, modifierIds, note: "" });
const lines = [line("a", 1, [201, 301]), line("b", 1), line("c", 2, [202])];
const FEE = 150000;

describe("checkoutPreview", () => {
  it("matches the domain orderTotals with the delivery fee", () => {
    const expected = orderTotals(
      [
        { basePrice: 850000, modifiers: [{ priceDelta: 120000 }, { priceDelta: 100000 }] },
        { basePrice: 850000, modifiers: [] },
        { basePrice: 400000, modifiers: [{ priceDelta: 50000 }] },
      ],
      FEE,
    );
    expect(checkoutPreview(lines, index, "delivery", FEE)).toEqual({
      subtotal: expected.subtotal,
      deliveryFee: FEE,
      total: expected.total,
    });
  });

  it("charges no fee for takeaway", () => {
    const r = checkoutPreview(lines, index, "takeaway", FEE);
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(r.subtotal);
  });

  it("ignores lines whose product is gone and never throws on an empty cart", () => {
    expect(checkoutPreview([line("x", 999)], index, "delivery", FEE)).toEqual({ subtotal: 0, deliveryFee: FEE, total: FEE });
    expect(checkoutPreview([], index, "takeaway", FEE)).toEqual({ subtotal: 0, deliveryFee: 0, total: 0 });
  });

  it("ignores modifiers the product does not offer (same rule as the cart)", () => {
    expect(checkoutPreview([line("a", 2, [301])], index, "takeaway", 0).subtotal).toBe(400000);
  });
});
