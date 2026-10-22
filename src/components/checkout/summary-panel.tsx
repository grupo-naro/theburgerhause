"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/menu/icons";
import { formatARS } from "@/domain/money";
import { selectedModifiers } from "@/lib/cart/display";
import { lineTotalFor, type MenuIndex } from "@/lib/cart/pricing";
import { modifierDisplay } from "@/lib/cart/sheet-state";
import type { CartGroup } from "@/lib/cart/types";
import type { CheckoutPreview } from "@/lib/checkout/preview";
import type { Fulfillment } from "@/lib/checkout/form";

type Props = {
  groups: readonly CartGroup[];
  index: MenuIndex;
  count: number;
  preview: CheckoutPreview;
  fulfillment: Fulfillment;
  submitLabel: string;
  submitDisabled: boolean;
  pending: boolean;
  /** Id of the <form> this panel's button submits (the panel lives outside it, in the sticky column). */
  formId: string;
};

const row = "flex items-baseline justify-between gap-3";

/** Read-only order summary: collapsible on phones, always open and sticky on desktop. Totals are PREVIEW. */
export function SummaryPanel({
  groups,
  index,
  count,
  preview,
  fulfillment,
  submitLabel,
  submitDisabled,
  pending,
  formId,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <aside
      aria-label="Resumen del pedido"
      data-testid="checkout-summary"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5 lg:sticky lg:top-[calc(var(--chrome-h)+1rem)]"
    >
      <h2 className="flex items-center gap-3 font-display text-xl font-extrabold text-ink">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-base font-extrabold text-white"
        >
          4
        </span>
        Resumen
      </h2>

      <button
        type="button"
        data-testid="summary-toggle"
        aria-expanded={open}
        aria-controls="checkout-summary-lines"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 text-left font-bold text-brand-700 lg:hidden"
      >
        <span>
          {open ? "Ocultar" : "Ver"} {count} {count === 1 ? "producto" : "productos"}
        </span>
        <ChevronDownIcon className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <ul
        id="checkout-summary-lines"
        data-testid="summary-lines"
        className={`${open ? "block" : "hidden"} mt-3 space-y-3 lg:mt-4 lg:block`}
      >
        {groups.map((g) => {
          const product = index.products.get(g.productId);
          if (!product) return null;
          const chips = selectedModifiers(product, g.modifierIds).map(modifierDisplay);
          return (
            <li key={g.signature} data-testid="summary-line" className="border-b border-line pb-3 last:border-b-0 last:pb-0">
              <div className={row}>
                <p className="min-w-0 font-bold leading-snug text-ink [overflow-wrap:anywhere]">
                  <span className="tabular-nums">{g.quantity}×</span> {product.name}
                </p>
                <p className="shrink-0 font-bold tabular-nums text-ink">{formatARS(lineTotalFor(g, index))}</p>
              </div>
              {chips.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Modificaciones">
                  {chips.map((c) => (
                    <li
                      key={`${c.label}-${c.kind}`}
                      className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium leading-tight text-brand-700"
                    >
                      {c.label}
                      {c.priceLabel && <span className="ml-1 font-bold tabular-nums">{c.priceLabel}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {g.note && <p className="mt-1 text-sm italic leading-snug text-ink-muted">“{g.note}”</p>}
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4" aria-live="polite">
        <div className={row}>
          <dt className="text-ink-muted">Subtotal</dt>
          <dd data-testid="checkout-subtotal" className="font-medium tabular-nums text-ink">
            {formatARS(preview.subtotal)}
          </dd>
        </div>
        {fulfillment === "delivery" && (
          <div className={row}>
            <dt className="text-ink-muted">Envío</dt>
            <dd data-testid="checkout-delivery-fee" className="font-medium tabular-nums text-ink">
              {preview.deliveryFee === 0 ? "Gratis" : formatARS(preview.deliveryFee)}
            </dd>
          </div>
        )}
        <div className={`${row} pt-1`}>
          <dt className="font-display text-lg font-bold text-ink">Total</dt>
          <dd data-testid="checkout-total" className="font-display text-2xl font-extrabold tabular-nums text-ink">
            {formatARS(preview.total)}
          </dd>
        </div>
      </dl>

      <button
        type="submit"
        form={formId}
        data-testid="checkout-submit"
        disabled={submitDisabled}
        aria-busy={pending}
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-full bg-cheddar-400 px-6 text-center font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-muted disabled:shadow-none disabled:hover:bg-line"
      >
        {submitLabel}
      </button>
      <p className="mt-2 text-center text-xs text-ink-muted">Un cajero revisa y aprueba tu pedido antes de prepararlo.</p>
    </aside>
  );
}
