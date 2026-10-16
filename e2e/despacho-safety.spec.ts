import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { countEventSources, orderById } from "./helpers/caja";
import { db } from "./helpers/db";
import {
  assignInDb,
  cleanBoard,
  dcard,
  ensureCadet,
  lane,
  onCleanup,
  openDespacho,
  pingOrders,
  placeApproved,
  placeReady,
  readyInDb,
  tag,
  runCleanups,
  setCadetActive,
} from "./helpers/despacho";
import { shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("encargada") });
test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

async function secondUser(browser: Browser, who: "admin" | "encargada", offline = false): Promise<Page> {
  const context = await browser.newContext({ storageState: authFile(who), viewport: { width: 1280, height: 800 } });
  // A frozen board: the live stream is cut so the page keeps showing what it saw first.
  onCleanup(() => context.close());
  if (offline) await context.route("**/api/events", (r) => r.abort());
  return context.newPage();
}

test("a stale board loses the race: the Spanish message lists the orders and the board refreshes", async ({ page, browser }) => {
  const c1 = await ensureCadet(`Uno ${tag()}`);
  const c2 = await ensureCadet(`Dos ${tag()}`);
  const a = await placeReady({ paymentMethod: "cash" });
  const b = await placeReady({ paymentMethod: "transfer" });

  const stale = await secondUser(browser, "admin", true);
  await stale.goto("/despacho");
  await expect(stale.getByTestId("dispatch-board")).toBeVisible();
  await dcardSelect(stale, a.number);
  await dcardSelect(stale, b.number);
  await stale.getByTestId("cadet-select").selectOption(String(c2.id));

  // The encargada wins first.
  await openDespacho(page);
  await page.getByTestId("select-all").click();
  await page.getByTestId("cadet-select").selectOption(String(c1.id));
  await page.getByTestId("assign-button").click();
  await expect(page.getByTestId("toast")).toContainText("2 pedidos en camino");

  await stale.getByTestId("assign-button").click();
  const error = stale.getByTestId("assign-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("No se asignó ningún pedido.");
  await expect(error.getByRole("listitem")).toHaveCount(2);
  await expect(error).toContainText(`#${a.number}:`);
  await expect(error).toContainText(`#${b.number}:`);
  await expect(error).toContainText("en camino");
  await shotViewport(stale, "despacho-assign-failure");
  // The refresh dropped both orders from the lane and from the selection.
  await expect(stale.getByTestId("lane-ready-delivery-empty")).toBeVisible();
  await expect(stale.getByTestId("assign-summary")).toHaveCount(0);

  expect((await orderById(a.id)).cadetId).toBe(c1.id);
  expect((await orderById(b.id)).cadetId).toBe(c1.id);
});

async function dcardSelect(page: Page, number: number) {
  await dcard(page, number).getByTestId("select-order").check();
}

test("two managers assign the same orders at the same time: exactly one wins, nobody sees a 500", async ({ page, browser }) => {
  const c1 = await ensureCadet(`Uno ${tag()}`);
  const c2 = await ensureCadet(`Dos ${tag()}`);
  const a = await placeReady({ paymentMethod: "cash" });
  const b = await placeReady({ paymentMethod: "cash" });
  const other = await secondUser(browser, "admin");
  await other.goto("/despacho");
  await expect(other.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
  await openDespacho(page);
  for (const p of [page, other]) {
    await p.getByTestId("select-all").click();
  }
  await page.getByTestId("cadet-select").selectOption(String(c1.id));
  await other.getByTestId("cadet-select").selectOption(String(c2.id));
  await Promise.all([
    page.getByTestId("assign-button").click({ timeout: 3000 }).catch(() => undefined),
    other.getByTestId("assign-button").click({ timeout: 3000 }).catch(() => undefined),
  ]);

  await expect.poll(async () => (await orderById(a.id)).status).toBe("en_camino");
  const ra = await orderById(a.id);
  const rb = await orderById(b.id);
  expect(rb.cadetId).toBe(ra.cadetId);
  expect([c1.id, c2.id]).toContain(ra.cadetId);
  const assigned = await db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, a.id));
  expect(assigned.filter((e) => e.toStatus === "en_camino")).toHaveLength(1);
  for (const p of [page, other]) {
    await expect(p.getByText("Application error")).toHaveCount(0);
    await expect(p.getByTestId("lane-ready-delivery-empty")).toBeVisible();
  }
});

