import { expect, test, type Locator, type Page } from "@playwright/test";
import { findProduct, modifierIdByName } from "./helpers/db";
import { shot, shotViewport } from "./helpers/shots";
import {
  cartCount,
  cta,
  gotoStore,
  modifierRow,
  openSheet,
  orderBar,
  seedCart,
  settled,
  sheetOf,
  toast,
} from "./helpers/store";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Every match must be at least 44px tall (and 44px wide unless it is a full-width row). */
async function expectTapTargets(locator: Locator, { square = true }: { square?: boolean } = {}) {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    expect(box, `target ${i} has a box`).not.toBeNull();
    expect(box!.height, `target ${i} height`).toBeGreaterThanOrEqual(44);
    if (square) expect(box!.width, `target ${i} width`).toBeGreaterThanOrEqual(44);
  }
}

test("the sheet, the order bar and the cart fit a phone @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // screenshots show the settled selected state
  const viewport = page.viewportSize()!;
  await gotoStore(page);
  expect(await noHorizontalOverflow(page)).toBe(true);

  // --- sheet, one unit ---
  const sheet = await openSheet(page, "Ranchita simple");
  const box = (await sheet.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box.width).toBeLessThanOrEqual(viewport.width);
  await expect(cta(sheet)).toBeInViewport({ ratio: 1 });
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expectTapTargets(cta(sheet), { square: false });
  await expectTapTargets(sheet.getByRole("button", { name: /^(Aumentar|Disminuir) cantidad$/ }));
  await expectTapTargets(sheet.getByRole("button", { name: "Cerrar" }));
  await expectTapTargets(sheet.getByTestId("modifier-row"), { square: false });
  await shotViewport(page, "sheet-qty1-mobile");

  // --- sheet, two units ---
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  const units = sheet.getByTestId("unit-section");
  await expect(units).toHaveCount(2);
  await modifierRow(units.nth(0), "Sin cheddar").click();
  await modifierRow(units.nth(0), "+ Dips de cheddar").click();
  await shotViewport(page, "sheet-qty2-unit1-open-mobile");
  await units.nth(1).getByRole("button", { name: /Ranchita simple #2/ }).click();
  await expectTapTargets(units.nth(1).getByRole("button", { name: "Igual que la 1" }), { square: false });
  await units.nth(1).getByRole("button", { name: "Igual que la 1" }).click();
  await shotViewport(page, "sheet-qty2-unit2-open-mobile");
  await expectTapTargets(units.getByRole("button", { name: /Ranchita simple #/ }), { square: false });
  await expect(cta(sheet)).toBeInViewport({ ratio: 1 });
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await cta(sheet).click();
  await expect(sheet).toBeHidden();

  // --- toast + order bar ---
  await expect(toast(page)).toContainText("Agregado al pedido");
  await expectTapTargets(toast(page).getByRole("link", { name: "Ver pedido" }), { square: false });
  await expect(cartCount(page)).toHaveText("2");
  await shotViewport(page, "order-bar-toast-mobile");
  const bar = orderBar(page);
  await expect(bar).toBeVisible();
  await settled(bar);
  const barBox = (await bar.boundingBox())!;
  expect(barBox.height).toBeGreaterThanOrEqual(44);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(barBox.width).toBeLessThanOrEqual(viewport.width);
  expect(await noHorizontalOverflow(page)).toBe(true);

  // The footer's last line stays clear of the bar at the end of the page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = page.locator("footer p").last();
  await expect(last).toBeInViewport({ ratio: 1 });
  const lastBox = (await last.boundingBox())!;
  const barNow = (await bar.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barNow.y);
  await shotViewport(page, "home-bottom-order-bar-mobile");

  // --- cart ---
  await bar.click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("the cart page with several groups is comfortable on a phone @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const [ranchita, melt, cuarto] = await Promise.all([
    findProduct("Ranchita simple"),
    findProduct("Melt doble"),
    findProduct("Cuarto de libra simple"),
  ]);
  const [dips, sinCheddar, tomate, papas] = await Promise.all([
    modifierIdByName("+ Dips de cheddar"),
    modifierIdByName("Sin cheddar"),
    modifierIdByName("Agregar lechuga y tomate"),
    modifierIdByName("Cambiar a papas grandes"),
  ]);
  await seedCart(
    page,
    [
      { productId: ranchita.id, modifierIds: [sinCheddar, dips] },
      { productId: ranchita.id, modifierIds: [dips, tomate], note: "bien cocida, sin sal en las papas" },
      { productId: ranchita.id, modifierIds: [dips, tomate], note: "bien cocida, sin sal en las papas" },
      { productId: melt.id, modifierIds: [sinCheddar, dips, tomate, papas] },
      { productId: cuarto.id },
    ],
    "/carrito",
  );
  await expect(page.getByTestId("cart-line")).toHaveCount(4);
  expect(await noHorizontalOverflow(page)).toBe(true);
  const lines = page.getByTestId("cart-line");
  await expectTapTargets(lines.nth(0).getByRole("button", { name: /cantidad|Quitar del pedido/ }));
  await expectTapTargets(lines.nth(0).getByRole("button", { name: "Editar" }), { square: false });
  await expectTapTargets(lines.nth(0).getByRole("button", { name: "Quitar", exact: true }), { square: false });
  await expectTapTargets(page.getByTestId("cart-continue"), { square: false });
  await expectTapTargets(page.getByRole("link", { name: "Seguir pidiendo" }), { square: false });
  await shot(page, "cart-several-groups-mobile");

  // Editing on a phone: the bottom sheet opens pre-filled and fits.
  await lines.nth(1).getByRole("button", { name: "Editar" }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await settled(sheet);
  await expect(sheet.getByTestId("unit-section")).toHaveCount(2);
  await expect(cta(sheet)).toBeInViewport({ ratio: 1 });
  await shotViewport(page, "sheet-edit-mode-mobile");
  await sheet.getByRole("button", { name: "Cerrar" }).click();
  await expect(sheet).toBeHidden();

  // Removal toast sits above the bottom edge.
  await lines.nth(3).getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(toast(page)).toContainText("Quitado");
  await shotViewport(page, "cart-undo-toast-mobile");
});

test("the empty cart and the issues banner on a phone @mobile", async ({ page }) => {
  await gotoStore(page, "/carrito");
  await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "cart-empty-mobile");

  const ranchita = await findProduct("Ranchita simple");
  await seedCart(
    page,
    [{ productId: ranchita.id }, { productId: ranchita.id, modifierIds: [987654] }, { productId: 999999 }],
    "/carrito",
    { "seed-0": 800000 },
  );
  await expect(page.getByTestId("issues-banner")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "cart-issues-banner-mobile");
});

test("a sheet is usable at 320px wide @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await gotoStore(page);
  const sheet = await openSheet(page, "Holtber extreme doble");
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  await expect(sheet.getByTestId("unit-section")).toHaveCount(3);
  await modifierRow(sheet.getByTestId("unit-section").nth(0), "+ Dips de cheddar").click();
  await modifierRow(sheet.getByTestId("unit-section").nth(0), "Cambiar a papas grandes").click();
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(cta(sheet)).toBeInViewport({ ratio: 1 });
  await shotViewport(page, "sheet-qty3-320-mobile");
});
