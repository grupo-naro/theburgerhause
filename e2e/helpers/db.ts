import { and, asc, count, eq, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as s from "../../src/db/schema";
import { getSettings } from "../../src/lib/settings";

/** Tiny read helpers over the app's own db client (always the TEST database; see playwright.config.ts). */
export const db = () => getDb();

export async function countProducts(name: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(s.products).where(eq(s.products.name, name));
  return row.n;
}

export async function findProduct(name: string) {
  const [row] = await db().select().from(s.products).where(eq(s.products.name, name));
  return row;
}

export async function countCategories(name: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(s.categories).where(eq(s.categories.name, name));
  return row.n;
}

export async function countActiveSessions(userId: number): Promise<number> {
  const [row] = await db().select({ n: count() }).from(s.sessions).where(and(eq(s.sessions.userId, userId)));
  return row.n;
}

export async function findGroup(name: string) {
  const [row] = await db().select().from(s.modifierGroups).where(eq(s.modifierGroups.name, name));
  return row;
}

export async function countGroups(name: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(s.modifierGroups).where(eq(s.modifierGroups.name, name));
  return row.n;
}

export async function findModifier(groupId: number, name: string) {
  const [row] = await db()
    .select()
    .from(s.modifiers)
    .where(and(eq(s.modifiers.groupId, groupId), eq(s.modifiers.name, name)));
  return row;
}

export async function linkedGroupIds(productId: number): Promise<number[]> {
  const rows = await db()
    .select({ groupId: s.productModifierGroups.groupId })
    .from(s.productModifierGroups)
    .where(eq(s.productModifierGroups.productId, productId));
  return rows.map((r) => r.groupId).sort((a, b) => a - b);
}

export async function findCadet(name: string) {
  const [row] = await db().select().from(s.cadets).where(eq(s.cadets.name, name));
  return row;
}

export async function findUser(username: string) {
  const [row] = await db().select().from(s.users).where(eq(s.users.username, username));
  return row;
}

export async function findStation(name: string) {
  const [row] = await db().select().from(s.stations).where(eq(s.stations.name, name));
  return row;
}

/** Raw jsonb value of one settings key (null when the row does not exist). */
export async function settingValue(key: string): Promise<unknown> {
  const [row] = await db().select().from(s.settings).where(eq(s.settings.key, key));
  return row ? row.value : null;
}

/** Flips the uncached "accepting orders" switch straight in the DB (no cache involved). */
export async function setAcceptingOrders(open: boolean): Promise<void> {
  await db()
    .insert(s.settings)
    .values({ key: "accepting_orders", value: open })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: open } });
}

/** Id of an ACTIVE modifier by its (unique in the seed) name. */
export async function modifierIdByName(name: string): Promise<number> {
  const [row] = await db()
    .select({ id: s.modifiers.id })
    .from(s.modifiers)
    .where(and(eq(s.modifiers.name, name), eq(s.modifiers.active, true)));
  if (!row) throw new Error(`modifier not found: ${name}`);
  return row.id;
}

/** Orders (newest first) of one customer name; e2e specs use unique names so they never see each other's rows. */
export async function ordersOf(customerName: string) {
  return db().select().from(s.orders).where(eq(s.orders.customerName, customerName)).orderBy(s.orders.id);
}

export async function countOrdersOf(customerName: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(s.orders).where(eq(s.orders.customerName, customerName));
  return row.n;
}

/** The items of an order in insertion order, each with its modifier snapshots (sorted by id). */
export async function itemsOfOrder(orderId: number) {
  const items = await db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(asc(s.orderItems.id));
  const out = [];
  for (const item of items) {
    const mods = await db()
      .select()
      .from(s.orderItemModifiers)
      .where(eq(s.orderItemModifiers.orderItemId, item.id))
      .orderBy(asc(s.orderItemModifiers.id));
    out.push({ ...item, modifiers: mods });
  }
  return out;
}

export async function eventsOfOrder(orderId: number) {
  return db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId));
}

/** Current settings straight from the DB (other specs may have saved different store data). */
export const currentSettings = () => getSettings(db());

