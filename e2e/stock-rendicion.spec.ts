import { expect, test, type Page } from "@playwright/test";
import { sql } from "drizzle-orm";
import * as s from "../src/db/schema";
import { buenosAiresToday, friendlyDay, longDay, shiftDate } from "../src/lib/stock/closing-dates";
import { noHorizontalOverflow } from "./helpers/checkout";
import { db, deleteStockClosings, deleteStockItem, findStockClosing, findStockItem, stockMovementsOf } from "./helpers/db";
import { authFile, USERS } from "./helpers/users";

/**
 * "Rendición de materia prima" (Stock): the encargado closes yesterday (loaded the next morning) and
 * today, sees the summary before confirming, a date closes once (also from a second tab), the closed
 * days can be looked up by date, a correction in the Historial is what the rendición shows, and the
 * admin shell reminds managers until today is closed. The old "Consumo del día" is gone.
 */

const CARNE = "E2E Rendición carne";
const PAN = "E2E Rendición pan";
const GASEOSA = "E2E Rendición gaseosa";

const today = () => buenosAiresToday(new Date());
const recentDays = () => [0, 1, 2, 3, 4, 5].map((n) => shiftDate(today(), n));

async function cleanup(): Promise<void> {
  // Every closing the spec may have made (and any left over), so the reminder starts from "none closed".
  await deleteStockClosings(recentDays());
  for (const name of [CARNE, PAN, GASEOSA]) await deleteStockItem(name);
}

/** Two raw materials and a drink with their opening balance (an ajuste_inicial movement, like the app does). */
async function seedItems(): Promise<void> {
  const items = await db()
    .insert(s.stockItems)
    .values([
      { name: CARNE, kind: "materia_prima", unit: "kg", quantity: 20000 },
      { name: PAN, kind: "materia_prima", unit: "u", quantity: 100000 },
      { name: GASEOSA, kind: "bebida", unit: "u", quantity: 24000 },
    ])
    .returning();
  await db()
    .insert(s.stockMovements)
    .values(items.map((i) => ({ itemId: i.id, kind: "ajuste_inicial" as const, qtyDelta: i.quantity, businessDate: sql`current_date` })));
}

const reminder = (page: Page) => page.getByTestId("closing-reminder");
const closedCard = (page: Page, date: string) => page.getByRole("listitem", { name: `Rendición del ${longDay(date)}` });

async function closeDay(page: Page, date: string, quantities: [string, string][], summary: [string, string][]): Promise<void> {
  await page.getByLabel("Fecha a rendir").fill(date);
  for (const [label, qty] of quantities) await page.getByLabel(label).fill(qty);
  await page.getByRole("button", { name: "Cerrar el día" }).click();
  // The summary: the date and only the lines with a quantity.
  await expect(page.getByRole("heading", { name: `Vas a cerrar el ${longDay(date)}` })).toBeVisible();
  const lines = page.getByRole("list", { name: "Resumen" }).getByRole("listitem");
  await expect(lines).toHaveCount(summary.length);
  for (const [i, [name, amount]] of summary.entries()) {
    await expect(lines.nth(i)).toContainText(name);
    await expect(lines.nth(i)).toContainText(amount);
  }
  await page.getByRole("button", { name: "Confirmar cierre" }).click();
  await expect(page.getByRole("status")).toHaveText(`Rendición del ${longDay(date)} cerrada.`);
}

test.use({ storageState: authFile("encargado") });
test.beforeEach(cleanup);
test.afterEach(cleanup);

