"use client";

import Link from "next/link";
import { formatARS } from "@/domain/money";
import { ContinueShopping } from "./continue-shopping";

type Props = { subtotal: number; count: number; canContinue: boolean; closed: boolean };

const cta =
  "flex min-h-14 w-full items-center justify-center rounded-full bg-cheddar-400 px-6 text-center font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600";

/** Subtotal, the shipping note and the way forward. The total is announced politely as it changes. */
export function CartSummary({ subtotal, count, canContinue, closed }: Props) {
  return (
    <aside
      aria-label="Resumen del pedido"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm lg:sticky lg:top-[calc(var(--chrome-h)+1rem)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-base font-bold text-ink">
          Subtotal{" "}
          <span className="font-sans text-sm font-normal text-ink-muted">
            ({count} {count === 1 ? "producto" : "productos"})
          </span>
        </span>
        <span
          data-testid="cart-subtotal"
          aria-live="polite"
          className="font-display text-2xl font-extrabold tabular-nums text-ink"
        >
          {formatARS(subtotal)}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-muted">El envío se calcula en el siguiente paso.</p>
      <div className="mt-4">
        {canContinue ? (
          <Link href="/checkout" data-testid="cart-continue" className={cta}>
            Continuar con el pedido
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled
              data-testid="cart-continue"
              className={`${cta} cursor-not-allowed bg-line text-ink-muted shadow-none hover:bg-line`}
            >
              Continuar con el pedido
            </button>
            <p className="mt-2 text-center text-sm text-ink-muted">
              {closed ? "Por el momento no estamos tomando pedidos." : "Agregá algo de la carta para continuar."}
            </p>
          </>
        )}
      </div>
      <ContinueShopping className="mt-2 flex min-h-11 items-center justify-center rounded-full text-base font-bold text-brand-600 transition-colors hover:bg-brand-50" />
    </aside>
  );
}
