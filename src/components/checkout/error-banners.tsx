"use client";

import Link from "next/link";
import { InfoIcon } from "@/components/menu/icons";
import { fieldId, type FieldErrors, type FieldKey } from "@/lib/checkout/form";

/** Top-of-form summary of the invalid fields (role=alert) with a shortcut to each one. */
export function ErrorSummary({ errors, other }: { errors: FieldErrors; other: readonly string[] }) {
  const entries = Object.entries(errors) as [FieldKey, string][];
  if (entries.length === 0 && other.length === 0) return null;
  const focus = (key: FieldKey) => document.getElementById(fieldId(key))?.focus();
  return (
    <div
      role="alert"
      data-testid="error-summary"
      className="rounded-2xl border border-state-error bg-red-50 p-4 text-state-error"
    >
      <p className="font-display text-base font-bold">Revisá tus datos para poder confirmar</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {entries.map(([key, message]) => (
          <li key={key}>
            <button type="button" onClick={() => focus(key)} className="min-h-6 text-left font-medium underline underline-offset-2">
              {message}
            </button>
          </li>
        ))}
        {other.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/** `UNITS_INVALID`: which items cannot be ordered any more, and the way to fix the cart. */
export function UnitsInvalidBanner({ messages }: { messages: readonly string[] }) {
  return (
    <section
      role="alert"
      data-testid="units-invalid-banner"
      className="rounded-2xl border border-cheddar-600/50 bg-cheddar-400/20 p-4"
    >
      <div className="flex items-start gap-3">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-ink" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-extrabold text-ink">Algunos productos ya no están disponibles</h2>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-snug text-ink">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink">No creamos tu pedido. Revisalo y volvé a confirmar.</p>
        </div>
      </div>
      <Link
        href="/carrito"
        data-testid="units-invalid-cart-link"
        className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-display text-sm font-bold text-white transition-colors hover:bg-brand-700"
      >
        Revisar mi pedido
      </Link>
    </section>
  );
}

/** Store paused: the form stays usable to read, but the submit button is disabled. */
export function ClosedInline({ hours }: { hours: string }) {
  return (
    <div
      role="status"
      data-testid="checkout-closed"
      className="flex items-start gap-3 rounded-2xl bg-cheddar-400 px-4 py-3 text-ink"
    >
      <InfoIcon className="mt-0.5 size-5 shrink-0" />
      <p className="text-sm leading-snug">
        <strong className="font-bold">Ahora no podemos tomar tu pedido.</strong> Tu selección queda guardada: volvé a
        intentarlo cuando abramos.
        {hours && <span className="mt-0.5 block whitespace-pre-line">{hours}</span>}
      </p>
    </div>
  );
}
