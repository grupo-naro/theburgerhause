"use client";

import { useProductSheet } from "@/components/product/sheet-context";
import { formatARS } from "@/domain/money";
import type { PublicProduct } from "@/lib/menu/public";
import { PlusIcon } from "./icons";
import { ProductImage } from "./product-image";

/**
 * The whole card is one button that opens the product sheet (UX spec 3.2).
 * Phones: compact horizontal row (text left, 104px thumbnail right, "+" overlapping the thumbnail corner)
 * so a long menu stays scannable. From md: large vertical card with a square photo.
 */
export function ProductCard({ product }: { product: PublicProduct }) {
  const { open } = useProductSheet();
  return (
    <button
      type="button"
      onClick={(e) => open(product.id, { opener: e.currentTarget })}
      data-testid="product-card"
      className="group relative flex min-h-[7.5rem] w-full flex-row items-stretch overflow-hidden rounded-xl border border-line bg-surface text-left shadow-[0_2px_10px_rgba(11,31,58,0.06)] transition duration-200 hover:shadow-[0_10px_24px_rgba(11,31,58,0.12)] active:scale-[0.99] md:h-full md:flex-col md:hover:-translate-y-0.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 pl-4 pr-2 md:order-2 md:p-4">
        <span className="line-clamp-3 block font-display text-base font-bold leading-tight text-ink [overflow-wrap:anywhere] md:line-clamp-2 md:text-lg">
          {product.name}
        </span>
        {product.description && (
          <span className="line-clamp-2 block text-sm leading-snug text-ink-muted">{product.description}</span>
        )}
        <span className="mt-auto flex items-center justify-between gap-3 pt-2 md:pt-3">
          <span className="font-display text-xl font-extrabold leading-none text-brand-600 md:text-2xl">
            {formatARS(product.price)}
          </span>
          <span className="sr-only">Elegir y agregar</span>
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 right-1.5 z-10 grid size-11 shrink-0 place-items-center rounded-full bg-cheddar-400 text-ink shadow-md ring-2 ring-surface transition-colors group-hover:bg-cheddar-600 md:static md:shadow-sm md:ring-0"
          >
            <PlusIcon className="size-5" />
          </span>
        </span>
      </span>
      <span className="m-3 block size-[6.5rem] shrink-0 overflow-hidden rounded-lg bg-brand-50 md:order-1 md:m-0 md:aspect-square md:size-auto md:w-full md:rounded-none">
        <ProductImage product={product} sizes="(min-width: 1100px) 340px, (min-width: 768px) 45vw, 104px" />
      </span>
    </button>
  );
}
