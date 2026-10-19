import { describe, expect, it } from "vitest";
import { MAX_MILLI, formatQuantity, parseQuantity, stockStatus } from "./quantity";

describe("parseQuantity", () => {
  it("accepts a decimal comma or dot for kg and l", () => {
    expect(parseQuantity("12,5", "kg")).toEqual({ ok: true, milli: 12500 });
    expect(parseQuantity("12.5", "kg")).toEqual({ ok: true, milli: 12500 });
    expect(parseQuantity(" 0,125 ", "l")).toEqual({ ok: true, milli: 125 });
    expect(parseQuantity("50", "kg")).toEqual({ ok: true, milli: 50000 });
  });

  it("accepts whole units", () => {
    expect(parseQuantity("48", "u")).toEqual({ ok: true, milli: 48000 });
  });

  it("rejects zero, negatives, empty and garbage", () => {
    for (const bad of ["0", "0,0", "-1", "", "   ", "abc", "1,2,3", "1e3", "12,", ",5x", "Infinity"]) {
      const r = parseQuantity(bad, "kg");
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects decimals for units", () => {
    const r = parseQuantity("1,5", "u");
    expect(r).toEqual({ ok: false, message: "Para unidades usá números enteros" });
    expect(parseQuantity("2,0", "u")).toEqual({ ok: true, milli: 2000 });
  });

  it("rejects more than 3 decimals and absurd sizes", () => {
    expect(parseQuantity("1,2345", "kg").ok).toBe(false);
    expect(parseQuantity(String(MAX_MILLI / 1000 + 1), "kg").ok).toBe(false);
    expect(parseQuantity(String(MAX_MILLI / 1000), "kg")).toEqual({ ok: true, milli: MAX_MILLI });
  });
});

describe("formatQuantity", () => {
  it("uses es-AR decimal comma and the unit", () => {
    expect(formatQuantity(12500, "kg")).toBe("12,5 kg");
    expect(formatQuantity(3000, "u")).toBe("3 u");
    expect(formatQuantity(125, "l")).toBe("0,125 l");
    expect(formatQuantity(0, "kg")).toBe("0 kg");
    expect(formatQuantity(-2000, "u")).toBe("-2 u");
  });
});

describe("stockStatus", () => {
  it("is agotado at or below zero, poco below the minimum, ok otherwise", () => {
    expect(stockStatus(0, 0)).toBe("agotado");
    expect(stockStatus(-1000, 5000)).toBe("agotado");
    expect(stockStatus(4000, 5000)).toBe("poco");
    expect(stockStatus(5000, 5000)).toBe("ok");
    expect(stockStatus(1, 0)).toBe("ok");
  });
});
