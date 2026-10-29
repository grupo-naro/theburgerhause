import { describe, expect, it } from "vitest";
import { addonPaymentCopy, editedTotal, editorItemsFromGroups, keptSubtotal, unitsAfterEdit, type EditorItem } from "./editor-math";

const items: EditorItem[] = [
  { id: 1, label: "Ranchita", total: 8_000_00, addonSeq: null },
  { id: 2, label: "Ranchita", total: 8_000_00, addonSeq: null },
  { id: 3, label: "Coca", total: 2_000_00, addonSeq: null },
];

describe("editor totals", () => {
  it("sums what stays, the new units and the untouched delivery fee", () => {
    expect(keptSubtotal(items, new Set())).toBe(18_000_00);
    expect(keptSubtotal(items, new Set([2]))).toBe(10_000_00);
    expect(editedTotal({ items, removedIds: new Set([3]), addedSubtotal: 5_000_00, deliveryFee: 1_500_00 })).toBe(8_000_00 * 2 + 5_000_00 + 1_500_00);
    expect(editedTotal({ items, removedIds: new Set(), addedSubtotal: 0, deliveryFee: 0 })).toBe(18_000_00);
  });
  it("counts the units left after the edit", () => {
    expect(unitsAfterEdit(items, new Set([1, 2, 3]), 0)).toBe(0);
    expect(unitsAfterEdit(items, new Set([1, 2, 3]), 1)).toBe(1);
    expect(unitsAfterEdit(items, new Set([9]), 2)).toBe(5);
  });
});

describe("editorItemsFromGroups", () => {
  it("expands each group to one item per unit with its label and add-on seq", () => {
    const out = editorItemsFromGroups([
      { name: "Ranchita", quantity: 2, modifiers: [{ name: "Sin cebolla", priceDelta: 0, kitchenLabel: "sin cebolla" }], note: "bien cocida", unitTotal: 8_000_00, lineTotal: 16_000_00, addonSeq: null, itemIds: [4, 5] },
      { name: "Coca", quantity: 1, modifiers: [], note: null, unitTotal: 2_000_00, lineTotal: 2_000_00, addonSeq: 1, itemIds: [6] },
      { name: "Sin ids", quantity: 1, modifiers: [], note: null, unitTotal: 1, lineTotal: 1 },
    ]);
    expect(out).toEqual([
      { id: 4, label: "Ranchita · SIN CEBOLLA · Nota: bien cocida", total: 8_000_00, addonSeq: null },
      { id: 5, label: "Ranchita · SIN CEBOLLA · Nota: bien cocida", total: 8_000_00, addonSeq: null },
      { id: 6, label: "Coca", total: 2_000_00, addonSeq: 1 },
    ]);
  });
});

describe("addonPaymentCopy", () => {
  const amount = 5_000_00;
  it("transfer on the web stays pending until the transfer is confirmed", () => {
    expect(addonPaymentCopy({ channel: "web", paymentMethod: "transfer", amount })).toMatch(/^Queda pendiente hasta confirmar la transferencia de \$/);
  });
  it("cash on the web is collected on delivery", () => {
    expect(addonPaymentCopy({ channel: "web", paymentMethod: "cash", amount })).toMatch(/^Se cobra \$.* al entregar$/);
  });
  it("the counter charges right now, whatever the method", () => {
    expect(addonPaymentCopy({ channel: "counter", paymentMethod: "cash", amount })).toMatch(/^Cobrá \$.* ahora$/);
    expect(addonPaymentCopy({ channel: "counter", paymentMethod: "transfer", amount })).toMatch(/^Cobrá \$.* ahora$/);
  });
});
