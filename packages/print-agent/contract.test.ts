import { describe, expect, it } from "vitest";
import type { PrintDocument } from "./src/document";
import { renderCustomerTicket, renderDeliveryTicket, renderKitchenTicket, type PrintableOrder } from "@/domain/print-document";
import { formatARS } from "@/domain/money";
import { printDocumentSchema as serverSchema } from "@/lib/print/protocol";
import { printDocumentSchema as agentSchema } from "./src/document";
import { toEscPos } from "./src/escpos";
import { previewEscPos } from "./src/printer/console";

/**
 * Keeps the agent's duplicated document types/schema in sync with the server's (src/domain/print-document.ts,
 * src/lib/print/protocol.ts). Runs with the root `pnpm test`.
 */

const order: PrintableOrder = {
  number: 128,
  channel: "web",
  fulfillment: "delivery",
  createdAt: new Date("2026-10-15T15:42:00.000Z"),
  customerName: "María Ñandú",
  whatsapp: "11 5555-1234",
  address: "Av. Corrientes 1234, piso 3°",
  crossStreets: "Callao y Uruguay",
  addressNotes: "Tocar timbre «B»",
  pagerNumber: 7,
  paymentMethod: "cash",
  paymentStatus: "pending",
  subtotal: 1_850_000,
  deliveryFee: 150_000,
  total: 2_000_000,
  items: [
    {
      name: "Doble Cheddar Bacon",
      unitPrice: 950_000,
      note: "sin cebolla, bien cocida",
      modifiers: [
        { name: "Sin cheddar", kitchenLabel: "Sin cheddar", kind: "remove", priceDelta: 0 },
        { name: "Dips de cheddar", kitchenLabel: "+ Dips cheddar", kind: "add", priceDelta: 120_000 },
      ],
      addonSeq: null,
    },
    { name: "Papas fritas", unitPrice: 900_000, note: null, modifiers: [], addonSeq: null },
  ],
};

const kitchen = renderKitchenTicket(order);
const ticket = renderCustomerTicket(order);
const delivery = renderDeliveryTicket(order);
/** Text-only bytes (no logo raster): the raster is binary and would trip the text/UTF-8 assertions. */
const agent = (doc: unknown) => toEscPos(doc as never, { paperWidth: 80, codepage: "cp858" }, { logos: null });
const text = (b: Buffer) => b.toString("latin1");
const CUT = "1b64041d564203";

describe("agent schema vs the server's documents", () => {
  it("accepts what the domain renderers produce", () => {
    expect(agentSchema.safeParse(kitchen).success).toBe(true);
    expect(agentSchema.safeParse(ticket).success).toBe(true);
    expect(agentSchema.safeParse(delivery).success).toBe(true);
    expect(agentSchema.parse(JSON.parse(JSON.stringify(kitchen)))).toEqual(kitchen); // survives the JSON round trip of the wire
  });

  it("agrees with the server schema on valid and invalid shapes", () => {
    const cases: [string, unknown][] = [
      ["empty", { blocks: [] }],
      ["kitchen", kitchen],
      ["ticket", ticket],
      ["delivery", delivery],
      ["logo", { blocks: [{ type: "logo" }, { type: "cut" }] }],
      ["500 blocks", { blocks: Array(500).fill({ type: "divider" }) }],
      ["501 blocks", { blocks: Array(501).fill({ type: "divider" }) }],
      ["text 2000", { blocks: [{ type: "text", text: "x".repeat(2000) }] }],
      ["text 2001", { blocks: [{ type: "text", text: "x".repeat(2001) }] }],
      ["size 3", { blocks: [{ type: "text", text: "a", size: 3 }] }],
      ["align right", { blocks: [{ type: "text", text: "a", align: "right" }] }],
      ["bold string", { blocks: [{ type: "text", text: "a", bold: "yes" }] }],
      ["text missing", { blocks: [{ type: "text" }] }],
      ["blocks not array", { blocks: "x" }],
      ["null", null],
      ["array", []],
    ];
    for (const [name, doc] of cases) {
      expect(agentSchema.safeParse(doc).success, name).toBe(serverSchema.safeParse(doc).success);
    }
    expect(agentSchema.safeParse({ blocks: Array(501).fill({ type: "cut" }) }).success).toBe(false);
    expect(agentSchema.safeParse({ blocks: [{ type: "text", text: "x".repeat(2001) }] }).success).toBe(false);
  });
});

