import { expect, test, type Page } from "@playwright/test";
import { FakeAgent, freshStationToken, resetStationAgentState } from "./helpers/agent";
import { countEventSources, failPrintJob, openRetiro, recentRow } from "./helpers/caja";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db, findStation, findUser, setProductActiveInDb } from "./helpers/db";
import {
  chargeButton,
  counterOrderCount,
  deliverOrderInDb,
  formatARS,
  itemsOf,
  jobsOf,
  latestCounterOrder,
  linesOf,
  openPos,
  overlay,
  pagerInput,
  POS_CART_PREFIX,
  priceOf,
  readySale,
  releaseCounterState,
  seedCounterOrder,
  STATION,
  tileMain,
  ticketLines,
  totalOf,
  typePager,
} from "./helpers/pos";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("cajera") });
test.afterEach(releaseCounterState);
test.afterAll(() => resetStationAgentState(STATION));

const reason = (page: Page) => page.getByTestId("charge-reason");

test("cash sale: disabled reasons in sequence, change, charge, DB rows, two tickets printed, Caja shows it live", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  await releaseCounterState();
  const ranchita = await priceOf("Ranchita simple");
  const melt = await priceOf("Melt simple");
  const total = ranchita + melt;
  const token = await freshStationToken(STATION);
  const caja = await context.newPage();
  await openRetiro(caja);
  await openPos(page);
  const agent = await FakeAgent.connect(baseURL!, token);
  try {
    // The button says what is missing, step by step.
    await expect(chargeButton(page)).toBeDisabled();
    await expect(reason(page)).toHaveText("Agregá productos al ticket");
    await tileMain(page, "Ranchita simple").click();
    await tileMain(page, "Melt simple").click();
    await expect(reason(page)).toHaveText("Elegí el método de pago");
    await expect(page.getByTestId("pay-cash")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("pay-transfer")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("pay-cash").click();
    await expect(page.getByTestId("pay-cash")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("pay-transfer")).toHaveAttribute("aria-pressed", "false");
    await expect(reason(page)).toHaveText("Ingresá el llamador");

    // Recibido: quick amounts are the exact total and the next bills; the change is exact.
    const bump = (b: number) => Math.ceil(total / b) * b;
    const expected = [...new Set([total, bump(100_000), bump(200_000), bump(500_000), bump(1_000_000), bump(2_000_000)])].sort((a, b) => a - b);
    const quick = page.getByTestId("quick-amount");
    await expect(quick).toHaveCount(expected.length);
    expect(await quick.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-cents"))))).toEqual(expected);
    await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", "none");
    await quick.first().click(); // exact
    await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", "exact");
    await page.getByTestId("received-input").fill(String((total - 100_000) / 100));
    await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", "short");
    await expect(page.getByTestId("change-amount")).toHaveText(formatARS(100_000));
    const biggest = expected[expected.length - 1];
    await quick.last().click();
    await expect(page.getByTestId("change-box")).toHaveAttribute("data-kind", biggest === total ? "exact" : "change");
    if (biggest !== total) await expect(page.getByTestId("change-amount")).toHaveText(formatARS(biggest - total));

    // Pager through the keypad: 7. Only now is the button enabled.
    await typePager(page, "7");
    await expect(pagerInput(page)).toHaveValue("7");
    await expect(chargeButton(page)).toBeEnabled();
    await expect(chargeButton(page)).toHaveText(`Cobrar e imprimir · ${formatARS(total)}`);
    const name = `Ana Mostrador ${Date.now()}`;
    await page.getByTestId("customer-name").fill(name);

    await chargeButton(page).click();
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByTestId("confirm-pager")).toHaveText("Llamador 7");
    await expect(page.getByTestId("confirm-total")).toHaveText(formatARS(total));
    await expect(page.getByTestId("confirm-payment")).toHaveText("Efectivo");
    await expect(page.getByTestId("new-sale")).toBeFocused();
    await expect(ticketLines(page)).toHaveCount(0);

    // DB: the paid, in-preparation counter order with per-unit snapshots and exactly 2 jobs.
    const order = await latestCounterOrder();
    await expect(page.getByTestId("confirm-order")).toHaveText(`Pedido #${order.number}`);
    const cajera = await findUser("cajera");
    const station = await findStation(STATION);
    expect(order).toMatchObject({
      channel: "counter",
      fulfillment: "takeaway",
      status: "en_preparacion",
      paymentMethod: "cash",
      paymentStatus: "paid",
      pagerNumber: 7,
      approvedBy: cajera.id,
      stationId: station.id,
      subtotal: total,
      deliveryFee: 0,
      total,
      customerName: name,
    });
    const items = await itemsOf(order.id);
    expect(items.map((i) => [i.nameSnapshot, i.unitPriceSnapshot])).toEqual([
      ["Ranchita simple", ranchita],
      ["Melt simple", melt],
    ]);
    const jobs = await jobsOf(order.id);
    expect(jobs.map((j) => [j.type, j.stationId])).toEqual([
      ["kitchen", station.id],
      ["ticket", station.id],
    ]);

    // The agent receives both and acks: the overlay goes from "Imprimiendo…" to "Impreso ✓".
    await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "printing");
    const got = await agent.jobs(2, 5000);
    expect(got.map((j) => j.type)).toEqual(["kitchen", "ticket"]);
    for (const j of got) expect((await agent.ack(j.id, "done")).status).toBe(200);
    await expect(page.getByTestId("print-status")).toHaveAttribute("data-status", "done", { timeout: 15_000 });
    await expect(page.getByTestId("print-status")).toContainText("Impreso");

    // Caja lists it live in "Recientes".
    await expect(recentRow(caja, order.number)).toBeVisible();

    // One Enter starts the next sale with everything reset.
    await page.keyboard.press("Enter");
    await expect(overlay(page)).toHaveCount(0);
    await expect(pagerInput(page)).toHaveValue("");
    await expect(page.getByTestId("pay-cash")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("customer-name")).toHaveValue("");
    await expect(reason(page)).toHaveText("Agregá productos al ticket");
    await expect(totalOf(page)).toHaveText(formatARS(0));
  } finally {
    await agent.stop();
  }
});

