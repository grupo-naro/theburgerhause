import { eq } from "drizzle-orm";
import { closeDb } from "../src/db/client";
import migrateTestDatabase from "../src/db/global-setup.int";
import { seed } from "../src/db/seed";
import { upsertAdmin } from "../src/db/seed-admin";
import * as s from "../src/db/schema";
import { resetDb, testDb } from "../src/db/test-utils";
import { hashPassword } from "../src/lib/auth/password";
import { attachSeedImages } from "./helpers/product-images";
import { USERS, type UserKey } from "./helpers/users";

/** Store contact + bank data the public checkout shows (the seed leaves them empty). Known values, known in specs. */
export const E2E_STORE_SETTINGS = {
  store_address: "Av. Siempreviva 742, Springfield",
  store_phone: "+54 11 5555-0000",
  whatsapp: "5491155550000",
  opening_hours_text: "Lun a Dom de 20 a 00",
  bank_alias: "burger.house.e2e",
  bank_cbu: "0000003100099999999999",
} as const;

async function setStoreSettings(): Promise<void> {
  for (const [key, value] of Object.entries(E2E_STORE_SETTINGS)) {
    await testDb()
      .insert(s.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: s.settings.key, set: { value } });
  }
}

/** Creates a non-admin user, or resets its credentials (idempotent). */
async function upsertStaff(user: (typeof USERS)[Exclude<UserKey, "admin">]): Promise<void> {
  const passwordHash = await hashPassword(user.password);
  await testDb()
    .insert(s.users)
    .values({ name: user.name, username: user.username, passwordHash, role: user.role })
    .onConflictDoUpdate({ target: s.users.username, set: { passwordHash, role: user.role, active: true } });
}

/**
 * Migrates the test DB, wipes it and loads the seed, the product photos and the known users.
 * Runs ONLY BEFORE `next build`: the public menu is prerendered from the DB at build time, so the DB must
 * not be reseeded afterwards (ids and image paths would diverge from what was built). Global setup only
 * checks the marker below.
 * Needs E2E_SERVER_DATABASE_URL (the server URL) in the environment.
 */
export async function prepareDatabase(): Promise<void> {
  process.env.DATABASE_URL = process.env.E2E_SERVER_DATABASE_URL!;
  await migrateTestDatabase();
  await resetDb();
  await seed(testDb());
  await setStoreSettings();
  await attachSeedImages(["Ranchita simple", "Melt simple", "Holtber extreme simple"]);
  await upsertAdmin(testDb(), { username: USERS.admin.username, password: USERS.admin.password });
  await upsertStaff(USERS.cajera);
  await upsertStaff(USERS.encargada);
  await upsertStaff(USERS.cocina);
  await testDb()
    .insert(s.settings)
    .values({ key: PREPARED_MARKER_KEY, value: new Date().toISOString() })
    .onConflictDoNothing();
  await closeDb();
}

/** Settings row written by prepareDatabase(); global setup refuses to run without it. */
export const PREPARED_MARKER_KEY = "e2e_prepared_at";

export async function assertDatabasePrepared(): Promise<void> {
  const [row] = await testDb().select().from(s.settings).where(eq(s.settings.key, PREPARED_MARKER_KEY));
  if (!row) {
    throw new Error(
      "The e2e database was not prepared for the running build. Stop any server on :3100 so Playwright " +
        "restarts it (that runs e2e/prepare-db-cli.ts BEFORE `next build`), or run that script and rebuild.",
    );
  }
}
