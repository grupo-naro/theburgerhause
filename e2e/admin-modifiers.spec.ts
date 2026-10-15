import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { countGroups, findGroup, findModifier, findProduct, linkedGroupIds } from "./helpers/db";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

async function createGroup(page: Page, name: string): Promise<number> {
  await page.goto("/admin/modificadores/grupos/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/modificadores$/);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  return (await findGroup(name)).id;
}

async function openNewModifier(page: Page, groupId: number): Promise<void> {
  await page.goto(`/admin/modificadores/nuevo?grupo=${groupId}`);
  await expect(page.getByLabel("Grupo")).not.toHaveValue("");
}

const row = (page: Page, name: string): Locator => page.getByRole("row").filter({ hasText: name });
const names = (page: Page, group: string): Locator =>
  page.getByRole("table", { name: `Modificadores de ${group}` }).locator("tbody tr td:nth-child(1)");

test("lists the seeded groups and modifiers", async ({ page }) => {
  await page.goto("/admin/modificadores");
  await expect(page.getByRole("heading", { name: "Modificadores", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quitar ingredientes", level: 2 })).toBeVisible();
  const cheddar = row(page, "Sin cheddar");
  await expect(cheddar).toContainText("Quitar");
  await expect(cheddar.getByText("SIN CHEDDAR", { exact: true })).toBeVisible();
  await expect(row(page, "+ Dips de cheddar")).toContainText(formatARS(120000));
  await expect(row(page, "Cambiar a papas grandes")).toContainText("Cambiar");
  await shot(page, "admin-modificadores");
});

test("group: create, then a duplicate name shows an inline error", async ({ page }) => {
  const name = `Grupo ${uid()}`;
  await createGroup(page, name);
  await page.goto("/admin/modificadores/grupos/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Ya existe/ })).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue(name);
  expect(await countGroups(name)).toBe(1);
});

test("modifiers: remove / add / swap, preview, reorder, deactivate, duplicate", async ({ page }) => {
  const u = uid();
  const group = `Mods ${u}`;
  const groupId = await createGroup(page, group);

  // --- remove: uppercase preview, price field disabled and free ---
  const removeName = `Sin cheddar ${u}`;
  await openNewModifier(page, groupId);
  await page.getByLabel("Nombre").fill(removeName);
  await page.getByLabel("Tipo").selectOption({ label: "Quitar" });
  await expect(page.getByTestId("kitchen-preview")).toHaveText(`SIN CHEDDAR ${u.toUpperCase()}`);
  await expect(page.getByLabel("Precio (pesos)")).toBeDisabled();
  await expect(page.getByLabel("Precio (pesos)")).toHaveValue("0");
  await shot(page, "admin-modifier-form");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/modificadores$/);
  const removeRow = row(page, removeName);
  await expect(removeRow).toContainText("Quitar");
  await expect(removeRow.getByText(`SIN CHEDDAR ${u.toUpperCase()}`, { exact: true })).toBeVisible();
  expect((await findModifier(groupId, removeName)).priceDelta).toBe(0);

  // --- add with a price, shown with formatARS; explicit lowercase label is stored uppercase ---
  const addName = `Dips ${u}`;
  await openNewModifier(page, groupId);
  await page.getByLabel("Nombre").fill(addName);
  await page.getByLabel("Tipo").selectOption({ label: "Agregar" });
  await page.getByLabel("Precio (pesos)").fill("1200");
  await expect(page.getByTestId("kitchen-preview")).toHaveText(`+ DIPS ${u.toUpperCase()}`);
  await page.getByLabel("Texto para cocina (opcional)").fill("+ dips ñandú");
  await expect(page.getByTestId("kitchen-preview")).toHaveText("+ DIPS ÑANDÚ");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/modificadores$/);
  const addRow = row(page, addName);
  await expect(addRow).toContainText(formatARS(120000));
  await expect(addRow.getByText("+ DIPS ÑANDÚ", { exact: true })).toBeVisible();
  expect((await findModifier(groupId, addName)).kitchenLabel).toBe("+ DIPS ÑANDÚ");

  // --- swap ---
  const swapName = `Papas grandes ${u}`;
  await openNewModifier(page, groupId);
  await page.getByLabel("Nombre").fill(swapName);
  await page.getByLabel("Tipo").selectOption({ label: "Cambiar" });
  await page.getByLabel("Precio (pesos)").fill("1000");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/modificadores$/);
  await expect(row(page, swapName)).toContainText("Cambiar");
  await expect(row(page, swapName)).toContainText(formatARS(100000));
  await expect(names(page, group)).toHaveText([removeName, addName, swapName]);

  // --- duplicate name inside the group ---
  await openNewModifier(page, groupId);
  await page.getByLabel("Nombre").fill(addName);
  await page.getByLabel("Tipo").selectOption({ label: "Agregar" });
  await page.getByLabel("Precio (pesos)").fill("5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Ya existe/ })).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue(addName);

  // --- reorder ---
  await page.goto("/admin/modificadores");
  await page.getByRole("button", { name: `Bajar ${removeName}` }).click();
  await expect(names(page, group)).toHaveText([addName, removeName, swapName]);
  await page.getByRole("button", { name: `Subir ${swapName}` }).click();
  await expect(names(page, group)).toHaveText([addName, swapName, removeName]);
  await page.reload();
  await expect(names(page, group)).toHaveText([addName, swapName, removeName]);

  // --- deactivate / reactivate, persisted ---
  await page.getByRole("button", { name: `Desactivar ${addName}` }).click();
  await expect(row(page, addName).getByText("Inactivo")).toBeVisible();
  await page.reload();
  await expect(row(page, addName).getByText("Inactivo")).toBeVisible();
  await page.getByRole("button", { name: `Activar ${addName}` }).click();
  await expect(row(page, addName).getByText("Activo", { exact: true })).toBeVisible();

  // --- edit keeps the form in sync (price in pesos, auto label stays auto) ---
  await row(page, swapName).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByLabel("Precio (pesos)")).toHaveValue("1000");
  await expect(page.getByLabel("Texto para cocina (opcional)")).toHaveValue("");
});

test("product sheet: link two groups to a product and keep them after reload", async ({ page }) => {
  const u = uid();
  const g1 = await createGroup(page, `Link A ${u}`);
  const g2 = await createGroup(page, `Link B ${u}`);
  const productId = (await findProduct("Ranchita simple")).id;

  await page.goto(`/admin/menu/productos/${productId}`);
  await expect(page.getByRole("heading", { name: "Grupos de modificadores", level: 2 })).toBeVisible();
  const boxA = page.getByRole("checkbox", { name: `Link A ${u}` });
  const boxB = page.getByRole("checkbox", { name: `Link B ${u}` });
  await expect(boxA).not.toBeChecked();
  await boxA.check();
  await boxB.check();
  await shot(page, "admin-product-modifier-groups");
  await page.getByRole("button", { name: "Actualizar grupos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Grupos guardados" })).toBeVisible();
  expect(await linkedGroupIds(productId)).toEqual(expect.arrayContaining([g1, g2]));

  await page.reload();
  await expect(boxA).toBeChecked();
  await expect(boxB).toBeChecked();

  await boxA.uncheck();
  await page.getByRole("button", { name: "Actualizar grupos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Grupos guardados" })).toBeVisible();
  await page.reload();
  await expect(boxA).not.toBeChecked();
  await expect(boxB).toBeChecked();
  const linked = await linkedGroupIds(productId);
  expect(linked).toContain(g2);
  expect(linked).not.toContain(g1);

  // The product form itself is untouched and still saves.
  await expect(page.getByLabel("Precio (pesos)")).toHaveValue("8500");
});

test("admin modifiers is usable on a phone @mobile", async ({ page }) => {
  await page.goto("/admin/modificadores");
  await expect(page.getByRole("heading", { name: "Modificadores", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "admin-modificadores-mobile");
  await page.goto("/admin/modificadores/nuevo");
  await page.getByLabel("Tipo").selectOption({ label: "Quitar" });
  await expect(page.getByLabel("Precio (pesos)")).toBeDisabled();
  const formOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(formOverflow).toBeLessThanOrEqual(0);
  await shot(page, "admin-modifier-form-mobile");
});