/** Flips a product's active flag in the DB WITHOUT touching any cache (the public menu stays stale on purpose). */
export async function setProductActiveInDb(name: string, active: boolean): Promise<void> {
  await db().update(s.products).set({ active }).where(eq(s.products.name, name));
}

/** The order row of a public token. */
export async function orderByToken(token: string) {
  const [row] = await db().select().from(s.orders).where(eq(s.orders.publicToken, token));
  return row;
}

/**
 * Moves an order to `status` (and optionally its payment status) straight in the DB, with the audit
 * event a real transition leaves, the way staff screens will. Orders are per-test, so nothing to restore.
 */
export async function setOrderStatusInDb(
  token: string,
  status: (typeof s.orders.$inferSelect)["status"],
  paymentStatus?: (typeof s.orders.$inferSelect)["paymentStatus"],
): Promise<void> {
  const order = await orderByToken(token);
  await db()
    .update(s.orders)
    .set({ status, ...(paymentStatus ? { paymentStatus } : {}) })
    .where(eq(s.orders.id, order.id));
  await db().insert(s.orderEvents).values({ orderId: order.id, fromStatus: order.status, toStatus: status, userId: null, note: "e2e" });
}

/** Terminates the server's dedicated LISTEN connection(s) (application_name 'bh-listener') on the test DB. */
export async function killListenerBackends(): Promise<number> {
  const rows = await db().execute(
    sql`select pg_terminate_backend(pid) as ok from pg_stat_activity where application_name = 'bh-listener' and datname = current_database()`,
  );
  return rows.rows.length;
}

/** How many 'bh-listener' connections the server currently holds on the test DB. */
export async function listenerConnections(): Promise<number> {
  const rows = await db().execute(
    sql`select count(*)::int as n from pg_stat_activity where application_name = 'bh-listener' and datname = current_database()`,
  );
  return Number((rows.rows[0] as { n: number }).n);
}

/** Stock item by name (case-insensitive, like the unique index). */
export async function findStockItem(name: string) {
  const [row] = await db().select().from(s.stockItems).where(sql`lower(${s.stockItems.name}) = lower(${name})`);
  return row;
}

/** Removes a stock item with its whole ledger so a spec can re-create it by name (the DB is seeded once per run). */
export async function deleteStockItem(name: string): Promise<void> {
  const item = await findStockItem(name);
  if (!item) return;
  await db().execute(sql`delete from stock_movement_edits where movement_id in (select id from stock_movements where item_id = ${item.id})`);
  await db().delete(s.stockMovements).where(eq(s.stockMovements.itemId, item.id));
  await db().update(s.products).set({ stockItemId: null, stockPaused: false }).where(eq(s.products.stockItemId, item.id));
  await db().delete(s.stockItems).where(eq(s.stockItems.id, item.id));
}

/** The movements of an item, oldest first. */
export async function stockMovementsOf(itemId: number) {
  return db().select().from(s.stockMovements).where(eq(s.stockMovements.itemId, itemId)).orderBy(asc(s.stockMovements.id));
}

/**
 * Removes the rendiciones de materia prima of these dates so a spec can close them again: their
 * movements first (putting the stock back, so quantity = sum of movements still holds), then the closing.
 */
export async function deleteStockClosings(dates: string[]): Promise<void> {
  for (const date of dates) {
    const [c] = await db().select({ id: s.stockClosings.id }).from(s.stockClosings).where(eq(s.stockClosings.businessDate, date));
    if (!c) continue;
    await db().execute(sql`delete from stock_movement_edits where movement_id in (select id from stock_movements where closing_id = ${c.id})`);
    await db().execute(
      sql`update stock_items i set quantity = i.quantity - m.total from (select item_id, sum(qty_delta)::int as total from stock_movements where closing_id = ${c.id} group by item_id) m where i.id = m.item_id`,
    );
    await db().delete(s.stockMovements).where(eq(s.stockMovements.closingId, c.id));
    await db().delete(s.stockClosings).where(eq(s.stockClosings.id, c.id));
  }
}

/** The rendición de materia prima of a date, if closed. */
export async function findStockClosing(date: string) {
  const [row] = await db().select().from(s.stockClosings).where(eq(s.stockClosings.businessDate, date));
  return row;
}
