import { describe, expect, it } from "vitest";
import { chargeState, type ChargeInput } from "./can-charge";

const ok: ChargeInput = { lineCount: 2, payment: "cash", pager: 7, pagerHolder: null, inFlight: false, hasStation: true };
const s = (over: Partial<ChargeInput>) => chargeState({ ...ok, ...over });

describe("chargeState", () => {
  it("everything in place -> enabled, no reason", () => {
    expect(chargeState(ok)).toEqual({ canCharge: true, reason: null });
  });
  it.each([
    ["no station", { hasStation: false }, "Elegí una estación para cobrar"],
    ["empty ticket", { lineCount: 0 }, "Agregá productos al ticket"],
    ["no payment", { payment: null }, "Elegí el método de pago"],
    ["no pager", { pager: null }, "Ingresá el llamador"],
    ["pager in use", { pagerHolder: { orderNumber: 23 } }, "El llamador 7 está en uso (pedido #23)"],
    ["in flight", { inFlight: true }, "Cobrando…"],
  ] as const)("%s -> disabled with a reason", (_n, over, reason) => {
    expect(s(over as Partial<ChargeInput>)).toEqual({ canCharge: false, reason });
  });
  it("transfer is as valid as cash", () => {
    expect(s({ payment: "transfer" }).canCharge).toBe(true);
  });
  it("in flight wins over every other reason", () => {
    expect(s({ inFlight: true, lineCount: 0, payment: null, pager: null, hasStation: false }).reason).toBe("Cobrando…");
  });
  it("priority: station, then lines, then payment, then pager, then in use", () => {
    expect(s({ hasStation: false, lineCount: 0, payment: null, pager: null }).reason).toBe("Elegí una estación para cobrar");
    expect(s({ lineCount: 0, payment: null, pager: null }).reason).toBe("Agregá productos al ticket");
    expect(s({ payment: null, pager: null }).reason).toBe("Elegí el método de pago");
    expect(s({ pager: null }).reason).toBe("Ingresá el llamador");
  });
  it("exhaustive table: enabled iff all conditions hold", () => {
    const bools = [true, false];
    for (const hasStation of bools)
      for (const hasLines of bools)
        for (const hasPayment of bools)
          for (const hasPager of bools)
            for (const taken of bools)
              for (const inFlight of bools) {
                const r = chargeState({
                  lineCount: hasLines ? 1 : 0,
                  payment: hasPayment ? "cash" : null,
                  pager: hasPager ? 5 : null,
                  pagerHolder: taken ? { orderNumber: 1 } : null,
                  inFlight,
                  hasStation,
                });
                const expected = hasStation && hasLines && hasPayment && hasPager && !taken && !inFlight;
                expect(r.canCharge).toBe(expected);
                expect(r.reason === null).toBe(expected);
              }
  });
});
