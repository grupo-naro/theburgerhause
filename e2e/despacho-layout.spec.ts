import { expect, test, type Locator } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers/checkout";
import {
  cleanBoard,
  dcard,
  lane,
  openDespacho,
  populateBoard,
  placeReady,
  assignInDb,
  ensureCadet,
  routeOrder,
  setStatusClock,
  tag,
  runCleanups,
  type Populated,
} from "./helpers/despacho";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("encargada") });
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

const SIZES = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "768", width: 768, height: 1024 },
] as const;

async function expectTarget(locator: Locator, what: string) {
  const box = await locator.first().boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(47.5);
  expect(box!.width, `${what} width`).toBeGreaterThanOrEqual(47.5);
}

test("layout: every lane populated at 1280 / 1024 / 768, no overflow, big targets, bar clearance", async ({ page }) => {
  const data: Populated = await populateBoard(tag());
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openDespacho(page);
    expect(await noHorizontalOverflow(page), `overflow at ${size.name}`).toBe(true);
    await expect(page.getByTestId("lane-preparing-count")).toHaveText("2");
    await expect(page.getByTestId("lane-ready-delivery-count")).toHaveText("3");
    await expect(page.getByTestId("lane-ready-counter-count")).toHaveText("2");
    await expect(page.getByTestId("lane-pickup-count")).toHaveText("2");
    await expect(lane(page, "enroute").getByTestId("route-order")).toHaveCount(2);
    await shot(page, `despacho-board-${size.name}`);

    await expectTarget(page.getByTestId("mark-ready"), "Listo");
    await expectTarget(page.getByTestId("select-order"), "checkbox");
    await expectTarget(page.getByTestId("call-pickup"), "Llamar");
    await expectTarget(lane(page, "pickup").getByTestId("deliver"), "Entregado (retiro)");
    await expectTarget(lane(page, "enroute").getByTestId("deliver"), "Entregado (ruta)");
    await expectTarget(lane(page, "enroute").getByTestId("return-order"), "No se pudo entregar");
    await expectTarget(page.getByTestId("render-link"), "Rendir");
    await expectTarget(page.locator('a[href^="tel:"]'), "telefono del cadete");

    await page.getByTestId("select-all").click();
    await expectTarget(page.getByTestId("assign-button"), "Asignar");
    await expectTarget(page.getByTestId("cadet-select"), "selector de cadete");
    await page.getByTestId("cadet-select").selectOption(String(data.cadet.id));
    expect(await noHorizontalOverflow(page), `overflow with the bar at ${size.name}`).toBe(true);
    await shotViewport(page, `despacho-bar-${size.name}`);

    // The bar never covers the last card: scrolled to the end, the lane content ends above it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const barTop = (await page.getByTestId("assign-bar").boundingBox())!.y;
    const last = await lane(page, "enroute").locator("[data-testid=route-order]").last().boundingBox();
    expect(last!.y + last!.height, `bar clearance at ${size.name}`).toBeLessThanOrEqual(barTop + 0.5);
  }
});

test("urgency: time turns the ready card amber, then red, with the word", async ({ page }) => {
  await cleanBoard();
  const o = await placeReady({ paymentMethod: "cash" });
  await page.clock.install({ time: new Date() });
  await openDespacho(page);
  const badge = dcard(page, o.number).getByTestId("elapsed");
  await expect(badge).toHaveAttribute("data-urgency", "normal");
  await page.clock.fastForward("06:00");
  await expect(badge).toHaveAttribute("data-urgency", "warning");
  await expect(badge).toContainText("Demora");
  await page.clock.fastForward("05:00");
  await expect(badge).toHaveAttribute("data-urgency", "urgent");
  await expect(badge).toContainText("Urgente");
});


const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

test("the lane clock counts from when the order became ready, not from its creation", async ({ page }) => {
  await cleanBoard();
  const lateReady = await placeReady({ paymentMethod: "cash" });
  const oldButJustReady = await placeReady({ paymentMethod: "cash" });
  // 6 min ready (amber) although only 8 min old; 1 min ready (normal) although 40 min old.
  await setStatusClock(lateReady.id, "listo_despacho", minutesAgo(6), minutesAgo(8));
  await setStatusClock(oldButJustReady.id, "listo_despacho", minutesAgo(1), minutesAgo(40));
  await openDespacho(page);
  const amber = dcard(page, lateReady.number);
  await expect(amber.getByTestId("elapsed")).toHaveAttribute("data-urgency", "warning");
  await expect(amber.getByTestId("elapsed")).toContainText("Demora");
  await expect(amber.getByTestId("elapsed")).toContainText("Listo hace 6 min");
  await expect(amber.getByTestId("order-age")).toHaveText("Pedido hace 8 min");
  const calm = dcard(page, oldButJustReady.number);
  await expect(calm.getByTestId("elapsed")).toHaveAttribute("data-urgency", "normal");
  await expect(calm.getByTestId("order-age")).toHaveText("Pedido hace 40 min");
});

test("an order out for 31 minutes is amber, at 46 minutes red, counted from the assignment", async ({ page }) => {
  await cleanBoard();
  const cadet = await ensureCadet(`Ruta ${tag()}`);
  const o = await placeReady({ paymentMethod: "cash" });
  await assignInDb([o.id], cadet.id);
  await setStatusClock(o.id, "en_camino", minutesAgo(0), minutesAgo(50));
  await page.clock.install({ time: new Date() });
  await openDespacho(page);
  const badge = routeOrder(page, o.number).getByTestId("elapsed");
  await expect(badge).toHaveAttribute("data-urgency", "normal");
  await expect(badge).toContainText("En camino");
  await page.clock.fastForward("31:00");
  await expect(badge).toHaveAttribute("data-urgency", "warning");
  await expect(badge).toContainText("Demora");
  await expect(badge).toContainText("En camino hace 31 min");
  await page.clock.fastForward("15:00");
  await expect(badge).toHaveAttribute("data-urgency", "urgent");
  await expect(badge).toContainText("Urgente");
  // The cadet card header shows the oldest order clock too.
  await expect(page.getByTestId("route-oldest").getByTestId("elapsed")).toHaveAttribute("data-urgency", "urgent");
});
