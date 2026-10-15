import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { noHorizontalOverflow } from "./helpers/checkout";
import { countEventSources, failPrintJob, markJobsDone, openCaja, orderCard, parkPendingOrders, placeCajaOrder, printJobsOf, recentRow, setStationSeen } from "./helpers/caja";
import { db } from "./helpers/db";
import { shot, shotViewport } from "./helpers/shots";
import { authFile } from "./helpers/users";

const MIN = 60_000;
const backdate = (id: number, minutes: number) =>
  db().update(s.orders).set({ createdAt: new Date(Date.now() - minutes * MIN) }).where(eq(s.orders.id, id));

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
    await page.goto("/caja");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Caja", "Mostrador"]);
    await expect(nav.getByRole("link", { name: "Caja" })).toHaveAttribute("aria-current", "page");
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
    const o = await placeCajaOrder();
    await expect(orderCard(page, o.number)).toBeVisible();
    expect(streams.count()).toBe(before);
  });

  test("the printer indicator follows the agent heartbeat WITHOUT any order event or reload", async ({ page }) => {
    // The server compares last_seen_at with ITS clock, so "time passing" is simulated in the DB.
    const ago = (ms: number) => new Date(Date.now() - ms);
    await setStationSeen("Mostrador 1", new Date());
    try {
      await page.clock.install({ time: new Date() });
      await page.goto("/caja");
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
    for (const path of ["/caja", "/mostrador"]) {
      const fresh = await context.newPage();
      const streams = countEventSources(context);
      await fresh.goto(path);
      await expect(fresh.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
      await fresh.waitForTimeout(500); // negative check: a second stream would have connected by now
      expect(streams.count(), path).toBe(1);
      await fresh.close();
    }
  });

  test("the cashier cannot open Despacho (goes home) and sees no Admin link", async ({ page }) => {
    await page.goto("/despacho");
    await expect(page).toHaveURL(/\/caja$/);
    await expect(page.getByRole("link", { name: "Administración" })).toHaveCount(0);
  });

  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["tablet", { width: 768, height: 1024 }],
  ] as const) {
    test(`board at ${label}: no horizontal overflow and screenshots of every state`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await parkPendingOrders();
      const urgent = await placeCajaOrder({ paymentMethod: "cash", fulfillment: "takeaway", unitNote: "Sin sal, por favor" });
      const transfer = await placeCajaOrder({ paymentMethod: "transfer", fulfillment: "delivery" });
      const longOne = await placeCajaOrder({
        paymentMethod: "cash",
        fulfillment: "delivery",
        address: "Avenida del Libertador General San Martín 4567, piso 12, departamento B, torre norte",
        crossStreets: "Entre Dr. Luis Agote y Presidente Roque Sáenz Peña",
        notes: "Portón verde, tocar timbre 3 veces y esperar. Si no atienden llamar al WhatsApp del cliente antes de dejar el pedido.",
        unitNote: "Hamburguesa bien cocida y sin pepinos, el pan bien tostado",
      });
      await backdate(urgent.id, 12);
      await backdate(transfer.id, 6);

      await openCaja(page);
      for (const o of [urgent, transfer, longOne]) await expect(orderCard(page, o.number)).toBeVisible();
      await expect(page.getByTestId("sound-hint")).toBeVisible();
      await expect(orderCard(page, urgent.number).getByTestId("elapsed")).toHaveAttribute("data-urgency", "urgent");
      await expect(orderCard(page, transfer.number).getByTestId("elapsed")).toHaveAttribute("data-urgency", "warning");
      expect(await noHorizontalOverflow(page)).toBe(true);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await shot(page, `caja-board-${label}`);
      await orderCard(page, urgent.number).screenshot({ path: `test-results/shots/caja-card-urgent-${label}.png` });
      await page.getByTestId("sound-hint").screenshot({ path: `test-results/shots/caja-sound-hint-${label}.png` });

      // Approve disabled vs enabled (transfer).
      const tcard = orderCard(page, transfer.number);
      await tcard.screenshot({ path: `test-results/shots/caja-approve-disabled-${label}.png` });
      await tcard.getByRole("checkbox").check();
      await tcard.screenshot({ path: `test-results/shots/caja-approve-enabled-${label}.png` });

      // Reject dialog.
      await orderCard(page, longOne.number).getByTestId("reject").click();
      await page.getByRole("button", { name: "Pago no acreditado" }).click();
      await shotViewport(page, `caja-reject-dialog-${label}`);
      await page.keyboard.press("Escape");

      // Recientes + failed alert: approve one order, fail its kitchen print.
      await orderCard(page, longOne.number).getByTestId("approve").click();
      await expect(orderCard(page, longOne.number)).toHaveCount(0);
      const row = recentRow(page, longOne.number);
      if (label === "tablet") {
        await page.getByRole("button", { name: "Mostrar" }).click();
      }
      await expect(row).toBeVisible();
      const [kitchen] = await printJobsOf(longOne.id);
      try {
        await failPrintJob(kitchen.id, "La impresora no responde (sin papel o desconectada)");
        await expect(page.getByTestId("failed-print-alert")).toBeVisible();
        expect(await noHorizontalOverflow(page)).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `caja-failed-and-recientes-${label}`);
        await recentRow(page, longOne.number).screenshot({ path: `test-results/shots/caja-recent-row-${label}.png` });
      } finally {
        await markJobsDone(longOne.id);
      }
    });
  }
});

test.describe("delivery manager", () => {
  test.use({ storageState: authFile("encargada") });

  test("can open /caja; nav shows Despacho and Caja only; the placeholder keeps one stream", async ({ page, context }) => {
    await page.goto("/caja");
    await expect(page.getByTestId("station-name")).toHaveText("Estación: Delivery 1");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Despacho", "Caja"]);
    await expect(page.getByRole("heading", { name: "Caja", exact: true })).toBeAttached();

    const streams = countEventSources(context);
    await page.goto("/despacho");
    await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(streams.count()).toBe(1);
    await expect(page.getByRole("heading", { name: "Despacho" })).toBeVisible();
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("sees every staff link plus Administración", async ({ page }) => {
    await page.goto("/caja");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link")).toHaveText(["Caja", "Mostrador", "Despacho", "Administración"]);
  });
});
