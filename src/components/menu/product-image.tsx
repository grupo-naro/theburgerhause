import type { PublicProduct } from "@/lib/menu/public";

type Props = {
  product: Pick<PublicProduct, "name" | "imageUrl" | "thumbUrl">;
  /** First image above the fold: eager + high fetch priority (LCP). */
  priority?: boolean;
  sizes: string;
};

/**
 * Fills its parent (give the parent an aspect-ratio box: no layout shift).
 * Plain <img>: uploads are already processed to 800w/200w WebP, served with
 * immutable caching, so next/image's optimizer adds nothing here.
 */
export function ProductImage({ product, priority = false, sizes }: Props) {
  if (!product.imageUrl) {
    return (
      <span
        aria-hidden="true"
        className="flex size-full items-center justify-center bg-gradient-to-br from-brand-50 to-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-512.webp"
          alt=""
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          className="size-24 rounded-full opacity-90 shadow-sm"
        />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.imageUrl}
      srcSet={product.thumbUrl ? `${product.thumbUrl} 200w, ${product.imageUrl} 800w` : undefined}
      sizes={sizes}
      alt={product.name}
      width={800}
      height={600}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="size-full object-cover"
    />
  );
}
