import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { orderById } from "./helpers/caja";
import { db } from "./helpers/db";
import {
  assignInDb,
  cadetGroup,
  cleanBoard,
  counterOrder,
  dcard,
  ensureCadet,
  lane,
  openDespacho,
  pickupInDb,
  placeApproved,
  placeReady,
  routeOrder,
  tag,
  runCleanups,
} from "./helpers/despacho";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

// The full board (every lane, counters) is the admin general view /despacho; the sector workspaces reuse its components
// and are covered by sector-workspaces.spec.ts and delivery-workspace.spec.ts.
test.use({ storageState: authFile("admin") });
test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

const eventsTo = async (orderId: number, to: (typeof s.orderEvents.$inferSelect)["toStatus"]) =>
  db().select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, orderId), eq(s.orderEvents.toStatus, to)));

test("delivery flow without reloading: prepare, ready, select three, assign to a cadet", async ({ page }) => {
  const cadet = await ensureCadet(`Nahuel ${tag()}`);
  await openDespacho(page);
  await shot(page, "despacho-empty");
  await expect(page.getByTestId("lane-preparing-empty")).toBeVisible();

  const a = await placeApproved({ paymentMethod: "cash" });
  const b = await placeApproved({ paymentMethod: "cash" });
  const c = await placeApproved({ paymentMethod: "transfer" });
  for (const o of [a, b, c]) await expect(lane(page, "preparing").locator(`[data-order-number="${o.number}"]`)).toBeVisible();
  await expect(page.getByTestId("counter-preparing-n")).toHaveText("3");

  for (const o of [a, b, c]) {
    await dcard(page, o.number).getByTestId("mark-ready").click();
    await expect(lane(page, "ready-delivery").locator(`[data-order-number="${o.number}"]`)).toBeVisible();
  }
  await expect(page).toHaveTitle("(3) Despacho");
  await expect(page.getByTestId("assign-bar")).toHaveCount(0);
  await expect(dcard(page, c.number).getByTestId("payment-chip")).toHaveText("Transferencia pagada");
  await expect(dcard(page, a.number).getByTestId("payment-chip")).toHaveText("Efectivo pendiente");

  await page.getByTestId("select-all").click();
  const bar = page.getByTestId("assign-bar");
  await expect(bar.getByTestId("assign-summary")).toContainText("3 pedidos");
  await expect(bar.getByTestId("assign-cash")).toContainText(`Efectivo a cobrar ${formatARS(a.total + b.total)}`);
  await expect(bar.getByTestId("assign-button")).toBeDisabled();
  await expect(bar.getByTestId("assign-hint")).toBeVisible();
  await expect(bar.getByTestId("assign-hint")).toHaveText("Elegí un cadete");
  await expect(bar.getByTestId("assign-button")).toHaveAttribute("aria-describedby", "assign-reason");
  await shotViewport(page, "despacho-selected-bar");

  await bar.getByTestId("cadet-select").selectOption(String(cadet.id));
  const assign = bar.getByRole("button", { name: `Asignar a ${cadet.name}` });
  await expect(assign).toBeEnabled();
  await assign.click();

  await expect(page.getByTestId("toast")).toContainText(`3 pedidos en camino con ${cadet.name} · Efectivo a rendir ${formatARS(a.total + b.total)}`);
  await expect(page.getByTestId("assign-bar")).toHaveCount(0);
  const group = cadetGroup(page, cadet.id);
  await expect(group.getByTestId("route-count")).toHaveText("3 pedidos");
  await expect(group.getByTestId("cash-pending")).toHaveText(formatARS(a.total + b.total));
  await expect(page.getByTestId("lane-ready-delivery-empty")).toBeVisible();
  await expect(page).toHaveTitle("Despacho");
  await shot(page, "despacho-en-camino");

  for (const o of [a, b, c]) {
    const row = await orderById(o.id);
    expect(row.status).toBe("en_camino");
    expect(row.cadetId).toBe(cadet.id);
    expect(await eventsTo(o.id, "en_camino")).toHaveLength(1);
  }
});

