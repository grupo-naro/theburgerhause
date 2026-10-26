import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { noHorizontalOverflow } from "./helpers/checkout";
import { countEventSources, failPrintJob, markJobsDone, openDelivery, openRetiro, orderCard, parkPendingOrders, placeDeliveryOrder, placeRetiroOrder, printJobsOf, recentRow, setStationSeen } from "./helpers/caja";
import { db } from "./helpers/db";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

const MIN = 60_000;
const backdate = (id: number, minutes: number) =>
  db().update(s.orders).set({ createdAt: new Date(Date.now() - minutes * MIN) }).where(eq(s.orders.id, id));

const VIEWPORTS = [
  ["desktop", { width: 1280, height: 800 }],
  ["tablet", { width: 768, height: 1024 }],
] as const;

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("/caja without a session goes to /login", async ({ page }) => {
    await page.goto("/caja");
    await expect(page).toHaveURL(/\/login\?next=%2Fcaja/);
  });
});

test.describe("cashier", () => {
  test.use({ storageState: authFile("cajera") });

  test("shell: nav by role, station, printer indicator from the heartbeat, one event stream", async ({ page, context }) => {
    const streams = countEventSources(context);
    await page.goto("/retiro");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Venta", "Mostrador", "Retiro en local", "Cocina"]);
    await expect(nav.getByRole("link", { name: "Retiro en local" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("station-name")).toHaveText("Estación: Mostrador 1");

    // Truthful before the agent exists: never seen -> offline.
    await setStationSeen("Mostrador 1", null);
    await page.reload();
    const printer = page.getByTestId("printer-indicator");
    await expect(printer).toHaveText("Sin agente");
    await expect(printer).toHaveAttribute("data-online", "false");
    try {
      await setStationSeen("Mostrador 1", new Date());
      await page.reload();
      await expect(printer).toHaveText("Impresora lista");
      await expect(printer).toHaveAttribute("data-online", "true");
      await setStationSeen("Mostrador 1", new Date(Date.now() - 120_000));
      await page.reload();
      await expect(printer).toHaveText("Sin agente");
    } finally {
      await setStationSeen("Mostrador 1", null);
    }

    // A refresh caused by a new order must not open a second stream.
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    const before = streams.count();
    const o = await placeRetiroOrder();
    await expect(orderCard(page, o.number)).toBeVisible();
    expect(streams.count()).toBe(before);
  });

  test("the printer indicator follows the agent heartbeat WITHOUT any order event or reload", async ({ page }) => {
    // The server compares last_seen_at with ITS clock, so "time passing" is simulated in the DB.
    const ago = (ms: number) => new Date(Date.now() - ms);
    await setStationSeen("Mostrador 1", new Date());
    try {
      await page.clock.install({ time: new Date() });
      await page.goto("/retiro");
      const printer = page.getByTestId("printer-indicator");
      await expect(printer).toHaveText("Impresora lista");

      await setStationSeen("Mostrador 1", ago(95_000)); // the agent stopped pinging
      await page.clock.runFor(31_000); // one heartbeat tick + the shared refresh debounce
      await expect(printer).toHaveText("Sin agente");
      await expect(printer).toHaveAttribute("data-online", "false");

      await setStationSeen("Mostrador 1", new Date()); // the agent is back
      await page.clock.runFor(31_000);
      await expect(printer).toHaveText("Impresora lista");
    } finally {
      await setStationSeen("Mostrador 1", null);
    }
  });

  test("every staff page opens exactly one /api/events connection", async ({ context }) => {
    for (const path of ["/retiro", "/mostrador", "/mostrador/pedidos"]) {
      const fresh = await context.newPage();
      const streams = countEventSources(context);
      await fresh.goto(path);
      await expect(fresh.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
      await fresh.waitForTimeout(500); // negative check: a second stream would have connected by now
      expect(streams.count(), path).toBe(1);
      await fresh.close();
    }
  });

  test("the old /despacho and /caja send the cashier to her workspace; Mostrador has no delivery lanes and no Admin link", async ({ page }) => {
    await page.goto("/despacho");
    await expect(page).toHaveURL(/\/mostrador\/pedidos$/);
    await expect(page.getByTestId("dispatch-board")).toBeVisible();
    await expect(page.getByTestId("lane-enroute")).toHaveCount(0);
    await expect(page.getByTestId("lane-ready-delivery")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Administración" })).toHaveCount(0);
    await page.goto("/caja");
    await expect(page).toHaveURL(/\/retiro$/);
  });

  for (const [label, viewport] of VIEWPORTS) {
    test(`Retiro en local at ${label}: no horizontal overflow and screenshots of every state`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await parkPendingOrders();
      const urgent = await placeRetiroOrder({ paymentMethod: "cash", unitNote: "Sin sal, por favor" });
      const transfer = await placeRetiroOrder({ paymentMethod: "transfer" });
      const longOne = await placeRetiroOrder({
        paymentMethod: "cash",
        unitNote: "Hamburguesa bien cocida y sin pepinos, el pan bien tostado, cortada al medio y bien separada de las papas por favor",
      });
      await backdate(urgent.id, 12);
      await backdate(transfer.id, 6);

      await openRetiro(page);
      await boardChecks(page, label, "retiro", { urgent, transfer, longOne });
    });
  }
});

/** Shared visual checks of an approvals board (urgency badges, sound hint, approve states, reject dialog, failed print + Recientes). */
async function boardChecks(
  page: Page,
  label: string,
  workspace: "retiro" | "delivery",
  o: { urgent: { id: number; number: number }; transfer: { id: number; number: number }; longOne: { id: number; number: number } },
) {
  for (const x of [o.urgent, o.transfer, o.longOne]) await expect(orderCard(page, x.number)).toBeVisible();
  await expect(page.getByTestId("sound-hint")).toBeVisible();
  await expect(orderCard(page, o.urgent.number).getByTestId("elapsed")).toHaveAttribute("data-urgency", "urgent");
  await expect(orderCard(page, o.transfer.number).getByTestId("elapsed")).toHaveAttribute("data-urgency", "warning");
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(page, `${workspace}-board-${label}`);
  await orderCard(page, o.urgent.number).screenshot({ path: `test-results/shots/${workspace}-card-urgent-${label}.png` });
  await page.getByTestId("sound-hint").screenshot({ path: `test-results/shots/${workspace}-sound-hint-${label}.png` });

  // Approve disabled vs enabled (transfer).
  const tcard = orderCard(page, o.transfer.number);
  await tcard.screenshot({ path: `test-results/shots/${workspace}-approve-disabled-${label}.png` });
  await tcard.getByRole("checkbox").check();
  await tcard.screenshot({ path: `test-results/shots/${workspace}-approve-enabled-${label}.png` });

  // Reject dialog.
  await orderCard(page, o.longOne.number).getByTestId("reject").click();
  await page.getByRole("button", { name: "Pago no acreditado" }).click();
  await shotViewport(page, `${workspace}-reject-dialog-${label}`);
  await page.keyboard.press("Escape");

  // Recientes + failed alert: approve one order, fail its first print job.
  await orderCard(page, o.longOne.number).getByTestId("approve").click();
  await expect(orderCard(page, o.longOne.number)).toHaveCount(0);
  if (workspace === "delivery") await page.getByTestId("tab-recent").click();
  const row = recentRow(page, o.longOne.number);
  if (label === "tablet") {
    await page.getByRole("button", { name: "Mostrar" }).click();
  }
  await expect(row).toBeVisible();
  const jobs = await printJobsOf(o.longOne.id);
  // Delivery station: kitchen + customer + dispatch ticket; Mostrador station: kitchen + customer.
  expect(jobs.map((j) => j.type)).toEqual(workspace === "delivery" ? ["kitchen", "customer", "delivery"] : ["kitchen", "customer"]);
  try {
    await failPrintJob((jobs.find((j) => j.type === "delivery") ?? jobs.find((j) => j.type === "customer")!).id, "La impresora no responde (sin papel o desconectada)");
    await expect(page.getByTestId("failed-print-alert")).toBeVisible();
    await expect(page.getByTestId("failed-print")).toContainText(workspace === "delivery" ? "Ticket delivery:" : "Ticket cliente:");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `${workspace}-failed-and-recientes-${label}`);
    await recentRow(page, o.longOne.number).screenshot({ path: `test-results/shots/${workspace}-recent-row-${label}.png` });
  } finally {
    await markJobsDone(o.longOne.id);
  }
}

test.describe("delivery manager", () => {
  test.use({ storageState: authFile("encargada") });

  test("nav shows Gestión Delivery and Rendición only; one stream per page; the old URLs send her to her workspace", async ({ page, context }) => {
    await page.goto("/delivery");
    await expect(page.getByTestId("station-name")).toHaveText("Estación: Delivery 1");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Gestión Delivery", "Rendición", "Cocina"]);
    await expect(nav.getByRole("link", { name: "Gestión Delivery" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Gestión Delivery", exact: true })).toBeAttached();

    const streams = countEventSources(context);
    await page.goto("/delivery");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(streams.count()).toBe(1);

    for (const old of ["/caja", "/despacho"]) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/delivery$/);
    }
    await page.goto("/despacho/rendicion");
    await expect(page).toHaveURL(/\/delivery\/rendicion$/);
  });

  for (const [label, viewport] of VIEWPORTS) {
    test(`Gestión Delivery at ${label}: no horizontal overflow and screenshots of every state`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await parkPendingOrders();
      const urgent = await placeDeliveryOrder({ paymentMethod: "cash", unitNote: "Sin sal, por favor" });
      const transfer = await placeDeliveryOrder({ paymentMethod: "transfer" });
      const longOne = await placeDeliveryOrder({
        paymentMethod: "cash",
        address: "Avenida del Libertador General San Martín 4567, piso 12, departamento B, torre norte",
        crossStreets: "Entre Dr. Luis Agote y Presidente Roque Sáenz Peña",
        notes: "Portón verde, tocar timbre 3 veces y esperar. Si no atienden llamar al WhatsApp del cliente antes de dejar el pedido.",
        unitNote: "Hamburguesa bien cocida y sin pepinos, el pan bien tostado",
      });
      await backdate(urgent.id, 12);
      await backdate(transfer.id, 6);

      await openDelivery(page);
      await boardChecks(page, label, "delivery", { urgent, transfer, longOne });
    });
  }
});

test.describe("delivery manager reprint", () => {
  test.use({ storageState: authFile("encargada") });

  test("Reimprimir on a delivery order offers customer, delivery and both tickets, each queuing exactly its jobs", async ({ page }) => {
    await parkPendingOrders();
    const o = await placeDeliveryOrder({ paymentMethod: "cash" });
    await openDelivery(page);
    await orderCard(page, o.number).getByTestId("approve").click();
    await expect(orderCard(page, o.number)).toHaveCount(0);
    await page.getByTestId("tab-recent").click();
    const row = recentRow(page, o.number);
    await expect(row).toBeVisible();
    try {
      expect((await printJobsOf(o.id)).map((j) => j.type)).toEqual(["kitchen", "customer", "delivery"]);
      const open = () => row.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
      await open();
      const menu = row.getByRole("group", { name: "Qué reimprimir" });
      await expect(menu.getByRole("button")).toHaveText(["Ticket cliente", "Ticket delivery", "Cliente + delivery", "Ticket cocina"]);
      await shotViewport(page, "delivery-reprint-menu");
      await menu.getByRole("button", { name: "Ticket delivery" }).click();
      await expect.poll(async () => (await printJobsOf(o.id)).map((j) => j.type)).toEqual(["kitchen", "customer", "delivery", "delivery"]);
      await open();
      await menu.getByRole("button", { name: "Ticket cliente" }).click();
      await expect.poll(async () => (await printJobsOf(o.id)).map((j) => j.type)).toEqual(["kitchen", "customer", "delivery", "delivery", "customer"]);
      await open();
      await menu.getByRole("button", { name: "Cliente + delivery" }).click(); // "both" = customer + delivery, NOT the kitchen comanda
      await expect.poll(async () => (await printJobsOf(o.id)).map((j) => j.type)).toEqual(["kitchen", "customer", "delivery", "delivery", "customer", "customer", "delivery"]);
      await open();
      await menu.getByRole("button", { name: "Ticket cocina" }).click();
      await expect.poll(async () => (await printJobsOf(o.id)).map((j) => j.type)).toEqual(["kitchen", "customer", "delivery", "delivery", "customer", "customer", "delivery", "kitchen"]);
    } finally {
      await markJobsDone(o.id);
    }
  });
});

test.describe("reprint menu layout", () => {
  test.use({ storageState: authFile("encargada") });

  for (const [label, viewport] of [
    ["1280", { width: 1280, height: 800 }],
    ["1024", { width: 1024, height: 768 }],
    ["768", { width: 768, height: 1024 }],
  ] as const) {
    test(`Reimprimir stays inside its card even when it wraps to its own line (${label})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await parkPendingOrders();
      const o = await placeDeliveryOrder({ paymentMethod: "cash" });
      // A long name makes the header line wrap: the button drops to its own line.
      await db().update(s.orders).set({ customerName: "Maria de los Angeles Fernandez de Kirchner Gonzalez Pereyra" }).where(eq(s.orders.id, o.id));
      await openDelivery(page);
      await orderCard(page, o.number).getByTestId("approve").click();
      await expect(orderCard(page, o.number)).toHaveCount(0);
      await page.getByTestId("tab-recent").click();
      const mostrar = page.getByRole("button", { name: "Mostrar" });
      if (await mostrar.isVisible()) await mostrar.click();
      const row = recentRow(page, o.number);
      await expect(row).toBeVisible();
      try {
        const button = row.getByRole("button", { name: `Reimprimir pedido #${o.number}` });
        await button.click();
        const menu = row.getByRole("group", { name: "Qué reimprimir" });
        await expect(menu).toBeVisible();
        const [r, b, m] = await Promise.all([row.boundingBox(), button.boundingBox(), menu.boundingBox()]);
        expect(r && b && m).toBeTruthy();
        // Button and menu never poke out of the card's left or right edge.
        expect(b!.x).toBeGreaterThanOrEqual(r!.x);
        expect(m!.x).toBeGreaterThanOrEqual(r!.x);
        expect(b!.x + b!.width).toBeLessThanOrEqual(r!.x + r!.width);
        expect(m!.x + m!.width).toBeLessThanOrEqual(r!.x + r!.width);
        expect(await noHorizontalOverflow(page)).toBe(true);
        await shot(page, `reprint-menu-${label}`);
      } finally {
        await markJobsDone(o.id);
      }
    });
  }
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("sees every workspace, both general views and Administración", async ({ page }) => {
    await page.goto("/caja");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Venta", "Mostrador", "Retiro en local", "Gestión Delivery", "Rendición", "Cocina", "Vista general", "Tablero general", "Administración"]);
    await expect(nav.getByRole("link", { name: "Vista general" })).toHaveAttribute("aria-current", "page");
  });
});
