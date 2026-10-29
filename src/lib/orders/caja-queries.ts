import { and, asc, desc, eq, gt, inArray, ne, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Fulfillment, OrderStatus } from "@/domain/order-status";
import type { Sector } from "./sector";
import { groupTrackingItems, type SnapshotItem, type TrackingGroup } from "./tracking-groups";

/**
 * Read side of the Caja screen. Staff-facing DTOs (they DO carry customer data), serializable
 * (dates as ISO strings). A constant number of queries per list (orders + units + modifiers),
 * never one per order. No next/*.
 */

export type PrintState = { pending: number; failed: number; done: number };
export type PrintKindName = "kitchen" | "customer" | "delivery";
/** Print state of ONE order plus which ticket kinds are unhandled-failed / still unconfirmed (pending or printing). */
export type OrderPrintState = PrintState & { failedKinds: PrintKindName[]; pendingKinds: PrintKindName[] };
export type CajaOrder = {
  id: number;
  number: number;
  channel: "web" | "counter";
  fulfillment: Fulfillment;
  status: OrderStatus;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  customerName: string | null;
  whatsapp: string | null;
  address: string | null;
  crossStreets: string | null;
  addressNotes: string | null;
  pagerNumber: number | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  minutesWaiting: number;
  items: TrackingGroup[];
  /** `pending` includes jobs the agent is printing right now. */
  printState: PrintState;
};
export type FailedPrintJob = {
  jobId: number;
  orderId: number;
  orderNumber: number;
  stationId: number;
  /** `ticket` only exists in history (pre Task 10.2); new jobs are `kitchen`/`customer`/`delivery`. */
  type: "kitchen" | "ticket" | "delivery" | "customer" | "additional";
  /** Add-on seq of an `additional` ticket (from its payload); null for every other type. */
  addonSeq: number | null;
  error: string | null;
  attempts: number;
  createdAt: string;
};
/**
 * `sector` keeps only the orders of one sector (delivery orders vs takeaway + counter sales; see sector.ts),
 * `channel` narrows further (web takeaway vs counter sales). Absent = no filter (admin general views).
 */
export type SectorScope = { sector?: Sector | null; channel?: "web" | "counter" | null };
export type CajaQueryContext = { now?: Date } & SectorScope;

