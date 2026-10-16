import { expect, test } from "@playwright/test";
import { shot } from "./helpers/shots";
import { authFile, USERS } from "./helpers/users";

const anonymous = { cookies: [], origins: [] };

test.describe("anonymous visitor", () => {
  test.use({ storageState: anonymous });

  for (const path of ["/admin/menu", "/caja"]) {
    test(`GET ${path} redirects to /login with next`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { name: "Ingresar" })).toBeVisible();
    });
  }

  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Usuario")).toBeVisible();
    await shot(page, "login");
  });

  test("wrong password shows a generic error and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(USERS.cajera.username);
    await page.getByLabel("Contraseña").fill("definitivamente-incorrecta");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Usuario o contraseña incorrectos");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page fits a phone screen without horizontal scroll @mobile", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, "login-mobile");
  });
});

test.describe("cashier session", () => {
  test.use({ storageState: anonymous });

  test("first login picks a station, shows her name, and logout kills the session", async ({ page, context }) => {
    const user = USERS.cajera;
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(user.username);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    // No station cookie yet -> station picker.
    await expect(page).toHaveURL(/\/estacion/);
    await expect(page.getByRole("heading", { name: "¿Dónde estás trabajando?" })).toBeVisible();
    // One workspace per sector: a cashier is only offered Mostrador stations.
    await expect(page.getByRole("button", { name: /Mostrador 1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Delivery 1/ })).toHaveCount(0);
    await shot(page, "estacion");

    await page.getByRole("button", { name: /Mostrador 1/ }).click();
    await expect(page).toHaveURL(/\/mostrador$/);
    await expect(page.getByTestId("station-name")).toHaveText("Estación: Mostrador 1");
    await expect(page.getByTestId("user-name")).toHaveText(user.name);

    // Wrong role area -> bounced to her own home.
    await page.goto("/admin/menu");
    await expect(page).toHaveURL(/\/mostrador$/);

    const [session] = (await context.cookies()).filter((c) => c.name === "bh_session");
    expect(session).toBeDefined();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/caja");
    await expect(page).toHaveURL(/\/login/);

    // The server must have revoked the session: replaying the old cookie is useless.
    await context.addCookies([session]);
    await page.goto("/caja");
    await expect(page).toHaveURL(/\/login/);
  });

  test("second login on a known terminal skips the station picker", async ({ page }) => {
    const user = USERS.cajera;
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(user.username);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByRole("button", { name: /Mostrador 1/ }).click();
    await expect(page).toHaveURL(/\/mostrador$/);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Usuario").fill(user.username);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/mostrador$/);
  });
});

test.describe("saved sessions", () => {
  test.describe("cashier", () => {
    test.use({ storageState: authFile("cajera") });
    test("is kept out of /admin/menu", async ({ page }) => {
      await page.goto("/admin/menu");
      await expect(page).toHaveURL(/\/mostrador$/);
    });
  });

  test.describe("delivery manager", () => {
    test.use({ storageState: authFile("encargada") });
    test("lands on Gestión Delivery (/delivery) with her station", async ({ page }) => {
      await page.goto("/delivery");
      await expect(page.getByTestId("station-name")).toHaveText("Estación: Delivery 1");
      await expect(page.getByTestId("user-name")).toHaveText(USERS.encargada.name);
    });
  });
});
