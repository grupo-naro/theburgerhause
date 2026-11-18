import { describe, expect, it } from "vitest";
import { formatPriceChange, priceChangePct, purchaseTotal } from "./purchases";

describe("purchaseTotal", () => {
  it("multiplies quantity (milli) by the unit price", () => {
    expect(purchaseTotal(20_000, 200_000)).toBe(4_000_000); // 20 kg × $2.000 = $40.000
    expect(purchaseTotal(40_000, 150_000)).toBe(6_000_000); // 40 u × $1.500 = $60.000
    expect(purchaseTotal(12_500, 150_050)).toBe(1_875_625); // 12,5 kg × $1.500,50 = $18.756,25
  });

  it("stays exact beyond 2^53", () => {
    expect(purchaseTotal(2_000_000_000, 2_000_000_000)).toBe(4e15);
  });

  it("rounds half up", () => {
    expect(purchaseTotal(1, 1_499)).toBe(1);
    expect(purchaseTotal(1, 1_500)).toBe(2);
  });
});

describe("priceChangePct", () => {
  it("is the % change against the previous price, one decimal", () => {
    expect(priceChangePct(200_000, 240_000)).toBe(20);
    expect(priceChangePct(160_000, 150_000)).toBe(-6.3);
    expect(priceChangePct(100, 100)).toBe(0);
  });
});

describe("formatPriceChange", () => {
  it("shows an arrow, es-AR decimals and no trailing ,0", () => {
    expect(formatPriceChange(20)).toBe("▲ 20%");
    expect(formatPriceChange(-6.5)).toBe("▼ 6,5%");
    expect(formatPriceChange(0)).toBe("= 0%");
  });
});
