"use client";

import { ProductImage } from "@/components/menu/product-image";
import { TrashIcon } from "@/components/menu/icons";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { formatARS } from "@/domain/money";
import { selectedModifiers } from "@/lib/cart/display";
import { MAX_GROUP_QUANTITY } from "@/lib/cart/reducer";
import { modifierDisplay } from "@/lib/cart/sheet-state";
import { unitTotalFor, type MenuIndex } from "@/lib/cart/pricing";
import type { CartGroup } from "@/lib/cart/types";

type Props = {
  group: CartGroup;
  index: MenuIndex;
  onQuantity: (quantity: number) => void;
  onEdit: (opener: HTMLElement) => void;
  onRemove: () => void;
};

const action =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors";

/** One cart group: identical units are shown together with a quantity stepper. */
export function CartLine({ group, index, onQuantity, onEdit, onRemove }: Props) {
  const product = index.products.get(group.productId);
  if (!product) return null;
  const unit = unitTotalFor(group, index);
  const chips = selectedModifiers(product, group.modifierIds).map(modifierDisplay);
  return (
    <li data-testid="cart-line" className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
      <div className="flex gap-3">
        <span className="block size-16 shrink-0 overflow-hidden rounded-xl bg-brand-50 sm:size-20">
          <ProductImage product={{ ...product, imageUrl: product.thumbUrl ?? product.imageUrl }} sizes="80px" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 data-testid="cart-line-name" className="font-display text-lg font-bold leading-tight text-ink">
            {product.name}
          </h3>
          {chips.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Modificaciones">
              {chips.map((c) => (
                <li
                  key={`${c.label}-${c.kind}`}
                  data-testid="cart-chip"
                  className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium leading-tight text-brand-700"
                >
                  {c.label}
                  {c.priceLabel && <span className="ml-1 font-bold tabular-nums">{c.priceLabel}</span>}
                </li>
              ))}
            </ul>
          )}
          {group.note && (
            <p data-testid="cart-note" className="mt-1.5 text-sm italic leading-snug text-ink-muted">
              “{group.note}”
            </p>
          )}
          {group.quantity > 1 && (
            <p className="mt-1 text-sm text-ink-muted">
              <span className="tabular-nums">{formatARS(unit)}</span> c/u
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <QuantityStepper
          value={group.quantity}
          min={0}
          max={MAX_GROUP_QUANTITY}
          label={`Cantidad de ${product.name}`}
          decrementLabel={group.quantity === 1 ? "Quitar del pedido" : "Disminuir cantidad"}
          onChange={onQuantity}
          testId="cart-line-quantity"
        />
        <p data-testid="cart-line-total" className="font-display text-xl font-extrabold tabular-nums text-ink">
          {formatARS(unit * group.quantity)}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={(e) => onEdit(e.currentTarget)}
          className={`${action} -ml-2 text-brand-600 hover:bg-brand-50`}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`${action} -mr-2 text-state-error hover:bg-red-50`}
        >
          <TrashIcon className="size-4" />
          Quitar
        </button>
      </div>
    </li>
  );
}
