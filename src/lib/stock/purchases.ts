import { sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { priceChangePct, purchaseTotal } from "./purchase-math";
import type { Unit } from "./quantity";

/**
 * Purchase prices (plan 2026-11-18-precios-de-compra): priced, non-annulled ingresos per article, with the total and
 * the change against the previous priced purchase of the same article. Admin-only data. No next/* imports.
 */

type Conn = Db | DbTransaction;

export { formatPriceChange, priceChangePct, purchaseTotal } from "./purchase-math";

export type Purchase = {
  movementId: number;
  businessDate: string;
  milli: number;
  unitPrice: number;
  total: number;
  changePct: number | null;
  userName: string | null;
  note: string | null;
};

export type PurchaseGroup = { itemId: number; itemName: string; unit: Unit; last: Purchase; purchases: Purchase[] };

const DEFAULT_PER_ITEM = 12;

type Row = {
  id: number;
  item_id: number;
  item_name: string;
  unit: Unit;
  business_date: string;
  qty_delta: number;
  unit_price: number;
  prev_price: number | null;
  user_name: string | null;
  note: string | null;
};

/** Groups ordered by their newest purchase; purchases newest first, at most `perItem` per article. */
export async function listPurchases(db: Conn, opts: { itemId?: number; perItem?: number } = {}): Promise<PurchaseGroup[]> {
  const perItem = Math.min(Math.max(Math.trunc(opts.perItem ?? DEFAULT_PER_ITEM), 1), 200);
  const byItem = opts.itemId !== undefined ? sql`AND m.item_id = ${opts.itemId}` : sql``;
  const { rows } = await db.execute<Row>(sql`
    WITH p AS (
      SELECT m.id, m.item_id, m.business_date::text AS business_date, m.qty_delta, m.unit_price, m.note, u.name AS user_name,
        LAG(m.unit_price) OVER (PARTITION BY m.item_id ORDER BY m.business_date, m.id) AS prev_price,
        ROW_NUMBER() OVER (PARTITION BY m.item_id ORDER BY m.business_date DESC, m.id DESC) AS rn
      FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.kind = 'ingreso' AND m.unit_price IS NOT NULL AND m.qty_delta <> 0 ${byItem}
    )
    SELECT p.id, p.item_id, i.name AS item_name, i.unit, p.business_date, p.qty_delta, p.unit_price, p.prev_price, p.user_name, p.note
    FROM p JOIN stock_items i ON i.id = p.item_id
    WHERE p.rn <= ${perItem}
    ORDER BY p.business_date DESC, p.id DESC
  `);
  const groups = new Map<number, PurchaseGroup>();
  for (const r of rows) {
    const purchase: Purchase = {
      movementId: r.id,
      businessDate: r.business_date,
      milli: r.qty_delta,
      unitPrice: r.unit_price,
      total: purchaseTotal(r.qty_delta, r.unit_price),
      changePct: r.prev_price === null ? null : priceChangePct(r.prev_price, r.unit_price),
      userName: r.user_name,
      note: r.note,
    };
    const g = groups.get(r.item_id);
    if (g) g.purchases.push(purchase);
    else groups.set(r.item_id, { itemId: r.item_id, itemName: r.item_name, unit: r.unit, last: purchase, purchases: [purchase] });
  }
  // Rows came newest first overall, so Map insertion order is already "newest purchase first".
  return [...groups.values()];
}

export type UnpricedIngreso = { movementId: number; businessDate: string; milli: number; userName: string | null };

/** Ingresos of one article still without a price (not annulled), newest first. */
export async function listUnpricedIngresos(db: Conn, itemId: number, limit = 20): Promise<UnpricedIngreso[]> {
  const { rows } = await db.execute<{ id: number; business_date: string; qty_delta: number; user_name: string | null }>(sql`
    SELECT m.id, m.business_date::text AS business_date, m.qty_delta, u.name AS user_name
    FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.item_id = ${itemId} AND m.kind = 'ingreso' AND m.unit_price IS NULL AND m.qty_delta <> 0
    ORDER BY m.business_date DESC, m.id DESC
    LIMIT ${Math.min(Math.max(Math.trunc(limit), 1), 200)}
  `);
  return rows.map((r) => ({ movementId: r.id, businessDate: r.business_date, milli: r.qty_delta, userName: r.user_name }));
}
