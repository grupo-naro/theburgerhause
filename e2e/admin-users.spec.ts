import { expect, test, type Locator, type Page } from "@playwright/test";
import { countActiveSessions, findUser } from "./helpers/db";
import { loginInFreshContext } from "./helpers/login";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const row = (page: Page, text: string): Locator => page.getByRole("row").filter({ hasText: text });
const adminRow = (page: Page): Locator =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: "admin", exact: true }) });
const PASSWORD = "e2e-user-pass-1";

async function createCashier(page: Page, username: string): Promise<void> {
  await page.goto("/admin/usuarios/nuevo");
  await page.getByLabel("Nombre").fill(`Cajera ${username}`);
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Rol").selectOption("cajera");
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await expect(row(page, username)).toBeVisible();
}

test("lists the users without any password data", async ({ page }) => {
  await page.goto("/admin/usuarios");
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  await expect(adminRow(page)).toContainText("Administrador");
  await expect(adminRow(page)).toContainText("(vos)");
  expect(await page.content()).not.toContain("scrypt$");
  await shot(page, "admin-usuarios");
});

test("create a cashier who logs in and reaches /caja; deactivating kills her session", async ({
  page,
  browser,
  baseURL,
}) => {
  const username = `cajera.${uid()}`;
  await createCashier(page, username);
  expect((await findUser(username)).role).toBe("cajera");

  const { context, page: userPage } = await loginInFreshContext(browser, baseURL, username, PASSWORD);
  try {
    await page.reload();
    await expect(row(page, username)).toContainText("Activo");
    await row(page, username).getByRole("button", { name: `Desactivar ${username}` }).click();
    await expect(row(page, username)).toContainText("Inactivo");
    expect(await countActiveSessions((await findUser(username)).id)).toBe(0);

    await userPage.goto("/caja");
    await expect(userPage).toHaveURL(/\/login/);

    // and she can no longer log in again
    await userPage.getByLabel("Usuario", { exact: true }).fill(username);
    await userPage.getByLabel("Contraseña").fill(PASSWORD);
    await userPage.getByRole("button", { name: "Ingresar" }).click();
    await expect(userPage.getByText("Usuario o contraseña incorrectos")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Cerrar sesiones signs the user out everywhere without deactivating her", async ({ page, browser, baseURL }) => {
  const username = `cajera.${uid()}`;
  await createCashier(page, username);
  const { context, page: userPage } = await loginInFreshContext(browser, baseURL, username, PASSWORD);
  try {
    await page.reload();
    const button = row(page, username).getByRole("button", { name: `Cerrar sesiones de ${username}` });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(row(page, username)).toContainText("Activo");
    await userPage.goto("/caja");
    await expect(userPage).toHaveURL(/\/login/);
  } finally {
    await context.close();
  }
});

test("a password reset revokes sessions and the new password works", async ({ page, browser, baseURL }) => {
  const username = `cajera.${uid()}`;
  await createCashier(page, username);
  const { context, page: userPage } = await loginInFreshContext(browser, baseURL, username, PASSWORD);
  try {
    await page.goto(`/admin/usuarios/${(await findUser(username)).id}`);
    await page.getByLabel("Nueva contraseña").fill("brand-new-pass-9");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/admin\/usuarios$/);
    await userPage.goto("/caja");
    await expect(userPage).toHaveURL(/\/login/);
  } finally {
    await context.close();
  }
  const second = await loginInFreshContext(browser, baseURL, username, "brand-new-pass-9");
  await second.context.close();
});

test("a duplicate username (any case) shows a field error and keeps the form values", async ({ page }) => {
  const username = `dup.${uid()}`;
  await createCashier(page, username);
  await page.goto("/admin/usuarios/nuevo");
  await page.getByLabel("Nombre").fill("Otra");
  await page.getByLabel("Usuario", { exact: true }).fill(username.toUpperCase());
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Ese nombre de usuario ya está en uso")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toHaveValue("");
  await expect(page.getByLabel("Usuario", { exact: true })).toHaveValue(username.toUpperCase());
  await shot(page, "admin-usuarios-error");
});

test("the only admin cannot be deactivated or demoted", async ({ page }) => {
  await page.goto("/admin/usuarios");
  const admin = adminRow(page);
  await admin.getByRole("button", { name: "Desactivar admin" }).click();
  await expect(admin.getByRole("alert")).toContainText("No podés desactivarte a vos mismo");
  expect((await findUser("admin")).active).toBe(true);

  await page.goto(`/admin/usuarios/${(await findUser("admin")).id}`);
  await page.getByLabel("Rol").selectOption("cajera");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Tiene que quedar al menos un administrador activo")).toBeVisible();
  expect((await findUser("admin")).role).toBe("admin");
});

test("@mobile users page is usable on a phone", async ({ page }) => {
  await page.goto("/admin/usuarios");
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  await shot(page, "admin-usuarios-mobile");
});
