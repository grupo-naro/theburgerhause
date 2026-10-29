import { describe, expect, it } from "vitest";
import { orderToPrintable, type PrintableOrderRow } from "./printable";

const CREATED = new Date("2026-10-14T23:30:00Z");

const base: PrintableOrderRow = {
  number: 12,
  channel: "web",
  fulfillment: "delivery",
  createdAt: CREATED,
  customerName: "Ana Pérez",
  whatsapp: "+5491122334455",
  address: "Calle Falsa 123",
  crossStreets: "Entre A y B",
  addressNotes: "Timbre roto",
  pagerNumber: null,
  paymentMethod: "transfer",
  paymentStatus: "paid",
  subtotal: 10000,
  deliveryFee: 1500,
  total: 11500,
};

describe("orderToPrintable", () => {
  it("maps a delivery order with all address fields and units with modifiers", () => {
    const out = orderToPrintable(
      base,
      [
        { id: 1, nameSnapshot: "Ranchita", unitPriceSnapshot: 8500, notes: "bien cocida", addonSeq: null },
        { id: 2, nameSnapshot: "Melt", unitPriceSnapshot: 1500, notes: null, addonSeq: null },
      ],
      [
        { id: 11, orderItemId: 1, nameSnapshot: "Dips", kitchenLabel: "+ DIPS", kind: "add", priceDelta: 1200 },
        { id: 10, orderItemId: 1, nameSnapshot: "Sin cheddar", kitchenLabel: "SIN CHEDDAR", kind: "remove", priceDelta: 0 },
      ],
    );
    expect(out).toEqual({
      number: 12,
      channel: "web",
      fulfillment: "delivery",
      createdAt: CREATED,
      customerName: "Ana Pérez",
      whatsapp: "+5491122334455",
      address: "Calle Falsa 123",
      crossStreets: "Entre A y B",
      addressNotes: "Timbre roto",
      pagerNumber: null,
      paymentMethod: "transfer",
      paymentStatus: "paid",
      subtotal: 10000,
      deliveryFee: 1500,
      total: 11500,
      items: [
        {
          name: "Ranchita",
          unitPrice: 8500,
          note: "bien cocida",
          addonSeq: null,
          modifiers: [
            { name: "Sin cheddar", kitchenLabel: "SIN CHEDDAR", kind: "remove", priceDelta: 0 },
            { name: "Dips", kitchenLabel: "+ DIPS", kind: "add", priceDelta: 1200 },
          ],
        },
        { name: "Melt", unitPrice: 1500, note: null, modifiers: [], addonSeq: null },
      ],
    });
  });

  it("orders units by item id and modifiers by row id regardless of input order", () => {
    const out = orderToPrintable(
      base,
      [
        { id: 9, nameSnapshot: "B", unitPriceSnapshot: 1, notes: null, addonSeq: null },
        { id: 3, nameSnapshot: "A", unitPriceSnapshot: 1, notes: null, addonSeq: null },
      ],
      [
        { id: 7, orderItemId: 3, nameSnapshot: "m7", kitchenLabel: "M7", kind: "add", priceDelta: 1 },
        { id: 5, orderItemId: 3, nameSnapshot: "m5", kitchenLabel: "M5", kind: "add", priceDelta: 1 },
      ],
    );
    expect(out.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(out.items[0].modifiers.map((m) => m.name)).toEqual(["m5", "m7"]);
  });

  it("maps a counter order with pager and no customer data", () => {
    const out = orderToPrintable(
      {
        ...base,
        channel: "counter",
        fulfillment: "takeaway",
        customerName: "Mostrador",
        whatsapp: null,
        address: null,
        crossStreets: null,
        addressNotes: null,
        pagerNumber: 7,
        paymentMethod: "cash",
        paymentStatus: "pending",
        deliveryFee: 0,
      },
      [{ id: 1, nameSnapshot: "Ranchita", unitPriceSnapshot: 8500, notes: null, addonSeq: null }],
      [],
    );
    expect(out.pagerNumber).toBe(7);
    expect(out.channel).toBe("counter");
    expect(out.whatsapp).toBeNull();
    expect(out.items).toEqual([{ name: "Ranchita", unitPrice: 8500, note: null, modifiers: [], addonSeq: null }]);
  });

  it("keeps negative price deltas and ignores modifiers of other orders' items", () => {
    const out = orderToPrintable(
      base,
      [{ id: 1, nameSnapshot: "X", unitPriceSnapshot: 100, notes: null, addonSeq: null }],
      [
        { id: 1, orderItemId: 1, nameSnapshot: "Descuento", kitchenLabel: "DESC", kind: "swap", priceDelta: -300 },
        { id: 2, orderItemId: 99, nameSnapshot: "Ajeno", kitchenLabel: "AJENO", kind: "add", priceDelta: 5 },
      ],
    );
    expect(out.items[0].modifiers).toEqual([{ name: "Descuento", kitchenLabel: "DESC", kind: "swap", priceDelta: -300 }]);
  });

  it("does not mutate its inputs", () => {
    const items = [
      { id: 2, nameSnapshot: "B", unitPriceSnapshot: 1, notes: null, addonSeq: null },
      { id: 1, nameSnapshot: "A", unitPriceSnapshot: 1, notes: null, addonSeq: null },
    ];
    const copy = structuredClone(items);
    orderToPrintable(base, items, []);
    expect(items).toEqual(copy);
  });
});
