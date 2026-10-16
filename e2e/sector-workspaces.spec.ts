import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Locator } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { noHorizontalOverflow } from "./helpers/checkout";
import { countEventSources, openDelivery, openRetiro, orderById, orderCard, parkPendingOrders, placeDeliveryOrder, placeRetiroOrder, printJobsOf } from "./helpers/caja";
import { db, findStation } from "./helpers/db";
import { cleanBoard, dcard, lane, openPedidos, placeApproved, populateBoard, runCleanups, tag } from "./helpers/despacho";
import { staffContext } from "./helpers/journey";
import { deliveredFor, ensureCadet, openList, retireCadets } from "./helpers/rendicion";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

// One workspace per sector (Task 10.1): web orders are distributed BY ORDER TYPE. Delivery orders live on the
// Delivery station (encargada), takeaway orders and counter sales on the Mostrador station (cajera); admin sees all.
test.use({ storageState: authFile("cajera") });
test.beforeEach(async () => {
  await parkPendingOrders();
  await cleanBoard();
});
test.afterEach(runCleanups);
test.afterAll(cleanBoard);

const SIZES = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "768", width: 768, height: 1024 },
] as const;

/** The DB id of a context's session (the sha256 of its cookie token). */
async function sessionIdOf(ctx: BrowserContext): Promise<string> {
  const token = (await ctx.cookies()).find((c) => c.name === "bh_session")!.value;
  return createHash("sha256").update(token).digest("hex");
}

async function expectTarget(locator: Locator, what: string) {
  const box = await locator.first().boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(47.5);
}