test("transfer sale is paid at once: ticket says 'Pago: Transferencia (pagado)' and 'LLAMADOR 8'; Ctrl+Enter charges", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await releaseCounterState();
  const melt = await priceOf("Melt simple");
  const token = await freshStationToken(STATION);
  await openPos(page);
  const agent = await FakeAgent.connect(baseURL!, token);
  try {
    await tileMain(page, "Melt simple").click();
    await page.getByTestId("pay-transfer").click();
    await expect(page.getByTestId("transfer-reminder")).toHaveText("Verificá la transferencia antes de cobrar");
    await expect(page.getByTestId("cash-helper")).toHaveCount(0);
    await typePager(page, "8");
    await expect(chargeButton(page)).toBeEnabled();
    await page.keyboard.press("Control+Enter");
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByTestId("confirm-payment")).toHaveText("Transferencia");
    const order = await latestCounterOrder();
    expect(order).toMatchObject({ paymentMethod: "transfer", paymentStatus: "paid", pagerNumber: 8, status: "en_preparacion", total: melt, customerName: null });
    const [kitchen, ticket] = await agent.jobs(2, 5000);
    expect(JSON.stringify(ticket.document)).toContain("Pago: Transferencia (pagado)");
    expect(JSON.stringify(ticket.document)).toContain("LLAMADOR 8");
    expect(JSON.stringify(kitchen.document)).toContain("LLAMADOR 8");
    for (const j of [kitchen, ticket]) await agent.ack(j.id, "done");
  } finally {
    await agent.stop();
  }
});

