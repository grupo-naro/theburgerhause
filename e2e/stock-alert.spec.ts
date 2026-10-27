import { expect, test, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import * as s from "../src/db/schema";
import { countEventSources } from "./helpers/caja";
import { db, deleteStockItem, findProduct, findStockItem } from "./helpers/db";
import { staffContext } from "./helpers/journey";
import { chargeButton, openPos, readySale, releaseCounterState, tileMain } from "./helpers/pos";
import { authFile } from "./helpers/users";

/**
 * The "Productos faltantes de stock" strip: an out-of-stock drink (last unit sold at the counter) and a raw material
 * under its minimum show up LIVE on the cashier's and the delivery manager's screens; only the drink pauses its
 * product; restocking clears the strip; the counter TV never shows it; `/stock` is read only.
 */

const DRINK_PRODUCT = "Huevo simple";
const DRINK = "E2E Alerta bebida";
const RAW = "E2E Alerta carne";

const strip = (page: Page) => page.getByTestId("stock-alert");
const stripButton = (page: Page) => strip(page).getByRole("button", { name: /^Productos faltantes de stock \(\d+\)$/ });

async function cleanup(): Promise<void> {
  await releaseCounterState();
  await deleteStockItem(DRINK);
  await deleteStockItem(RAW);
}

/** Items with their opening balance (an ajuste_inicial movement, like the app does). */
async function seedItems(): Promise<void> {
  const product = await findProduct(DRINK_PRODUCT);
  const [drink, raw] = await db()
    .insert(s.stockItems)
    .values([
      { name: DRINK, kind: "bebida", unit: "u", minQty: 0, quantity: 1000 },
      { name: RAW, kind: "materia_prima", unit: "kg", minQty: 10000, quantity: 4500 },
    ])
    .returning();
  await db().insert(s.stockMovements).values([
    { itemId: drink.id, kind: "ajuste_inicial", qtyDelta: 1000, businessDate: sql`current_date` },
    { itemId: raw.id, kind: "ajuste_inicial", qtyDelta: 4500, businessDate: sql`current_date` },
  ]);
  await db().update(s.products).set({ stockItemId: drink.id }).where(eq(s.products.id, product.id));
}

test.afterEach(cleanup);

test("the strip is live for cashier and delivery manager, details, restock clears it, one EventSource per page", async ({ browser, baseURL }) => {
  await cleanup();
  await seedItems();

  const cajeraCtx = await staffContext(browser, baseURL, "cajera");
  const encargadaCtx = await staffContext(browser, baseURL, "encargada");
  const encargadoCtx = await staffContext(browser, baseURL, "encargado");
  const cajeraEs = countEventSources(cajeraCtx);
  const encargadaEs = countEventSources(encargadaCtx);
  try {
    const cajera = await cajeraCtx.newPage();
    const encargada = await encargadaCtx.newPage();
    const seller = await cajeraCtx.newPage();
    const encargado = await encargadoCtx.newPage();

    // The raw material is already under its minimum; the drink still has its last unit.
    await cajera.goto("/stock");
    await encargada.goto("/stock");
    for (const p of [cajera, encargada]) {
      await expect(p.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
      await expect(stripButton(p)).toContainText("Productos faltantes de stock (1)");
    }

    // Read-only list: no loading controls anywhere in <main>.
    await expect(cajera.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await expect(cajera.getByRole("listitem").filter({ hasText: DRINK })).toContainText("1 u");
    await expect(cajera.locator("main form, main input, main select, main textarea")).toHaveCount(0);
    await expect(cajera.locator("main").getByRole("link")).toHaveCount(0);
    await expect(cajera.getByRole("link", { name: "Stock", exact: true })).toBeVisible();

    // Detail: raw material under the minimum, with the reason and the quantity in kg with a comma.
    await stripButton(cajera).click();
    const rawRow = cajera.getByTestId("stock-alert-item").filter({ hasText: RAW });
    await expect(rawRow).toContainText("Bajo mínimo");
    await expect(rawRow).toContainText("4,5 kg");
    await expect(rawRow).toContainText("Desde");

    // The last unit of the drink is sold at the counter (another cashier tab): both screens update by themselves.
    await openPos(seller);
    await tileMain(seller, DRINK_PRODUCT).click();
    await readySale(seller, { pager: "21" });
    await chargeButton(seller).click();
    await expect(seller.getByTestId("confirmation-overlay")).toBeVisible();

    for (const p of [cajera, encargada]) await expect(stripButton(p)).toContainText("Productos faltantes de stock (2)");
    const drinkRow = cajera.getByTestId("stock-alert-item").filter({ hasText: DRINK });
    await expect(drinkRow).toContainText("Agotado");
    await expect(drinkRow).toContainText("0 u");
    await expect(cajera.getByRole("listitem").filter({ hasText: DRINK }).getByText("Agotado", { exact: true })).toBeVisible();

    // Only the drink's product pauses; the raw material pauses nothing.
    const paused = await db().select({ name: s.products.name }).from(s.products).where(eq(s.products.stockPaused, true));
    expect(paused.map((r) => r.name)).toEqual([DRINK_PRODUCT]);

    // Restock from the admin: the strip drops to 1, then disappears.
    await encargado.goto("/admin/stock/reponer");
    const reponer = async (name: string, unit: string, qty: string) => {
      await encargado.goto("/admin/stock/reponer");
      await encargado.getByLabel("Artículo").selectOption({ label: `${name} (${unit})` });
      await encargado.getByLabel(/^Cantidad/).fill(qty);
      await encargado.getByRole("button", { name: "Cargar ingreso" }).click();
      await expect(encargado.getByRole("status")).toContainText(`Saldo de ${name}`);
    };
    await reponer(DRINK, "u", "12");
    for (const p of [cajera, encargada]) await expect(stripButton(p)).toContainText("Productos faltantes de stock (1)");
    await reponer(RAW, "kg", "20");
    for (const p of [cajera, encargada]) await expect(strip(p)).toHaveCount(0);
    expect((await findStockItem(DRINK)).quantity).toBe(12000);

    // The admin shell shows the strip too (encargado) and its live refresh is the only connection there.
    await db().update(s.stockItems).set({ quantity: 0 }).where(eq(s.stockItems.name, RAW));
    await encargado.goto("/admin/stock");
    await expect(stripButton(encargado)).toContainText("Productos faltantes de stock (1)");

    // ONE EventSource per page: 3 pages in the cashier context (stock list + POS tab + ...) and 1 for the manager.
    await cajera.waitForTimeout(500);
    expect(cajeraEs.count()).toBe(2); // /stock + POS
    expect(encargadaEs.count()).toBe(1);
  } finally {
    await Promise.all([cajeraCtx.close(), encargadaCtx.close(), encargadoCtx.close()]);
  }
});

test.describe("the counter TV", () => {
  test.use({ storageState: authFile("cocina") });

  test("shows no stock alert even with items short", async ({ page }) => {
    await cleanup();
    await seedItems();
    await page.goto("/pantalla");
    await expect(page.getByTestId("counter-board")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    await expect(strip(page)).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain("Productos faltantes");
    await page.goto("/cocina");
    await expect(page).toHaveURL(/\/pantalla$/);
    await expect(strip(page)).toHaveCount(0);
  });

  test("cocina sees the read-only list", async ({ page }) => {
    await page.goto("/stock");
    await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
    await expect(page.locator("main form, main input, main select, main textarea, main a")).toHaveCount(0);
  });
});

test.describe("cashier on a phone", () => {
  test.use({ storageState: authFile("cajera"), viewport: { width: 390, height: 844 } });

  test("@mobile the strip and the list fit and have 44 px targets", async ({ page }) => {
    await cleanup();
    await seedItems();
    await page.goto("/stock");
    const button = stripButton(page);
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await button.click();
    await expect(page.getByTestId("stock-alert-item")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
