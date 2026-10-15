import { expect, test } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { findProduct, modifierIdByName } from "./helpers/db";
import { reloadUntil } from "./helpers/public-menu";
import { shot, shotViewport } from "./helpers/shots";
import {
  CART_KEY,
  addProduct,
  cartCount,
  cta,
  gotoStore,
  modifierRow,
  orderBar,
  seedCart,
  setProductActive,
  sheetOf,
  toast,
  waitForCard,
  withAdmin,
} from "./helpers/store";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

// Seed prices (centavos).
const RANCHITA = 850000;
const MELT = 880000;
const CUARTO = 920000;
const DIPS = 120000;
const TOMATE = 30000;
const PAPAS = 100000;

const names = (page: import("@playwright/test").Page) => page.getByTestId("cart-line").getByTestId("cart-line-name");

test("cart page: steppers, undo, edit, remove and the empty state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // screenshots show the settled selected state
  const [ranchita, melt, cuarto] = await Promise.all([
    findProduct("Ranchita simple"),
    findProduct("Melt simple"),
    findProduct("Cuarto de libra simple"),
  ]);
  const dips = await modifierIdByName("+ Dips de cheddar");
  await seedCart(page, [{ productId: ranchita.id }, { productId: melt.id, modifierIds: [dips] }, { productId: cuarto.id }], "/carrito");

  const lines = page.getByTestId("cart-line");
  const subtotal = page.getByTestId("cart-subtotal");
  await expect(names(page)).toHaveText(["Ranchita simple", "Melt simple", "Cuarto de libra simple"]);
  await expect(subtotal).toHaveText(formatARS(RANCHITA + MELT + DIPS + CUARTO));
  await expect(page.getByText("El envío se calcula en el siguiente paso.")).toBeVisible();
  await expect(orderBar(page)).toHaveCount(0); // the page already shows the order
  await shot(page, "cart-three-groups-desktop");

  // + / - update the line total and the subtotal.
  const first = lines.nth(0);
  await first.getByRole("button", { name: "Aumentar cantidad" }).click();
  await expect(first.getByTestId("cart-line-quantity-value")).toHaveText("2");
  await expect(first.getByTestId("cart-line-total")).toHaveText(formatARS(2 * RANCHITA));
  await expect(subtotal).toHaveText(formatARS(2 * RANCHITA + MELT + DIPS + CUARTO));
  await expect(cartCount(page)).toHaveText("4");
  await first.getByRole("button", { name: "Disminuir cantidad" }).click();
  await expect(first.getByTestId("cart-line-quantity-value")).toHaveText("1");
  await expect(subtotal).toHaveText(formatARS(RANCHITA + MELT + DIPS + CUARTO));

  // - at 1 removes the group; "Deshacer" brings it back in the SAME position.
  await first.getByRole("button", { name: "Quitar del pedido" }).click();
  await expect(names(page)).toHaveText(["Melt simple", "Cuarto de libra simple"]);
  await expect(toast(page)).toContainText("Quitado");
  await toast(page).getByRole("button", { name: "Deshacer" }).click();
  await expect(names(page)).toHaveText(["Ranchita simple", "Melt simple", "Cuarto de libra simple"]);
  await expect(subtotal).toHaveText(formatARS(RANCHITA + MELT + DIPS + CUARTO));
  // Restored lines have no price snapshot: that must not look like a price change.
  await expect(page.getByTestId("issues-banner")).toHaveCount(0);

  // Same for a group in the MIDDLE removed with "Quitar".
  await lines.nth(1).getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(names(page)).toHaveText(["Ranchita simple", "Cuarto de libra simple"]);
  await toast(page).getByRole("button", { name: "Deshacer" }).click();
  await expect(names(page)).toHaveText(["Ranchita simple", "Melt simple", "Cuarto de libra simple"]);
  await expect(lines.nth(1).getByTestId("cart-chip")).toHaveText([/^\+ Dips de cheddar/]);

  // Editar: the sheet opens pre-filled; changes keep the line's position.
  const editButton = lines.nth(1).getByRole("button", { name: "Editar" });
  await editButton.click();
  const sheet = sheetOf(page);
  await expect(sheet.getByRole("heading", { name: "Melt simple", level: 2 })).toBeVisible();
  await expect(modifierRow(sheet, "+ Dips de cheddar").getByRole("checkbox")).toBeChecked();
  await expect(cta(sheet)).toHaveText(`Guardar cambios · ${formatARS(MELT + DIPS)}`);
  await shotViewport(page, "sheet-edit-mode-desktop");
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  const units = sheet.getByTestId("unit-section");
  await expect(units).toHaveCount(2);
  await expect(units.nth(0).getByTestId("unit-summary")).toHaveText("+ Dips de cheddar");
  // Growing the quantity appends an EMPTY unit (it does not copy the first one).
  await expect(units.nth(1).getByTestId("unit-summary")).toHaveText("Sin modificaciones");
  await units.nth(1).getByRole("button", { name: /Melt simple #2/ }).click();
  await modifierRow(units.nth(1), "+ Dips de cheddar").click();
  await modifierRow(units.nth(1), /^Agregar tomate/).click();
  await expect(cta(sheet)).toHaveText(`Guardar cambios · ${formatARS(2 * MELT + 2 * DIPS + TOMATE)}`);
  await cta(sheet).click();
  await expect(sheet).toBeHidden();
  await expect(toast(page)).toContainText("Pedido actualizado");
  await expect(names(page)).toHaveText(["Ranchita simple", "Melt simple", "Melt simple", "Cuarto de libra simple"]);
  await expect(lines.nth(2).getByTestId("cart-chip")).toHaveText([/^\+ Dips de cheddar/, /^Agregar tomate/]);
  await expect(subtotal).toHaveText(formatARS(RANCHITA + 2 * MELT + 2 * DIPS + TOMATE + CUARTO));

  // Quitar everything -> empty state.
  for (let left = 4; left > 0; left--) {
    await expect(lines).toHaveCount(left);
    await lines.first().getByRole("button", { name: "Quitar", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver la carta" })).toHaveAttribute("href", "/");
  await expect(cartCount(page)).toHaveCount(0);
  await shot(page, "cart-empty-desktop");
});

test("an empty cart page is not shown as empty before the stored cart loads, and is noindex", async ({ page }) => {
  await page.goto("/carrito");
  await expect(page).toHaveTitle("Tu pedido — The Burger House 828");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByTestId("cart-view")).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
  await expect(page.getByTestId("cart-skeleton")).toHaveCount(0);
});

test("the cart survives a reload and a second tab follows the change", async ({ page }) => {
  await gotoStore(page);
  await addProduct(page, "Ranchita simple", ["Sin cheddar"]);
  await expect(cartCount(page)).toHaveText("1");

  await page.reload();
  await expect(page.getByTestId("cart-button")).toHaveAttribute("data-ready", "true");
  await expect(cartCount(page)).toHaveText("1");
  await expect(orderBar(page)).toContainText("Ver pedido · 1 ·");

  const other = await page.context().newPage();
  await gotoStore(other);
  await expect(cartCount(other)).toHaveText("1");
  await addProduct(page, "Melt simple");
  await expect(cartCount(page)).toHaveText("2");
  // No reload in the second tab: the storage event brings the new cart.
  await expect(cartCount(other)).toHaveText("2");
  await expect(orderBar(other)).toContainText("Ver pedido · 2 ·");
  await other.close();
});

test("totals agree: order bar, cart subtotal and the sum of the lines", async ({ page }) => {
  const [ranchita, melt, cuarto] = await Promise.all([
    findProduct("Ranchita simple"),
    findProduct("Melt simple"),
    findProduct("Cuarto de libra simple"),
  ]);
  const [dips, tomate, papas] = await Promise.all([
    modifierIdByName("+ Dips de cheddar"),
    modifierIdByName("Agregar tomate"),
    modifierIdByName("Cambiar a papas grandes"),
  ]);
  const expected = RANCHITA + (MELT + DIPS) + (CUARTO + TOMATE + PAPAS) + (RANCHITA + DIPS) + (MELT + DIPS);
  await seedCart(page, [
    { productId: ranchita.id },
    { productId: melt.id, modifierIds: [dips] },
    { productId: cuarto.id, modifierIds: [tomate, papas] },
    { productId: ranchita.id, modifierIds: [dips] },
    { productId: melt.id, modifierIds: [dips] }, // groups with the second line
  ]);

  await expect(orderBar(page)).toHaveText(`Ver pedido · 5 · ${formatARS(expected)}`);
  await orderBar(page).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(orderBar(page)).toHaveCount(0);
  await expect(page.getByTestId("cart-line")).toHaveCount(4); // the two Melt+dips units are one group
  await expect(page.getByTestId("cart-subtotal")).toHaveText(formatARS(expected));
  const totals = await page.getByTestId("cart-line-total").allTextContents();
  const sum = totals.reduce((acc, t) => acc + Number(t.replace(/\D/g, "")) * 100, 0);
  expect(sum).toBe(expected);

  await page.getByTestId("cart-continue").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("heading", { name: "Confirmar pedido", level: 1 })).toBeVisible();
  await expect(page.getByTestId("checkout-total")).toContainText("$");
  await expect(orderBar(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a tu pedido" }).click();
  await expect(page).toHaveURL(/\/carrito$/);
});

test("Seguir pidiendo goes back to the menu keeping the scroll position", async ({ page }) => {
  await gotoStore(page);
  await page.evaluate(() => window.scrollTo(0, 900));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  await addProduct(page, "Melt doble");
  await page.getByTestId("cart-button").click();
  await expect(page).toHaveURL(/\/carrito$/);
  await page.getByRole("link", { name: "Seguir pidiendo" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The Burger House 828");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 200);
});

test("changes in the catalog show up as a notice and the unavailable line is gone", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const name = "Aro simple";
  const aro = await findProduct(name);
  await seedCart(page, [{ productId: aro.id }], "/carrito");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, async (admin) => {
    try {
      await setProductActive(admin, name, false);
      await reloadUntil(page, async () => {
        await expect(page.getByTestId("issues-banner")).toBeVisible({ timeout: 3000 });
      });
      await expect(page.getByTestId("issues-banner")).toContainText("ya no está disponible");
      await expect(page.getByTestId("cart-line")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
      await shot(page, "cart-issues-unavailable-desktop");
      await page.getByRole("button", { name: "Entendido" }).click();
      await expect(page.getByTestId("issues-banner")).toHaveCount(0);
    } finally {
      await setProductActive(admin, name, true);
    }
    await page.goto("/");
    await waitForCard(page, name, true);
  });
});

test("a price change, a removed option and a missing product are explained in Spanish", async ({ page }) => {
  const ranchita = await findProduct("Ranchita simple");
  // "seed-0" was added when Ranchita cost $8.000 (stored snapshot), "seed-1" has an option that no longer exists.
  await seedCart(page, [{ productId: ranchita.id }, { productId: ranchita.id, modifierIds: [987654] }, { productId: 999999 }], "/carrito", {
    "seed-0": 800000,
  });
  const banner = page.getByTestId("issues-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`El precio de «Ranchita simple» cambió de ${formatARS(800000)} a ${formatARS(RANCHITA)}`);
  await expect(banner).toContainText("Se quitaron opciones que ya no están disponibles de «Ranchita simple»");
  await expect(banner).toContainText("Un producto que ya no está disponible se quitó de tu pedido");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await shot(page, "cart-issues-banner-desktop");
});

test("saving an edit whose line vanished meanwhile adds the edited configuration", async ({ page }) => {
  const [ranchita, melt] = await Promise.all([findProduct("Ranchita simple"), findProduct("Melt simple")]);
  const dips = await modifierIdByName("+ Dips de cheddar");
  await seedCart(page, [{ productId: ranchita.id }, { productId: melt.id, modifierIds: [dips] }], "/carrito");
  const lines = page.getByTestId("cart-line");
  await expect(lines).toHaveCount(2);
  await lines.nth(1).getByRole("button", { name: "Editar" }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();

  // Another tab removes the Melt line.
  const other = await page.context().newPage();
  await gotoStore(other);
  await other.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [CART_KEY, JSON.stringify({ v: 1, lines: [{ id: "seed-0", productId: ranchita.id, modifierIds: [], note: "" }], prices: {} })] as const,
  );
  await expect(lines).toHaveCount(1); // the storage event reached the first tab (behind the modal)

  await modifierRow(sheet, "Sin lechuga").click();
  await expect(cta(sheet)).toHaveText(`Guardar cambios · ${formatARS(MELT + DIPS)}`);
  await cta(sheet).click();
  await expect(sheet).toBeHidden();
  await expect(toast(page)).toContainText("Agregado al pedido");
  await expect(toast(page)).not.toContainText("Pedido actualizado");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1).getByTestId("cart-line-name")).toHaveText("Melt simple");
  await expect(lines.nth(1).getByTestId("cart-chip")).toHaveText(["Sin lechuga", /^\+ Dips de cheddar/]);
  await other.close();
});

test("browser Back closes an open sheet instead of leaving a modal over another page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const melt = await findProduct("Melt simple");
  await seedCart(page, [{ productId: melt.id }]);
  await page.getByTestId("cart-button").click();
  await expect(page).toHaveURL(/\/carrito$/);
  await page.getByTestId("cart-line").getByRole("button", { name: "Editar" }).click();
  await expect(sheetOf(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(sheetOf(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
