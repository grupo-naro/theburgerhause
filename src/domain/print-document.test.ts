import { describe, expect, it } from "vitest";
import { formatARS } from "@/domain/money";
import {
  renderAdditionalTicket,
  renderCustomerTicket,
  renderDeliveryTicket,
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
        addonSeq: null,
      },
      { name: "Papas", unitPrice: 250000, note: null, modifiers: [], addonSeq: null },
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

describe("renderAdditionalTicket", () => {
  it('muestra "ADICIONAL 2 al #23" y solo los ítems del adicional, sin precios', () => {
    const doc = renderAdditionalTicket(
      makeOrder({
        number: 23,
        items: [{ name: "Papas", unitPrice: 123400, note: "sin sal", modifiers: [{ name: "Dips", kitchenLabel: "+ dips", kind: "add", priceDelta: 5000 }], addonSeq: 2 }],
      }),
      { seq: 2 },
    );
    const texts = textsOf(doc);
    expect(texts).toContain("ADICIONAL 2 al #23");
    expect(textBlock(doc, "ADICIONAL 2 al #23")).toMatchObject({ bold: true, size: 2, align: "center" });
    expect(texts).toContain("1) PAPAS");
    expect(texts).toContain("   + DIPS");
    expect(texts).toContain("   NOTA: SIN SAL");
    expect(texts).not.toContain("2) BURGER CLÁSICA");
    expect(texts.join("\n")).not.toContain(formatARS(123400));
    expect(doc.blocks.at(-1)).toEqual({ type: "cut" });
  });
});

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
      makeOrder({ items: [{ name: "Papas", unitPrice: 100, note: null, modifiers: [], addonSeq: null }] }),
    );
    const idx = doc.blocks.findIndex((b) => b.type === "text" && b.text === "1) PAPAS");
    expect(doc.blocks[idx + 1]).toEqual({ type: "divider" });
    expect(doc.blocks[idx + 2]).toEqual({ type: "cut" });
  });

  it("renders the item note as uppercase NOTA", () => {
    const doc = renderKitchenTicket(
      makeOrder({
        items: [{ name: "Papas", unitPrice: 100, note: "bien cocida", modifiers: [], addonSeq: null }],
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

  it("renders the logo first, then the brand, with date and time", () => {
    const doc = renderCustomerTicket(makeOrder());
    expect(doc.blocks[0]).toEqual({ type: "logo" });
    expect(doc.blocks[1]).toEqual({
      type: "text",
      text: "THE BURGER HOUSE 828",
      bold: true,
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
              addonSeq: null,
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

  it("closes with a bold centered GRACIAS POR TU COMPRA right before the cut", () => {
    const doc = renderCustomerTicket(makeOrder());
    expect(doc.blocks.at(-2)).toEqual({
      type: "text",
      text: "GRACIAS POR TU COMPRA",
      bold: true,
      align: "center",
    });
    expect(doc.blocks.at(-1)).toEqual({ type: "cut" });
    expect(textsOf(doc)).not.toContain("¡Gracias por tu compra!");
  });

  it("has exactly one logo and the pager number for counter sales", () => {
    const doc = renderCustomerTicket(makeOrder({ channel: "counter", fulfillment: "takeaway", pagerNumber: 7 }));
    expect(doc.blocks.filter((b) => b.type === "logo")).toHaveLength(1);
    expect(textsOf(doc)).toContain("LLAMADOR 7");
  });
});

describe("renderDeliveryTicket", () => {
  const doc = renderDeliveryTicket(makeOrder());
  const texts = textsOf(doc);

  it("has NO logo and NO thanks line (it is the dispatch ticket)", () => {
    expect(doc.blocks.some((b) => b.type === "logo")).toBe(false);
    expect(texts.join(" | ")).not.toMatch(/GRACIAS/i);
  });

  it("leads with the order number and DELIVERY, large and centered", () => {
    expect(doc.blocks[0]).toEqual({ type: "text", text: "PEDIDO #42", bold: true, size: 2, align: "center" });
    expect(doc.blocks[1]).toEqual({ type: "text", text: "DELIVERY", bold: true, size: 2, align: "center" });
    expect(texts).toContain("20:05");
  });

  it("has the customer, phone, full address and references", () => {
    expect(texts).toContain("Cliente: Juan Pérez");
    expect(texts).toContain("WhatsApp: +5491122334455");
    expect(texts).toContain("Dirección: Calle Falsa 123");
    expect(texts).toContain("Entre calles: Entre A y B");
    expect(texts).toContain("Aclaraciones: Timbre roto");
  });

  it("lists every unit with its price and modifiers", () => {
    expect(texts).toContain(`Burger Clásica  ${formatARS(250000)}`);
    expect(texts).toContain("   Sin cebolla");
    expect(texts).toContain(`   Extra queso  (+${formatARS(20000)})`);
    expect(texts).toContain(`Papas  ${formatARS(250000)}`);
  });

  it("shows the unit note", () => {
    const d = renderDeliveryTicket(makeOrder({ items: [{ name: "Papas", unitPrice: 100, note: "bien cocida", modifiers: [], addonSeq: null }] }));
    expect(textsOf(d)).toContain("   Nota: bien cocida");
  });

  it("shows the total and the charge to collect for pending cash", () => {
    expect(texts).toContain(`Subtotal: ${formatARS(500000)}`);
    expect(texts).toContain(`Envío: ${formatARS(50000)}`);
    expect(textBlock(doc, `TOTAL: ${formatARS(550000)}`)).toMatchObject({ bold: true, size: 2 });
    expect(textBlock(doc, `Efectivo: cobrar ${formatARS(550000)}`)).toMatchObject({ bold: true });
  });

  it.each([
    ["transfer", "paid", "Pago: Transferencia (pagado)"],
    ["transfer", "pending", "Pago: Transferencia (pendiente de verificación)"],
    ["cash", "paid", "Pago: Efectivo (pagado)"],
  ] as const)("payment line for %s/%s", (paymentMethod, paymentStatus, line) => {
    const t = textsOf(renderDeliveryTicket(makeOrder({ paymentMethod, paymentStatus })));
    expect(t).toContain(line);
    expect(t.some((x) => x.startsWith("Efectivo: cobrar"))).toBe(false);
  });

  it("ends with a cut", () => {
    expect(doc.blocks.at(-1)).toEqual({ type: "cut" });
  });
});

describe("add-on units in full-order tickets", () => {
  const withAddons = makeOrder({
    items: [
      { name: "Burger Clásica", unitPrice: 250000, note: null, modifiers: [], addonSeq: null },
      { name: "Papas", unitPrice: 120000, note: null, modifiers: [], addonSeq: 1 },
      { name: "Coca", unitPrice: 90000, note: null, modifiers: [], addonSeq: 2 },
    ],
  });

  it("the kitchen comanda tags each add-on unit (ADICIONAL n) and leaves the original ones untouched", () => {
    const texts = textsOf(renderKitchenTicket(withAddons));
    expect(texts).toContain("1) BURGER CLÁSICA");
    expect(texts).toContain("2) PAPAS (ADICIONAL 1)");
    expect(texts).toContain("3) COCA (ADICIONAL 2)");
  });

  it("the add-on comanda itself is not tagged (its header already says ADICIONAL n)", () => {
    const texts = textsOf(renderAdditionalTicket(makeOrder({ number: 7, items: [withAddons.items[1]] }), { seq: 1 }));
    expect(texts).toContain("1) PAPAS");
    expect(texts.filter((t) => t.includes("ADICIONAL"))).toEqual(["ADICIONAL 1 al #7"]);
  });

  it("customer and delivery item lists tag add-on units next to the price", () => {
    for (const doc of [renderCustomerTicket(withAddons), renderDeliveryTicket(withAddons)]) {
      const texts = textsOf(doc);
      expect(texts).toContain(`Burger Clásica  ${formatARS(250000)}`);
      expect(texts).toContain(`Papas (ADICIONAL 1)  ${formatARS(120000)}`);
      expect(texts).toContain(`Coca (ADICIONAL 2)  ${formatARS(90000)}`);
    }
  });

  it("an updated delivery ticket says it replaces the previous one, right under the header", () => {
    const doc = renderDeliveryTicket(withAddons, { updated: { addonSeqs: [2, 1] } });
    expect(doc.blocks[2]).toEqual({
      type: "text",
      text: "TICKET ACTUALIZADO - reemplaza al anterior (incluye ADICIONAL 1, 2)",
      bold: true,
      align: "center",
    });
    expect(textsOf(renderDeliveryTicket(withAddons)).some((t) => t.includes("ACTUALIZADO"))).toBe(false);
  });
});

describe("purity", () => {
  it("returns equal documents for equal input and does not mutate it", () => {
    const order = makeOrder();
    const snapshot = structuredClone(order);
    expect(renderKitchenTicket(order)).toEqual(renderKitchenTicket(order));
    expect(renderCustomerTicket(order)).toEqual(renderCustomerTicket(order));
    expect(renderDeliveryTicket(order)).toEqual(renderDeliveryTicket(order));
    expect(order).toEqual(snapshot);
  });
});
