import { describe, expect, it } from "vitest";
import { buildTitle } from "./title";

describe("buildTitle", () => {
  it("no pending: plain", () => {
    expect(buildTitle({ pending: 0, alert: false })).toBe("Caja");
  });
  it("pending shows the count", () => {
    expect(buildTitle({ pending: 3, alert: false })).toBe("(3) Caja");
  });
  it("alert phase flashes the new-order text with the count", () => {
    expect(buildTitle({ pending: 3, alert: true })).toBe("(3) ¡Nuevo pedido!");
  });
  it("alert with nothing pending still flashes", () => {
    expect(buildTitle({ pending: 0, alert: true })).toBe("¡Nuevo pedido!");
  });
  it("negative or fractional counts are sanitized", () => {
    expect(buildTitle({ pending: -2, alert: false })).toBe("Caja");
    expect(buildTitle({ pending: 2.9, alert: false })).toBe("(2) Caja");
  });
});

describe("buildTitle base", () => {
  it("a workspace can name its own base title", () => {
    expect(buildTitle({ pending: 2, alert: false, base: "Gestión Delivery" })).toBe("(2) Gestión Delivery");
    expect(buildTitle({ pending: 0, alert: false, base: "Retiro en local" })).toBe("Retiro en local");
    expect(buildTitle({ pending: 2, alert: true, base: "Retiro en local" })).toBe("(2) ¡Nuevo pedido!");
  });
});
