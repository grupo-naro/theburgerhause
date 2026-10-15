"use server";

import { getDb } from "@/db/client";
import { getAcceptingOrders } from "@/lib/settings";

/**
 * The REAL "are we taking orders?" check for the storefront (the client flag from the closed
 * notice is optimistic UI only). Public (no auth), strongly consistent: reads the DB, never a cache.
 * Task 4.3 enforces the same rule again when the order is created.
 */
export async function checkOrdersOpen(): Promise<{ open: boolean }> {
  return { open: await getAcceptingOrders(getDb()) };
}
