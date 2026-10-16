import { describe, expect, it } from "vitest";
import { counterClientSchema, counterOrderSchema } from "./counter-schemas";
import { fieldErrorsOf } from "./schemas";

const KEY = "3f2b8c1e-5d4a-4b7c-9e1f-0a2b3c4d5e6f";
const unit = { productId: 1, modifierIds: [2], note: "  sin sal " };
const base = () => ({ idempotencyKey: KEY, units: [unit], paymentMethod: "cash", pagerNumber: 7 });
const client = (over: Record<string, unknown> = {}) => counterClientSchema.safeParse({ ...base(), ...over });
const errs = (over: Record<string, unknown> = {}) => {
  const r = client(over);
  return r.success ? {} : fieldErrorsOf(r.error);
};

describe("counterClientSchema", () => {
  it("parses a valid sale and cleans text", () => {
    const r = client({ customerName: "  Ana‮  Gómez\n" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.units[0].note).toBe("sin sal");
    expect(r.data.customerName).toBe("Ana  Gómez");
    expect(r.data.pagerNumber).toBe(7);
  });

  it.each([1, 999])("accepts pager %i", (n) => expect(client({ pagerNumber: n }).success).toBe(true));
  it.each([0, 1000, 1.5, Number.NaN, -3, "7", null, undefined, Infinity])("rejects pager %j", (n) => {
    expect(errs({ pagerNumber: n })).toHaveProperty("pagerNumber");
  });

  it("customerName is optional; empty/blank becomes undefined; max 80", () => {
    expect(client().success).toBe(true);
    expect((client() as { data: { customerName?: string } }).data.customerName).toBeUndefined();
    expect((client({ customerName: "   " }) as { data: { customerName?: string } }).data.customerName).toBeUndefined();
    expect(client({ customerName: "a".repeat(80) }).success).toBe(true);
    expect(errs({ customerName: "a".repeat(81) })).toHaveProperty("customerName");
    expect(errs({ customerName: 5 })).toHaveProperty("customerName");
  });

  it("units bounds 1..100", () => {
    expect(errs({ units: [] })).toHaveProperty("units");
    expect(client({ units: Array.from({ length: 100 }, () => unit) }).success).toBe(true);
    expect(errs({ units: Array.from({ length: 101 }, () => unit) })).toHaveProperty("units");
  });

  it("payment method must be cash or transfer", () => {
    expect(client({ paymentMethod: "transfer" }).success).toBe(true);
    expect(errs({ paymentMethod: "card" })).toHaveProperty("paymentMethod");
    expect(errs({ paymentMethod: undefined })).toHaveProperty("paymentMethod");
  });

  it("idempotency key must be a v4 uuid, lowercased", () => {
    expect(errs({ idempotencyKey: "nope" })).toHaveProperty("idempotencyKey");
    const r = client({ idempotencyKey: KEY.toUpperCase() });
    expect(r.success && r.data.idempotencyKey).toBe(KEY);
  });

  it("STRIPS forged keys, including userId/stationId/total/status/price", () => {
    const r = client({
      total: 1,
      subtotal: 1,
      status: "entregado",
      paymentStatus: "pending",
      userId: 99,
      stationId: 99,
      approvedBy: 99,
      channel: "web",
      units: [{ ...unit, price: 1, unitPrice: 1, total: 1 }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(Object.keys(r.data).sort()).toEqual(["idempotencyKey", "pagerNumber", "paymentMethod", "units"]);
    expect(Object.keys(r.data.units[0]).sort()).toEqual(["modifierIds", "note", "productId"]);
  });

  it.each([null, undefined, 5, "x", []])("garbage %j fails", (g) => expect(counterClientSchema.safeParse(g).success).toBe(false));
});

describe("counterOrderSchema (core input, trusted fields)", () => {
  const core = (over: Record<string, unknown> = {}) => counterOrderSchema.safeParse({ ...base(), userId: 3, stationId: 2, ...over });
  it("keeps userId and stationId", () => {
    const r = core();
    expect(r.success && [r.data.userId, r.data.stationId]).toEqual([3, 2]);
  });
  it("stationId may be null (rejected later with STATION_REQUIRED), userId must be a positive int", () => {
    expect(core({ stationId: null }).success).toBe(true);
    expect(core({ userId: 0 }).success).toBe(false);
    expect(core({ userId: "3" }).success).toBe(false);
    expect(core({ userId: undefined }).success).toBe(false);
  });
});
