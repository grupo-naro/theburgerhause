export const POS_CART_KEY_PREFIX = "bh_pos_cart_v1:";

/**
 * localStorage key of the counter (POS) cart: one per station, so it survives reloads on the same
 * till, never mixes with the customer cart (`bh_cart_v1`) and a cashier on another station gets a
 * different cart. An admin without a station uses a dedicated key.
 */
export function posCartStorageKey(stationId: number | null): string {
  return `${POS_CART_KEY_PREFIX}${stationId ?? "none"}`;
}
