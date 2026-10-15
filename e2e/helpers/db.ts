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
