import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { testDb } from "@/db/test-utils";

/** Shared seed for the stock *.int.test.ts files (test database only). */
export type StockFx = { userId: number; coca: number; carne: number; cocaProduct: number; burger: number };

export async function seedStock(): Promise<StockFx> {
  const d = testDb();
  const [user] = await d
    .insert(s.users)
    .values({ name: "Enzo", username: "enzo", passwordHash: "x", role: "encargado" })
    .returning({ id: s.users.id });
  const [coca, carne] = await d
    .insert(s.stockItems)
    .values([
      { name: "Coca-Cola 500 ml", kind: "bebida", unit: "u", minQty: 6000 },
      { name: "Carne picada", kind: "materia_prima", unit: "kg", minQty: 10000 },
    ])
    .returning({ id: s.stockItems.id });
  const [cat] = await d.insert(s.categories).values({ name: "Bebidas", slug: "bebidas" }).returning({ id: s.categories.id });
  const [cocaProduct, burger] = await d
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Coca-Cola", price: 2500_00, stockItemId: coca.id },
      { categoryId: cat.id, name: "Burger", price: 8000_00 },
    ])
    .returning({ id: s.products.id });
  return { userId: user.id, coca: coca.id, carne: carne.id, cocaProduct: cocaProduct.id, burger: burger.id };
}

export async function itemQty(itemId: number): Promise<number> {
  const [row] = await testDb().select({ q: s.stockItems.quantity }).from(s.stockItems).where(eq(s.stockItems.id, itemId));
  return row.q;
}

export async function productFlags(productId: number): Promise<{ active: boolean; stockPaused: boolean }> {
  const [row] = await testDb()
    .select({ active: s.products.active, stockPaused: s.products.stockPaused })
    .from(s.products)
    .where(eq(s.products.id, productId));
  return row;
}

export async function movementsOf(itemId: number) {
  return testDb().select().from(s.stockMovements).where(eq(s.stockMovements.itemId, itemId)).orderBy(s.stockMovements.id);
}

/** Deterministic v4 UUIDs for idempotency keys. */
export function key(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
