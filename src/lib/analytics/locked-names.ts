import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";

/**
 * Names shown on the LOCKED analytics page. Deliberately not derived from sales (the order of a
 * ranking would leak who sells more): active products and active cashiers, alphabetical.
 */
export async function getLockedNames(db: Db, opts: { categoryId?: number }): Promise<{ products: string[]; sellers: string[] }> {
  const productWhere =
    opts.categoryId === undefined ? eq(s.products.active, true) : and(eq(s.products.active, true), eq(s.products.categoryId, opts.categoryId));
  const [products, sellers] = await Promise.all([
    db.select({ name: s.products.name }).from(s.products).where(productWhere).orderBy(asc(s.products.name)).limit(10),
    db
      .select({ name: s.users.name })
      .from(s.users)
      .where(and(eq(s.users.active, true), eq(s.users.role, "cajera")))
      .orderBy(asc(s.users.name)),
  ]);
  return { products: products.map((r) => r.name), sellers: sellers.map((r) => r.name) };
}
