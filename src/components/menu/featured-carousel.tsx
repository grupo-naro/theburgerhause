import type { PublicProduct } from "@/lib/menu/public";
import { FeaturedCard } from "./featured-card";

/** Horizontal scroll-snap row of featured products. Renders nothing without featured items. */
export function FeaturedCarousel({ products }: { products: PublicProduct[] }) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="destacados-title" className="pt-6">
      <div className="mx-auto max-w-[1100px] px-4">
        <h2 id="destacados-title" className="font-display text-2xl font-extrabold text-ink sm:text-3xl">
          Destacados
        </h2>
      </div>
      <ul className="no-scrollbar mx-auto mt-3 flex max-w-[1100px] snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3">
        {products.map((p, i) => (
          <li key={p.id} className="w-[72%] shrink-0 snap-start sm:w-72">
            <FeaturedCard product={p} priority={i === 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}
