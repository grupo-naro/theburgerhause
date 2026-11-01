import { expect, test, type Browser, type Page } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db, findProduct } from "./helpers/db";
import { seedCart, settled, sheetOf } from "./helpers/store";
import { authFile } from "./helpers/users";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const uid = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const CAT = `Sugeridos ${uid}`;
const COLA = `Gaseosa ${uid}`;
const PAPAS = `Papas ${uid}`;
const PRICE: Record<string, string> = { [COLA]: "2500", [PAPAS]: "3200" };

/** Admin session on a desktop viewport (the admin lists products as cards on a phone, even in the @mobile project). */
async function withAdmin(
  browser: Browser,
  baseURL: string | undefined,
  extraHTTPHeaders: Record<string, string> | undefined,
  fn: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("admin"),
    extraHTTPHeaders,
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });
  try {
    const admin = await context.newPage();
    admin.setDefaultTimeout(15_000);
    await fn(admin);
  } finally {
    await context.close();
  }
}

/** Admin edits go through the real form so the cached public menu is invalidated like in production. */
async function setSuggest(admin: Page, name: string, on: boolean) {
  await admin.goto("/admin/menu");
  await admin.getByRole("row").filter({ hasText: name }).getByRole("link", { name: "Editar" }).click();
  await admin.getByLabel("Sugerir antes de confirmar").locator("visible=true").setChecked(on);
  await admin.getByRole("button", { name: "Guardar" }).click();
  await expect(admin).toHaveURL(/\/admin\/menu$/);
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  testInfo.setTimeout(120_000);
  const extra = testInfo.project.use.extraHTTPHeaders;
  await withAdmin(browser, baseURL, extra, async (admin) => {
    // A crashed earlier run may have left suggestions flagged: clear them so the sheet only holds ours.
    const stale = await db().select({ name: s.products.name }).from(s.products).where(eq(s.products.suggest, true));
    for (const { name } of stale) await setSuggest(admin, name, false);
    await admin.goto("/admin/menu/categorias/nueva");
    await admin.getByLabel("Nombre").fill(CAT);
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/menu$/);
    for (const name of [COLA, PAPAS]) {
      await admin.goto("/admin/menu/productos/nuevo");
      await admin.getByLabel("Categoría").selectOption({ label: CAT });
      await admin.getByLabel("Nombre").fill(name);
      await admin.getByLabel("Precio (pesos)").fill(PRICE[name]);
      await admin.getByLabel("Sugerir antes de confirmar").check();
      await admin.getByRole("button", { name: "Guardar" }).click();
      await expect(admin).toHaveURL(/\/admin\/menu$/);
    }
  });
});

// Restore: other specs click Continuar and expect checkout, so nothing may stay suggested.
test.afterAll(async ({ browser, baseURL }, testInfo) => {
  testInfo.setTimeout(120_000);
  const extra = testInfo.project.use.extraHTTPHeaders;
  await withAdmin(browser, baseURL, extra, async (admin) => {
    for (const name of [COLA, PAPAS]) {
      await setSuggest(admin, name, false);
      await admin.getByRole("button", { name: `Desactivar ${name}` }).click();
      await expect(admin.getByRole("button", { name: `Activar ${name}`, exact: true })).toBeVisible();
    }
  });
});

const sheet = (page: Page) => page.getByTestId("suggest-sheet");
const cont = (page: Page) => page.getByTestId("cart-continue");
const cardOf = (page: Page, name: string) => page.getByTestId("suggest-card").filter({ hasText: name });

/** Opens /carrito with one burger (plus `extra`), reloading until the public menu shows the suggestions. */
async function openSuggestions(page: Page) {
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }], "/carrito");
  await expect(async () => {
    await page.reload();
    await cont(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await settled(sheet(page)); // the pop-in scales the box: measure only once it is still
  return ranchita;
}

test("Continuar offers the suggestions, + adds with a stepper, Seguir goes to checkout once per visit", async ({ page }) => {
  const ranchita = await openSuggestions(page);
  const cola = await findProduct(COLA);

  await expect(page).toHaveURL(/\/carrito$/);
  await expect(sheetOf(page).getByRole("heading", { name: "Antes de seguir…" })).toBeVisible();
  await expect(page.getByTestId("suggest-card")).toHaveCount(2);
  await expect(cardOf(page, COLA)).toContainText(formatARS(250_000));
  const add = cardOf(page, COLA).getByTestId("suggest-add");
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await add.click();
  await expect(cardOf(page, COLA).getByTestId("suggest-add")).toHaveCount(0);
  const stepper = cardOf(page, COLA).getByRole("group", { name: `Cantidad de ${COLA}` });
  await expect(stepper).toContainText("1");
  await stepper.getByRole("button", { name: "Aumentar cantidad" }).click();
  await expect(stepper).toContainText("2");
  await expect(page.getByTestId("cart-subtotal")).toHaveText(formatARS(ranchita.price + 2 * cola.price));

  await page.getByTestId("suggest-continue").click();
  await expect(page).toHaveURL(/\/checkout/);

  // Once seen, Continuar no longer interrupts.
  await page.goBack();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByTestId("cart-view")).toHaveAttribute("data-ready", "true");
  await cont(page).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(sheet(page)).toHaveCount(0);
});

test("Escape and the close button keep the customer on the cart and do not consume the suggestion", async ({ page }) => {
  await openSuggestions(page);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/carrito$/);
  await cont(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/carrito$/);
});

test("with every suggestion already in the cart Continuar goes straight to checkout", async ({ page }) => {
  const [ranchita, cola, papas] = [await findProduct("Ranchita simple"), await findProduct(COLA), await findProduct(PAPAS)];
  await seedCart(page, [ranchita, cola, papas].map((p) => ({ productId: p.id })), "/carrito");
  await expect(cont(page)).toBeVisible();
  await cont(page).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(sheet(page)).toHaveCount(0);
});

test("the suggestion sheet is a bottom sheet with 44px targets on a phone @mobile", async ({ page }) => {
  await openSuggestions(page);
  const box = (await sheet(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 1);
  expect((await page.getByTestId("suggest-continue").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await cardOf(page, PAPAS).getByTestId("suggest-add").click();
  await expect(cardOf(page, PAPAS).getByRole("group")).toBeVisible();
});
