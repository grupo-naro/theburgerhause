"use client";

import { CheckIcon } from "@/components/menu/icons";
import { fieldId, type CheckoutForm, type FieldErrors, type PaymentMethod } from "@/lib/checkout/form";
import type { CheckoutInfo } from "@/lib/settings/checkout-info";
import { CopyRow } from "./copy-row";
import { CheckoutSection } from "./section";

type Props = {
  form: CheckoutForm;
  errors: FieldErrors;
  info: CheckoutInfo;
  onChange: (patch: Partial<CheckoutForm>) => void;
};

const CARDS: { value: PaymentMethod; title: string; text: string }[] = [
  { value: "cash", title: "Efectivo", text: "Pagás en efectivo al recibir o retirar el pedido" },
  { value: "transfer", title: "Transferencia", text: "Te mostramos los datos de la cuenta" },
];

export function PaymentSection({ form, errors, info, onChange }: Props) {
  const error = errors.paymentMethod;
  const hasBank = info.bankAlias !== "" || info.bankCbu !== "";
  return (
    <CheckoutSection n={3} title="Pago" headingId="checkout-h-pago">
      <fieldset aria-describedby={error ? `${fieldId("paymentMethod")}-error` : undefined}>
        <legend className="sr-only">Medio de pago</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CARDS.map((c, i) => {
            const id = i === 0 ? fieldId("paymentMethod") : `checkout-payment-${c.value}`;
            return (
              <div key={c.value} className="relative">
                <input
                  type="radio"
                  name="paymentMethod"
                  id={id}
                  value={c.value}
                  checked={form.paymentMethod === c.value}
                  onChange={() => onChange({ paymentMethod: c.value })}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  data-testid={`payment-${c.value}`}
                  className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border-2 ${error ? "border-state-error" : "border-line"} bg-surface p-4 transition-colors hover:border-brand-300 peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                      form.paymentMethod === c.value ? "border-brand-600 bg-brand-600 text-white" : "border-line"
                    }`}
                  >
                    {form.paymentMethod === c.value && <CheckIcon className="size-3" strokeWidth={3.5} />}
                  </span>
                  <span>
                    <span className="block font-display text-lg font-bold leading-tight text-ink">{c.title}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-muted">{c.text}</span>
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p id={`${fieldId("paymentMethod")}-error`} role="alert" className="text-sm font-medium text-state-error">
          {error}
        </p>
      )}

      {form.paymentMethod === "transfer" && (
        <div data-testid="transfer-details" className="space-y-2 rounded-2xl bg-brand-50 p-3">
          {hasBank ? (
            <>
              {info.bankAlias && <CopyRow label="Alias" value={info.bankAlias} testId="bank-alias" />}
              {info.bankCbu && <CopyRow label="CBU / CVU" value={info.bankCbu} testId="bank-cbu" />}
            </>
          ) : (
            <p className="px-1 text-sm text-ink">Te pasamos los datos de la cuenta por WhatsApp al confirmar tu pedido.</p>
          )}
          <p className="px-1 text-sm font-medium text-ink">Un cajero verificará tu pago antes de preparar el pedido.</p>
        </div>
      )}
    </CheckoutSection>
  );
}
