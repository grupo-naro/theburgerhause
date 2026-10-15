import { expect, test, type Page } from "@playwright/test";
import { findProduct } from "./helpers/db";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

const KEY = "bh_cart_v1";
const button = (page: Page) => page.getByTestId("cart-button");
const count = (page: Page) => page.getByTestId("cart-count");

const line = (id: string, productId: number, modifierIds: number[] = []) => ({ id, productId, modifierIds, note: "" });
const cart = (lines: unknown[]) => JSON.stringify({ v: 1, lines, prices: {} });

/** Opens the store, writes `raw` to localStorage (or removes the key) and reloads, like a returning visitor. */
async function visitWithStoredCart(page: Page, raw: string | null) {
  await page.goto("/");
  // Writing before hydration finished would race with the provider's own persist.
  await expect(button(page)).toHaveAttribute("data-ready", "true");
  await page.evaluate(([key, value]) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }, [KEY, raw] as const);
  await page.reload();
  await expect(button(page)).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("product-card").first()).toBeVisible();
}

test("header cart has no count when the cart is empty", async ({ page }) => {
  await page.goto("/");
  await expect(button(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-label", "Ver pedido");
  await expect(button(page)).toHaveAttribute("href", "/carrito");
  await expect(count(page)).toHaveCount(0);
});

test("a stored cart shows the unit count and the aria-label", async ({ page }) => {
  const p = await findProduct("Ranchita simple");
  await visitWithStoredCart(page, cart([line("a", p.id), line("b", p.id), line("c", p.id)]));
  await expect(count(page)).toHaveText("3");
  await expect(button(page)).toHaveAttribute("aria-label", "Ver pedido, 3 productos");
  await page.locator("header").screenshot({ path: "test-results/shots/cart-badge-desktop-header.png" });
});

test("a single unit uses the singular in the aria-label", async ({ page }) => {
  const p = await findProduct("Ranchita simple");
  await visitWithStoredCart(page, cart([line("a", p.id)]));
  await expect(button(page)).toHaveAttribute("aria-label", "Ver pedido, 1 producto");
});

test("the badge caps at 99+", async ({ page }) => {
  const p = await findProduct("Ranchita simple");
  const lines = Array.from({ length: 100 }, (_, i) => line(`l${i}`, p.id, [1000 + i]));
  // modifier ids that do not exist are stripped but the 100 units stay
  await visitWithStoredCart(page, cart(lines));
  await expect(count(page)).toHaveText("99+");
});

test("corrupt storage does not crash the page and shows no count", async ({ page }) => {
  await visitWithStoredCart(page, "{this is not json");
  await expect(count(page)).toHaveCount(0);
  await expect(button(page)).toHaveAttribute("aria-label", "Ver pedido");
});

test("storage with the wrong shape is ignored", async ({ page }) => {
  await visitWithStoredCart(page, JSON.stringify({ v: 9, lines: [{ id: 1 }] }));
  await expect(count(page)).toHaveCount(0);
});

test("a cart with an unknown product is reconciled away", async ({ page }) => {
  await visitWithStoredCart(page, cart([line("ghost", 999999)]));
  await expect(count(page)).toHaveCount(0);
  // the reconciled (empty) cart is what stays stored
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test("only the valid units of a mixed cart survive", async ({ page }) => {
  const p = await findProduct("Ranchita simple");
  await visitWithStoredCart(page, cart([line("ghost", 999999), line("ok", p.id)]));
  await expect(count(page)).toHaveText("1");
});

test("the badge is visible on a phone @mobile", async ({ page }) => {
  const p = await findProduct("Ranchita simple");
  await visitWithStoredCart(page, cart([line("a", p.id), line("b", p.id)]));
  await expect(count(page)).toHaveText("2");
  const box = await button(page).boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.locator("header").screenshot({ path: "test-results/shots/cart-badge-mobile-header.png" });
});