test("pager in use: badges with order numbers, conflict message, Siguiente libre, frees up when the order is delivered", async ({ page }) => {
  await releaseCounterState();
  const a = await seedCounterOrder(1);
  const b = await seedCounterOrder(2);
  const c = await seedCounterOrder(7);
  await openPos(page);
  await tileMain(page, "Ranchita simple").click();
  await page.getByTestId("pay-cash").click();

  const badges = page.getByTestId("pager-badge");
  await expect(badges).toHaveCount(3);
  await expect(page.getByTestId("pager-badge").filter({ hasText: `#${c.number}` })).toHaveAttribute("data-pager", "7");
  expect(a.number).not.toBe(b.number);

  await typePager(page, "7");
  await expect(page.getByTestId("pager-status")).toHaveText(`Llamador 7 en uso por el pedido #${c.number}`);
  await expect(chargeButton(page)).toBeDisabled();
  await expect(reason(page)).toHaveText(`El llamador 7 está en uso (pedido #${c.number})`);

  // Siguiente libre: the lowest free number (1 and 2 are taken -> 3).
  await page.getByTestId("pager-next-free").click();
  await expect(pagerInput(page)).toHaveValue("3");
  await expect(chargeButton(page)).toBeEnabled();

  // Order #c is delivered: its number frees up on the next refresh (event-driven, no reload).
  await page.getByTestId("pager-key-clear").click();
  await typePager(page, "7");
  await expect(chargeButton(page)).toBeDisabled();
  await deliverOrderInDb(c.orderId);
  await expect(page.getByTestId("pager-badge")).toHaveCount(2);
  await expect(chargeButton(page)).toBeEnabled();
  await expect(page.getByTestId("pager-status")).toContainText("Llamador 7 libre");
});

test("PAGER_IN_USE from the server (stale list): keypad error, nothing charged, list refreshed", async ({ page }) => {
  await releaseCounterState();
  // No live stream: this page cannot learn about the other sale on its own.
  await page.route("**/api/events", (route) => route.abort());
  await page.goto("/mostrador");
  await expect(page.getByTestId("pos-board")).toHaveAttribute("data-ready", "true");
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "9" });
  const before = await counterOrderCount();
  const other = await seedCounterOrder(9); // somebody else takes pager 9 meanwhile
  await chargeButton(page).click();
  await expect(page.getByTestId("pager-status")).toHaveText(`Llamador 9 en uso por el pedido #${other.number}`);
  await expect(overlay(page)).toHaveCount(0);
  expect(await counterOrderCount()).toBe(before + 1); // only the other sale exists
  await expect(ticketLines(page)).toHaveCount(1); // the ticket is intact
  await expect(page.getByTestId("pager-badge").filter({ hasText: `#${other.number}` })).toBeVisible();
  await expect(chargeButton(page)).toBeDisabled();
  // Another number works.
  await page.getByTestId("pager-key-back").click();
  await typePager(page, "4");
  await expect(chargeButton(page)).toBeEnabled();
});

test("double submit: two Ctrl+Enter in the same tick and a double click create ONE order and ONE set of jobs", async ({ page }) => {
  await releaseCounterState();
  await openPos(page);
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "5" });
  const before = await counterOrderCount();
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  await expect(overlay(page)).toBeVisible();
  expect(await counterOrderCount()).toBe(before + 1);
  const first = await latestCounterOrder();
  expect((await jobsOf(first.id)).map((j) => j.type)).toEqual(["kitchen", "ticket"]);
  await page.getByTestId("new-sale").click();

  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "6" });
  await chargeButton(page).dblclick();
  await expect(overlay(page)).toBeVisible();
  expect(await counterOrderCount()).toBe(before + 2);
  const second = await latestCounterOrder();
  expect(second.id).not.toBe(first.id);
  expect((await jobsOf(second.id)).map((j) => j.type)).toEqual(["kitchen", "ticket"]);
});

