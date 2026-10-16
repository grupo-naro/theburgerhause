import { describe, expect, it } from "vitest";
import { cashToCollect, needsCollection } from "./cash";

const o = (paymentMethod: "cash" | "transfer", paymentStatus: "pending" | "paid", total: number) => ({ paymentMethod, paymentStatus, total });

describe("cashToCollect", () => {
  it("is 0 for an empty selection", () => expect(cashToCollect([])).toBe(0));
  it("sums only cash + pending", () => {
    expect(cashToCollect([o("cash", "pending", 250_000), o("transfer", "paid", 900_000), o("cash", "pending", 125_050)])).toBe(375_050);
  });
  it("ignores cash already paid and transfers still pending", () => {
    expect(cashToCollect([o("cash", "paid", 100), o("transfer", "pending", 200)])).toBe(0);
  });
  it("keeps centavos exact (no float drift)", () => {
    expect(cashToCollect([o("cash", "pending", 10), o("cash", "pending", 20)])).toBe(30);
    expect(cashToCollect(Array.from({ length: 10 }, () => o("cash", "pending", 10)))).toBe(100);
  });
  it("rejects non-integer money", () => {
    expect(() => cashToCollect([o("cash", "pending", 10.5)])).toThrow();
  });
});

describe("needsCollection", () => {
  it("only takeaway + cash + pending is collected at the counter", () => {
    expect(needsCollection({ fulfillment: "takeaway", ...o("cash", "pending", 1) })).toBe(true);
    expect(needsCollection({ fulfillment: "takeaway", ...o("cash", "paid", 1) })).toBe(false);
    expect(needsCollection({ fulfillment: "takeaway", ...o("transfer", "paid", 1) })).toBe(false);
    expect(needsCollection({ fulfillment: "delivery", ...o("cash", "pending", 1) })).toBe(false);
  });
});
