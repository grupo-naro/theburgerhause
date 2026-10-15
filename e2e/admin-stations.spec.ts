import { expect, test, type Locator, type Page } from "@playwright/test";
import { hashStationToken } from "../src/lib/stations/token";
import { findStation } from "./helpers/db";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const card = (page: Page, name: string): Locator => page.locator(`div[aria-label="${name}"]`);
const tokenInput = (scope: Page | Locator): Locator => scope.getByLabel("Token de la estación");

test("seeded stations show that they have no token yet", async ({ page }) => {
  await page.goto("/admin/estaciones");
  await expect(page.getByRole("heading", { name: "Estaciones", level: 1 })).toBeVisible();
  const seeded = card(page, "Mostrador 1");
  await expect(seeded).toContainText("Sin token — generá uno");
  await expect(seeded.getByRole("button", { name: "Generar token" })).toBeVisible();
  expect((await findStation("Mostrador 1")).tokenHash).toBeNull();
  await shot(page, "admin-estaciones");
});

test("create a station: one-time token panel, gone after reload; rotate gives a new token", async ({ page }) => {
  const name = `Estación ${uid()}`;
  await page.goto("/admin/estaciones");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Tipo").selectOption("delivery");
  await page.getByRole("button", { name: "Crear estación" }).click();

  const panel = page.getByRole("status").filter({ hasText: "Guardalo ahora" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("no se vuelve a mostrar");
  const first = await tokenInput(panel).inputValue();
  expect(first).toMatch(/^bhst_[A-Za-z0-9_-]{43}$/);
  expect((await findStation(name)).tokenHash).toBe(hashStationToken(first));
  await shot(page, "admin-estaciones-token");

  // reload: the token is gone, the row shows a token exists
  await page.reload();
  await expect(page.getByLabel("Token de la estación")).toHaveCount(0);
  expect(await page.content()).not.toContain(first);
  const stationCard = card(page, name);
  await expect(stationCard).toContainText("Token activo");
  await expect(stationCard).toContainText("Nunca conectada");

  // rotate (two steps: confirmation)
  await stationCard.getByRole("button", { name: "Rotar token" }).click();
  await expect(stationCard).toContainText("deja de funcionar al instante");
  await stationCard.getByRole("button", { name: "Confirmar rotación" }).click();
  const second = await tokenInput(stationCard).inputValue();
  expect(second).toMatch(/^bhst_/);
  expect(second).not.toBe(first);
  const stored = (await findStation(name)).tokenHash;
  expect(stored).toBe(hashStationToken(second));
  expect(stored).not.toBe(hashStationToken(first));
});

test("generate the first token of a seeded station", async ({ page }) => {
  await page.goto("/admin/estaciones");
  const seeded = card(page, "Delivery 1");
  await seeded.getByRole("button", { name: "Generar token" }).click();
  await seeded.getByRole("button", { name: "Confirmar" }).click();
  await expect(tokenInput(seeded)).toHaveValue(/^bhst_/);
  await expect(seeded).toContainText("Token activo");
  expect((await findStation("Delivery 1")).tokenHash).toMatch(/^[0-9a-f]{64}$/);
});

test("a duplicate station name shows a field error; renaming works", async ({ page }) => {
  const name = `Dup ${uid()}`;
  await page.goto("/admin/estaciones");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Crear estación" }).click();
  await expect(tokenInput(page)).toBeVisible();

  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Crear estación" }).click();
  await expect(page.getByText("Ya existe una estación con ese nombre").first()).toBeVisible();

  await page.goto("/admin/estaciones");
  const stationCard = card(page, name);
  await stationCard.getByRole("button", { name: "Renombrar" }).click();
  await page.getByLabel(`Nombre de ${name}`).fill(`${name} bis`);
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("heading", { name: `${name} bis`, level: 2 })).toBeVisible();
  expect((await findStation(`${name} bis`)).tokenHash).toMatch(/^[0-9a-f]{64}$/);
});

test("@mobile stations page is usable on a phone", async ({ page }) => {
  await page.goto("/admin/estaciones");
  await expect(page.getByRole("heading", { name: "Estaciones", level: 1 })).toBeVisible();
  await page.getByLabel("Nombre", { exact: true }).fill(`Móvil ${uid()}`);
  await page.getByRole("button", { name: "Crear estación" }).click();
  await expect(tokenInput(page)).toBeVisible();
  await shot(page, "admin-estaciones-mobile");
});
