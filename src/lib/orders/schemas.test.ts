import { describe, expect, it } from "vitest";
import { createOrderSchema, fieldErrorsOf } from "./schemas";

const KEY = "3f2b8c1e-5d4a-4b7c-9e1f-0a2b3c4d5e6f";
const base = () => ({
  idempotencyKey: KEY,
  units: [{ productId: 1, modifierIds: [2, 3], note: "  sin sal  " }],
  customer: { name: "  Juana Pérez ", whatsapp: "11 5555-1234" },
  fulfillment: "delivery",
  delivery: { address: "Av. Siempreviva 742", crossStreets: "Mitre y Sarmiento", notes: "" },
  paymentMethod: "cash",
  website: "",
});
const parse = (over: Record<string, unknown> = {}) => createOrderSchema.safeParse({ ...base(), ...over });
const errors = (over: Record<string, unknown> = {}) => {
  const r = parse(over);
  return r.success ? {} : fieldErrorsOf(r.error);
};
const unit = { productId: 1, modifierIds: [], note: "" };

describe("createOrderSchema", () => {
  it("parses a valid delivery order and normalizes text", () => {
    const r = parse();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.customer).toEqual({ name: "Juana Pérez", whatsapp: "1155551234" });
    expect(r.data.units[0].note).toBe("sin sal");
    expect(r.data.delivery).toEqual({ address: "Av. Siempreviva 742", crossStreets: "Mitre y Sarmiento", notes: "" });
  });

  it("STRIPS unknown / forged keys at every level", () => {
    const r = parse({
      total: 1,
      subtotal: 1,
      status: "entregado",
      payment_status: "paid",
      paymentStatus: "paid",
      deliveryFee: 0,
      units: [{ productId: 1, modifierIds: [], note: "", price: 1, unitPrice: 1, total: 1 }],
      customer: { name: "Juana", whatsapp: "1155551234", role: "admin" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const d = r.data as Record<string, unknown>;
    for (const k of ["total", "subtotal", "status", "payment_status", "paymentStatus", "deliveryFee"]) {
      expect(k in d).toBe(false);
    }
    expect(Object.keys(r.data.units[0]).sort()).toEqual(["modifierIds", "note", "productId"]);
    expect(Object.keys(r.data.customer).sort()).toEqual(["name", "whatsapp"]);
  });

  describe("delivery vs takeaway", () => {
    it("requires address and crossStreets for delivery", () => {
      const e = errors({ delivery: undefined });
      expect(e["delivery.address"]).toBeTruthy();
      expect(e["delivery.crossStreets"]).toBeTruthy();
    });
    it("validates delivery bounds", () => {
      const e = errors({ delivery: { address: "abc", crossStreets: "ab", notes: "x".repeat(301) } });
      expect(Object.keys(e).sort()).toEqual(["delivery.address", "delivery.crossStreets", "delivery.notes"]);
    });
    it("drops delivery for takeaway (even if garbage)", () => {
      const r = parse({ fulfillment: "takeaway", delivery: { address: 5, whatever: true } });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.delivery).toBeUndefined();
    });
    it("takeaway needs no delivery", () => {
      expect(parse({ fulfillment: "takeaway", delivery: undefined }).success).toBe(true);
    });
    it("rejects an unknown fulfillment", () => {
      expect(errors({ fulfillment: "drone" }).fulfillment).toBeTruthy();
    });
  });

  describe("customer", () => {
    it("enforces name bounds after trimming", () => {
      expect(errors({ customer: { name: " a ", whatsapp: "1155551234" } })["customer.name"]).toBeTruthy();
      expect(errors({ customer: { name: "a".repeat(81), whatsapp: "1155551234" } })["customer.name"]).toBeTruthy();
      expect(parse({ customer: { name: "ab", whatsapp: "1155551234" } }).success).toBe(true);
      expect(parse({ customer: { name: "a".repeat(80), whatsapp: "1155551234" } }).success).toBe(true);
    });
    it("strips control characters from free text", () => {
      const r = parse({
        customer: { name: "Ju\u0000an\u0007a​", whatsapp: "1155551234" },
        units: [{ productId: 1, modifierIds: [], note: "sin\nsal\u0001" }],
        delivery: { address: "Calle\t123\u0000", crossStreets: "A y B", notes: "timbre\r\nroto" },
      });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.customer.name).toBe("Juana");
      expect(r.data.units[0].note).toBe("sin sal");
      expect(r.data.delivery?.address).toBe("Calle 123");
      expect(r.data.delivery?.notes).toBe("timbre roto");
    });
    it("a name made only of control chars is too short", () => {
      expect(errors({ customer: { name: "\u0000\u0001\u0002", whatsapp: "1155551234" } })["customer.name"]).toBeTruthy();
    });
    it("rejects a bad whatsapp with the shared message", () => {
      expect(errors({ customer: { name: "Juana", whatsapp: "12ab" } })["customer.whatsapp"]).toBe(
        "Ingresá un número de WhatsApp válido (solo números, con característica)",
      );
    });
  });

  describe("units", () => {
    it("needs 1..100 units", () => {
      expect(errors({ units: [] }).units).toBeTruthy();
      expect(parse({ units: Array.from({ length: 100 }, () => unit) }).success).toBe(true);
      expect(parse({ units: Array.from({ length: 101 }, () => unit) }).success).toBe(false);
    });
    it("validates ids, modifier count and note length", () => {
      expect(parse({ units: [{ ...unit, productId: 0 }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, productId: 1.5 }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, modifierIds: [-1] }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, modifierIds: Array.from({ length: 31 }, (_, i) => i + 1) }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, note: "x".repeat(141) }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, note: "x".repeat(140) }] }).success).toBe(true);
    });
  });

  describe("idempotency key", () => {
    it.each(["", "abc", KEY.replace("-4b7c-", "-1b7c-"), `${KEY}x`, KEY.replaceAll("-", "")])("rejects %j", (k) => {
      expect(parse({ idempotencyKey: k }).success).toBe(false);
    });
    it("accepts a v4 uuid", () => {
      expect(parse({ idempotencyKey: crypto.randomUUID() }).success).toBe(true);
    });
  });

  it("validates paymentMethod and tolerates a missing honeypot", () => {
    expect(errors({ paymentMethod: "bitcoin" }).paymentMethod).toBeTruthy();
    const noWebsite: Record<string, unknown> = base();
    delete noWebsite.website;
    const r = createOrderSchema.safeParse(noWebsite);
    expect(r.success && r.data.website).toBe("");
  });
});
