import { expect, test, type Locator } from "@playwright/test";
import { sql } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db, deleteStockItem } from "./helpers/db";
import { failPrintJob, markJobsDone, parkPendingOrders, placeRetiroOrder } from "./helpers/caja";
import { noHorizontalOverflow } from "./helpers/checkout";
import { modifierRow, settled } from "./helpers/store";
import {
  chargeButton,
  jobsOf,
  latestCounterOrder,
  linesOf,
  openPos,
  overlay,
  pagerInput,
  releaseCounterState,
  seedCounterOrder,
  tileCustomize,
  tileMain,
  tiles,
  typePager,
} from "./helpers/pos";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });
test.afterEach(releaseCounterState);

/** Every element of `locator` is at least `minW` x `minH` CSS pixels. */
async function expectTargets(locator: Locator, minH: number, minW = 48): Promise<void> {
  locator = locator.filter({ visible: true });
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    expect(box, `target #${i}`).not.toBeNull();
    expect(box!.height, `height of target #${i}`).toBeGreaterThanOrEqual(minH - 0.5);
    expect(box!.width, `width of target #${i}`).toBeGreaterThanOrEqual(minW - 0.5);
  }
}

const SIZES = [
  { w: 1280, h: 800, name: "desktop-1280" },
  { w: 1024, h: 768, name: "desktop-1024" },
  { w: 768, h: 1024, name: "tablet-768" },
] as const;

