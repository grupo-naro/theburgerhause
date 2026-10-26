import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { approveOrder } from "../src/lib/orders/approve-order";
import { beeps, countEventSources, orderById, placeCajaOrder, stubAudio } from "./helpers/caja";
import { db, findStation, findUser } from "./helpers/db";
import { cleanBoard, counterOrder, dcard, lane, nextPager, openPedidos, placeApproved, pingOrders, readyInDb } from "./helpers/despacho";
import { staffContext } from "./helpers/journey";
import { chargeButton, latestCounterOrder, openPos, readySale, tileMain } from "./helpers/pos";
import { authFile, USERS } from "./helpers/users";

/**
 * The counter TV at /pantalla (McDonald's style, read only): "En preparación" on the left third, "¡Listo! Retiralo en el
 * mostrador" on the right two thirds, ORDER NUMBERS only, counter sales and web takeaway orders (never delivery).
 * The `cocina` user is the TV's login; cajera / encargada / encargado / admin can open it too.
 */

const VIEWPORTS = [
  [1920, 1080],
  [1280, 720],
] as const;

const prepNum = (page: Page, n: number): Locator => page.getByTestId("zone-preparing").locator(`[data-testid="board-number"][data-order-number="${n}"]`);
const readyNum = (page: Page, n: number): Locator => page.getByTestId("zone-ready").locator(`[data-testid="board-number"][data-order-number="${n}"]`);
const anyNum = (page: Page, n: number): Locator => page.locator(`[data-testid="board-number"][data-order-number="${n}"]`);

