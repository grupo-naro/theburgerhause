import { expect, test } from "@playwright/test";
import { audioContexts, beeps, openDelivery, orderCard, parkPendingOrders, placeDeliveryOrder, stubAudio } from "./helpers/caja";
import { assignInDb, cleanBoard, dcard, ensureCadet, lane, pingOrders, placeApproved, placeReady, runCleanups, tag } from "./helpers/despacho";
import { authFile } from "./helpers/users";

// Gestión Delivery: one workspace with tabs (Por aprobar, En preparación, Listos / Despacho, En camino, Recientes).
test.use({ storageState: authFile("encargada") });
test.beforeEach(async () => {
  await parkPendingOrders();
  await cleanBoard();
});
test.afterEach(runCleanups);
test.afterAll(cleanBoard);

const tabUrl = (page: import("@playwright/test").Page) => new URL(page.url()).searchParams.get("tab");

test("tabs: accessible tablist, deep links, unknown tab falls back, arrows move, the URL follows and survives a live refresh", async ({ page }) => {
  await openDelivery(page);
  const list = page.getByRole("tablist");
  await expect(list).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText([/Por aprobar/, /En preparación/, /Listos \/ Despacho/, /En camino/, /Recientes/]);
  await expect(page.getByRole("tab", { name: /Por aprobar/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("data-tab", "pending");

  // Arrow keys move the selection (and wrap around).
  await page.getByRole("tab", { name: /Por aprobar/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /En preparación/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /En preparación/ })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /Recientes/ })).toHaveAttribute("aria-selected", "true");

  // The URL follows the tab, even after a live refresh.
  await page.getByRole("tab", { name: /En camino/ }).click();
  await expect.poll(() => tabUrl(page)).toBe("enroute");
  const o = await placeApproved({ paymentMethod: "cash" });
  await pingOrders(o.id);
  await page.waitForTimeout(1500);
  expect(tabUrl(page)).toBe("enroute");
  await expect(page.getByRole("tab", { name: /En camino/ })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("tab", { name: /En camino/ })).toHaveAttribute("aria-selected", "true");

  // Deep links and garbage.
  await openDelivery(page, "ready");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("data-tab", "ready");
  await page.goto("/delivery?tab=nonsense");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("data-tab", "pending");
  await page.goto("/delivery?tab=pickup"); // a lane of the other sector is not a tab here
  await expect(page.getByRole("tabpanel")).toHaveAttribute("data-tab", "pending");
});

test("each tab shows its own orders and the badges count them live", async ({ page }) => {
  const cadet = await ensureCadet(`Tabs ${tag()}`);
  await openDelivery(page);
  const pending = await placeDeliveryOrder({ paymentMethod: "cash" });
  await expect(page.getByTestId("tab-pending-count")).toHaveText("1");
  await expect(orderCard(page, pending.number)).toBeVisible();

  const prep = await placeApproved({ paymentMethod: "cash" });
  const ready = await placeReady({ paymentMethod: "cash" });
  const route = await placeReady({ paymentMethod: "transfer" });
  await assignInDb([route.id], cadet.id);
  await expect(page.getByTestId("tab-preparing-count")).toHaveText("1");
  await expect(page.getByTestId("tab-ready-count")).toHaveText("1");
  await expect(page.getByTestId("tab-enroute-count")).toHaveText("1");

  await page.getByTestId("tab-preparing").click();
  await expect(dcard(page, prep.number)).toBeVisible();
  await expect(dcard(page, ready.number)).toHaveCount(0);
  await expect(orderCard(page, pending.number)).toHaveCount(0);
  await page.getByTestId("tab-ready").click();
  await expect(dcard(page, ready.number)).toBeVisible();
  await expect(dcard(page, prep.number)).toHaveCount(0);
  await page.getByTestId("tab-enroute").click();
  await expect(page.locator(`[data-testid="route-order"][data-order-number="${route.number}"]`)).toBeVisible();
  await expect(lane(page, "enroute")).toBeVisible();
});

test("a selection for the cadet survives switching tabs; the assign bar belongs to Listos / Despacho", async ({ page }) => {
  const cadet = await ensureCadet(`Sel ${tag()}`);
  const a = await placeReady({ paymentMethod: "cash" });
  const b = await placeReady({ paymentMethod: "transfer" });
  await openDelivery(page, "ready");
  await dcard(page, a.number).getByTestId("select-order").check();
  await dcard(page, b.number).getByTestId("select-order").check();
  await expect(page.getByTestId("assign-summary")).toContainText("2 pedidos");
  await page.getByTestId("cadet-select").selectOption(String(cadet.id));

  await page.getByTestId("tab-recent").click();
  await expect(page.getByTestId("assign-bar")).toHaveCount(0);
  await page.getByTestId("tab-ready").click();
  await expect(page.getByTestId("assign-summary")).toContainText("2 pedidos");
  await expect(dcard(page, a.number).getByTestId("select-order")).toBeChecked();
  await expect(page.getByTestId("cadet-select")).toHaveValue(String(cadet.id));
  await page.getByTestId("assign-button").click();
  await expect(page.getByTestId("toast")).toContainText("2 pedidos en camino");
});

test("a new order is announced (title, beep) while the manager is on ANOTHER tab", async ({ page }) => {
  await stubAudio(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("caja:sound", "on");
    document.hasFocus = () => false;
  });
  await openDelivery(page, "enroute");
  await page.mouse.click(5, 5); // a gesture unlocks the audio
  await expect.poll(() => audioContexts(page)).toBe(1);
  const before = await beeps(page);

  const o = await placeDeliveryOrder({ paymentMethod: "cash" });
  await expect(page.getByTestId("tab-pending-count")).toHaveText("1");
  await expect(page).toHaveTitle(/¡Nuevo pedido!|\(1\) Gestión Delivery/);
  await expect.poll(() => beeps(page)).toBe(before + 1);
  await expect(page.getByTestId("caja-announcer")).toHaveText(`Nuevo pedido #${o.number}`);
  // Still on the other tab: the card is not shown there, but one click away.
  await expect(orderCard(page, o.number)).toHaveCount(0);
  await page.getByTestId("tab-pending").click();
  await expect(orderCard(page, o.number)).toBeVisible();
});
