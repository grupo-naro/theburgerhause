import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { normalizeSearchText } from "../src/lib/menu/search";
import { db } from "./helpers/db";
import { modifierRow } from "./helpers/store";
import {
  chargeButton,
  formatARS,
  linesOf,
  modifierDelta,
  openPos,
  priceOf,
  releaseCounterState,
  search,
  tileCustomize,
  tileMain,
  tiles,
  ticketLines,
  totalOf,
} from "./helpers/pos";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });
test.afterEach(releaseCounterState);

test("fast path: search, categories, tap-to-add, grouped lines, customized units, edit, remove, limpiar", async ({ page }) => {
  const ranchita = await priceOf("Ranchita simple");
  const melt = await priceOf("Melt simple");
  const cuarto = await priceOf("Cuarto de libra simple");
  const dips = await modifierDelta("+ Dips de cheddar");

  await openPos(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openPos(page);
  await expect(page.getByTestId("ticket-empty")).toBeVisible();
  await expect(totalOf(page)).toHaveText(formatARS(0));

  // Search is accent-insensitive and filters by name + description.
  const all = await db().select({ name: s.products.name, description: s.products.description }).from(s.products).where(eq(s.products.active, true));
  const expected = all.filter((p) => normalizeSearchText(`${p.name} ${p.description ?? ""}`).includes("medallon")).length;
  expect(expected).toBeGreaterThan(3);
  await search(page).fill("medallon");
  await expect(tiles(page)).toHaveCount(expected);
  await search(page).fill("ranchita simple");
  await expect(tiles(page)).toHaveCount(1);
  await search(page).fill("zzzz");
  await expect(page.getByTestId("pos-no-results")).toBeVisible();
  await search(page).fill("");

  // Category chips filter the grid ("Todas" is the default).
  const chips = page.getByRole("group", { name: "Categorías" });
  await expect(chips.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
  const total = await tiles(page).count();
  await chips.getByRole("button", { name: "Hamburguesa doble + papa chica" }).click();
  await expect(tiles(page)).toHaveCount(4);
  await chips.getByRole("button", { name: "Todas" }).click();
  await expect(tiles(page)).toHaveCount(total);

  // Tap = one plain unit, no modal; the same product again increments the same grouped line.
  await tileMain(page, "Ranchita simple").click();
  await expect(tiles(page).first().getByTestId("tile-pulse")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tileMain(page, "Melt simple").click();
  await tileMain(page, "Ranchita simple").click();
  await expect(ticketLines(page)).toHaveCount(2);
  await expect(linesOf(page, "Ranchita simple")).toHaveAttribute("data-quantity", "2");
  await expect(linesOf(page, "Ranchita simple").getByTestId("line-total")).toHaveText(formatARS(2 * ranchita));
  await expect(linesOf(page, "Melt simple")).toHaveAttribute("data-quantity", "1");
  await expect(totalOf(page)).toHaveText(formatARS(2 * ranchita + melt));
  await tileMain(page, "Ranchita simple").click();
  await expect(linesOf(page, "Ranchita simple")).toHaveAttribute("data-quantity", "3");

  // Personalizar: 2 units, "Sin cheddar" on #1, "Igual que la 1" then "+ Dips" on #2.
  await tileCustomize(page, "Cuarto de libra simple").click();
  const dialog = page.getByTestId("configure-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Más cantidad" }).click();
  const units = dialog.getByTestId("unit-section");
  await expect(units).toHaveCount(2);
  await modifierRow(units.nth(0), "Sin cheddar").click();
  await units.nth(1).getByRole("button", { name: /Cuarto de libra simple #2/ }).click();
  await units.nth(1).getByRole("button", { name: "Igual que la 1" }).click();
  await modifierRow(units.nth(1), "+ Dips de cheddar").click();
  await expect(units.nth(0).getByTestId("unit-summary")).toHaveText("Sin cheddar");
  await expect(units.nth(1).getByTestId("unit-summary")).toHaveText("Sin cheddar · + Dips de cheddar");
  await expect(dialog.getByTestId("configure-confirm")).toHaveText(`Agregar al ticket · ${formatARS(2 * cuarto + dips)}`);
  await dialog.getByTestId("configure-confirm").click();
  await expect(dialog).toHaveCount(0);

  const cuartoLines = linesOf(page, "Cuarto de libra simple");
  await expect(cuartoLines).toHaveCount(2);
  await expect(cuartoLines.nth(0).getByTestId("line-chip")).toHaveText(["Sin cheddar"]);
  await expect(cuartoLines.nth(0).getByTestId("line-total")).toHaveText(formatARS(cuarto));
  await expect(cuartoLines.nth(1).getByTestId("line-chip")).toHaveText([/Sin cheddar/, /\+ Dips de cheddar/]);
  await expect(cuartoLines.nth(1).getByTestId("line-total")).toHaveText(formatARS(cuarto + dips));
  const grand = 3 * ranchita + melt + 2 * cuarto + dips;
  await expect(totalOf(page)).toHaveText(formatARS(grand));

  // Edit the second customized line: drop the Dips -> it merges with the first one (qty 2).
  await cuartoLines.nth(1).getByTestId("line-edit").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Editar Cuarto de libra simple/ })).toBeVisible();
  await modifierRow(dialog, "+ Dips de cheddar").click();
  await dialog.getByTestId("configure-confirm").click();
  await expect(dialog).toHaveCount(0);
  await expect(linesOf(page, "Cuarto de libra simple")).toHaveCount(1);
  await expect(linesOf(page, "Cuarto de libra simple")).toHaveAttribute("data-quantity", "2");
  await expect(totalOf(page)).toHaveText(formatARS(3 * ranchita + melt + 2 * cuarto));

  // Quantity stepper and remove (with undo).
  await linesOf(page, "Melt simple").getByRole("button", { name: /^Más/ }).click();
  await expect(linesOf(page, "Melt simple")).toHaveAttribute("data-quantity", "2");
  await linesOf(page, "Melt simple").getByTestId("line-remove").click();
  await expect(linesOf(page, "Melt simple")).toHaveCount(0);
  await page.getByTestId("toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(linesOf(page, "Melt simple")).toHaveAttribute("data-quantity", "2");
  await linesOf(page, "Melt simple").getByTestId("line-remove").click();
  await expect(totalOf(page)).toHaveText(formatARS(3 * ranchita + 2 * cuarto));

  // Limpiar ticket asks first; Cancelar keeps everything, Limpiar empties.
  await page.getByTestId("clear-ticket").click();
  const confirm = page.getByTestId("confirm-dialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(ticketLines(page)).toHaveCount(2);
  await page.getByTestId("clear-ticket").click();
  await page.getByTestId("confirm-yes").click();
  await expect(page.getByTestId("ticket-empty")).toBeVisible();
  await expect(page.getByTestId("clear-ticket")).toBeDisabled();
  await expect(chargeButton(page)).toBeDisabled();
});

test("keyboard flow: / focuses search, Enter adds, Alt+L clears, Esc closes the dialog and focus returns", async ({ page }) => {
  const ranchita = await priceOf("Ranchita simple");
  const melt = await priceOf("Melt simple");
  const cuarto = await priceOf("Cuarto de libra simple");
  await openPos(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openPos(page);

  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await page.keyboard.type("ranchita simple");
  await expect(tiles(page)).toHaveCount(1);
  await page.keyboard.press("Enter"); // a single result is added at once
  await expect(linesOf(page, "Ranchita simple")).toHaveAttribute("data-quantity", "1");
  await expect(search(page)).toHaveValue("");

  // "/" typed inside a field is just a character.
  await search(page).fill("a/b");
  await expect(search(page)).toHaveValue("a/b");
  await search(page).fill("");

  // Arrow down jumps from the search into the grid; Enter on a focused tile adds it.
  await page.keyboard.press("ArrowDown");
  const first = tiles(page).first().locator("[data-tile-main]");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(linesOf(page, "Ranchita simple")).toHaveAttribute("data-quantity", "2");
  await page.keyboard.press("ArrowRight");
  await expect(tiles(page).nth(1).locator("[data-tile-main]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(linesOf(page, "Melt simple")).toHaveCount(1);

  // Esc closes the configure dialog and the focus goes back to the opener.
  const opener = tileCustomize(page, "Cuarto de libra simple");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("configure-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("configure-dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Ctrl+Enter inside the dialog confirms the dialog, never charges.
  await opener.press("Enter");
  await expect(page.getByTestId("configure-dialog")).toBeVisible();
  await modifierRow(page.getByTestId("configure-dialog"), "Sin cheddar").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("configure-dialog")).toHaveCount(0);
  await expect(linesOf(page, "Cuarto de libra simple").getByTestId("line-chip")).toHaveText(["Sin cheddar"]);

  // Alt+L opens the clear confirmation; Esc cancels it.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+l");
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  await expect(totalOf(page)).toHaveText(formatARS(2 * ranchita + melt + cuarto));
});
