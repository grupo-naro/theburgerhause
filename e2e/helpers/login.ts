import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Logs a staff user in through the real login form in a FRESH browser context
 * (no shared cookies), picks the cashier station and lands on her workspace (/mostrador).
 */
export async function loginInFreshContext(
  browser: Browser,
  baseURL: string | undefined,
  username: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const headers = test.info().project.use.extraHTTPHeaders;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: headers,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/estacion/);
  await page.getByRole("button", { name: /Mostrador 1/ }).click();
  await expect(page).toHaveURL(/\/mostrador$/);
  return { context, page };
}
