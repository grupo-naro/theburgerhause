import { expect, test } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { findGroup, setAcceptingOrders } from "./helpers/db";
import { reloadUntil } from "./helpers/public-menu";
import { shotViewport } from "./helpers/shots";
import {
  addProduct,
  card,
  cartCount,
  cta,
  gotoStore,
  modifierRow,
  openSheet,
  orderBar,
  setProductActive,
  sheetOf,
  toast,
  waitForCard,
  withAdmin,
} from "./helpers/store";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

const SIMPLE = "Hamburguesa simple + papa chica";
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

// Seed prices (centavos): Ranchita simple 850000; + Dips de cheddar 120000; Agregar tomate 30000.
const RANCHITA = 850000;
const DIPS = 120000;
const TOMATE = 30000;

test("a product without modifier groups gets the minimal sheet and adds at its price", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const name = `Combo sin extras ${uid()}`;
  await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, async (admin) => {
    await admin.goto("/admin/menu/productos/nuevo");
    await admin.getByLabel("Categoría").selectOption({ label: SIMPLE });
    await admin.getByLabel("Nombre").fill(name);
    await admin.getByLabel("Precio (pesos)").fill("5000");
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/menu$/);
    try {
      await gotoStore(page);
      await waitForCard(page, name, true);
      await expect(page.getByTestId("cart-button")).toHaveAttribute("data-ready", "true");

      const sheet = await openSheet(page, name);
      await expect(sheet.getByTestId("modifier-group")).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Aumentar cantidad" })).toBeVisible();
      await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(500000)}`);
      await cta(sheet).click();

      await expect(sheet).toBeHidden();
      await expect(toast(page)).toContainText("Agregado al pedido");
      await expect(toast(page).getByRole("link", { name: "Ver pedido" })).toHaveAttribute("href", "/carrito");
      await expect(cartCount(page)).toHaveText("1");
      await expect(orderBar(page)).toHaveText(`Ver pedido · 1 · ${formatARS(500000)}`);
    } finally {
      await setProductActive(admin, name, false);
    }
    await waitForCard(page, name, false);
  });
});

test("per-unit configuration: two burgers, each with its own modifiers", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // screenshots show the settled selected state
  await gotoStore(page);
  const sheet = await openSheet(page, "Ranchita simple");
  await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(RANCHITA)}`);
  // With one unit the groups are shown directly (no accordion).
  await expect(sheet.getByTestId("unit-section")).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: "Quitar ingredientes" })).toBeVisible();
  await shotViewport(page, "sheet-qty1-desktop");

  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  const units = sheet.getByTestId("unit-section");
  await expect(units).toHaveCount(2);
  const header = (i: number) => units.nth(i).getByRole("button", { name: new RegExp(`Ranchita simple #${i + 1}`) });
  await expect(header(0)).toHaveAttribute("aria-expanded", "true");
  await expect(header(1)).toHaveAttribute("aria-expanded", "false");
  await expect(units.nth(0).getByRole("button", { name: "Igual que la 1" })).toHaveCount(0);

  // Unit 1: Sin cheddar + Dips.
  await modifierRow(units.nth(0), "Sin cheddar").click();
  await modifierRow(units.nth(0), "+ Dips de cheddar").click();
  await expect(units.nth(0).getByTestId("unit-summary")).toHaveText("Sin cheddar · + Dips de cheddar");
  await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(2 * RANCHITA + DIPS)}`);
  await shotViewport(page, "sheet-qty2-unit1-open-desktop");

  // Unit 2: copy unit 1, then change it (remove Sin cheddar, add tomate).
  await header(1).click();
  await expect(header(1)).toHaveAttribute("aria-expanded", "true");
  await expect(header(0)).toHaveAttribute("aria-expanded", "false");
  await expect(units.nth(0).getByTestId("unit-summary")).toHaveText("Sin cheddar · + Dips de cheddar");
  const same = units.nth(1).getByRole("button", { name: "Igual que la 1" });
  await same.click();
  await expect(units.nth(1).getByTestId("unit-summary")).toHaveText("Sin cheddar · + Dips de cheddar");
  await expect(same).toBeDisabled();
  await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(2 * RANCHITA + 2 * DIPS)}`);

  await modifierRow(units.nth(1), "Sin cheddar").click();
  await modifierRow(units.nth(1), /^Agregar tomate/).click();
  await expect(units.nth(1).getByTestId("unit-summary")).toHaveText("+ Dips de cheddar · Agregar tomate");
  await expect(same).toBeEnabled();
  await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(2 * RANCHITA + 2 * DIPS + TOMATE)}`);
  await shotViewport(page, "sheet-qty2-unit2-open-desktop");

  // Shrinking keeps unit 1; growing again appends an EMPTY unit.
  await sheet.getByRole("button", { name: "Disminuir cantidad" }).click();
  await expect(units).toHaveCount(0);
  await expect(modifierRow(sheet, "Sin cheddar").getByRole("checkbox")).toBeChecked();
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  await expect(units.nth(1).getByTestId("unit-summary")).toHaveText("Sin modificaciones");
  await header(1).click();
  await modifierRow(units.nth(1), "Sin cheddar").click();
  await modifierRow(units.nth(1), "+ Dips de cheddar").click();
  await modifierRow(units.nth(1), "Sin cheddar").click();
  await modifierRow(units.nth(1), /^Agregar tomate/).click();
  await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(2 * RANCHITA + 2 * DIPS + TOMATE)}`);

  await cta(sheet).click();
  await expect(sheet).toBeHidden();
  await expect(cartCount(page)).toHaveText("2");
  await expect(orderBar(page)).toHaveText(`Ver pedido · 2 · ${formatARS(2 * RANCHITA + 2 * DIPS + TOMATE)}`);

  // Two DIFFERENT configurations -> two separate lines in the cart.
  await orderBar(page).click();
  await expect(page).toHaveURL(/\/carrito$/);
  const lines = page.getByTestId("cart-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0).getByTestId("cart-chip")).toHaveText(["Sin cheddar", /^\+ Dips de cheddar/]);
  await expect(lines.nth(0).getByTestId("cart-line-total")).toHaveText(formatARS(RANCHITA + DIPS));
  await expect(lines.nth(1).getByTestId("cart-chip")).toHaveText([/^\+ Dips de cheddar/, /^Agregar tomate/]);
  await expect(lines.nth(1).getByTestId("cart-line-total")).toHaveText(formatARS(RANCHITA + DIPS + TOMATE));
  await expect(page.getByTestId("cart-subtotal")).toHaveText(formatARS(2 * RANCHITA + 2 * DIPS + TOMATE));
});

