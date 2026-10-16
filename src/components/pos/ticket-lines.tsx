"use client";

import { TrashIcon } from "@/components/menu/icons";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { formatARS } from "@/domain/money";
import { selectedModifiers } from "@/lib/cart/display";
import { lineTotalFor } from "@/lib/cart/pricing";
import { modifierDisplay } from "@/lib/cart/sheet-state";
import type { CartGroup } from "@/lib/cart/types";
import type { PublicModifier } from "@/lib/menu/public";
import { PencilIcon } from "./pos-icons";
import { PosStepper } from "./pos-stepper";

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

const iconBtn = "grid size-11 shrink-0 place-items-center rounded-full";

/**
 * Compact grouped ticket lines (part of the ONE scroller of the ticket body): row 1 name + line
 * total; row 2 stepper, modification chips and icon-only Editar / Quitar (44px targets, labelled).
 * Chips get their own full-width row under the stepper.
 */
export function TicketLines({ groups, flash, onQuantity, onEdit, onRemove }: Props) {
  const index = useMenuIndex();
  return (
    <ul data-testid="ticket-lines" className="flex flex-col divide-y divide-line">
      {groups.map((g) => {
        const product = index.products.get(g.productId);
        const mods = product ? selectedModifiers(product, g.modifierIds) : [];
        const flashing = flash?.signature === g.signature;
        const name = product?.name ?? "producto";
        return (
          <li key={g.signature} data-testid="ticket-line" data-product-id={g.productId} data-quantity={g.quantity} className="py-2">
            <div key={flashing ? flash.nonce : "idle"} className={`-mx-2 rounded-xl px-2 ${flashing ? "animate-pos-line-flash" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <p data-testid="line-name" className="min-w-0 text-lg leading-tight font-bold text-ink">
                  {product?.name ?? "Producto"}
                </p>
                <p data-testid="line-total" className="shrink-0 font-display text-xl leading-tight font-extrabold tabular-nums text-ink">
                  {formatARS(lineTotalFor(g, index))}
                </p>
              </div>
              <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
                <PosStepper
                  compact
                  value={g.quantity}
                  min={0}
                  max={99}
                  onChange={(n) => onQuantity(g.signature, n)}
                  label={`unidades de ${name}`}
                  testId="line-qty"
                />
                <div className="col-span-3 row-start-2">
                  {(mods.length > 0 || g.note) && (
                    <ul className="flex flex-wrap gap-1 py-1">
                      {mods.map((m) => {
                        const d = modifierDisplay(m);
                        return (
                          <li
                            key={m.id}
                            data-testid="line-chip"
                            className={`rounded-full px-2 py-0.5 text-sm font-semibold ring-1 ${KIND_CHIP[d.kind]}`}
                          >
                            {d.label}
                            {d.priceLabel && <span className="ml-1 tabular-nums">{d.priceLabel}</span>}
                          </li>
                        );
                      })}
                      {g.note && (
                        <li data-testid="line-note" className="rounded-lg bg-bg px-2 py-0.5 text-sm text-ink-muted italic ring-1 ring-line">
                          Nota: {g.note}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <div className="col-start-3 row-start-1 flex items-center justify-self-end">
                  <button
                    type="button"
                    data-testid="line-edit"
                    onClick={(e) => onEdit(g, e.currentTarget)}
                    aria-label={`Editar ${name}`}
                    title="Editar"
                    className={`${iconBtn} text-brand-600 hover:bg-brand-50`}
                  >
                    <PencilIcon className="size-5" />
                  </button>
                  <button
                    type="button"
                    data-testid="line-remove"
                    onClick={() => onRemove(g)}
                    aria-label={`Quitar ${name}`}
                    title="Quitar"
                    className={`${iconBtn} text-state-error hover:bg-red-50`}
                  >
                    <TrashIcon className="size-5" />
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
