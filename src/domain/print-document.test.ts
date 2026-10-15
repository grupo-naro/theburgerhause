import { describe, expect, it } from "vitest";
import { formatARS } from "@/domain/money";
import {
  renderCustomerTicket,
  renderKitchenTicket,
  type PrintBlock,
  type PrintDocument,
  type PrintableOrder,
} from "@/domain/print-document";

function makeOrder(partial: Partial<PrintableOrder> = {}): PrintableOrder {
  return {
    number: 42,
    channel: "web",
    fulfillment: "delivery",
    createdAt: new Date("2026-10-14T23:05:00Z"), // 20:05 en Buenos Aires
    customerName: "Juan Pérez",
    whatsapp: "+5491122334455",
    address: "Calle Falsa 123",
    crossStreets: "Entre A y B",
    addressNotes: "Timbre roto",
    pagerNumber: null,
    paymentMethod: "cash",
    paymentStatus: "pending",
    subtotal: 500000,
    deliveryFee: 50000,
    total: 550000,
    items: [
      {
        name: "Burger Clásica",
        unitPrice: 250000,
        note: null,
        modifiers: [
          { name: "Sin cebolla", kitchenLabel: "sin cebolla", kind: "remove", priceDelta: 0 },
          { name: "Extra queso", kitchenLabel: "extra queso", kind: "add", priceDelta: 20000 },
        ],
      },
      { name: "Papas", unitPrice: 250000, note: null, modifiers: [] },
    ],
    ...partial,
  };
}

function textsOf(doc: PrintDocument): string[] {
  return doc.blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
}

function textBlock(doc: PrintDocument, text: string): PrintBlock | undefined {
  return doc.blocks.find((b) => b.type === "text" && b.text === text);
}

describe("renderKitchenTicket", () => {
  it("lists one numbered entry per unit", () => {
    const texts = textsOf(renderKitchenTicket(makeOrder()));
    expect(texts).toContain("1) BURGER CLÁSICA");
    expect(texts).toContain("2) PAPAS");
  });

  it("renders order number and service type large and centered", () => {
    const doc = renderKitchenTicket(makeOrder());
    expect(doc.blocks[0]).toEqual({
      type: "text",
      text: "PEDIDO #42",
      bold: true,
      size: 2,
      align: "center",
    });
    expect(textBlock(doc, "DELIVERY")).toEqual({
      type: "text",
      text: "DELIVERY",
      bold: true,
      size: 2,
      align: "center",
    });
  });

  it("renders every modifier uppercase, bold and size 2", () => {
    const doc = renderKitchenTicket(makeOrder());
    for (const label of ["   SIN CEBOLLA", "   EXTRA QUESO"]) {
      expect(textBlock(doc, label)).toEqual({
        type: "text",
        text: label,
        bold: true,
        size: 2,
        align: "left",
      });
    }
  });

  it("emits only the name line for a unit without modifiers or note", () => {
    const doc = renderKitchenTicket(
      makeOrder({ items: [{ name: "Papas", unitPrice: 100, note: null, modifiers: [] }] }),
    );
    const idx = doc.blocks.findIndex((b) => b.type === "text" && b.text === "1) PAPAS");
    expect(doc.blocks[idx + 1]).toEqual({ type: "divider" });
    expect(doc.blocks[idx + 2]).toEqual({ type: "cut" });
  });

  it("renders the item note as uppercase NOTA", () => {
    const doc = renderKitchenTicket(
      makeOrder({
        items: [{ name: "Papas", unitPrice: 100, note: "bien cocida", modifiers: [] }],
      }),
    );
    expect(textBlock(doc, "   NOTA: BIEN COCIDA")).toMatchObject({ bold: true });
  });

  it("contains no prices", () => {
    const joined = textsOf(renderKitchenTicket(makeOrder())).join("\n");
    expect(joined).not.toContain("$");
  });

  it("shows MOSTRADOR and the pager number for counter orders", () => {
    const texts = textsOf(
      renderKitchenTicket(
        makeOrder({ channel: "counter", fulfillment: "takeaway", pagerNumber: 7 }),
      ),
    );
    expect(texts).toContain("MOSTRADOR");
    expect(texts).toContain("LLAMADOR 7");
  });

  it("shows RETIRO for web takeaway", () => {
    const texts = textsOf(renderKitchenTicket(makeOrder({ fulfillment: "takeaway" })));
    expect(texts).toContain("RETIRO");
    expect(texts).not.toContain("DELIVERY");
  });

  it("renders the time in Buenos Aires", () => {
    expect(textsOf(renderKitchenTicket(makeOrder()))).toContain("20:05");
  });

  it("ends with a cut", () => {
    const doc = renderKitchenTicket(makeOrder());
    expect(doc.blocks.at(-1)).toEqual({ type: "cut" });
  });
});

