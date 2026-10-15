import { mkdirSync } from "node:fs";
import { chromium, expect, type FullConfig } from "@playwright/test";
import { closeDb } from "../src/db/client";
import migrateTestDatabase from "../src/db/global-setup.int";
import { seed } from "../src/db/seed";
import { upsertAdmin } from "../src/db/seed-admin";
import * as s from "../src/db/schema";
import { resetDb, testDb } from "../src/db/test-utils";
import { hashPassword } from "../src/lib/auth/password";
import { authFile, USERS, type UserKey } from "./helpers/users";

/** Creates a non-admin user, or resets its credentials (idempotent). */
async function upsertStaff(user: (typeof USERS)[Exclude<UserKey, "admin">]): Promise<void> {
  const passwordHash = await hashPassword(user.password);
  await testDb()
    .insert(s.users)
    .values({ name: user.name, username: user.username, passwordHash, role: user.role })
    .onConflictDoUpdate({ target: s.users.username, set: { passwordHash, role: user.role, active: true } });
}

async function loginThroughUi(key: UserKey, baseURL: string, headers: Record<string, string>): Promise<void> {
  const user = USERS[key];
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: headers });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(user.username);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    if ("station" in user) {
      await expect(page).toHaveURL(/\/estacion/);
      await page.getByRole("button", { name: new RegExp(user.station) }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${user.home}$`));
    await context.storageState({ path: authFile(key) });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // (a) Create the test DB if missing and apply migrations. The int-test setup
  // reads the SERVER url from DATABASE_URL and then points it at the test DB.
  process.env.DATABASE_URL = process.env.E2E_SERVER_DATABASE_URL!;
  await migrateTestDatabase();

  // (b) Clean slate + menu seed.
  await resetDb();
  await seed(testDb());

  // (c) Known users.
  await upsertAdmin(testDb(), { username: USERS.admin.username, password: USERS.admin.password });
  await upsertStaff(USERS.cajera);
  await upsertStaff(USERS.encargada);
  await closeDb();

  // (d) Log in once per role through the real UI and keep the cookies.
  mkdirSync("e2e/.auth", { recursive: true });
  const baseURL = config.projects[0].use.baseURL!;
  const headers = { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7` };
  for (const key of Object.keys(USERS) as UserKey[]) await loginThroughUi(key, baseURL, headers);
}
