import { and, asc, count, eq } from "drizzle-orm";
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
