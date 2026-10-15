"use client";

import { useProductSheet } from "@/components/product/sheet-context";
import { formatARS } from "@/domain/money";
import type { PublicProduct } from "@/lib/menu/public";
import { PlusIcon } from "./icons";
import { ProductImage } from "./product-image";

/** The whole card is one button that opens the product sheet (UX spec 3.2). */
export function ProductCard({ product }: { product: PublicProduct }) {
  const { openProduct } = useProductSheet();
  return (
    <button
      type="button"
      onClick={() => openProduct(product.id)}
      data-testid="product-card"
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-[0_2px_10px_rgba(11,31,58,0.06)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(11,31,58,0.12)] active:translate-y-0 active:scale-[0.99]"
    >
      <span className="block aspect-[4/3] w-full overflow-hidden bg-brand-50 md:aspect-square">
        <ProductImage product={product} sizes="(min-width: 1100px) 340px, (min-width: 768px) 45vw, 100vw" />
      </span>
      <span className="flex flex-1 flex-col gap-1 p-4">
        <span className="block font-display text-lg font-bold leading-tight text-ink">{product.name}</span>
        {product.description && (
          <span className="line-clamp-2 block text-sm leading-snug text-ink-muted">{product.description}</span>
        )}
        <span className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="font-display text-2xl font-extrabold leading-none text-brand-600">
            {formatARS(product.price)}
          </span>
          <span className="sr-only">Elegir y agregar</span>
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-cheddar-400 text-ink shadow-sm transition-colors group-hover:bg-cheddar-600"
          >
            <PlusIcon className="size-5" />
          </span>
        </span>
      </span>
    </button>
  );
}
