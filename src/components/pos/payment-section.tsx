"use client";

import { useId } from "react";
import { CheckIcon, InfoIcon } from "@/components/menu/icons";
import { formatARS } from "@/domain/money";
import { parsePesosInput, quickAmounts } from "@/lib/pos/change";
import { CashIcon, TransferIcon } from "./pos-icons";

export type PaymentMethod = "cash" | "transfer";

type Props = {
  payment: PaymentMethod | null;
  onPayment: (method: PaymentMethod) => void;
  totalCents: number;
  receivedText: string;
  onReceivedText: (text: string) => void;
};

const OPTIONS = [
  { value: "cash", label: "Efectivo", Icon: CashIcon },
  { value: "transfer", label: "Transferencia", Icon: TransferIcon },
] as const;

/**
 * Payment method: two large exclusive buttons, NO default (the cashier must choose). Cash adds the
 * optional "Recibido" helper (quick amounts + a prominent change line); transfer a reminder.
 */
export function PaymentSection({ payment, onPayment, totalCents, receivedText, onReceivedText }: Props) {
  const receivedId = useId();
  const received = parsePesosInput(receivedText);
  const quick = totalCents > 0 ? quickAmounts(totalCents) : [];
  return (
    <section aria-labelledby="pos-pay-h" data-testid="payment-section">
      <h3 id="pos-pay-h" className="mb-2 font-display text-base font-extrabold tracking-wide text-ink-muted uppercase">
        Pago
      </h3>
      <div role="group" aria-label="Método de pago" className="grid grid-cols-2 gap-2">
        {OPTIONS.map(({ value, label, Icon }) => {
          const on = payment === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              data-testid={`pay-${value}`}
              onClick={() => onPayment(value)}
              className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 px-2 font-display text-lg font-extrabold transition-colors ${
                on
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50"
              }`}
            >
              {on ? <CheckIcon className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
              {label}
            </button>
          );
        })}
      </div>

      {payment === "transfer" && (
        <p
          data-testid="transfer-reminder"
          className="mt-3 flex items-start gap-2 rounded-xl bg-cheddar-400/25 px-3 py-2.5 text-base font-semibold text-ink"
        >
          <InfoIcon className="mt-0.5 size-5 shrink-0" />
          Verificá la transferencia antes de cobrar
        </p>
      )}

      {payment === "cash" && (
        <div data-testid="cash-helper" className="mt-3 rounded-2xl bg-bg p-3">
          <div className="flex items-center gap-3">
            <label htmlFor={receivedId} className="shrink-0 font-display text-base font-bold">
              Recibido
            </label>
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-display text-lg font-bold text-ink-muted">$</span>
              <input
                id={receivedId}
                inputMode="numeric"
                autoComplete="off"
                value={receivedText === "" ? "" : Number(receivedText).toLocaleString("es-AR")}
                onChange={(e) => onReceivedText(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="Opcional"
                data-testid="received-input"
                className="min-h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-8 text-right font-display text-xl font-bold tabular-nums"
              />
            </div>
          </div>
          {quick.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Montos rápidos">
              {quick.map((cents, i) => (
                <button
                  key={cents}
                  type="button"
                  data-testid="quick-amount"
                  data-cents={cents}
                  onClick={() => onReceivedText(String(Math.ceil(cents / 100)))}
                  className="min-h-12 rounded-xl border border-line bg-surface px-3.5 font-display text-base font-bold tabular-nums hover:bg-brand-50"
                >
                  {i === 0 ? `Justo ${formatARS(cents)}` : formatARS(cents)}
                </button>
              ))}
            </div>
          )}
          {received === null && <p className="mt-2 px-1 text-sm text-ink-muted">Ingresá lo recibido para ver el vuelto.</p>}
        </div>
      )}
    </section>
  );
}
