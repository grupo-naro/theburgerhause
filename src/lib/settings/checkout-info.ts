import type { Db } from "@/db/client";
import { getSettings, type Settings } from "./index";

/**
 * The ONLY settings the public checkout page may see. Everything else (store name, accepting_orders,
 * future keys) stays out of the serialized props on purpose. Money in centavos.
 */
export type CheckoutInfo = Pick<
  Settings,
  "deliveryFee" | "bankAlias" | "bankCbu" | "storeAddress" | "openingHoursText" | "storePhone" | "whatsapp"
>;

export function toCheckoutInfo(s: Settings): CheckoutInfo {
  return {
    deliveryFee: s.deliveryFee,
    bankAlias: s.bankAlias,
    bankCbu: s.bankCbu,
    storeAddress: s.storeAddress,
    openingHoursText: s.openingHoursText,
    storePhone: s.storePhone,
    whatsapp: s.whatsapp,
  };
}

/** Uncached loader (the cached wrapper `getCheckoutInfo` lives in lib/menu/queries.ts). */
export async function loadCheckoutInfo(db: Db): Promise<CheckoutInfo> {
  return toCheckoutInfo(await getSettings(db));
}
