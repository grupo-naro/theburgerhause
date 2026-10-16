import path from "node:path";
import { closeDb, getDb, type Db, type DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "@/lib/settings";

/**
 * Production-safe initialization (`pnpm db:init-prod`). Idempotent. Creates ONLY the default `settings`
 * rows that are missing (never overwrites a value the owner changed) and NO categories, products,
 * users, stations or cadets. Orders stay CLOSED (accepting_orders = false) until the owner opens them.
 * The demo seed (`pnpm db:seed`) must never be used in production.
 */
export const PROD_DEFAULTS: Record<string, unknown> = {
  [SETTING_KEYS.storeName]: DEFAULT_SETTINGS.storeName,
  [SETTING_KEYS.storeAddress]: DEFAULT_SETTINGS.storeAddress,
  [SETTING_KEYS.storePhone]: DEFAULT_SETTINGS.storePhone,
  [SETTING_KEYS.whatsapp]: DEFAULT_SETTINGS.whatsapp,
  [SETTING_KEYS.bankAlias]: DEFAULT_SETTINGS.bankAlias,
  [SETTING_KEYS.bankCbu]: DEFAULT_SETTINGS.bankCbu,
  [SETTING_KEYS.deliveryFee]: 0,
  [SETTING_KEYS.acceptingOrders]: false,
  [SETTING_KEYS.openingHoursText]: DEFAULT_SETTINGS.openingHoursText,
};

/** Returns how many settings rows were created. */
export async function initProd(db: Db | DbTransaction): Promise<number> {
  const inserted = await db
    .insert(s.settings)
    .values(Object.entries(PROD_DEFAULTS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing({ target: s.settings.key })
    .returning({ key: s.settings.key });
  return inserted.length;
}

export const NEXT_STEPS = [
  "Next steps (see docs/ops/runbook.md, section 10):",
  "  1. Create the admin:   ADMIN_USERNAME=<user> ADMIN_PASSWORD=<strong password> pnpm db:seed-admin",
  "  2. Log in and complete Ajustes (name, address, phone, WhatsApp, alias/CBU, delivery fee, hours).",
  "  3. Create stations + tokens, users and cadets; load the REAL menu (categories, products, modifiers).",
  "  4. Open orders with the toggle in Ajustes (accepting orders is OFF until then).",
];

// Run only when executed directly (`pnpm db:init-prod`), not when imported by tests.
if (process.argv[1] && path.basename(process.argv[1]) === "init-prod.ts") {
  try {
    process.loadEnvFile?.();
  } catch {
    // no .env file; rely on the existing environment
  }
  initProd(getDb())
    .then((created) => {
      console.log(`init-prod complete: ${created} setting(s) created${created === 0 ? " (already initialized)" : ""}.`);
      console.log(NEXT_STEPS.join("\n"));
    })
    .catch((err) => {
      // Fixed text + pg code only: never the connection string.
      const code = (err as { code?: unknown } | null)?.code;
      console.error(typeof code === "string" ? `init-prod failed (code ${code})` : "init-prod failed");
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
