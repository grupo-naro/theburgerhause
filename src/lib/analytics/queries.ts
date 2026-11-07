import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cutoffMinutes, DEFAULT_BUSINESS_DAY_CUTOFF } from "@/db/order-number";
import type { Period } from "./period";

/**
 * Sales reads for the analytics page (spec 2026-11-07). Amounts in centavos. No next/* imports.
 * Callers MUST check the analytics unlock before calling any of these (see pin.ts).
 */

export type Kpis = { revenue: number; orders: number; avgTicket: number; cancelledCount: number; cancelledAmount: number };
export type TopProduct = { key: string; name: string; units: number; revenue: number };
export type Heatmap = { hours: number[]; cells: { dow: number; hour: number; orders: number }[]; max: number };
export type SellerRow = { userId: number | null; name: string; orders: number; revenue: number; avgTicket: number; addons: number };

const VALID = sql`o.status IN ('en_preparacion','listo_despacho','en_camino','para_retirar','entregado')`;

const curRange = (p: Period): SQL => sql`o.business_date BETWEEN ${p.from} AND ${p.to}`;
const prevRange = (p: Period): SQL =>
  p.prevCutAt
    ? sql`o.business_date BETWEEN ${p.prevFrom} AND ${p.prevTo} AND (o.business_date < ${p.prevTo} OR o.created_at < ${p.prevCutAt.toISOString()})`
    : sql`o.business_date BETWEEN ${p.prevFrom} AND ${p.prevTo}`;

const avg = (revenue: number, orders: number) => (orders ? Math.round(revenue / orders) : 0);

async function kpisFor(db: Db, range: SQL): Promise<Kpis> {
  const { rows } = await db.execute<{ revenue: number; orders: number; cancelled_count: number; cancelled_amount: number }>(sql`
    SELECT
      COALESCE(SUM(o.total) FILTER (WHERE ${VALID}), 0)::int AS revenue,
      COUNT(*) FILTER (WHERE ${VALID})::int AS orders,
      COUNT(*) FILTER (WHERE o.status = 'cancelado')::int AS cancelled_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'cancelado'), 0)::int AS cancelled_amount
    FROM orders o
    WHERE ${range}`);
  const r = rows[0];
  return { revenue: r.revenue, orders: r.orders, avgTicket: avg(r.revenue, r.orders), cancelledCount: r.cancelled_count, cancelledAmount: r.cancelled_amount };
}

export async function getKpis(db: Db, period: Period): Promise<{ cur: Kpis; prev: Kpis }> {
  const [cur, prev] = await Promise.all([kpisFor(db, curRange(period)), kpisFor(db, prevRange(period))]);
  return { cur, prev };
}

export async function getTopProducts(db: Db, period: Period, opts: { categoryId?: number; limit?: number }): Promise<TopProduct[]> {
  const limit = opts.limit ?? 10;
  const category = opts.categoryId === undefined ? sql`TRUE` : sql`p.category_id = ${opts.categoryId}`;
  const { rows } = await db.execute<TopProduct>(sql`
    WITH units AS (
      SELECT
        CASE WHEN oi.product_id IS NULL THEN 'n' || oi.name_snapshot ELSE 'p' || oi.product_id END AS key,
        COALESCE(p.name, oi.name_snapshot) AS name,
        oi.unit_price_snapshot + COALESCE((SELECT SUM(m.price_delta) FROM order_item_modifiers m WHERE m.order_item_id = oi.id), 0) AS amount
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE ${VALID} AND ${curRange(period)} AND ${category}
    )
    SELECT key, MIN(name) AS name, COUNT(*)::int AS units, SUM(amount)::int AS revenue
    FROM units
    GROUP BY key
    ORDER BY units DESC, revenue DESC, name ASC
    LIMIT ${limit}`);
  return rows.map((r) => ({ key: r.key, name: r.name, units: r.units, revenue: r.revenue }));
}

/** Hours ordered along the business day: the cutoff hour first (cutoff 06:00 -> 6, 7, ..., 23, 0, ..., 5). */
export async function getHeatmap(db: Db, period: Period, cutoff: string = DEFAULT_BUSINESS_DAY_CUTOFF): Promise<Heatmap> {
  const { rows } = await db.execute<{ dow: number; hour: number; orders: number }>(sql`
    SELECT
      EXTRACT(ISODOW FROM o.business_date)::int AS dow,
      EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS hour,
      COUNT(*)::int AS orders
    FROM orders o
    WHERE ${VALID} AND ${curRange(period)}
    GROUP BY 1, 2`);
  const startHour = Math.floor((cutoffMinutes(cutoff) ?? 360) / 60);
  const pos = (h: number) => (h - startHour + 24) % 24;
  const hours = [...new Set(rows.map((r) => r.hour))].sort((a, b) => pos(a) - pos(b));
  const cells = rows.map((r) => ({ dow: r.dow, hour: r.hour, orders: r.orders })).sort((a, b) => a.dow - b.dow || pos(a.hour) - pos(b.hour));
  return { hours, cells, max: cells.reduce((m, c) => Math.max(m, c.orders), 0) };
}

export async function getSellers(db: Db, period: Period): Promise<SellerRow[]> {
  const { rows } = await db.execute<{ user_id: number | null; name: string | null; orders: number; revenue: number; addons: number }>(sql`
    WITH sales AS (
      SELECT o.approved_by AS user_id, COUNT(*)::int AS orders, SUM(o.total)::int AS revenue
      FROM orders o
      WHERE ${VALID} AND ${curRange(period)}
      GROUP BY o.approved_by
    ),
    addons AS (
      SELECT a.confirmed_by AS user_id, COUNT(*)::int AS addons
      FROM order_addons a
      JOIN orders o ON o.id = a.order_id
      WHERE a.status = 'confirmado' AND a.confirmed_by IS NOT NULL AND ${VALID} AND ${curRange(period)}
      GROUP BY a.confirmed_by
    ),
    people AS (
      SELECT user_id FROM sales
      UNION
      SELECT user_id FROM addons
    )
    SELECT pe.user_id, u.name, COALESCE(s.orders, 0)::int AS orders, COALESCE(s.revenue, 0)::int AS revenue, COALESCE(a.addons, 0)::int AS addons
    FROM people pe
    LEFT JOIN sales s ON s.user_id IS NOT DISTINCT FROM pe.user_id
    LEFT JOIN addons a ON a.user_id = pe.user_id
    LEFT JOIN users u ON u.id = pe.user_id
    ORDER BY revenue DESC, orders DESC, u.name ASC NULLS LAST`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.user_id === null ? "Sin asignar" : (r.name ?? "Sin asignar"),
    orders: r.orders,
    revenue: r.revenue,
    avgTicket: avg(r.revenue, r.orders),
    addons: r.addons,
  }));
}
