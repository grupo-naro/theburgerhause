import { describe, expect, it } from "vitest";
import { orderTotals, unitTotal } from "@/domain/pricing";

describe("unitTotal", () => {
  it("suma precio base y agregados", () => {
    expect(unitTotal({ basePrice: 1_400_000, modifiers: [{ priceDelta: 150_000 }, { priceDelta: 0 }] })).toBe(1_550_000);
  });
});

describe("orderTotals", () => {
  it("cada unidad se calcula por separado", () => {
    const units = [
      { basePrice: 1_400_000, modifiers: [{ priceDelta: 150_000 }] },
      { basePrice: 1_400_000, modifiers: [] },
    ];
    expect(orderTotals(units, 0)).toEqual({ subtotal: 2_950_000, total: 2_950_000 });
  });
  it("suma el envío solo al total", () => {
    expect(orderTotals([{ basePrice: 1_000_000, modifiers: [] }], 200_000)).toEqual({
      subtotal: 1_000_000,
      total: 1_200_000,
    });
  });
  it("rechaza importes con decimales", () => {
    expect(() => orderTotals([{ basePrice: 10.5, modifiers: [] }], 0)).toThrow("entero");
  });
  it("un pedido vacío es un error", () => {
    expect(() => orderTotals([], 0)).toThrow("al menos una unidad");
  });
});