test("adding the same configuration twice yields ONE line with quantity 2", async ({ page }) => {
  await gotoStore(page);
  await addProduct(page, "Ranchita simple", ["Sin cheddar"]);
  await expect(cartCount(page)).toHaveText("1");
  await addProduct(page, "Ranchita simple", ["Sin cheddar"]);
  await expect(cartCount(page)).toHaveText("2");
  await orderBar(page).click();
  const lines = page.getByTestId("cart-line");
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("cart-line-quantity-value")).toHaveText("2");
  await expect(lines.getByTestId("cart-line-total")).toHaveText(formatARS(2 * RANCHITA));

  // Two units configured identically inside one sheet group the same way.
  await page.getByRole("link", { name: "Seguir pidiendo" }).click();
  const sheet = await openSheet(page, "Melt simple");
  await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
  await modifierRow(sheet.getByTestId("unit-section").nth(0), "Sin lechuga").click();
  await sheet.getByTestId("unit-section").nth(1).getByRole("button", { name: /Melt simple #2/ }).click();
  await sheet.getByRole("button", { name: "Igual que la 1" }).click();
  await cta(sheet).click();
  await orderBar(page).click();
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  await expect(page.getByTestId("cart-line").nth(1).getByTestId("cart-line-quantity-value")).toHaveText("2");
});

test("swap options of one group are mutually exclusive and can be deselected", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const extra = `Papas XL ${uid()}`;
  const group = await findGroup("Papas");
  await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, async (admin) => {
    await admin.goto(`/admin/modificadores/nuevo?grupo=${group.id}`);
    await expect(admin.getByLabel("Grupo")).not.toHaveValue("");
    await admin.getByLabel("Nombre").fill(extra);
    await admin.getByLabel("Tipo").selectOption({ label: "Cambiar" });
    await admin.getByLabel("Precio (pesos)").fill("2000");
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/modificadores$/);
    try {
      await gotoStore(page);
      let sheet = sheetOf(page);
      // The menu is cached: reload until the new option is offered.
      await reloadUntil(page, async () => {
        await expect(page.getByTestId("cart-button")).toHaveAttribute("data-ready", "true");
        sheet = await openSheet(page, "Ranchita simple");
        await expect(modifierRow(sheet, extra)).toBeVisible({ timeout: 1000 });
      });
      const original = modifierRow(sheet, "Cambiar a papas grandes").getByRole("checkbox");
      const added = modifierRow(sheet, extra).getByRole("checkbox");
      await expect(sheet.getByRole("group", { name: "Papas" })).toContainText("Elegí una");

      await modifierRow(sheet, "Cambiar a papas grandes").click();
      await expect(original).toBeChecked();
      await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(RANCHITA + 100000)}`);
      await modifierRow(sheet, extra).click();
      await expect(added).toBeChecked();
      await expect(original).not.toBeChecked();
      await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(RANCHITA + 200000)}`);
      // Other groups are independent of the swap group.
      await modifierRow(sheet, "Sin cheddar").click();
      await expect(added).toBeChecked();
      await modifierRow(sheet, extra).click();
      await expect(added).not.toBeChecked();
      await expect(original).not.toBeChecked();
      await expect(cta(sheet)).toHaveText(`Agregar al pedido · ${formatARS(RANCHITA)}`);
    } finally {
      await admin.goto("/admin/modificadores");
      await admin.getByRole("button", { name: `Desactivar ${extra}`, exact: true }).click();
      await expect(admin.getByRole("button", { name: `Activar ${extra}`, exact: true })).toBeVisible();
    }
    // Leave the public menu clean for the next specs.
    await reloadUntil(page, async () => {
      await expect(page.getByTestId("cart-button")).toHaveAttribute("data-ready", "true");
      const sheet = await openSheet(page, "Ranchita simple");
      await expect(modifierRow(sheet, "Cambiar a papas grandes")).toBeVisible({ timeout: 1000 });
      await expect(modifierRow(sheet, extra)).toHaveCount(0, { timeout: 1000 });
    });
  });
});