for (const tag of ["", "@mobile "]) {
  test(`${tag}the encargado closes yesterday and today, once each; the reminder goes away; closed days can be looked up and corrected`, async ({ page, context }) => {
    await seedItems();
    const yesterday = shiftDate(today(), 1);

    // Before closing: the reminder sits in the admin shell and leads to the screen.
    await page.goto("/admin/menu");
    await expect(reminder(page)).toContainText("Todavía no se cerró ninguna rendición de materia prima.");
    await reminder(page).getByRole("link", { name: "Cargar la rendición" }).click();
    await expect(page).toHaveURL(/\/admin\/stock\/rendicion$/);
    await expect(page.getByRole("heading", { name: "Rendición de materia prima", level: 1 })).toBeVisible();

    // The Stock tabs: the rendición replaced "Consumo del día".
    const tabs = page.getByRole("navigation", { name: "Secciones de stock" });
    await expect(tabs.getByRole("link", { name: "Rendición de materia prima" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Consumo del día" })).toHaveCount(0);

    // Only raw material is listed; the date defaults to today and cannot go into the future.
    await expect(page.getByLabel("Fecha a rendir")).toHaveValue(today());
    await expect(page.getByLabel("Fecha a rendir")).toHaveAttribute("max", today());
    await expect(page.getByLabel(`${CARNE} (kg)`)).toBeVisible();
    await expect(page.getByLabel(`${PAN} (u)`)).toBeVisible();
    await expect(page.getByLabel(`${GASEOSA} (u)`)).toHaveCount(0);
    expect(await noHorizontalOverflow(page)).toBe(true);

    // Nothing typed: nothing to close.
    await page.getByRole("button", { name: "Cerrar el día" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Cargá al menos una cantidad" })).toBeVisible();

    // A second device opens today's summary now and confirms it only after today was closed here.
    const late = await context.newPage();
    await late.goto("/admin/stock/rendicion");
    await late.getByLabel(`${PAN} (u)`).fill("5");
    await late.getByRole("button", { name: "Cerrar el día" }).click();
    await expect(late.getByRole("heading", { name: `Vas a cerrar el ${longDay(today())}` })).toBeVisible();

    // Yesterday, loaded "the next morning", with a decimal comma.
    await closeDay(page, yesterday, [[`${CARNE} (kg)`, "3,5"]], [[CARNE, "3,5 kg"]]);
    await expect(reminder(page).getByText(/^La última/)).toHaveText(
      `La última rendición de materia prima cerrada es del ${friendlyDay(yesterday, today())}. Todavía no se cerró la de hoy.`,
    );
    await expect(closedCard(page, yesterday)).toContainText(`Cerrada por ${USERS.encargado.name}`);
    await expect(closedCard(page, yesterday).getByRole("row").filter({ hasText: CARNE })).toContainText("3,5");

    // Today: two articles. The reminder disappears.
    await expect(page.getByLabel("Fecha a rendir")).toHaveValue(today());
    await closeDay(
      page,
      today(),
      [
        [`${CARNE} (kg)`, "2"],
        [`${PAN} (u)`, "10"],
      ],
      [
        [CARNE, "2 kg"],
        [PAN, "10 u"],
      ],
    );
    await expect(reminder(page)).toHaveCount(0);
    // The latest two closed days are listed, newest first.
    await expect(page.getByRole("list", { name: "Rendiciones" }).getByRole("listitem")).toHaveCount(2);
    await expect(closedCard(page, today()).getByRole("row").filter({ hasText: PAN })).toContainText("10");

    // The same date again: flagged in the form, and refused to the tab that still had it open.
    await expect(page.getByText("Ya cerrada", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar el día" })).toBeDisabled();
    await late.getByRole("button", { name: "Confirmar cierre" }).click();
    await expect(late.getByRole("alert").filter({ hasText: "La rendición de ese día ya está cerrada" }).first()).toBeVisible();
    await late.close();
    const carne = await findStockItem(CARNE);
    expect((await stockMovementsOf(carne.id)).filter((m) => m.kind === "consumo")).toHaveLength(2);
    expect(carne.quantity).toBe(20000 - 3500 - 2000);
    expect((await findStockClosing(today()))?.closedBy).not.toBeNull();

    // Looking up a specific day; a day without a closing says so.
    await page.getByLabel("Ver un día").fill(yesterday);
    await page.getByRole("button", { name: "Ver", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`dia=${yesterday}`));
    await expect(page.getByRole("list", { name: "Rendiciones" }).getByRole("listitem")).toHaveCount(1);
    await expect(closedCard(page, yesterday)).toBeVisible();
    const empty = shiftDate(today(), 4);
    await page.getByLabel("Ver un día").fill(empty);
    await page.getByRole("button", { name: "Ver", exact: true }).click();
    await expect(page.getByText("No hay rendición cerrada ese día.")).toBeVisible();

    // A correction in the Historial (yesterday's carne 3,5 -> 3) is what the rendición shows.
    await page.goto(`/admin/stock/rendicion?dia=${yesterday}`);
    await closedCard(page, yesterday).getByRole("link", { name: "Corregir en el Historial" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/stock/historial\\?dia=${yesterday}`));
    const row = page.getByRole("listitem").filter({ hasText: CARNE }).filter({ hasText: "de la rendición" });
    await expect(row).toContainText("-3,5 kg");
    await row.getByRole("button", { name: /^Editar/ }).click();
    await row.getByLabel(/Nueva cantidad/).fill("3");
    await row.getByRole("button", { name: "Guardar cambio" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: CARNE }).filter({ hasText: "Valor anterior: 3,5 kg" })).toBeVisible();
    await page.goto(`/admin/stock/rendicion?dia=${yesterday}`);
    await expect(closedCard(page, yesterday).getByRole("row").filter({ hasText: CARNE }).getByRole("cell").nth(1)).toHaveText("3");
    expect((await findStockItem(CARNE)).quantity).toBe(20000 - 3000 - 2000);
  });
}

test("the reminder is for managers only: the cashier's screens and the counter TV never show it", async ({ browser, baseURL }) => {
  for (const role of ["cajera", "cocina"] as const) {
    const ctx = await browser.newContext({ baseURL, storageState: authFile(role), extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    const page = await ctx.newPage();
    await page.goto(role === "cajera" ? "/mostrador" : "/pantalla");
    await expect(page.locator("main, body").first()).toBeVisible();
    await expect(reminder(page)).toHaveCount(0);
    await page.goto("/admin/stock/rendicion");
    await expect(page).not.toHaveURL(/\/admin\/stock\/rendicion/);
    await ctx.close();
  }
});