for (const size of SIZES) {
  test.describe(`${size.name}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });

    test(`layout, tap targets and every state at ${size.w}px`, async ({ page }) => {
      test.setTimeout(150_000);
      await releaseCounterState();
      const slideOver = size.w < 1024;
      for (const pager of [3, 7, 12]) await seedCounterOrder(pager);
      await openPos(page);

      // Empty POS: no horizontal overflow; the 2-column layout fits the viewport without page scroll.
      expect(await noHorizontalOverflow(page)).toBe(true);
      if (!slideOver) {
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
        const grid = await page.getByTestId("pos-grid").boundingBox();
        const aside = await page.getByTestId("ticket-aside").boundingBox();
        expect(aside!.x).toBeGreaterThan(grid!.x + grid!.width - 1); // side by side
      } else {
        await expect(page.getByTestId("ticket-aside")).toBeHidden();
        await expect(page.getByTestId("ticket-bar")).toBeVisible();
      }
      if (!slideOver) await expect(page.getByTestId("shortcuts-hint")).toContainText("Ctrl+Enter cobrar");
      await shot(page, `pos-empty-${size.name}`);

      // Tiles: >= 120px, 3-5 columns on a wide grid, 48px targets.
      await expectTargets(page.locator("[data-tile-main]"), 120, 120);
      await expectTargets(page.getByTestId("tile-customize"), 48, 120);
      const firstRowY = await tiles(page).first().evaluate((el) => el.getBoundingClientRect().top);
      const columns = await tiles(page).evaluateAll((els, y) => els.filter((e) => Math.abs(e.getBoundingClientRect().top - (y as number)) < 2).length, firstRowY);
      expect(columns).toBeGreaterThanOrEqual(3);
      expect(columns).toBeLessThanOrEqual(5);

      // A ticket with several lines and chips.
      await tileMain(page, "Ranchita simple").click();
      await tileMain(page, "Ranchita simple").click();
      await tileMain(page, "Melt simple").click();
      await tileCustomize(page, "Cuarto de libra simple").click();
      const dialog = page.getByTestId("configure-dialog");
      await dialog.getByRole("button", { name: "Más cantidad" }).click();
      const units = dialog.getByTestId("unit-section");
      await modifierRow(units.nth(0), "Sin cheddar").click();
      await units.nth(1).getByRole("button", { name: /#2/ }).click();
      await units.nth(1).getByRole("button", { name: "Igual que la 1" }).click();
      await modifierRow(units.nth(1), "+ Dips de cheddar").click();
      await expectTargets(dialog.getByTestId("modifier-row"), 48, 48);
      await expectTargets(dialog.getByTestId("configure-confirm"), 56, 200);
      await settled(dialog);
      await shotViewport(page, `pos-configure-dialog-${size.name}`);
      await dialog.getByTestId("configure-confirm").click();
      await expect(dialog).toHaveCount(0);

      if (slideOver) {
        await page.getByTestId("ticket-bar").click();
        await expect(page.getByTestId("ticket-aside")).toBeVisible();
        await expect(page.getByTestId("ticket-panel")).toBeVisible();
        await settled(page.getByTestId("ticket-aside"));
        await shotViewport(page, `pos-slideover-${size.name}`);
      }
      expect(await noHorizontalOverflow(page)).toBe(true);
      await expect(linesOf(page, "Cuarto de libra simple")).toHaveCount(2);
      await shotViewport(page, `pos-ticket-lines-${size.name}`);

      // Charge button disabled WITH its reason, then the rest of the sale.
      await expect(chargeButton(page)).toBeDisabled();
      await expect(page.getByTestId("charge-reason")).toHaveText("Elegí el método de pago");
      await shotViewport(page, `pos-charge-disabled-${size.name}`);
      await expectTargets(page.locator('[data-testid^="pay-"]'), 48, 100);
      await page.getByTestId("pay-cash").click();
      await page.getByTestId("quick-amount").last().click();
      await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", "change");
      await shotViewport(page, `pos-cash-change-${size.name}`);

      // Keypad with badges and the conflict.
      await expectTargets(page.locator('[data-testid^="pager-key-"]'), 48, 48);
      await expectTargets(page.getByTestId("pager-next-free"), 48, 100);
      await typePager(page, "7");
      await expect(page.getByTestId("pager-status")).toContainText("en uso por el pedido");
      await page.getByTestId("pager-section").scrollIntoViewIfNeeded();
      await shotViewport(page, `pos-pager-conflict-${size.name}`);
      await page.getByTestId("pager-next-free").click();
      await expect(pagerInput(page)).toHaveValue("1");
      await expect(chargeButton(page)).toBeEnabled();
      await expectTargets(chargeButton(page), 56, 200);
      await shotViewport(page, `pos-charge-enabled-${size.name}`);

      // Confirmation: printing -> printed.
      await chargeButton(page).click();
      await expect(overlay(page)).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "printing");
      await settled(overlay(page));
      await shotViewport(page, `pos-overlay-printing-${size.name}`);
      const sold = await latestCounterOrder();
      await markJobsDone(sold.id);
      await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "done", { timeout: 15_000 });
      await shotViewport(page, `pos-overlay-printed-${size.name}`);
      await expectTargets(page.getByTestId("new-sale"), 56, 200);
      await page.keyboard.press("Enter");
      await expect(overlay(page)).toHaveCount(0);

      // Failed print: alert + Reimprimir.
      await tileMain(page, "Melt simple").click();
      if (slideOver) await page.getByTestId("ticket-bar").click();
      await page.getByTestId("pay-transfer").click();
      await page.getByTestId("pager-next-free").click();
      await chargeButton(page).click();
      await expect(overlay(page)).toBeVisible();
      const failedOrder = await latestCounterOrder();
      const job = (await jobsOf(failedOrder.id)).find((j) => j.type === "customer")!;
      await failPrintJob(job.id, "Sin papel");
      await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "failed", { timeout: 15_000 });
      await expect(page.getByTestId("reprint")).toBeVisible();
      await shotViewport(page, `pos-overlay-failed-${size.name}`);
      await expectTargets(page.getByTestId("reprint"), 48, 100);
    });
  });
}

test("the ticket slide-over opens from the bottom bar and closes with its button and Esc", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await releaseCounterState();
  await openPos(page);
  await tileMain(page, "Ranchita simple").click();
  const bar = page.getByTestId("ticket-bar");
  await expect(bar).toContainText("Ticket · 1");
  await expect(page.getByTestId("ticket-aside")).toBeHidden();
  await bar.click();
  await expect(page.getByTestId("ticket-aside")).toBeVisible();
  // Focus stays inside the slide-over: the catalog behind it is inert.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[aria-label=Productos]"))).toBe(false);
  }
  await page.getByRole("button", { name: "Cerrar ticket" }).click();
  await expect(page.getByTestId("ticket-aside")).toBeHidden();
  await expect(bar).toBeFocused();
  await bar.click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ticket-aside")).toBeHidden();
  await bar.click();
  await page.getByTestId("ticket-backdrop").click({ position: { x: 10, y: 400 } });
  await expect(page.getByTestId("ticket-aside")).toBeHidden();
});


test.describe("laptop-1366x768", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("with 4 lines the pager, badges, payment and charge are reachable with one scroll and nothing hides under the footer", async ({ page }) => {
    test.setTimeout(90_000);
    await releaseCounterState();
    for (const pager of [3, 7, 12]) await seedCounterOrder(pager);
    await openPos(page);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await tileMain(page, "Ranchita simple").click();
    await shot(page, "pos-laptop-1-line-1366x768");

    await tileMain(page, "Melt simple").click();
    await tileMain(page, "Huevo simple").click();
    await tileCustomize(page, "Cuarto de libra simple").click();
    const dialog = page.getByTestId("configure-dialog");
    await modifierRow(dialog, "Sin cheddar").click();
    await modifierRow(dialog, "+ Dips de cheddar").click();
    await dialog.getByTestId("configure-confirm").click();
    await expect(page.getByTestId("ticket-line")).toHaveCount(4);
    await shot(page, "pos-laptop-4-lines-1366x768");

    const body = page.getByTestId("ticket-body");
    const footer = page.getByTestId("ticket-panel").locator("footer");
    const insideBody = async (what: string, target: Locator) => {
      const [b, bb, fb] = [await target.boundingBox(), await body.boundingBox(), await footer.boundingBox()];
      expect(b, what).not.toBeNull();
      expect(b!.y, `${what} below the body top`).toBeGreaterThanOrEqual(bb!.y - 1);
      expect(b!.y + b!.height, `${what} above the pinned footer`).toBeLessThanOrEqual(fb!.y + 1);
    };

    // ONE scroll of the ticket body (to the pager) shows the pinned value, the badges, the keypad.
    await page.getByTestId("pager-section").evaluate((el) => el.scrollIntoView({ block: "start" }));
    for (const [what, loc] of [
      ["pager input", pagerInput(page)],
      ["in-use badges", page.getByTestId("pagers-in-use")],
      ["keypad 5", page.getByTestId("pager-key-5")],
      ["keypad 0", page.getByTestId("pager-key-0")],
      ["Siguiente libre", page.getByTestId("pager-next-free")],
    ] as const) await insideBody(what, loc);

    // Scrolling through the keypad keeps the typed value pinned in view.
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await typePager(page, "5");
    await insideBody("pinned pager input at the bottom", pagerInput(page));
    await insideBody("in-use badges at the bottom", page.getByTestId("pagers-in-use"));
    await insideBody("keypad 0 at the bottom", page.getByTestId("pager-key-0"));

    // Payment buttons: one scroll as well.
    for (const id of ["pay-cash", "pay-transfer"]) {
      await page.getByTestId(id).scrollIntoViewIfNeeded();
      await insideBody(id, page.getByTestId(id));
    }
    await page.getByTestId("pay-cash").click();
    await page.getByTestId("quick-amount").last().click();
    await expect(chargeButton(page)).toBeEnabled();
    await expectTargets(chargeButton(page), 56, 200);
    const fb = await footer.boundingBox();
    const cb = await chargeButton(page).boundingBox();
    expect(cb!.y + cb!.height).toBeLessThanOrEqual(768);
    expect(cb!.y).toBeGreaterThanOrEqual(fb!.y);
    await page.getByTestId("pager-section").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await insideBody("pager input with the cash block open", pagerInput(page));
    await shot(page, "pos-laptop-cash-pager-1366x768");
  });
});

// The "Productos faltantes de stock" strip is an expected feature: with it shown the POS must still fit without page scroll.
test.describe("with the stock shortage strip shown", () => {
  const SHORT = "E2E Layout faltante";
  const cleanStrip = () => deleteStockItem(SHORT);
  test.afterEach(cleanStrip);

  for (const size of SIZES.filter((z) => z.w >= 1024)) {
    test.describe(`${size.name}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });

      test(`the POS still fits the viewport at ${size.w}px`, async ({ page }) => {
        await cleanStrip();
        const [short] = await db().insert(s.stockItems).values({ name: SHORT, kind: "materia_prima", unit: "kg", minQty: 10000, quantity: 1000 }).returning();
        await db().insert(s.stockMovements).values({ itemId: short.id, kind: "ajuste_inicial", qtyDelta: 1000, businessDate: sql`current_date` });
        await openPos(page);
        await expect(page.getByTestId("stock-alert")).toBeVisible();
        expect(await noHorizontalOverflow(page)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
      });
    });
  }
});