/** SQL predicate of a sector scope on `orders` (undefined = everything). The single SQL home of the sector mapping. */
export function sectorScopeSql(scope: SectorScope = {}): SQL | undefined {
  return and(
    scope.sector == null
      ? undefined
      : scope.sector === "delivery"
        ? eq(s.orders.fulfillment, "delivery")
        : ne(s.orders.fulfillment, "delivery"),
    scope.channel == null ? undefined : eq(s.orders.channel, scope.channel),
  );
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const FAILED_LIMIT = 100;

/** The legacy `ticket` type (before the ticket redesign) reads as its successor, the customer ticket. `kitchen` is a kind of its own again (the comanda is back). */
const jobKind = (col: string) => `(case ${col} when 'ticket' then 'customer' else ${col}::text end)`;
/** `additional` tickets also carry the add-on seq in their payload (renderAdditionalTicket): add-on 1's reprint must not hide add-on 2's failure. Other kinds have no `addonSeq` (null = null). */
const addonSeq = (col: string) => `(${col}->>'addonSeq')`;
const SAME_KIND = `${jobKind('"later"."type"')} = ${jobKind('"print_jobs"."type"')} and ${addonSeq('"later"."payload"')} is not distinct from ${addonSeq('"print_jobs"."payload"')}`;

/**
 * A failed job is "handled" once a LATER job of the same type for the same station was queued
 * (pending/printing) or printed (done): a reprint superseded it. Only unhandled failures alert. The legacy
 * `ticket` type counts as the customer ticket, so a reprint also clears a failure recorded before the ticket redesign.
 * Failures of a CANCELLED order never alert (cancelOrder fails its unclaimed jobs on purpose).
 */
export const UNHANDLED_FAILED = `"print_jobs"."status" = 'failed' and not exists (select 1 from "print_jobs" "later" where "later"."order_id" = "print_jobs"."order_id" and "later"."station_id" = "print_jobs"."station_id" and ${SAME_KIND} and "later"."id" > "print_jobs"."id" and "later"."status" in ('pending','printing','done')) and not exists (select 1 from "orders" "o_cancelled" where "o_cancelled"."id" = "print_jobs"."order_id" and "o_cancelled"."status" = 'cancelado')`;

const jobCount = (filter: string) =>
  sql<number>`(select count(*)::int from "print_jobs" where "print_jobs"."order_id" = "orders"."id" and ${sql.raw(filter)})`;

export const orderColumns = {
  id: s.orders.id,
  number: s.orders.number,
  channel: s.orders.channel,
  fulfillment: s.orders.fulfillment,
  status: s.orders.status,
  paymentMethod: s.orders.paymentMethod,
  paymentStatus: s.orders.paymentStatus,
  customerName: s.orders.customerName,
  whatsapp: s.orders.whatsapp,
  address: s.orders.address,
  crossStreets: s.orders.crossStreets,
  addressNotes: s.orders.addressNotes,
  pagerNumber: s.orders.pagerNumber,
  subtotal: s.orders.subtotal,
  deliveryFee: s.orders.deliveryFee,
  total: s.orders.total,
  createdAt: s.orders.createdAt,
  jobsPending: jobCount(`"print_jobs"."status" in ('pending','printing')`),
  jobsFailed: jobCount(UNHANDLED_FAILED),
  jobsDone: jobCount(`"print_jobs"."status" = 'done'`),
};

export type OrderRow = Omit<CajaOrder, "createdAt" | "minutesWaiting" | "items" | "printState"> & {
  createdAt: Date;
  jobsPending: number;
  jobsFailed: number;
  jobsDone: number;
};

export async function hydrate(db: Db, rows: OrderRow[], now: Date): Promise<CajaOrder[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const units = await db
    .select({
      orderId: s.orderItems.orderId,
      id: s.orderItems.id,
      productId: s.orderItems.productId,
      name: s.orderItems.nameSnapshot,
      unitPrice: s.orderItems.unitPriceSnapshot,
      note: s.orderItems.notes,
      addonSeq: s.orderAddons.seq,
    })
    .from(s.orderItems)
    .leftJoin(s.orderAddons, eq(s.orderAddons.id, s.orderItems.addonId))
    .where(inArray(s.orderItems.orderId, ids))
    .orderBy(asc(s.orderItems.id));
  const mods = units.length
    ? await db
        .select({
          itemId: s.orderItemModifiers.orderItemId,
          modifierId: s.orderItemModifiers.modifierId,
          name: s.orderItemModifiers.nameSnapshot,
          kitchenLabel: s.orderItemModifiers.kitchenLabel,
          priceDelta: s.orderItemModifiers.priceDelta,
        })
        .from(s.orderItemModifiers)
        .where(inArray(s.orderItemModifiers.orderItemId, units.map((u) => u.id)))
        .orderBy(asc(s.orderItemModifiers.id))
    : [];

  const modsByItem = new Map<number, SnapshotItem["modifiers"]>();
  for (const m of mods) {
    const list = modsByItem.get(m.itemId) ?? [];
    list.push({ modifierId: m.modifierId, name: m.name, priceDelta: m.priceDelta, kitchenLabel: m.kitchenLabel });
    modsByItem.set(m.itemId, list);
  }
  const unitsByOrder = new Map<number, SnapshotItem[]>();
  for (const u of units) {
    const list = unitsByOrder.get(u.orderId) ?? [];
    list.push({
      id: u.id,
      productId: u.productId,
      name: u.name,
      unitPrice: u.unitPrice,
      note: u.note,
      addonSeq: u.addonSeq ?? null,
      modifiers: modsByItem.get(u.id) ?? [],
    });
    unitsByOrder.set(u.orderId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    channel: r.channel,
    fulfillment: r.fulfillment,
    status: r.status,
    paymentMethod: r.paymentMethod,
    paymentStatus: r.paymentStatus,
    customerName: r.customerName,
    whatsapp: r.whatsapp,
    address: r.address,
    crossStreets: r.crossStreets,
    addressNotes: r.addressNotes,
    pagerNumber: r.pagerNumber,
    subtotal: r.subtotal,
    deliveryFee: r.deliveryFee,
    total: r.total,
    createdAt: r.createdAt.toISOString(),
    minutesWaiting: Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / 60_000)),
    items: groupTrackingItems(unitsByOrder.get(r.id) ?? []).groups,
    printState: { pending: r.jobsPending, failed: r.jobsFailed, done: r.jobsDone },
  }));
}

