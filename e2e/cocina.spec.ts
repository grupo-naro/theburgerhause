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
import { authFile, USERS } from "./helpers/users";

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

  test("the cocina user cannot open the other screens: every URL leads to its home, the counter TV (/pantalla)", async ({ page }) => {
    for (const path of ["/caja", "/retiro", "/delivery", "/despacho", "/mostrador", "/mostrador/pedidos", "/admin", "/estacion"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/pantalla$/);
    }
    await page.goto("/cocina");
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
    // Nothing hangs out below the dark shell (a screen-reader-only span inside a scroller once stretched the document).
    const extra = await page.evaluate(() => document.documentElement.scrollHeight - document.body.getBoundingClientRect().bottom - scrollY);
    expect(extra, "document taller than the kitchen shell").toBeLessThanOrEqual(2);
    await shot(page, "cocina-1280-full");
  });

  test("a long order with a note on EVERY unit keeps LISTO inside the card and on screen at 1280, 1024 and 768", async ({ page }) => {
    const big = await placeApproved({ single: false });
    const items = await itemsOfOrder(big.id);
    for (let i = 0; i < 7; i++) {
      const src = items[i % items.length];
      await db().insert(s.orderItems).values({ orderId: big.id, productId: src.productId, nameSnapshot: src.nameSnapshot, unitPriceSnapshot: src.unitPriceSnapshot, notes: null });
    }
    const note = (n: number) => `Unidad ${n}: sin sal, bien cocida, cortar al medio, extra salsa aparte, sin pepinillos, avisar si falta algo, empacar separado`;
    const all = await itemsOfOrder(big.id);
    expect(all.length).toBe(10);
    for (const [i, item] of all.entries()) await db().update(s.orderItems).set({ notes: note(i + 1).slice(0, 140) }).where(eq(s.orderItems.id, item.id));
    await openKitchen(page);
    const card = kcard(page, big.number);
    await expect(card).toBeVisible();
    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await waitForStablePage(page);
      const cardBox = (await card.boundingBox())!;
      const ready = (await card.getByTestId("kitchen-ready").boundingBox())!;
      expect(ready.y, `LISTO inside the card at ${width}`).toBeGreaterThanOrEqual(cardBox.y);
      expect(ready.y + ready.height, `LISTO inside the card at ${width}`).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
      await expect(card.getByTestId("kitchen-ready")).toBeInViewport();
      const units = card.getByTestId("kitchen-units");
      expect(await units.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await units.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(card.getByTestId("kitchen-unit").last()).toBeInViewport();
      await units.evaluate((el) => (el.scrollTop = 0));
    }
    await shotViewport(page, "cocina-long-notes-768");
  });

  test("the age keeps growing when the device clock is hours behind the server", async ({ page }) => {
    const o = await placeApproved({});
    await setStatusClock(o.id, "en_preparacion", new Date(Date.now() - 20 * 60_000));
    await page.clock.install({ time: new Date(Date.now() - 3 * 3_600_000) }); // the tablet thinks it is 3 hours earlier
    await page.goto("/cocina");
    const clock = kcard(page, o.number).getByTestId("kitchen-clock");
    await expect(clock).toHaveText("hace 20 min");
    await page.clock.fastForward(5 * 60_000);
    await expect(clock).toHaveText("hace 25 min");
    await expect(clock).toHaveAttribute("data-color", "red");
  });

  test("login through the form: no station hop, straight to the counter TV (/pantalla)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    try {
      const page = await context.newPage();
      const visited: string[] = [];
      page.on("framenavigated", (f) => f.parentFrame() === null && visited.push(new URL(f.url()).pathname));
      await page.goto("/login");
      await page.getByLabel("Usuario").fill(USERS.cocina.username);
      await page.getByLabel("Contraseña").fill(USERS.cocina.password);
      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page).toHaveURL(/\/pantalla$/);
      await expect(page.getByTestId("counter-board")).toBeVisible();
      expect(visited).not.toContain("/estacion");
    } finally {
      await context.close();
    }
  });

  test("undo from a second screen when the order is already back in preparation: friendly message", async ({ page }) => {
    await openKitchen(page);
    const o = await placeApproved({});
    await kcard(page, o.number).getByTestId("kitchen-ready").click();
    await expect(recent(page, o.number)).toBeVisible();
    // Another screen undoes it first, behind this one's back (no realtime hint).
    await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, o.id));
    await recent(page, o.number).getByTestId("recent-undo").click();
    await expect(page.getByTestId("toast")).toContainText("Ese pedido ya está en preparación");
    await expect(kcard(page, o.number)).toBeVisible();
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("she can still open /cocina directly (the menu link is now Pantalla); she acts on her own sector only", async ({ page }) => {
    const delivery = await placeApproved({ fulfillment: "delivery" });
    const takeaway = await placeApproved({ fulfillment: "takeaway" });
    const kitchen = page;
    await kitchen.goto("/cocina");
    await expect(kitchen).toHaveURL(/\/cocina$/);
    await expect(kcard(kitchen, delivery.number)).toBeVisible();
    await expect(kcard(kitchen, delivery.number).getByTestId("kitchen-ready")).toBeDisabled();
    await expect(kcard(kitchen, delivery.number).getByTestId("kitchen-ready")).toHaveText("OTRO SECTOR");
    await kcard(kitchen, takeaway.number).getByTestId("kitchen-ready").click();
    await expect(kcard(kitchen, takeaway.number)).toHaveCount(0);
    expect((await orderById(takeaway.id)).status).toBe("listo_despacho");
    expect((await orderById(delivery.id)).status).toBe("en_preparacion");
    // "Salir" leads back to her home, in the same tab.
    await kitchen.getByTestId("kitchen-exit").click();
    await expect(kitchen).toHaveURL(/\/mostrador$/);
  });

  test("chromeless for everyone: no sidebar, navigation, station name or shell alert at 1920x1080 and 1280x720", async ({ page }) => {
    await placeApproved({ fulfillment: "takeaway" });
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/cocina");
      await expect(page.getByTestId("kitchen-board")).toBeVisible();
      await expectChromeless(page);
    }
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

  test("chromeless and filling the monitor at 1920x1080 and 1280x720, with a full order wall", async ({ page }) => {
    for (let i = 0; i < 5; i++) await placeApproved({ fulfillment: i % 2 ? "takeaway" : "delivery", single: i === 0 });
    await counterOrder();
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/cocina");
      await expect(page.getByTestId("kitchen-board")).toBeVisible();
      await expect(page.getByTestId("kitchen-card").first()).toBeVisible();
      await expectChromeless(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const shell = (await page.getByTestId("kitchen-shell").boundingBox())!;
      expect(shell.width).toBeGreaterThanOrEqual(width - 20); // the board spans the whole monitor
    }
  });
});

/** The dedicated kitchen frame: nothing of the staff shell (sidebar, navigation, station label, printer, alert badge). */
async function expectChromeless(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Secciones" })).toHaveCount(0);
  await expect(page.getByTestId("station-name")).toHaveCount(0);
  await expect(page.getByTestId("shell-announcer")).toHaveCount(0);
  await expect(page.getByText(/Estación/)).toHaveCount(0);
  await expect(page.getByText("Cambiar estación")).toHaveCount(0);
  await expect(page.getByTestId("kitchen-shell")).toBeVisible();
}
