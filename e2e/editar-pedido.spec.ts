import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { WRONG_SECTOR_MESSAGE } from "../src/lib/orders/sector";
import { eventsOf, failPrintJob, markJobsDone, openDelivery, openRetiro, orderById, orderCard, parkPendingOrders, placeDeliveryOrder, placeRetiroOrder, printJobsOf } from "./helpers/caja";
import { db, findProduct } from "./helpers/db";
import { cleanBoard, counterOrder, dcard, openPedidos, placeApproved, runCleanups } from "./helpers/despacho";
import { ADDED, addInEditor, additionalJobsOf, addonItemCount, addonsOf, confirmAddonInDb, editor, openRetiroPreparing, seedAddon } from "./helpers/editar";
import { staffContext } from "./helpers/journey";
import { currentStep, openTracking } from "./helpers/tracking";
import { authFile } from "./helpers/users";

test.beforeEach(async () => {
  await parkPendingOrders();
  await cleanBoard();
});
test.afterEach(runCleanups);
test.afterAll(cleanBoard);

const removeUnit = (page: Page, text: string) =>
  editor(page).getByTestId("editor-item").filter({ hasText: text }).getByTestId("editor-remove").click();

test.describe("cajera edits a pending order", () => {
  test.use({ storageState: authFile("cajera") });

  test("removes one product and adds another: the new total is shown before saving and the card, the DB and the audit trail agree", async ({ page }) => {
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    const melt = await findProduct("Melt simple");
    const added = await findProduct(ADDED);
    const expected = o.total - melt.price + added.price;
    await openRetiro(page);
    const card = orderCard(page, o.number);
    await expect(card.getByTestId("order-total")).toHaveText(formatARS(o.total));

    await card.getByTestId("edit-order").click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(page).getByTestId("editor-save")).toBeDisabled(); // nothing changed yet
    await expect(editor(page).getByTestId("editor-total")).toHaveText(formatARS(o.total));

    await removeUnit(page, "Melt simple");
    await expect(editor(page).getByTestId("editor-total")).toHaveText(formatARS(o.total - melt.price));
    await addInEditor(page);
    await expect(editor(page).getByTestId("editor-total")).toHaveText(formatARS(expected));
    await editor(page).getByTestId("editor-save").click();

    await expect(editor(page)).toHaveCount(0);
    await expect(card.getByTestId("order-total")).toHaveText(formatARS(expected));
    await expect(card.getByTestId("order-line").filter({ hasText: "Melt simple" })).toHaveCount(0);
    await expect(card.getByTestId("order-line").filter({ hasText: ADDED })).toHaveCount(1);
    expect((await orderById(o.id)).total).toBe(expected);
    expect((await orderById(o.id)).status).toBe("pendiente_aprobacion");
    const last = (await eventsOf(o.id)).at(-1)!;
    expect(last.fromStatus).toBe("pendiente_aprobacion");
    expect(last.toStatus).toBe("pendiente_aprobacion");
    expect(await printJobsOf(o.id)).toHaveLength(0); // nothing prints before approval
  });

  test("an order cannot be left without products, and Deshacer brings a removed unit back", async ({ page }) => {
    const o = await placeRetiroOrder({ paymentMethod: "cash", single: true });
    await openRetiro(page);
    await orderCard(page, o.number).getByTestId("edit-order").click();
    await removeUnit(page, "Ranchita simple");
    await expect(editor(page).getByTestId("editor-save")).toBeDisabled();
    await expect(editor(page)).toContainText("El pedido no puede quedar sin productos");
    await editor(page).getByTestId("editor-remove").click(); // now "Deshacer"
    await expect(editor(page).getByTestId("editor-total")).toHaveText(formatARS(o.total));
    await editor(page).getByTestId("editor-close").click();
    await expect(editor(page)).toHaveCount(0);
    expect((await orderById(o.id)).total).toBe(o.total);
  });

  test("editing a delivery order keeps the delivery fee untouched", async ({ browser, baseURL }) => {
    const o = await placeDeliveryOrder({ paymentMethod: "cash" });
    const before = await orderById(o.id);
    const melt = await findProduct("Melt simple");
    const ctx = await staffContext(browser, baseURL, "encargada");
    try {
      const page = await ctx.newPage();
      await openDelivery(page);
      const card = orderCard(page, o.number);
      await card.getByTestId("edit-order").click();
      await removeUnit(page, "Melt simple");
      await editor(page).getByTestId("editor-save").click();
      await expect(editor(page)).toHaveCount(0);
      await expect(card.getByTestId("order-total")).toHaveText(formatARS(o.total - melt.price));
      const after = await orderById(o.id);
      expect(after.deliveryFee).toBe(before.deliveryFee);
      expect(after.total).toBe(before.total - melt.price);
    } finally {
      await ctx.close();
    }
  });

  test("if somebody approved the order meanwhile, saving is refused with a message and nothing changes", async ({ page }) => {
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const card = orderCard(page, o.number);
    await card.getByTestId("edit-order").click();
    await removeUnit(page, "Melt simple");
    await addInEditor(page);
    // Approved by somebody else behind this screen's back (no hint reaches the open dialog).
    await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, o.id));
    await editor(page).getByTestId("editor-save").click();
    // A live refresh may then remove the card and the dialog with it.
    await expect(editor(page).getByTestId("editor-error")).toBeVisible();
    expect((await orderById(o.id)).total).toBe(o.total);
    expect(await addonItemCount(o.id)).toBe(0);
  });

  test("the cashier edits a pending order on the phone and the total follows @mobile", async ({ page }) => {
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    const added = await findProduct(ADDED);
    await openRetiro(page);
    const card = orderCard(page, o.number);
    await card.getByTestId("edit-order").click();
    await expect(editor(page)).toBeVisible();
    await addInEditor(page);
    await expect(editor(page).getByTestId("editor-total")).toHaveText(formatARS(o.total + added.price));
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page)).toHaveCount(0);
    await expect(card.getByTestId("order-total")).toHaveText(formatARS(o.total + added.price));
  });
});

