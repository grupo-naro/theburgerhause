import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { cutoffMinutes, DEFAULT_BUSINESS_DAY_CUTOFF } from "@/db/order-number";

/**
 * Typed view over the key/value `settings` table (jsonb values). No next/*
 * imports. Money is integer centavos (`deliveryFee`).
 *
 * Keys -> field (default):
 *  store_name -> storeName ("The Burger House 828")   store_address -> storeAddress ("")
 *  store_phone -> storePhone ("")                     whatsapp -> whatsapp ("")
 *  bank_alias -> bankAlias ("")                       bank_cbu -> bankCbu ("")
 *  delivery_fee -> deliveryFee (0, centavos)          accepting_orders -> acceptingOrders (true)
 *  opening_hours_text -> openingHoursText ("")
 *  business_day_cutoff -> businessDayCutoff ("06:00", HH:MM Buenos Aires: orders numbering and business date roll here)
 *  base_prep_minutes -> basePrepMinutes (25, integer 5-180)
 *  delivery_travel_minutes -> deliveryTravelMinutes (15, integer 0-120)
 */

export type Settings = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  whatsapp: string;
  bankAlias: string;
  bankCbu: string;
  /** Centavos. */
  deliveryFee: number;
  acceptingOrders: boolean;
  openingHoursText: string;
  /** "HH:MM" (America/Argentina/Buenos_Aires): the business day and the order numbering roll over at this time. */
  businessDayCutoff: string;
  /** Minutes, 5-180: base preparation time used for the customer wait estimate. */
  basePrepMinutes: number;
  /** Minutes, 0-120: extra travel margin added to delivery orders. */
  deliveryTravelMinutes: number;
};

export const DEFAULT_SETTINGS: Settings = {
  storeName: "The Burger House 828",
  storeAddress: "",
  storePhone: "",
  whatsapp: "",
  bankAlias: "",
  bankCbu: "",
  deliveryFee: 0,
  acceptingOrders: true,
  openingHoursText: "",
  businessDayCutoff: DEFAULT_BUSINESS_DAY_CUTOFF,
  basePrepMinutes: 25,
  deliveryTravelMinutes: 15,
};

/** DB key of each field. */
export const SETTING_KEYS = {
  storeName: "store_name",
  storeAddress: "store_address",
  storePhone: "store_phone",
  whatsapp: "whatsapp",
  bankAlias: "bank_alias",
  bankCbu: "bank_cbu",
  deliveryFee: "delivery_fee",
  acceptingOrders: "accepting_orders",
  openingHoursText: "opening_hours_text",
  businessDayCutoff: "business_day_cutoff",
  basePrepMinutes: "base_prep_minutes",
  deliveryTravelMinutes: "delivery_travel_minutes",
} as const satisfies Record<keyof Settings, string>;

type Conn = Db | DbTransaction;

const asString = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const asCents = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fallback;
const asMinutes = (min: number, max: number) => (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
const asPrep = asMinutes(5, 180);
const asTravel = asMinutes(0, 120);
const asCutoff = (v: unknown, fallback: string) => (typeof v === "string" && cutoffMinutes(v) !== null ? v : fallback);
const asBool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Merges rows over the defaults; a missing or garbage value falls back to that key's default. */
export function parseSettings(rows: { key: string; value: unknown }[]): Settings {
  const raw = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_SETTINGS;
  const k = SETTING_KEYS;
  return {
    storeName: asString(raw.get(k.storeName), d.storeName),
    storeAddress: asString(raw.get(k.storeAddress), d.storeAddress),
    storePhone: asString(raw.get(k.storePhone), d.storePhone),
    whatsapp: asString(raw.get(k.whatsapp), d.whatsapp),
    bankAlias: asString(raw.get(k.bankAlias), d.bankAlias),
    bankCbu: asString(raw.get(k.bankCbu), d.bankCbu),
    deliveryFee: asCents(raw.get(k.deliveryFee), d.deliveryFee),
    acceptingOrders: asBool(raw.get(k.acceptingOrders), d.acceptingOrders),
    openingHoursText: asString(raw.get(k.openingHoursText), d.openingHoursText),
    businessDayCutoff: asCutoff(raw.get(k.businessDayCutoff), d.businessDayCutoff),
    basePrepMinutes: asPrep(raw.get(k.basePrepMinutes), d.basePrepMinutes),
    deliveryTravelMinutes: asTravel(raw.get(k.deliveryTravelMinutes), d.deliveryTravelMinutes),
  };
}

/**
 * Reads values as TEXT and parses them here. Drizzle's jsonb decoder runs
 * JSON.parse on values the pg driver already parsed, so a stored string such
 * as "5491155551234" or a 22-digit CBU would come back as a (rounded) number.
 */
const valueText = sql<string>`${s.settings.value}::text`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function getSettings(db: Conn): Promise<Settings> {
  const rows = await db.select({ key: s.settings.key, value: valueText }).from(s.settings);
  return parseSettings(rows.map((r) => ({ key: r.key, value: parseJson(r.value) })));
}

/**
 * Strongly consistent read of the "accepting orders" switch, straight from the
 * DB (never from a cache). Order creation (Task 4.3) must use this one.
 */
export async function getAcceptingOrders(db: Conn): Promise<boolean> {
  const [row] = await db
    .select({ value: valueText })
    .from(s.settings)
    .where(eq(s.settings.key, SETTING_KEYS.acceptingOrders));
  return asBool(row ? parseJson(row.value) : undefined, DEFAULT_SETTINGS.acceptingOrders);
}

/** Strongly consistent read of the business-day cutoff (order creation uses it inside its transaction). */
export async function getBusinessDayCutoff(db: Conn): Promise<string> {
  const [row] = await db
    .select({ value: valueText })
    .from(s.settings)
    .where(eq(s.settings.key, SETTING_KEYS.businessDayCutoff));
  return asCutoff(row ? parseJson(row.value) : undefined, DEFAULT_SETTINGS.businessDayCutoff);
}
