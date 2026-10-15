import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db/client";
import { getSettings, type Settings } from "@/lib/settings";
import { SETTINGS_CACHE_TAG } from "@/lib/settings/cache";
import { MENU_CACHE_TAG } from "./cache";
import { loadMenu, type PublicMenu } from "./public";

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
