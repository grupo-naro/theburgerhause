import type { PublicMenu, PublicProduct } from "./public";

/** Lowercase, strip diacritics, trim and collapse whitespace. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matches(product: PublicProduct, words: string[]): boolean {
  const haystack = normalizeSearchText(`${product.name} ${product.description ?? ""}`);
  return words.every((w) => haystack.includes(w));
}

/**
 * Instant menu filter over name + description. Every word of the query must
 * appear. Keeps the original order and drops categories left empty. A blank
 * query returns the very same menu object.
 */
export function filterMenu(menu: PublicMenu, query: string): PublicMenu {
  const q = normalizeSearchText(query);
  if (!q) return menu;
  const words = q.split(" ");
  return {
    categories: menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => matches(p, words)) }))
      .filter((c) => c.products.length > 0),
    featured: menu.featured.filter((p) => matches(p, words)),
  };
}
