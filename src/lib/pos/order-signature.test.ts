import { describe, expect, it } from "vitest";
import { posSignature } from "./order-signature";

const u = (productId: number, modifierIds: number[] = [], note = "") => ({ productId, modifierIds, note });
const base = { units: [u(1), u(2, [5])], payment: "cash" as const, pager: 7, name: "Ana" };

describe("posSignature", () => {
  it("same ticket -> same signature, line order irrelevant", () => {
    expect(posSignature({ ...base, units: [u(2, [5]), u(1)] })).toBe(posSignature(base));
  });
  it("any order-defining field changes it", () => {
    const sig = posSignature(base);
    expect(posSignature({ ...base, units: [u(1)] })).not.toBe(sig);
    expect(posSignature({ ...base, payment: "transfer" })).not.toBe(sig);
    expect(posSignature({ ...base, pager: 8 })).not.toBe(sig);
    expect(posSignature({ ...base, name: "Beto" })).not.toBe(sig);
    expect(posSignature({ ...base, units: [u(1, [], "sin sal"), u(2, [5])] })).not.toBe(sig);
  });
  it("name whitespace is irrelevant, blank equals none", () => {
    expect(posSignature({ ...base, name: "  Ana   " })).toBe(posSignature(base));
    expect(posSignature({ ...base, name: "" })).toBe(posSignature({ ...base, name: "   " }));
  });
});
