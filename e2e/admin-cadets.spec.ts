import { expect, test, type Locator, type Page } from "@playwright/test";
import { findCadet } from "./helpers/db";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const row = (page: Page, name: string): Locator => page.getByRole("row").filter({ hasText: name });

async function createCadet(page: Page, name: string, phone = ""): Promise<void> {
  await page.goto("/admin/cadetes/nuevo");
  await page.getByLabel("Nombre").fill(name);
  if (phone) await page.getByLabel("Teléfono").fill(phone);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/cadetes$/);
  await expect(row(page, name)).toBeVisible();
}

test("lists the seeded cadets", async ({ page }) => {
  await page.goto("/admin/cadetes");
  await expect(page.getByRole("heading", { name: "Cadetes", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Cadetes" })).toBeVisible();
  await expect(page.getByRole("row")).not.toHaveCount(1);
  await shot(page, "admin-cadetes");
});

test("create a cadet, then toggle it inactive and active again", async ({ page }) => {
  const name = `Cadete ${uid()}`;
  await createCadet(page, name, "+54 11 5555-1234");
  expect((await findCadet(name)).phone).toBe("+54 11 5555-1234");
  const r = row(page, name);
  await expect(r).toContainText("Activo");

  await r.getByRole("button", { name: `Desactivar ${name}` }).click();
  await expect(r).toContainText("Inactivo");
  expect((await findCadet(name)).active).toBe(false);

  await r.getByRole("button", { name: `Activar ${name}` }).click();
  await expect(r).toContainText("Activo");
  expect((await findCadet(name)).active).toBe(true);
});

test("validates the phone and warns about a duplicate name (soft warning)", async ({ page }) => {
  const name = `Dup ${uid()}`;
  await createCadet(page, name);

  await page.goto("/admin/cadetes/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await expect(page.getByRole("status").filter({ hasText: "Ya hay un cadete activo con ese nombre" })).toBeVisible();
  await page.getByLabel("Teléfono").fill("11-ABCD");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Solo números, espacios, + - y paréntesis")).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue(name);

  await page.getByLabel("Teléfono").fill("11 4444-5555");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/cadetes$/);
  await expect(row(page, name)).toHaveCount(2);
});

test("@mobile cadets pages are usable on a phone", async ({ page }) => {
  await page.goto("/admin/cadetes");
  await expect(page.getByRole("heading", { name: "Cadetes", level: 1 })).toBeVisible();
  await shot(page, "admin-cadetes-mobile");
  await page.goto("/admin/cadetes/nuevo");
  await expect(page.getByRole("heading", { name: "Nuevo cadete", level: 1 })).toBeVisible();
  await shot(page, "admin-cadetes-nuevo-mobile");
});
