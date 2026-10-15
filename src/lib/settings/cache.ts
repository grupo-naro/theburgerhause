import { revalidatePath, updateTag } from "next/cache";

/** Tag for cached public reads of the settings (store info, delivery fee, bank data). */
export const SETTINGS_CACHE_TAG = "settings";

/**
 * Call from Server Actions after any settings write. `updateTag` expires cached
 * public reads immediately (read-your-own-writes). It is only valid inside
 * Server Actions; a Route Handler must use `revalidateTag` instead.
 *
 * `accepting_orders` is NOT subject to this cache: order creation reads it
 * straight from the DB (`getAcceptingOrders`).
 */
export function invalidateSettings(): void {
  updateTag(SETTINGS_CACHE_TAG);
  revalidatePath("/admin/ajustes");
}
