import { describe, expect, it } from "vitest";
import { board, order } from "./fixtures";
import { pruneSelection } from "./selection";
import { canAssign, failureHeadline, formatAssignFailure } from "./assign";

describe("canAssign", () => {
  it("enabled with a selection, a cadet and nothing in flight", () => {
    expect(canAssign(new Set([1]), 4, false)).toEqual({ enabled: true, reason: null });
  });
  it("explains each missing condition", () => {
    expect(canAssign(new Set(), 4, false)).toEqual({ enabled: false, reason: "Elegí al menos un pedido" });
    expect(canAssign(new Set([1]), null, false)).toEqual({ enabled: false, reason: "Elegí un cadete" });
    expect(canAssign(new Set([1]), 4, true)).toEqual({ enabled: false, reason: "Asignando…" });
  });
  it("reports the selection first when both are missing", () => {
    expect(canAssign(new Set(), null, false).reason).toBe("Elegí al menos un pedido");
  });
  it("in flight wins over everything", () => {
    expect(canAssign(new Set(), null, true).reason).toBe("Asignando…");
  });
});

describe("canAssign with the pruned selection", () => {
  it("does not enable Asignar when every selected order left the lane", () => {
    const b = board({ ready: { delivery: [order({ id: 1 })], takeaway: [] } });
    const raw = new Set([7, 8]);
    expect(canAssign(raw, 4, false).enabled).toBe(true); // the raw size would wrongly allow it
    const pruned = new Set(pruneSelection(raw, b));
    expect(canAssign(pruned, 4, false)).toEqual({ enabled: false, reason: "Elegí al menos un pedido" });
  });
});

describe("formatAssignFailure", () => {
  it("lists every offending order, falling back to the id", () => {
    const lines = formatAssignFailure([
      { orderId: 12, orderNumber: 12, reason: "Está en camino; tiene que estar listo para despacho" },
      { orderId: 77, orderNumber: null, reason: "El pedido no existe" },
    ]);
    expect(lines).toEqual(["#12: Está en camino; tiene que estar listo para despacho", "#77: El pedido no existe"]);
  });
  it("is empty without details", () => expect(formatAssignFailure(undefined)).toEqual([]));
});

describe("failureHeadline", () => {
  it("keeps only the first sentence when the offenders are listed separately", () => {
    expect(failureHeadline("No se asignó ningún pedido. #12 (Está en camino); #15 (no existe)", true)).toBe("No se asignó ningún pedido.");
  });
  it("leaves other messages untouched", () => {
    expect(failureHeadline("El cadete Ana está inactivo y no puede recibir pedidos", false)).toBe("El cadete Ana está inactivo y no puede recibir pedidos");
    expect(failureHeadline("Sin punto", true)).toBe("Sin punto");
  });
});
