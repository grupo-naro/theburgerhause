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
    it("takeaway with the delivery key omitted entirely", () => {
      const noKey: Record<string, unknown> = { ...base(), fulfillment: "takeaway" };
      delete noKey.delivery;
      expect(createOrderSchema.safeParse(noKey).success).toBe(true);
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
        customer: { name: "Ju\u0000an\u0007a200b", whatsapp: "1155551234" },
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

describe("createOrderSchema hardening", () => {
  const INT4 = 2_147_483_647;
  it("accepts the int4 maximum and rejects bigger ids (VALIDATION, not a DB overflow)", () => {
    expect(parse({ units: [{ ...unit, productId: INT4, modifierIds: [INT4] }] }).success).toBe(true);
    for (const big of [3_000_000_000, INT4 + 1]) {
      expect(parse({ units: [{ ...unit, productId: big }] }).success).toBe(false);
      expect(parse({ units: [{ ...unit, modifierIds: [big] }] }).success).toBe(false);
    }
  });

  describe("free-text characters", () => {
    // Built from code points so the file itself stays free of invisible characters.
    const u = (...cps: number[]) => String.fromCodePoint(...cps);
    const nameOf = (name: string) => {
      const r = parse({ customer: { name, whatsapp: "1155551234" } });
      return r.success ? r.data.customer.name : null;
    };
    it("removes C0/C1 controls, BOM, bidi overrides and isolates, other format chars", () => {
      expect(nameOf(`Ana${u(0x00, 0x1f, 0x7f, 0x85)}`)).toBe("Ana");
      expect(nameOf(`${u(0xfeff)}Ana`)).toBe("Ana");
      expect(nameOf(`A${u(0x202a, 0x202e)}na${u(0x202c)}`)).toBe("Ana");
      expect(nameOf(`A${u(0x2066, 0x2067, 0x2068)}n${u(0x2069)}a`)).toBe("Ana");
      expect(nameOf(`A${u(0x200b)}n${u(0x2060, 0x200e, 0x200f)}a`)).toBe("Ana");
    });
    it("keeps ZWJ / ZWNJ so emoji sequences and some scripts survive", () => {
      const chef = `Chef ${u(0x1f468, 0x200d, 0x1f373)}`;
      expect(nameOf(chef)).toBe(chef);
      const persian = u(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645);
      expect(nameOf(persian)).toBe(persian);
    });
    it("maps U+2028 / U+2029 to a plain space instead of deleting", () => {
      expect(nameOf(`Ana${u(0x2028)}Maria`)).toBe("Ana Maria");
      expect(nameOf(`Ana${u(0x2029)}Maria`)).toBe("Ana Maria");
    });
  });

  it("non-string / malformed values report SPANISH messages (no English zod text)", () => {
    const e = errors({
      customer: { name: 42, whatsapp: { a: 1 } },
      units: [{ productId: "x", modifierIds: "no", note: 5 }],
      paymentMethod: 7,
      idempotencyKey: 5,
    });
    const msgs = Object.values(e);
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(["customer.name", "customer.whatsapp", "units.0.productId", "paymentMethod", "idempotencyKey"]),
    );
    for (const m of msgs) expect(m).not.toMatch(/expected|invalid input|received|string|number/i);
    expect(e["customer.whatsapp"]).toBe("Ingresá un número de WhatsApp válido (solo números, con característica)");
  });

  it("a missing customer / units / fulfillment also reports Spanish", () => {
    const r = createOrderSchema.safeParse({});
    expect(r.success).toBe(false);
    if (r.success) return;
    for (const m of Object.values(fieldErrorsOf(r.error))) expect(m).not.toMatch(/expected|invalid input|received/i);
  });

  it("normalizes the idempotency key to lowercase", () => {
    const r = parse({ idempotencyKey: KEY.toUpperCase() });
    expect(r.success && r.data.idempotencyKey).toBe(KEY);
  });
});
