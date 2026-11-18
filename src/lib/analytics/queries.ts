import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cutoffMinutes, DEFAULT_BUSINESS_DAY_CUTOFF } from "@/db/order-number";
import type { Period } from "./period";

/**
 * Sales reads for the analytics page (spec 2026-11-07). Amounts in centavos. No next/* imports.
 * Callers MUST check the analytics unlock before calling any of these (see pin.ts).
 */

export type Kpis = { revenue: number; orders: number; avgTicket: number; cancelledCount: number; cancelledAmount: number };
/** `profit` is null when no unit of the product had a cost; `uncostedUnits` feeds "· N sin costo". */
export type TopProduct = { key: string; name: string; units: number; revenue: number; profit: number | null; uncostedUnits: number };
/** `margin` is a rounded integer % (null when no costed revenue). */
export type Profit = { profit: number; costedRevenue: number; margin: number | null; uncostedUnits: number };
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
      COALESCE(SUM(o.total) FILTER (WHERE ${VALID}), 0)::bigint AS revenue,
      COUNT(*) FILTER (WHERE ${VALID})::int AS orders,
      COUNT(*) FILTER (WHERE o.status = 'cancelado')::int AS cancelled_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'cancelado'), 0)::bigint AS cancelled_amount
    FROM orders o
    WHERE ${range}`);
  const r = rows[0];
  // Money sums come back as bigint (strings from pg): a period can exceed the int range ($21.4M in centavos).
  const revenue = Number(r.revenue);
  return { revenue, orders: r.orders, avgTicket: avg(revenue, r.orders), cancelledCount: r.cancelled_count, cancelledAmount: Number(r.cancelled_amount) };
}

export async function getKpis(db: Db, period: Period): Promise<{ cur: Kpis; prev: Kpis }> {
  const [cur, prev] = await Promise.all([kpisFor(db, curRange(period)), kpisFor(db, prevRange(period))]);
  return { cur, prev };
}

/**
 * Per sold unit (one order_items row): its revenue (price + extras), its cost (cost snapshot + extras' cost snapshots,
 * free extras without a cost count 0) and whether it is COSTED: the unit has a cost snapshot and no PAID extra lacks one.
 * Uncosted units never add profit (it would be inflated); they are counted for the "sin costo" warning.
 */
const UNIT_COLUMNS = sql`
  oi.unit_price_snapshot + COALESCE((SELECT SUM(m.price_delta) FROM order_item_modifiers m WHERE m.order_item_id = oi.id), 0) AS amount,
  oi.unit_cost_snapshot + COALESCE((SELECT SUM(COALESCE(m.cost_snapshot, 0)) FROM order_item_modifiers m WHERE m.order_item_id = oi.id), 0) AS cost,
  (oi.unit_cost_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM order_item_modifiers m WHERE m.order_item_id = oi.id AND m.price_delta > 0 AND m.cost_snapshot IS NULL
  )) AS costed`;

export async function getTopProducts(db: Db, period: Period, opts: { categoryId?: number; limit?: number }): Promise<TopProduct[]> {
  const limit = opts.limit ?? 10;
  const category = opts.categoryId === undefined ? sql`TRUE` : sql`p.category_id = ${opts.categoryId}`;
  const { rows } = await db.execute<TopProduct>(sql`
    WITH units AS (
      SELECT
        CASE WHEN oi.product_id IS NULL THEN 'n' || oi.name_snapshot ELSE 'p' || oi.product_id END AS key,
        COALESCE(p.name, oi.name_snapshot) AS name,
        ${UNIT_COLUMNS}
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE ${VALID} AND ${curRange(period)} AND ${category}
    )
    SELECT key, MIN(name) AS name, COUNT(*)::int AS units, SUM(amount)::bigint AS revenue,
      CASE WHEN COUNT(*) FILTER (WHERE costed) = 0 THEN NULL ELSE SUM(amount - cost) FILTER (WHERE costed)::bigint END AS profit,
      COUNT(*) FILTER (WHERE NOT costed)::int AS "uncostedUnits"
    FROM units
    GROUP BY key
    ORDER BY units DESC, revenue DESC, name ASC
    LIMIT ${limit}`);
  return rows.map((r) => ({ key: r.key, name: r.name, units: r.units, revenue: Number(r.revenue), profit: r.profit === null ? null : Number(r.profit), uncostedUnits: r.uncostedUnits }));
}

async function profitFor(db: Db, range: SQL): Promise<Profit> {
  const { rows } = await db.execute<{ profit: number; costed_revenue: number; uncosted: number }>(sql`
    WITH units AS (
      SELECT ${UNIT_COLUMNS}
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${VALID} AND ${range}
    )
    SELECT
      COALESCE(SUM(amount - cost) FILTER (WHERE costed), 0)::bigint AS profit,
      COALESCE(SUM(amount) FILTER (WHERE costed), 0)::bigint AS costed_revenue,
      COUNT(*) FILTER (WHERE NOT costed)::int AS uncosted
    FROM units`);
  const r = rows[0];
  const profit = Number(r.profit);
  const costedRevenue = Number(r.costed_revenue);
  return {
    profit,
    costedRevenue,
    margin: costedRevenue === 0 ? null : Math.round((profit / costedRevenue) * 100),
    uncostedUnits: r.uncosted,
  };
}

/** Profit of the period and of the previous one (same orders, range and same-time cut as the KPIs; no delivery fee). */
export async function getProfit(db: Db, period: Period): Promise<{ cur: Profit; prev: Profit }> {
  const [cur, prev] = await Promise.all([profitFor(db, curRange(period)), profitFor(db, prevRange(period))]);
  return { cur, prev };
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
      SELECT o.approved_by AS user_id, COUNT(*)::int AS orders, SUM(o.total)::bigint AS revenue
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
    SELECT pe.user_id, u.name, COALESCE(s.orders, 0)::int AS orders, COALESCE(s.revenue, 0)::bigint AS revenue, COALESCE(a.addons, 0)::int AS addons
    FROM people pe
    LEFT JOIN sales s ON s.user_id IS NOT DISTINCT FROM pe.user_id
    LEFT JOIN addons a ON a.user_id = pe.user_id
    LEFT JOIN users u ON u.id = pe.user_id
    ORDER BY revenue DESC, orders DESC, u.name ASC NULLS LAST`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.user_id === null ? "Sin asignar" : (r.name ?? "Sin asignar"),
    orders: r.orders,
    revenue: Number(r.revenue),
    avgTicket: avg(Number(r.revenue), r.orders),
    addons: r.addons,
  }));
}

/** Units sold per patty level and the total patties (snapshots; same orders and range as the KPIs). */
export type Patties = { total: number; byLevel: { 1: number; 2: number; 3: number } };

async function pattiesFor(db: Db, range: SQL): Promise<Patties> {
  const { rows } = await db.execute<{ total: string | number; l1: number; l2: number; l3: number }>(sql`
    SELECT
      COALESCE(SUM(oi.patties_snapshot), 0)::bigint AS total,
      COUNT(*) FILTER (WHERE oi.patties_snapshot = 1)::int AS l1,
      COUNT(*) FILTER (WHERE oi.patties_snapshot = 2)::int AS l2,
      COUNT(*) FILTER (WHERE oi.patties_snapshot = 3)::int AS l3
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE ${VALID} AND ${range}`);
  const r = rows[0];
  return { total: Number(r.total), byLevel: { 1: r.l1, 2: r.l2, 3: r.l3 } };
}

export async function getPatties(db: Db, period: Period): Promise<{ cur: Patties; prev: Patties }> {
  const [cur, prev] = await Promise.all([pattiesFor(db, curRange(period)), pattiesFor(db, prevRange(period))]);
  return { cur, prev };
}
