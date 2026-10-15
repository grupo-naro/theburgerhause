import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { formatARS } from "../src/domain/money";
import { countCategories, findProduct } from "./helpers/db";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

async function createCategory(page: Page, name: string): Promise<void> {
  await page.goto("/admin/menu/categorias/nueva");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

async function createProduct(page: Page, category: string, name: string, priceArs: string): Promise<void> {
  await page.goto("/admin/menu/productos/nuevo");
  await page.getByLabel("Categoría").selectOption({ label: category });
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Precio (pesos)").fill(priceArs);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
}

const productRow = (page: Page, name: string): Locator => page.getByRole("row").filter({ hasText: name });

/** Names of the products of one category, in displayed order. */
const productNames = (page: Page, category: string): Locator =>
  page.getByRole("table", { name: `Productos de ${category}` }).locator("tbody tr td:nth-child(2)");

async function pngFile(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "burger.png");
  await sharp({ create: { width: 320, height: 240, channels: 3, background: "#c0392b" } })
    .png()
    .toFile(file);
  return file;
}

test("lists the seeded categories and products", async ({ page }) => {
  await page.goto("/admin/menu");
  await expect(page.getByRole("heading", { name: "Menú", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hamburguesa simple + papa chica", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kids", level: 2 })).toBeVisible();
  const row = productRow(page, "Ranchita simple");
  await expect(row).toContainText(formatARS(850000));
  await expect(row).toContainText("Activo");
  await shot(page, "admin-menu");
});

test("category: create, then duplicate name shows an inline error", async ({ page }) => {
  const name = `Cat ${uid()}`;
  await createCategory(page, name);
  expect(await countCategories(name)).toBe(1);

  await page.goto("/admin/menu/categorias/nueva");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Ya existe/ })).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue(name);
  await expect(page).toHaveURL(/categorias\/nueva/);
  expect(await countCategories(name)).toBe(1);
});

test("product: create with image, edit price in pesos, validate, reorder, toggle", async ({ page }, testInfo) => {
  const cat = `Cat ${uid()}`;
  const first = `Burger A ${uid()}`;
  const second = `Burger B ${uid()}`;
  await createCategory(page, cat);

  // --- create with an image ---
  await page.goto("/admin/menu/productos/nuevo");
  await page.getByLabel("Categoría").selectOption({ label: cat });
  await page.getByLabel("Nombre").fill(first);
  await page.getByLabel("Descripción").fill("Doble carne, cheddar y mucha salsa");
  await page.getByLabel("Precio (pesos)").fill("14400");
  await page.getByLabel("Imagen: elegir archivo").setInputFiles(await pngFile(testInfo.outputPath("img")));
  const preview = page.getByAltText("Vista previa de la imagen");
  await expect(preview).toBeVisible();
  // The preview swaps to the server thumbnail once the upload finishes.
  await expect(preview).toHaveAttribute("src", /\/uploads\//);
  await expect(page.getByRole("button", { name: "Quitar imagen" })).toBeVisible();
  await shot(page, "admin-product-form");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);

  const row = productRow(page, first);
  await expect(row).toContainText(formatARS(1_440_000));
  const thumb = row.getByRole("img", { name: first });
  await thumb.scrollIntoViewIfNeeded();
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  // --- edit: the price field is in PESOS, not cents ---
  await row.getByRole("link", { name: "Editar" }).click();
  await expect(page.getByLabel("Precio (pesos)")).toHaveValue("14400");

  // --- invalid price: native validation first, then the server-side error with values kept ---
  await page.getByLabel("Precio (pesos)").fill("10.5");
  await page.getByLabel("Nombre").fill(`${first} editado`);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/productos\/\d+/); // blocked by the browser (pattern), nothing sent
  expect(await page.getByLabel("Precio (pesos)").evaluate((i: HTMLInputElement) => i.validity.patternMismatch)).toBe(true);
  // Bypass client validation to prove the server rejects it too.
  await page.locator("form", { has: page.getByLabel("Precio (pesos)") }).evaluate((f: HTMLFormElement) => (f.noValidate = true));
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("#priceArs-error")).toBeVisible();
  await expect(page.getByLabel("Precio (pesos)")).toHaveValue("10.5");
  await expect(page.getByLabel("Nombre")).toHaveValue(`${first} editado`);
  await expect(page.getByLabel("Precio (pesos)")).toHaveAttribute("aria-invalid", "true");

  // --- valid edit ---
  await page.getByLabel("Precio (pesos)").fill("15000");
  await page.getByLabel("Nombre").fill(first);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
  await expect(productRow(page, first)).toContainText(formatARS(1_500_000));
  expect((await findProduct(first)).price).toBe(1_500_000);

  // --- reorder (second product is created below the first) ---
  await createProduct(page, cat, second, "9000");
  await expect(productNames(page, cat)).toHaveText([first, second]);
  await page.getByRole("button", { name: `Bajar ${first}` }).click();
  await expect(productNames(page, cat)).toHaveText([second, first]);
  await page.getByRole("button", { name: `Subir ${first}` }).click();
  await expect(productNames(page, cat)).toHaveText([first, second]);

  // --- toggle active / featured, persisted across reload ---
  const target = productRow(page, second);
  await expect(target).toContainText("Activo");
  await page.getByRole("button", { name: `Desactivar ${second}` }).click();
  await expect(target.getByText("Inactivo")).toBeVisible();
  await page.getByRole("button", { name: `Destacar ${second}` }).click();
  await expect(target.getByRole("img", { name: "Destacado" })).toBeVisible();
  await page.reload();
  await expect(productRow(page, second).getByText("Inactivo")).toBeVisible();
  await expect(productRow(page, second).getByRole("img", { name: "Destacado" })).toBeVisible();
  await page.getByRole("button", { name: `Activar ${second}` }).click();
  await expect(productRow(page, second).getByText("Activo", { exact: true })).toBeVisible();
  await page.reload();
  await expect(productRow(page, second).getByText("Activo", { exact: true })).toBeVisible();
});

test("admin menu is usable on a phone @mobile", async ({ page }) => {
  await page.goto("/admin/menu");
  await expect(page.getByRole("heading", { name: "Menú", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const nav = page.getByRole("navigation", { name: "Administración" });
  await expect(nav.getByRole("link", { name: "Menú" })).toBeVisible();
  await shot(page, "admin-menu-mobile");
  // Every section is reachable (the nav scrolls horizontally on phones).
  const ajustes = nav.getByRole("link", { name: "Ajustes" });
  await ajustes.scrollIntoViewIfNeeded();
  await ajustes.click();
  await expect(page).toHaveURL(/\/admin\/ajustes$/);
});
