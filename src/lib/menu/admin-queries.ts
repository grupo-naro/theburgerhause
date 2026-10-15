import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";

export type AdminCategory = typeof s.categories.$inferSelect;
export type AdminProduct = typeof s.products.$inferSelect;
export type AdminMenuCategory = AdminCategory & { products: AdminProduct[] };

/** All categories (active or not) with their products, in display order. */
export async function listMenuForAdmin(db: Db): Promise<AdminMenuCategory[]> {
  const [cats, prods] = await Promise.all([
    db.select().from(s.categories).orderBy(asc(s.categories.sort), asc(s.categories.id)),
    db.select().from(s.products).orderBy(asc(s.products.sort), asc(s.products.id)),
  ]);
  return cats.map((c) => ({ ...c, products: prods.filter((p) => p.categoryId === c.id) }));
}

export async function getCategoryForAdmin(db: Db, id: number): Promise<AdminCategory | null> {
  const [row] = await db.select().from(s.categories).where(eq(s.categories.id, id));
  return row ?? null;
}

export async function getProductForAdmin(db: Db, id: number): Promise<AdminProduct | null> {
  const [row] = await db.select().from(s.products).where(eq(s.products.id, id));
  return row ?? null;
}
