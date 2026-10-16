import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { expect, type Locator, type Page } from "@playwright/test";
import * as s from "../../src/db/schema";
import { formatARS } from "../../src/domain/money";
import { createCounterOrder } from "../../src/lib/orders/create-counter-order";
import { settleStationJobs } from "./agent";
import { db, findProduct, findStation, findUser } from "./db";

export const STATION = "Mostrador 1";
export const POS_CART_PREFIX = "bh_pos_cart_v1:";

export const board = (page: Page): Locator => page.getByTestId("pos-board");
export const search = (page: Page): Locator => page.getByTestId("pos-search");
export const tiles = (page: Page): Locator => page.getByTestId("pos-tile");
export const ticketLines = (page: Page): Locator => page.getByTestId("ticket-line");
export const chargeButton = (page: Page): Locator => page.getByTestId("charge-button");
export const totalOf = (page: Page): Locator => page.getByTestId("ticket-total");
export const overlay = (page: Page): Locator => page.getByTestId("confirmation-overlay");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The big "add one plain unit" button of a product tile. */
export const tileMain = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^Agregar ${escapeRe(name)}, `) });
export const tileCustomize = (page: Page, name: string): Locator => page.getByRole("button", { name: `Personalizar ${name}` });

/** Ticket lines of one product (grouped lines), in ticket order. */
export const linesOf = (page: Page, name: string): Locator =>
  ticketLines(page).filter({ has: page.getByTestId("line-name").getByText(name, { exact: true }) });

/** Opens /mostrador and waits for hydration + the stored cart + the live connection. */
export async function openPos(page: Page): Promise<void> {
  await page.goto("/mostrador");
  await expect(board(page)).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

/** Seed price (centavos) of a product, straight from the DB the app was seeded with. */
export async function priceOf(name: string): Promise<number> {
  return (await findProduct(name)).price;
}

export async function modifierDelta(name: string): Promise<number> {
  const [row] = await db().select({ d: s.modifiers.priceDelta }).from(s.modifiers).where(and(eq(s.modifiers.name, name), eq(s.modifiers.active, true)));
  return row.d;
}

/** Presses the on-screen keypad digit by digit. */
export async function typePager(page: Page, digits: string): Promise<void> {
  for (const d of digits) await page.getByTestId(`pager-key-${d}`).click();
}

export const pagerInput = (page: Page): Locator => page.getByTestId("pager-input");

/** Cash sale up to the point where only the click on Cobrar is left. */
export async function readySale(page: Page, o: { payment?: "cash" | "transfer"; pager: string }): Promise<void> {
  await page.getByTestId(`pay-${o.payment ?? "cash"}`).click();
  await typePager(page, o.pager);
  await expect(chargeButton(page)).toBeEnabled();
}

/** The latest counter order (the one the test just charged). */
export async function latestCounterOrder() {
  const [row] = await db().select().from(s.orders).where(eq(s.orders.channel, "counter")).orderBy(desc(s.orders.id)).limit(1);
  return row;
}

export async function counterOrderCount(): Promise<number> {
  const rows = await db().select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.channel, "counter"));
  return rows.length;
}

export const jobsOf = (orderId: number) => db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(asc(s.printJobs.id));

export async function itemsOf(orderId: number) {
  const items = await db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(asc(s.orderItems.id));
  const out = [];
  for (const it of items) {
    const mods = await db().select().from(s.orderItemModifiers).where(eq(s.orderItemModifiers.orderItemId, it.id)).orderBy(asc(s.orderItemModifiers.id));
    out.push({ ...it, modifiers: mods });
  }
  return out;
}

/** Marks an order delivered in the DB (frees its pager) and pushes the realtime hint the app would. */
export async function deliverOrderInDb(orderId: number): Promise<void> {
  await db().update(s.orders).set({ status: "entregado", deliveredAt: new Date() }).where(eq(s.orders.id, orderId));
  const payload = JSON.stringify({ orderId, status: "entregado", event: "status" });
  await db().execute(sql`select pg_notify('orders_changed', ${payload})`);
}

/** Test cleanup: no counter order keeps a pager, and nothing stays queued for the station. */
export async function releaseCounterState(): Promise<void> {
  await db()
    .update(s.orders)
    .set({ status: "entregado" })
    .where(and(eq(s.orders.channel, "counter"), inArray(s.orders.status, ["en_preparacion", "listo_despacho", "para_retirar"])));
  await settleStationJobs(STATION);
}

export { formatARS };

/** A real counter sale through the core (notifies like the app does), to occupy a pager. */
export async function seedCounterOrder(pager: number): Promise<{ orderId: number; number: number }> {
  const cajera = await findUser("cajera");
  const station = await findStation(STATION);
  const ranchita = await findProduct("Ranchita simple");
  const r = await createCounterOrder(db(), {
    idempotencyKey: randomUUID(),
    units: [{ productId: ranchita.id, modifierIds: [], note: "" }],
    paymentMethod: "cash",
    pagerNumber: pager,
    userId: cajera.id,
    stationId: station.id,
  });
  if (!r.ok) throw new Error(`could not seed a counter order: ${r.code}`);
  return { orderId: r.data.orderId, number: r.data.number };
}
