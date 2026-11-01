import type { PublicMenu, PublicProduct } from "@/lib/menu/public";
import type { CartGroup } from "./types";

export const MAX_SUGGESTIONS = 6;

/**
 * Products to offer before checkout: flagged `suggest`, in menu order (category order, then product
 * order), not already in the cart (any configuration of the product), at most `MAX_SUGGESTIONS`.
 * Paused products never reach the public menu, so they are never suggested.
 */
export function pickSuggestions(menu: PublicMenu, groups: Pick<CartGroup, "productId">[]): PublicProduct[] {
  const inCart = new Set(groups.map((g) => g.productId));
  return menu.categories
    .flatMap((c) => c.products)
    .filter((p) => p.suggest && !inCart.has(p.id))
    .slice(0, MAX_SUGGESTIONS);
}
