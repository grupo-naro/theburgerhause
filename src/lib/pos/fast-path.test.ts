import { describe, expect, it } from "vitest";
import { orderTotals } from "@/domain/pricing";
import { groupLines } from "@/lib/cart/group";
import { buildMenuIndex } from "@/lib/cart/pricing";
import { cartReducer, emptyCart } from "@/lib/cart/reducer";
import type { PublicMenu, PublicProduct } from "@/lib/menu/public";
import { PLAIN_UNIT, ticketTotals } from "./fast-path";

const product = (over: Partial<PublicProduct>): PublicProduct => ({
  id: 10,
  categoryId: 1,
  name: "Ranchita simple",
  description: null,
  price: 850_000,
  imagePath: null,
  imageUrl: null,
  thumbUrl: null,
  featured: false,
  suggest: false,
  modifierGroups: [],
  ...over,
});
const menu: PublicMenu = {
  featured: [],
  categories: [
    {
      id: 1,
      name: "Burgers",
      slug: "burgers",
      imageUrl: null,
      products: [
        product({
          modifierGroups: [{ id: 1, name: "Agregados", modifiers: [{ id: 100, name: "+ Dips", kind: "add", priceDelta: 120_000 }] }],
        }),
        product({ id: 11, name: "Papas", price: 300_000 }),
      ],
    },
  ],
};
const index = buildMenuIndex(menu);
let n = 0;
const id = () => `l${++n}`;
const tap = (state = emptyCart, productId = 10) => cartReducer(state, { type: "add", productId, units: [PLAIN_UNIT] }, id);

describe("tile fast path", () => {
  it("a plain unit has no modifiers and no note", () => {
    expect(PLAIN_UNIT).toEqual({ modifierIds: [], note: "" });
  });
  it("tapping the same plain product twice -> ONE group with quantity 2", () => {
    const s = tap(tap());
    expect(s.lines).toHaveLength(2);
    const groups = groupLines(s.lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].quantity).toBe(2);
  });
  it("a customized unit stays a separate group", () => {
    let s = tap(tap());
    s = cartReducer(s, { type: "add", productId: 10, units: [{ modifierIds: [100], note: "" }] }, id);
    expect(groupLines(s.lines).map((g) => g.quantity)).toEqual([2, 1]);
  });
  it("different products are different groups, in tap order", () => {
    const s = tap(tap(tap(emptyCart, 10), 11), 10);
    expect(groupLines(s.lines).map((g) => [g.productId, g.quantity])).toEqual([[10, 2], [11, 1]]);
  });
});

describe("ticketTotals", () => {
  it("empty ticket -> zeros (orderTotals would throw)", () => {
    expect(ticketTotals([], index)).toEqual({ subtotal: 0, total: 0 });
  });
  it("uses the domain pricing, no fee", () => {
    const s = cartReducer(tap(tap()), { type: "add", productId: 10, units: [{ modifierIds: [100], note: "" }] }, id);
    const expected = orderTotals(
      [
        { basePrice: 850_000, modifiers: [] },
        { basePrice: 850_000, modifiers: [] },
        { basePrice: 850_000, modifiers: [{ priceDelta: 120_000 }] },
      ],
      0,
    );
    expect(ticketTotals(s.lines, index)).toEqual(expected);
    expect(expected.total).toBe(2_670_000);
  });
});