test("stale item: a product deactivated while in the ticket is named, removed, nothing is charged; the rest can be charged", async ({ page }) => {
  await releaseCounterState();
  const ranchita = await priceOf("Ranchita simple");
  await openPos(page);
  await tileMain(page, "Huevo simple").click();
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "11" });
  const before = await counterOrderCount();
  await setProductActiveInDb("Huevo simple", false);
  try {
    await chargeButton(page).click();
    const issues = page.getByTestId("unit-issues");
    await expect(issues).toBeVisible();
    await expect(issues).toContainText("Quitamos estas unidades del ticket");
    await expect(issues).toContainText("«Huevo simple» ya no está disponible");
    await expect(linesOf(page, "Huevo simple")).toHaveCount(0);
    await expect(linesOf(page, "Ranchita simple")).toHaveCount(1);
    await expect(overlay(page)).toHaveCount(0);
    expect(await counterOrderCount()).toBe(before);
    await expect(totalOf(page)).toHaveText(formatARS(ranchita));

    // Payment and pager are still there: the remaining line can be charged right away.
    await expect(chargeButton(page)).toBeEnabled();
    await chargeButton(page).click();
    await expect(overlay(page)).toBeVisible();
    expect(await counterOrderCount()).toBe(before + 1);
    const order = await latestCounterOrder();
    expect(order.total).toBe(ranchita);
    expect((await itemsOf(order.id)).map((i) => i.nameSnapshot)).toEqual(["Ranchita simple"]);
  } finally {
    await setProductActiveInDb("Huevo simple", true);
  }
});

test("the ticket persists per station: reload keeps it, another station has its own", async ({ page }) => {
  await releaseCounterState();
  const station = await findStation(STATION);
  // A cashier only works at Mostrador-kind stations, so the second terminal is a second Mostrador station.
  const [other] = await db().insert(s.stations).values({ name: "Mostrador 2 E2E", kind: "mostrador" }).returning();
  try {
  await openPos(page);
  await tileMain(page, "Ranchita simple").click();
  await tileMain(page, "Ranchita simple").click();
  await tileMain(page, "Melt simple").click();
  await expect(ticketLines(page)).toHaveCount(2);
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bh_pos_cart_v1:")));
  expect(await keys()).toEqual([`${POS_CART_PREFIX}${station.id}`]);

  await page.reload();
  await expect(page.getByTestId("pos-board")).toHaveAttribute("data-ready", "true");
  await expect(linesOf(page, "Ranchita simple")).toHaveAttribute("data-quantity", "2");
  await expect(ticketLines(page)).toHaveCount(2);
  // The storefront cart key is untouched.
  expect(await page.evaluate(() => localStorage.getItem("bh_cart_v1"))).toBeNull();

  // Switch this terminal to another station: its ticket is separate.
  await page.goto("/estacion?next=/mostrador");
  await page.getByRole("button", { name: /Mostrador 2 E2E/ }).click();
  await expect(page).toHaveURL(/\/mostrador$/);
  await expect(page.getByTestId("pos-board")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("ticket-empty")).toBeVisible();
  await tileMain(page, "Cuarto de libra simple").click();
  expect((await keys()).sort()).toEqual([`${POS_CART_PREFIX}${station.id}`, `${POS_CART_PREFIX}${other.id}`].sort());

  // ...and back: the first station's ticket is still there.
  await page.goto("/estacion?next=/mostrador");
  await page.getByRole("button", { name: /Mostrador 1/ }).click();
  await expect(page.getByTestId("pos-board")).toHaveAttribute("data-ready", "true");
  await expect(ticketLines(page)).toHaveCount(2);
  await expect(linesOf(page, "Cuarto de libra simple")).toHaveCount(0);
  } finally {
    await db().delete(s.stations).where(eq(s.stations.id, other.id));
  }
});

test("exactly one EventSource, and a sale from another terminal does not open a second one", async ({ page, context }) => {
  await releaseCounterState();
  const streams = countEventSources(context);
  await openPos(page);
  expect(streams.count()).toBe(1);
  const before = streams.count();
  await seedCounterOrder(21);
  await expect(page.getByTestId("pager-badge")).toHaveCount(1);
  expect(streams.count()).toBe(before);
});


