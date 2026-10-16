import { expect, test } from "@playwright/test";
import { orderById } from "./helpers/caja";
import {
  assignInDb,
  cleanBoard,
  counterOrder,
  dcard,
  ensureCadet,
  lane,
  openDespacho,
  placeApproved,
  placeReady,
  tag,
  runCleanups,
} from "./helpers/despacho";
import { shot } from "./helpers/shots";
import { authFile, type UserKey } from "./helpers/users";

test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("sees the whole board but only controls the counter flow", async ({ page }) => {
    const cadet = await ensureCadet(`Ruta ${tag()}`);
    const delivery = await placeReady({ paymentMethod: "cash" });
    const prepDelivery = await placeApproved({ paymentMethod: "cash" });
    const onRoute = await placeReady({ paymentMethod: "cash" });
    await assignInDb([onRoute.id], cadet.id);
    const pos = await counterOrder();
    await openDespacho(page);

    await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Despacho" })).toHaveAttribute("aria-current", "page");
    // Everything is visible...
    await expect(dcard(page, delivery.number)).toBeVisible();
    await expect(page.locator(`[data-testid="route-order"][data-order-number="${onRoute.number}"]`)).toBeVisible();
    await expect(page.getByTestId("cash-pending")).toBeVisible();
    // ...but the delivery column and the cadets are read-only.
    await expect(page.getByTestId("select-order")).toHaveCount(0);
    await expect(page.getByTestId("select-all")).toHaveCount(0);
    await expect(page.getByTestId("assign-bar")).toHaveCount(0);
    await expect(page.getByTestId("render-link")).toHaveCount(0);
    await expect(lane(page, "enroute").getByTestId("deliver")).toHaveCount(0);
    await expect(lane(page, "enroute").getByTestId("return-order")).toHaveCount(0);
    await expect(dcard(page, prepDelivery.number).getByTestId("mark-ready")).toHaveCount(0);
    await shot(page, "despacho-cajera");

    // The counter flow works end to end.
    await dcard(page, pos.number).getByTestId("mark-ready").click();
    await dcard(page, pos.number).getByTestId("call-pickup").click();
    await dcard(page, pos.number).getByTestId("deliver").click();
    await expect(dcard(page, pos.number)).toHaveCount(0);
    expect((await orderById(pos.orderId)).status).toBe("entregado");
  });
});

for (const who of ["encargada", "admin"] as UserKey[]) {
  test.describe(who, () => {
    test.use({ storageState: authFile(who) });

    test("sees checkboxes, the assign bar and Rendir", async ({ page }) => {
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
      await expect(page).toHaveURL(new RegExp(`/despacho/rendicion\\?cadet=${cadet.id}$`));
      // Whatever Task 8.5 renders there, the link must not 404.
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByText("could not be found")).toHaveCount(0);
    });
  });
}

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("is sent to /login", async ({ page }) => {
    await page.goto("/despacho");
    await expect(page).toHaveURL(/\/login/);
  });
});
