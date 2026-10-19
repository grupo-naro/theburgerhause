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

  it("rejects any decimal separator for units (so '1.000' can never mean 1 u)", () => {
    for (const bad of ["1,5", "2,0", "1.000", "1.250"]) {
      expect(parseQuantity(bad, "u"), bad).toEqual({ ok: false, message: "Para unidades usá números enteros" });
    }
  });

  it("explains a missing whole or decimal part", () => {
    expect(parseQuantity(".5", "kg")).toEqual({ ok: false, message: "Escribí el número completo, por ejemplo 0,5" });
    expect(parseQuantity(",5", "kg")).toEqual({ ok: false, message: "Escribí el número completo, por ejemplo 0,5" });
    expect(parseQuantity("12.", "kg")).toEqual({ ok: false, message: "Completá los decimales o borrá la coma" });
    expect(parseQuantity("12,", "kg")).toEqual({ ok: false, message: "Completá los decimales o borrá la coma" });
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

  it("never uses a thousands separator", () => {
    expect(formatQuantity(1_250_000, "kg")).toBe("1250 kg");
    expect(formatQuantity(1_250_500, "kg")).toBe("1250,5 kg");
    expect(formatQuantity(1_000_000, "u")).toBe("1000 u");
  });
});

describe("round trip parseQuantity(formatQuantity(x)) === x", () => {
  const strip = (s: string) => s.replace(/ (kg|u|l)$/, "");
  const cases: Array<[number, "kg" | "u" | "l"]> = [
    [1_250_000, "kg"],
    [1_250_500, "kg"],
    [12_500, "kg"],
    [1, "kg"],
    [999_999, "kg"],
    [125, "l"],
    [3_000_500, "l"],
    [1000, "u"],
    [3000, "u"],
    [1_000_000, "u"],
    [123_456_000, "u"],
    [MAX_MILLI, "kg"],
  ];
  for (const [milli, unit] of cases) {
    it(`${milli} ${unit}`, () => {
      expect(parseQuantity(strip(formatQuantity(milli, unit)), unit)).toEqual({ ok: true, milli });
    });
  }

  it("holds for a sweep of values", () => {
    for (let milli = 1; milli < 3_000_000; milli += 7_919) {
      expect(parseQuantity(strip(formatQuantity(milli, "kg")), "kg")).toEqual({ ok: true, milli });
      const whole = Math.ceil(milli / 1000) * 1000;
      expect(parseQuantity(strip(formatQuantity(whole, "u")), "u")).toEqual({ ok: true, milli: whole });
    }
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