test.describe("distribution by order type", () => {
  test("a delivery order is on the Delivery PC only, a takeaway order on the Mostrador PC only; admin sees both", async ({ browser, baseURL }) => {
    const mostrador = await (await staffContext(browser, baseURL, "cajera")).newPage();
    const delivery = await (await staffContext(browser, baseURL, "encargada")).newPage();
    const adminCtx = await staffContext(browser, baseURL, "admin");
    const admin = await adminCtx.newPage();
    const adminSession = await sessionIdOf(adminCtx);
    try {
      await openRetiro(mostrador);
      await openDelivery(delivery);
      const d = await placeDeliveryOrder({ paymentMethod: "cash" });
      const t = await placeRetiroOrder({ paymentMethod: "cash" });

      // Live, no reload: each order reaches ONLY the PC of its sector.
      await expect(orderCard(delivery, d.number)).toBeVisible();
      await expect(orderCard(mostrador, t.number)).toBeVisible();
      await expect(orderCard(mostrador, d.number)).toHaveCount(0);
      await expect(orderCard(delivery, t.number)).toHaveCount(0);
      await expect(mostrador.getByTestId("pending-count")).toHaveText("1");
      await expect(delivery.getByTestId("tab-pending-count")).toHaveText("1");

      // A reload (server render) says the same: the filter is in the queries, not only in the live refresh.
      await mostrador.reload();
      await delivery.reload();
      await expect(orderCard(mostrador, t.number)).toBeVisible();
      await expect(orderCard(mostrador, d.number)).toHaveCount(0);
      await expect(orderCard(delivery, d.number)).toBeVisible();
      await expect(orderCard(delivery, t.number)).toHaveCount(0);

      // Admin's general view lists both (approving needs a station, so the admin sits at one meanwhile).
      await db().update(s.sessions).set({ stationId: (await findStation("Mostrador 1")).id }).where(eq(s.sessions.id, adminSession));
      await admin.goto("/caja");
      await expect(orderCard(admin, d.number)).toBeVisible();
      await expect(orderCard(admin, t.number)).toBeVisible();
    } finally {
      await mostrador.context().close();
      await delivery.context().close();
      await db().update(s.sessions).set({ stationId: null }).where(eq(s.sessions.id, adminSession));
      await admin.context().close();
    }
  });

  test("the approval prints on the approving station: Delivery 1 for delivery orders, Mostrador 1 for takeaway", async ({ browser, baseURL }) => {
    const mostrador = await (await staffContext(browser, baseURL, "cajera")).newPage();
    const delivery = await (await staffContext(browser, baseURL, "encargada")).newPage();
    try {
      const d = await placeDeliveryOrder({ paymentMethod: "cash" });
      const t = await placeRetiroOrder({ paymentMethod: "cash" });
      await openRetiro(mostrador);
      await openDelivery(delivery);

      await orderCard(delivery, d.number).getByTestId("approve").click();
      await expect(orderCard(delivery, d.number)).toHaveCount(0);
      await orderCard(mostrador, t.number).getByTestId("approve").click();
      await expect(orderCard(mostrador, t.number)).toHaveCount(0);

      const deliveryStation = await findStation("Delivery 1");
      const mostradorStation = await findStation("Mostrador 1");
      const dJobs = await printJobsOf(d.id);
      const tJobs = await printJobsOf(t.id);
      expect(dJobs.map((j) => j.type)).toEqual(["kitchen", "ticket"]);
      expect(tJobs.map((j) => j.type)).toEqual(["kitchen", "ticket"]);
      expect(dJobs.every((j) => j.stationId === deliveryStation.id)).toBe(true);
      expect(tJobs.every((j) => j.stationId === mostradorStation.id)).toBe(true);
      expect((await orderById(d.id)).stationId).toBe(deliveryStation.id);
      expect((await orderById(t.id)).stationId).toBe(mostradorStation.id);
    } finally {
      await mostrador.context().close();
      await delivery.context().close();
    }
  });

  test("the counter sector also owns counter sales: POS orders are on Mostrador and in the Retiro recents, never on Delivery", async ({ browser, baseURL }) => {
    const data = await populateBoard(tag());
    const mostrador = await (await staffContext(browser, baseURL, "cajera")).newPage();
    const delivery = await (await staffContext(browser, baseURL, "encargada")).newPage();
    try {
      // Mostrador: the counter sales (POS) in every counter lane; nothing of delivery.
      await openPedidos(mostrador);
      for (const n of [data.prep[1], data.readyCounter[1], data.pickup[1]]) await expect(dcard(mostrador, n)).toBeVisible();
      for (const n of [data.prep[0], ...data.readyDelivery.map((o) => o.number)]) await expect(dcard(mostrador, n)).toHaveCount(0);
      await expect(lane(mostrador, "ready-delivery")).toHaveCount(0);
      await expect(lane(mostrador, "enroute")).toHaveCount(0);

      // Retiro en local: the web takeaway orders (and the POS ones appear only in Mostrador / Recientes).
      await openRetiro(mostrador);
      for (const n of [data.readyCounter[0], data.pickup[0]]) await expect(dcard(mostrador, n)).toBeVisible();
      for (const n of [data.prep[0], ...data.readyDelivery.map((o) => o.number)]) await expect(dcard(mostrador, n)).toHaveCount(0);

      // Delivery: only delivery orders, and no counter lanes at all.
      await openDelivery(delivery, "preparing");
      await expect(dcard(delivery, data.prep[0])).toBeVisible();
      await expect(dcard(delivery, data.prep[1])).toHaveCount(0);
      await delivery.getByTestId("tab-ready").click();
      for (const o of data.readyDelivery) await expect(dcard(delivery, o.number)).toBeVisible();
      for (const n of data.readyCounter) await expect(dcard(delivery, n)).toHaveCount(0);
      await expect(lane(delivery, "pickup")).toHaveCount(0);
      await expect(lane(delivery, "ready-counter")).toHaveCount(0);
    } finally {
      await mostrador.context().close();
      await delivery.context().close();
      await retireCadets([data.cadet.id]);
    }
  });
});

