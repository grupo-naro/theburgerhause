import { expect, test } from "@playwright/test";
import { killListenerBackends, listenerConnections, ordersOf } from "./helpers/db";
import { choosePayment, fillCustomer, fillDelivery, submitButton, unique, uniquePhone } from "./helpers/checkout";
import { collectEvents, framesOf, stopCollecting } from "./helpers/realtime";
import { addProduct, cartCount, gotoStore, orderBar } from "./helpers/store";
import { placeOrderInDb } from "./helpers/tracking";
import { authFile } from "./helpers/users";

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/events without a session is 401 JSON", async ({ request }) => {
    const res = await request.get("/api/events");
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

test.describe("staff", () => {
  test.use({ storageState: authFile("cajera") });

  test("stream headers and hello frame", async ({ page }) => {
    await page.goto("/caja");
    const headers = await page.evaluate(async () => {
      const ac = new AbortController();
      const res = await fetch("/api/events", { signal: ac.signal });
      const out = {
        status: res.status,
        type: res.headers.get("content-type"),
        cache: res.headers.get("cache-control"),
        accel: res.headers.get("x-accel-buffering"),
      };
      ac.abort();
      return out;
    });
    expect(headers).toEqual({
      status: 200,
      type: "text/event-stream; charset=utf-8",
      cache: "no-cache, no-transform",
      accel: "no",
    });
    await collectEvents(page);
    await expect.poll(async () => (await framesOf(page, "hello")).length).toBe(1);
    await stopCollecting(page);
  });

  test("the staff page shows the live indicator", async ({ page }) => {
    await page.goto("/caja");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
  });

  test("an order created elsewhere reaches an open stream without reloading", async ({ page }) => {
    await page.goto("/caja");
    await collectEvents(page);
    await expect.poll(async () => (await framesOf(page, "hello")).length).toBe(1);

    const placed = await placeOrderInDb(); // runs createOrder in the runner process: DB -> NOTIFY -> server listener -> SSE
    const [order] = await ordersOf(placed.name);

    await expect
      .poll(async () => (await framesOf(page, "orders")).map((f) => f.data))
      .toContainEqual({ orderId: order.id, status: "pendiente_aprobacion", event: "created" });
    await stopCollecting(page);
  });

  test("a real checkout in another browser context notifies the staff stream", async ({ page, browser, baseURL }) => {
    await page.goto("/caja");
    await collectEvents(page);
    await expect.poll(async () => (await framesOf(page, "hello")).length).toBe(1);

    const customer = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
    });
    try {
      const cp = await customer.newPage();
      const name = unique("Vivo");
      await gotoStore(cp);
      await addProduct(cp, "Ranchita simple");
      await expect(cartCount(cp)).toHaveText("1");
      await orderBar(cp).click();
      await cp.getByTestId("cart-continue").click();
      await expect(submitButton(cp)).toBeVisible();
      await fillDelivery(cp);
      await fillCustomer(cp, name, uniquePhone());
      await choosePayment(cp, "cash");
      await submitButton(cp).click();
      await expect(cp).toHaveURL(/\/pedido\/[0-9a-f]{32}/);

      const [order] = await ordersOf(name);
      await expect
        .poll(async () => (await framesOf(page, "orders")).map((f) => f.data))
        .toContainEqual({ orderId: order.id, status: "pendiente_aprobacion", event: "created" });
    } finally {
      await customer.close();
    }
    await stopCollecting(page);
  });

  test("killing the server-side listener connection yields a resync, then events flow again", async ({ page }) => {
    await page.goto("/caja");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    await collectEvents(page);
    await expect.poll(async () => (await framesOf(page, "hello")).length).toBe(1);
    await expect.poll(listenerConnections).toBe(1);
    const resyncsBefore = (await framesOf(page, "resync")).length;

    expect(await killListenerBackends()).toBe(1);

    // The listener reconnects (1 s backoff) and publishes resync to every open stream.
    await expect.poll(async () => (await framesOf(page, "resync")).length, { timeout: 15_000 }).toBeGreaterThan(resyncsBefore);
    await expect.poll(listenerConnections).toBe(1);

    const placed = await placeOrderInDb();
    const [order] = await ordersOf(placed.name);
    await expect
      .poll(async () => (await framesOf(page, "orders")).map((f) => (f.data as { orderId: number }).orderId))
      .toContain(order.id);
    await stopCollecting(page);
  });
});
