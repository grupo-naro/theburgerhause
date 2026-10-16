import { describe, expect, it } from "vitest";
import { RETURN_QUICK_REASONS, isReturnReasonValid } from "./reasons";

describe("return reasons", () => {
  it("offers the four quick reasons", () => {
    expect([...RETURN_QUICK_REASONS]).toEqual(["No atendió", "Dirección incorrecta", "Rechazó el pedido", "Sin cambio"]);
  });
  it("needs 3 to 200 trimmed characters", () => {
    expect(isReturnReasonValid("  ab ")).toBe(false);
    expect(isReturnReasonValid("abc")).toBe(true);
    expect(isReturnReasonValid("x".repeat(201))).toBe(false);
  });
});
