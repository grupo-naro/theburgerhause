import { expect, test, type Locator } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { setOrderStatusInDb } from "./helpers/db";
import { noHorizontalOverflow } from "./helpers/checkout";
import { shot } from "./helpers/shots";
import { currentStep, expectGreenContrast, expectWhatsappBelowTimeline, headline, openTracking, placeOrderInDb, steps } from "./helpers/tracking";

// Public page: no session.
test.use({ storageState: { cookies: [], origins: [] } });

/** Every match must be at least 44px tall. */
async function expectTall(locator: Locator, label: string) {
  const count = await locator.count();
  expect(count, `${label}: matches`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    expect(box, `${label} ${i} has a box`).not.toBeNull();
    expect(box!.height, `${label} ${i} height`).toBeGreaterThanOrEqual(44);
  }
}

test("tracking fits a 360px phone: no overflow, readable timeline and summary, big targets @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 740 });
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "transfer" });
  await openTracking(page, `/pedido/${order.token}?nuevo=1`);

  await expect(headline(page)).toHaveText("¡Recibimos tu pedido!");
  await expect(page.getByTestId("order-number")).toHaveText(`#${order.number}`);
  expect(await noHorizontalOverflow(page)).toBe(true);

  // Timeline and summary are fully inside the viewport width.
  for (const locator of [steps(page).first(), steps(page).last(), page.getByTestId("order-summary"), page.getByTestId("transfer-details")]) {
    const box = await locator.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  await expect(page.getByTestId("order-total")).toHaveText(formatARS(order.total));
  await expect(steps(page)).toHaveCount(4);
  await expectWhatsappBelowTimeline(page);
  await expectGreenContrast(page);

  // Tap targets.
  await expectTall(page.getByTestId("whatsapp-button"), "whatsapp");
  await expectTall(page.getByTestId("back-to-menu"), "back to menu");
  await expectTall(page.getByTestId("bank-alias-copy").or(page.getByTestId("bank-cbu-copy")), "copy");
  await shot(page, "tracking-confirmation-mobile");
});

test("tracking has no horizontal overflow at 390px and the WhatsApp button spans the card @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 780 });
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "cash" });
  await openTracking(page, `/pedido/${order.token}`);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await expectWhatsappBelowTimeline(page);
  const box = (await page.getByTestId("whatsapp-button").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.width).toBeGreaterThan(250);
});

test("every stage of the delivery timeline on a phone @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 740 });
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "cash" });

  const stages = [
    { status: "pendiente_aprobacion", step: "Recibido", name: "recibido" },
    { status: "en_preparacion", step: "Listo", name: "preparacion" },
    { status: "listo_despacho", step: "Listo", name: "listo" },
    { status: "en_camino", step: "En camino", name: "camino" },
    { status: "entregado", step: null, name: "entregado" },
  ] as const;
  for (const stage of stages) {
    if (stage.status !== "pendiente_aprobacion") await setOrderStatusInDb(order.token, stage.status);
    await openTracking(page, `/pedido/${order.token}`);
    await expect(page.getByTestId("tracking")).toHaveAttribute("data-status", stage.status);
    if (stage.step) await expect(currentStep(page)).toContainText(stage.step);
    else await expect(page.locator('[data-testid="timeline-step"][data-state="done"]')).toHaveCount(4);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, `tracking-stage-${stage.name}-mobile`);
  }
});

test("takeaway, cancelled and 404 screens on a phone @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 740 });

  const takeaway = await placeOrderInDb({ fulfillment: "takeaway", paymentMethod: "cash", units: "single" });
  await setOrderStatusInDb(takeaway.token, "para_retirar");
  await openTracking(page, `/pedido/${takeaway.token}`);
  await expect(currentStep(page)).toContainText("Para retirar");
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "tracking-takeaway-mobile");

  const cancelled = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "cash" });
  await setOrderStatusInDb(cancelled.token, "cancelado");
  await openTracking(page, `/pedido/${cancelled.token}`);
  await expect(page.getByTestId("cancelled-card")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await expectTall(page.getByTestId("whatsapp-button").or(page.getByTestId("phone-button")).or(page.getByTestId("back-to-menu")), "cancelled contact");
  await shot(page, "tracking-cancelled-mobile");

  await openTracking(page, `/pedido/${"e".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "No encontramos esa página" })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "tracking-404-mobile");
});
