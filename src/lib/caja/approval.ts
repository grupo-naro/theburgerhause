export type ApprovalState = {
  enabled: boolean;
  label: string;
  /** Visible explanation under the button (why it is disabled / what happens). */
  hint: string | null;
};

export const TRANSFER_HINT = "Tildá la verificación del pago para aprobar";
export const CASH_HINT = "El cobro queda pendiente (lo cobra el cadete / en el local)";

/** Transfer needs the "verifiqué la acreditación" tick; cash does not. A busy card never fires. */
export function approvalState(args: {
  paymentMethod: "cash" | "transfer";
  verified: boolean;
  busy: boolean;
}): ApprovalState {
  if (args.paymentMethod === "transfer") {
    return {
      enabled: args.verified && !args.busy,
      label: "Aprobar y pagado",
      hint: args.verified ? null : TRANSFER_HINT,
    };
  }
  return { enabled: !args.busy, label: "Aprobar", hint: CASH_HINT };
}
