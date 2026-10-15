import { describe, expect, it } from "vitest";
import { assertCents, formatARS } from "@/domain/money";

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
