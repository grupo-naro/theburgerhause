import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db/client";
import { getSettings, type Settings } from "@/lib/settings";
import { SETTINGS_CACHE_TAG } from "@/lib/settings/cache";
import { loadCheckoutInfo, type CheckoutInfo } from "@/lib/settings/checkout-info";
import { MENU_CACHE_TAG } from "./cache";
import { loadMenu, type PublicMenu } from "./public";

/**
 * Data the checkout page needs: delivery fee, bank data, store contact. Cached, invalidated with the
 * settings tag. Bank alias / CBU are shown to customers who choose "Transferencia" anyway.
 */
export async function getCheckoutInfo(): Promise<CheckoutInfo> {
  "use cache";
  cacheTag(SETTINGS_CACHE_TAG);
  cacheLife("hours");
  return loadCheckoutInfo(getDb());
}

/** Public menu, cached and invalidated by `invalidateMenu()` (tag "menu"). */
export async function getMenu(): Promise<PublicMenu> {
  "use cache";
  cacheTag(MENU_CACHE_TAG);
  cacheLife("hours");
  return loadMenu(getDb());
}

export type PublicStoreInfo = Pick<
  Settings,
  "storeName" | "storeAddress" | "storePhone" | "whatsapp" | "openingHoursText"
>;

/**
 * Store contact data only (never bank data or fees). `acceptingOrders` is
 * intentionally excluded: it is read uncached via `getAcceptingOrders`.
 */
export async function getPublicStoreInfo(): Promise<PublicStoreInfo> {
  "use cache";
  cacheTag(SETTINGS_CACHE_TAG);
  cacheLife("hours");
  const s = await getSettings(getDb());
  return {
    storeName: s.storeName,
    storeAddress: s.storeAddress,
    storePhone: s.storePhone,
    whatsapp: s.whatsapp,
    openingHoursText: s.openingHoursText,
  };
}
