import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { formatPesosInput } from "../src/lib/rendicion/parse-pesos";
import { resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { eventsOf, openDelivery, openRetiro, orderById, orderCard, parkPendingOrders, placeDeliveryOrder, placeRetiroOrder, printJobsOf, recentRow } from "./helpers/caja";
import { db } from "./helpers/db";
import { cleanBoard, dcard, lane, runCleanups } from "./helpers/despacho";
import { customerContext, staffContext } from "./helpers/journey";
import { cadetCard, deliveredFor, ensureCadet, openDetail, retireCadets, settlementsOf, tag } from "./helpers/rendicion";
import { shot, shotViewport } from "./helpers/shots";
import { headline, openTracking } from "./helpers/tracking";
import { authFile } from "./helpers/users";

const STATION = "Mostrador 1";

test.use({ storageState: authFile("cajera") });
test.afterEach(async () => {
  await settleStationJobs(STATION);
  await runCleanups();
  await cleanBoard();
});
test.afterAll(() => resetStationAgentState(STATION));

/**
 * J3: web takeaway paid in cash at the counter (cashier, Mostrador), a delivery order rejected by the
 * delivery manager (it never shows on the cashier's screen), and a cadet settlement with a shortage.
 */
test("J3 takeaway with cash collected at pickup, a rejection with a reason, and a settlement with a shortage", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  await parkPendingOrders();
  await cleanBoard();
  const dispatchCtx = await staffContext(browser, baseURL, "encargada");
  const customerCtx = await customerContext(browser, baseURL);
  const dispatch = await dispatchCtx.newPage();
  const customer = await customerCtx.newPage();
  const cadet = await ensureCadet(`Faltante ${tag()}`);

  try {
    await openRetiro(page);
    await openDelivery(dispatch);
    const takeaway = await placeRetiroOrder({ paymentMethod: "cash", single: true });
    const rejected = await placeDeliveryOrder({ paymentMethod: "cash", single: true });

    await test.step("the cashier approves the takeaway order: payment stays pending, ONE job (the customer ticket) for the station", async () => {
      const card = orderCard(page, takeaway.number);
      await expect(card).toBeVisible();
      await expect(orderCard(dispatch, rejected.number)).toBeVisible(); // the delivery order is on the delivery manager's screen...
      await expect(orderCard(dispatch, takeaway.number)).toHaveCount(0);
      await expect(orderCard(page, rejected.number)).toHaveCount(0); // ...and NOT on the cashier's
      await card.getByTestId("approve").click();
      await expect(card).toHaveCount(0);
      const row = await orderById(takeaway.id);
      expect(row).toMatchObject({ status: "en_preparacion", paymentStatus: "pending", fulfillment: "takeaway" });
      expect((await printJobsOf(takeaway.id)).map((j) => [j.type, j.status])).toEqual([
        ["kitchen", "pending"],
        ["customer", "pending"],
      ]);
    });

    await test.step("Listo, then Para retirar; delivering needs the collect dialog and then marks it paid", async () => {
      await dcard(page, takeaway.number).getByTestId("mark-ready").click();
      await expect(dcard(page, takeaway.number).getByTestId("pickup-name")).toBeVisible();
      await dcard(page, takeaway.number).getByTestId("call-pickup").click();
      const picked = lane(page, "pickup").locator(`[data-order-number="${takeaway.number}"]`);
      await expect(picked).toBeVisible();
      await picked.getByTestId("deliver").click();
      const dialog = page.getByTestId("collect-dialog");
      await expect(dialog).toContainText(`Cobrá ${formatARS(takeaway.total)} antes de entregar`);
      await expect(dialog.getByTestId("collect-confirm")).toBeDisabled();
      expect((await orderById(takeaway.id)).status).toBe("para_retirar"); // nothing moved yet
      await dialog.getByRole("checkbox", { name: /Cobré/ }).check();
      await dialog.getByTestId("collect-confirm").click();
      await expect(picked).toHaveCount(0);
      const done = await orderById(takeaway.id);
      expect(done).toMatchObject({ status: "entregado", paymentStatus: "paid" });
      expect((await eventsOf(takeaway.id)).map((e) => e.toStatus)).toEqual(["pendiente_aprobacion", "en_preparacion", "listo_despacho", "para_retirar", "entregado"]);
    });

    await test.step("the delivery manager rejects the second order with a reason: cancelled, no print jobs, the customer sees it", async () => {
      const card = orderCard(dispatch, rejected.number);
      await card.getByTestId("reject").click();
      const dialog = dispatch.getByTestId("reject-dialog");
      await dialog.getByRole("button", { name: "Zona sin cobertura" }).click();
      await dialog.getByRole("button", { name: "Rechazar pedido" }).click();
      await expect(card).toHaveCount(0);
      await dispatch.getByTestId("tab-recent").click();
      await expect(recentRow(dispatch, rejected.number).getByTestId("status-chip")).toHaveText("Cancelado");
      expect(await orderById(rejected.id)).toMatchObject({ status: "cancelado", paymentStatus: "pending" });
      expect(await printJobsOf(rejected.id)).toHaveLength(0);
      expect((await eventsOf(rejected.id)).at(-1)).toMatchObject({ toStatus: "cancelado", note: "Zona sin cobertura" });

      await openTracking(customer, `/pedido/${rejected.token}`);
      await expect(headline(customer)).toHaveText("Tu pedido fue cancelado");
      await expect(customer.getByTestId("cancelled-card")).toBeVisible();
      await expect(customer.getByTestId("timeline-step")).toHaveCount(0);
      await shot(customer, "journey-3-cancelled");
      await openTracking(customer, `/pedido/${takeaway.token}`);
      await expect(customer.getByTestId("tracking")).toHaveAttribute("data-status", "entregado");
    });

    const delivered = [await deliveredFor(cadet.id), await deliveredFor(cadet.id)];
    const owed = delivered[0].total + delivered[1].total;
    const missing = 250_00;
    await test.step("cadet settlement with a SHORTAGE: the note is required, amounts are recorded, history shows the badge", async () => {
      await openDetail(dispatch, cadet.id);
      await expect(dispatch.getByTestId("owed-amount")).toHaveText(formatARS(owed));
      const button = dispatch.getByTestId("confirm-settlement");
      await dispatch.getByTestId("received-input").fill(formatPesosInput(owed - missing));
      await expect(dispatch.getByTestId("diff-line")).toContainText(/Faltan\s+\$\s*250/);
      await expect(button).toBeDisabled(); // no note yet
      await dispatch.getByRole("button", { name: "Gastó en nafta" }).click();
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = dispatch.getByTestId("confirm-dialog");
      await expect(dialog.getByTestId("confirm-shortage")).toHaveText(/\$\s*250/);
      await shotViewport(dispatch, "journey-3-confirm-shortage");
      await dialog.getByTestId("confirm-yes").click();
      await expect(dispatch.getByTestId("receipt-shortage")).toHaveText(/\$\s*250/);
      await expect(dispatch.getByTestId("history-shortage")).toBeVisible();
      await dispatch.getByTestId("back-after-settle").click();
      await expect(cadetCard(dispatch, cadet.id).getByTestId("cadet-shortage")).toContainText(/Faltantes acumulados\s+\$\s*250/);
    });

    await test.step("final state (DB)", async () => {
      const [st] = await settlementsOf(cadet.id);
      expect(st).toMatchObject({ amount: owed, receivedAmount: owed - missing, note: "Gastó en nafta" });
      expect(st.amount - st.receivedAmount).toBe(missing);
      for (const d of delivered) expect(await orderById(d.id)).toMatchObject({ status: "entregado", paymentStatus: "paid" });
      const lines = await db().select().from(s.settlementOrders).where(eq(s.settlementOrders.settlementId, st.id));
      expect(lines).toHaveLength(2);
    });
  } finally {
    await dispatchCtx.close();
    await customerCtx.close();
    await retireCadets([cadet.id]);
  }
});
