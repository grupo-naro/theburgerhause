import { expect, test } from "@playwright/test";
import { findProduct, setProductActiveInDb } from "./helpers/db";
import { gotoStore, openSheet, setProductActive, waitForCard, withAdmin } from "./helpers/store";

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

test("a combo is set up on its product page and the store says what it includes; it hides while a part is paused", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const name = `Combo E2E ${uid()}`;
  await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, async (admin) => {
    await admin.goto("/admin/menu/productos/nuevo");
    await admin.getByLabel("Categoría").selectOption({ label: "Combos" });
    await admin.getByLabel("Nombre").fill(name);
    await admin.getByLabel("Precio (pesos)").fill("20000");
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/menu$/);

    const combo = await findProduct(name);
    await admin.goto(`/admin/menu/productos/${combo.id}`);
    const section = admin.getByRole("form", { name: "Contenido del combo" });
    await section.getByRole("button", { name: "Agregar producto" }).click();
    await section.getByRole("button", { name: "Agregar producto" }).click();
    const rows = section.getByTestId("combo-row");
    await rows.nth(0).getByLabel("Producto").selectOption({ label: "Ranchita simple" });
    await rows.nth(0).getByLabel("Cantidad").fill("2");
    await rows.nth(1).getByLabel("Producto").selectOption({ label: "Melt simple" });
    await expect(section.getByTestId("combo-saving")).toContainText("Ahorro");
    await section.getByRole("button", { name: "Actualizar contenido" }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Contenido del combo guardado" })).toBeVisible();
  });

  const combo = await findProduct(name);
  try {
    await gotoStore(page);
    await waitForCard(page, name, true);
    const sheet = await openSheet(page, name);
    await expect(sheet.getByTestId("combo-includes")).toHaveText("Incluye: 2 × Ranchita simple, 1 × Melt simple");
    await page.keyboard.press("Escape");

    // Something inside paused: the combo is not offered.
    await setProductActiveInDb("Melt simple", false);
    await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, async (admin) => {
      // Any admin save refreshes the cached menu; re-saving the contents is the simplest one.
      await admin.goto(`/admin/menu/productos/${combo.id}`);
      await admin.getByRole("form", { name: "Contenido del combo" }).getByRole("button", { name: "Actualizar contenido" }).click();
      await expect(admin.getByRole("status").filter({ hasText: "Contenido del combo guardado" })).toBeVisible();
    });
    await waitForCard(page, name, false);
  } finally {
    await setProductActiveInDb("Melt simple", true);
    // Pause the combo THROUGH the admin: that also refreshes the cached menu, so Melt simple is back for later specs.
    await withAdmin(browser, baseURL, testInfo.project.use.extraHTTPHeaders, (admin) => setProductActive(admin, name, false));
  }
});
