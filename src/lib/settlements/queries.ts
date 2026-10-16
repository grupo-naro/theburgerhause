import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { hydrate, orderColumns } from "@/lib/orders/caja-queries";

/**
 * Read side of the cadet cash settlement (rendicion). Staff-facing, serializable (dates as ISO
 * strings, money in centavos), a CONSTANT number of queries per call. The balance predicate is
 * exactly the domain `cadetBalance` one (delivered + cash + payment pending; en_camino counted
 * apart) - an int test keeps both definitions in sync. No next/*.
 */

export type CadetBalance = {
  cadetId: number;
  name: string;
  phone: string | null;
  active: boolean;
  /** Centavos of delivered cash orders still pending payment: what the cadet has to hand over. */
  owed: number;
  owedOrderCount: number;
  inRouteCount: number;
  /** Informational: centavos of cash orders still en_camino (not yet owed). */
  inRouteCash: number;
  lastSettlementAt: string | null;
  /** Centavos: sum of the shortages (amount - received_amount) of all this cadet's settlements. */
  shortageTotal: number;
};

export type SettlementLine = { id: number; number: number; total: number };
export type SettlementRecord = {
  id: number;
  cadetId: number;
  cadetName: string;
  /** Centavos of debt cleared. */
  amount: number;
  /** Centavos the cadet actually handed over. */
  receivedAmount: number;
  /** Centavos missing: amount - receivedAmount. */
  shortage: number;
  orderCount: number;
  settledByName: string | null;
  note: string | null;
  createdAt: string;
  orders: SettlementLine[];
};

export type OwedOrder = {
  id: number;
  number: number;
  deliveredAt: string | null;
  total: number;
  /** Staff only: the delivery address. */
  address: string | null;
  paymentMethod: "cash";
  items: { name: string; quantity: number }[];
};
export type InRouteOrder = {
  id: number;
  number: number;
  total: number;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
};
export type CadetSettlementDetail = {
  cadet: { id: number; name: string; phone: string | null; active: boolean };
  /** Centavos: the sum of `orders`, i.e. what `settleCadet` would settle right now. */
  owed: number;
  orders: OwedOrder[];
  inRoute: InRouteOrder[];
  recentSettlements: SettlementRecord[];
};

export type SettlementQueryContext = { now?: Date };

const OWING = and(
  eq(s.orders.status, "entregado"),
  eq(s.orders.paymentMethod, "cash"),
  eq(s.orders.paymentStatus, "pending"),
);

const INT4_MAX = 2_147_483_647;
const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= INT4_MAX;
const safe = (n: number, what: string): number => {
  if (!Number.isSafeInteger(n)) throw new Error(`${what} is not a safe integer`);
  return n;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const RECENT = 10;

/** Every active cadet plus any inactive one that still owes cash, most debt first. */
export async function listCadetBalances(db: Db): Promise<CadetBalance[]> {
  const owedFilter = sql`${s.orders.status} = 'entregado' and ${s.orders.paymentMethod} = 'cash' and ${s.orders.paymentStatus} = 'pending'`;
  const routeFilter = sql`${s.orders.status} = 'en_camino'`;
  const owedCount = sql<number>`count(*) filter (where ${owedFilter})::int`;
  const rows = await db
    .select({
      cadetId: s.cadets.id,
      name: s.cadets.name,
      phone: s.cadets.phone,
      active: s.cadets.active,
      owed: sql<string>`coalesce(sum(${s.orders.total}) filter (where ${owedFilter}), 0)::bigint`,
      owedOrderCount: owedCount,
      inRouteCount: sql<number>`count(*) filter (where ${routeFilter})::int`,
      inRouteCash: sql<string>`coalesce(sum(${s.orders.total}) filter (where ${routeFilter} and ${s.orders.paymentMethod} = 'cash' and ${s.orders.paymentStatus} = 'pending'), 0)::bigint`,
      shortageTotal: sql<string>`(select coalesce(sum("settlements"."amount" - "settlements"."received_amount"), 0)::bigint from "settlements" where "settlements"."cadet_id" = ${s.cadets.id})`,
      lastSettlementAt: sql<Date | null>`(select max("settlements"."created_at") from "settlements" where "settlements"."cadet_id" = ${s.cadets.id})`,
    })
    .from(s.cadets)
    .leftJoin(s.orders, eq(s.orders.cadetId, s.cadets.id))
    .groupBy(s.cadets.id)
    .having(sql`${s.cadets.active} or ${owedCount} > 0`);
  return rows
    .map((r) => ({
      cadetId: r.cadetId,
      name: r.name,
      phone: r.phone,
      active: r.active,
      owed: safe(Number(r.owed), "owed"),
      owedOrderCount: r.owedOrderCount,
      inRouteCount: r.inRouteCount,
      inRouteCash: safe(Number(r.inRouteCash), "inRouteCash"),
      shortageTotal: safe(Number(r.shortageTotal), "shortageTotal"),
      lastSettlementAt: r.lastSettlementAt ? new Date(r.lastSettlementAt).toISOString() : null,
    }))
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name, "es") || a.cadetId - b.cadetId);
}

/**
 * Total cash shortage (amount - received_amount) recorded by settlements, optionally of one
 * cadet and/or since a date. One query.
 */
