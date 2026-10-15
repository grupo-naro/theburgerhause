import { mkdirSync } from "node:fs";
import { chromium, expect, type FullConfig } from "@playwright/test";
import { prepareDatabase } from "./prepare-db";
import { authFile, USERS, type UserKey } from "./helpers/users";

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
  // Clean slate: migrations, seed, product photos, known users (also run before the build, see playwright.config).
  await prepareDatabase();

  // Log in once per role through the real UI and keep the cookies.
  mkdirSync("e2e/.auth", { recursive: true });
  const baseURL = config.projects[0].use.baseURL!;
  const headers = config.projects[0].use.extraHTTPHeaders ?? {};
  for (const key of Object.keys(USERS) as UserKey[]) await loginThroughUi(key, baseURL, headers);
}
