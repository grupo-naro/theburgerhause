import { expect, test, type Page } from "@playwright/test";
import { findCadet, findProduct } from "./helpers/db";
import { authFile } from "./helpers/users";

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const MANAGER_SECTIONS = ["Menú", "Modificadores", "Cadetes", "Stock"];
const ADMIN_ONLY_SECTIONS = ["Usuarios", "Ajustes", "Estaciones"];
const ADMIN_ONLY_URLS = ["/admin/usuarios", "/admin/usuarios/nuevo", "/admin/ajustes", "/admin/estaciones"];

async function expectSections(nav: ReturnType<Page["getByRole"]>, visible: string[], hidden: string[]): Promise<void> {
  for (const label of visible) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  for (const label of hidden) await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
}

test.describe("encargado", () => {
  test.use({ storageState: authFile("encargado") });

  test("sees Menú, Modificadores and Cadetes in the sidebar, not Usuarios / Ajustes / Estaciones", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/menu");
    await expect(page.getByRole("heading", { name: "Menú", level: 1 })).toBeVisible();
    await expectSections(page.getByRole("navigation", { name: "Administración" }), MANAGER_SECTIONS, ADMIN_ONLY_SECTIONS);
  });

  test("the admin-only zones are refused by direct URL", async ({ page }) => {
    for (const url of ADMIN_ONLY_URLS) {
      await page.goto(url);
      await expect(page, url).not.toHaveURL(/\/admin\/(usuarios|ajustes|estaciones)/);
      await expect(page.getByRole("heading", { name: /^(Usuarios|Ajustes|Estaciones)$/, level: 1 })).toHaveCount(0);
    }
  });

  test("can pause a product and edit a cadet", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const product = "Ranchita simple";
    // Leave the seeded product active whatever happened before (other specs depend on it).
    const ensureActive = async () => {
      await page.goto("/admin/menu");
      const row = page.getByRole("row").filter({ hasText: product });
      await expect(row).toBeVisible();
      if (await row.getByText("Inactivo").isVisible()) await page.getByRole("button", { name: `Activar ${product}` }).click();
      await expect(page.getByRole("row").filter({ hasText: product }).getByText("Activo", { exact: true })).toBeVisible();
    };
    await ensureActive();
    try {
      await page.getByRole("button", { name: `Desactivar ${product}` }).click();
      await expect(page.getByRole("row").filter({ hasText: product }).getByText("Inactivo")).toBeVisible();
      expect((await findProduct(product)).active).toBe(false);
    } finally {
      await ensureActive();
    }

    const name = `Cadete enc ${uid()}`;
    await page.goto("/admin/cadetes/nuevo");
    await page.getByLabel("Nombre").fill(name);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/admin\/cadetes$/);
    await page.getByRole("row").filter({ hasText: name }).getByRole("link", { name: "Editar" }).click();
    await expect(page.getByRole("heading", { name: "Editar cadete", level: 1 })).toBeVisible();
    await page.getByLabel("Teléfono").fill("11 4444-5555");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/admin\/cadetes$/);
    expect((await findCadet(name)).phone).toBe("11 4444-5555");
  });

  test("the pages of modificadores load for the encargado", async ({ page }) => {
    await page.goto("/admin/modificadores");
    await expect(page.getByRole("heading", { name: "Modificadores", level: 1 })).toBeVisible();
  });

  test("@mobile the drawer lists the same 4 sections plus the way back and logout", async ({ page }) => {
    await page.goto("/admin/menu");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const drawer = page.getByRole("dialog", { name: "Menú de administración" });
    await expectSections(drawer.getByRole("navigation", { name: "Secciones de administración" }), MANAGER_SECTIONS, ADMIN_ONLY_SECTIONS);
    await expect(drawer.getByRole("link", { name: "Volver a operación" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("still sees the six sections", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/menu");
    await expectSections(page.getByRole("navigation", { name: "Administración" }), [...MANAGER_SECTIONS, ...ADMIN_ONLY_SECTIONS], []);
  });

  test("@mobile the drawer lists the six sections", async ({ page }) => {
    await page.goto("/admin/menu");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const drawer = page.getByRole("dialog", { name: "Menú de administración" });
    await expectSections(drawer.getByRole("navigation", { name: "Secciones de administración" }), [...MANAGER_SECTIONS, ...ADMIN_ONLY_SECTIONS], []);
  });
});
