import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { reloadUntil } from "./public-menu";
import { authFile } from "./users";

export const CART_KEY = "bh_cart_v1";

/** Product card by exact product name (home page). */
export const card = (page: Page, name: string): Locator =>
  page.getByTestId("product-card").filter({ has: page.getByText(name, { exact: true }) });

export const cartButton = (page: Page): Locator => page.getByTestId("cart-button");
export const cartCount = (page: Page): Locator => page.getByTestId("cart-count");
export const orderBar = (page: Page): Locator => page.getByTestId("order-bar");
export const sheetOf = (page: Page): Locator => page.getByRole("dialog");
export const toast = (page: Page): Locator => page.getByTestId("toast");

/** Navigates and waits for hydration (the cart provider flips `data-ready` once the stored cart loaded). */
export async function gotoStore(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(cartButton(page)).toHaveAttribute("data-ready", "true");
}

/** Resolves when the enter animation (slide / pop) has finished, so boxes and screenshots are stable. */
export async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined));
}

/** Opens the product sheet from the home page and returns the dialog. */
export async function openSheet(page: Page, name: string): Promise<Locator> {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await c.click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name, level: 2 })).toBeVisible();
  await settled(sheet);
  return sheet;
}

/** Clicks a modifier row (the real checkbox is visually hidden) inside `scope`. */
export function modifierRow(scope: Locator, name: string | RegExp): Locator {
  return scope.getByTestId("modifier-row").filter({ hasText: name });
}

export const cta = (sheet: Locator): Locator => sheet.getByTestId("sheet-cta");

/** Opens a product, optionally picks modifiers (unit 1) and adds it. */
export async function addProduct(page: Page, name: string, modifiers: (string | RegExp)[] = []): Promise<void> {
  const sheet = await openSheet(page, name);
  for (const m of modifiers) await modifierRow(sheet, m).click();
  await cta(sheet).click();
  await expect(sheet).toBeHidden();
}

/** Writes a cart straight into localStorage (like a returning visitor) and reloads. */
export async function seedCart(
  page: Page,
  lines: { productId: number; modifierIds?: number[]; note?: string }[],
  url = "/",
  prices: Record<string, number> = {},
): Promise<void> {
  await gotoStore(page, url);
  const stored = JSON.stringify({
    v: 1,
    lines: lines.map((l, i) => ({ id: `seed-${i}`, productId: l.productId, modifierIds: l.modifierIds ?? [], note: l.note ?? "" })),
    prices,
  });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [CART_KEY, stored] as const);
  await page.reload();
  await expect(cartButton(page)).toHaveAttribute("data-ready", "true");
}

/** Admin session in its own context (the public page stays anonymous). */
export async function withAdmin(
  browser: Browser,
  baseURL: string | undefined,
  extraHTTPHeaders: Record<string, string> | undefined,
  fn: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: authFile("admin"), extraHTTPHeaders });
  try {
    await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Deactivates / activates a product in the admin list (buttons are named by product). */
export async function setProductActive(admin: Page, name: string, active: boolean): Promise<void> {
  await admin.goto("/admin/menu");
  const off = admin.getByRole("button", { name: `Desactivar ${name}`, exact: true });
  // exact: "Desactivar X" would otherwise match the substring "activar X"
  const on = admin.getByRole("button", { name: `Activar ${name}`, exact: true });
  await expect(off.or(on)).toBeVisible(); // the table may still be streaming in
  if (active) {
    if (await on.isVisible()) await on.click();
    await expect(off).toBeVisible();
  } else {
    if (await off.isVisible()) await off.click();
    await expect(on).toBeVisible();
  }
}

/** Public cards are cached: wait (by reloading) until the card shows / disappears. */
export async function waitForCard(page: Page, name: string, present: boolean): Promise<void> {
  await reloadUntil(page, () => expect(card(page, name)).toHaveCount(present ? 1 : 0, { timeout: 1000 }));
}