describe("renderCustomerTicket", () => {
  it("includes customer data and address for delivery", () => {
    const texts = textsOf(renderCustomerTicket(makeOrder()));
    expect(texts).toContain("Cliente: Juan Pérez");
    expect(texts).toContain("WhatsApp: +5491122334455");
    expect(texts).toContain("Dirección: Calle Falsa 123");
    expect(texts).toContain("Entre calles: Entre A y B");
    expect(texts).toContain("Aclaraciones: Timbre roto");
  });

  it("renders header with date and time", () => {
    const doc = renderCustomerTicket(makeOrder());
    expect(doc.blocks[0]).toEqual({
      type: "text",
      text: "THE BURGER HOUSE 828",
      bold: true,
      size: 2,
      align: "center",
    });
    expect(textsOf(doc)).toContain("PEDIDO #42");
    expect(textsOf(doc)).toContain("14/10/2026 20:05");
  });

  it("shows the pager and no address lines for counter orders", () => {
    const doc = renderCustomerTicket(
      makeOrder({
        channel: "counter",
        fulfillment: "takeaway",
        pagerNumber: 9,
        address: null,
        crossStreets: null,
        addressNotes: null,
        deliveryFee: 0,
      }),
    );
    const texts = textsOf(doc);
    expect(textBlock(doc, "LLAMADOR 9")).toMatchObject({ bold: true, size: 2, align: "center" });
    expect(texts.some((t) => t.startsWith("Dirección:"))).toBe(false);
    expect(texts.some((t) => t.startsWith("Entre calles:"))).toBe(false);
    expect(texts.some((t) => t.startsWith("Aclaraciones:"))).toBe(false);
  });

  it("prints Retira en el local for web takeaway", () => {
    const texts = textsOf(renderCustomerTicket(makeOrder({ fulfillment: "takeaway" })));
    expect(texts).toContain("Retira en el local");
    expect(texts.some((t) => t.startsWith("Dirección:"))).toBe(false);
  });

  it("omits null customerName and whatsapp lines", () => {
    const texts = textsOf(renderCustomerTicket(makeOrder({ customerName: null, whatsapp: null })));
    expect(texts.some((t) => t.startsWith("Cliente:"))).toBe(false);
    expect(texts.some((t) => t.startsWith("WhatsApp:"))).toBe(false);
  });

  it("renders item prices and modifier deltas only when non-zero", () => {
    const texts = textsOf(renderCustomerTicket(makeOrder()));
    expect(texts).toContain(`Burger Clásica  ${formatARS(250000)}`);
    expect(texts).toContain("   Sin cebolla");
    expect(texts).toContain(`   Extra queso  (+${formatARS(20000)})`);
  });

  it("renders negative deltas with a minus sign", () => {
    const texts = textsOf(
      renderCustomerTicket(
        makeOrder({
          items: [
            {
              name: "Burger",
              unitPrice: 100000,
              note: "sin apuro",
              modifiers: [{ name: "Sin carne", kitchenLabel: "sin carne", kind: "remove", priceDelta: -5000 }],
            },
          ],
        }),
      ),
    );
    expect(texts).toContain(`   Sin carne  (-${formatARS(5000)})`);
    expect(texts).toContain("   Nota: sin apuro");
  });

  it("renders subtotal, optional shipping and bold total", () => {
    const withFee = renderCustomerTicket(makeOrder());
    expect(textsOf(withFee)).toContain(`Subtotal: ${formatARS(500000)}`);
    expect(textsOf(withFee)).toContain(`Envío: ${formatARS(50000)}`);
    expect(textBlock(withFee, `TOTAL: ${formatARS(550000)}`)).toMatchObject({
      bold: true,
      size: 2,
    });

    const noFee = renderCustomerTicket(makeOrder({ deliveryFee: 0, total: 500000 }));
    expect(textsOf(noFee).some((t) => t.startsWith("Envío:"))).toBe(false);
  });

  it.each([
    ["cash", "pending", "Pago: Efectivo (pendiente de cobro)"],
    ["cash", "paid", "Pago: Efectivo (pagado)"],
    ["transfer", "paid", "Pago: Transferencia (pagado)"],
    ["transfer", "pending", "Pago: Transferencia (pendiente de verificación)"],
  ] as const)("payment line for %s/%s", (paymentMethod, paymentStatus, line) => {
    const texts = textsOf(renderCustomerTicket(makeOrder({ paymentMethod, paymentStatus })));
    expect(texts).toContain(line);
  });

  it("closes with thanks and a cut", () => {
    const doc = renderCustomerTicket(makeOrder());
    expect(doc.blocks.at(-2)).toEqual({
      type: "text",
      text: "¡Gracias por tu compra!",
      align: "center",
    });
    expect(doc.blocks.at(-1)).toEqual({ type: "cut" });
  });
});

describe("purity", () => {
  it("returns equal documents for equal input and does not mutate it", () => {
    const order = makeOrder();
    const snapshot = structuredClone(order);
    expect(renderKitchenTicket(order)).toEqual(renderKitchenTicket(order));
    expect(renderCustomerTicket(order)).toEqual(renderCustomerTicket(order));
    expect(order).toEqual(snapshot);
  });
});
