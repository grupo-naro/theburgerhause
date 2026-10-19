import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { countOrdersOf, db, findProduct } from "./helpers/db";
import { fillValidDelivery, gotoCheckout, submitButton, unique } from "./helpers/checkout";
import { chargeButton, counterOrderCount, linesOf, openPos, readySale, releaseCounterState, tileMain } from "./helpers/pos";
import { seedCart } from "./helpers/store";
import { authFile } from "./helpers/users";

/**
 * Drink stock at the point of sale: another customer took the last unit while this page was open
 * (the product is still on screen). The order is refused with a clear message and nothing is
 * created. The drink is linked straight in the DB at quantity 0 WITHOUT the stock pause, which is
 * exactly the "stale page" situation.
 */

const DRINK = "Huevo simple";
const ITEM = "E2E Bebida agotada";

async function linkSoldOutDrink(): Promise<void> {
  const product = await findProduct(DRINK);
  const [item] = await db().insert(s.stockItems).values({ name: ITEM, kind: "bebida", unit: "u", minQty: 0, quantity: 0 }).returning();
  await db().update(s.products).set({ stockItemId: item.id }).where(eq(s.products.id, product.id));
}

async function unlinkDrink(): Promise<void> {
  const product = await findProduct(DRINK);
  await db().update(s.products).set({ stockItemId: null, stockPaused: false }).where(eq(s.products.id, product.id));
  await db().delete(s.stockItems).where(eq(s.stockItems.name, ITEM));
}

test.describe("web checkout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a drink that ran out: the order is not created and the customer is told to take it out", async ({ page }) => {
    const name = unique("Agotado");
    const [huevo, melt] = await Promise.all([findProduct(DRINK), findProduct("Melt simple")]);
    await seedCart(page, [{ productId: huevo.id }, { productId: melt.id }]);
    await gotoCheckout(page);
    await fillValidDelivery(page, name);
    await linkSoldOutDrink();
    try {
      await submitButton(page).click();
      const banner = page.getByTestId("out-of-stock-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(`Se agotó ${DRINK}. Sacala del pedido para continuar.`);
      await expect(banner).toContainText("No creamos tu pedido.");
      expect(await countOrdersOf(name)).toBe(0);
      await page.getByTestId("out-of-stock-cart-link").click();
      await expect(page).toHaveURL(/\/carrito$/);
    } finally {
      await unlinkDrink();
    }
  });
});

test.describe("counter POS", () => {
  test.use({ storageState: authFile("cajera") });
  test.afterEach(releaseCounterState);

  test("a drink that ran out: nothing is charged, its tile says Sin stock; without it the sale goes through", async ({ page }) => {
    await releaseCounterState();
    await openPos(page);
    await tileMain(page, DRINK).click();
    await tileMain(page, "Ranchita simple").click();
    await readySale(page, { pager: "12" });
    const before = await counterOrderCount();
    await linkSoldOutDrink();
    try {
      await chargeButton(page).click();
      await expect(page.getByTestId("sale-error")).toHaveText(`Se agotó ${DRINK}. Sacala del pedido para continuar.`);
      expect(await counterOrderCount()).toBe(before);
      const tile = page.locator(`[data-testid="pos-tile"][data-sold-out]`);
      await expect(tile).toHaveCount(1);
      await expect(tile.getByTestId("tile-sold-out")).toHaveText("Sin stock");
      await expect(tile.getByRole("button", { name: `${DRINK}: sin stock` })).toBeDisabled();

      // The cashier takes it off the ticket and charges the rest.
      await page.getByRole("button", { name: new RegExp(`^Quitar ${DRINK}`) }).first().click();
      await expect(linesOf(page, DRINK)).toHaveCount(0);
      await chargeButton(page).click();
      await expect(page.getByTestId("confirmation-overlay")).toBeVisible();
      expect(await counterOrderCount()).toBe(before + 1);
    } finally {
      await unlinkDrink();
    }
  });
});
