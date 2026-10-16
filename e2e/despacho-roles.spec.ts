import { expect, test } from "@playwright/test";
import { openDelivery, orderById } from "./helpers/caja";
import {
  assignInDb,
  cleanBoard,
  counterOrder,
  dcard,
  ensureCadet,
  lane,
  openDespacho,
  openPedidos,
  placeApproved,
  placeReady,
  tag,
  runCleanups,
} from "./helpers/despacho";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("Mostrador shows only the counter orders and controls the whole counter flow", async ({ page }) => {
    const cadet = await ensureCadet(`Ruta ${tag()}`);
    const delivery = await placeReady({ paymentMethod: "cash" });
    const prepDelivery = await placeApproved({ paymentMethod: "cash" });
    const onRoute = await placeReady({ paymentMethod: "cash" });
    await assignInDb([onRoute.id], cadet.id);
    const pos = await counterOrder();
    await openPedidos(page);

    await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Mostrador" })).toHaveAttribute("aria-current", "page");
    await expect(dcard(page, pos.number)).toBeVisible();
    // The delivery sector is not on her screen at all (server-side filter), nor its cadets or cash.
    await expect(dcard(page, delivery.number)).toHaveCount(0);
    await expect(dcard(page, prepDelivery.number)).toHaveCount(0);
    await expect(page.locator(`[data-testid="route-order"][data-order-number="${onRoute.number}"]`)).toHaveCount(0);
    await expect(page.getByTestId("lane-ready-delivery")).toHaveCount(0);
    await expect(page.getByTestId("lane-enroute")).toHaveCount(0);
    await expect(page.getByTestId("cash-pending")).toHaveCount(0);
    await expect(page.getByTestId("select-order")).toHaveCount(0);
    await expect(page.getByTestId("select-all")).toHaveCount(0);
    await expect(page.getByTestId("assign-bar")).toHaveCount(0);
    await expect(page.getByTestId("render-link")).toHaveCount(0);
    await shot(page, "mostrador-pedidos-cajera");

    // The counter flow works end to end.
    await dcard(page, pos.number).getByTestId("mark-ready").click();
    await dcard(page, pos.number).getByTestId("call-pickup").click();
    await dcard(page, pos.number).getByTestId("deliver").click();
    await expect(dcard(page, pos.number)).toHaveCount(0);
    expect((await orderById(pos.orderId)).status).toBe("entregado");
  });
});

test.describe("encargada", () => {
  test.use({ storageState: authFile("encargada") });

  test("Gestión Delivery: checkboxes and the assign bar on Listos, Rendir on En camino; no counter orders", async ({ page }) => {
    const cadet = await ensureCadet(`Ruta ${tag()}`);
    const a = await placeReady({ paymentMethod: "cash" });
    const b = await placeReady({ paymentMethod: "cash" });
    await assignInDb([b.id], cadet.id);
    const pos = await counterOrder();
    await openDelivery(page, "ready");
    await expect(page.getByTestId("select-order")).toHaveCount(1);
    await dcard(page, a.number).getByTestId("select-order").check();
    await expect(page.getByTestId("assign-bar")).toBeVisible();
    await page.getByTestId("tab-enroute").click();
    await expect(page.getByTestId("render-link")).toBeVisible();
    await expect(dcard(page, pos.number)).toHaveCount(0);
    await expect(lane(page, "pickup")).toHaveCount(0);
    await page.getByTestId("render-link").click();
    await expect(page).toHaveURL(new RegExp(`/delivery/rendicion\\?cadet=${cadet.id}$`));
    // Whatever Task 8.5 renders there, the link must not 404.
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("could not be found")).toHaveCount(0);
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("the general board /despacho shows checkboxes, the assign bar and Rendir", async ({ page }) => {
    const cadet = await ensureCadet(`Ruta ${tag()}`);
    const a = await placeReady({ paymentMethod: "cash" });
    const b = await placeReady({ paymentMethod: "cash" });
    await assignInDb([b.id], cadet.id);
    await openDespacho(page);
    await expect(page.getByTestId("select-order")).toHaveCount(1);
    await dcard(page, a.number).getByTestId("select-order").check();
    await expect(page.getByTestId("assign-bar")).toBeVisible();
    await expect(page.getByTestId("render-link")).toBeVisible();
    await page.getByTestId("render-link").click();
    await expect(page).toHaveURL(new RegExp(`/delivery/rendicion\\?cadet=${cadet.id}$`));
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("could not be found")).toHaveCount(0);
  });
});

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("is sent to /login", async ({ page }) => {
    await page.goto("/despacho");
    await expect(page).toHaveURL(/\/login/);
  });
});
