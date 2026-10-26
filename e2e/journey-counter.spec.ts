import { expect, test } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { freshStationToken, resetStationAgentState } from "./helpers/agent";
import { openRetiro, recentRow } from "./helpers/caja";
import { cleanBoard, dcard, lane, openPedidos } from "./helpers/despacho";
import { cleanupAgents, GS_V_0, INIT_HEX, latin1, launchAgent, printedFiles, readPrinted, THANKS_TAIL_HEX } from "./helpers/journey";
import {
  chargeButton,
  jobsOf,
  latestCounterOrder,
  linesOf,
  openPos,
  overlay,
  pagerInput,
  priceOf,
  releaseCounterState,
  STATION,
  tileCustomize,
  tileMain,
  totalOf,
  typePager,
} from "./helpers/pos";
import { shot } from "./helpers/shots";
import { modifierRow } from "./helpers/store";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });
test.afterEach(async () => {
  await cleanupAgents();
  await releaseCounterState();
  await cleanBoard();
});
test.afterAll(() => resetStationAgentState(STATION));

/** J2: a counter sale with a pager, from the POS to the handover, with the real print agent. */
test("J2 counter sale: POS, pager 7, real printing, dispatch pickup lane, pager reuse rules", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  await releaseCounterState();
  await cleanBoard();
  const cuarto = await priceOf("Cuarto de libra simple");
  const melt = await priceOf("Melt simple");
  const total = cuarto + melt;
  const customer = `Mostrador ${Date.now().toString(36)}`;

  // The same cashier works three screens: the POS (Venta), the counter orders (Mostrador) and Retiro en local (Recientes).
  const dispatch = await page.context().newPage();
  const caja = await page.context().newPage();
  try {
    const agent = launchAgent(baseURL!, await freshStationToken(STATION));
    await agent.log.waitFor("Agente conectado");
    await openRetiro(caja);
    await openPedidos(dispatch);
    await openPos(page);

    await test.step("POS: a customized unit + a plain one, cash with change, pager 7", async () => {
      await tileCustomize(page, "Cuarto de libra simple").click();
      const dialog = page.getByTestId("configure-dialog");
      await modifierRow(dialog, "Sin cheddar").click();
      await dialog.getByTestId("configure-confirm").click();
      await expect(dialog).toHaveCount(0);
      await tileMain(page, "Melt simple").click();
      await expect(totalOf(page)).toHaveText(formatARS(total));
      await expect(linesOf(page, "Cuarto de libra simple").first().getByTestId("line-chip")).toHaveText(["Sin cheddar"]);
      await page.getByTestId("pay-cash").click();
      await page.getByTestId("received-input").fill(String(total / 100 + 2000));
      await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", "change");
      await expect(page.getByTestId("change-amount")).toHaveText(formatARS(200_000));
      await typePager(page, "7");
      await expect(pagerInput(page)).toHaveValue("7");
      await page.getByTestId("customer-name").fill(customer);
      await expect(chargeButton(page)).toBeEnabled();
    });

    let orderId = 0;
    let orderNumber = 0;
    await test.step("charge: the overlay says Llamador 7 and the order is paid and in preparation", async () => {
      await chargeButton(page).click();
      await expect(overlay(page)).toBeVisible();
      await expect(page.getByTestId("confirm-pager")).toHaveText("Llamador 7");
      const order = await latestCounterOrder();
      orderId = order.id;
      orderNumber = order.number;
      expect(order).toMatchObject({ channel: "counter", status: "en_preparacion", paymentMethod: "cash", paymentStatus: "paid", pagerNumber: 7, total });
      await shot(page, "journey-2-overlay");
    });

    await test.step("the real agent prints the kitchen comanda (MOSTRADOR, LLAMADOR 7, units with kitchen labels) and then the customer ticket with logo, LLAMADOR 7, paid in cash, thanks; the overlay turns to Impreso", async () => {
      await expect.poll(() => printedFiles(agent.outDir).length, { timeout: 15_000 }).toBe(2);
      const jobs = await jobsOf(orderId);
      expect(jobs.map((j) => j.type)).toEqual(["kitchen", "customer"]);
      const kitchen = latin1(readPrinted(agent.outDir, jobs[0].id));
      expect(kitchen).toContain(`PEDIDO #${orderNumber}`);
      expect(kitchen).toContain("MOSTRADOR");
      expect(kitchen).toContain("LLAMADOR 7");
      expect(kitchen).toContain("SIN CHEDDAR");
      expect(kitchen).not.toContain("TOTAL");
      const bytes = readPrinted(agent.outDir, jobs[1].id);
      const ticket = latin1(bytes);
      expect(bytes.subarray(0, 8).toString("hex")).toBe(INIT_HEX + "1b6101"); // logo first, centered
      expect(bytes.subarray(8, 12).equals(GS_V_0)).toBe(true);
      expect(ticket).toContain("LLAMADOR 7");
      expect(ticket).toContain("Pago: Efectivo (pagado)");
      expect(ticket).toContain("Sin cheddar"); // the customized unit, customer-facing wording
      expect(ticket).not.toContain("MOSTRADOR"); // the service type banner belongs to the kitchen comanda only
      expect(ticket).not.toContain("SIN CHEDDAR");
      expect(bytes.toString("hex").endsWith(THANKS_TAIL_HEX)).toBe(true);
      await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "done", { timeout: 15_000 });
      await expect(recentRow(caja, orderNumber).getByTestId("print-chip")).toHaveText("Impresión: ok");
    });

    await test.step("Mostrador: it is in the counter lanes; Listo, then Llamar / Para retirar, then Entregado", async () => {
      await expect(lane(dispatch, "preparing").locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
      await dcard(dispatch, orderNumber).getByTestId("mark-ready").click();
      const ready = lane(dispatch, "ready-counter").locator(`[data-order-number="${orderNumber}"]`);
      await expect(ready.getByTestId("pager-number")).toContainText("7");
      await ready.getByTestId("call-pickup").click();
      const picked = lane(dispatch, "pickup").locator(`[data-order-number="${orderNumber}"]`);
      await expect(picked).toBeVisible();
      await picked.getByTestId("deliver").click(); // already paid: no collect dialog
      await expect(picked).toHaveCount(0);
      expect((await latestCounterOrder()).status).toBe("entregado");
    });

    await test.step("pager 7 is free again for a NEW sale (the keypad does not list it as in use)", async () => {
      await page.getByTestId("new-sale").click();
      await expect(overlay(page)).toHaveCount(0);
      await tileMain(page, "Melt simple").click();
      await page.getByTestId("pay-cash").click();
      await expect(page.getByTestId("pager-badge")).toHaveCount(0);
      await typePager(page, "7");
      await expect(page.getByTestId("pager-status")).toContainText("Llamador 7 libre");
      await expect(chargeButton(page)).toBeEnabled();
      await chargeButton(page).click();
      await expect(overlay(page)).toBeVisible();
      const second = await latestCounterOrder();
      expect(second.id).not.toBe(orderId);
      expect(second).toMatchObject({ pagerNumber: 7, status: "en_preparacion" });

      // a third sale reusing 7 BEFORE the second is delivered is refused, naming that order
      await page.getByTestId("new-sale").click();
      await tileMain(page, "Melt simple").click();
      await page.getByTestId("pay-cash").click();
      await typePager(page, "7");
      await expect(page.getByTestId("pager-status")).toHaveText(`Llamador 7 en uso por el pedido #${second.number}`);
      await expect(page.getByTestId("charge-reason")).toHaveText(`El llamador 7 está en uso (pedido #${second.number})`);
      await expect(chargeButton(page)).toBeDisabled();
      await shot(page, "journey-2-pager-in-use");
    });

    await test.step("final state (DB)", async () => {
      const order = await latestCounterOrder();
      expect(order.status).toBe("en_preparacion"); // the second sale
      expect((await jobsOf(orderId)).every((j) => j.status === "done")).toBe(true);
    });
  } finally {
    await dispatch.close();
    await caja.close();
  }
});
