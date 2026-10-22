import { describe, expect, it } from "vitest";
import { parseAssignTandaForm, tandaChangeReason } from "./assign-tanda";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("parseAssignTandaForm", () => {
  it("reads the tanda, every orderId, the cadet and the confirmation", () => {
    expect(
      parseAssignTandaForm(form([["tanda", " 2 "], ["orderId", "5"], ["orderId", "9"], ["cadetId", "3"], ["confirmPartial", "1"]])),
    ).toEqual({ ok: true, data: { tanda: 2, orderIds: [5, 9], cadetId: 3, confirmPartial: true } });
  });
  it("a missing confirmation means not confirmed", () => {
    expect(parseAssignTandaForm(form([["tanda", "1"], ["orderId", "5"], ["cadetId", "3"]]))).toMatchObject({ ok: true, data: { confirmPartial: false } });
    expect(parseAssignTandaForm(form([["tanda", "1"], ["orderId", "5"], ["cadetId", "3"], ["confirmPartial", "0"]]))).toMatchObject({ ok: true, data: { confirmPartial: false } });
  });
  it.each([
    [[["tanda", ""], ["orderId", "5"], ["cadetId", "3"]]],
    [[["tanda", "0"], ["orderId", "5"], ["cadetId", "3"]]],
    [[["tanda", "abc"], ["orderId", "5"], ["cadetId", "3"]]],
    [[["tanda", "1"], ["cadetId", "3"]]],
    [[["tanda", "1"], ["orderId", "1.5"], ["cadetId", "3"]]],
    [[["tanda", "1"], ["orderId", "-2"], ["cadetId", "3"]]],
    [[["tanda", "1"], ["orderId", "5"]]],
    [[["tanda", "1"], ["orderId", "5"], ["cadetId", "x"]]],
    [[["tanda", "1"], ["orderId", "5"], ["cadetId", "3"], ["confirmPartial", "si"]]],
  ] as [string, string][][][])("refuses %j", (entries) => {
    expect(parseAssignTandaForm(form(entries)).ok).toBe(false);
  });
  it("refuses more than 50 orders", () => {
    const many: [string, string][] = Array.from({ length: 51 }, (_, i) => ["orderId", String(i + 1)]);
    expect(parseAssignTandaForm(form([["tanda", "1"], ["cadetId", "3"], ...many])).ok).toBe(false);
  });
});

describe("tandaChangeReason", () => {
  it("is null for an order still ready in the tanda", () => {
    expect(tandaChangeReason({ tanda: 1, status: "listo_despacho" }, 1)).toBeNull();
  });
  it("explains a different tanda, no tanda and a state change", () => {
    expect(tandaChangeReason({ tanda: 2, status: "listo_despacho" }, 1)).toBe("Ahora es de la tanda 2");
    expect(tandaChangeReason({ tanda: null, status: "listo_despacho" }, 1)).toBe("Ya no tiene tanda");
    expect(tandaChangeReason({ tanda: 1, status: "en_camino" }, 1)).toBe("Ya no está listo: está en camino");
    expect(tandaChangeReason({ tanda: 1, status: "cancelado" }, 1)).toBe("Ya no está listo: está cancelado");
  });
});