test("an inactive cadet never shows in the selector and cannot be assigned", async ({ page }) => {
  const live = await ensureCadet(`Activo ${tag()}`);
  const gone = await ensureCadet(`Baja ${tag()}`);
  const o = await placeReady({ paymentMethod: "cash" });
  await openDespacho(page);
  await dcard(page, o.number).getByTestId("select-order").check();
  const select = page.getByTestId("cadet-select");
  await expect(select.locator(`option[value="${gone.id}"]`)).toHaveCount(1);
  await select.selectOption(String(gone.id));

  await setCadetActive(gone.id, false);
  // Deactivated behind the screen's back, then the board refreshes: the choice is gone.
  await pingOrders(o.id);
  await expect(select.locator(`option[value="${gone.id}"]`)).toHaveCount(0);
  await expect(select).toHaveValue("");
  await expect(page.getByTestId("assign-button")).toBeDisabled();
  await expect(select.locator(`option[value="${live.id}"]`)).toHaveCount(1);
});

test("an inactive cadet chosen on a stale screen is refused with a message", async ({ browser }) => {
  const gone = await ensureCadet(`Baja ${tag()}`);
  const o = await placeReady({ paymentMethod: "cash" });
  const stale = await secondUser(browser, "encargada", true);
  await stale.goto("/despacho");
  await dcardSelect(stale, o.number);
  await stale.getByTestId("cadet-select").selectOption(String(gone.id));
  await setCadetActive(gone.id, false);
  await stale.getByTestId("assign-button").click();
  await expect(stale.getByTestId("assign-error")).toContainText(`El cadete ${gone.name} está inactivo`);
  expect((await orderById(o.id)).status).toBe("listo_despacho");
});

test("double click on Asignar sends ONE assignment", async ({ page }) => {
  const c = await ensureCadet(`Doble ${tag()}`);
  const a = await placeReady({ paymentMethod: "cash" });
  const b = await placeReady({ paymentMethod: "transfer" });
  await openDespacho(page);
  await page.getByTestId("select-all").click();
  await page.getByTestId("cadet-select").selectOption(String(c.id));
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) posts++;
  });
  await page.getByTestId("assign-button").dblclick();
  await expect(page.getByTestId("toast")).toContainText("2 pedidos en camino");
  expect(posts).toBe(1);
  for (const o of [a, b]) {
    const ev = await db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id));
    expect(ev.filter((e) => e.toStatus === "en_camino")).toHaveLength(1);
  }
});

test("live updates: the board follows the database with one EventSource, counters and title included", async ({ page, context }) => {
  const sources = countEventSources(context);
  await openDespacho(page);
  await expect(page).toHaveTitle("Despacho");
  const o = await placeApproved({ paymentMethod: "cash" });
  const inPrep = lane(page, "preparing").locator(`[data-order-number="${o.number}"]`);
  await expect(inPrep).toBeVisible();
  await expect(page.getByTestId("counter-preparing-n")).toHaveText("1");

  await readyInDb(o.id);
  await expect(lane(page, "ready-delivery").locator(`[data-order-number="${o.number}"]`)).toBeVisible();
  await expect(lane(page, "ready-delivery").locator(`[data-order-number="${o.number}"]`)).toHaveAttribute("data-fresh", "true");
  await expect(page.getByTestId("despacho-announcer")).toHaveText(`Pedido #${o.number} listo para despachar`);
  await expect(page.getByTestId("counter-preparing-n")).toHaveText("0");
  await expect(page.getByTestId("counter-ready-n")).toHaveText("1");
  await expect(page).toHaveTitle("(1) Despacho");

  const c = await ensureCadet(`Live ${tag()}`);
  await assignInDb([o.id], c.id);
  await expect(page.getByTestId("counter-enRoute-n")).toHaveText("1");
  await expect(page).toHaveTitle("Despacho");
  expect(sources.count()).toBe(1);
});
