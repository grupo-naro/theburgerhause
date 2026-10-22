import { expect, test } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { currentSettings, ordersOf, setOrderStatusInDb } from "./helpers/db";
import { choosePayment, fillCustomer, fillDelivery, noHorizontalOverflow, storedCart, submitButton, unique, uniquePhone } from "./helpers/checkout";
import { shot } from "./helpers/shots";
import { addProduct, cartCount, gotoStore, orderBar } from "./helpers/store";
import { currentStep, expectGreenContrast, expectWhatsappBelowTimeline, headline, openTracking, placeOrderInDb, steps } from "./helpers/tracking";

// Public page: no session.
test.use({ storageState: { cookies: [], origins: [] } });

// Seed prices (centavos).
const RANCHITA = 850000;
const MELT = 880000;

const TOKEN_URL = /\/pedido\/[0-9a-f]{32}(\?nuevo=1)?$/;
const UNKNOWN = "f".repeat(32);

test("checkout lands on the tracking page: number, welcome headline, grouped summary, timeline at Recibido, transfer data", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const settings = await currentSettings();
  const name = unique("Seguimiento");
  const phone = uniquePhone();

  await gotoStore(page);
  await addProduct(page, "Ranchita simple", ["Sin cheddar"]);
  await addProduct(page, "Ranchita simple");
  await addProduct(page, "Ranchita simple");
  await addProduct(page, "Melt simple");
  await expect(cartCount(page)).toHaveText("4");
  await orderBar(page).click();
  await page.getByTestId("cart-continue").click();
  await expect(submitButton(page)).toBeVisible();
  await fillDelivery(page, { address: "Av. Rivadavia 1234, 3B", crossStreets: "Mitre y Sarmiento", notes: "Timbre roto, tocar fuerte" });
  await fillCustomer(page, name, phone);
  await choosePayment(page, "transfer");
  await submitButton(page).click();
  await expect(page).toHaveURL(TOKEN_URL);

  const [order] = await ordersOf(name);
  const subtotal = 3 * RANCHITA + MELT;

  // Number, welcome headline and the timeline at "Recibido".
  await expect(page.getByTestId("order-number")).toHaveText(`#${order.number}`);
  await expect(headline(page)).toHaveText("¡Recibimos tu pedido!");
  await expect(page.getByTestId("status-hint")).toHaveText("Estamos verificando tu pago");
  await expect(steps(page)).toHaveText(["Recibido", "Listo", "En camino", "Entregado"].map((l) => new RegExp(l)));
  await expect(steps(page)).toHaveCount(4);
  await expect(page.getByText("En preparación")).toHaveCount(0); // headline says "preparando"; no timeline step of that name
  await expectWhatsappBelowTimeline(page);
  await expect(currentStep(page)).toHaveCount(1);
  await expect(currentStep(page)).toContainText("Recibido");

  // The cart is gone (checkout cleared it before landing here).
  await expect(cartCount(page)).toHaveCount(0);
  expect((await storedCart(page))?.lines ?? []).toHaveLength(0);

  // Grouped summary with totals from the seed prices.
  const lines = page.getByTestId("order-line");
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText("1× Ranchita simple");
  await expect(lines.nth(0)).toContainText("Sin cheddar");
  await expect(lines.nth(0)).toContainText(formatARS(RANCHITA));
  await expect(lines.nth(1)).toContainText("2× Ranchita simple");
  await expect(lines.nth(1)).toContainText(formatARS(2 * RANCHITA));
  await expect(lines.nth(2)).toContainText("1× Melt simple");
  await expect(page.getByTestId("order-subtotal")).toHaveText(formatARS(subtotal));
  await expect(page.getByTestId("order-delivery-fee")).toHaveText(formatARS(settings.deliveryFee));
  await expect(page.getByTestId("order-total")).toHaveText(formatARS(subtotal + settings.deliveryFee));
  await expect(page.getByTestId("delivery-address")).toContainText("Av. Rivadavia 1234, 3B");

  // Payment block for a transfer: the account, with the copy affordance of checkout.
  await expect(page.getByTestId("transfer-details")).toBeVisible();
  await expect(page.getByTestId("bank-alias")).toHaveText(settings.bankAlias);
  await expect(page.getByTestId("bank-cbu")).toHaveText(settings.bankCbu);
  await page.getByTestId("bank-alias-copy").click();
  await expect(page.getByTestId("bank-alias-copy")).toHaveText("¡Copiado!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(settings.bankAlias);

  // WhatsApp to the store with the order number prefilled; way back to the menu.
  await expect(page.getByTestId("whatsapp-button")).toHaveAttribute(
    "href",
    `https://wa.me/${settings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola! Consulto por mi pedido #${order.number}`)}`,
  );
  await expect(page.getByTestId("back-to-menu")).toHaveAttribute("href", "/");

  // The privacy of the page: nothing the customer typed beyond the address line.
  const html = await page.content();
  for (const secret of [phone.replace(/\D/g, ""), "Mitre y Sarmiento", "Timbre roto"]) expect(html).not.toContain(secret);
  await shot(page, "tracking-confirmation-desktop");
});

test("payment block per method: cash and verified payment", async ({ page }) => {
  const cash = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "cash" });
  await openTracking(page, `/pedido/${cash.token}`);
  await expect(page.getByTestId("payment-cash")).toContainText("Pagás en efectivo al recibir tu pedido");
  await expect(page.getByTestId("payment-cash")).toContainText(formatARS(cash.total));
  await expect(page.getByTestId("transfer-details")).toHaveCount(0);
  await expect(page.getByTestId("status-hint")).toHaveText("Un cajero va a confirmar tu pedido");
  await expect(headline(page)).toHaveText("Recibimos tu pedido"); // no ?nuevo: not the first render

  const transfer = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "transfer" });
  await setOrderStatusInDb(transfer.token, "en_preparacion", "paid");
  await openTracking(page, `/pedido/${transfer.token}`);
  await expect(page.getByTestId("payment-verified")).toHaveText("Pago verificado");
  await expect(page.getByTestId("transfer-details")).toHaveCount(0);
  await expect(page.getByTestId("bank-alias")).toHaveCount(0);
});

test("live updates: the timeline follows the order without reloading, and stops at entregado", async ({ page }) => {
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "cash" });
  const statusCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/api/pedido/${order.token}/status`)) statusCalls.push(r.url());
  });
  let documentLoads = 0;
  page.on("request", (r) => {
    if (r.resourceType() === "document") documentLoads += 1;
  });

  await page.clock.install();
  await openTracking(page, `/pedido/${order.token}`);
  await expect(currentStep(page)).toContainText("Recibido");
  expect(documentLoads).toBe(1);

  const stages = [
    { status: "en_preparacion", step: "Listo", headline: "Estamos preparando tu pedido" },
    { status: "listo_despacho", step: "Listo", headline: "Tu pedido está listo" },
    { status: "en_camino", step: "En camino", headline: "Tu pedido está en camino" },
  ] as const;
  for (const stage of stages) {
    await setOrderStatusInDb(order.token, stage.status);
    // Each attempt jumps the fake clock past the poll interval; retried until the poller is armed and the refresh landed.
    await expect(async () => {
      await page.clock.fastForward(8_000);
      await expect(headline(page)).toHaveText(stage.headline, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(currentStep(page)).toHaveText(new RegExp(stage.step));
    await expect(currentStep(page)).toHaveCount(1);
  }
  expect(documentLoads).toBe(1); // updated in place: no navigation, no reload

  // Terminal: the page shows it and the poller stops for good.
  await setOrderStatusInDb(order.token, "entregado");
  await expect(async () => {
    await page.clock.fastForward(8_000);
    await expect(headline(page)).toHaveText("¡Buen provecho!", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator('[data-testid="timeline-step"][data-state="done"]')).toHaveCount(4);
  await expect(currentStep(page)).toHaveCount(0);

  const callsAtTheEnd = statusCalls.length;
  expect(callsAtTheEnd).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 3; i++) await page.clock.fastForward(60_000);
  await page.evaluate(() => undefined); // round trip: anything the fast-forward triggered has been reported
  expect(statusCalls).toHaveLength(callsAtTheEnd);
});

test("a cancelled order shows the cancelled card with contact buttons and no timeline", async ({ page }) => {
  const settings = await currentSettings();
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "transfer" });
  await setOrderStatusInDb(order.token, "cancelado");
  await openTracking(page, `/pedido/${order.token}`);
  const card = page.getByTestId("cancelled-card");
  await expect(card).toBeVisible();
  await expect(headline(page)).toHaveText("Tu pedido fue cancelado");
  await expect(card.getByTestId("whatsapp-button")).toBeVisible();
  await expect(page.getByTestId("whatsapp-button")).toHaveCount(1);
  await expectGreenContrast(page);
  await expect(card.getByTestId("phone-button")).toHaveAttribute("href", `tel:+${settings.storePhone.replace(/\D/g, "")}`);
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  await expect(page.getByTestId("payment-block")).toHaveCount(0);
  await expect(page.getByTestId("order-summary")).toBeVisible(); // what was ordered stays visible
  await shot(page, "tracking-cancelled-desktop");
});

