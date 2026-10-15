import type { PublicCategory } from "@/lib/menu/public";
import { sectionId } from "@/lib/menu/section-id";
import { ProductCard } from "./product-card";

export function CategorySection({ category }: { category: PublicCategory }) {
  const id = sectionId(category.slug);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-[calc(var(--chrome-h)+0.5rem)] pt-8">
      <h2
        id={`${id}-title`}
        className="flex items-center gap-3 font-display text-2xl font-extrabold text-ink before:h-6 before:w-1.5 before:rounded-full before:bg-cheddar-400 sm:text-3xl"
      >
        {category.name}
      </h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {category.products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
