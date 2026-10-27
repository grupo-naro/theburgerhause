import { expect, test, type Page } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers/checkout";
import { deleteStockItem, findStockItem, stockMovementsOf } from "./helpers/db";
import { authFile } from "./helpers/users";

const CARNE = "Carne picada";
const COCA = "Coca-Cola 500 ml";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

/** Every control inside <main> is a comfortable touch target and nothing makes the page scroll sideways. */
async function expectTouchFriendly(page: Page): Promise<void> {
  expect(await noHorizontalOverflow(page)).toBe(true);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'main a[href], main button, main select, main input:not([type="hidden"]):not([type="checkbox"]), [aria-label="Secciones de stock"] a',
    );
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.height)}px`);
    }
    return out;
  });
  expect(small, "targets under 44 px").toEqual([]);
}

async function createItem(page: Page, name: string, kind: "Bebida" | "Materia prima", unit: "kg (kilos)" | "u (unidades)"): Promise<void> {
  await page.goto("/admin/stock/articulos/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Tipo").selectOption({ label: kind });
  await page.getByLabel("Unidad").selectOption({ label: unit });
  await page.getByRole("button", { name: "Crear artículo" }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/articulos\/\d+\?nuevo=1$/);
}

async function setInitial(page: Page, qty: string): Promise<void> {
  await page.getByLabel(/Cantidad inicial/).fill(qty);
  await page.getByRole("button", { name: "Guardar stock inicial" }).click();
  await expect(page).toHaveURL(/\/admin\/stock$/);
}

const card = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

for (const role of ["encargado", "admin"] as const) {
  test.describe(`stock screens as ${role}`, () => {
    test.use({ storageState: authFile(role) });

    for (const viewport of VIEWPORTS) {
      test(`@mobile full flow at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await deleteStockItem(CARNE);
        await deleteStockItem(COCA);

        // Create both items and load their starting balance.
        await createItem(page, CARNE, "Materia prima", "kg (kilos)");
        await expectTouchFriendly(page);
        await setInitial(page, "60");
        await createItem(page, COCA, "Bebida", "u (unidades)");
        await setInitial(page, "10");
        await expect(card(page, CARNE).getByText("60 kg")).toBeVisible();
        await expect(card(page, COCA).getByText("10 u")).toBeVisible();
        await expect(card(page, COCA).getByText("Ok", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Bebidas", level: 2 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Materia prima", level: 2 })).toBeVisible();
        await expectTouchFriendly(page);

        // The product form offers drinks only.
        await page.goto("/admin/menu/productos/nuevo");
        const options = await page.getByLabel("Artículo de stock").locator("option").allTextContents();
        expect(options).toContain(COCA);
        expect(options).not.toContain(CARNE);

        // Reponer 48 u de Coca.
        await page.goto("/admin/stock/reponer");
        await expectTouchFriendly(page);
        await page.getByLabel("Artículo").selectOption({ label: `${COCA} (u)` });
        await expect(page.getByText("vuelve a venderse")).toBeVisible();
        await page.getByLabel(/^Cantidad/).fill("48");
        await page.getByRole("button", { name: "Cargar ingreso" }).click();
        await expect(page.getByRole("status")).toContainText(`Saldo de ${COCA}: 58 u`);
        await page.goto("/admin/stock");
        await expect(card(page, COCA).getByText("58 u")).toBeVisible();

        // Consumo with a decimal comma.
        await page.goto("/admin/stock/consumo");
        await expectTouchFriendly(page);
        await page.getByLabel(`${CARNE} (kg)`).fill("12,5");
        await page.getByRole("button", { name: "Guardar consumo" }).click();
        await expect(page.getByRole("status")).toContainText("Consumo guardado");
        await page.goto("/admin/stock");
        await expect(card(page, CARNE).getByText("47,5 kg")).toBeVisible();

        // A double tap on "Guardar consumo" is ONE movement.
        const carne = await findStockItem(CARNE);
        const before = (await stockMovementsOf(carne.id)).length;
        await page.goto("/admin/stock/consumo");
        await page.getByLabel(`${CARNE} (kg)`).fill("1");
        await page.getByRole("button", { name: "Guardar consumo" }).dblclick();
        await expect(page.getByRole("status")).toContainText("Consumo guardado");
        expect((await stockMovementsOf(carne.id)).length).toBe(before + 1);

        // Edit the 12,5 consumo: the history keeps the previous value.
        await page.goto(`/admin/stock/historial?item=${carne.id}`);
        await expectTouchFriendly(page);
        const row = page.getByRole("listitem").filter({ hasText: "-12,5 kg" });
        await row.getByRole("button", { name: /^Editar/ }).click();
        await row.getByLabel(/Nueva cantidad/).fill("10");
        await row.getByRole("button", { name: "Guardar cambio" }).click();
        const edited = page.getByRole("listitem").filter({ hasText: "-10 kg" });
        await expect(edited).toBeVisible();
        await expect(edited).toContainText("Valor anterior: 12,5 kg");
        await expectTouchFriendly(page);
        await page.goto("/admin/stock");
        await expect(card(page, CARNE).getByText("49 kg")).toBeVisible();
      });
    }

    test("@mobile a consumo that leaves a negative balance asks for confirmation", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[0]);
      await deleteStockItem(CARNE);
      await createItem(page, CARNE, "Materia prima", "kg (kilos)");
      await setInitial(page, "2");
      await page.goto("/admin/stock/consumo");
      await page.getByLabel(`${CARNE} (kg)`).fill("5");
      await page.getByRole("button", { name: "Guardar consumo" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "en negativo" })).toBeVisible();
      await page.getByRole("button", { name: "Guardar igual" }).click();
      await expect(page.getByRole("status")).toContainText("Consumo guardado");
      await page.goto("/admin/stock");
      await expect(card(page, CARNE).getByText("-3 kg")).toBeVisible();
      await expect(card(page, CARNE).getByText("Agotado", { exact: true })).toBeVisible();
    });
  });
}

test.describe("stock screens as cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("@mobile cannot open any /admin/stock page by URL", async ({ page }) => {
    for (const url of ["/admin/stock", "/admin/stock/reponer", "/admin/stock/consumo", "/admin/stock/articulos", "/admin/stock/articulos/nuevo", "/admin/stock/historial"]) {
      await page.goto(url);
      await expect(page, url).not.toHaveURL(/\/admin\/stock/);
      await expect(page.getByRole("heading", { name: /^(Stock|Reponer stock|Consumo del día|Artículos|Historial)$/, level: 1 })).toHaveCount(0);
    }
  });
});
