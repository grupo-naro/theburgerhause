import { expect, test, type Page } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { audioContexts, beeps, eventsOf, failPrintJob, markJobsDone, openRetiro, orderById, orderCard, parkPendingOrders, placeRetiroOrder, printJobsOf, recentRow, stubAudio } from "./helpers/caja";
import { findStation, findUser } from "./helpers/db";
import { currentStep, openTracking } from "./helpers/tracking";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });

test.beforeAll(parkPendingOrders);

const pendingCount = (page: Page) => page.getByTestId("pending-count");

async function approveFromUi(page: Page, number: number, opts: { verify?: boolean } = {}) {
  const card = orderCard(page, number);
  if (opts.verify) await card.getByRole("checkbox").check();
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);
}

test.describe("arrival and alerts", () => {
  test("a new order shows up live with its details; sound toggle persists and beeps exactly once per order", async ({ page }) => {
    await stubAudio(page);
    await parkPendingOrders();
    await openRetiro(page);
    await expect(page.getByTestId("pending-empty")).toBeVisible();
    await expect(page).toHaveTitle("Retiro en local");

    const first = await placeRetiroOrder({ paymentMethod: "cash", unitNote: "bien cocida" });
    const card = orderCard(page, first.number);
    await expect(card).toBeVisible(); // arrived through SSE, no reload
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(`#${first.number}`);
    await expect(card.getByTestId("customer")).toContainText(first.name);
    await expect(card.getByTestId("customer").locator(`a[href="https://wa.me/${first.whatsappDigits}"]`)).toBeVisible();
    await expect(card.getByTestId("order-line")).toHaveCount(3);
    await expect(card.getByTestId("mod-chip")).toHaveText(["SIN CHEDDAR", "+ DIPS CHEDDAR"]);
    await expect(card.getByTestId("unit-note")).toHaveText("Nota: bien cocida");
    await expect(card.getByTestId("order-total")).toHaveText(formatARS(first.total));
    await expect(card).toHaveAttribute("data-fresh", "true");
    await expect(pendingCount(page)).toHaveText("1");
    await expect(page).toHaveTitle(/^\(1\) (Retiro en local|¡Nuevo pedido!)$/);
    await expect(page.getByTestId("caja-announcer")).toHaveText(`Nuevo pedido #${first.number}`);
    // Sound is off by default: nothing played, and the page says how to turn it on.
    expect(await beeps(page)).toBe(0);
    await expect(page.getByTestId("sound-hint")).toContainText("Activá el sonido para escuchar los pedidos nuevos");
    await expect(page.getByTestId("sound-toggle")).toHaveText(/Sonido: desactivado/);

    // Turning it on plays one confirmation beep; the hint goes away.
    await page.getByTestId("sound-toggle").click();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sound-toggle")).toHaveText(/Sonido: activado/);
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
    const afterToggle = await beeps(page);
    expect(afterToggle).toBe(1);

    // ON: exactly one beep for the next arrival.
    const second = await placeRetiroOrder({ paymentMethod: "transfer", fulfillment: "takeaway" });
    await expect(orderCard(page, second.number)).toBeVisible();
    await expect(pendingCount(page)).toHaveText("2");
    expect(await beeps(page)).toBe(afterToggle + 1);

    // The preference survives a reload, and the already-seen orders do not beep again.
    await page.reload();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(orderCard(page, second.number)).toBeVisible();
    expect(await beeps(page)).toBe(0);

    // OFF: silence for the next arrival, and OFF persists too.
    await page.getByTestId("sound-toggle").click();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
    const third = await placeRetiroOrder({ paymentMethod: "cash" });
    await expect(orderCard(page, third.number)).toBeVisible();
    await expect(pendingCount(page)).toHaveText("3");
    expect(await beeps(page)).toBe(0);
    await page.reload();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("a stored sound preference does not create an AudioContext until the first gesture", async ({ page }) => {
    await stubAudio(page);
    await page.addInitScript(() => window.localStorage.setItem("caja:sound", "on"));
    await parkPendingOrders();
    const o = await placeRetiroOrder();
    await openRetiro(page);
    await expect(orderCard(page, o.number)).toBeVisible();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sound-hint")).toContainText("Tocá cualquier parte");
    expect(await audioContexts(page)).toBe(0);

    await page.mouse.click(5, 5); // any gesture
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
    expect(await audioContexts(page)).toBe(1);
    const next = await placeRetiroOrder();
    await expect(orderCard(page, next.number)).toBeVisible();
    expect(await beeps(page)).toBe(1);
  });

  test("an unfocused tab flashes the title until it is focused again", async ({ page }) => {
    await page.addInitScript(() => {
      document.hasFocus = () => false;
    });
    await parkPendingOrders();
    await openRetiro(page);
    const o = await placeRetiroOrder();
    await expect(orderCard(page, o.number)).toBeVisible();
    await expect(page).toHaveTitle(/¡Nuevo pedido!/); // alternates with "(1) Retiro en local"
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveTitle("(1) Retiro en local");
  });

  test("the highlight on a new card expires by itself", async ({ page }) => {
    await parkPendingOrders();
    await openRetiro(page);
    const o = await placeRetiroOrder();
    const card = orderCard(page, o.number);
    await expect(card).toHaveAttribute("data-fresh", "true");
    await expect(card).not.toHaveAttribute("data-fresh", "true", { timeout: 8000 });
  });
});

test.describe("approve", () => {
  test("cash: Aprobar moves it to Recientes en preparación with pending print chips; 2 print jobs for Mostrador 1", async ({ page, browser, baseURL }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const card = orderCard(page, o.number);
    await expect(card.getByTestId("approve")).toHaveText("Aprobar");
    await expect(card.getByText("El cobro queda pendiente (lo cobra el cadete / en el local)")).toBeVisible();
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    await card.getByTestId("approve").click();

    await expect(card).toHaveCount(0);
    await expect(pendingCount(page)).toHaveText("0");
    const row = recentRow(page, o.number);
    await expect(row.getByTestId("status-chip")).toHaveText("En preparación");
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: pendiente");
    await expect(row.getByTestId("payment-state")).toContainText("Cobro pendiente");

    const station = await findStation("Mostrador 1");
    const cashier = await findUser("cajera");
    const jobs = await printJobsOf(o.id);
    expect(jobs.map((j) => j.type)).toEqual(["kitchen", "ticket"]);
    expect(jobs.every((j) => j.stationId === station.id && j.status === "pending")).toBe(true);
    const kitchen = JSON.stringify(jobs[0].payload);
    expect(kitchen).toContain("SIN CHEDDAR");
    expect(kitchen).toContain("+ DIPS CHEDDAR");
    const order = await orderById(o.id);
    expect(order).toMatchObject({ status: "en_preparacion", paymentStatus: "pending", approvedBy: cashier.id });

    // The customer's tracking page follows.
    const customer = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    try {
      const cp = await customer.newPage();
      await openTracking(cp, `/pedido/${o.token}`);
      await expect(currentStep(cp)).toContainText("En preparación");
    } finally {
      await customer.close();
    }
  });

  test("transfer: the button stays disabled until the payment is verified; then it is paid and the ticket says so", async ({ page }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "transfer", fulfillment: "takeaway" });
    await openRetiro(page);
    const card = orderCard(page, o.number);
    const approve = card.getByTestId("approve");
    const check = card.getByRole("checkbox", { name: `Verifiqué la acreditación del pago de ${formatARS(o.total)}` });
    await expect(approve).toHaveText("Aprobar y pagado");
    await expect(approve).toBeDisabled();
    await expect(card.getByTestId("approve-hint")).toHaveText("Tildá la verificación del pago para aprobar");
    await check.check();
    await expect(approve).toBeEnabled();
    await check.uncheck();
    await expect(approve).toBeDisabled();
    await check.check();
    await approve.click();

    await expect(card).toHaveCount(0);
    await expect(recentRow(page, o.number).getByTestId("payment-state")).toContainText("Pagado");
    expect((await orderById(o.id)).paymentStatus).toBe("paid");
    const ticket = (await printJobsOf(o.id)).find((j) => j.type === "ticket")!;
    expect(JSON.stringify(ticket.payload)).toContain("Pago: Transferencia (pagado)");
  });

  test("double click and Enter twice fire the action once", async ({ page }) => {
    await parkPendingOrders();
    const a = await placeRetiroOrder({ paymentMethod: "cash" });
    const b = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
    });

    await orderCard(page, a.number).getByTestId("approve").dblclick();
    await expect(orderCard(page, a.number)).toHaveCount(0);
    await expect(recentRow(page, a.number)).toBeVisible();

    const second = orderCard(page, b.number).getByTestId("approve");
    await second.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(orderCard(page, b.number)).toHaveCount(0);
    await expect(recentRow(page, b.number)).toBeVisible();

    expect(actions).toHaveLength(2); // one Server Action POST per order
    for (const o of [a, b]) {
      expect(await printJobsOf(o.id)).toHaveLength(2);
      expect((await eventsOf(o.id)).filter((e) => e.toStatus === "en_preparacion")).toHaveLength(1);
    }
    await expect(page.getByTestId("card-conflict")).toHaveCount(0);
  });

  test("two cashier terminals approving at once: one wins, the other sees the Spanish conflict message", async ({ browser, baseURL }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    const open = async (user: "cajera") => {
      const context = await browser.newContext({ baseURL, storageState: authFile(user), extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
      const page = await context.newPage();
      await openRetiro(page);
      await expect(orderCard(page, o.number)).toBeVisible();
      return { context, page };
    };
    const a = await open("cajera");
    const b = await open("cajera");
    try {
      await Promise.all([orderCard(a.page, o.number).getByTestId("approve").click(), orderCard(b.page, o.number).getByTestId("approve").click()]);

      const conflicts = () => Promise.all([a.page.getByTestId("card-conflict").count(), b.page.getByTestId("card-conflict").count()]).then(([x, y]) => x + y);
      await expect.poll(conflicts).toBe(1);
      const loser = (await a.page.getByTestId("card-conflict").count()) === 1 ? a.page : b.page;
      await expect(loser.getByTestId("card-conflict")).toContainText("Este pedido ya está en preparación");
      await expect(a.page.getByText("Application error")).toHaveCount(0);
      await expect(b.page.getByText("Application error")).toHaveCount(0);

      const jobs = await printJobsOf(o.id);
      expect(jobs).toHaveLength(2);
      expect(new Set(jobs.map((j) => j.stationId)).size).toBe(1);
      expect((await eventsOf(o.id)).filter((e) => e.toStatus === "en_preparacion")).toHaveLength(1);

      // "Entendido" dismisses the frozen card.
      await loser.getByRole("button", { name: "Entendido" }).click();
      await expect(orderCard(loser, o.number)).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});

test.describe("reject", () => {
  test("the dialog needs a reason of 3+ characters; a quick reason fills it; the order is cancelled without print jobs", async ({ page, browser, baseURL }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const card = orderCard(page, o.number);
    await card.getByTestId("reject").click();

    const dialog = page.getByTestId("reject-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Motivo")).toBeFocused();
    const confirm = dialog.getByRole("button", { name: "Rechazar pedido" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Motivo").fill("ab");
    await expect(confirm).toBeDisabled();

    // Esc closes it and focus returns to the Rechazar button.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(card.getByTestId("reject")).toBeFocused();
    expect((await orderById(o.id)).status).toBe("pendiente_aprobacion");

    // Backdrop click closes as well.
    await card.getByTestId("reject").click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);

    await card.getByTestId("reject").click();
    await dialog.getByRole("button", { name: "Zona sin cobertura" }).click();
    await expect(dialog.getByLabel("Motivo")).toHaveValue("Zona sin cobertura");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(card).toHaveCount(0);
    await expect(recentRow(page, o.number).getByTestId("status-chip")).toHaveText("Cancelado");
    const order = await orderById(o.id);
    expect(order.status).toBe("cancelado");
    expect(await printJobsOf(o.id)).toHaveLength(0);
    const last = (await eventsOf(o.id)).at(-1)!;
    expect(last).toMatchObject({ toStatus: "cancelado", note: "Zona sin cobertura" });

    const customer = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    try {
      const cp = await customer.newPage();
      await openTracking(cp, `/pedido/${o.token}`);
      await expect(cp.getByTestId("status-headline")).toContainText(/cancel/i);
    } finally {
      await customer.close();
    }
  });
});

test.describe("failed prints", () => {
  test("the red alert appears live, Reimprimir queues new jobs for THIS station and the alert clears", async ({ page }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    await expect(recentRow(page, o.number)).toBeVisible();
    const station = await findStation("Mostrador 1");
    const [kitchen] = await printJobsOf(o.id);
    try {
      await expect(page.getByTestId("failed-print-alert")).toHaveCount(0);
      await failPrintJob(kitchen.id, "Sin papel en la impresora");

      const alert = page.getByTestId("failed-print-alert");
      await expect(alert).toBeVisible(); // live: no reload
      await expect(alert).toContainText("1 impresión falló");
      const row = alert.getByTestId("failed-print");
      await expect(row).toContainText(`Pedido #${o.number}`);
      await expect(row).toContainText("Cocina: Sin papel en la impresora · 3 intentos");
      await expect(recentRow(page, o.number).locator('[data-state="failed"]')).toHaveText("Impresión: falló");
      await expect(page.getByTestId("printer-indicator")).toContainText(/1 (impresión )?fallida/);

      await row.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
      await expect(alert).toHaveCount(0);

      const jobs = await printJobsOf(o.id);
      expect(jobs).toHaveLength(3);
      const reprint = jobs.at(-1)!;
      expect(reprint).toMatchObject({ type: "kitchen", status: "pending", stationId: station.id, attempts: 0 });
      await expect(page.getByTestId("printer-indicator")).not.toContainText("fallida");
      await expect(recentRow(page, o.number).locator('[data-state="failed"]')).toHaveCount(0);

      // The reprinted job fails too: the alert returns with a fresh, enabled button.
      await failPrintJob(reprint.id, "Se trabó el papel");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("Cocina: Se trabó el papel");
      const again = alert.getByRole("button", { name: `Reimprimir pedido #${o.number}` });
      await expect(again).toBeEnabled();
      await expect(again).toHaveText("Reimprimir");
    } finally {
      // Leave no failed job behind for other specs.
      await markJobsDone(o.id);
    }
  });

  test("Reimprimir from Recientes (Cocina / Ticket / Ambas) queues the right jobs for the current station", async ({ page }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    const row = recentRow(page, o.number);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
    await row.getByRole("button", { name: "Ticket" }).click();
    await expect.poll(async () => (await printJobsOf(o.id)).length).toBe(3);
    expect((await printJobsOf(o.id)).at(-1)).toMatchObject({ type: "ticket", status: "pending" });
    await row.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
    await row.getByRole("button", { name: "Ambas" }).click();
    await expect.poll(async () => (await printJobsOf(o.id)).length).toBe(5);
  });
});

test.describe("urgency", () => {
  test("the elapsed badge turns amber after 5 minutes and red after 10, without reloading", async ({ page }) => {
    await parkPendingOrders();
    const o = await placeRetiroOrder();
    await page.clock.install({ time: new Date() });
    await openRetiro(page);
    const badge = orderCard(page, o.number).getByTestId("elapsed");
    await expect(badge).toHaveAttribute("data-urgency", "normal");

    await page.clock.fastForward("05:01");
    await expect(badge).toHaveAttribute("data-urgency", "warning");
    await expect(badge).toContainText("Demora");

    await page.clock.fastForward("05:30");
    await expect(badge).toHaveAttribute("data-urgency", "urgent");
    await expect(badge).toContainText("Urgente");
    await expect(badge).toContainText(/hace 10 min|hace 11 min/);
  });
});