test("a takeaway order shows the pickup block and Para retirar instead of En camino", async ({ page }) => {
  const settings = await currentSettings();
  const order = await placeOrderInDb({ fulfillment: "takeaway", paymentMethod: "cash", units: "single" });
  await setOrderStatusInDb(order.token, "para_retirar");
  await openTracking(page, `/pedido/${order.token}`);

  await expect(steps(page)).toHaveText(["Recibido", "Listo", "Para retirar", "Entregado"].map((l) => new RegExp(l)));
  await expect(steps(page)).toHaveCount(4);
  await expectWhatsappBelowTimeline(page);
  await expect(page.getByText("En camino")).toHaveCount(0);
  await expect(currentStep(page)).toContainText("Para retirar");
  await expect(headline(page)).toHaveText("Tu pedido te espera");
  await expect(page.getByTestId("pickup-info")).toBeVisible();
  await expect(page.getByTestId("pickup-address")).toContainText(settings.storeAddress);
  await expect(page.getByTestId("pickup-info")).toContainText(settings.openingHoursText.split("\n")[0]);
  await expect(page.getByTestId("delivery-address")).toHaveCount(0);
  await expect(page.getByTestId("order-delivery-fee")).toHaveCount(0);
  await expect(page.getByTestId("payment-cash")).toContainText("al retirar");
  await expect(page.getByTestId("order-total")).toHaveText(formatARS(RANCHITA));
  await shot(page, "tracking-takeaway-desktop");
});

