import { expect, test } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import {
  countOrdersOf,
  currentSettings,
  eventsOfOrder,
  findProduct,
  itemsOfOrder,
  ordersOf,
  setAcceptingOrders,
  setProductActiveInDb,
} from "./helpers/db";
import {
  CUSTOMER_KEY,
  chooseFulfillment,
  choosePayment,
  fillCustomer,
  fillDelivery,
  fillValidDelivery,
  gotoCheckout,
  storedCart,
  storedKey,
  submitButton,
  unique,
  uniquePhone,
} from "./helpers/checkout";
import { shot } from "./helpers/shots";
import {
  addProduct,
  cartCount,
  gotoStore,
  orderBar,
  seedCart,
  setProductActive,
  withAdmin,
} from "./helpers/store";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

// Seed prices (centavos).
const RANCHITA = 850000;
const MELT = 880000;
const DIPS = 120000;

const ORDER_URL = /\/pedido\/[0-9a-f]{32}$/;

test("full happy path: delivery paid by transfer creates exactly the right order", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const settings = await currentSettings();
  const name = unique("Happy");
  const phone = uniquePhone();

  // Two Ranchita with DIFFERENT modifications + another product, through the real UI.
  await gotoStore(page);
  await addProduct(page, "Ranchita simple", ["Sin cheddar"]);
  await addProduct(page, "Ranchita simple", ["+ Dips de cheddar"]);
  await addProduct(page, "Melt simple");
  await expect(cartCount(page)).toHaveText("3");
  await orderBar(page).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await page.getByTestId("cart-continue").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(submitButton(page)).toBeVisible();

  // Summary: three different units, totals from the domain pricing with the delivery fee.
  const subtotal = 2 * RANCHITA + DIPS + MELT;
  await expect(page.getByTestId("summary-line")).toHaveCount(3);
  await expect(page.getByTestId("checkout-subtotal")).toHaveText(formatARS(subtotal));
  await expect(page.getByTestId("checkout-delivery-fee")).toHaveText(formatARS(settings.deliveryFee));
  await expect(page.getByTestId("checkout-total")).toHaveText(formatARS(subtotal + settings.deliveryFee));
  await expect(submitButton(page)).toHaveText(`Confirmar pedido · ${formatARS(subtotal + settings.deliveryFee)}`);
  await shot(page, "checkout-delivery-desktop");

  await fillDelivery(page, { address: "Av. Rivadavia 1234, 3B", crossStreets: "Mitre y Sarmiento", notes: "Timbre roto, tocar fuerte" });
  await fillCustomer(page, name, phone);

  // Transfer reveals the bank data and the copy buttons work.
  await expect(page.getByTestId("transfer-details")).toHaveCount(0);
  await choosePayment(page, "transfer");
  await expect(page.getByTestId("bank-alias")).toHaveText(settings.bankAlias);
  await expect(page.getByTestId("bank-cbu")).toHaveText(settings.bankCbu);
  await expect(page.getByText("Un cajero verificará tu pago antes de preparar el pedido")).toBeVisible();
  await page.getByTestId("bank-alias-copy").click();
  await expect(page.getByTestId("bank-alias-copy")).toHaveText("¡Copiado!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(settings.bankAlias);
  await page.getByTestId("bank-cbu-copy").click();
  await expect(page.getByTestId("bank-cbu-copy")).toHaveText("¡Copiado!");
  await expect(page.getByTestId("bank-alias-copy")).toHaveText("Copiar"); // only the last copied row confirms
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(settings.bankCbu);
  await shot(page, "checkout-transfer-desktop");

  await submitButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);

  // The cart is gone (badge and storage) and the customer is remembered.
  await expect(cartCount(page)).toHaveCount(0);
  expect((await storedCart(page))?.lines ?? []).toHaveLength(0);
  expect(await storedKey(page)).toBeNull(); // session key cleared
  expect(await page.evaluate((k) => localStorage.getItem(k), CUSTOMER_KEY)).toContain(name);

  // The order row, item snapshots and totals.
  const orders = await ordersOf(name);
  expect(orders).toHaveLength(1);
  const [order] = orders;
  expect(page.url()).toContain(order.publicToken);
  expect(order).toMatchObject({
    channel: "web",
    fulfillment: "delivery",
    status: "pendiente_aprobacion",
    paymentMethod: "transfer",
    paymentStatus: "pending",
    customerName: name,
    whatsapp: phone.replace(/\D/g, ""),
    address: "Av. Rivadavia 1234, 3B",
    crossStreets: "Mitre y Sarmiento",
    addressNotes: "Timbre roto, tocar fuerte",
    subtotal,
    deliveryFee: settings.deliveryFee,
    total: subtotal + settings.deliveryFee,
  });
  const items = await itemsOfOrder(order.id);
  expect(items.map((i) => i.nameSnapshot)).toEqual(["Ranchita simple", "Ranchita simple", "Melt simple"]);
  expect(items.map((i) => i.unitPriceSnapshot)).toEqual([RANCHITA, RANCHITA, MELT]);
  expect(items[0].modifiers.map((m) => m.nameSnapshot)).toEqual(["Sin cheddar"]);
  expect(items[1].modifiers.map((m) => [m.nameSnapshot, m.priceDelta])).toEqual([["+ Dips de cheddar", DIPS]]);
  expect(items[2].modifiers).toHaveLength(0);
  expect(await eventsOfOrder(order.id)).toHaveLength(1);
});

