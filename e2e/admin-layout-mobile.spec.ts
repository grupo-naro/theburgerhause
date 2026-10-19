import { expect, test } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers/checkout";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const SECTIONS = ["Menú", "Modificadores", "Cadetes", "Usuarios", "Estaciones", "Ajustes"];

test("@mobile the admin shell has a sticky bar and a drawer with every section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/menu");
  expect(await noHorizontalOverflow(page)).toBe(true);

  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  await expect(burger).toHaveAttribute("aria-expanded", "false");
  const box = await burger.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43.5);

  // The old horizontal strip is gone below md.
  await expect(page.getByRole("navigation", { name: "Administración" })).toBeHidden();

  await burger.click();
  const drawer = page.getByRole("dialog", { name: "Menú de administración" });
  await expect(drawer).toBeVisible();
  await expect(burger).toHaveAttribute("aria-expanded", "true");
  for (const name of SECTIONS) await expect(drawer.getByRole("link", { name })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Menú" })).toHaveAttribute("aria-current", "page");
  await expect(drawer.getByRole("link", { name: "Volver a operación" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  // The page behind does not scroll while the drawer is open.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(burger).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");

  // Outside tap closes it too.
  await burger.click();
  await expect(drawer).toBeVisible();
  await page.getByTestId("admin-drawer-backdrop").click({ position: { x: 370, y: 400 } });
  await expect(drawer).toBeHidden();

  await burger.click();
  await drawer.getByRole("link", { name: "Usuarios" }).click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await expect(page.getByTestId("admin-mobile-bar")).toContainText("Usuarios");
});

test("@mobile the top bar stays in view after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/admin/menu");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByTestId("admin-mobile-bar")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeInViewport();
});

test("desktop keeps the sidebar and has no drawer button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/admin/menu");
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeHidden();
  const nav = page.getByRole("navigation", { name: "Administración" });
  await expect(nav).toBeVisible();
  for (const name of SECTIONS) await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});

test("@mobile touch sizing is scoped to the admin", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/ajustes");
  expect(await page.locator("[data-admin-touch]").count()).toBe(1);
  const fieldSize = await page.getByLabel("Nombre del local").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fieldSize).toBeGreaterThanOrEqual(16);
  const save = await page.getByRole("button", { name: "Guardar ajustes" }).boundingBox();
  expect(save!.height).toBeGreaterThanOrEqual(43.5);
});
