import { describe, expect, it } from "vitest";
import { approvalState } from "./approval";

describe("approvalState", () => {
  it("transfer needs the verification checkbox", () => {
    expect(approvalState({ paymentMethod: "transfer", verified: false, busy: false })).toMatchObject({
      enabled: false,
      label: "Aprobar y pagado",
      hint: "Tildá la verificación del pago para aprobar",
    });
    expect(approvalState({ paymentMethod: "transfer", verified: true, busy: false })).toMatchObject({
      enabled: true,
      label: "Aprobar y pagado",
      hint: null,
    });
  });
  it("cash needs nothing and explains the pending collection", () => {
    expect(approvalState({ paymentMethod: "cash", verified: false, busy: false })).toMatchObject({
      enabled: true,
      label: "Aprobar",
      hint: "El cobro queda pendiente (lo cobra el cadete / en el local)",
    });
  });
  it("busy disables everything", () => {
    expect(approvalState({ paymentMethod: "cash", verified: false, busy: true }).enabled).toBe(false);
    expect(approvalState({ paymentMethod: "transfer", verified: true, busy: true }).enabled).toBe(false);
  });
});
