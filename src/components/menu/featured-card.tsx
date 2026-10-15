"use client";

import { useProductSheet } from "@/components/product/sheet-context";
import { formatARS } from "@/domain/money";
import type { PublicProduct } from "@/lib/menu/public";
import { ProductImage } from "./product-image";

export function FeaturedCard({ product, priority }: { product: PublicProduct; priority: boolean }) {
  const { openProduct } = useProductSheet();
  return (
    <button
      type="button"
      onClick={() => openProduct(product.id)}
      className="group block w-full overflow-hidden rounded-xl border border-line bg-surface text-left shadow-[0_2px_10px_rgba(11,31,58,0.06)] transition duration-200 hover:shadow-[0_10px_24px_rgba(11,31,58,0.12)] active:scale-[0.99]"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-brand-50">
        <ProductImage product={product} priority={priority} sizes="(min-width: 640px) 288px, 72vw" />
        <span className="absolute bottom-2 right-2 rounded-full bg-cheddar-400 px-3 py-1 font-display text-lg font-extrabold leading-tight text-ink shadow-md">
          {formatARS(product.price)}
        </span>
      </span>
      <span className="block truncate px-4 py-3 font-display text-lg font-bold text-ink">{product.name}</span>
    </button>
  );
}