/** Web orders waiting for the cashier, oldest first. */
export async function listPendingApproval(db: Db, ctx: CajaQueryContext = {}): Promise<CajaOrder[]> {
  const rows = await db
    .select(orderColumns)
    .from(s.orders)
    .where(and(eq(s.orders.status, "pendiente_aprobacion"), sectorScopeSql(ctx)))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
  return hydrate(db, rows, ctx.now ?? new Date());
}

/** The last N orders that are not waiting for approval, newest first. */
export async function listRecentProcessed(db: Db, opts: { limit?: number } & CajaQueryContext = {}): Promise<CajaOrder[]> {
  const requested = Number.isFinite(opts.limit) ? Math.trunc(opts.limit as number) : DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requested));
  const rows = await db
    .select(orderColumns)
    .from(s.orders)
    .where(and(ne(s.orders.status, "pendiente_aprobacion"), sectorScopeSql(opts)))
    .orderBy(desc(s.orders.createdAt), desc(s.orders.id))
    .limit(limit);
  return hydrate(db, rows, opts.now ?? new Date());
}

/** UNHANDLED failed print jobs (see UNHANDLED_FAILED), newest first, optionally only those of one station. */
export async function listFailedPrintJobs(db: Db, stationId?: number, scope: SectorScope = {}): Promise<FailedPrintJob[]> {
  const later = alias(s.printJobs, "later");
  const rows = await db
    .select({
      jobId: s.printJobs.id,
      orderId: s.printJobs.orderId,
      orderNumber: s.orders.number,
      stationId: s.printJobs.stationId,
      type: s.printJobs.type,
      addonSeq: sql<string | null>`${s.printJobs.payload}->>'addonSeq'`,
      error: s.printJobs.error,
      attempts: s.printJobs.attempts,
      createdAt: s.printJobs.createdAt,
    })
    .from(s.printJobs)
    .innerJoin(s.orders, eq(s.orders.id, s.printJobs.orderId))
    .where(
      and(
        eq(s.printJobs.status, "failed"),
        ne(s.orders.status, "cancelado"), // a cancelled order never prints: its failed jobs are no alert
        notExists(
          db
            .select({ one: sql`1` })
            .from(later)
            .where(
              and(
                eq(later.orderId, s.printJobs.orderId),
                eq(later.stationId, s.printJobs.stationId),
                sql.raw(SAME_KIND),
                gt(later.id, s.printJobs.id),
                inArray(later.status, ["pending", "printing", "done"]),
              ),
            ),
        ),
        stationId === undefined ? undefined : eq(s.printJobs.stationId, stationId),
        sectorScopeSql(scope),
      ),
    )
    .orderBy(desc(s.printJobs.createdAt), desc(s.printJobs.id))
    .limit(FAILED_LIMIT);
  return rows.map((r) => ({ ...r, addonSeq: r.addonSeq === null ? null : Number(r.addonSeq), createdAt: r.createdAt.toISOString() }));
}
