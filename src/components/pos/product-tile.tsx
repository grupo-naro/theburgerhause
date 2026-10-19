"use client";

import { ProductImage } from "@/components/menu/product-image";
import { formatARS } from "@/domain/money";
import type { PublicProduct } from "@/lib/menu/public";

type Props = {
  product: PublicProduct;
  /** Bumped by the board every time ONE plain unit of this product is added: restarts the "+1" pulse. */
  pulse: number;
  onAdd: (product: PublicProduct) => void;
  onCustomize: (product: PublicProduct, opener: HTMLElement) => void;
  /** The server said this drink ran out: the tile is disabled and says "Sin stock". */
  soldOut?: boolean;
};

/**
 * Big POS tile. Tapping the tile adds ONE plain unit immediately (the fast path: no modal);
 * products with modifier groups get a separate "Personalizar" strip so the customized flow is never
 * reached by accident.
 */
export function ProductTile({ product, pulse, onAdd, onCustomize, soldOut = false }: Props) {
  const customizable = product.modifierGroups.length > 0;
  const price = formatARS(product.price);
  return (
    <li
      data-testid="pos-tile"
      data-product-id={product.id}
      data-sold-out={soldOut || undefined}
      className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm${soldOut ? " opacity-60" : ""}`}
    >
      <button
        type="button"
        data-tile-main
        onClick={() => onAdd(product)}
        disabled={soldOut}
        aria-label={soldOut ? `${product.name}: sin stock` : `Agregar ${product.name}, ${price}`}
        className="group relative flex min-h-32 flex-1 flex-col text-left transition-colors hover:bg-brand-50/60 active:bg-brand-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <span className="relative block aspect-[16/10] w-full overflow-hidden bg-brand-50 [&_img[width='96']]:size-12 md:[&_img[width='96']]:size-12">
          <ProductImage product={product} sizes="(min-width: 1280px) 160px, 180px" />
          {pulse > 0 && (
            <span
              key={pulse}
              aria-hidden="true"
              data-testid="tile-pulse"
              className="animate-pos-plus absolute right-2 top-2 rounded-full bg-cheddar-400 px-2.5 py-0.5 font-display text-base font-extrabold text-ink shadow-md"
            >
              +1
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col justify-between gap-1 px-2.5 pb-2.5 pt-2">
          <span className="line-clamp-3 text-base leading-tight font-semibold text-ink">{product.name}</span>
          {soldOut ? (
            <span data-testid="tile-sold-out" className="font-display text-base leading-none font-extrabold text-state-error">
              Sin stock
            </span>
          ) : (
            <span className="font-display text-xl leading-none font-extrabold text-brand-600">{price}</span>
          )}
        </span>
      </button>
      {customizable && !soldOut && (
        <button
          type="button"
          data-testid="tile-customize"
          aria-label={`Personalizar ${product.name}`}
          onClick={(e) => onCustomize(product, e.currentTarget)}
          className="min-h-12 border-t border-line bg-bg px-2 font-display text-base font-bold text-brand-600 transition-colors hover:bg-brand-50 active:bg-brand-50"
        >
          Personalizar
        </button>
      )}
    </li>
  );
}