test("takeaway hides the address fields, shows the store and charges no delivery fee", async ({ page }) => {
  const settings = await currentSettings();
  const name = unique("Takeaway");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await expect(page.getByLabel("Dirección")).toBeVisible();
  await expect(page.getByTestId("checkout-delivery-fee")).toBeVisible();

  await chooseFulfillment(page, "takeaway");
  await expect(page.getByLabel("Dirección")).toHaveCount(0);
  await expect(page.getByLabel("Entre calles")).toHaveCount(0);
  await expect(page.getByTestId("takeaway-info")).toBeVisible();
  await expect(page.getByTestId("takeaway-address")).toContainText(settings.storeAddress);
  await expect(page.getByTestId("takeaway-address")).toHaveAttribute("href", /google\.com\/maps.*Siempreviva/);
  await expect(page.getByTestId("takeaway-info")).toContainText(settings.openingHoursText.split("\n")[0]);
  await expect(page.getByTestId("checkout-delivery-fee")).toHaveCount(0);
  await expect(page.getByTestId("checkout-total")).toHaveText(formatARS(RANCHITA));
  await expect(submitButton(page)).toHaveText(`Confirmar pedido · ${formatARS(RANCHITA)}`);
  await shot(page, "checkout-takeaway-desktop");

  await fillCustomer(page, name);
  await choosePayment(page, "cash");
  await expect(page.getByText("Pagás en efectivo al recibir o retirar el pedido")).toBeVisible();
  await submitButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);

  const [order] = await ordersOf(name);
  expect(order).toMatchObject({
    fulfillment: "takeaway",
    paymentMethod: "cash",
    address: null,
    crossStreets: null,
    addressNotes: null,
    subtotal: RANCHITA,
    deliveryFee: 0,
    total: RANCHITA,
  });
});

test("client-side validation blocks the submit and focuses the first invalid field", async ({ page }) => {
  const name = unique("Invalid");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();

  // Everything empty: the summary lists the problems and the first field of the page gets focus.
  await submitButton(page).click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByLabel("Dirección")).toBeFocused();
  await expect(page.getByLabel("Dirección")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#checkout-delivery-address-error")).toHaveText("Ingresá la dirección de entrega");
  await expect(page.getByLabel("Dirección")).toHaveAttribute("aria-describedby", "checkout-delivery-address-error");
  await shot(page, "checkout-errors-desktop");

  // Typing clears that field's error; the next invalid field (the name) gets focus.
  await fillDelivery(page);
  await expect(page.locator("#checkout-delivery-address-error")).toHaveCount(0);
  await submitButton(page).click();
  await expect(page.getByLabel("Nombre y apellido")).toBeFocused();
  await expect(page.locator("#checkout-customer-name-error")).toHaveText("Ingresá tu nombre");

  // A bad WhatsApp.
  await page.getByLabel("Nombre y apellido").fill(name);
  await page.getByLabel("WhatsApp").fill("abc");
  await submitButton(page).click();
  await expect(page.getByLabel("WhatsApp")).toBeFocused();
  await expect(page.locator("#checkout-customer-whatsapp-error")).toContainText("Ingresá un número de WhatsApp válido");

  // No payment method yet.
  await page.getByLabel("WhatsApp").fill(uniquePhone());
  await submitButton(page).click();
  await expect(page.locator("input[name=paymentMethod]").first()).toBeFocused();
  await expect(page.locator("#checkout-paymentMethod-error")).toHaveText("Elegí un medio de pago");

  expect(await countOrdersOf(name)).toBe(0);
  await expect(page).toHaveURL(/\/checkout$/);
});

