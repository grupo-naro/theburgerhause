import { expect, test, type Browser, type Page } from "@playwright/test";
import { isNull } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db, setOrderStatusInDb } from "./helpers/db";
import { gotoStore } from "./helpers/store";
import { openTracking, placeOrderInDb } from "./helpers/tracking";
import { authFile } from "./helpers/users";

// Customers: anonymous. The delay is activated by a cajera in a second context.
test.use({ storageState: { cookies: [], origins: [] } });

const REASON = "Se rompió la plancha E2E";

async function clearDelays() {
  await db().update(s.delayNotices).set({ endedAt: new Date() }).where(isNull(s.delayNotices.endedAt));
}
test.beforeEach(clearDelays);
test.afterAll(clearDelays);

async function withCajera(browser: Browser, baseURL: string | undefined, fn: (page: Page) => Promise<void>) {
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("cajera"),
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

async function activateDelay(browser: Browser, baseURL: string | undefined, minutes: string) {
  await withCajera(browser, baseURL, async (staff) => {
    await staff.goto("/mostrador");
    await staff.getByTestId("delay-chip").click();
    const dialog = staff.getByTestId("delay-dialog");
    await dialog.getByRole("button", { name: minutes, exact: true }).click();
    await dialog.getByLabel(/Motivo/).fill(REASON);
    await staff.getByTestId("delay-activate").click();
    await expect(dialog).toHaveCount(0);
  });
}

test("the menu shows the wait, turns orange within a minute of a manual delay, and never the reason", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(120_000);
  await gotoStore(page);
  const notice = page.getByTestId("estimate-notice");
  await expect(notice).toContainText(/Retiro \d+–\d+ min · Delivery \d+–\d+ min/);
  await expect(notice).toHaveAttribute("data-delayed", "false");

  await activateDelay(browser, baseURL, "+15");

  await expect(notice).toHaveAttribute("data-delayed", "true", { timeout: 70_000 });
  await expect(notice).toHaveClass(/orange/);
  await expect(notice).toContainText(/Retiro \d+–\d+ min · Delivery \d+–\d+ min/);

  await page.reload();
  await expect(page.getByTestId("estimate-notice")).toHaveAttribute("data-delayed", "true");
  expect(await page.content()).not.toContain(REASON);

  const res = await request.get("/api/demora");
  expect(res.status()).toBe(200);
  expect(Object.keys(await res.json()).sort()).toEqual(["delayed", "delivery", "takeaway"]);
  expect(await res.text()).not.toContain(REASON);
});

test("Tu pedido shows the estimate while preparing and hides it once the order is ready", async ({ page, browser, baseURL }) => {
  await activateDelay(browser, baseURL, "+10");
  const order = await placeOrderInDb({ fulfillment: "takeaway", units: "single" });
  await setOrderStatusInDb(order.token, "en_preparacion", "paid");

  await openTracking(page, `/pedido/${order.token}`);
  const notice = page.getByTestId("estimate-notice");
  await expect(notice).toContainText(/Tu pedido llega en aprox\. \d+–\d+ min \(hay más demora de lo normal\)/);
  await expect(notice).toHaveAttribute("data-variant", "order");
  expect(await page.content()).not.toContain(REASON);

  await setOrderStatusInDb(order.token, "para_retirar");
  await page.reload();
  await expect(page.getByTestId("tracking")).toBeVisible();
  await expect(page.getByTestId("estimate-notice")).toHaveCount(0);
});