test.describe("add-ons on an order in preparation", () => {
  test.use({ storageState: authFile("cajera") });

  test("cash: the add-on goes straight to the kitchen as an ADICIONAL ticket and the total rises", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "cash" });
    const added = await findProduct(ADDED);
    const before = await orderById(o.id);
    const jobsBefore = (await printJobsOf(o.id)).length;
    await openRetiroPreparing(page);
    const card = dcard(page, o.number);
    await card.getByTestId("add-products").click();
    await expect(editor(page)).toBeVisible();
    // Only adding: units already ordered cannot be removed once the kitchen has them.
    await expect(editor(page).getByTestId("editor-remove")).toHaveCount(0);
    await addInEditor(page);
    await expect(editor(page).getByTestId("editor-payment-copy")).toContainText(`Se cobra ${formatARS(added.price)} al entregar`);
    await expect(editor(page).getByTestId("editor-order-total")).toHaveText(formatARS(before.total + added.price));
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page)).toHaveCount(0);

    await expect(card.getByTestId("addon-confirmed")).toHaveCount(1);
    await expect(card.getByTestId("addon-confirmed")).toContainText("Adicional 1");
    const after = await orderById(o.id);
    expect(after.total).toBe(before.total + added.price);
    expect(after.status).toBe("en_preparacion");
    const [addon] = await addonsOf(o.id);
    expect(addon).toMatchObject({ seq: 1, status: "confirmado", subtotal: added.price });
    expect(await addonItemCount(o.id)).toBe(1);

    const additional = await additionalJobsOf(o.id);
    expect(additional).toHaveLength(1);
    expect(additional[0].status).toBe("pending");
    expect(JSON.stringify(additional[0].payload)).toContain("ADICIONAL");
    expect(await printJobsOf(o.id)).toHaveLength(jobsBefore + 1);
    const last = (await eventsOf(o.id)).at(-1)!;
    expect(last.fromStatus).toBe("en_preparacion");
    expect(last.toStatus).toBe("en_preparacion");
  });

  test("transfer: the add-on stays pending (kitchen does not see it); verifying and confirming, even with a double click, adds it once; the customer sees it", async ({ page, browser, baseURL }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "transfer" });
    const added = await findProduct(ADDED);
    const before = await orderById(o.id);
    await openRetiroPreparing(page);
    const card = dcard(page, o.number);
    await card.getByTestId("add-products").click();
    await addInEditor(page);
    await expect(editor(page).getByTestId("editor-payment-copy")).toContainText(`Queda pendiente hasta confirmar la transferencia de ${formatARS(added.price)}`);
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page)).toHaveCount(0);

    const pending = card.getByTestId("addon-pending");
    await expect(pending).toBeVisible();
    await expect(pending.getByTestId("addon-subtotal")).toHaveText(formatARS(added.price));
    const [addon] = await addonsOf(o.id);
    expect(addon.status).toBe("pendiente_pago");
    expect((await orderById(o.id)).total).toBe(before.total); // unpaid money is not in the total
    expect(await addonItemCount(o.id)).toBe(0);
    expect(await additionalJobsOf(o.id)).toHaveLength(0);

    // The customer sees the unpaid block and the old total.
    const customer = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    try {
      const cp = await customer.newPage();
      await openTracking(cp, `/pedido/${o.token}`);
      await expect(cp.getByTestId("pending-addons")).toContainText("Pendiente de pago");
      await expect(cp.getByTestId("pending-addon-subtotal")).toHaveText(formatARS(added.price));
      await expect(cp.getByTestId("order-total")).toHaveText(formatARS(before.total));

      // The confirm button needs the verification checkbox; a double click confirms once.
      const confirm = pending.getByTestId("addon-confirm");
      await expect(confirm).toBeDisabled();
      await pending.getByTestId("addon-verify").check();
      await expect(confirm).toBeEnabled();
      await confirm.dblclick();
      await expect(card.getByTestId("addon-pending")).toHaveCount(0);
      await expect(card.getByTestId("addon-confirmed")).toHaveCount(1);

      const [done] = await addonsOf(o.id);
      expect(done.status).toBe("confirmado");
      expect((await orderById(o.id)).total).toBe(before.total + added.price);
      expect(await addonItemCount(o.id)).toBe(1); // not duplicated
      expect(await additionalJobsOf(o.id)).toHaveLength(1);

      // "Tu pedido" follows by itself (the poller sees the order change): new total, no pending block.
      await expect(cp.getByTestId("order-total")).toHaveText(formatARS(before.total + added.price), { timeout: 30_000 });
      await expect(cp.getByTestId("pending-addons")).toHaveCount(0);
      await expect(cp.getByTestId("order-line").filter({ hasText: ADDED })).toHaveCount(1);
    } finally {
      await customer.close();
    }
  });

  test("marking Listo with an unpaid add-on cancels it and says so", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "transfer" });
    const before = await orderById(o.id);
    const addon = await seedAddon(o.id);
    expect(addon.status).toBe("pendiente_pago");
    await openRetiroPreparing(page);
    const card = dcard(page, o.number);
    await expect(card.getByTestId("addon-pending")).toBeVisible();
    await card.getByTestId("mark-ready").click();

    await expect(page.getByTestId("toast")).toContainText("Se canceló el adicional sin pagar");
    await expect(card.getByTestId("addon-pending")).toHaveCount(0);
    const [row] = await addonsOf(o.id);
    expect(row.status).toBe("cancelado");
    const after = await orderById(o.id);
    expect(after.status).toBe("listo_despacho");
    expect(after.total).toBe(before.total);
    expect(await additionalJobsOf(o.id)).toHaveLength(0);
  });

  test("a pending add-on can be cancelled by hand: nothing is charged, nothing printed", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "transfer" });
    const before = await orderById(o.id);
    await seedAddon(o.id);
    await openRetiroPreparing(page);
    const card = dcard(page, o.number);
    await card.getByTestId("addon-cancel").click();
    await expect(card.getByTestId("addon-pending")).toHaveCount(0);
    expect((await addonsOf(o.id))[0].status).toBe("cancelado");
    expect((await orderById(o.id)).total).toBe(before.total);
    expect(await additionalJobsOf(o.id)).toHaveLength(0);
  });

  test("counter order: the add-on is confirmed at once and the dialog says to charge it now", async ({ page }) => {
    const pos = await counterOrder();
    const added = await findProduct(ADDED);
    const before = await orderById(pos.orderId);
    await openPedidos(page);
    const card = dcard(page, pos.number);
    await card.getByTestId("add-products").click();
    await addInEditor(page);
    await expect(editor(page).getByTestId("editor-payment-copy")).toHaveText(`Cobrá ${formatARS(added.price)} ahora`);
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page)).toHaveCount(0);

    await expect(card.getByTestId("addon-confirmed")).toHaveCount(1);
    const after = await orderById(pos.orderId);
    expect(after.total).toBe(before.total + added.price);
    expect((await addonsOf(pos.orderId))[0].status).toBe("confirmado");
    expect(await additionalJobsOf(pos.orderId)).toHaveLength(1);
  });

  test("a failed additional ticket shows in the red alert with its own Reimprimir adicional button", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "cash" });
    const addon = await seedAddon(o.id);
    expect(addon.status).toBe("confirmado");
    const [job] = await additionalJobsOf(o.id);
    await openRetiro(page);
    try {
      await failPrintJob(job.id, "Sin papel");
      const alert = page.getByTestId("failed-print-alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("Ticket adicional");
      await alert.getByRole("button", { name: `Reimprimir adicional 1 del pedido #${o.number}` }).click();
      await expect(alert).toHaveCount(0);
      const jobs = await additionalJobsOf(o.id);
      expect(jobs).toHaveLength(2);
      expect(jobs.at(-1)).toMatchObject({ status: "pending" });
    } finally {
      await markJobsDone(o.id);
    }
  });
});

