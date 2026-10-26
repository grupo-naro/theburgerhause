import { sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pesosToCents } from "@/domain/money";
import { UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { SETTING_KEYS, type Settings } from "./index";
import { settingsInputSchema } from "./schemas";

/** Admin settings writes. No next/* imports. All values are upserted (one row per key). */

type Conn = Db | DbTransaction;
const asDb = (c: Conn) => c as Db;

async function upsert(tx: Conn, entries: [string, unknown][]) {
  await tx
    .insert(s.settings)
    .values(entries.map(([key, value]) => ({ key, value })))
    .onConflictDoUpdate({ target: s.settings.key, set: { value: sql`excluded.value` } });
}

export async function saveSettings(db: Conn, input: unknown): Promise<Result<null>> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const values: Settings = {
    storeName: v.storeName,
    storeAddress: v.storeAddress,
    storePhone: v.storePhone,
    whatsapp: v.whatsapp,
    bankAlias: v.bankAlias,
    bankCbu: v.bankCbu,
    deliveryFee: pesosToCents(v.deliveryFeePesos),
    acceptingOrders: v.acceptingOrders,
    openingHoursText: v.openingHoursText,
    businessDayCutoff: v.businessDayCutoff,
    basePrepMinutes: v.basePrepMinutes,
    deliveryTravelMinutes: v.deliveryTravelMinutes,
  };
  try {
    await asDb(db).transaction((tx) =>
      upsert(
        tx,
        (Object.keys(SETTING_KEYS) as (keyof Settings)[]).map((field) => [SETTING_KEYS[field], values[field]]),
      ),
    );
    return { ok: true, data: null };
  } catch {
    console.error("[settings] saveSettings failed");
    return { ok: false, error: UNEXPECTED };
  }
}

/** The quick open/closed switch: writes only `accepting_orders`. */
export async function setAcceptingOrders(db: Conn, accepting: boolean): Promise<Result<null>> {
  if (typeof accepting !== "boolean") return { ok: false, error: "Valor inválido" };
  try {
    await upsert(db, [[SETTING_KEYS.acceptingOrders, accepting]]);
    return { ok: true, data: null };
  } catch {
    console.error("[settings] setAcceptingOrders failed");
    return { ok: false, error: UNEXPECTED };
  }
}

export { settingsInputSchema } from "./schemas";
