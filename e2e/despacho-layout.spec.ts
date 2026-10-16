import { expect, test, type Locator } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers/checkout";
import {
  cleanBoard,
  dcard,
  lane,
  openDespacho,
  populateBoard,
  placeReady,
  tag,
  type Populated,
} from "./helpers/despacho";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("encargada") });
test.afterAll(cleanBoard);

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
  await page.clock.fastForward("06:00");
  await expect(badge).toHaveAttribute("data-urgency", "urgent");
  await expect(badge).toContainText("Urgente");
});