test.describe("delivery manager", () => {
  test.use({ storageState: authFile("encargada") });

  test("adds to a delivery order in preparation: the dispatch ticket is printed again with the new total", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "delivery", paymentMethod: "cash" });
    const deliveryJobs = (await printJobsOf(o.id)).filter((j) => j.type === "delivery").length;
    await openDelivery(page, "preparing");
    const card = dcard(page, o.number);
    await card.getByTestId("add-products").click();
    await addInEditor(page);
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page)).toHaveCount(0);
    await expect(card.getByTestId("addon-confirmed")).toHaveCount(1);
    expect(await additionalJobsOf(o.id)).toHaveLength(1);
    expect((await printJobsOf(o.id)).filter((j) => j.type === "delivery")).toHaveLength(deliveryJobs + 1);
  });

  test("server-side guard: a stale card whose order is of the other sector is refused (WRONG_SECTOR) and nothing changes", async ({ page }) => {
    // Not a user flow: the screens already hide the other sector's cards (UAT M11 covers that). The DB flip
    // simulates the other sector behind an open card, to prove the Server Action refuses on its own.
    const o = await placeApproved({ fulfillment: "delivery", paymentMethod: "cash" });
    const before = await orderById(o.id);
    await openDelivery(page, "preparing");
    const card = dcard(page, o.number);
    await expect(card).toBeVisible();
    await db().update(s.orders).set({ fulfillment: "takeaway", deliveryFee: 0 }).where(eq(s.orders.id, o.id));
    await card.getByTestId("add-products").click();
    await addInEditor(page);
    await editor(page).getByTestId("editor-save").click();
    await expect(editor(page).getByTestId("editor-error")).toHaveText(WRONG_SECTOR_MESSAGE);
    expect(await addonsOf(o.id)).toHaveLength(0);
    expect((await orderById(o.id)).total).toBe(before.total);
    await editor(page).getByTestId("editor-close").click();
  });
});