test("en camino actions: deliver, fail with a reason, re-assign; cash stays pending", async ({ page }) => {
  const c1 = await ensureCadet(`Uno ${tag()}`);
  const c2 = await ensureCadet(`Dos ${tag()}`);
  const a = await placeReady({ paymentMethod: "cash" });
  const b = await placeReady({ paymentMethod: "cash" });
  const c = await placeReady({ paymentMethod: "transfer" });
  const d = await placeReady({ paymentMethod: "cash" });
  await assignInDb([a.id, b.id, c.id, d.id], c1.id);
  await openDespacho(page);
  const group = cadetGroup(page, c1.id);
  await expect(group.getByTestId("cash-pending")).toHaveText(formatARS(a.total + b.total + d.total));
  await expect(group.getByText("El efectivo se rinde cuando vuelve el cadete.")).toBeVisible();
  await expect(group.getByTestId("render-link")).toHaveAttribute("href", `/delivery/rendicion?cadet=${c1.id}`);

  // Transfer order: one click, no dialog.
  await routeOrder(page, c.number).getByTestId("deliver").click();
  await expect(routeOrder(page, c.number)).toHaveCount(0);
  expect((await orderById(c.id)).status).toBe("entregado");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Cash delivered by the cadet: payment stays pending until the rendicion.
  await routeOrder(page, b.number).getByTestId("deliver").click();
  await expect(routeOrder(page, b.number)).toHaveCount(0);
  const delivered = await orderById(b.id);
  expect(delivered.status).toBe("entregado");
  expect(delivered.paymentStatus).toBe("pending");
  await expect(group.getByTestId("cash-pending")).toHaveText(formatARS(a.total + d.total));

  // Could not deliver: quick reason, back to ready, cadet cleared.
  await routeOrder(page, a.number).getByTestId("return-order").click();
  const dialog = page.getByTestId("return-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("return-confirm")).toBeDisabled();
  await shotViewport(page, "despacho-return-dialog");
  await dialog.getByRole("button", { name: "No atendió" }).click();
  await dialog.getByTestId("return-confirm").click();
  await expect(lane(page, "ready-delivery").locator(`[data-order-number="${a.number}"]`)).toBeVisible();
  const back = await orderById(a.id);
  expect(back.status).toBe("listo_despacho");
  expect(back.cadetId).toBeNull();
  const notes = (await db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, a.id))).map((e) => e.note);
  expect(notes).toContain("No atendió");
  await expect(group.getByTestId("cash-pending")).toHaveText(formatARS(d.total));

  // Re-assign it to the other cadet from the board.
  await dcard(page, a.number).getByTestId("select-order").check();
  await page.getByTestId("cadet-select").selectOption(String(c2.id));
  await page.getByTestId("assign-button").click();
  await expect(cadetGroup(page, c2.id).getByTestId("cash-pending")).toHaveText(formatARS(a.total));
  expect((await orderById(a.id)).cadetId).toBe(c2.id);
  expect((await orderById(d.id)).paymentStatus).toBe("pending");
});

test("counter pickup and takeaway cash collection", async ({ page }) => {
  const pos = await counterOrder();
  const web = await placeReady({ fulfillment: "takeaway", paymentMethod: "cash" });
  await openDespacho(page);

  // POS order: Listo -> Llamar / Para retirar (huge pager) -> Entregado in one click (already paid).
  await dcard(page, pos.number).getByTestId("mark-ready").click();
  const ready = lane(page, "ready-counter").locator(`[data-order-number="${pos.number}"]`);
  await expect(ready.getByTestId("pager-number")).toContainText(String(pos.pager));
  await ready.getByTestId("call-pickup").click();
  const picked = lane(page, "pickup").locator(`[data-order-number="${pos.number}"]`);
  await expect(picked).toBeVisible();
  const pagerBox = await picked.getByTestId("pager-number").locator("p").nth(1).boundingBox();
  expect(pagerBox!.height).toBeGreaterThanOrEqual(60);
  await picked.getByTestId("deliver").click();
  await expect(picked).toHaveCount(0);
  expect((await orderById(pos.orderId)).status).toBe("entregado");

  // Web takeaway paid in cash: the collect dialog gates the delivery.
  const card = dcard(page, web.number);
  await expect(card.getByTestId("pickup-name")).toBeVisible();
  await card.getByTestId("call-pickup").click();
  const pickedWeb = lane(page, "pickup").locator(`[data-order-number="${web.number}"]`);
  await pickedWeb.getByTestId("deliver").click();
  const dialog = page.getByTestId("collect-dialog");
  await expect(dialog).toContainText(`Cobrá ${formatARS(web.total)} antes de entregar`);
  const confirm = dialog.getByTestId("collect-confirm");
  await expect(confirm).toBeDisabled();
  await shotViewport(page, "despacho-collect-dialog");
  await dialog.getByRole("checkbox", { name: /Cobré/ }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(pickedWeb).toHaveCount(0);
  const done = await orderById(web.id);
  expect(done.status).toBe("entregado");
  expect(done.paymentStatus).toBe("paid");
});

test("Escape closes the dialog and gives the focus back to the button that opened it", async ({ page }) => {
  const web = await placeReady({ fulfillment: "takeaway", paymentMethod: "cash" });
  await pickupInDb(web.id);
  await openDespacho(page);
  const deliver = dcard(page, web.number).getByTestId("deliver");
  await deliver.click();
  await expect(page.getByTestId("collect-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("collect-dialog")).toHaveCount(0);
  await expect(deliver).toBeFocused();
  expect((await orderById(web.id)).status).toBe("para_retirar");
});

test("Space toggles the selection of a focused delivery card", async ({ page }) => {
  const o = await placeReady({ paymentMethod: "cash" });
  await openDespacho(page);
  const box = dcard(page, o.number).getByTestId("select-order");
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
});
