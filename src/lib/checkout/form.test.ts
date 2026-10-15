import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  FIELD_ORDER,
  fieldId,
  firstInvalidField,
  splitFieldErrors,
  toCreateOrderInput,
  validateForm,
  type CheckoutForm,
} from "./form";

const KEY = "11111111-1111-4111-8111-111111111111";
const units = [{ productId: 1, modifierIds: [2], note: "" }];

const delivery: CheckoutForm = {
  ...EMPTY_FORM,
  fulfillment: "delivery",
  name: "Juana Pérez",
  whatsapp: "11 5555-1234",
  address: "Calle Falsa 123",
  crossStreets: "Rivadavia y Mitre",
  notes: "Timbre roto",
  paymentMethod: "transfer",
};

describe("toCreateOrderInput", () => {
  it("maps a delivery form", () => {
    expect(toCreateOrderInput(delivery, units, KEY)).toEqual({
      idempotencyKey: KEY,
      units,
      customer: { name: "Juana Pérez", whatsapp: "11 5555-1234" },
      fulfillment: "delivery",
      delivery: { address: "Calle Falsa 123", crossStreets: "Rivadavia y Mitre", notes: "Timbre roto" },
      paymentMethod: "transfer",
      bh_ref: "",
    });
  });

  it("omits the delivery block for takeaway, even if the fields were filled", () => {
    const input = toCreateOrderInput({ ...delivery, fulfillment: "takeaway", paymentMethod: "cash" }, units, KEY);
    expect(input).not.toHaveProperty("delivery");
    expect(input.fulfillment).toBe("takeaway");
  });

  it("leaves paymentMethod undefined until a card is chosen and never sends prices or totals", () => {
    const input = toCreateOrderInput({ ...delivery, paymentMethod: null }, units, KEY);
    expect(input.paymentMethod).toBeUndefined();
    for (const forbidden of ["total", "subtotal", "price", "deliveryFee", "status"]) {
      expect(input).not.toHaveProperty(forbidden);
    }
  });

  it("passes the honeypot value through so the server can reject bots", () => {
    expect(toCreateOrderInput({ ...delivery, bh_ref: "http://spam" }, units, KEY).bh_ref).toBe("http://spam");
  });
});

describe("validateForm", () => {
  it("accepts a complete delivery form and returns the parsed input", () => {
    const r = validateForm(delivery, units, KEY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.customer.whatsapp).toBe("1155551234");
  });

  it("accepts takeaway without any address", () => {
    expect(validateForm({ ...delivery, fulfillment: "takeaway", address: "", crossStreets: "" }, units, KEY).ok).toBe(true);
  });

  it("reports each invalid field under its dotted path, with Spanish messages", () => {
    const r = validateForm({ ...EMPTY_FORM, whatsapp: "abc" }, units, KEY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fields).sort()).toEqual([
      "customer.name",
      "customer.whatsapp",
      "delivery.address",
      "delivery.crossStreets",
      "paymentMethod",
    ]);
    expect(r.fields["customer.whatsapp"]).toMatch(/WhatsApp/);
    expect(r.fields.paymentMethod).toBe("Elegí un medio de pago");
  });

  it("routes non-field problems (empty cart) to `other`", () => {
    const r = validateForm(delivery, [], KEY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fields).toEqual({});
    expect(r.other).toEqual(["El pedido está vacío"]);
  });
});

describe("splitFieldErrors", () => {
  it("splits known fields from the rest and dedupes", () => {
    expect(
      splitFieldErrors({
        "customer.name": "Es demasiado corto",
        "units.0.productId": "Producto inválido",
        "units.1.productId": "Producto inválido",
        idempotencyKey: "Clave inválida",
      }),
    ).toEqual({
      fields: { "customer.name": "Es demasiado corto" },
      other: ["Producto inválido", "Clave inválida"],
    });
  });
  it("handles undefined", () => {
    expect(splitFieldErrors(undefined)).toEqual({ fields: {}, other: [] });
  });
});

describe("firstInvalidField", () => {
  it("follows the visual order of the page, not the order of the errors", () => {
    expect(firstInvalidField({ paymentMethod: "x", "customer.name": "x", "delivery.address": "x" })).toBe("delivery.address");
    expect(firstInvalidField({ paymentMethod: "x", "customer.whatsapp": "x" })).toBe("customer.whatsapp");
    expect(firstInvalidField({ paymentMethod: "x" })).toBe("paymentMethod");
    expect(firstInvalidField({})).toBeNull();
  });
  it("lists every field once", () => {
    expect(new Set(FIELD_ORDER).size).toBe(FIELD_ORDER.length);
  });
});

describe("fieldId", () => {
  it("builds stable DOM ids", () => {
    expect(fieldId("customer.name")).toBe("checkout-customer-name");
    expect(fieldId("delivery.crossStreets")).toBe("checkout-delivery-crossStreets");
  });
});
