import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { UNEXPECTED, type Result } from "./admin";

/**
 * Fixed-contents combos (plan 2026-11-18-combos). A product with rows in `combo_items` is a combo: it is sold at its
 * own price, and each sale keeps what it contained. No nesting (a combo never contains a combo). No next/* imports.
 */

type Conn = Db | DbTransaction;
export type ComboItemInput = { productId: number; quantity: number };
export type ComboItem = { productId: number; name: string; quantity: number; price: number; active: boolean };

export const COMBO_MAX_QUANTITY = 20;

export async function getComboItems(db: Conn, comboId: number): Promise<ComboItem[]> {
  const rows = await db
    .select({ productId: s.comboItems.productId, name: s.products.name, quantity: s.comboItems.quantity, price: s.products.price, active: s.products.active })
    .from(s.comboItems)
    .innerJoin(s.products, eq(s.products.id, s.comboItems.productId))
    .where(eq(s.comboItems.comboId, comboId))
    .orderBy(asc(s.comboItems.sort), asc(s.comboItems.productId));
  return rows;
}

/** What the contents would cost bought separately (centavos), at today's prices. 0 for a plain product. */
export async function comboSeparatePrice(db: Conn, comboId: number): Promise<number> {
  return (await getComboItems(db, comboId)).reduce((sum, i) => sum + i.price * i.quantity, 0);
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Replaces a combo's contents atomically. An empty list turns it back into a plain product. */
export async function setComboItems(db: Conn, comboId: number, items: ComboItemInput[]): Promise<Result<null>> {
  if (!Number.isInteger(comboId) || comboId <= 0) return fail("El producto no existe");
  if (!Array.isArray(items)) return fail("Solicitud inválida");
  for (const i of items) {
    if (!Number.isInteger(i.productId) || i.productId <= 0) return fail("Algún producto elegido no existe");
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > COMBO_MAX_QUANTITY) return fail("La cantidad va de 1 a 20");
  }
  const ids = items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) return fail("Cada producto va una sola vez");
  if (ids.includes(comboId)) return fail("Un combo no puede incluirse a sí mismo");
  try {
    return await (db as Db).transaction(async (tx) => {
      const [combo] = await tx.select({ id: s.products.id }).from(s.products).where(eq(s.products.id, comboId));
      if (!combo) return fail("El producto no existe");
      if (ids.length > 0) {
        const found = await tx.select({ id: s.products.id }).from(s.products).where(inArray(s.products.id, ids));
        if (found.length !== ids.length) return fail("Algún producto elegido no existe");
        // No nesting, in both directions.
        const [nested] = await tx.select({ id: s.comboItems.comboId }).from(s.comboItems).where(inArray(s.comboItems.comboId, ids)).limit(1);
        if (nested) return fail("Un combo no puede incluir otro combo");
        const [inside] = await tx
          .select({ id: s.comboItems.comboId })
          .from(s.comboItems)
          .where(and(eq(s.comboItems.productId, comboId), ne(s.comboItems.comboId, comboId)))
          .limit(1);
        if (inside) return fail("Este producto está dentro de un combo: no puede ser un combo");
      }
      await tx.delete(s.comboItems).where(eq(s.comboItems.comboId, comboId));
      if (items.length > 0) {
        await tx.insert(s.comboItems).values(items.map((i, sort) => ({ comboId, productId: i.productId, quantity: i.quantity, sort })));
      }
      return { ok: true as const, data: null };
    });
  } catch {
    console.error("[combos] setComboItems failed");
    return fail(UNEXPECTED);
  }
}

/** Ids of the products that are combos (have contents). */
export async function comboIds(db: Conn): Promise<Set<number>> {
  const rows = await db.selectDistinct({ id: s.comboItems.comboId }).from(s.comboItems);
  return new Set(rows.map((r) => r.id));
}