// The "pedidos de la app por aprobar" strip: with it shown (alone or with the stock strip) the POS must still fit,
// so the charge button never drops below the fold while an app order waits.
test.describe("with the pending app orders strip shown", () => {
  const SHORT = "E2E Layout faltante banner";
  test.beforeEach(parkPendingOrders);
  test.afterEach(async () => {
    await deleteStockItem(SHORT);
    await parkPendingOrders();
  });

  for (const size of SIZES.filter((z) => z.w >= 1024)) {
    test.describe(`${size.name}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });

      test(`the POS still fits with the pending strip at ${size.w}px`, async ({ page }) => {
        await placeRetiroOrder({ paymentMethod: "cash" });
        await openPos(page);
        await expect(page.getByTestId("pending-app-banner")).toBeVisible();
        expect(await noHorizontalOverflow(page)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
      });

      test(`the POS still fits with both strips at ${size.w}px`, async ({ page }) => {
        await placeRetiroOrder({ paymentMethod: "cash" });
        const [short] = await db().insert(s.stockItems).values({ name: SHORT, kind: "materia_prima", unit: "kg", minQty: 10000, quantity: 1000 }).returning();
        await db().insert(s.stockMovements).values({ itemId: short.id, kind: "ajuste_inicial", qtyDelta: 1000, businessDate: sql`current_date` });
        await openPos(page);
        await expect(page.getByTestId("pending-app-banner")).toBeVisible();
        await expect(page.getByTestId("stock-alert")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
      });
    });
  }
});
