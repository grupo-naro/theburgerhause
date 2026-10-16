"use client";

import { formatARS } from "@/domain/money";
import type { ChargeState } from "@/lib/pos/can-charge";
import type { Change } from "@/lib/pos/change";
import { LockIcon, PrinterIcon } from "./pos-icons";

type Props = {
  total: number;
  charge: ChargeState;
  /** Cash only (`none` otherwise): shown here so it is NEVER scrolled out of sight. */
  change: Change;
  busy: boolean;
  onCharge: () => void;
};

/**
 * Always-visible bottom of the ticket: the TOTAL, the change to hand back (cash) and the charge
 * button. Enabled = cheddar with the amount; disabled = a quiet dashed button that SAYS what is
 * missing ("Elegí el método de pago").
 */
export function ChargeFooter({ total, charge, change, busy, onCharge }: Props) {
  const price = formatARS(total);
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-4 shadow-[0_-8px_18px_rgba(11,31,58,0.06)]">
      <div className="mb-2.5 flex items-end justify-between gap-2">
        <span className="font-display text-lg font-extrabold tracking-wide text-ink-muted uppercase">
          Total
        </span>
        <span data-testid="ticket-total" className="font-display text-5xl leading-none font-extrabold tabular-nums text-ink">
          {price}
        </span>
      </div>

      <div data-testid="change-box" data-kind={change.kind} aria-live="polite">
        {change.kind === "change" && (
          <p className="mb-2.5 flex items-baseline justify-between rounded-xl bg-state-ready/15 px-4 py-2 text-ink ring-2 ring-state-ready">
            <span className="font-display text-lg font-bold">Vuelto</span>
            <span data-testid="change-amount" className="font-display text-4xl leading-none font-extrabold tabular-nums">
              {formatARS(change.cents)}
            </span>
          </p>
        )}
        {change.kind === "exact" && (
          <p data-testid="change-amount" className="mb-2.5 rounded-xl bg-state-ready/15 px-4 py-2 text-center font-display text-lg font-extrabold text-ink ring-2 ring-state-ready">
            Pago justo, sin vuelto
          </p>
        )}
        {change.kind === "short" && (
          <p className="mb-2.5 flex items-baseline justify-between rounded-xl bg-red-50 px-4 py-2 text-state-error ring-2 ring-state-error">
            <span className="font-display text-lg font-bold">Falta</span>
            <span data-testid="change-amount" className="font-display text-4xl leading-none font-extrabold tabular-nums">
              {formatARS(change.cents)}
            </span>
          </p>
        )}
      </div>

      <button
        type="button"
        data-testid="charge-button"
        data-can-charge={charge.canCharge}
        disabled={!charge.canCharge}
        onClick={onCharge}
        aria-keyshortcuts="Control+Enter"
        className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-5 font-display text-lg leading-tight font-extrabold transition-colors ${
          charge.canCharge
            ? "bg-cheddar-400 text-ink shadow-md ring-2 ring-cheddar-600/40 hover:bg-cheddar-600 active:bg-cheddar-600"
            : "border-2 border-dashed border-line bg-bg text-ink-muted"
        }`}
      >
        {charge.canCharge ? (
          <>
            <PrinterIcon className="size-6 shrink-0" />
            <span>Cobrar e imprimir · {price}</span>
          </>
        ) : (
          <>
            {!busy && <LockIcon className="size-5 shrink-0" />}
            <span data-testid="charge-reason">{charge.reason}</span>
          </>
        )}
      </button>
    </footer>
  );
}
