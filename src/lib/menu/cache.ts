import { revalidatePath, updateTag } from "next/cache";

/** Tag attached to the public menu query (`cacheTag(MENU_CACHE_TAG)` in getMenu(), Task 4.1). */
export const MENU_CACHE_TAG = "menu";

/**
 * Call from Server Actions after any menu mutation. `updateTag` expires the
 * public menu immediately (read-your-own-writes, Next 16: only valid inside
 * Server Actions); the admin list is dynamic, so refresh its path too.
 */
export function invalidateMenu(): void {
  updateTag(MENU_CACHE_TAG);
  revalidatePath("/admin/menu");
}
