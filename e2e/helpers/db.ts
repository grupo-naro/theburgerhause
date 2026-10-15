import { and, count, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as s from "../../src/db/schema";

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
