import { describe, expect, it } from "vitest";
import { assertCents, centsToPesos, formatARS, pesosToCents } from "@/domain/money";

describe("formatARS", () => {
  it("formatea centavos como pesos argentinos", () => {
    expect(formatARS(1_460_000).replace(/\s/g, " ")).toBe("$ 14.600");
  });
  it("formatea cero", () => {
    expect(formatARS(0).replace(/\s/g, " ")).toBe("$ 0");
  });
});

describe("assertCents", () => {
  it("rechaza decimales", () => {
    expect(() => assertCents(10.5)).toThrow("entero");
  });
  it("acepta enteros", () => {
    expect(() => assertCents(1000)).not.toThrow();
  });
});

describe("pesosToCents / centsToPesos", () => {
  it("convierte pesos enteros a centavos y viceversa", () => {
    expect(pesosToCents(14400)).toBe(1_440_000);
    expect(centsToPesos(1_440_000)).toBe(14400);
    expect(pesosToCents(0)).toBe(0);
  });
  it("rechaza pesos no enteros", () => {
    expect(() => pesosToCents(10.5)).toThrow("entero");
    expect(() => pesosToCents(Number.NaN)).toThrow("entero");
  });
  it("redondea al peso al pasar de centavos", () => {
    expect(centsToPesos(1_000_049)).toBe(10000);
    expect(centsToPesos(1_000_050)).toBe(10001);
  });
});