test("keyboard: Enter opens, Tab stays inside, Space/Enter toggle, Esc closes and returns focus", async ({ page }) => {
  await gotoStore(page);
  const target = card(page, "Ranchita simple");
  await target.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Ranchita simple" });
  await expect(sheet).toBeVisible();

  await expect(sheet.getByRole("button", { name: "Aumentar cantidad" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Disminuir cantidad" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cerrar" })).toBeVisible();

  // A native modal dialog never lets focus reach the page behind it; at its ends focus may leave to the browser UI (body).
  const inside = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return !el || el === document.body || !!el.closest("dialog");
    });
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }

  const cheddar = modifierRow(sheet, "Sin cheddar").getByRole("checkbox");
  await cheddar.focus();
  await page.keyboard.press("Space");
  await expect(cheddar).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(cheddar).not.toBeChecked();
  await page.keyboard.press("Enter");
  await expect(cheddar).toBeChecked();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(target).toBeFocused();
  await expect(cartCount(page)).toHaveCount(0);
});

test("the backdrop and the close button dismiss the sheet without adding", async ({ page }) => {
  await gotoStore(page);
  let sheet = await openSheet(page, "Melt simple");
  await sheet.getByRole("button", { name: "Cerrar" }).click();
  await expect(sheet).toBeHidden();

  sheet = await openSheet(page, "Melt simple");
  await page.mouse.click(5, 5); // the dimmed backdrop
  await expect(sheet).toBeHidden();
  await expect(cartCount(page)).toHaveCount(0);
});

test("the add button cannot fire twice (one click adds one product)", async ({ page }) => {
  await gotoStore(page);
  const sheet = await openSheet(page, "Melt simple");
  await cta(sheet).dblclick();
  await expect(sheet).toBeHidden();
  await expect(cartCount(page)).toHaveText("1");
});

test("two activations in the same tick add exactly one product and show one toast", async ({ page }) => {
  await gotoStore(page);
  const sheet = await openSheet(page, "Melt simple");
  await cta(sheet).evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  await expect(sheet).toBeHidden();
  await expect(cartCount(page)).toHaveText("1");
  await expect(toast(page)).toHaveCount(1);
  await orderBar(page).click();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-line-quantity-value")).toHaveText("1");
});

test("closed store: paused sheet, no order bar, disabled continue, and a stale sheet cannot add", async ({ page }) => {
  await gotoStore(page);
  try {
    // A sheet opened while the store was open...
    const stale = await openSheet(page, "Ranchita simple");
    await expect(cta(stale)).toBeEnabled();
    await setAcceptingOrders(false);
    // ...is refused by the server check right before adding.
    await cta(stale).click();
    await expect(stale.getByTestId("sheet-message")).toContainText("Por el momento no estamos tomando pedidos");
    await expect(cta(stale)).toBeDisabled();
    await expect(cta(stale)).toHaveText("Pedidos pausados");
    await expect(cartCount(page)).toHaveCount(0);
    await shotViewport(page, "sheet-closed-desktop");
    await stale.getByRole("button", { name: "Cerrar" }).click();

    // Store open again for a moment: put one product in the cart.
    await setAcceptingOrders(true);
    await page.reload();
    await expect(page.getByTestId("cart-button")).toHaveAttribute("data-ready", "true");
    await addProduct(page, "Melt simple");
    await expect(orderBar(page)).toBeVisible();

    await setAcceptingOrders(false);
    await page.reload();
    await expect(page.getByTestId("closed-banner")).toBeVisible();
    await expect(cartCount(page)).toHaveText("1");
    await expect(orderBar(page)).toHaveCount(0);

    const paused = await openSheet(page, "Melt simple");
    await expect(cta(paused)).toBeDisabled();
    await expect(cta(paused)).toHaveText("Pedidos pausados");
    await expect(paused.getByTestId("sheet-message")).toContainText("Por el momento no estamos tomando pedidos");
    await paused.getByRole("button", { name: "Cerrar" }).click();

    await page.getByTestId("cart-button").click();
    await expect(page).toHaveURL(/\/carrito$/);
    await expect(page.getByTestId("cart-continue")).toBeDisabled();
    await expect(page.getByText("Por el momento no estamos tomando pedidos.").first()).toBeVisible();
  } finally {
    await setAcceptingOrders(true);
  }
});
