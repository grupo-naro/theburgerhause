"use client";

import { useMenuIndex } from "@/components/menu/menu-provider";
import { formatARS } from "@/domain/money";
import { selectedModifiers } from "@/lib/cart/display";
import { lineTotalFor } from "@/lib/cart/pricing";
import { modifierDisplay } from "@/lib/cart/sheet-state";
import type { CartGroup } from "@/lib/cart/types";
import type { PublicModifier } from "@/lib/menu/public";
import { PencilIcon } from "./pos-icons";
import { PosStepper } from "./pos-stepper";
import { TrashIcon } from "@/components/menu/icons";

type Props = {
  groups: CartGroup[];
  /** Signature of the group that just received a plain unit (+1 flash). */
  flash: { signature: string; nonce: number } | null;
  onQuantity: (signature: string, quantity: number) => void;
  onEdit: (group: CartGroup, opener: HTMLElement) => void;
  onRemove: (group: CartGroup) => void;
};

const KIND_CHIP: Record<PublicModifier["kind"], string> = {
  remove: "bg-red-50 text-state-error ring-red-200",
  add: "bg-brand-50 text-brand-700 ring-brand-300/60",
  swap: "bg-cheddar-400/25 text-ink ring-cheddar-600/40",
};

/** Grouped ticket lines: qty stepper, chips for the modifications, note, line total and Editar / Quitar. */
export function TicketLines({ groups, flash, onQuantity, onEdit, onRemove }: Props) {
  const index = useMenuIndex();
  return (
    <ul data-testid="ticket-lines" className="flex max-h-[max(17rem,34dvh)] flex-col divide-y divide-line overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
      {groups.map((g) => {
        const product = index.products.get(g.productId);
        const mods = product ? selectedModifiers(product, g.modifierIds) : [];
        const flashing = flash?.signature === g.signature;
        return (
          <li
            key={g.signature}
            data-testid="ticket-line"
            data-product-id={g.productId}
            data-quantity={g.quantity}
            className="py-3"
          >
            <div key={flashing ? flash.nonce : "idle"} className={`-mx-2 rounded-xl px-2 ${flashing ? "animate-pos-line-flash" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <p data-testid="line-name" className="min-w-0 text-lg leading-tight font-bold text-ink">
                  {product?.name ?? "Producto"}
                </p>
                <p data-testid="line-total" className="shrink-0 font-display text-xl leading-tight font-extrabold tabular-nums text-ink">
                  {formatARS(lineTotalFor(g, index))}
                </p>
              </div>
              {(mods.length > 0 || g.note) && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {mods.map((m) => {
                    const d = modifierDisplay(m);
                    return (
                      <li
                        key={m.id}
                        data-testid="line-chip"
                        className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ring-1 ${KIND_CHIP[d.kind]}`}
                      >
                        {d.label}
                        {d.priceLabel && <span className="ml-1 tabular-nums">{d.priceLabel}</span>}
                      </li>
                    );
                  })}
                  {g.note && (
                    <li data-testid="line-note" className="rounded-lg bg-bg px-2.5 py-0.5 text-sm text-ink-muted italic ring-1 ring-line">
                      Nota: {g.note}
                    </li>
                  )}
                </ul>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <PosStepper
                  value={g.quantity}
                  min={0}
                  max={99}
                  onChange={(n) => onQuantity(g.signature, n)}
                  label={`unidades de ${product?.name ?? "producto"}`}
                  testId="line-qty"
                />
                <div className="flex items-center">
                  {product && (
                    <button
                      type="button"
                      data-testid="line-edit"
                      onClick={(e) => onEdit(g, e.currentTarget)}
                      aria-label={`Editar ${product.name}`}
                      className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1.5 rounded-full px-0 text-base font-bold text-brand-600 hover:bg-brand-50 @[22rem]/ticket:px-3.5"
                    >
                      <PencilIcon className="size-4.5" />
                      <span className="hidden @[22rem]/ticket:inline">Editar</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="line-remove"
                    onClick={() => onRemove(g)}
                    aria-label={`Quitar ${product?.name ?? "producto"}`}
                    className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1.5 rounded-full px-0 text-base font-bold text-state-error hover:bg-red-50 @[22rem]/ticket:px-3.5"
                  >
                    <TrashIcon className="size-4.5" />
                    <span className="hidden @[22rem]/ticket:inline">Quitar</span>
                  </button>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
