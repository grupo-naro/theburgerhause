import { describe, expect, it } from "vitest";
import { MIN_REASON_LENGTH, QUICK_REASONS, applyQuickReason, isReasonValid } from "./reasons";

describe("reject reasons", () => {
  it("offers the four quick reasons", () => {
    expect(QUICK_REASONS).toEqual(["Sin stock", "Zona sin cobertura", "Pago no acreditado", "Datos incompletos"]);
  });
  it("valid from 3 trimmed characters", () => {
    expect(MIN_REASON_LENGTH).toBe(3);
    expect(isReasonValid("")).toBe(false);
    expect(isReasonValid("  ab  ")).toBe(false);
    expect(isReasonValid("abc")).toBe(true);
    expect(isReasonValid("  abc ")).toBe(true);
  });
  it("longer than the server maximum (200) is invalid", () => {
    expect(isReasonValid("x".repeat(200))).toBe(true);
    expect(isReasonValid("x".repeat(201))).toBe(false);
  });
  it("a quick reason replaces the text", () => {
    expect(applyQuickReason("lo que sea", "Sin stock")).toBe("Sin stock");
    expect(applyQuickReason("", "Sin stock")).toBe("Sin stock");
  });
});
