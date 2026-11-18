import { expect, test, type Page } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers/checkout";
import { deleteStockItem } from "./helpers/db";
import { authFile } from "./helpers/users";

const QUESO = `Queso compra ${Date.now()}`;
const PAN = `Pan compra ${Date.now()}`;

test.afterAll(async () => {
  await deleteStockItem(QUESO);
  await deleteStockItem(PAN);
});

async function createItem(page: Page, name: string): Promise<void> {
  await page.goto("/admin/stock/articulos/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Tipo").selectOption({ label: "Materia prima" });
  await page.getByLabel("Unidad").selectOption({ label: "kg (kilos)" });
  await page.getByRole("button", { name: "Crear artículo" }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/articulos\/\d+\?nuevo=1$/);
}

async function reponer(page: Page, name: string, qty: string, price?: string): Promise<void> {
  await page.goto("/admin/stock/reponer");
  await page.getByLabel("Artículo").selectOption({ label: `${name} (kg)` });
  await page.getByLabel(/^Cantidad/).fill(qty);
  if (price !== undefined) await page.getByLabel("Precio unitario (opcional)").fill(price);
  await page.getByRole("button", { name: "Cargar ingreso" }).click();
  await expect(page.getByText(/Ingreso cargado/)).toBeVisible();
}

test.describe("purchase prices as admin", () => {
  test.use({ storageState: authFile("admin") });

  test("the unit price shows the total and the tab shows the change", async ({ page }) => {
    await createItem(page, QUESO);
    await page.goto("/admin/stock/reponer");
    await page.getByLabel("Artículo").selectOption({ label: `${QUESO} (kg)` });
    await page.getByLabel(/^Cantidad/).fill("10");
    await page.getByLabel("Precio unitario (opcional)").fill("2.000");
    await expect(page.getByTestId("purchase-total")).toHaveText(/Total: \$\s?20\.000/);
    await page.getByRole("button", { name: "Cargar ingreso" }).click();
    await expect(page.getByText(/Ingreso cargado/)).toBeVisible();

    await reponer(page, QUESO, "20", "2.400");

    await page.getByRole("link", { name: "Precios de compra" }).click();
    await expect(page).toHaveURL(/\/admin\/stock\/precios/);
    const card = page.getByTestId("purchase-group").filter({ hasText: QUESO });
    await expect(card.getByText(/Último: \$\s?2\.400/)).toBeVisible();
    await expect(card.getByTestId("price-change").first()).toHaveText("▲ 20%");
    await expect(card.getByText(/20 kg × \$\s?2\.400 = \$\s?48\.000/)).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("an ingreso loaded without price gets one afterwards", async ({ page }) => {
    await createItem(page, PAN);
    await reponer(page, PAN, "5");
    await page.goto("/admin/stock/precios");
    await page.getByLabel("Artículo").selectOption({ label: PAN });
    await page.getByRole("button", { name: "Ver" }).click();
    const unpriced = page.getByRole("region", { name: "Reposiciones sin precio" });
    await unpriced.getByRole("button", { name: /Agregar precio/ }).first().click();
    await unpriced.getByLabel("Precio unitario").fill("1.800");
    await unpriced.getByRole("button", { name: "Guardar precio" }).click();
    const card = page.getByTestId("purchase-group").filter({ hasText: PAN });
    await expect(card.getByText(/Último: \$\s?1\.800/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Reposiciones sin precio" })).toHaveCount(0);
  });
});

test.describe("purchase prices as encargado", () => {
  test.use({ storageState: authFile("encargado") });

  test("sees no price field, no tab and cannot open the page", async ({ page }) => {
    await page.goto("/admin/stock/reponer");
    await expect(page.getByRole("button", { name: "Cargar ingreso" })).toBeVisible();
    await expect(page.getByLabel("Precio unitario (opcional)")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Precios de compra" })).toHaveCount(0);
    await page.goto("/admin/stock/precios");
    await expect(page).not.toHaveURL(/\/admin\/stock\/precios/);
  });
});