async function openScreen(page: Page): Promise<void> {
  await page.goto("/pantalla");
  await expect(page.getByTestId("counter-board")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

async function approveTakeaway(orderId: number): Promise<void> {
  const cajera = await findUser("cajera");
  const station = await findStation("Mostrador 1");
  const r = await approveOrder(db(), { sector: null, orderId, userId: cajera.id, stationId: station.id, paymentVerified: false });
  if (!r.ok) throw new Error(`approve failed: ${r.message}`);
}

/** Read only and anonymous: the single sound switch is the only control; no names, addresses or amounts. */
async function expectReadOnly(page: Page, secrets: string[]): Promise<void> {
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button")).toHaveAttribute("data-testid", "sound-toggle");
  await expect(page.locator("a, input, select, textarea, [role=link], [role=menu]")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const secret of secrets) expect(text, `"${secret}" must not be on the TV`).not.toContain(secret);
  expect(text).not.toMatch(/\$\s?\d/); // no amounts
  const html = await page.content();
  for (const secret of secrets) expect(html, `"${secret}" must not be in the DOM`).not.toContain(secret);
}

test.beforeEach(cleanBoard);
test.afterAll(cleanBoard);

for (const [width, height] of VIEWPORTS) {
  test.describe(`cocina user (the TV) at ${width}x${height}`, () => {
    test.use({ storageState: authFile("cocina"), viewport: { width, height } });

    test(`pantalla: the whole life of counter and takeaway numbers, live, with the ready chime (${width})`, async ({ page, browser, baseURL, context }) => {
      test.setTimeout(90_000);
      await stubAudio(page);
      const streams = countEventSources(context);
      const cashier = await staffContext(browser, baseURL, "cajera");
      try {
        const pedidos = await cashier.newPage();
        await openPedidos(pedidos);
        await openScreen(page);
        await expect(page.getByTestId("zone-preparing")).toContainText("En preparación");
        await expect(page.getByTestId("zone-ready")).toContainText("¡Listo! Retiralo en el mostrador");

        // Sound is on by default but the browser needs a first touch: a discreet hint says so until then.
        await expect(page.getByTestId("sound-hint")).toBeVisible();
        await expect(page.getByTestId("sound-hint").getByRole("button")).toHaveCount(0);
        await page.mouse.click(width / 2, height / 2);
        await expect(page.getByTestId("sound-hint")).toHaveCount(0);
        const base = await beeps(page);

        // A counter sale appears in "En preparación" without reloading.
        const pos = await counterOrder();
        await expect(prepNum(page, pos.number)).toBeVisible();
        await expect(prepNum(page, pos.number)).toHaveText(String(pos.number));
        await expect(readyNum(page, pos.number)).toHaveCount(0);

        // A web takeaway order appears only once approved; a delivery order never does.
        const takeaway = await placeCajaOrder({ fulfillment: "takeaway", single: true });
        const delivery = await placeApproved({ fulfillment: "delivery" });
        await pingOrders(takeaway.id);
        await page.waitForTimeout(800);
        await expect(anyNum(page, takeaway.number)).toHaveCount(0);
        await approveTakeaway(takeaway.id);
        await expect(prepNum(page, takeaway.number)).toBeVisible();
        await expect(anyNum(page, delivery.number)).toHaveCount(0);
        // Oldest first.
        await expect(page.getByTestId("zone-preparing").getByTestId("board-number")).toHaveText([String(pos.number), String(takeaway.number)]);

        // "Listo" from Mostrador: moves to the right, highlighted, with ONE ding.
        await dcard(pedidos, pos.number).getByTestId("mark-ready").click();
        await expect(readyNum(page, pos.number)).toBeVisible();
        await expect(prepNum(page, pos.number)).toHaveCount(0);
        await expect(readyNum(page, pos.number).getByTestId("ready-highlight")).toBeVisible();
        await expect.poll(() => beeps(page)).toBe(base + 1);
        // The highlight lasts a few seconds.
        await expect(readyNum(page, pos.number).getByTestId("ready-highlight")).toHaveCount(0, { timeout: 15_000 });

        // Ready numbers are bigger than the ones in preparation.
        const size = async (l: Locator) => Number.parseFloat(await l.evaluate((el) => getComputedStyle(el).fontSize));
        expect(await size(readyNum(page, pos.number))).toBeGreaterThan(await size(prepNum(page, takeaway.number)));

        // Called (para_retirar): still ready, no second ding.
        await lane(pedidos, "ready-counter").locator(`[data-order-number="${pos.number}"]`).getByTestId("call-pickup").click();
        await expect(lane(pedidos, "pickup").locator(`[data-order-number="${pos.number}"]`)).toBeVisible();
        await pingOrders(pos.orderId);
        await page.waitForTimeout(1000);
        await expect(readyNum(page, pos.number)).toBeVisible();
        expect(await beeps(page)).toBe(base + 1);

        // Delivered: it disappears.
        await lane(pedidos, "pickup").locator(`[data-order-number="${pos.number}"]`).getByTestId("deliver").click();
        await expect(anyNum(page, pos.number)).toHaveCount(0);
        expect((await orderById(pos.orderId)).status).toBe("entregado");

        // The takeaway goes ready, then back to preparation (no ding), then ready again (first time only: no ding).
        await readyInDb(takeaway.id);
        await expect(readyNum(page, takeaway.number)).toBeVisible();
        await expect.poll(() => beeps(page)).toBe(base + 2);
        await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, takeaway.id));
        await db().insert(s.orderEvents).values({ orderId: takeaway.id, fromStatus: "listo_despacho", toStatus: "en_preparacion", note: "e2e: vuelve a preparación" });
        await pingOrders(takeaway.id);
        await expect(prepNum(page, takeaway.number)).toBeVisible();
        await expect(readyNum(page, takeaway.number)).toHaveCount(0);
        await readyInDb(takeaway.id);
        await expect(readyNum(page, takeaway.number)).toBeVisible();
        await page.waitForTimeout(800);
        expect(await beeps(page)).toBe(base + 2);

        // A cancelled order disappears live.
        await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, takeaway.id));
        await pingOrders(takeaway.id);
        await expect(anyNum(page, takeaway.number)).toHaveCount(0);

        await expectReadOnly(page, [takeaway.name, delivery.name, "Av. Rivadavia", USERS.cocina.name]);
        expect(streams.count()).toBe(1);
      } finally {
        await cashier.close();
      }
    });

    test(`pantalla: 40 numbers do not overflow, no manual scroll, large type (${width})`, async ({ page }) => {
      test.setTimeout(120_000);
      const made: number[] = [];
      for (let i = 0; i < 40; i++) {
        const o = await counterOrder();
        made.push(o.number);
        if (i % 2 === 1) await readyInDb(o.orderId);
      }
      await openScreen(page);
      await expect(page.getByTestId("board-number")).toHaveCount(40);
      await page.waitForTimeout(500);

      const doc = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        h: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      expect(doc.w, "horizontal page overflow").toBeLessThanOrEqual(0);
      expect(doc.h, "vertical page overflow").toBeLessThanOrEqual(0);

      for (const zone of ["zone-preparing", "zone-ready"]) {
        const viewport = page.getByTestId(zone).getByTestId("zone-viewport");
        // No manual scroll: the numbers' viewport hides overflow (the board scrolls itself only if it must).
        expect(await viewport.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
        const box = (await page.getByTestId(zone).boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      // Ready zone is two thirds, preparation one third (roughly).
      const prep = (await page.getByTestId("zone-preparing").boundingBox())!;
      const ready = (await page.getByTestId("zone-ready").boundingBox())!;
      expect(ready.width).toBeGreaterThan(prep.width * 1.6);
      expect(prep.x).toBeLessThan(ready.x);

      // Every number readable from afar (in px), the ready ones bigger.
      const fonts = async (zone: string) =>
        page.getByTestId(zone).getByTestId("board-number").evaluateAll((els) => els.map((e) => Number.parseFloat(getComputedStyle(e).fontSize)));
      const prepFonts = await fonts("zone-preparing");
      const readyFonts = await fonts("zone-ready");
      expect(Math.min(...prepFonts)).toBeGreaterThanOrEqual(width >= 1920 ? 40 : 28);
      expect(Math.min(...readyFonts)).toBeGreaterThanOrEqual(width >= 1920 ? 64 : 44);
      expect(Math.min(...readyFonts)).toBeGreaterThan(Math.max(...prepFonts));

      // Either everything is inside its zone, or the zone is auto-scrolling (and says so).
      for (const zone of ["zone-preparing", "zone-ready"]) {
        const viewport = page.getByTestId(zone).getByTestId("zone-viewport");
        const fits = await viewport.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
        if (!fits) await expect(viewport).toHaveAttribute("data-autoscroll", "true");
      }
      await expect(page.getByTestId("zone-ready").getByTestId("board-number").first()).toHaveText(String(made[1]));
    });
  });
}

test.describe("cocina user", () => {
  test.use({ storageState: authFile("cocina") });

  test("pantalla: login through the form lands on /pantalla, no station hop; other screens send it back", async ({ browser, baseURL }) => {
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
      // The TV's cookie is long-lived (no 30-day logout).
      const cookie = (await context.cookies()).find((c) => c.name === "bh_session")!;
      expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(300 * 24 * 3_600_000);
      for (const path of ["/caja", "/mostrador", "/retiro", "/delivery", "/admin"]) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/pantalla$/);
      }
    } finally {
      await context.close();
    }
  });

  test("pantalla: the 60 s safety refresh catches a missed event", async ({ page }) => {
    await page.clock.install();
    await openScreen(page);
    const pos = await counterOrder();
    await expect(prepNum(page, pos.number)).toBeVisible();
    // Changed behind the screen's back: no realtime hint at all.
    await db().update(s.orders).set({ status: "listo_despacho" }).where(eq(s.orders.id, pos.orderId));
    await db().insert(s.orderEvents).values({ orderId: pos.orderId, fromStatus: "en_preparacion", toStatus: "listo_despacho", note: "e2e: sin aviso" });
    await page.clock.runFor(5_000);
    await expect(prepNum(page, pos.number)).toBeVisible();
    await page.clock.runFor(61_000);
    await expect(readyNum(page, pos.number)).toBeVisible();
  });

  test("pantalla: the mute switch is the single discreet control and persists", async ({ page }) => {
    await stubAudio(page);
    await openScreen(page);
    const toggle = page.getByTestId("sound-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("sound-hint")).toHaveCount(0); // muted on purpose: nothing to nag about
    const base = await beeps(page);
    const pos = await counterOrder();
    await expect(prepNum(page, pos.number)).toBeVisible();
    await readyInDb(pos.orderId);
    await expect(readyNum(page, pos.number).getByTestId("ready-highlight")).toBeVisible(); // still highlighted
    await page.waitForTimeout(500);
    expect(await beeps(page)).toBe(base);
    await page.reload();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("sound-toggle").click();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");
    const box = (await page.getByTestId("sound-toggle").boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(64); // discreet, not a big call to action
  });

  test("pantalla: reconnecting (online again) refreshes the board", async ({ page, context }) => {
    await openScreen(page);
    await page.waitForTimeout(1000); // the "just connected" catch-up refresh has landed
    await context.setOffline(true);
    // While offline nothing tries to refresh (a failed refresh would navigate to the browser's error page).
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("counter-board")).toBeVisible();
    const pos = await counterOrder();
    await page.waitForTimeout(500);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(prepNum(page, pos.number)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("pantalla: the Pantalla link opens the TV screen in a NEW tab; a POS sale shows up live", async ({ page, context }) => {
    test.setTimeout(90_000);
    await openPos(page);
    const link = page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Pantalla" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Cocina" })).toHaveCount(0);
    const popup = context.waitForEvent("page");
    await link.click();
    const screen = await popup;
    await expect(screen).toHaveURL(/\/pantalla$/);
    await expect(screen.getByTestId("counter-board")).toBeVisible();
    await expect(screen.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();

    await tileMain(page, "Ranchita simple").click();
    await readySale(page, { pager: String(nextPager()) });
    await chargeButton(page).click();
    await expect.poll(async () => (await latestCounterOrder()).status).toBe("en_preparacion");
    const sale = await latestCounterOrder();
    await expect(prepNum(screen, sale.number)).toBeVisible();
    await expectReadOnly(screen, [USERS.cajera.name, "Mostrador 1"]);
  });

  test("pantalla @mobile: opened from a phone it still fits (no overflow) and stays read only", async ({ page }) => {
    const pos = await counterOrder();
    const done = await counterOrder();
    await readyInDb(done.orderId);
    await openScreen(page);
    await expect(prepNum(page, pos.number)).toBeVisible();
    await expect(readyNum(page, done.number)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectReadOnly(page, [USERS.cajera.name]);
  });

  test("pantalla: chromeless at 1920x1080 and 1280x720 (no sidebar, navigation or station)", async ({ page }) => {
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      await openScreen(page);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByTestId("station-name")).toHaveCount(0);
      await expect(page.getByText(/Estación/)).toHaveCount(0);
      const board = (await page.getByTestId("counter-board").boundingBox())!;
      expect(board.width).toBeGreaterThanOrEqual(width - 1);
      expect(board.height).toBeGreaterThanOrEqual(height - 1);
    }
  });
});

test.describe("other staff", () => {
  for (const who of ["encargada", "encargado", "admin"] as const) {
    test(`pantalla: ${who} can open it`, async ({ browser, baseURL }) => {
      const ctx = await staffContext(browser, baseURL, who);
      try {
        const page = await ctx.newPage();
        await openScreen(page);
      } finally {
        await ctx.close();
      }
    });
  }

  test("pantalla: without a session it asks for the login", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
    try {
      const page = await ctx.newPage();
      await page.goto("/pantalla");
      await expect(page).toHaveURL(/\/login\?next=%2Fpantalla$/);
    } finally {
      await ctx.close();
    }
  });
});
