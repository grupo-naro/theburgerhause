export type ChargeInput = {
  lineCount: number;
  payment: "cash" | "transfer" | null;
  /** Valid typed pager (1..999) or null. */
  pager: number | null;
  /** The ACTIVE counter order holding the typed pager, if any. */
  pagerHolder: { orderNumber: number } | null;
  inFlight: boolean;
  hasStation: boolean;
};

export type ChargeState = { canCharge: boolean; reason: string | null };

/**
 * The single rule behind the "Cobrar e imprimir" button. When disabled, `reason` is the FIRST
 * missing thing, in the order the cashier does them, so the button itself says what to do next.
 */
export function chargeState(i: ChargeInput): ChargeState {
  const no = (reason: string): ChargeState => ({ canCharge: false, reason });
  if (i.inFlight) return no("Cobrando…");
  if (!i.hasStation) return no("Elegí una estación para cobrar");
  if (i.lineCount === 0) return no("Agregá productos al ticket");
  if (i.payment === null) return no("Elegí el método de pago");
  if (i.pager === null) return no("Ingresá el llamador");
  if (i.pagerHolder) return no(`El llamador ${i.pager} está en uso (pedido #${i.pagerHolder.orderNumber})`);
  return { canCharge: true, reason: null };
}