describe("golden: real tickets through toEscPos", () => {
  it("the kitchen ticket keeps the uppercase labels and ends with the cut", () => {
    const out = agent(kitchen);
    const t = text(out);
    for (const label of ["PEDIDO #128", "DELIVERY", "LLAMADOR 7", "1) DOBLE CHEDDAR BACON", "SIN CHEDDAR", "+ DIPS CHEDDAR", "NOTA: SIN CEBOLLA, BIEN COCIDA", "2) PAPAS FRITAS"]) {
      expect(t, label).toContain(label);
    }
    expect(out.toString("hex").endsWith(CUT)).toBe(true);
    expect(out.subarray(0, 5).toString("hex")).toBe("1b401b7413");
    // modifiers are printed double size (GS ! 0x11), at half the width
    expect(out.toString("hex")).toContain("1d2111");
  });

  it("the customer ticket has the header, the accents in cp858 and the total", () => {
    const out = agent(ticket);
    const t = text(out);
    expect(t).toContain("THE BURGER HOUSE 828");
    expect(t).toContain("PEDIDO #128");
    expect(t).toContain("Cliente: Mar\xA1a \xA5and\xA3"); // María Ñandú in cp858: í=A1 Ñ=A5 ú=A3
    expect(t).toContain("Tocar timbre"); // « » have no glyph: they fall back (never UTF-8 garbage)
    expect(t).not.toMatch(/[ÃÂ][\u0080-¿]/); // no UTF-8 sequences
    const total = formatARS(order.total).replace(/ /g, " ");
    expect(t).toContain(`TOTAL: ${total}`);
    expect(t).toContain("Pago: Efectivo (pendiente de cobro)");
    expect(out.toString("hex").endsWith(CUT)).toBe(true);
  });

  it("works on 58 mm paper too: no line longer than 32 columns (16 for size 2)", () => {
    for (const doc of [kitchen, delivery, ticket]) {
      const out = toEscPos(doc, { paperWidth: 58, codepage: "cp858" }, { logos: null });
      for (const line of previewEscPos(out).split("\n")) expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(32);
    }
  });
});

describe("golden: the redesigned tickets", () => {
  const real = (doc: PrintDocument, paperWidth: 58 | 80) => toEscPos(doc, { paperWidth, codepage: "cp858" });
  const GS_V_0 = Buffer.from([0x1d, 0x76, 0x30, 0x00]);

  it("delivery ticket: address, phone, collect line, NO logo raster, NO thanks, ends with the cut", () => {
    const out = real(delivery, 58);
    const t = out.toString("latin1");
    for (const s of ["PEDIDO #128", "DELIVERY", "Cliente: Mar\xA1a \xA5and\xA3", "WhatsApp: 11 5555-1234", "Direcci\xA2n: Av. Corrientes 1234", `Efectivo: cobrar ${formatARS(order.total).replace(/ /g, " ")}`]) {
      expect(t, s).toContain(s);
    }
    expect(out.includes(GS_V_0)).toBe(false);
    expect(t).not.toContain("GRACIAS");
    expect(out.toString("hex").endsWith(CUT)).toBe(true);
  });

  it("customer ticket: the logo raster is the FIRST thing printed and GRACIAS POR TU COMPRA the last before the cut", () => {
    for (const w of [58, 80] as const) {
      const out = real(ticket, w);
      const at = out.indexOf(GS_V_0);
      expect(at, `${w} mm`).toBeGreaterThan(0);
      expect(out.subarray(0, at).toString("hex")).toBe("1b40" + "1b7413" + "1b6101"); // init, cp858, centered: nothing printed before the logo
      const rest = out.subarray(at).toString("latin1");
      expect(rest.lastIndexOf("GRACIAS POR TU COMPRA")).toBeGreaterThan(rest.lastIndexOf("TOTAL"));
      expect(out.toString("hex").endsWith(CUT)).toBe(true);
      expect(out.toString("latin1").lastIndexOf("GRACIAS POR TU COMPRA")).toBeGreaterThan(out.toString("latin1").lastIndexOf("Pago:"));
    }
  });
});
