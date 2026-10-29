import { formatARS } from "@/domain/money";
import { describe, expect, it } from "vitest";
import { createKeyHolder } from "@/lib/checkout/idempotency";
import { addonPaymentCopy, addonSubmissionSignature, editedTotal, editorItemsFromGroups, keptSubtotal, totalWithAddon, unitsAfterEdit, type EditorItem } from "./editor-math";

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
    expect(addonPaymentCopy({ channel: "web", paymentMethod: "transfer", amount })).toBe(`Queda pendiente hasta confirmar la transferencia de ${formatARS(amount)}`);
  });
  it("cash on the web is collected on delivery", () => {
    expect(addonPaymentCopy({ channel: "web", paymentMethod: "cash", amount })).toBe(`Se cobra ${formatARS(amount)} al entregar`);
  });
  it("the counter charges right now, whatever the method", () => {
    expect(addonPaymentCopy({ channel: "counter", paymentMethod: "cash", amount })).toBe(`Cobrá ${formatARS(amount)} ahora`);
    expect(addonPaymentCopy({ channel: "counter", paymentMethod: "transfer", amount })).toBe(`Cobrá ${formatARS(amount)} ahora`);
  });
});

describe("totalWithAddon (add mode: Total del pedido)", () => {
  it("web cash and counter orders: current total + the add-on", () => {
    expect(totalWithAddon({ channel: "web", paymentMethod: "cash", orderTotal: 20_000_00, added: 3_500_00 })).toBe(23_500_00);
    expect(totalWithAddon({ channel: "counter", paymentMethod: "cash", orderTotal: 9_000_00, added: 1_000_00 })).toBe(10_000_00);
    expect(totalWithAddon({ channel: "counter", paymentMethod: "transfer", orderTotal: 9_000_00, added: 1_000_00 })).toBe(10_000_00);
  });
  it("web transfer: null (the add-on waits for the payment, the total does not change yet)", () => {
    expect(totalWithAddon({ channel: "web", paymentMethod: "transfer", orderTotal: 20_000_00, added: 3_500_00 })).toBeNull();
  });
});

describe("add-on idempotency key (addonSubmissionSignature + createKeyHolder in memory)", () => {
  const a = { productId: 1, modifierIds: [2], note: "" };
  const b = { productId: 3, modifierIds: [], note: "fría" };
  const keys = () => {
    let i = 0;
    return () => `${++i}1111111-1111-4111-8111-111111111111`;
  };

  it("an identical retry (same order, same draft in any order) keeps the key", () => {
    const h = createKeyHolder(null, keys());
    const k1 = h.get(addonSubmissionSignature(7, [a, b]));
    expect(h.get(addonSubmissionSignature(7, [b, a]))).toBe(k1);
  });

  it("a changed draft after a failed/unknown attempt rotates the key", () => {
    const h = createKeyHolder(null, keys());
    const k1 = h.get(addonSubmissionSignature(7, [a]));
    const k2 = h.get(addonSubmissionSignature(7, [a, b]));
    expect(k2).not.toBe(k1);
    expect(h.get(addonSubmissionSignature(7, [a, { ...b, note: "natural" }]))).not.toBe(k2);
  });

  it("the order is part of the identity", () => {
    expect(addonSubmissionSignature(7, [a])).not.toBe(addonSubmissionSignature(8, [a]));
  });
});