test("a double submit creates ONE order and a lost response is retried with the same key", async ({ page }) => {
  const name = unique("Double");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();

  // An invalid attempt already fixes the idempotency key for this session; a reload keeps it.
  await submitButton(page).click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  const key = await storedKey(page);
  expect(key).toBeTruthy();
  await page.reload();
  await expect(submitButton(page)).toBeVisible();
  expect(await storedKey(page)).toBe(key);

  await fillValidDelivery(page, name);

  // The server creates the order but the answer is lost on the way back.
  let dropped = false;
  await page.route("**/checkout", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && !dropped) {
      dropped = true;
      await route.fetch(); // the action runs: the order IS created
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await submitButton(page).click();
  await expect(page.getByText("No pudimos conectarnos")).toBeVisible();
  await expect.poll(() => countOrdersOf(name)).toBe(1);
  await expect(page).toHaveURL(/\/checkout$/);
  // The key is bound to the form content: filling the form made a new key, which the lost attempt used.
  const sentKey = await storedKey(page);
  expect(sentKey).toBeTruthy();
  expect(sentKey).not.toBe(key);

  // Unchanged retry with a double click: same key -> the existing order, still ONE row.
  await submitButton(page).dblclick();
  await expect(page).toHaveURL(ORDER_URL);
  expect(await countOrdersOf(name)).toBe(1);
  const [order] = await ordersOf(name);
  expect(order.idempotencyKey).toBe(sentKey);
  expect(page.url()).toContain(order.publicToken);
});

test("editing the address after a lost response creates a NEW order with the new address", async ({ page }) => {
  const name = unique("Edited");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await fillValidDelivery(page, name);
  await fillDelivery(page, { address: "Calle Vieja 111" });

  let dropped = false;
  await page.route("**/checkout", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await submitButton(page).click();
  await expect(page.getByText("No pudimos conectarnos")).toBeVisible();
  await expect.poll(() => countOrdersOf(name)).toBe(1);
  const oldKey = await storedKey(page);

  // The customer corrects the address: this is a different order, not a replay of the old one.
  await fillDelivery(page, { address: "Calle Nueva 222" });
  await submitButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  const orders = await ordersOf(name);
  expect(orders).toHaveLength(2);
  expect(orders.map((o) => o.address)).toEqual(["Calle Vieja 111", "Calle Nueva 222"]);
  expect(orders[1].idempotencyKey).not.toBe(oldKey);
  expect(page.url()).toContain(orders[1].publicToken);
});

test("a form-filler that fills the honeypot cannot lock the customer out", async ({ page }) => {
  const name = unique("Honey");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await fillValidDelivery(page, name);

  const trap = page.locator('input[name="bh_ref"]');
  await expect(trap).toHaveAttribute("autocomplete", "off");
  await expect(trap).toHaveAttribute("tabindex", "-1");
  await trap.evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "http://filled-by-autofill");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submitButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Recargá la página y probá de nuevo." })).toBeVisible();
  expect(await countOrdersOf(name)).toBe(0);
  await shot(page, "checkout-honeypot-desktop");

  // The polluted value is cleared client-side: the very next attempt goes through, exactly one order.
  await expect(trap).toHaveValue("");
  await submitButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  expect(await countOrdersOf(name)).toBe(1);
});

test("when every product is gone the cart page explains it", async ({ page }) => {
  const name = unique("AllGone");
  const aro = await findProduct("Aro simple");
  await seedCart(page, [{ productId: aro.id }]);
  await gotoCheckout(page);
  await fillValidDelivery(page, name);
  try {
    await setProductActiveInDb("Aro simple", false);
    await submitButton(page).click();
    await expect(page).toHaveURL(/\/carrito$/);
    await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
    await expect(page.getByTestId("issues-banner")).toContainText("«Aro simple» ya no está disponible");
    expect(await countOrdersOf(name)).toBe(0);
  } finally {
    await setProductActiveInDb("Aro simple", true);
  }
});

test("rapid Enter presses in a field submit once", async ({ page }) => {
  const name = unique("Enter");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await fillValidDelivery(page, name);
  await page.getByLabel("Nombre y apellido").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(ORDER_URL);
  expect(await countOrdersOf(name)).toBe(1);
});

test("a closed store disables the submit with a notice", async ({ page }) => {
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }], "/");
  try {
    await setAcceptingOrders(false);
    await page.goto("/checkout");
    await expect(page.getByTestId("checkout-closed")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    await shot(page, "checkout-closed-desktop");
  } finally {
    await setAcceptingOrders(true);
  }
});

test("the server refuses when the store closes after the page loaded", async ({ page }) => {
  const name = unique("Closing");
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await fillValidDelivery(page, name);
  await expect(submitButton(page)).toBeEnabled(); // the optimistic UI still believes we are open
  try {
    await setAcceptingOrders(false);
    await submitButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Por el momento no estamos tomando pedidos" })).toBeVisible();
    expect(await countOrdersOf(name)).toBe(0);
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(submitButton(page)).toBeEnabled(); // retry is possible once we reopen
  } finally {
    await setAcceptingOrders(true);
  }
  await submitButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  expect(await countOrdersOf(name)).toBe(1);
});

