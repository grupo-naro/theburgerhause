import { revalidatePath } from "next/cache";

/**
 * Call from Server Actions after saving the promotion. The storefront reads the promotion UNCACHED
 * (a dynamic hole in the layout, see PromoGate), so there is no data cache to expire: only the
 * admin page needs refreshing.
 */
export function invalidatePromo(): void {
  revalidatePath("/admin/promocion");
}