test("print status with a frozen clock: no agent -> 'waiting' after 30 s, a failed job -> Reimprimir, each reprint queues 2 more jobs", async ({ page }) => {
  test.setTimeout(90_000);
  await releaseCounterState();
  await page.clock.install();
  await openPos(page);
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "14" });
  await chargeButton(page).click();
  await expect(overlay(page)).toBeVisible();
  const order = await latestCounterOrder();
  const status = page.getByTestId("print-status");
  await expect(status).toHaveAttribute("data-status", "printing");
  expect(await jobsOf(order.id)).toHaveLength(2);

  // Nobody confirms: each 2 s tick keeps it "printing", the 30 s budget ends in "waiting".
  await expect(async () => {
    await page.clock.runFor(2000);
    await expect(status).toHaveAttribute("data-status", "waiting", { timeout: 400 });
  }).toPass({ timeout: 30_000 });
  await expect(status).toContainText("Esperando la impresora");
  const reprint = page.getByTestId("reprint");
  await expect(reprint).toBeVisible();
  await reprint.click();
  await expect(status).toHaveAttribute("data-status", "printing");
  await expect(async () => expect(await jobsOf(order.id)).toHaveLength(4)).toPass();

  // The newest kitchen job fails for good: the status turns failed and the button reprints again.
  const jobs = await jobsOf(order.id);
  const lastKitchen = [...jobs].reverse().find((j) => j.type === "kitchen")!;
  await failPrintJob(lastKitchen.id, "Sin papel");
  await expect(async () => {
    await page.clock.runFor(2000);
    await expect(status).toHaveAttribute("data-status", "failed", { timeout: 400 });
  }).toPass({ timeout: 30_000 });
  await expect(status).toContainText("Falló la impresión");
  await page.getByTestId("reprint").click();
  await expect(status).toHaveAttribute("data-status", "printing");
  await expect(async () => expect(await jobsOf(order.id)).toHaveLength(6)).toPass();
});

test("network error on charge: ticket intact, retry reuses the SAME key (one order); an edited ticket gets a NEW key", async ({ page }) => {
  test.setTimeout(60_000);
  await releaseCounterState();
  const station = await findStation(STATION);
  const storedKey = async () => {
    const raw = await page.evaluate((k) => sessionStorage.getItem(k), `bh_pos_key_v1:${station.id}`);
    return raw ? (JSON.parse(raw) as { k: string }).k : null;
  };
  let lose = false;
  await page.route("**/mostrador", async (route) => {
    if (lose && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      lose = false;
      await route.fetch(); // the server DOES process it...
      await route.fulfill({ status: 500, body: "boom" }); // ...but the answer is lost
    } else await route.continue();
  });
  await openPos(page);
  const before = await counterOrderCount();

  // 1) Lost response, then an unchanged retry: same key, ONE order.
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "5" });
  lose = true;
  await chargeButton(page).click();
  await expect(page.getByTestId("sale-error")).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await expect(ticketLines(page)).toHaveCount(1);
  // The lost sale already holds pager 5 (the page learns it from the live event): the retry must still be allowed.
  await expect(page.locator('[data-testid="pager-badge"][data-pager="5"]')).toBeVisible();
  await expect(chargeButton(page)).toBeEnabled(); // retryable
  const key1 = await storedKey();
  expect(key1).not.toBeNull();
  await chargeButton(page).click();
  await expect(overlay(page)).toBeVisible();
  expect(await counterOrderCount()).toBe(before + 1);
  const first = await latestCounterOrder();
  expect(first.idempotencyKey).toBe(key1);
  await page.getByTestId("new-sale").click();

  // 2) Lost response, then the ticket is EDITED before retrying: a new key, a second order.
  await tileMain(page, "Ranchita simple").click();
  await readySale(page, { pager: "6" });
  lose = true;
  await chargeButton(page).click();
  await expect(page.getByTestId("sale-error")).toBeVisible();
  const key2 = await storedKey();
  expect(key2).not.toBe(key1);
  const lost = await latestCounterOrder();
  expect(lost.idempotencyKey).toBe(key2);
  await tileMain(page, "Melt simple").click();
  // (the lost sale holds pager 6, so the edited ticket also needs another number)
  await page.getByTestId("pager-key-back").click();
  await typePager(page, "7");
  await chargeButton(page).click();
  await expect(overlay(page)).toBeVisible();
  const retried = await latestCounterOrder();
  expect(retried.id).not.toBe(lost.id);
  expect(retried.idempotencyKey).not.toBe(key2);
  expect(await counterOrderCount()).toBe(before + 3);
});