test("a stale cart: the unavailable product is named, nothing is created, the cart explains the change", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const name = unique("Stale");
  const [aro, melt] = await Promise.all([findProduct("Aro simple"), findProduct("Melt simple")]);
  const headers = testInfo.project.use.extraHTTPHeaders;
  await seedCart(page, [{ productId: aro.id }, { productId: melt.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await fillValidDelivery(page, name);

  try {
    // An admin deactivates the product while this page is open (it is NOT reloaded).
    await withAdmin(browser, baseURL, headers, (admin) => setProductActive(admin, "Aro simple", false));
    // NOTE: no waiting for the public menu cache: the recovery must not depend on it.
    await submitButton(page).click();
    const banner = page.getByTestId("units-invalid-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Algunos productos ya no están disponibles");
    await expect(banner).toContainText("«Aro simple»");
    await expect(banner).toContainText("Quitamos de tu pedido");
    await expect(banner).not.toContainText("Melt simple");
    expect(await countOrdersOf(name)).toBe(0);
    // The dead unit is gone from the cart right away; the other one stays.
    await expect(cartCount(page)).toHaveText("1");
    await expect(page.getByTestId("summary-line")).toHaveCount(1);
    await expect(page.getByTestId("summary-line")).toContainText("Melt simple");
    await shot(page, "checkout-units-invalid-desktop");

    // The cart link works and the cart explains what changed.
    await page.getByTestId("units-invalid-cart-link").click();
    await expect(page).toHaveURL(/\/carrito$/);
    await expect(page.getByTestId("issues-banner")).toContainText("«Aro simple» ya no está disponible y se quitó de tu pedido");
    await expect(page.getByTestId("cart-line-name")).toHaveText(["Melt simple"]);

    // Back to checkout: the remaining item can be ordered, exactly once.
    await page.getByTestId("cart-continue").click();
    await expect(submitButton(page)).toBeVisible();
    await fillValidDelivery(page, name);
    await submitButton(page).click();
    await expect(page).toHaveURL(ORDER_URL);
    expect(await countOrdersOf(name)).toBe(1);
    const [order] = await ordersOf(name);
    expect((await itemsOfOrder(order.id)).map((i) => i.nameSnapshot)).toEqual(["Melt simple"]);
  } finally {
    await withAdmin(browser, baseURL, headers, (admin) => setProductActive(admin, "Aro simple", true));
  }
});

test("remember me prefills the next visit, can be erased and survives corrupt storage", async ({ page }) => {
  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await expect(page.getByTestId("forget-customer")).toHaveCount(0);

  const remembered = {
    v: 1,
    name: "Marta Recordada",
    whatsapp: "11 4444-5555",
    address: "Belgrano 100",
    crossStreets: "Sarmiento y Mitre",
    notes: "Portón verde",
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CUSTOMER_KEY, JSON.stringify(remembered)] as const);
  await page.reload();
  await expect(submitButton(page)).toBeVisible();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue("Marta Recordada");
  await expect(page.getByLabel("WhatsApp")).toHaveValue("11 4444-5555");
  await expect(page.getByLabel("Dirección")).toHaveValue("Belgrano 100");
  await expect(page.getByLabel("Entre calles")).toHaveValue("Sarmiento y Mitre");
  await expect(page.getByLabel("Aclaraciones del lugar (opcional)")).toHaveValue("Portón verde");
  // The payment method is never remembered.
  await expect(page.locator("input[name=paymentMethod]:checked")).toHaveCount(0);

  await page.getByTestId("forget-customer").click();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue("");
  await expect(page.getByLabel("Dirección")).toHaveValue("");
  await expect(page.getByTestId("forget-customer")).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), CUSTOMER_KEY)).toBeNull();

  // Garbage in storage must not crash anything.
  await page.evaluate((k) => localStorage.setItem(k, "{not json"), CUSTOMER_KEY);
  await page.reload();
  await expect(submitButton(page)).toBeVisible();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue("");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, name: 5 })), CUSTOMER_KEY);
  await page.reload();
  await expect(submitButton(page)).toBeVisible();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue("");
});

test("an empty cart goes back to the cart page, and the page is noindex", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();

  const ranchita = await findProduct("Ranchita simple");
  await seedCart(page, [{ productId: ranchita.id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await expect(page).toHaveTitle("Confirmar pedido — The Burger House 828");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