test.describe("cocina (the TV login)", () => {
  test.use({ storageState: authFile("cocina") });

  test("has no way to edit or add: the order screens send it to the TV, which has no controls", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "cash" });
    await page.goto("/mostrador/pedidos");
    await expect(page).toHaveURL(/\/pantalla$/);
    await expect(page.getByTestId("counter-board")).toBeVisible();
    await expect(page.getByTestId("edit-order")).toHaveCount(0);
    await expect(page.getByTestId("add-products")).toHaveCount(0);
    await expect(page.getByTestId("addon-confirm")).toHaveCount(0);
    expect((await orderById(o.id)).status).toBe("en_preparacion");
  });
});

test.describe("Tu pedido with an add-on", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the unpaid block with the old total, then the new total once the add-on is confirmed @mobile", async ({ page }) => {
    const o = await placeApproved({ fulfillment: "takeaway", paymentMethod: "transfer" });
    const added = await findProduct(ADDED);
    const before = await orderById(o.id);
    const addon = await seedAddon(o.id);

    await openTracking(page, `/pedido/${o.token}`);
    await expect(currentStep(page)).toHaveText(/^Listo/);
    await expect(page.getByTestId("pending-addons")).toBeVisible();
    await expect(page.getByTestId("pending-addons")).toContainText("Pendiente de pago");
    await expect(page.getByTestId("pending-addon-subtotal")).toHaveText(formatARS(added.price));
    await expect(page.getByTestId("pending-addon-payment")).toContainText("Te falta pagar");
    await expect(page.getByTestId("order-total")).toHaveText(formatARS(before.total));
    await expect(page.getByTestId("order-line")).toHaveCount(1);

    await confirmAddonInDb(addon.addonId);
    // No reload: the poller notices the change.
    await expect(page.getByTestId("order-total")).toHaveText(formatARS(before.total + added.price), { timeout: 30_000 });
    await expect(page.getByTestId("pending-addons")).toHaveCount(0);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
  });
});
