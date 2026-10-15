import { describe, expect, it } from "vitest";
import { menuFixture } from "./fixtures";
import { initCart } from "./init";
import { serializeCart } from "./persistence";
import { buildMenuIndex } from "./pricing";

const index = buildMenuIndex(menuFixture);

describe("initCart (load -> validate -> reconcile)", () => {
  it("null/corrupt storage gives an empty cart", () => {
    expect(initCart(null, index)).toEqual({ lines: [], prices: {}, issues: [] });
    expect(initCart("{broken", index)).toEqual({ lines: [], prices: {}, issues: [] });
  });
  it("valid cart survives", () => {
    const raw = serializeCart({ lines: [{ id: "a", productId: 1, modifierIds: [101], note: "" }] }, { a: 850000 });
    const r = initCart(raw, index);
    expect(r.lines).toHaveLength(1);
    expect(r.issues).toEqual([]);
  });
  it("unknown product is reconciled away and reported", () => {
    const raw = serializeCart({ lines: [{ id: "a", productId: 99, modifierIds: [], note: "" }] }, {});
    const r = initCart(raw, index);
    expect(r.lines).toEqual([]);
    expect(r.issues).toEqual([{ type: "product_unavailable", productId: 99, quantity: 1 }]);
  });
  it("without a menu the cart is kept as parsed (never wiped by a failed menu load)", () => {
    const raw = serializeCart({ lines: [{ id: "a", productId: 99, modifierIds: [], note: "" }] }, {});
    expect(initCart(raw, null).lines).toHaveLength(1);
  });
});
