import { expect, test } from "@playwright/test";
import { settingValue } from "./helpers/db";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

/** Leave the shared test database open for business whatever happens. */
test.afterEach(async ({ page }) => {
  await page.goto("/admin/ajustes");
  const resume = page.getByRole("button", { name: "Reanudar pedidos" });
  if (await resume.isVisible()) await resume.click();
});

test("saves store data, alias/CBU, delivery fee and the toggle, and they persist after reload", async ({ page }) => {
  await page.goto("/admin/ajustes");
  await expect(page.getByRole("heading", { name: "Ajustes", level: 1 })).toBeVisible();
  await shot(page, "admin-ajustes");

  await page.getByLabel("Nombre del local").fill("The Burger House 828 E2E");
  await page.getByLabel("Dirección").fill("Av. Siempreviva 742");
  await page.getByLabel("Teléfono").fill("+54 11 5555-1234");
  await page.getByLabel("WhatsApp").fill("5491155551234");
  await page.getByLabel("Horarios").fill("Lun a Dom de 20 a 00");
  await page.getByLabel("Alias").fill("burger.house.828");
  await page.getByLabel("CBU / CVU").fill("0000003100012345678901");
  await page.getByLabel("Costo de envío ($)").fill("1500");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ajustes guardados" })).toBeVisible();

  expect(await settingValue("delivery_fee")).toBe(150000);
  expect(await settingValue("bank_cbu")).toBe("0000003100012345678901");

  await page.reload();
  await expect(page.getByLabel("Nombre del local")).toHaveValue("The Burger House 828 E2E");
  await expect(page.getByLabel("Alias")).toHaveValue("burger.house.828");
  await expect(page.getByLabel("CBU / CVU")).toHaveValue("0000003100012345678901");
  await expect(page.getByLabel("Costo de envío ($)")).toHaveValue("1500");
  await expect(page.getByLabel("WhatsApp")).toHaveValue("5491155551234");
  await expect(page.getByLabel("Horarios")).toHaveValue("Lun a Dom de 20 a 00");
});

test("the quick toggle pauses and resumes orders, and the form follows it", async ({ page }) => {
  await page.goto("/admin/ajustes");
  await expect(page.getByText("Recibiendo pedidos", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Recibiendo pedidos online")).toBeChecked();

  await page.getByRole("button", { name: "Pausar pedidos" }).click();
  await expect(page.getByText("Pedidos pausados", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Recibiendo pedidos online")).not.toBeChecked();
  expect(await settingValue("accepting_orders")).toBe(false);

  await page.reload();
  await expect(page.getByText("Pedidos pausados", { exact: true })).toBeVisible();
  await shot(page, "admin-ajustes-paused");

  await page.getByRole("button", { name: "Reanudar pedidos" }).click();
  await expect(page.getByText("Recibiendo pedidos", { exact: true })).toBeVisible();
  expect(await settingValue("accepting_orders")).toBe(true);
});

test("invalid CBU, alias and fee show inline errors and keep what was typed", async ({ page }) => {
  await page.goto("/admin/ajustes");
  await page.getByLabel("Alias").fill("alias invalido");
  await page.getByLabel("CBU / CVU").fill("123");
  await page.getByLabel("Costo de envío ($)").fill("-5");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("El CBU/CVU tiene 22 dígitos, sin espacios")).toBeVisible();
  await expect(page.getByText("Solo letras, números, punto, guion y guion bajo").first()).toBeVisible();
  await expect(page.getByLabel("CBU / CVU")).toHaveValue("123");
  await shot(page, "admin-ajustes-error");
});

test("@mobile settings page is usable on a phone", async ({ page }) => {
  await page.goto("/admin/ajustes");
  await expect(page.getByRole("heading", { name: "Ajustes", level: 1 })).toBeVisible();
  await shot(page, "admin-ajustes-mobile");
});
