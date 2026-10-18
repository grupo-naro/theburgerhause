import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { countEventSources, eventsOf, openDelivery, orderById } from "./helpers/caja";
import { db, itemsOfOrder } from "./helpers/db";
import {
  cleanBoard,
  counterOrder,
  dcard,
  placeApproved,
  pickupInDb,
  pingOrders,
  readyInDb,
  runCleanups,
  setStatusClock,
} from "./helpers/despacho";
import { staffContext } from "./helpers/journey";
import { shot, shotViewport, waitForStablePage } from "./helpers/shots";
import { authFile } from "./helpers/users";

/**
 * Kitchen screen (KDS) at /cocina: the cook sees every order in preparation as a card and marks LISTO with one tap.
 * The `cocina` user has no station and no navigation; cashier / delivery manager / admin can open it too.
 */

const kcard = (page: Page, number: number): Locator => page.locator(`[data-testid="kitchen-card"][data-order-number="${number}"]`);
const recent = (page: Page, number: number): Locator => page.locator(`[data-testid="recent-item"][data-order-number="${number}"]`);

async function openKitchen(page: Page): Promise<void> {
  await page.goto("/cocina");
  await expect(page.getByTestId("kitchen-board")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

const toStatus = async (orderId: number, to: (typeof s.orderEvents.$inferSelect)["toStatus"]) =>
  (await eventsOf(orderId)).filter((e) => e.toStatus === to);

test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);
test.afterEach(runCleanups);

test.describe("cocina", () => {
  test.use({ storageState: authFile("cocina") });

  test("a delivery order approved at Delivery appears LIVE with the exact units, modifiers and note; LISTO moves it to the Delivery Listos lane live", async ({ page, browser, baseURL }) => {
    const enc = await staffContext(browser, baseURL, "encargada");
    try {
      const delivery = await enc.newPage();
      await openDelivery(delivery, "ready");
      await openKitchen(page);
      await expect(page.getByTestId("kitchen-empty")).toBeVisible();
      await expect(page.getByTestId("kitchen-empty")).toContainText("Sin pedidos en preparación");

      const o = await placeApproved({ single: false, unitNote: "bien cocida, sin sal" });
      const card = kcard(page, o.number);
      await expect(card).toBeVisible();
      await expect(card.getByTestId("type-tag")).toHaveText("DELIVERY");
      await expect(card.getByTestId("kitchen-pager")).toHaveCount(0);

      // The exact text comes from the stored snapshots: product names and the kitchen labels, units numbered.
      const items = await itemsOfOrder(o.id);
      const units = card.getByTestId("kitchen-unit");
      await expect(units).toHaveCount(items.length);
      for (const [i, item] of items.entries()) {
        await expect(units.nth(i)).toContainText(item.nameSnapshot);
        const lines = item.modifiers.map((m) => m.kitchenLabel.toUpperCase());
        if (lines.length > 0) await expect(units.nth(i).getByTestId("kitchen-line")).toHaveText(lines);
        else await expect(units.nth(i).getByTestId("kitchen-line")).toHaveCount(0);
      }
      await expect(units.nth(0).getByTestId("kitchen-line")).toHaveText(["SIN CHEDDAR"]);
      await expect(card.getByTestId("kitchen-note")).toHaveText("NOTA: Unidad 1: bien cocida, sin sal");
      await shot(page, "cocina-live-card");

      await card.getByTestId("kitchen-ready").click();
      await expect(card).toHaveCount(0);
      await expect(page.getByTestId("toast")).toContainText(`Pedido #${o.number} listo`);
      await expect(recent(page, o.number)).toBeVisible();
      expect((await orderById(o.id)).status).toBe("listo_despacho");
      // The Delivery workspace follows live.
      await expect(dcard(delivery, o.number)).toBeVisible();
      expect(await toStatus(o.id, "listo_despacho")).toHaveLength(1);
    } finally {
      await enc.close();
    }
  });

  test("takeaway and counter orders: RETIRO and MOSTRADOR tags, LLAMADOR on counter sales; LISTO works for both", async ({ page }) => {
    await openKitchen(page);
    const takeaway = await placeApproved({ fulfillment: "takeaway" });
    const pos = await counterOrder();
    await expect(kcard(page, takeaway.number).getByTestId("type-tag")).toHaveText("RETIRO");
    await expect(kcard(page, takeaway.number).getByTestId("kitchen-pager")).toHaveCount(0);
    const counter = kcard(page, pos.number);
    await expect(counter.getByTestId("type-tag")).toHaveText("MOSTRADOR");
    await expect(counter.getByTestId("kitchen-pager")).toHaveText(`LLAMADOR ${pos.pager}`);
    // Oldest first: the takeaway order was approved before the counter sale.
    await expect(page.getByTestId("kitchen-card").first()).toHaveAttribute("data-order-number", String(takeaway.number));

    await kcard(page, takeaway.number).getByTestId("kitchen-ready").click();
    await expect(kcard(page, takeaway.number)).toHaveCount(0);
    await counter.getByTestId("kitchen-ready").click();
    await expect(counter).toHaveCount(0);
    expect((await orderById(takeaway.id)).status).toBe("listo_despacho");
    expect((await orderById(pos.orderId)).status).toBe("listo_despacho");
  });

  test("Deshacer in the toast and Volver a preparación in the strip put the order back, audited", async ({ page }) => {
    await openKitchen(page);
    const a = await placeApproved({});
    const b = await placeApproved({});
    await kcard(page, a.number).getByTestId("kitchen-ready").click();
    await expect(kcard(page, a.number)).toHaveCount(0);
    await page.getByTestId("toast").getByRole("button", { name: "Deshacer" }).click();
    await expect(kcard(page, a.number)).toBeVisible();
    await expect(recent(page, a.number)).toHaveCount(0);
    expect((await orderById(a.id)).status).toBe("en_preparacion");

    await kcard(page, b.number).getByTestId("kitchen-ready").click();
    await expect(recent(page, b.number)).toBeVisible();
    await recent(page, b.number).getByTestId("recent-undo").click();
    await expect(kcard(page, b.number)).toBeVisible();
    expect((await orderById(b.id)).status).toBe("en_preparacion");
    const chain = (await eventsOf(b.id)).map((e) => `${e.fromStatus}>${e.toStatus}`);
    expect(chain.slice(-2)).toEqual(["en_preparacion>listo_despacho", "listo_despacho>en_preparacion"]);
    expect((await eventsOf(b.id)).at(-1)?.note).toMatch(/Deshacer/);
  });

  test("an order already called or assigned leaves the strip: it can no longer be undone", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({ fulfillment: "takeaway" });
    await kcard(page, o.number).getByTestId("kitchen-ready").click();
    await expect(recent(page, o.number)).toBeVisible();
    await pickupInDb(o.id);
    await expect(recent(page, o.number)).toHaveCount(0);
  });

  test("double tap on LISTO is ONE transition", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({});
    await kcard(page, o.number).getByTestId("kitchen-ready").dblclick();
    await expect(kcard(page, o.number)).toHaveCount(0);
    expect(await toStatus(o.id, "listo_despacho")).toHaveLength(1);
  });

  test("a stale card (another screen got there first) answers a friendly message, not an error", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({});
    await expect(kcard(page, o.number)).toBeVisible();
    // The order changes behind this screen's back (no realtime hint is sent).
    await db().update(s.orders).set({ status: "listo_despacho" }).where(eq(s.orders.id, o.id));
    await kcard(page, o.number).getByTestId("kitchen-ready").click();
    await expect(page.getByTestId("toast")).toContainText("Ese pedido ya no está en preparación");
    await expect(kcard(page, o.number)).toHaveCount(0);
    expect(await toStatus(o.id, "listo_despacho")).toHaveLength(0); // the direct DB change wrote no event, and the tap wrote none either
  });

  test("a cancelled order disappears live", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({});
    await expect(kcard(page, o.number)).toBeVisible();
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, o.id));
    await pingOrders(o.id);
    await expect(kcard(page, o.number)).toHaveCount(0);
    await expect(page.getByTestId("kitchen-empty")).toBeVisible();
  });

  test("the clock is green / yellow / red by minutes in preparation and says 'hace N min'", async ({ page }) => {
    const young = await placeApproved({});
    const mid = await placeApproved({});
    const old = await placeApproved({});
    const now = Date.now();
    await setStatusClock(young.id, "en_preparacion", new Date(now - 3 * 60_000));
    await setStatusClock(mid.id, "en_preparacion", new Date(now - 10 * 60_000));
    await setStatusClock(old.id, "en_preparacion", new Date(now - 20 * 60_000));
    await openKitchen(page);
    const clock = (n: number) => kcard(page, n).getByTestId("kitchen-clock");
    await expect(clock(young.number)).toHaveAttribute("data-color", "green");
    await expect(clock(mid.number)).toHaveAttribute("data-color", "yellow");
    await expect(clock(old.number)).toHaveAttribute("data-color", "red");
    await expect(clock(mid.number)).toHaveText(/hace 10 min/);
    // Oldest first.
    await expect(page.getByTestId("kitchen-card").first()).toHaveAttribute("data-order-number", String(old.number));
    await shot(page, "cocina-clock-colors");
  });

  test("customer text is inert: markup and emoji render as plain text", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({ unitNote: '<img src=x onerror="window.__pwned=1"> <b>negrita</b> 🍔' });
    const card = kcard(page, o.number);
    await expect(card.getByTestId("kitchen-note")).toHaveText('NOTA: <img src=x onerror="window.__pwned=1"> <b>negrita</b> 🍔');
    await expect(card.locator("img, b")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("the cook cannot open the other screens: every URL leads back to /cocina", async ({ page }) => {
    for (const path of ["/caja", "/retiro", "/delivery", "/despacho", "/mostrador", "/mostrador/pedidos", "/admin", "/estacion"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/cocina$/);
    }
    await expect(page.getByRole("navigation", { name: "Secciones" })).toHaveCount(0); // fullscreen: no navigation
    await expect(page.getByTestId("kitchen-shell")).toBeVisible();
  });

  test("exactly one EventSource, and sound can be switched", async ({ page, context }) => {
    const streams = countEventSources(context);
    await openKitchen(page);
    await placeApproved({});
    await expect(page.getByTestId("kitchen-card")).toHaveCount(1);
    expect(streams.count()).toBe(1);
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveTitle(/\(1\) Cocina/);
  });

  test("layout: long orders scroll INSIDE the card; no overflow and targets >= 56 px at 1280, 1024 and 768", async ({ page }) => {
    // A 7-unit order with lots of modifiers + a very long note, next to normal ones.
    const big = await placeApproved({ single: false, unitNote: "Cortar al medio, bien cocida, sin sal, sin pepinillos, extra salsa aparte, avisar si falta algo" });
    // Extra units on the same order (more than the fixture's three), cloned rows.
    const items = await itemsOfOrder(big.id);
    for (let i = 0; i < 5; i++) {
      const src = items[i % items.length];
      const [row] = await db().insert(s.orderItems).values({ orderId: big.id, productId: src.productId, nameSnapshot: `${src.nameSnapshot} con nombre largo ${i}`, unitPriceSnapshot: src.unitPriceSnapshot, notes: null }).returning({ id: s.orderItems.id });
      for (const m of src.modifiers) {
        await db().insert(s.orderItemModifiers).values({ orderItemId: row.id, modifierId: m.modifierId, nameSnapshot: m.nameSnapshot, kitchenLabel: `${m.kitchenLabel} EXTRA LARGO DE PRUEBA`, kind: m.kind, priceDelta: m.priceDelta });
      }
    }
    const t = await placeApproved({ fulfillment: "takeaway" });
    const pos = await counterOrder();
    const done = await placeApproved({});
    await readyInDb(done.id);
    await setStatusClock(t.id, "en_preparacion", new Date(Date.now() - 12 * 60_000));
    await setStatusClock(big.id, "en_preparacion", new Date(Date.now() - 18 * 60_000));
    await openKitchen(page);
    await expect(kcard(page, big.number)).toBeVisible();
    await expect(kcard(page, pos.number)).toBeVisible();

    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await waitForStablePage(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}`).toBeLessThanOrEqual(0);
      for (const button of await page.getByTestId("kitchen-ready").all()) {
        expect((await button.boundingBox())!.height, `LISTO height at ${width}`).toBeGreaterThanOrEqual(56);
      }
      for (const button of await page.getByTestId("recent-undo").all()) {
        expect((await button.boundingBox())!.height, `undo height at ${width}`).toBeGreaterThanOrEqual(56);
      }
      expect((await page.getByTestId("sound-toggle").boundingBox())!.height).toBeGreaterThanOrEqual(56);
      // The long order is capped in height and scrolls inside, with its note fully shown.
      const card = kcard(page, big.number);
      const box = (await card.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(36 * 16 + 2);
      const units = card.getByTestId("kitchen-units");
      expect(await units.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const note = card.getByTestId("kitchen-note");
      expect(await note.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await units.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(card.getByTestId("kitchen-unit").last()).toBeInViewport();
      await units.evaluate((el) => (el.scrollTop = 0));
      await shotViewport(page, `cocina-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForStablePage(page);
    await shot(page, "cocina-1280-full");
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("opens /cocina from the navigation, acts on her own sector only", async ({ page }) => {
    const delivery = await placeApproved({ fulfillment: "delivery" });
    const takeaway = await placeApproved({ fulfillment: "takeaway" });
    await page.goto("/mostrador");
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Cocina" }).click();
    await expect(page).toHaveURL(/\/cocina$/);
    await expect(kcard(page, delivery.number)).toBeVisible();
    await expect(kcard(page, delivery.number).getByTestId("kitchen-ready")).toBeDisabled();
    await expect(kcard(page, delivery.number).getByTestId("kitchen-ready")).toHaveText("OTRO SECTOR");
    await kcard(page, takeaway.number).getByTestId("kitchen-ready").click();
    await expect(kcard(page, takeaway.number)).toHaveCount(0);
    expect((await orderById(takeaway.id)).status).toBe("listo_despacho");
    expect((await orderById(delivery.id)).status).toBe("en_preparacion");
    await shot(page, "cocina-cajera");
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("can open /cocina and mark any sector's order", async ({ page }) => {
    const delivery = await placeApproved({ fulfillment: "delivery" });
    await page.goto("/cocina");
    await expect(page.getByTestId("kitchen-board")).toBeVisible();
    await kcard(page, delivery.number).getByTestId("kitchen-ready").click();
    await expect(kcard(page, delivery.number)).toHaveCount(0);
    expect((await orderById(delivery.id)).status).toBe("listo_despacho");
  });
});