test.describe("old URLs, guards and stations", () => {
  test("old URLs lead each role to its workspace; admin keeps the general views; ?cadet= links survive", async ({ browser, baseURL }) => {
    const cashier = await (await staffContext(browser, baseURL, "cajera")).newPage();
    const manager = await (await staffContext(browser, baseURL, "encargada")).newPage();
    const admin = await (await staffContext(browser, baseURL, "admin")).newPage();
    const cadet = await ensureCadet(`Link ${tag()}`);
    try {
      await cashier.goto("/caja");
      await expect(cashier).toHaveURL(/\/retiro$/);
      await cashier.goto("/despacho");
      await expect(cashier).toHaveURL(/\/mostrador\/pedidos$/);
      await cashier.goto("/delivery");
      await expect(cashier).toHaveURL(/\/mostrador$/); // wrong role -> her home
      await cashier.goto("/delivery/rendicion");
      await expect(cashier).toHaveURL(/\/mostrador$/);

      for (const old of ["/caja", "/despacho", "/retiro", "/mostrador/pedidos", "/mostrador"]) {
        await manager.goto(old);
        await expect(manager, old).toHaveURL(/\/delivery$/);
      }
      await manager.goto(`/despacho/rendicion?cadet=${cadet.id}`);
      await expect(manager).toHaveURL(new RegExp(`/delivery/rendicion\\?cadet=${cadet.id}$`));
      await expect(manager.getByTestId("cadet-detail")).toBeVisible();
      await manager.goto("/despacho/rendicion");
      await expect(manager).toHaveURL(/\/delivery\/rendicion$/);

      await admin.goto("/caja");
      await expect(admin).toHaveURL(/\/caja$/);
      await admin.goto("/despacho");
      await expect(admin).toHaveURL(/\/despacho$/);
      await admin.goto("/despacho/rendicion");
      await expect(admin).toHaveURL(/\/delivery\/rendicion$/);
      for (const path of ["/retiro", "/mostrador/pedidos", "/delivery"]) {
        await admin.goto(path);
        await expect(admin, path).toHaveURL(new RegExp(`${path}$`));
        await expect(admin.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
      }
    } finally {
      await cashier.context().close();
      await manager.context().close();
      await admin.context().close();
      await retireCadets([cadet.id]);
    }
  });

  test("the station picker only offers stations of the role's kind", async ({ browser, baseURL }) => {
    for (const [who, shown, hidden] of [
      ["cajera", /Mostrador 1/, /Delivery 1/],
      ["encargada", /Delivery 1/, /Mostrador 1/],
    ] as const) {
      const page = await (await staffContext(browser, baseURL, who)).newPage();
      try {
        await page.goto("/estacion");
        await expect(page.getByRole("button", { name: shown })).toBeVisible();
        await expect(page.getByRole("button", { name: hidden })).toHaveCount(0);
      } finally {
        await page.context().close();
      }
    }
    const admin = await (await staffContext(browser, baseURL, "admin")).newPage();
    try {
      await admin.goto("/estacion");
      await expect(admin.getByRole("button", { name: /Mostrador 1/ })).toBeVisible();
      await expect(admin.getByRole("button", { name: /Delivery 1/ })).toBeVisible();
    } finally {
      await admin.context().close();
    }
  });

  test("a cashier whose session sits at a Delivery station (unsupported combination) is sent to pick another one, with the reason", async ({ browser, baseURL }) => {
    const ctx = await staffContext(browser, baseURL, "cajera");
    const page = await ctx.newPage();
    const delivery = await findStation("Delivery 1");
    const mostrador = await findStation("Mostrador 1");
    const sessionId = await sessionIdOf(ctx);
    try {
      await db().update(s.sessions).set({ stationId: delivery.id }).where(eq(s.sessions.id, sessionId));
      await page.goto("/retiro");
      await expect(page).toHaveURL(/\/estacion\?next=%2Fretiro&motivo=sector$/);
      await expect(page.getByTestId("wrong-station")).toContainText("otro sector");
      await expect(page.getByRole("button", { name: /Delivery 1/ })).toHaveCount(0);
      await page.getByRole("button", { name: /Mostrador 1/ }).click();
      await expect(page).toHaveURL(/\/retiro$/);
    } finally {
      await db().update(s.sessions).set({ stationId: mostrador.id }).where(eq(s.sessions.id, sessionId));
      await ctx.close();
    }
  });

  test("every workspace page opens exactly one /api/events connection", async ({ browser, baseURL }) => {
    for (const [who, paths] of [
      ["cajera", ["/retiro", "/mostrador/pedidos", "/mostrador"]],
      ["encargada", ["/delivery", "/delivery?tab=enroute", "/delivery/rendicion"]],
    ] as const) {
      const ctx = await staffContext(browser, baseURL, who);
      try {
        for (const path of paths) {
          const page = await ctx.newPage();
          const streams = countEventSources(ctx);
          await page.goto(path);
          await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
          await page.waitForTimeout(500); // negative check: a second stream would have connected by now
          expect(streams.count(), path).toBe(1);
          await page.close();
        }
      } finally {
        await ctx.close();
      }
    }
  });
});

test.describe("layout of each workspace", () => {
  test("Mostrador PC: Retiro en local and Mostrador at 1280 / 1024 / 768 — no overflow, big targets, screenshots", async ({ browser, baseURL }) => {
    const data = await populateBoard(tag());
    await placeApproved({ fulfillment: "takeaway", paymentMethod: "cash" }); // a web takeaway order in the kitchen
    await placeRetiroOrder({ paymentMethod: "cash", unitNote: "Sin sal" });
    await placeRetiroOrder({ paymentMethod: "transfer" });
    const ctx = await staffContext(browser, baseURL, "cajera");
    const page = await ctx.newPage();
    try {
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });

        await openRetiro(page);
        expect(await noHorizontalOverflow(page), `retiro overflow at ${size.name}`).toBe(true);
        await expect(page.getByTestId("pending-count")).toHaveText("2");
        await expect(page.getByTestId("lane-preparing")).toBeVisible();
        await expect(page.getByTestId("lane-pickup")).toBeVisible();
        await expect(page.getByTestId("lane-ready-delivery")).toHaveCount(0);
        await expect(page.getByTestId("lane-enroute")).toHaveCount(0);
        const nav = page.getByRole("navigation", { name: "Secciones" });
        await expect(nav.getByRole("link")).toHaveText(["Venta", "Mostrador", "Retiro en local"]);
        for (const link of await nav.getByRole("link").all()) await expectTarget(link, "nav link");
        await expectTarget(page.getByTestId("approve"), "Aprobar");
        await expectTarget(page.getByTestId("reject"), "Rechazar");
        await expectTarget(page.getByTestId("mark-ready"), "Listo");
        await expectTarget(page.getByTestId("call-pickup"), "Llamar");
        await expectTarget(lane(page, "pickup").getByTestId("deliver"), "Entregado");
        await shot(page, `sector-retiro-${size.name}`);

        await openPedidos(page);
        expect(await noHorizontalOverflow(page), `mostrador overflow at ${size.name}`).toBe(true);
        await expect(page.getByTestId("counter-preparing")).toBeVisible();
        await expect(page.getByTestId("counter-enRoute")).toHaveCount(0);
        for (const n of [data.prep[1], ...data.pickup.slice(1)]) await expect(dcard(page, n)).toBeVisible();
        await expectTarget(page.getByTestId("mark-ready"), "Listo");
        await shot(page, `sector-mostrador-${size.name}`);
      }
    } finally {
      await ctx.close();
      await retireCadets([data.cadet.id]);
    }
  });

  test("Delivery PC: Gestión Delivery (every tab) and Rendición at 1280 / 1024 / 768 — no overflow, big targets, screenshots", async ({ browser, baseURL }) => {
    const data = await populateBoard(tag());
    await placeDeliveryOrder({ paymentMethod: "cash", unitNote: "Sin sal" });
    await placeDeliveryOrder({ paymentMethod: "transfer", address: "San Martín 450, 2A" });
    const owing = await deliveredFor(data.cadet.id);
    const ctx = await staffContext(browser, baseURL, "encargada");
    const page = await ctx.newPage();
    try {
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openDelivery(page);
        const nav = page.getByRole("navigation", { name: "Secciones" });
        await expect(nav.getByRole("link")).toHaveText(["Gestión Delivery", "Rendición"]);
        for (const link of await nav.getByRole("link").all()) await expectTarget(link, "nav link");
        for (const tab of await page.getByRole("tab").all()) await expectTarget(tab, "tab");

        for (const [tab, label] of [
          ["pending", "Por aprobar"],
          ["preparing", "En preparación"],
          ["ready", "Listos / Despacho"],
          ["enroute", "En camino"],
          ["recent", "Recientes"],
        ] as const) {
          await page.getByRole("tab", { name: new RegExp(label) }).click();
          await expect(page.getByRole("tab", { name: new RegExp(label) })).toHaveAttribute("aria-selected", "true");
          expect(new URL(page.url()).searchParams.get("tab")).toBe(tab);
          expect(await noHorizontalOverflow(page), `${tab} overflow at ${size.name}`).toBe(true);
          if (tab === "pending") await expectTarget(page.getByTestId("approve"), "Aprobar");
          if (tab === "preparing") await expectTarget(page.getByTestId("mark-ready"), "Listo");
          if (tab === "ready") await expectTarget(page.getByTestId("select-order"), "checkbox");
          if (tab === "enroute") {
            await expectTarget(lane(page, "enroute").getByTestId("deliver"), "Entregado");
            await expectTarget(page.getByTestId("render-link"), "Rendir");
          }
          await shot(page, `sector-delivery-${tab}-${size.name}`);
        }
        // Delivery has no counter/pickup lanes at all.
        await expect(page.getByTestId("lane-pickup")).toHaveCount(0);
        await expect(page.getByTestId("lane-ready-counter")).toHaveCount(0);

        await openList(page);
        expect(await noHorizontalOverflow(page), `rendicion overflow at ${size.name}`).toBe(true);
        await shot(page, `sector-rendicion-${size.name}`);
      }
      expect(owing.id).toBeGreaterThan(0);
    } finally {
      await ctx.close();
      await retireCadets([data.cadet.id]);
    }
  });
});
