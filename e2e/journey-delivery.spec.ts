import { expect, test } from "@playwright/test";
import { inArray } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { freshStationToken, resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { eventsOf, openDelivery, orderById, orderCard, parkPendingOrders, printJobsOf, recentRow } from "./helpers/caja";
import { choosePayment, fillCustomer, fillDelivery, submitButton, unique, uniquePhone } from "./helpers/checkout";
import { currentSettings, db, findStation, findUser, ordersOf } from "./helpers/db";
import { cadetGroup, cleanBoard, dcard, ensureCadet, lane, placeReady, routeOrder, runCleanups, tag } from "./helpers/despacho";
import { cleanupAgents, CUT_HEX, GS_V_0, INIT_HEX, latin1, launchAgent, printedFiles, readPrinted, staffContext, THANKS_TAIL_HEX } from "./helpers/journey";
import { modifierDelta, priceOf } from "./helpers/pos";
import { openDetail, retireCadets, settlementLines, settlementsOf } from "./helpers/rendicion";
import { shot } from "./helpers/shots";
import { cartCount, cta, gotoStore, modifierRow, openSheet, orderBar, sheetOf } from "./helpers/store";
import { currentStep, headline, openTracking } from "./helpers/tracking";

// Delivery orders are approved (and printed) at the Delivery station by the delivery manager.
const STATION = "Delivery 1";

test.use({ storageState: { cookies: [], origins: [] } });
test.afterEach(async () => {
  await cleanupAgents();
  await settleStationJobs(STATION);
  await runCleanups();
  await cleanBoard();
});
test.afterAll(() => resetStationAgentState(STATION));

/**
 * J1: a customer's web delivery order, from the phone to the cadet's cash settlement, through the
 * delivery manager's workspace (Gestión Delivery) and the REAL print agent of the Delivery station. One long test: a failure names the step that broke.
 */
test("J1 web delivery order end to end: customer, delivery manager, print agent, cadet, settlement @mobile", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await settleStationJobs(STATION);
  await parkPendingOrders();
  await cleanBoard();
  const name = unique("Journey");
  const phone = uniquePhone();
  const address = "Av. Journey 742, 5C";
  const settings = await currentSettings();
  const ranchita = await priceOf("Ranchita simple");
  const melt = await priceOf("Melt simple");
  const dips = await modifierDelta("+ Dips de cheddar");
  const sinCheddar = await modifierDelta("Sin cheddar");
  const expectedTotal = 2 * ranchita + sinCheddar + dips + melt + settings.deliveryFee;

  const dispatchCtx = await staffContext(browser, baseURL, "encargada");
  const dispatch = await dispatchCtx.newPage();
  // The cashier's screen (Retiro en local) must never show this delivery order.
  const cashierCtx = await staffContext(browser, baseURL, "cajera");
  const cashier = await cashierCtx.newPage();
  const cadet = await ensureCadet(`Cadete ${tag()}`);

  try {
    let orderId = 0;
    let orderNumber = 0;
    let trackingUrl = "";

    // The print agent of the Delivery station and both staff screens are up BEFORE the customer orders.
    const agent = launchAgent(baseURL!, await freshStationToken(STATION));
    await agent.log.waitFor("Agente conectado");
    await openDelivery(dispatch);
    await expect(dispatch.getByTestId("printer-indicator")).toHaveAttribute("data-online", "true");
    await cashier.goto("/retiro");

    await test.step("the customer builds a per-unit order on a phone and confirms (delivery + transfer)", async () => {
      await gotoStore(page);
      // Two Ranchita with DIFFERENT modifications (one sheet, two units) + a Melt.
      const sheet = await openSheet(page, "Ranchita simple");
      await sheet.getByRole("button", { name: "Aumentar cantidad" }).click();
      const units = sheet.getByTestId("unit-section");
      await expect(units).toHaveCount(2);
      await modifierRow(units.nth(0), "Sin cheddar").click();
      await units.nth(1).getByRole("button", { name: /Ranchita simple #2/ }).click();
      await modifierRow(units.nth(1), "+ Dips de cheddar").click();
      await cta(sheet).click();
      await expect(sheetOf(page)).toBeHidden();
      const meltSheet = await openSheet(page, "Melt simple");
      await cta(meltSheet).click();
      await expect(sheetOf(page)).toBeHidden();
      await expect(cartCount(page)).toHaveText("3");
      await orderBar(page).click();
      await expect(page).toHaveURL(/\/carrito$/);
      await page.getByTestId("cart-continue").click();
      await expect(page).toHaveURL(/\/checkout$/);
      await expect(submitButton(page)).toBeVisible();

      await fillDelivery(page, { address, crossStreets: "Mitre y Sarmiento", notes: "Portón verde" });
      await fillCustomer(page, name, phone);
      await choosePayment(page, "transfer");
      await expect(page.getByTestId("checkout-total")).toHaveText(formatARS(expectedTotal));
      await submitButton(page).click();
      await expect(page).toHaveURL(/\/pedido\/[0-9a-f]{32}(\?nuevo=1)?$/);
      trackingUrl = new URL(page.url()).pathname;

      const [order] = await ordersOf(name);
      orderId = order.id;
      orderNumber = order.number;
      expect(order).toMatchObject({ channel: "web", fulfillment: "delivery", paymentMethod: "transfer", paymentStatus: "pending", status: "pendiente_aprobacion", total: expectedTotal });
    });

    await test.step("the tracking page says Recibido; its polling runs on a controlled clock", async () => {
      await page.clock.install({ time: new Date() });
      await openTracking(page, trackingUrl);
      await expect(headline(page)).toHaveText("Recibimos tu pedido");
      await expect(page.getByTestId("order-number")).toHaveText(`#${orderNumber}`);
      await expect(currentStep(page)).toContainText("Recibido");
      await shot(page, "journey-1-tracking-received-mobile");
    });

    await test.step("the delivery manager sees the order LIVE in Gestión Delivery (no reload), verifies the transfer and approves; the cashier never sees it", async () => {
      const card = orderCard(dispatch, orderNumber);
      await expect(card).toBeVisible(); // the page was opened before the customer ordered: it came through the live stream
      await expect(orderCard(cashier, orderNumber)).toHaveCount(0);
      await expect(card.getByTestId("customer")).toContainText(name);
      await expect(card.getByTestId("order-total")).toHaveText(formatARS(expectedTotal));
      await expect(card.getByTestId("order-line")).toHaveCount(3);
      await expect(card.getByTestId("mod-chip")).toHaveText(["SIN CHEDDAR", "+ DIPS CHEDDAR"]);
      await card.getByRole("checkbox").check(); // "verifiqué la transferencia"
      await card.getByTestId("approve").click();
      await expect(card).toHaveCount(0);
      await expect(dispatch.getByTestId("tab-preparing-count")).toHaveText(/^[1-9]/);
      await shot(dispatch, "journey-1-delivery-approved");
    });

    await test.step("the real agent prints the delivery ticket and the customer ticket with logo and thanks (ESC/POS bytes); no kitchen comanda", async () => {
      await expect.poll(() => printedFiles(agent.outDir).length, { timeout: 15_000 }).toBe(2);
      const [deliveryJob, customerJob] = await printJobsOf(orderId);
      expect([deliveryJob.type, customerJob.type]).toEqual(["delivery", "customer"]);
      const station = await findStation(STATION);
      expect(deliveryJob.stationId).toBe(station.id);
      const delivery = readPrinted(agent.outDir, deliveryJob.id);
      const customer = readPrinted(agent.outDir, customerJob.id);
      for (const bytes of [delivery, customer]) {
        expect(bytes.subarray(0, 5).toString("hex")).toBe(INIT_HEX);
        expect(bytes.toString("hex").endsWith(CUT_HEX)).toBe(true);
      }
      const money = (n: number) => formatARS(n).replace(/ /g, " "); // the printer has no nbsp

      // Delivery (dispatch) ticket: the one that travels with the cadet. No logo, no thanks, no kitchen layout.
      const d = latin1(delivery);
      expect(delivery.includes(GS_V_0)).toBe(false);
      expect(d).toContain(`PEDIDO #${orderNumber}`);
      expect(d).toContain("DELIVERY");
      expect(d).toContain(`Cliente: ${name}`);
      expect(d).toContain("WhatsApp:"); // the phone line (exact digits depend on the normalization)
      expect(d).toContain(address);
      expect(d).toContain("Mitre y Sarmiento");
      expect(d).toContain("Port¢n verde"); // « Portón verde » in cp858
      expect(d).toContain("Pago: Transferencia (pagado)");
      expect(d).toContain(`TOTAL: ${money(expectedTotal)}`);
      expect(d).not.toContain("GRACIAS");
      expect(d).not.toContain("1) RANCHITA SIMPLE"); // the kitchen comanda layout is gone
      // each unit with its modification right under it, customer-facing names
      const u1 = d.indexOf("Ranchita simple");
      const u2 = d.indexOf("Ranchita simple", u1 + 1);
      const u3 = d.indexOf("Melt simple");
      expect(u1).toBeGreaterThanOrEqual(0);
      expect(u2).toBeGreaterThan(u1);
      expect(u3).toBeGreaterThan(u2);
      expect(d.indexOf("Sin cheddar")).toBeGreaterThan(u1);
      expect(d.indexOf("Sin cheddar")).toBeLessThan(u2);
      expect(d.indexOf("+ Dips de cheddar")).toBeGreaterThan(u2);
      expect(d.indexOf("+ Dips de cheddar")).toBeLessThan(u3);

      // Customer ticket: logo raster FIRST (centered, GS v 0), then the brand, items, totals, and the thanks line last.
      const t = latin1(customer);
      expect(customer.subarray(0, 8).toString("hex")).toBe(INIT_HEX + "1b6101"); // init, cp858, centered: nothing before the logo
      expect(customer.subarray(8, 12).equals(GS_V_0)).toBe(true);
      expect(t).toContain("THE BURGER HOUSE 828");
      expect(t).toContain(`Cliente: ${name}`);
      expect(t).toContain(address);
      expect(t).toContain("Pago: Transferencia (pagado)");
      expect(t).toContain(`TOTAL: ${money(expectedTotal)}`);
      expect(t.lastIndexOf("GRACIAS POR TU COMPRA")).toBeGreaterThan(t.lastIndexOf("Pago:"));
      expect(customer.toString("hex").endsWith(THANKS_TAIL_HEX)).toBe(true); // the thanks is the last thing before the cut
    });

    await test.step("Recientes shows the print chip ok, live", async () => {
      await dispatch.getByTestId("tab-recent").click();
      await expect(recentRow(dispatch, orderNumber).getByTestId("print-chip")).toHaveText("Impresión: ok");
    });

    await test.step("the customer's tracking page moves to the kitchen stage by itself (clock-driven polling)", async () => {
      await expect(async () => {
        await page.clock.runFor(8000);
        await expect(headline(page)).toHaveText("Estamos preparando tu pedido", { timeout: 1500 });
        await expect(currentStep(page)).toContainText("Listo");
      }).toPass({ timeout: 45_000 });
      await shot(page, "journey-1-tracking-preparing-mobile");
    });

    let extra: Awaited<ReturnType<typeof placeReady>>[] = [];
    await test.step("En preparación: she marks it Listo; two more cash orders are ready", async () => {
      await dispatch.getByTestId("tab-preparing").click();
      await expect(lane(dispatch, "preparing").locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
      await dcard(dispatch, orderNumber).getByTestId("mark-ready").click();
      await dispatch.getByTestId("tab-ready").click();
      await expect(lane(dispatch, "ready-delivery").locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
      // two extra delivery orders paid in cash, approved and ready (set up through the cores)
      extra = [await placeReady({ fulfillment: "delivery", paymentMethod: "cash" }), await placeReady({ fulfillment: "delivery", paymentMethod: "cash" })];
      for (const e of extra) await expect(lane(dispatch, "ready-delivery").locator(`[data-order-number="${e.number}"]`)).toBeVisible();
    });

    await test.step("the three orders go to ONE cadet in ONE assignment; the customer sees 'En camino'", async () => {
      for (const n of [orderNumber, extra[0].number, extra[1].number]) await dcard(dispatch, n).getByTestId("select-order").check();
      const bar = dispatch.getByTestId("assign-bar");
      await expect(bar.getByTestId("assign-summary")).toContainText("3 pedidos");
      await expect(bar.getByTestId("assign-cash")).toContainText(`Efectivo a cobrar ${formatARS(extra[0].total + extra[1].total)}`);
      await bar.getByTestId("cadet-select").selectOption(String(cadet.id));
      await bar.getByRole("button", { name: `Asignar a ${cadet.name}` }).click();
      await dispatch.getByTestId("tab-enroute").click();
      await expect(cadetGroup(dispatch, cadet.id).getByTestId("route-count")).toHaveText("3 pedidos");
      await expect(async () => {
        await page.clock.runFor(8000);
        await expect(currentStep(page)).toContainText("En camino", { timeout: 1500 });
      }).toPass({ timeout: 45_000 });
      await shot(page, "journey-1-tracking-en-camino-mobile");
    });

    await test.step("the encargada delivers the transfer order and both cash orders; cash stays pending", async () => {
      for (const n of [orderNumber, extra[0].number, extra[1].number]) {
        await routeOrder(dispatch, n).getByTestId("deliver").click();
        await expect(routeOrder(dispatch, n)).toHaveCount(0);
      }
      expect(await orderById(orderId)).toMatchObject({ status: "entregado", paymentStatus: "paid" });
      for (const e of extra) expect(await orderById(e.id)).toMatchObject({ status: "entregado", paymentStatus: "pending" });
    });

    const owed = extra[0].total + extra[1].total;
    await test.step("rendición: 'A rendir' is the sum of the two cash orders; exact settlement leaves balance $0 and a receipt", async () => {
      expect(owed).toBe(2 * (ranchita + sinCheddar + settings.deliveryFee)); // from the seed prices
      await openDetail(dispatch, cadet.id);
      await expect(dispatch.getByTestId("owed-row")).toHaveCount(2);
      await expect(dispatch.getByTestId("owed-amount")).toHaveText(formatARS(owed));
      await dispatch.getByTestId("confirm-settlement").click();
      const dialog = dispatch.getByTestId("confirm-dialog");
      await expect(dialog.getByTestId("confirm-expected")).toHaveText(formatARS(owed));
      await expect(dialog.getByTestId("confirm-received")).toHaveText(formatARS(owed));
      await dialog.getByTestId("confirm-yes").click();
      await expect(dispatch.getByTestId("receipt-title")).toHaveText(/^Rendición #\d+$/);
      await expect(dispatch.getByTestId("receipt-received")).toHaveText(formatARS(owed));
      await expect(dispatch.getByTestId("owed-amount")).toHaveText(formatARS(0));
      await shot(dispatch, "journey-1-rendicion-receipt");
    });

    await test.step("final state across the whole cycle (DB)", async () => {
      const encargada = await findUser("encargada");
      const station = await findStation(STATION);

      expect(await orderById(orderId)).toMatchObject({ status: "entregado", paymentStatus: "paid", approvedBy: encargada.id, stationId: station.id, cadetId: cadet.id });
      for (const e of extra) {
        expect(await orderById(e.id)).toMatchObject({ status: "entregado", paymentStatus: "paid", approvedBy: encargada.id, stationId: station.id, cadetId: cadet.id });
      }

      // print jobs: 2 per approved order, all printed once by the real agent
      const ids = [orderId, ...extra.map((e) => e.id)];
      await expect
        .poll(async () => {
          const rows = await db().select().from(s.printJobs).where(inArray(s.printJobs.orderId, ids));
          return rows.length === 6 && rows.every((j) => j.status === "done" && j.attempts === 1);
        }, { timeout: 20_000 })
        .toBe(true);
      for (const id of ids) expect((await printJobsOf(id)).map((j) => j.type)).toEqual(["delivery", "customer"]);

      // settlement: only the two cash orders, exact, no shortage
      const settlements = await settlementsOf(cadet.id);
      expect(settlements).toHaveLength(1);
      const [st] = settlements;
      expect(st).toMatchObject({ amount: owed, receivedAmount: owed, settledBy: encargada.id });
      expect(st.amount - st.receivedAmount).toBe(0);
      expect((await settlementLines(st.id)).map((l) => l.orderId).sort((a, b) => a - b)).toEqual(extra.map((e) => e.id).sort((a, b) => a - b));

      // the audit trail of the web order: complete, in order, by the right actors
      const events = await eventsOf(orderId);
      expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
        [null, "pendiente_aprobacion"],
        ["pendiente_aprobacion", "en_preparacion"],
        ["en_preparacion", "listo_despacho"],
        ["listo_despacho", "en_camino"],
        ["en_camino", "entregado"],
      ]);
      expect(events.map((e) => e.userId)).toEqual([null, encargada.id, encargada.id, encargada.id, encargada.id]);
      for (let i = 1; i < events.length; i++) expect(events[i].at.getTime()).toBeGreaterThanOrEqual(events[i - 1].at.getTime());
    });
  } finally {
    await cashierCtx.close();
    await dispatchCtx.close();
    await retireCadets([cadet.id]);
  }
});
