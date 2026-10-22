import { ProductImage } from "@/components/menu/product-image";
import { formatARS } from "@/domain/money";
import type { PublicProduct } from "@/lib/menu/public";

/** Image (16:9; a small mascot tile when there is no photo), name, description and base price. */
export function SheetHeader({ product, titleId }: { product: PublicProduct; titleId: string }) {
  const text = (
    <div className="min-w-0 flex-1">
      <h2 id={titleId} className="pr-10 font-display text-2xl font-extrabold leading-tight text-ink [overflow-wrap:anywhere]">
        {product.name}
      </h2>
      {product.description && <p className="mt-1 text-sm leading-snug text-ink-muted">{product.description}</p>}
      <p className="mt-2 font-display text-xl font-extrabold text-brand-600">{formatARS(product.price)}</p>
    </div>
  );
  if (!product.imageUrl) {
    return (
      <div className="flex items-start gap-4 px-4 pb-4 pt-5">
        <span className="block size-16 shrink-0 overflow-hidden rounded-xl bg-brand-50">
          <ProductImage product={product} sizes="64px" />
        </span>
        {text}
      </div>
    );
  }
  return (
    <div>
      <div className="aspect-video w-full overflow-hidden bg-brand-50">
        <ProductImage product={product} priority sizes="(min-width: 768px) 512px, 100vw" />
      </div>
      <div className="px-4 pb-4 pt-4">{text}</div>
    </div>
  );
}
