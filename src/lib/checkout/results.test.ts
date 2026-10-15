import { describe, expect, it } from "vitest";
import { failureMessage, HONEYPOT_MESSAGE } from "./results";

describe("failureMessage", () => {
  it("gives an actionable hint for HONEYPOT whatever the server said", () => {
    expect(failureMessage({ code: "HONEYPOT", message: "x" })).toBe("Recargá la página y probá de nuevo.");
    expect(HONEYPOT_MESSAGE).not.toMatch(/bot|spam|honeypot/i);
  });
  it("passes other messages through", () => {
    expect(failureMessage({ code: "RATE_LIMITED", message: "Demasiados pedidos" })).toBe("Demasiados pedidos");
  });
});