export async function totalShortages(
  db: Db,
  opts: { cadetId?: number; since?: Date } = {},
): Promise<{ total: number; settlementCount: number }> {
  if (opts.cadetId !== undefined && !isId(opts.cadetId)) return { total: 0, settlementCount: 0 };
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${s.settlements.amount} - ${s.settlements.receivedAmount}), 0)::bigint`,
      settlementCount: sql<number>`count(*) filter (where ${s.settlements.amount} > ${s.settlements.receivedAmount})::int`,
    })
    .from(s.settlements)
    .where(and(opts.cadetId === undefined ? undefined : eq(s.settlements.cadetId, opts.cadetId), opts.since === undefined ? undefined : gte(s.settlements.createdAt, opts.since)));
  return { total: safe(Number(row.total), "shortage total"), settlementCount: row.settlementCount };
}

/** Settlements newest first (keyset by id) with their order lines: two queries, no N+1. */
export async function listSettlements(
  db: Db,
  opts: { cadetId?: number; limit?: number; before?: number } = {},
): Promise<SettlementRecord[]> {
  // Invalid filters yield an empty page (never a silently unfiltered one).
  if (opts.cadetId !== undefined && !isId(opts.cadetId)) return [];
  if (opts.before !== undefined && !isId(opts.before)) return [];
  const limit =
    typeof opts.limit === "number" && Number.isFinite(opts.limit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit)))
      : DEFAULT_LIMIT;
  const where = and(
    opts.cadetId === undefined ? undefined : eq(s.settlements.cadetId, opts.cadetId),
    opts.before === undefined ? undefined : lt(s.settlements.id, opts.before),
  );
  const rows = await db
    .select({
      id: s.settlements.id,
      cadetId: s.settlements.cadetId,
      cadetName: s.cadets.name,
      amount: s.settlements.amount,
      receivedAmount: s.settlements.receivedAmount,
      settledByName: s.users.name,
      note: s.settlements.note,
      createdAt: s.settlements.createdAt,
    })
    .from(s.settlements)
    .innerJoin(s.cadets, eq(s.cadets.id, s.settlements.cadetId))
    .leftJoin(s.users, eq(s.users.id, s.settlements.settledBy))
    .where(where)
    .orderBy(desc(s.settlements.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const lines = await db
    .select({ settlementId: s.settlementOrders.settlementId, id: s.orders.id, number: s.orders.number, total: s.settlementOrders.amount })
    .from(s.settlementOrders)
    .innerJoin(s.orders, eq(s.orders.id, s.settlementOrders.orderId))
    .where(inArray(s.settlementOrders.settlementId, rows.map((r) => r.id)))
    .orderBy(s.orders.id);
  const bySettlement = new Map<number, SettlementLine[]>();
  for (const l of lines) {
    const list = bySettlement.get(l.settlementId) ?? [];
    list.push({ id: l.id, number: l.number, total: l.total });
    bySettlement.set(l.settlementId, list);
  }
  return rows.map((r) => {
    const orders = bySettlement.get(r.id) ?? [];
    return {
      id: r.id,
      cadetId: r.cadetId,
      cadetName: r.cadetName,
      amount: r.amount,
      receivedAmount: r.receivedAmount,
      shortage: r.amount - r.receivedAmount,
      orderCount: orders.length,
      settledByName: r.settledByName,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      orders,
    };
  });
}

/** The screen of one cadet: exactly the orders `settleCadet` would settle, plus context. */
export async function getCadetSettlementDetail(
  db: Db,
  cadetId: number,
  ctx: SettlementQueryContext = {},
): Promise<CadetSettlementDetail | null> {
  const now = ctx.now ?? new Date();
  const [cadet] = await db
    .select({ id: s.cadets.id, name: s.cadets.name, phone: s.cadets.phone, active: s.cadets.active })
    .from(s.cadets)
    .where(eq(s.cadets.id, cadetId));
  if (!cadet) return null;

  const owedRows = await db
    .select({ ...orderColumns, deliveredAt: s.orders.deliveredAt })
    .from(s.orders)
    .where(and(eq(s.orders.cadetId, cadetId), OWING))
    .orderBy(s.orders.deliveredAt, s.orders.id);
  const hydrated = await hydrate(db, owedRows, now);
  const deliveredAt = new Map(owedRows.map((r) => [r.id, r.deliveredAt]));
  const orders: OwedOrder[] = hydrated.map((o) => {
    const byName = new Map<string, number>();
    for (const g of o.items) byName.set(g.name, (byName.get(g.name) ?? 0) + g.quantity);
    return {
      id: o.id,
      number: o.number,
      deliveredAt: deliveredAt.get(o.id)?.toISOString() ?? null,
      total: o.total,
      address: o.address,
      paymentMethod: "cash" as const,
      items: [...byName].map(([name, quantity]) => ({ name, quantity })),
    };
  });

  const inRoute = await db
    .select({
      id: s.orders.id,
      number: s.orders.number,
      total: s.orders.total,
      paymentMethod: s.orders.paymentMethod,
      paymentStatus: s.orders.paymentStatus,
    })
    .from(s.orders)
    .where(and(eq(s.orders.cadetId, cadetId), eq(s.orders.status, "en_camino")))
    .orderBy(s.orders.id);

  const recentSettlements = await listSettlements(db, { cadetId, limit: RECENT });
  return {
    cadet,
    owed: safe(orders.reduce((sum, o) => sum + o.total, 0), "owed"),
    orders,
    inRoute,
    recentSettlements,
  };
}
