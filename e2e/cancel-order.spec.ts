import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { listCadetBalances } from "../src/lib/settlements/queries";
import { eventsOf, openDelivery, orderById, printJobsOf } from "./helpers/caja";
import { db } from "./helpers/db";
import {
  assignInDb,
  cleanBoard,
  counterOrder,
  dcard,
  ensureCadet,
  openPedidos,
  placeApproved,
  placeReady,
  routeOrder,
  runCleanups,
  tag,
} from "./helpers/despacho";
import { deliveredFor, openDetail, retireCadets } from "./helpers/rendicion";
import { shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

async function cancelFromCard(page: import("@playwright/test").Page, number: number, chip = "Cliente canceló") {
  await dcard(page, number).getByTestId("cancel-order").click();
  const dialog = page.getByTestId("cancel-dialog");
  await expect(dialog).toBeVisible();
  // The reason is mandatory: the confirm button stays disabled until there is one.
  await expect(dialog.getByTestId("cancel-confirm")).toBeDisabled();
  await dialog.getByRole("button", { name: chip }).click();
  await expect(dialog.getByTestId("cancel-confirm")).toBeEnabled();
  return dialog;
}

test.describe("cajera (mostrador)", () => {
  test.use({ storageState: authFile("cajera") });

  test("voids a counter sale with a reason: the card leaves, the pager is free, the event keeps the reason", async ({ page }) => {
    const pos = await counterOrder();
    await openPedidos(page);
    const dialog = await cancelFromCard(page, pos.number, "Error de carga");
    await shotViewport(page, "cancel-dialog-counter");
    // Backing out leaves the order alone.
    await dialog.getByRole("button", { name: "Volver" }).click();
    await expect(page.getByTestId("cancel-dialog")).toHaveCount(0);
    expect((await orderById(pos.orderId)).status).toBe("en_preparacion");

    await cancelFromCard(page, pos.number, "Error de carga");
    await page.getByTestId("cancel-confirm").click();
    await expect(dcard(page, pos.number)).toHaveCount(0);
    const row = await orderById(pos.orderId);
    expect(row.status).toBe("cancelado");
    const last = (await eventsOf(pos.orderId)).at(-1)!;
    expect(last).toMatchObject({ fromStatus: "en_preparacion", toStatus: "cancelado", note: "Error de carga" });
    // The pager number can be used again right away.
    const again = await counterOrder(pos.pager);
    expect((await orderById(again.orderId)).status).toBe("en_preparacion");
  });

  test("cancels a counter order that is already waiting for pickup", async ({ page }) => {
    const pos = await counterOrder();
    await db().update(s.orders).set({ status: "para_retirar" }).where(eq(s.orders.id, pos.orderId));
    await openPedidos(page);
    await cancelFromCard(page, pos.number);
    await page.getByTestId("cancel-confirm").click();
    await expect(dcard(page, pos.number)).toHaveCount(0);
    expect((await orderById(pos.orderId)).status).toBe("cancelado");
  });
});

test.describe("encargada (delivery)", () => {
  test.use({ storageState: authFile("encargada") });

  test("cancels a delivery order in the middle of preparation; the customer sees it cancelled; no failed-print alert", async ({ page, browser }) => {
    const o = await placeApproved({ paymentMethod: "cash" });
    await openDelivery(page, "preparing");
    await cancelFromCard(page, o.number);
    await page.getByTestId("cancel-confirm").click();
    await expect(dcard(page, o.number)).toHaveCount(0);
    const row = await orderById(o.id);
    expect(row.status).toBe("cancelado");
    expect(row.paymentStatus).toBe("pending");
    expect((await printJobsOf(o.id)).every((j) => j.status !== "pending")).toBe(true);

    const customer = await browser.newPage();
    await customer.goto(`/pedido/${o.token}`);
    await expect(customer.getByText("Tu pedido fue cancelado")).toBeVisible();
    await customer.close();
  });

  test("cancels a delivery order that is ready for dispatch", async ({ page }) => {
    const o = await placeReady({ paymentMethod: "transfer" });
    await openDelivery(page, "ready");
    await cancelFromCard(page, o.number, "Sin stock");
    await page.getByTestId("cancel-confirm").click();
    await expect(dcard(page, o.number)).toHaveCount(0);
    expect((await orderById(o.id)).status).toBe("cancelado");
  });

  test("a failed delivery returned to dispatch can be cancelled and the rendicion excludes it", async ({ page }) => {
    const cadet = await ensureCadet(`Cancel ${tag()}`);
    const delivered = await deliveredFor(cadet.id);
    const failed = await placeReady({ paymentMethod: "cash" });
    await assignInDb([failed.id], cadet.id);

    await openDelivery(page, "enroute");
    await routeOrder(page, failed.number).getByTestId("return-order").click();
    const ret = page.getByTestId("return-dialog");
    await ret.getByRole("button", { name: "No atendió" }).click();
    await ret.getByTestId("return-confirm").click();
    await expect.poll(async () => (await orderById(failed.id)).status).toBe("listo_despacho");

    await openDelivery(page, "ready");
    await cancelFromCard(page, failed.number, "No se pudo entregar");
    await page.getByTestId("cancel-confirm").click();
    await expect(dcard(page, failed.number)).toHaveCount(0);
    expect((await orderById(failed.id)).status).toBe("cancelado");

    const balance = (await listCadetBalances(db())).find((b) => b.cadetId === cadet.id)!;
    expect(balance.owed).toBe(delivered.total);
    await openDetail(page, cadet.id);
    await expect(page.getByTestId("cadet-detail")).toContainText(formatARS(delivered.total));
    await expect(page.getByTestId("cadet-detail")).not.toContainText(`#${failed.number}`);
    await retireCadets([cadet.id]);
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("the general dispatch view cancels orders of any sector", async ({ page }) => {
    const pos = await counterOrder();
    const del = await placeApproved({ paymentMethod: "cash" });
    await page.goto("/despacho");
    await expect(dcard(page, pos.number)).toBeVisible();
    for (const n of [pos.number, del.number]) {
      await cancelFromCard(page, n);
      await page.getByTestId("cancel-confirm").click();
      await expect(dcard(page, n)).toHaveCount(0);
    }
    expect((await orderById(pos.orderId)).status).toBe("cancelado");
    expect((await orderById(del.id)).status).toBe("cancelado");
  });
});
