import { describe, expect, it } from "vitest";
import { unitTotal } from "@/domain/pricing";
import { resolveUnits, type Catalog, type CatalogModifier, type CatalogProduct } from "./resolve-units";

const mod = (id: number, over: Partial<CatalogModifier> = {}): CatalogModifier => ({
  id,
  groupId: 1,
  name: `mod${id}`,
  kind: "add",
  priceDelta: 0,
  kitchenLabel: `MOD${id}`,
  active: true,
  ...over,
});
const product = (id: number, over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id,
  name: `prod${id}`,
  price: 1000_00,
  active: true,
  categoryActive: true,
  modifiers: [],
  ...over,
});
const catalog = (...ps: CatalogProduct[]): Catalog => new Map(ps.map((p) => [p.id, p]));
const u = (productId: number, modifierIds: number[] = [], note = "") => ({ productId, modifierIds, note });

describe("resolveUnits", () => {
  it("resolves a valid unit with totals from catalog prices", () => {
    const c = catalog(product(1, { modifiers: [mod(10, { priceDelta: 200_00 }), mod(11, { kind: "remove" })] }));
    const r = resolveUnits([u(1, [10, 11], "x")], c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].product.id).toBe(1);
    expect(r.units[0].modifiers.map((m) => m.id)).toEqual([10, 11]);
    expect(r.units[0].unitTotal).toBe(1200_00);
    expect(r.units[0].unitTotal).toBe(unitTotal({ basePrice: 1000_00, modifiers: [{ priceDelta: 200_00 }, { priceDelta: 0 }] }));
    expect(r.units[0].note).toBe("x");
  });

  it.each([
    ["unknown product", catalog(product(1)), u(99)],
    ["inactive product", catalog(product(1, { active: false })), u(1)],
    ["inactive category", catalog(product(1, { categoryActive: false })), u(1)],
  ])("%s -> PRODUCT_UNAVAILABLE", (_n, c, unit) => {
    expect(resolveUnits([unit], c)).toEqual({ ok: false, issues: [{ unitIndex: 0, code: "PRODUCT_UNAVAILABLE" }] });
  });

  it("modifier not linked to the product -> MODIFIER_UNAVAILABLE", () => {
    const c = catalog(product(1, { modifiers: [mod(10)] }), product(2, { modifiers: [mod(20, { groupId: 2 })] }));
    expect(resolveUnits([u(1, [20])], c)).toEqual({ ok: false, issues: [{ unitIndex: 0, code: "MODIFIER_UNAVAILABLE" }] });
  });

  it("unknown modifier id and inactive modifier -> MODIFIER_UNAVAILABLE", () => {
    const c = catalog(product(1, { modifiers: [mod(10, { active: false })] }));
    expect(resolveUnits([u(1, [10])], c)).toMatchObject({ ok: false, issues: [{ code: "MODIFIER_UNAVAILABLE" }] });
    expect(resolveUnits([u(1, [777])], c)).toMatchObject({ ok: false, issues: [{ code: "MODIFIER_UNAVAILABLE" }] });
  });

  it("collapses duplicate modifier ids (charged once)", () => {
    const c = catalog(product(1, { modifiers: [mod(10, { priceDelta: 50_00 })] }));
    const r = resolveUnits([u(1, [10, 10, 10])], c);
    expect(r.ok && r.units[0].modifiers).toHaveLength(1);
    expect(r.ok && r.units[0].unitTotal).toBe(1050_00);
  });

  describe("swap exclusivity", () => {
    const swaps = [mod(10, { kind: "swap", groupId: 1 }), mod(11, { kind: "swap", groupId: 1 }), mod(12, { kind: "swap", groupId: 2 })];
    it("two swaps from the same group -> INVALID_SELECTION", () => {
      const c = catalog(product(1, { modifiers: swaps }));
      expect(resolveUnits([u(1, [10, 11])], c)).toEqual({ ok: false, issues: [{ unitIndex: 0, code: "INVALID_SELECTION" }] });
    });
    it("swaps from different groups are fine", () => {
      const c = catalog(product(1, { modifiers: swaps }));
      expect(resolveUnits([u(1, [10, 12])], c).ok).toBe(true);
    });
    it("one swap plus free add/remove from the same group is fine", () => {
      const c = catalog(product(1, { modifiers: [...swaps, mod(13, { groupId: 1, kind: "add" }), mod(14, { groupId: 1, kind: "remove" })] }));
      expect(resolveUnits([u(1, [10, 13, 14])], c).ok).toBe(true);
    });
  });

  it("units are independent: only the invalid one is reported, with its index", () => {
    const c = catalog(product(1, { modifiers: [mod(10)] }));
    const r = resolveUnits([u(1, [10]), u(99), u(1)], c);
    expect(r).toEqual({ ok: false, issues: [{ unitIndex: 1, code: "PRODUCT_UNAVAILABLE" }] });
  });

  it("reports every invalid unit", () => {
    const c = catalog(product(1));
    const r = resolveUnits([u(99), u(1, [5]), u(1)], c);
    expect(r).toEqual({
      ok: false,
      issues: [
        { unitIndex: 0, code: "PRODUCT_UNAVAILABLE" },
        { unitIndex: 1, code: "MODIFIER_UNAVAILABLE" },
      ],
    });
  });

  it("ignores any price-like field smuggled into the unit input", () => {
    const c = catalog(product(1));
    const forged = { productId: 1, modifierIds: [], note: "", price: 1, unitPrice: 1, total: 1 };
    const r = resolveUnits([forged], c);
    expect(r.ok && r.units[0].unitTotal).toBe(1000_00);
  });
});