test("unknown and malformed tokens are the same 404, with private headers and no PII", async ({ page, request }) => {
  const known = await placeOrderInDb({});
  const seen: { status: number; headers: Record<string, string> }[] = [];
  for (const token of [UNKNOWN, "abc", known.token.toUpperCase(), `${known.token}0`]) {
    const res = await openTracking(page, `/pedido/${token}`);
    seen.push({ status: res!.status(), headers: res!.headers() });
    await expect(page.getByRole("heading", { name: "No encontramos esa página" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a la carta" })).toBeVisible();
    await expect(page.locator(`meta[name="robots"][content*="noindex"]`).first()).toBeAttached();
    await expect(page.getByTestId("order-number")).toHaveCount(0);
    const html = await page.content();
    for (const secret of [known.name, known.surname, known.whatsappDigits, known.crossStreets, known.notes]) expect(html).not.toContain(secret);
  }
  // Streamed behind Suspense inside the shared layout, so the status line is already sent (200): the 404 view carries noindex instead.
  expect(new Set(seen.map((s) => s.status)).size).toBe(1); // identical answer for every kind of bad token
  for (const { headers } of seen) {
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["set-cookie"]).toBeUndefined();
  }
  await openTracking(page, `/pedido/${UNKNOWN}`);
  await shot(page, "tracking-404-desktop");

  // The polling endpoint answers like it: uniform 404, nothing cached.
  for (const token of [UNKNOWN, "abc"]) {
    const res = await request.get(`/api/pedido/${token}/status`);
    expect(res.status()).toBe(404);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["set-cookie"]).toBeUndefined();
  }
});

test("a real order's page and status endpoint are private: headers, no cookies, three fields", async ({ page, request }) => {
  const order = await placeOrderInDb({ paymentMethod: "transfer" });
  const res = await openTracking(page, `/pedido/${order.token}`);
  const headers = res!.headers();
  expect(res!.status()).toBe(200);
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["set-cookie"]).toBeUndefined();
  await expect(page.locator(`meta[name="robots"][content*="noindex"]`).first()).toBeAttached();
  await expect(page).toHaveTitle("Tu pedido — The Burger House 828");
  expect(await page.context().cookies()).toEqual([]);

  const status = await request.get(`/api/pedido/${order.token}/status`);
  expect(status.status()).toBe(200);
  expect(status.headers()["cache-control"]).toBe("no-store");
  expect(status.headers()["set-cookie"]).toBeUndefined();
  const body = await status.json();
  expect(Object.keys(body).sort()).toEqual(["paymentStatus", "status", "updatedAt"]);
  expect(body).toMatchObject({ status: "pendiente_aprobacion", paymentStatus: "pending" });
});

test("privacy: the HTML never contains the whatsapp, surname, cross streets, notes or idempotency key", async ({ page, request }) => {
  const order = await placeOrderInDb({ fulfillment: "delivery", paymentMethod: "transfer" });
  // Raw server response (document + the RSC payload inlined in it)...
  const raw = await (await request.get(`/pedido/${order.token}`)).text();
  // ...and the hydrated DOM, including after a status refresh.
  await openTracking(page, `/pedido/${order.token}`);
  await expect(page.getByTestId("order-number")).toHaveText(`#${order.number}`);
  const dom = await page.content();
  const secrets = [order.whatsappDigits, order.surname, order.name, order.crossStreets, order.notes, order.idempotencyKey];
  for (const secret of secrets) {
    expect(raw, `raw html leaks ${secret}`).not.toContain(secret);
    expect(dom, `dom leaks ${secret}`).not.toContain(secret);
  }
  expect(raw).toContain("Lucía"); // only the first name
  expect(raw).not.toMatch(/idempotency|crossStreets|addressNotes|approvedBy|whatsapp"/i);
});

test("the store link back to the menu works", async ({ page }) => {
  const order = await placeOrderInDb({ units: "single" });
  await openTracking(page, `/pedido/${order.token}`);
  await page.getByTestId("back-to-menu").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("product-card").first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
