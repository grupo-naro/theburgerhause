import { expect, test } from "@playwright/test";
import { orderCard, parkPendingOrders, placeRetiroOrder } from "./helpers/caja";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });

const dispatchCard = (page: import("@playwright/test").Page, number: number) =>
  page.locator(`[data-testid="dispatch-card"][data-order-number="${number}"]`);

test.beforeEach(parkPendingOrders);

test("a web takeaway order is approved and followed on Mostrador", async ({ page }) => {
  const order = await placeRetiroOrder({ paymentMethod: "cash" });

  // On Venta (the POS) the strip cannot be missed.
  await page.goto("/mostrador");
  const banner = page.getByTestId("pending-app-banner");
  await expect(banner).toContainText("🔔 1 pedido de la app por aprobar");
  await banner.getByRole("link", { name: "Ver y aprobar" }).click();
  await expect(page).toHaveURL(/\/mostrador\/pedidos$/);
  // The page that lists the orders does not repeat the strip (Next keeps the previous route hidden in the DOM: check visibility).
  await expect(page.getByTestId("pending-app-banner")).toBeHidden();

  const card = orderCard(page, order.number);
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);

  // In preparation, on the same screen, labelled as an app pickup.
  const inFlight = dispatchCard(page, order.number);
  await expect(inFlight).toBeVisible();
  await expect(inFlight.getByTestId("origin-chip")).toHaveText("APP · RETIRA EN LOCAL");

  // Nothing waits any more: the strip is gone on Venta.
  await page.goto("/mostrador");
  await expect(page.getByTestId("pending-app-banner")).toBeHidden();
});

test("old /retiro link redirects to Mostrador", async ({ page }) => {
  await page.goto("/retiro");
  await expect(page).toHaveURL(/\/mostrador\/pedidos$/);
});

test("cashier nav has no Retiro en local", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/mostrador/pedidos");
  const nav = page.getByRole("navigation", { name: "Secciones" });
  await expect(nav.getByRole("link", { name: "Mostrador", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Retiro en local" })).toHaveCount(0);
});
